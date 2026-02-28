//! GPU-based video export pipeline.
//!
//! Like Cap, we:
//! 1. Decode frames with FFmpeg (streaming - ONE process, not per-frame)
//! 2. Render on GPU with zoom/webcam effects
//! 3. Pipe rendered RGBA frames to FFmpeg for encoding only

mod ffmpeg;
mod pipeline;

use pipeline::{spawn_decode_task, spawn_encode_task};

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use snapit_domain::video_export::{ExportResult, ExportStage};
use snapit_export::caption_timeline::remap_captions_to_timeline;
use snapit_export::cursor_overlay::{
    composite_cursor_overlay_frame, CursorFrameSample, CursorOverlayContext,
};
use snapit_export::export_job::{
    run_export_loop_with_context, ExportLoopDirective, ExportLoopExit,
};
use snapit_export::export_plan::plan_video_export;
use snapit_export::frame_composition::{build_frame_composition, FrameCompositionRequest};
use snapit_export::frame_context::{
    build_frame_scene_context, build_frame_timeline_context, should_log_camera_transition_debug,
    should_log_frame_debug,
};
use snapit_export::frame_overlays::{
    build_frame_overlay_plan, build_frame_text_overlay_quads, FrameOverlayRequest,
    FrameTextOverlayRequest,
};
use snapit_export::frame_path_plan::{plan_frame_render, CropRectPlan};
use snapit_export::frame_pipeline_state::{ExportLoopState, PendingCpuWork};
use snapit_export::frame_prepare::{prepare_base_screen_frame, PrepareFrameRequest};
use snapit_export::job_control::{
    is_export_cancelled, request_cancel_export as request_job_cancel, reset_cancel_export,
    FINALIZING_PROGRESS,
};
use snapit_export::job_finalize::{
    drain_pipeline_if_needed, finalize_cancelled_export, finalize_completed_export,
    EncoderFinalizeError,
};
use snapit_export::job_runner::{ExportJobRunner, ExportJobRunnerConfig, LoopControl};
use tauri::{AppHandle, Manager};

/// Request cancellation of the currently running export.
pub fn request_cancel_export() {
    request_job_cancel();
    log::info!("[EXPORT] Cancel requested");
}

use super::compositor::Compositor;
use super::cursor::{CursorInterpolator, VideoContentBounds};
use super::renderer::Renderer;
use super::stream_decoder::StreamDecoder;
use super::svg_cursor::get_svg_cursor;
use crate::commands::text_prerender::PreRenderedTextState;
use crate::commands::video_recording::cursor::events::load_cursor_recording;
use crate::commands::video_recording::cursor::events::WindowsCursorShape;
use snapit_domain::video_project::{CursorType, VideoProject};
use snapit_render::nv12_converter::{CropRect, Nv12Converter};
use snapit_render::scene::SceneInterpolator;
use snapit_render::types::{BackgroundStyle, PixelFormat};
use snapit_render::webcam_overlay::is_webcam_visible_at;
use snapit_render::zoom::ZoomInterpolator;

// Re-export submodule functions used externally
pub use ffmpeg::emit_progress;

use ffmpeg::start_ffmpeg_encoder;

/// Constant context for CPU frame compositing, shared across all export frames.
struct CpuCompositeCtx<'a> {
    composition_w: u32,
    composition_h: u32,
    crop_enabled: bool,
    crop_x: u32,
    crop_y: u32,
    crop_width: u32,
    crop_height: u32,
    original_width: u32,
    original_height: u32,
    video_content_bounds: VideoContentBounds,
    cursor_type: CursorType,
    cursor_scale: f32,
    cursor_motion_blur: f32,
    cursor_interpolator: Option<&'a CursorInterpolator>,
}

struct ExportRenderLoopContext<'a> {
    loop_state: ExportLoopState,
    compositor: &'a mut Compositor,
}

/// Apply CPU-based compositing (cursor + pre-rendered text overlays) to a pending frame.
///
/// Extracted from the render loop to enable double-buffered pipeline overlap:
/// GPU renders frame N+1 while CPU processes frame N.
fn apply_cpu_compositing(pending: &mut PendingCpuWork, ctx: &CpuCompositeCtx) {
    let Some(cursor_interp) = ctx.cursor_interpolator else {
        return;
    };
    let cursor = cursor_interp.get_cursor_at(pending.source_time_ms);
    let overlay_ctx = CursorOverlayContext {
        composition_w: ctx.composition_w,
        composition_h: ctx.composition_h,
        crop_enabled: ctx.crop_enabled,
        crop_x: ctx.crop_x,
        crop_y: ctx.crop_y,
        crop_width: ctx.crop_width,
        crop_height: ctx.crop_height,
        original_width: ctx.original_width,
        original_height: ctx.original_height,
        video_bounds: ctx.video_content_bounds,
        cursor_type: ctx.cursor_type,
        cursor_scale: ctx.cursor_scale,
        cursor_motion_blur: ctx.cursor_motion_blur,
    };
    let sample = CursorFrameSample {
        x: cursor.x,
        y: cursor.y,
        velocity_x: cursor.velocity_x,
        velocity_y: cursor.velocity_y,
        opacity: cursor.opacity,
        scale: cursor.scale,
        cursor_id: cursor.cursor_id.as_deref(),
        cursor_shape: cursor.cursor_shape,
    };

    composite_cursor_overlay_frame(
        &mut pending.rgba_data,
        &overlay_ctx,
        pending.camera_only_opacity,
        pending.zoom_state,
        sample,
        WindowsCursorShape::Arrow,
        |shape, target_height| {
            get_svg_cursor(shape, target_height).map(|svg_cursor| {
                super::cursor::DecodedCursorImage {
                    width: svg_cursor.width,
                    height: svg_cursor.height,
                    hotspot_x: svg_cursor.hotspot_x,
                    hotspot_y: svg_cursor.hotspot_y,
                    data: svg_cursor.data,
                }
            })
        },
        |cursor_id| cursor_interp.get_cursor_image(cursor_id),
    );
}

/// Export a video project using GPU rendering.
///
/// Uses streaming decoders (1 FFmpeg process each) instead of per-frame spawning.
pub async fn export_video_gpu(
    app: AppHandle,
    project: VideoProject,
    output_path: String,
) -> Result<ExportResult, String> {
    let start_time = std::time::Instant::now();

    // Reset cancel flag at the start of each export
    reset_cancel_export();

    // Get resource directory for wallpaper path resolution
    let resource_dir = app.path().resource_dir().ok();
    let output_path = PathBuf::from(&output_path);

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    emit_progress(&app, 0.0, ExportStage::Preparing, "Initializing GPU...");

    // Initialize GPU
    let renderer = Renderer::new().await?;
    let mut compositor = Compositor::new(&renderer);

    // Get pre-rendered text store (populated by frontend before export starts)
    let prerendered_text_store = {
        let state = app.state::<PreRenderedTextState>();
        state.store.clone()
    };
    {
        let store = prerendered_text_store.lock();
        store.log_summary();
        compositor.upload_text_overlays(&store);
    }

    emit_progress(&app, 0.02, ExportStage::Preparing, "Loading video...");

    // Calculate export parameters
    let fps = project.export.fps;
    let original_width = project.sources.original_width;
    let original_height = project.sources.original_height;

    let export_plan = plan_video_export(&project);
    let timeline_plan = export_plan.timeline;
    let dimensions = export_plan.dimensions;
    let decode_plan = &export_plan.decode;
    let use_nv12_decode = export_plan.use_nv12_decode;
    // No-crop area captures can have odd source dimensions; this ensures
    // RGBA uploads match the pre-allocated even-sized export texture.
    let force_even_source_crop = export_plan.force_even_source_crop;

    let duration_secs = timeline_plan.duration_secs;
    let total_output_frames = timeline_plan.total_output_frames;
    let decode_start_ms = decode_plan.decode_start_ms;
    let decode_end_ms = decode_plan.decode_end_ms;
    let has_segments = timeline_plan.has_segments;
    let total_decode_frames = decode_plan.total_decode_frames;

    log::info!(
        "[EXPORT] Timeline: effective_duration={}ms, decode_range={}ms-{}ms, segments={}, decode_frames={}, output_frames={}",
        timeline_plan.effective_duration_ms,
        decode_start_ms,
        decode_end_ms,
        project.timeline.segments.len(),
        total_decode_frames,
        total_output_frames
    );

    // Clone configs to avoid borrow issues with project
    let crop = project.export.crop.clone();
    let composition = project.export.composition.clone();
    log::info!(
        "[EXPORT] Composition config: mode={:?}, width={:?}, height={:?}, aspect_ratio={:?}",
        composition.mode,
        composition.width,
        composition.height,
        composition.aspect_ratio
    );
    let padding = dimensions.padding;
    let crop_enabled = dimensions.crop_enabled;
    let video_w = dimensions.video_width;
    let video_h = dimensions.video_height;
    let composition_w = dimensions.composition_width;
    let composition_h = dimensions.composition_height;
    let out_w = dimensions.output_width;
    let out_h = dimensions.output_height;
    let use_manual_composition = dimensions.use_manual_composition;

    if crop_enabled {
        log::info!(
            "[EXPORT] Video crop enabled: {}x{} at ({}, {})",
            video_w,
            video_h,
            crop.x,
            crop.y
        );
    }
    log::info!(
        "[EXPORT] Planned dimensions: video={}x{}, composition={}x{}, output={}x{}, padding={}, manual={}",
        video_w,
        video_h,
        composition_w,
        composition_h,
        out_w,
        out_h,
        padding,
        use_manual_composition
    );

    // Compute export-equivalent video content bounds once.
    // Cursor and pre-rendered text overlays must use the exact same frame bounds
    // as compositor composition to keep preview/export parity.
    let composition_bounds = snapit_render::parity::calculate_composition_bounds(
        video_w as f32,
        video_h as f32,
        padding as f32,
        if use_manual_composition {
            Some((composition_w as f32, composition_h as f32))
        } else {
            None
        },
    );
    let video_content_bounds = VideoContentBounds {
        x: composition_bounds.frame_x,
        y: composition_bounds.frame_y,
        width: composition_bounds.frame_width,
        height: composition_bounds.frame_height,
    };

    // Initialize streaming decoders (ONE FFmpeg process each!)
    // Use decode_range which respects segments (first seg start to last seg end).
    // NV12 fast path is disabled for odd source/crop alignment to avoid frame jitter.
    let screen_path = Path::new(&decode_plan.screen_video_path);
    if !use_nv12_decode {
        log::info!(
            "[EXPORT] NV12 fast path disabled for source {}x{} crop=({},{} {}x{} enabled={}); using RGBA decode",
            original_width,
            original_height,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            crop_enabled
        );
    }
    let mut screen_decoder = StreamDecoder::new(screen_path, decode_start_ms, decode_end_ms)?;
    if use_nv12_decode {
        screen_decoder = screen_decoder.with_pixel_format(PixelFormat::Nv12);
    }
    screen_decoder.start(screen_path)?;

    // Webcam decoder if planned and available.
    let webcam_decoder = if let Some(ref path) = decode_plan.webcam_video_path {
        let webcam_path = Path::new(path);
        let mut decoder = StreamDecoder::new(webcam_path, decode_start_ms, decode_end_ms)?;
        decoder.start(webcam_path)?;
        Some(decoder)
    } else {
        None
    };

    let has_webcam = webcam_decoder.is_some();

    // Spawn decode task for pipeline parallelism
    // Use total_decode_frames (full range including gaps) for decoding
    let (mut decode_rx, decode_handle) =
        spawn_decode_task(screen_decoder, webcam_decoder, total_decode_frames);

    log::info!(
        "[EXPORT] GPU export (streaming): {}x{} @ {}fps, decode={} frames, output={} frames, webcam={}",
        out_w,
        out_h,
        fps,
        total_decode_frames,
        total_output_frames,
        has_webcam
    );

    // Log scene configuration for debugging
    log::info!(
        "[EXPORT] Scene config: default_mode={:?}, {} segments, webcam.enabled={}, webcam.visibility_segments={}",
        project.scene.default_mode,
        project.scene.segments.len(),
        project.webcam.enabled,
        project.webcam.visibility_segments.len()
    );
    for seg in &project.scene.segments {
        log::info!(
            "[EXPORT]   Scene segment: {}ms-{}ms mode={:?}",
            seg.start_ms,
            seg.end_ms,
            seg.mode
        );
    }

    // Log zoom configuration
    log::info!(
        "[EXPORT] Zoom config: mode={:?}, {} regions",
        project.zoom.mode,
        project.zoom.regions.len()
    );

    emit_progress(&app, 0.05, ExportStage::Encoding, "Starting encoder...");

    // Start FFmpeg encoder (takes raw RGBA from stdin)
    let mut ffmpeg = start_ffmpeg_encoder(&project, &output_path, out_w, out_h, fps)?;
    let stdin = ffmpeg.stdin.take().ok_or("Failed to get FFmpeg stdin")?;

    // Spawn encode task for pipeline parallelism
    let (encode_tx, encode_handle) = spawn_encode_task(stdin);

    // NOTE: Auto zoom generation is disabled. Users must explicitly add zoom regions.
    // The zoom mode in project.zoom.mode is used to control how existing regions behave,
    // but we don't auto-generate regions anymore.
    let project = project;

    // Create zoom interpolator
    let zoom_interpolator = ZoomInterpolator::new(&project.zoom);

    // Create scene interpolator for smooth scene transitions
    let scene_interpolator = SceneInterpolator::new(project.scene.segments.clone());

    // Remap captions from source time to timeline time (accounts for deleted segments)
    let timeline_captions =
        remap_captions_to_timeline(&project.caption_segments, &project.timeline);
    if !timeline_captions.is_empty() {
        log::info!(
            "[EXPORT] Captions: {} segments remapped to timeline time",
            timeline_captions.len()
        );
    }

    // Load cursor recording and create interpolator if cursor is visible
    let cursor_interpolator = if project.cursor.visible {
        if let Some(ref cursor_data_path) = project.sources.cursor_data {
            let cursor_path = std::path::Path::new(cursor_data_path);
            if cursor_path.exists() {
                match load_cursor_recording(cursor_path) {
                    Ok(recording) => {
                        log::info!(
                            "[EXPORT] Loaded cursor recording with {} events, {} images",
                            recording.events.len(),
                            recording.cursor_images.len()
                        );
                        // Debug: log cursor shapes for each cursor image
                        for (id, img) in &recording.cursor_images {
                            log::debug!(
                                "[EXPORT] Cursor image '{}': shape={:?}, size={}x{}",
                                id,
                                img.cursor_shape,
                                img.width,
                                img.height
                            );
                        }
                        Some(CursorInterpolator::new(&recording, &project.cursor))
                    },
                    Err(e) => {
                        log::warn!("[EXPORT] Failed to load cursor recording: {}", e);
                        None
                    },
                }
            } else {
                log::debug!("[EXPORT] Cursor data file not found: {}", cursor_data_path);
                None
            }
        } else {
            None
        }
    } else {
        log::debug!("[EXPORT] Cursor rendering disabled in project settings");
        None
    };

    emit_progress(&app, 0.08, ExportStage::Encoding, "Rendering frames...");

    // Pre-allocate GPU resources reused across all frames (avoids per-frame allocation)
    // Video texture: needs RENDER_ATTACHMENT for NV12 converter writes + COPY_DST for RGBA fallback.
    // view_formats includes Rgba8Unorm so the NV12 converter can write without double-gamma.
    let video_texture = renderer.device().create_texture(&wgpu::TextureDescriptor {
        label: Some("Export Video Frame (reusable)"),
        size: wgpu::Extent3d {
            width: video_w,
            height: video_h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[wgpu::TextureFormat::Rgba8Unorm],
    });
    // NV12 converter: converts NV12 frames to RGBA on GPU with optional crop
    let nv12_converter = Nv12Converter::new(
        renderer.device(),
        renderer.queue(),
        original_width,
        original_height,
    );
    let output_texture = renderer.create_output_texture(composition_w, composition_h);
    // Triple-buffered staging: we read from the buffer submitted 2 iterations
    // ago, giving the GPU two full frame times (~46ms) to finish render + copy.
    // This eliminates both the GPU fence wait (~6.5ms) and ensures readback
    // cost is purely the PCIe data transfer (~7ms).
    let staging_buffers = [
        renderer.create_staging_buffer(composition_w, composition_h),
        renderer.create_staging_buffer(composition_w, composition_h),
        renderer.create_staging_buffer(composition_w, composition_h),
    ];

    // Build constant context for CPU compositing (shared across all frames)
    let cpu_ctx = CpuCompositeCtx {
        composition_w,
        composition_h,
        crop_enabled,
        crop_x: crop.x,
        crop_y: crop.y,
        crop_width: crop.width,
        crop_height: crop.height,
        original_width,
        original_height,
        video_content_bounds,
        cursor_type: project.cursor.cursor_type,
        cursor_scale: project.cursor.scale,
        cursor_motion_blur: project.cursor.motion_blur.clamp(0.0, 1.0),
        cursor_interpolator: cursor_interpolator.as_ref(),
    };

    // Background config is static for the export job; compute once.
    let background_style =
        BackgroundStyle::from_config(&project.export.background, resource_dir.as_deref());
    log::info!(
        "[EXPORT] Background: type={:?}, padding={}, rounding={}",
        background_style.background_type,
        background_style.padding,
        background_style.rounding
    );
    // Track output frames separately from decoded frames
    let job_runner = ExportJobRunner::new(ExportJobRunnerConfig {
        total_output_frames,
        progress_every_sent_frames: 10,
    });

    let mut render_ctx = ExportRenderLoopContext {
        loop_state: ExportLoopState::new(3, 30),
        compositor: &mut compositor,
    };
    let app_ref = &app;
    let project_ref = &project;
    let renderer_ref = &renderer;
    let zoom_interpolator_ref = &zoom_interpolator;
    let scene_interpolator_ref = &scene_interpolator;
    let nv12_converter_ref = &nv12_converter;
    let video_texture_ref = &video_texture;
    let output_texture_ref = &output_texture;
    let staging_buffers_ref = &staging_buffers;
    let background_style_ref = &background_style;
    let timeline_captions_ref = &timeline_captions;
    let prerendered_text_store_ref = &prerendered_text_store;
    let cpu_ctx_ref = &cpu_ctx;
    let encode_tx_ref = &encode_tx;

    // Pipeline with triple-buffered staging (4-stage depth):
    //   1. complete_readback for frame N-2  → ~0ms fence (GPU done 2 iters ago) + data copy
    //   2. GPU render + submit_readback(buf[i]) for frame N
    //   3. CPU composite + encode frame N-3 → overlaps with GPU render of frame N
    // The readback queue holds up to 2 entries; we only complete the oldest
    // (submitted 2 iterations ago, guaranteed complete). This eliminates the
    // GPU fence wait entirely — readback is pure PCIe data transfer.
    // Two-deep readback queue: _old was submitted 2 iters ago, _new was submitted 1 iter ago

    // Render frames from decode pipeline, send to encode pipeline.
    let loop_exit = run_export_loop_with_context(
        &mut decode_rx,
        &mut render_ctx,
        |_| is_export_cancelled(),
        |ctx, bundle| {
            Box::pin(async move {
        let loop_state = &mut ctx.loop_state;
        let app = app_ref;
        let project = project_ref;
        let renderer = renderer_ref;
        let compositor = &mut *ctx.compositor;
        let zoom_interpolator = zoom_interpolator_ref;
        let scene_interpolator = scene_interpolator_ref;
        let nv12_converter = nv12_converter_ref;
        let video_texture = video_texture_ref;
        let output_texture = output_texture_ref;
        let staging_buffers = staging_buffers_ref;
        let background_style = background_style_ref;
        let timeline_captions = timeline_captions_ref;
        let prerendered_text_store = prerendered_text_store_ref;
        let cpu_ctx = cpu_ctx_ref;
        let encode_tx = encode_tx_ref;
        loop_state
            .timing
            .add_decode_us(loop_state.t_decode_start.elapsed().as_micros() as u64);

        // === Complete readback for frame N-2 (submitted 2 iterations ago) ===
        // With triple-buffered staging, the oldest entry was submitted ~46ms ago.
        // The GPU is guaranteed to be done - readback is pure PCIe data transfer
        // with zero fence wait. Runs BEFORE any new GPU submissions so poll(Wait)
        // doesn't block on freshly-enqueued work.
        let t_readback_start = std::time::Instant::now();
        if loop_state
            .promote_oldest_readback_to_pending_cpu(|staging_buf_idx| {
                renderer.complete_readback(
                    &staging_buffers[staging_buf_idx],
                    composition_w,
                    composition_h,
                )
            })
            .await
        {
            loop_state
                .timing
                .add_readback_us(t_readback_start.elapsed().as_micros() as u64);
        }

        let decoded_frame_idx = bundle.frame_idx;
        let current_webcam_frame = bundle.webcam_frame;

        let frame_timeline = build_frame_timeline_context(
            decode_start_ms,
            decoded_frame_idx,
            loop_state.output_frame_count,
            fps,
            &project.timeline,
            has_segments,
        );
        let source_time_ms = frame_timeline.source_time_ms;
        let relative_time_ms = frame_timeline.relative_time_ms;

        // Skip decoded frames that fall in deleted regions.
        if frame_timeline.should_skip {
            loop_state.t_decode_start = std::time::Instant::now();
            return Ok(ExportLoopDirective::Continue);
        }

        // Use output frame index for user-defined timeline effects (zoom, scene, text, captions).
        // Why: when kept segment lengths are not exact frame multiples, source->timeline mapping
        // can be ahead/behind encoded frame pacing by up to ~1 frame per cut boundary.
        // Frame-index timing stays locked to what is actually encoded.
        // Use source_time_ms for recorded data (cursor position).
        let frame_scene = build_frame_scene_context(
            relative_time_ms,
            source_time_ms,
            zoom_interpolator,
            scene_interpolator,
            |source_time_ms| {
                cpu_ctx.cursor_interpolator.map(|interp| {
                    let cursor = interp.get_cursor_at(source_time_ms);
                    (cursor.x as f64, cursor.y as f64)
                })
            },
            |timeline_time_ms| is_webcam_visible_at(project, timeline_time_ms),
        );
        let zoom_state = frame_scene.zoom_state;
        let interpolated_scene = frame_scene.interpolated_scene;
        let webcam_visible = frame_scene.webcam_visible;
        let camera_only_opacity = frame_scene.camera_only_opacity;
        let regular_camera_opacity = frame_scene.regular_camera_opacity;
        let is_in_camera_only_transition = frame_scene.in_camera_only_transition;

        // Apply source normalization BEFORE composition:
        // - With user crop: RGBA path crops on CPU (NV12 crop happens in converter).
        // - Without user crop: odd-sized RGBA sources are cropped to even export source size.
        let prepared_frame = prepare_base_screen_frame(PrepareFrameRequest {
            screen_frame: bundle.screen_frame,
            crop_enabled,
            crop: CropRectPlan {
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
            },
            force_even_source_crop,
            video_width: video_w,
            video_height: video_h,
            camera_only_opacity,
            has_webcam_frame: current_webcam_frame.is_some(),
        });
        let screen_frame = prepared_frame.screen_frame;
        let frame_path = prepared_frame.frame_path;
        let is_nv12 = prepared_frame.is_nv12;
        let use_nv12_gpu_path = prepared_frame.use_nv12_gpu_path;

        // Log first few frames for debugging
        if should_log_frame_debug(loop_state.output_frame_count, relative_time_ms) {
            log::debug!(
                "[EXPORT] Frame {}: timeline={}ms, source={}ms, scene_mode={:?}, transition_progress={:.2}",
                loop_state.output_frame_count,
                relative_time_ms,
                source_time_ms,
                interpolated_scene.scene_mode,
                interpolated_scene.transition_progress
            );
        }

        // Log transition state for debugging
        if should_log_camera_transition_debug(
            loop_state.output_frame_count,
            is_in_camera_only_transition,
        ) {
            log::debug!(
                "[EXPORT] Frame {}: cameraOnly transition - camera_only_opacity={:.2}, regular_camera_opacity={:.2}, screen_blur={:.2}",
                loop_state.output_frame_count, camera_only_opacity, regular_camera_opacity, interpolated_scene.screen_blur
            );
        }

        // Build the frame to render with proper blending.
        // NV12 fast path: for the common case (no camera-only transition), we skip
        // CPU frame manipulation entirely — the NV12 converter writes directly to GPU.
        // Camera-only transitions need RGBA for CPU blending (rare, ~1s per transition).
        // Run NV12→RGBA GPU conversion NOW, before screen_frame is moved.
        // This writes RGBA into video_texture; the compositor reads it later.
        if use_nv12_gpu_path {
            let gpu_crop = prepared_frame.nv12_gpu_crop.map(|c| CropRect {
                x: c.x,
                y: c.y,
                width: c.width,
                height: c.height,
            });
            nv12_converter.convert(&screen_frame.data, &video_texture, gpu_crop);
        }

        let render_plan = plan_frame_render(
            interpolated_scene.scene_mode,
            frame_path,
            webcam_visible,
            regular_camera_opacity,
        );
        let composition = build_frame_composition(FrameCompositionRequest {
            project,
            render_plan,
            screen_frame,
            webcam_frame: current_webcam_frame.as_ref(),
            is_nv12,
            use_nv12_gpu_path,
            camera_only_opacity,
            crop_enabled,
            crop: CropRectPlan {
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
            },
            video_width: video_w,
            video_height: video_h,
            composition_width: composition_w,
            composition_height: composition_h,
        });
        let frame_to_render = composition.frame_to_render;
        let webcam_overlay = composition.webcam_overlay;

        let overlay_plan = build_frame_overlay_plan(FrameOverlayRequest {
            relative_time_ms,
            composition_width: composition_w,
            composition_height: composition_h,
            use_manual_composition,
            zoom_state,
            webcam_overlay,
            background_style,
            timeline_captions,
            caption_settings: &project.captions,
        });
        let render_options = overlay_plan.render_options;
        let frame_time_secs = overlay_plan.frame_time_secs;
        let prepared_captions = overlay_plan.prepared_captions;

        // Get GPU-ready text overlay quads for this frame.
        // Text coordinates are normalized 0-1 relative to the video content area,
        // positions are returned in NDC for direct GPU rendering.
        let text_overlay_quads = {
            let store = prerendered_text_store.lock();
            build_frame_text_overlay_quads(
                &store,
                FrameTextOverlayRequest {
                    frame_time_secs,
                    text_segments: &project.text.segments,
                    composition_width: composition_w,
                    composition_height: composition_h,
                    video_frame_x: composition_bounds.frame_x as u32,
                    video_frame_y: composition_bounds.frame_y as u32,
                    video_frame_width: composition_bounds.frame_width as u32,
                    video_frame_height: composition_bounds.frame_height as u32,
                    zoom_state,
                },
            )
        };

        // === GPU submit phase (non-blocking) ===
        let t_gpu_start = std::time::Instant::now();

        // Composite: base frame (background, video, webcam) + captions (glyphon)
        // NV12 path: video_texture was already populated by nv12_converter above.
        // RGBA path: compositor uploads frame_to_render into video_texture.
        compositor
            .composite_with_text_into(
                &renderer,
                &video_texture,
                frame_to_render.as_ref(),
                &output_texture,
                &render_options,
                relative_time_ms as f32,
                &prepared_captions,
            )
            .await;

        // Render pre-rendered text overlays on GPU (after video/captions, before readback)
        compositor.render_text_overlays(&output_texture, &text_overlay_quads);

        // Submit readback copy command (non-blocking — GPU will execute asynchronously)
        renderer.submit_readback(
            &output_texture,
            &staging_buffers[loop_state.buf_idx],
            composition_w,
            composition_h,
        );

        loop_state
            .timing
            .add_gpu_us(t_gpu_start.elapsed().as_micros() as u64);

        // === CPU phase: process frame N-2 (pending_cpu) while GPU works on frame N ===
        if let Some(mut prev) = loop_state.pending_cpu.take() {
            let t_cpu_start = std::time::Instant::now();
            apply_cpu_compositing(&mut prev, &cpu_ctx);
            loop_state
                .timing
                .add_cpu_us(t_cpu_start.elapsed().as_micros() as u64);

            let t_encode_start = std::time::Instant::now();
            if encode_tx.send(prev.rgba_data).await.is_err() {
                log::error!("[EXPORT] Encode channel closed unexpectedly");
                return Ok(ExportLoopDirective::Stop);
            }
            loop_state
                .timing
                .add_encode_us(t_encode_start.elapsed().as_micros() as u64);

            // Progress update (every 10 frames, based on frames sent to encoder)
            let sent_count = prev.output_frame_idx + 1;
            job_runner.on_frame_sent(sent_count, |progress| {
                emit_progress(
                    &app,
                    progress.stage_progress,
                    ExportStage::Encoding,
                    &format!("Rendering: {}%", progress.percent),
                );
            });
        }

        // Shift readback queue: new → old, current frame → new
        loop_state.enqueue_submitted_readback(camera_only_opacity, source_time_ms, zoom_state);

        loop_state.output_frame_count += 1;
        if let Some(summary) = loop_state.timing.finish_frame() {
            log::info!(
                "[EXPORT] Frame timing (avg over {}): decode={:.1}ms gpu={:.1}ms cpu={:.1}ms readback={:.1}ms encode={:.1}ms total={:.1}ms",
                summary.frame_count,
                summary.decode_ms,
                summary.gpu_ms,
                summary.cpu_ms,
                summary.readback_ms,
                summary.encode_ms,
                summary.total_ms,
            );
        }

        // Check if we've read back enough frames
        if matches!(
            job_runner.loop_control(loop_state.output_frame_count, false),
            LoopControl::StopTargetReached
        ) {
            return Ok(ExportLoopDirective::Stop);
        }

        // Reset decode timer for next iteration's recv() wait
        loop_state.t_decode_start = std::time::Instant::now();
        Ok(ExportLoopDirective::Continue)
            })
        },
    )
    .await?;
    if matches!(loop_exit, ExportLoopExit::Cancelled) {
        log::info!("[EXPORT] Export cancelled by user");
    }

    // Drain pipeline: up to 3 frames may still be in-flight.
    // pending_cpu: readback done, needs CPU composite + encode
    // pending_readback_old: needs complete_readback + CPU composite + encode
    // pending_readback_new: needs complete_readback + CPU composite + encode
    let _ = drain_pipeline_if_needed(
        &mut render_ctx.loop_state,
        job_runner.should_drain_after_loop(is_export_cancelled()),
        |staging_buf_idx| {
            renderer.complete_readback(
                &staging_buffers[staging_buf_idx],
                composition_w,
                composition_h,
            )
        },
        |mut cpu_work| async {
            apply_cpu_compositing(&mut cpu_work, &cpu_ctx);
            let _ = encode_tx.send(cpu_work.rgba_data).await;
        },
    )
    .await;

    // Check if export was cancelled
    let was_cancelled = is_export_cancelled();

    // Signal end of render loop and wait for encode to finish
    drop(encode_tx);

    if was_cancelled {
        // Wait for pipeline tasks to complete
        drop(decode_rx);
        let cancelled_summary =
            finalize_cancelled_export(decode_handle, encode_handle, &mut ffmpeg, &output_path)
                .await;
        for warning in cancelled_summary.pipeline_warnings {
            log::warn!(
                "[EXPORT] {} task issue during cancel: {}",
                warning.stage,
                warning.message
            );
        }

        if cancelled_summary.removed_partial_output {
            log::info!("[EXPORT] Deleted partial output file: {:?}", output_path);
        }

        emit_progress(&app, 0.0, ExportStage::Complete, "Export cancelled");

        return Err("Export cancelled by user".to_string());
    }

    emit_progress(
        &app,
        FINALIZING_PROGRESS,
        ExportStage::Finalizing,
        "Finalizing...",
    );

    let completed_summary = match finalize_completed_export(
        decode_handle,
        encode_handle,
        &mut ffmpeg,
        &output_path,
        20,
    )
    .await
    {
        Ok(summary) => summary,
        Err(EncoderFinalizeError::Wait(msg)) => return Err(msg),
        Err(EncoderFinalizeError::Metadata(msg)) => return Err(msg),
        Err(EncoderFinalizeError::EncodeFailure(failure)) => {
            if let Some(tail) = failure.stderr_tail {
                log::error!("[EXPORT] FFmpeg stderr (last 20 lines):\n{}", tail);
            }
            return Err(format!(
                "FFmpeg encoding failed with status: {:?}",
                failure.status_code
            ));
        },
    };
    for warning in completed_summary.pipeline_warnings {
        log::warn!("[EXPORT] {} task issue: {}", warning.stage, warning.message);
    }
    let file_size_bytes = completed_summary.file_size_bytes;

    emit_progress(&app, 1.0, ExportStage::Complete, "Export complete!");

    log::info!(
        "[EXPORT] Complete in {:.1}s: {} bytes",
        start_time.elapsed().as_secs_f32(),
        file_size_bytes
    );

    Ok(ExportResult {
        output_path: output_path.to_string_lossy().to_string(),
        duration_secs,
        file_size_bytes,
        format: project.export.format,
    })
}
