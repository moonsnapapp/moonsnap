//! GPU-based video export pipeline.
//!
//! Like Cap, we:
//! 1. Decode frames with FFmpeg (streaming - ONE process, not per-frame)
//! 2. Render on GPU with zoom/webcam effects
//! 3. Pipe rendered RGBA frames to FFmpeg for encoding only

mod encoder_selection;
mod ffmpeg;
mod frame_ops;
mod pipeline;
mod webcam;

pub use encoder_selection::is_nvenc_available;
use pipeline::{spawn_decode_task, spawn_encode_task};

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Manager};

/// Global cancel flag for export. Set via `request_cancel_export()`.
static EXPORT_CANCEL_FLAG: OnceLock<Arc<AtomicBool>> = OnceLock::new();

fn cancel_flag() -> &'static Arc<AtomicBool> {
    EXPORT_CANCEL_FLAG.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

/// Request cancellation of the currently running export.
pub fn request_cancel_export() {
    cancel_flag().store(true, Ordering::Relaxed);
    log::info!("[EXPORT] Cancel requested");
}

use super::caption_layer::prepare_captions;
use super::compositor::Compositor;
use super::cursor::{
    composite_cursor, composite_cursor_with_motion_blur, CursorInterpolator, VideoContentBounds,
};
use super::nv12_converter::{CropRect, Nv12Converter};
use super::prerendered_text::{composite_prerendered_texts, TextCompositeInfo};
use super::renderer::Renderer;
use super::scene::SceneInterpolator;
use super::stream_decoder::StreamDecoder;
use super::svg_cursor::get_svg_cursor;
use super::types::{BackgroundStyle, PixelFormat, RenderOptions, ZoomState};
use super::zoom::ZoomInterpolator;
use crate::commands::captions::types::CaptionSegment;
use crate::commands::text_prerender::PreRenderedTextState;
use crate::commands::video_recording::cursor::events::load_cursor_recording;
use crate::commands::video_recording::cursor::events::WindowsCursorShape;
use crate::commands::video_recording::video_export::{ExportResult, ExportStage};
use crate::commands::video_recording::video_project::{
    CompositionMode, CursorType, SceneMode, TimelineState, VideoProject,
};

// Re-export submodule functions used externally
pub use ffmpeg::emit_progress;
pub use frame_ops::draw_cursor_circle;
pub use webcam::{build_webcam_overlay, is_webcam_visible_at};

use ffmpeg::start_ffmpeg_encoder;
use frame_ops::{blend_frames_alpha, crop_decoded_frame, scale_frame_to_fill};

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

/// Per-frame state for deferred CPU compositing (double-buffer pipeline).
struct PendingCpuWork {
    rgba_data: Vec<u8>,
    prerendered_texts: Vec<TextCompositeInfo>,
    camera_only_opacity: f64,
    source_time_ms: u64,
    zoom_state: ZoomState,
    output_frame_idx: u32,
}

/// Metadata for a frame whose GPU readback is still in-flight.
/// Used by the double-buffered staging pipeline: while the GPU copies frame N
/// into staging buffer A, we can safely read the completed copy of frame N-1
/// from staging buffer B.
struct PendingReadback {
    staging_buf_idx: usize,
    prerendered_texts: Vec<TextCompositeInfo>,
    camera_only_opacity: f64,
    source_time_ms: u64,
    zoom_state: ZoomState,
    output_frame_idx: u32,
}

/// Apply the same zoom transform used by the compositor shader to normalized cursor coordinates.
/// This keeps CPU cursor compositing aligned with GPU-zoomed video content.
fn apply_zoom_to_cursor_position(x: f32, y: f32, zoom: ZoomState) -> (f32, f32) {
    if zoom.scale <= 1.0 {
        return (x, y);
    }

    let s = zoom.scale;
    let x_zoomed = 0.5 - (zoom.center_x - 0.5) * (s - 1.0) + (x - 0.5) * s;
    let y_zoomed = 0.5 - (zoom.center_y - 0.5) * (s - 1.0) + (y - 0.5) * s;
    (x_zoomed, y_zoomed)
}

/// NV12 fast path requires even dimensions for stable chroma sampling/strides.
/// Also require even crop alignment when crop is active.
fn can_use_nv12_fast_path(
    source_width: u32,
    source_height: u32,
    crop_enabled: bool,
    crop_x: u32,
    crop_y: u32,
    crop_width: u32,
    crop_height: u32,
) -> bool {
    let even_source = source_width % 2 == 0 && source_height % 2 == 0;
    if !even_source {
        return false;
    }

    if !crop_enabled {
        return true;
    }

    crop_x % 2 == 0 && crop_y % 2 == 0 && crop_width % 2 == 0 && crop_height % 2 == 0
}

/// Apply CPU-based compositing (cursor + pre-rendered text overlays) to a pending frame.
///
/// Extracted from the render loop to enable double-buffered pipeline overlap:
/// GPU renders frame N+1 while CPU processes frame N.
fn apply_cpu_compositing(pending: &mut PendingCpuWork, ctx: &CpuCompositeCtx) {
    // Composite pre-rendered text overlays (CPU-based, WYSIWYG matching CSS preview)
    if !pending.prerendered_texts.is_empty() {
        composite_prerendered_texts(
            &mut pending.rgba_data,
            ctx.composition_w,
            ctx.composition_h,
            &pending.prerendered_texts,
        );
    }

    // Composite cursor onto frame (CPU-based) if cursor is visible and not in cameraOnly mode
    if let Some(cursor_interp) = ctx.cursor_interpolator {
        if pending.camera_only_opacity < 0.99 {
            let mut cursor = cursor_interp.get_cursor_at(pending.source_time_ms);

            // Transform cursor position for crop
            let mut cursor_visible = true;
            if ctx.crop_enabled {
                let orig_w = ctx.original_width as f32;
                let orig_h = ctx.original_height as f32;
                let crop_x = ctx.crop_x as f32;
                let crop_y = ctx.crop_y as f32;
                let crop_w = ctx.crop_width as f32;
                let crop_h = ctx.crop_height as f32;

                let cursor_px_x = cursor.x * orig_w;
                let cursor_px_y = cursor.y * orig_h;
                cursor.x = (cursor_px_x - crop_x) / crop_w;
                cursor.y = (cursor_px_y - crop_y) / crop_h;

                if cursor.x < -0.1 || cursor.x > 1.1 || cursor.y < -0.1 || cursor.y > 1.1 {
                    cursor_visible = false;
                }
            }

            if cursor_visible {
                // Match compositor shader zoom math so cursor tracks zoomed video precisely.
                let (zoomed_x, zoomed_y) =
                    apply_zoom_to_cursor_position(cursor.x, cursor.y, pending.zoom_state);
                cursor.x = zoomed_x;
                cursor.y = zoomed_y;

                if ctx.cursor_type == CursorType::Circle {
                    draw_cursor_circle(
                        &mut pending.rgba_data,
                        ctx.composition_w,
                        ctx.composition_h,
                        &ctx.video_content_bounds,
                        cursor.x,
                        cursor.y,
                        ctx.cursor_scale,
                        cursor.opacity,
                    );
                } else {
                    let mut rendered = false;

                    let base_cursor_height = 24.0;
                    let reference_height = 720.0;
                    let size_scale = ctx.composition_h as f32 / reference_height;
                    let final_cursor_height =
                        (base_cursor_height * size_scale * ctx.cursor_scale).clamp(16.0, 256.0);

                    if let Some(shape) = cursor.cursor_shape {
                        let target_height = final_cursor_height.round() as u32;

                        if let Some(svg_cursor) = get_svg_cursor(shape, target_height) {
                            let svg_decoded = super::cursor::DecodedCursorImage {
                                width: svg_cursor.width,
                                height: svg_cursor.height,
                                hotspot_x: svg_cursor.hotspot_x,
                                hotspot_y: svg_cursor.hotspot_y,
                                data: svg_cursor.data,
                            };
                            if ctx.cursor_motion_blur > 0.0 {
                                composite_cursor_with_motion_blur(
                                    &mut pending.rgba_data,
                                    ctx.composition_w,
                                    ctx.composition_h,
                                    &ctx.video_content_bounds,
                                    &cursor,
                                    &svg_decoded,
                                    1.0,
                                    ctx.cursor_motion_blur,
                                );
                            } else {
                                composite_cursor(
                                    &mut pending.rgba_data,
                                    ctx.composition_w,
                                    ctx.composition_h,
                                    &ctx.video_content_bounds,
                                    &cursor,
                                    &svg_decoded,
                                    1.0,
                                );
                            }
                            rendered = true;
                        }
                    }

                    if !rendered {
                        if let Some(ref cursor_id) = cursor.cursor_id {
                            if let Some(cursor_image) = cursor_interp.get_cursor_image(cursor_id) {
                                let bitmap_scale = final_cursor_height / cursor_image.height as f32;
                                if ctx.cursor_motion_blur > 0.0 {
                                    composite_cursor_with_motion_blur(
                                        &mut pending.rgba_data,
                                        ctx.composition_w,
                                        ctx.composition_h,
                                        &ctx.video_content_bounds,
                                        &cursor,
                                        cursor_image,
                                        bitmap_scale,
                                        ctx.cursor_motion_blur,
                                    );
                                } else {
                                    composite_cursor(
                                        &mut pending.rgba_data,
                                        ctx.composition_w,
                                        ctx.composition_h,
                                        &ctx.video_content_bounds,
                                        &cursor,
                                        cursor_image,
                                        bitmap_scale,
                                    );
                                }
                                rendered = true;
                            }
                        }
                    }

                    // Final fallback: default arrow SVG, matching preview behavior.
                    if !rendered {
                        let target_height = final_cursor_height.round() as u32;
                        if let Some(svg_cursor) =
                            get_svg_cursor(WindowsCursorShape::Arrow, target_height)
                        {
                            let svg_decoded = super::cursor::DecodedCursorImage {
                                width: svg_cursor.width,
                                height: svg_cursor.height,
                                hotspot_x: svg_cursor.hotspot_x,
                                hotspot_y: svg_cursor.hotspot_y,
                                data: svg_cursor.data,
                            };
                            if ctx.cursor_motion_blur > 0.0 {
                                composite_cursor_with_motion_blur(
                                    &mut pending.rgba_data,
                                    ctx.composition_w,
                                    ctx.composition_h,
                                    &ctx.video_content_bounds,
                                    &cursor,
                                    &svg_decoded,
                                    1.0,
                                    ctx.cursor_motion_blur,
                                );
                            } else {
                                composite_cursor(
                                    &mut pending.rgba_data,
                                    ctx.composition_w,
                                    ctx.composition_h,
                                    &ctx.video_content_bounds,
                                    &cursor,
                                    &svg_decoded,
                                    1.0,
                                );
                            }
                        }
                    }
                }
            }
        }
    }
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
    cancel_flag().store(false, Ordering::Relaxed);

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
    prerendered_text_store.lock().log_summary();

    emit_progress(&app, 0.02, ExportStage::Preparing, "Loading video...");

    // Calculate export parameters
    let fps = project.export.fps;
    let original_width = project.sources.original_width;
    let original_height = project.sources.original_height;

    // Use effective duration (respects trim segments)
    let effective_duration_ms = project.timeline.effective_duration_ms();
    let duration_secs = effective_duration_ms as f64 / 1000.0;
    let total_output_frames = ((effective_duration_ms as f64 / 1000.0) * fps as f64).ceil() as u32;

    // Get decode range (first segment start to last segment end, or in/out points)
    let (decode_start_ms, decode_end_ms) = project.timeline.decode_range();
    let has_segments = !project.timeline.segments.is_empty();

    // Calculate how many frames to decode (may be more than output when there are gaps)
    let decode_duration_ms = decode_end_ms - decode_start_ms;
    let total_decode_frames = ((decode_duration_ms as f64 / 1000.0) * fps as f64).ceil() as u32;

    log::info!(
        "[EXPORT] Timeline: effective_duration={}ms, decode_range={}ms-{}ms, segments={}, decode_frames={}, output_frames={}",
        effective_duration_ms,
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
    let padding = if project.export.background.enabled {
        project.export.background.padding as u32
    } else {
        0
    };

    // Step 1: Determine video dimensions after crop
    let crop_enabled = crop.enabled && crop.width > 0 && crop.height > 0;
    let (video_w, video_h) = if crop_enabled {
        // Video crop is applied - use crop dimensions
        let crop_w = (crop.width / 2) * 2;
        let crop_h = (crop.height / 2) * 2;
        log::info!(
            "[EXPORT] Video crop enabled: {}x{} at ({}, {})",
            crop_w,
            crop_h,
            crop.x,
            crop.y
        );
        (crop_w, crop_h)
    } else {
        // No crop - use original video dimensions
        let w = (original_width / 2) * 2;
        let h = (original_height / 2) * 2;
        (w, h)
    };

    // Step 2: Calculate composition (output) dimensions based on composition mode
    let (composition_w, composition_h) = match composition.mode {
        CompositionMode::Auto => {
            // Auto mode: composition matches video crop + padding
            let w = ((video_w + padding * 2) / 2) * 2;
            let h = ((video_h + padding * 2) / 2) * 2;
            log::info!(
                "[EXPORT] Auto composition: {}x{} (video {}x{} + padding {})",
                w,
                h,
                video_w,
                video_h,
                padding
            );
            (w, h)
        },
        CompositionMode::Manual => {
            // Manual mode: check for fixed dimensions first, then aspect ratio
            log::info!(
                "[EXPORT] Manual mode - checking fixed dimensions: width={:?}, height={:?}",
                composition.width,
                composition.height
            );
            if let (Some(fixed_w), Some(fixed_h)) = (composition.width, composition.height) {
                // Fixed dimensions specified - use them directly
                let w = (fixed_w / 2) * 2; // Ensure even
                let h = (fixed_h / 2) * 2;
                log::info!(
                    "[EXPORT] Manual composition (fixed): {}x{} (requested {}x{})",
                    w,
                    h,
                    fixed_w,
                    fixed_h
                );
                (w, h)
            } else if let Some(target_ratio) = composition.aspect_ratio {
                // Calculate composition size that fits the video at the target aspect ratio
                let video_ratio = video_w as f32 / video_h as f32;

                let (comp_w, comp_h) = if target_ratio > video_ratio {
                    // Composition is wider than video - video height determines composition height
                    // Add padding to video, then calculate width from aspect ratio
                    let h = video_h + padding * 2;
                    let w = (h as f32 * target_ratio) as u32;
                    (w, h)
                } else {
                    // Composition is taller than video - video width determines composition width
                    // Add padding to video, then calculate height from aspect ratio
                    let w = video_w + padding * 2;
                    let h = (w as f32 / target_ratio) as u32;
                    (w, h)
                };

                // Ensure even dimensions
                let w = (comp_w / 2) * 2;
                let h = (comp_h / 2) * 2;

                log::info!(
                    "[EXPORT] Manual composition: {}x{} (ratio {:.3}, video {}x{})",
                    w,
                    h,
                    target_ratio,
                    video_w,
                    video_h
                );
                (w, h)
            } else {
                // No aspect ratio specified, fall back to auto
                let w = ((video_w + padding * 2) / 2) * 2;
                let h = ((video_h + padding * 2) / 2) * 2;
                log::info!(
                    "[EXPORT] Manual composition (no ratio): {}x{} (video {}x{} + padding {})",
                    w,
                    h,
                    video_w,
                    video_h,
                    padding
                );
                (w, h)
            }
        },
    };

    // Output dimensions = composition dimensions
    let out_w = composition_w;
    let out_h = composition_h;

    // Compute export-equivalent video content bounds once.
    // Cursor and pre-rendered text overlays must use the exact same frame bounds
    // as compositor composition to keep preview/export parity.
    let composition_bounds = super::parity::calculate_composition_bounds(
        video_w as f32,
        video_h as f32,
        padding as f32,
        if matches!(composition.mode, CompositionMode::Manual) {
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
    let screen_path = Path::new(&project.sources.screen_video);
    let use_nv12_decode = can_use_nv12_fast_path(
        original_width,
        original_height,
        crop_enabled,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
    );
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

    // Webcam decoder if enabled
    let webcam_decoder = if project.webcam.enabled {
        if let Some(ref path) = project.sources.webcam_video {
            let webcam_path = Path::new(path);
            if webcam_path.exists() {
                let mut decoder = StreamDecoder::new(webcam_path, decode_start_ms, decode_end_ms)?;
                decoder.start(webcam_path)?;
                Some(decoder)
            } else {
                None
            }
        } else {
            None
        }
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
    let mut buf_idx = 0usize;

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
    // No-crop area captures can have odd source dimensions. Crop to the export
    // video size once per frame so RGBA uploads match the pre-allocated texture.
    let force_even_source_crop =
        !crop_enabled && (original_width != video_w || original_height != video_h);

    // Track output frames separately from decoded frames
    let mut output_frame_count = 0u32;

    // Per-frame timing instrumentation (aggregated every 30 frames)
    let mut timing_decode_us = 0u64;
    let mut timing_gpu_us = 0u64;
    let mut timing_cpu_us = 0u64;
    let mut timing_readback_us = 0u64;
    let mut timing_encode_us = 0u64;
    let mut timing_frame_count = 0u32;

    // Pipeline with triple-buffered staging (4-stage depth):
    //   1. complete_readback for frame N-2  → ~0ms fence (GPU done 2 iters ago) + data copy
    //   2. GPU render + submit_readback(buf[i]) for frame N
    //   3. CPU composite + encode frame N-3 → overlaps with GPU render of frame N
    // The readback queue holds up to 2 entries; we only complete the oldest
    // (submitted 2 iterations ago, guaranteed complete). This eliminates the
    // GPU fence wait entirely — readback is pure PCIe data transfer.
    let mut pending_cpu: Option<PendingCpuWork> = None;
    // Two-deep readback queue: _old was submitted 2 iters ago, _new was submitted 1 iter ago
    let mut pending_readback_old: Option<PendingReadback> = None;
    let mut pending_readback_new: Option<PendingReadback> = None;

    // Render frames from decode pipeline, send to encode pipeline
    let mut t_decode_start = std::time::Instant::now();
    while let Some(bundle) = decode_rx.recv().await {
        timing_decode_us += t_decode_start.elapsed().as_micros() as u64;
        // Check for cancellation
        if cancel_flag().load(Ordering::Relaxed) {
            log::info!("[EXPORT] Export cancelled by user");
            break;
        }

        // === Complete readback for frame N-2 (submitted 2 iterations ago) ===
        // With triple-buffered staging, the oldest entry was submitted ~46ms ago.
        // The GPU is guaranteed to be done — readback is pure PCIe data transfer
        // with zero fence wait. Runs BEFORE any new GPU submissions so poll(Wait)
        // doesn't block on freshly-enqueued work.
        if let Some(oldest_rb) = pending_readback_old.take() {
            let t_readback_start = std::time::Instant::now();
            let rgba_data = renderer
                .complete_readback(
                    &staging_buffers[oldest_rb.staging_buf_idx],
                    composition_w,
                    composition_h,
                )
                .await;
            timing_readback_us += t_readback_start.elapsed().as_micros() as u64;

            pending_cpu = Some(PendingCpuWork {
                rgba_data,
                prerendered_texts: oldest_rb.prerendered_texts,
                camera_only_opacity: oldest_rb.camera_only_opacity,
                source_time_ms: oldest_rb.source_time_ms,
                zoom_state: oldest_rb.zoom_state,
                output_frame_idx: oldest_rb.output_frame_idx,
            });
        }

        let decoded_frame_idx = bundle.frame_idx;
        let current_webcam_frame = bundle.webcam_frame;

        // Calculate source time for this decoded frame
        let source_time_ms =
            decode_start_ms + ((decoded_frame_idx as f64 / fps as f64) * 1000.0) as u64;

        // Skip decoded frames that fall in deleted regions.
        if has_segments
            && project
                .timeline
                .source_to_timeline(source_time_ms)
                .is_none()
        {
            continue;
        }

        // Apply source normalization BEFORE composition:
        // - With user crop: RGBA path crops on CPU (NV12 crop happens in converter).
        // - Without user crop: odd-sized RGBA sources are cropped to even export source size.
        let mut screen_frame = bundle.screen_frame;
        if screen_frame.format == PixelFormat::Rgba {
            if crop_enabled {
                screen_frame =
                    crop_decoded_frame(&screen_frame, crop.x, crop.y, crop.width, crop.height);
            } else if force_even_source_crop {
                screen_frame = crop_decoded_frame(&screen_frame, 0, 0, video_w, video_h);
            }
        }

        // Use output frame index for user-defined timeline effects (zoom, scene, text, captions).
        // Why: when kept segment lengths are not exact frame multiples, source->timeline mapping
        // can be ahead/behind encoded frame pacing by up to ~1 frame per cut boundary.
        // Frame-index timing stays locked to what is actually encoded.
        // Use source_time_ms for recorded data (cursor position).
        let relative_time_ms = ((output_frame_count as f64 / fps as f64) * 1000.0).round() as u64;

        // Get cursor position using SOURCE time (cursor data is recorded in source time)
        // This ensures cursor appears at correct position even after trimming
        let cursor_pos_for_zoom = cursor_interpolator.as_ref().map(|interp| {
            let cursor = interp.get_cursor_at(source_time_ms);
            (cursor.x as f64, cursor.y as f64)
        });

        // Scene segments and zoom regions use RELATIVE time (timeline position)
        // Pass cursor position so Auto zoom mode can follow cursor
        let zoom_state =
            zoom_interpolator.get_zoom_at_with_cursor(relative_time_ms, cursor_pos_for_zoom);
        let interpolated_scene = scene_interpolator.get_scene_at(relative_time_ms);
        let webcam_visible = is_webcam_visible_at(&project, relative_time_ms);

        // Log first few frames for debugging
        if output_frame_count < 3 || (6000..=6200).contains(&relative_time_ms) {
            log::debug!(
                "[EXPORT] Frame {}: timeline={}ms, source={}ms, scene_mode={:?}, transition_progress={:.2}",
                output_frame_count,
                relative_time_ms,
                source_time_ms,
                interpolated_scene.scene_mode,
                interpolated_scene.transition_progress
            );
        }

        // Determine what to render based on interpolated scene values
        // This handles smooth transitions between scene modes
        let camera_only_opacity = interpolated_scene.camera_only_transition_opacity();
        let regular_camera_opacity = interpolated_scene.regular_camera_transition_opacity();
        let is_in_camera_only_transition = interpolated_scene.is_transitioning_camera_only();

        // Log transition state for debugging
        if is_in_camera_only_transition && output_frame_count.is_multiple_of(10) {
            log::debug!(
                "[EXPORT] Frame {}: cameraOnly transition - camera_only_opacity={:.2}, regular_camera_opacity={:.2}, screen_blur={:.2}",
                output_frame_count, camera_only_opacity, regular_camera_opacity, interpolated_scene.screen_blur
            );
        }

        // Build the frame to render with proper blending.
        // NV12 fast path: for the common case (no camera-only transition), we skip
        // CPU frame manipulation entirely — the NV12 converter writes directly to GPU.
        // Camera-only transitions need RGBA for CPU blending (rare, ~1s per transition).
        let is_nv12 = screen_frame.format == PixelFormat::Nv12;

        // Determine if we need the NV12 GPU path or RGBA fallback.
        let needs_rgba_blend = camera_only_opacity > 0.01
            && camera_only_opacity <= 0.99
            && current_webcam_frame.is_some();
        let needs_fullscreen_webcam = camera_only_opacity > 0.99 && current_webcam_frame.is_some();
        let use_nv12_gpu_path = is_nv12 && !needs_rgba_blend && !needs_fullscreen_webcam;

        // Run NV12→RGBA GPU conversion NOW, before screen_frame is moved.
        // This writes RGBA into video_texture; the compositor reads it later.
        if use_nv12_gpu_path {
            let gpu_crop = if crop_enabled {
                Some(CropRect {
                    x: crop.x,
                    y: crop.y,
                    width: crop.width,
                    height: crop.height,
                })
            } else {
                None
            };
            nv12_converter.convert(&screen_frame.data, &video_texture, gpu_crop);
        }

        let (frame_to_render, webcam_overlay) = if needs_fullscreen_webcam {
            // Fully in cameraOnly mode - just show fullscreen webcam
            let webcam_frame = current_webcam_frame.as_ref().unwrap();
            let scaled_frame = scale_frame_to_fill(webcam_frame, video_w, video_h);
            (Some(scaled_frame), None)
        } else if needs_rgba_blend {
            // In cameraOnly transition - blend screen and fullscreen webcam.
            // CPU blending requires RGBA, so convert NV12 frames if needed.
            let webcam_frame = current_webcam_frame.as_ref().unwrap();
            let rgba_screen = if is_nv12 {
                let rgba = screen_frame.to_rgba();
                // NV12 frames skipped CPU crop earlier, apply it now
                if crop_enabled {
                    crop_decoded_frame(&rgba, crop.x, crop.y, crop.width, crop.height)
                } else {
                    rgba
                }
            } else {
                screen_frame.clone()
            };
            let mut blended_frame = rgba_screen;

            // Scale webcam to fill video area (matches screen dimensions)
            let fullscreen_webcam = scale_frame_to_fill(webcam_frame, video_w, video_h);

            // Blend fullscreen webcam over screen with camera_only_opacity
            blend_frames_alpha(
                &mut blended_frame,
                &fullscreen_webcam,
                camera_only_opacity as f32,
            );

            // Regular webcam overlay during transition (fades at 1.5x speed)
            let overlay = if regular_camera_opacity > 0.01 && webcam_visible {
                let mut overlay = build_webcam_overlay(
                    &project,
                    webcam_frame.clone(),
                    composition_w,
                    composition_h,
                );
                overlay.shadow_opacity *= regular_camera_opacity as f32;
                Some(overlay)
            } else {
                None
            };

            (Some(blended_frame), overlay)
        } else {
            // Not in cameraOnly transition - normal rendering (common path, ~99% of frames)
            let overlay = match interpolated_scene.scene_mode {
                SceneMode::ScreenOnly => None,
                _ => {
                    if webcam_visible && regular_camera_opacity > 0.01 {
                        current_webcam_frame.as_ref().map(|frame| {
                            build_webcam_overlay(
                                &project,
                                frame.clone(),
                                composition_w,
                                composition_h,
                            )
                        })
                    } else {
                        None
                    }
                },
            };
            if use_nv12_gpu_path {
                // NV12 fast path: converter will write directly to video_texture
                (None, overlay)
            } else {
                // RGBA path: compositor uploads the frame
                (Some(screen_frame), overlay)
            }
        };

        // Convert background config to rendering style
        let background_style =
            BackgroundStyle::from_config(&project.export.background, resource_dir.as_deref());

        // Log background config on first frame
        if output_frame_count == 0 {
            log::info!(
                "[EXPORT] Background: type={:?}, padding={}, rounding={}",
                background_style.background_type,
                background_style.padding,
                background_style.rounding
            );
        }

        let render_options = RenderOptions {
            output_width: composition_w,
            output_height: composition_h,
            use_manual_composition: matches!(composition.mode, CompositionMode::Manual),
            zoom: zoom_state,
            webcam: webcam_overlay,
            cursor: None,
            background: background_style,
        };

        let frame_time_secs = relative_time_ms as f64 / 1000.0;

        // Prepare caption overlays for this frame (captions still use glyphon GPU pipeline)
        let prepared_captions = if project.captions.enabled {
            prepare_captions(
                &timeline_captions,
                &project.captions,
                frame_time_secs as f32,
                composition_w as f32,
                composition_h as f32,
            )
        } else {
            Vec::new()
        };

        // Get pre-rendered text images for this frame (from frontend OffscreenCanvas)
        // Text coordinates are normalized 0-1 relative to the video content area,
        // so we need the video frame position within the composition.
        let prerendered_texts = {
            let store = prerendered_text_store.lock();
            store.get_for_frame(
                frame_time_secs,
                &project.text.segments,
                composition_w,
                composition_h,
                composition_bounds.frame_x as u32,
                composition_bounds.frame_y as u32,
                composition_bounds.frame_width as u32,
                composition_bounds.frame_height as u32,
                zoom_state,
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

        // Submit readback copy command (non-blocking — GPU will execute asynchronously)
        renderer.submit_readback(
            &output_texture,
            &staging_buffers[buf_idx],
            composition_w,
            composition_h,
        );

        timing_gpu_us += t_gpu_start.elapsed().as_micros() as u64;

        // === CPU phase: process frame N-2 (pending_cpu) while GPU works on frame N ===
        if let Some(mut prev) = pending_cpu.take() {
            let t_cpu_start = std::time::Instant::now();
            apply_cpu_compositing(&mut prev, &cpu_ctx);
            timing_cpu_us += t_cpu_start.elapsed().as_micros() as u64;

            let t_encode_start = std::time::Instant::now();
            if encode_tx.send(prev.rgba_data).await.is_err() {
                log::error!("[EXPORT] Encode channel closed unexpectedly");
                break;
            }
            timing_encode_us += t_encode_start.elapsed().as_micros() as u64;

            // Progress update (every 10 frames, based on frames sent to encoder)
            let sent_count = prev.output_frame_idx + 1;
            if sent_count.is_multiple_of(10) {
                let progress = sent_count as f32 / total_output_frames as f32;
                let stage_progress = 0.08 + progress * 0.87;
                emit_progress(
                    &app,
                    stage_progress,
                    ExportStage::Encoding,
                    &format!("Rendering: {:.0}%", progress * 100.0),
                );
            }
        }

        // Shift readback queue: new → old, current frame → new
        pending_readback_old = pending_readback_new.take();
        pending_readback_new = Some(PendingReadback {
            staging_buf_idx: buf_idx,
            prerendered_texts,
            camera_only_opacity,
            source_time_ms,
            zoom_state,
            output_frame_idx: output_frame_count,
        });
        buf_idx = (buf_idx + 1) % 3;

        output_frame_count += 1;
        timing_frame_count += 1;

        // Log aggregate timing every 30 frames
        if timing_frame_count >= 30 {
            let n = timing_frame_count as f64;
            log::info!(
                "[EXPORT] Frame timing (avg over {}): decode={:.1}ms gpu={:.1}ms cpu={:.1}ms readback={:.1}ms encode={:.1}ms total={:.1}ms",
                timing_frame_count,
                timing_decode_us as f64 / n / 1000.0,
                timing_gpu_us as f64 / n / 1000.0,
                timing_cpu_us as f64 / n / 1000.0,
                timing_readback_us as f64 / n / 1000.0,
                timing_encode_us as f64 / n / 1000.0,
                (timing_decode_us + timing_gpu_us + timing_cpu_us + timing_readback_us + timing_encode_us) as f64 / n / 1000.0,
            );
            timing_decode_us = 0;
            timing_gpu_us = 0;
            timing_cpu_us = 0;
            timing_readback_us = 0;
            timing_encode_us = 0;
            timing_frame_count = 0;
        }

        // Check if we've read back enough frames
        if output_frame_count >= total_output_frames {
            break;
        }

        // Reset decode timer for next iteration's recv() wait
        t_decode_start = std::time::Instant::now();
    }

    // Drain pipeline: up to 3 frames may still be in-flight.
    // pending_cpu: readback done, needs CPU composite + encode
    // pending_readback_old: needs complete_readback + CPU composite + encode
    // pending_readback_new: needs complete_readback + CPU composite + encode
    if !cancel_flag().load(Ordering::Relaxed) {
        if let Some(mut cpu_work) = pending_cpu.take() {
            apply_cpu_compositing(&mut cpu_work, &cpu_ctx);
            let _ = encode_tx.send(cpu_work.rgba_data).await;
        }

        for rb in [pending_readback_old.take(), pending_readback_new.take()]
            .into_iter()
            .flatten()
        {
            let rgba_data = renderer
                .complete_readback(
                    &staging_buffers[rb.staging_buf_idx],
                    composition_w,
                    composition_h,
                )
                .await;
            let mut work = PendingCpuWork {
                rgba_data,
                prerendered_texts: rb.prerendered_texts,
                camera_only_opacity: rb.camera_only_opacity,
                source_time_ms: rb.source_time_ms,
                zoom_state: rb.zoom_state,
                output_frame_idx: rb.output_frame_idx,
            };
            apply_cpu_compositing(&mut work, &cpu_ctx);
            let _ = encode_tx.send(work.rgba_data).await;
        }
    }

    // Check if export was cancelled
    let was_cancelled = cancel_flag().load(Ordering::Relaxed);

    // Signal end of render loop and wait for encode to finish
    drop(encode_tx);

    if was_cancelled {
        // Kill FFmpeg process immediately and clean up partial file
        let _ = ffmpeg.kill();
        let _ = ffmpeg.wait();

        // Wait for pipeline tasks to complete
        drop(decode_rx);
        let _ = decode_handle.await;
        let _ = encode_handle.await;

        // Delete partial output file
        if output_path.exists() {
            let _ = std::fs::remove_file(&output_path);
            log::info!("[EXPORT] Deleted partial output file: {:?}", output_path);
        }

        emit_progress(&app, 0.0, ExportStage::Complete, "Export cancelled");

        return Err("Export cancelled by user".to_string());
    }

    emit_progress(&app, 0.95, ExportStage::Finalizing, "Finalizing...");

    // Wait for pipeline tasks to complete
    if let Err(e) = decode_handle.await {
        log::warn!("[EXPORT] Decode task join error: {:?}", e);
    }
    if let Err(e) = encode_handle.await {
        log::warn!("[EXPORT] Encode task join error: {:?}", e);
    }

    // Wait for FFmpeg encoder to finish
    let stderr_output = ffmpeg.stderr.take().and_then(|mut stderr| {
        use std::io::Read;
        let mut buf = Vec::new();
        stderr.read_to_end(&mut buf).ok()?;
        String::from_utf8(buf).ok()
    });
    let status = ffmpeg
        .wait()
        .map_err(|e| format!("FFmpeg wait failed: {}", e))?;
    if !status.success() {
        if let Some(ref stderr) = stderr_output {
            let tail: String = stderr
                .lines()
                .rev()
                .take(20)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            log::error!("[EXPORT] FFmpeg stderr (last 20 lines):\n{}", tail);
        }
        return Err(format!(
            "FFmpeg encoding failed with status: {:?}",
            status.code()
        ));
    }

    // Get output file info
    let metadata = std::fs::metadata(&output_path)
        .map_err(|e| format!("Failed to read output file: {}", e))?;

    emit_progress(&app, 1.0, ExportStage::Complete, "Export complete!");

    log::info!(
        "[EXPORT] Complete in {:.1}s: {} bytes",
        start_time.elapsed().as_secs_f32(),
        metadata.len()
    );

    Ok(ExportResult {
        output_path: output_path.to_string_lossy().to_string(),
        duration_secs,
        file_size_bytes: metadata.len(),
        format: project.export.format,
    })
}

/// Remap caption segments from source time to timeline time.
/// Filters out captions that fall entirely within deleted segments.
/// For captions that partially overlap kept segments, clips them to the segment boundaries.
fn remap_captions_to_timeline(
    captions: &[CaptionSegment],
    timeline: &TimelineState,
) -> Vec<CaptionSegment> {
    // If no segments (no cuts), captions are already in the right time space
    // Just offset by in_point
    if timeline.segments.is_empty() {
        return captions
            .iter()
            .filter_map(|cap| {
                let start_ms = (cap.start * 1000.0) as u64;
                let end_ms = (cap.end * 1000.0) as u64;

                // Check if caption is within in_point/out_point range
                if end_ms <= timeline.in_point || start_ms >= timeline.out_point {
                    return None; // Caption is outside trim range
                }

                // Clip to in_point/out_point and offset to timeline
                let clipped_start_ms = start_ms.max(timeline.in_point);
                let clipped_end_ms = end_ms.min(timeline.out_point);
                let timeline_start = (clipped_start_ms - timeline.in_point) as f32 / 1000.0;
                let timeline_end = (clipped_end_ms - timeline.in_point) as f32 / 1000.0;

                // Remap words too
                let remapped_words = cap
                    .words
                    .iter()
                    .filter_map(|word| {
                        let word_start_ms = (word.start * 1000.0) as u64;
                        let word_end_ms = (word.end * 1000.0) as u64;

                        if word_end_ms <= timeline.in_point || word_start_ms >= timeline.out_point {
                            return None;
                        }

                        let w_start = word_start_ms.max(timeline.in_point);
                        let w_end = word_end_ms.min(timeline.out_point);

                        Some(crate::commands::captions::types::CaptionWord {
                            text: word.text.clone(),
                            start: (w_start - timeline.in_point) as f32 / 1000.0,
                            end: (w_end - timeline.in_point) as f32 / 1000.0,
                        })
                    })
                    .collect();

                Some(CaptionSegment {
                    id: cap.id.clone(),
                    start: timeline_start,
                    end: timeline_end,
                    text: cap.text.clone(),
                    words: remapped_words,
                })
            })
            .collect();
    }

    // With segments: remap each caption through all kept segments
    let mut remapped: Vec<CaptionSegment> = Vec::new();

    for cap in captions {
        let cap_start_ms = (cap.start * 1000.0) as u64;
        let cap_end_ms = (cap.end * 1000.0) as u64;

        // Check if this caption overlaps with any kept segment
        let mut timeline_offset = 0u64;
        for seg in &timeline.segments {
            // Check if caption overlaps this segment
            if cap_end_ms > seg.source_start_ms && cap_start_ms < seg.source_end_ms {
                // Caption overlaps this segment - clip and remap
                let clipped_start_ms = cap_start_ms.max(seg.source_start_ms);
                let clipped_end_ms = cap_end_ms.min(seg.source_end_ms);

                // Convert to timeline time
                let timeline_start =
                    (timeline_offset + (clipped_start_ms - seg.source_start_ms)) as f32 / 1000.0;
                let timeline_end =
                    (timeline_offset + (clipped_end_ms - seg.source_start_ms)) as f32 / 1000.0;

                // Remap words that fall within this segment
                let remapped_words: Vec<_> = cap
                    .words
                    .iter()
                    .filter_map(|word| {
                        let word_start_ms = (word.start * 1000.0) as u64;
                        let word_end_ms = (word.end * 1000.0) as u64;

                        // Check if word overlaps this segment
                        if word_end_ms > seg.source_start_ms && word_start_ms < seg.source_end_ms {
                            let w_start = word_start_ms.max(seg.source_start_ms);
                            let w_end = word_end_ms.min(seg.source_end_ms);

                            Some(crate::commands::captions::types::CaptionWord {
                                text: word.text.clone(),
                                start: (timeline_offset + (w_start - seg.source_start_ms)) as f32
                                    / 1000.0,
                                end: (timeline_offset + (w_end - seg.source_start_ms)) as f32
                                    / 1000.0,
                            })
                        } else {
                            None
                        }
                    })
                    .collect();

                // Only add if we have content
                if !remapped_words.is_empty() || timeline_end > timeline_start {
                    remapped.push(CaptionSegment {
                        id: format!("{}_{}", cap.id, seg.source_start_ms),
                        start: timeline_start,
                        end: timeline_end,
                        text: cap.text.clone(),
                        words: remapped_words,
                    });
                }
            }

            // Advance timeline offset for next segment
            timeline_offset += seg.source_end_ms - seg.source_start_ms;
        }
    }

    log::debug!(
        "[EXPORT] Remapped {} captions to {} timeline captions",
        captions.len(),
        remapped.len()
    );

    remapped
}
