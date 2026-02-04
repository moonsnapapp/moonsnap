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

use tauri::{AppHandle, Manager};

use super::caption_layer::prepare_captions;
use super::compositor::Compositor;
use super::cursor::{composite_cursor, CursorInterpolator, VideoContentBounds};
use super::renderer::Renderer;
use super::scene::SceneInterpolator;
use super::stream_decoder::StreamDecoder;
use super::svg_cursor::render_svg_cursor_to_height;
use super::text::prepare_texts;
use super::types::{BackgroundStyle, RenderOptions};
use super::zoom::ZoomInterpolator;
use crate::commands::captions::types::CaptionSegment;
use crate::commands::video_recording::cursor::events::load_cursor_recording;
use crate::commands::video_recording::video_export::{ExportResult, ExportStage};
use crate::commands::video_recording::video_project::XY;
use crate::commands::video_recording::video_project::{
    CompositionMode, CursorType, SceneMode, TimelineState, VideoProject,
};

// Re-export submodule functions used externally
pub use ffmpeg::emit_progress;
pub use frame_ops::draw_cursor_circle;
pub use webcam::{build_webcam_overlay, is_webcam_visible_at};

use ffmpeg::start_ffmpeg_encoder;
use frame_ops::{blend_frames_alpha, crop_decoded_frame, scale_frame_to_fill};

/// Export a video project using GPU rendering.
///
/// Uses streaming decoders (1 FFmpeg process each) instead of per-frame spawning.
pub async fn export_video_gpu(
    app: AppHandle,
    project: VideoProject,
    output_path: String,
) -> Result<ExportResult, String> {
    let start_time = std::time::Instant::now();

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
    let padding = project.export.background.padding as u32;

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

    // Initialize streaming decoders (ONE FFmpeg process each!)
    // Use decode_range which respects segments (first seg start to last seg end)
    let screen_path = Path::new(&project.sources.screen_video);
    let mut screen_decoder = StreamDecoder::new(screen_path, decode_start_ms, decode_end_ms)?;
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
                        Some(CursorInterpolator::new(&recording))
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

    // Track output frames separately from decoded frames
    let mut output_frame_count = 0u32;

    // Render frames from decode pipeline, send to encode pipeline
    while let Some(bundle) = decode_rx.recv().await {
        let decoded_frame_idx = bundle.frame_idx;
        let current_webcam_frame = bundle.webcam_frame;

        // Calculate source time for this decoded frame
        let source_time_ms =
            decode_start_ms + ((decoded_frame_idx as f64 / fps as f64) * 1000.0) as u64;

        // For segment-aware export: check if this frame is in a kept segment
        // source_to_timeline returns None if the source time is in a deleted region
        let timeline_time_ms = if has_segments {
            match project.timeline.source_to_timeline(source_time_ms) {
                Some(t) => t,
                None => {
                    // This frame is in a deleted region - skip it
                    continue;
                },
            }
        } else {
            // No segments - use simple offset from decode start
            source_time_ms - decode_start_ms
        };

        // Apply video crop to screen frame BEFORE composition
        let screen_frame = if crop_enabled {
            crop_decoded_frame(
                &bundle.screen_frame,
                crop.x,
                crop.y,
                crop.width,
                crop.height,
            )
        } else {
            bundle.screen_frame
        };

        // Use timeline_time_ms for user-defined effects (zoom regions, scene segments, visibility)
        // Use source_time_ms for recorded data (cursor position)
        let relative_time_ms = timeline_time_ms;

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

        // Build the frame to render with proper blending
        // Note: Camera-only blending uses video dimensions (not output dimensions with padding)
        // because screen_frame comes from decoder at video dimensions. The compositor will
        // add background/padding around the blended result.
        let (frame_to_render, webcam_overlay) = if camera_only_opacity > 0.99 {
            // Fully in cameraOnly mode - just show fullscreen webcam
            // Scale to video dimensions since compositor will add padding
            if let Some(ref webcam_frame) = current_webcam_frame {
                let scaled_frame = scale_frame_to_fill(webcam_frame, video_w, video_h);
                (scaled_frame, None)
            } else {
                (screen_frame.clone(), None)
            }
        } else if camera_only_opacity > 0.01 {
            // In cameraOnly transition - blend screen and fullscreen webcam
            if let Some(ref webcam_frame) = current_webcam_frame {
                // Start with screen frame (apply blur if needed)
                let mut blended_frame = if interpolated_scene.screen_blur > 0.01 {
                    // Note: GPU blur would be better, but for now we skip CPU blur
                    // The screen will still fade out via opacity blending
                    screen_frame.clone()
                } else {
                    screen_frame.clone()
                };

                // Scale webcam to fill video area (matches screen_frame dimensions)
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
                    // Apply the transition opacity to the overlay
                    overlay.shadow_opacity *= regular_camera_opacity as f32;
                    Some(overlay)
                } else {
                    None
                };

                (blended_frame, overlay)
            } else {
                // No webcam available
                (screen_frame.clone(), None)
            }
        } else {
            // Not in cameraOnly transition - normal rendering
            match interpolated_scene.scene_mode {
                SceneMode::ScreenOnly => {
                    // Screen only - no webcam overlay
                    (screen_frame.clone(), None)
                },
                _ => {
                    // Default mode - screen with webcam overlay (if visible)
                    let overlay = if webcam_visible && regular_camera_opacity > 0.01 {
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
                    };
                    (screen_frame.clone(), overlay)
                },
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
            zoom: zoom_state,
            webcam: webcam_overlay,
            cursor: None,
            background: background_style,
        };

        // Prepare text overlays for this frame
        // Time is in seconds, output_size uses XY struct
        let frame_time_secs = relative_time_ms as f64 / 1000.0;
        let mut prepared_texts = prepare_texts(
            XY::new(composition_w, composition_h),
            frame_time_secs,
            &project.text.segments,
        );

        // Prepare caption overlays for this frame (if enabled)
        // Uses timeline_captions which are already remapped from source time to timeline time
        if project.captions.enabled {
            let caption_texts = prepare_captions(
                &timeline_captions,
                &project.captions,
                frame_time_secs as f32,
                composition_w as f32,
                composition_h as f32,
            );
            prepared_texts.extend(caption_texts);
        }

        // Render frame on GPU (with text and caption overlays)
        let output_texture = compositor
            .composite_with_text(
                &renderer,
                &frame_to_render,
                &render_options,
                relative_time_ms as f32,
                &prepared_texts,
            )
            .await;

        // Read rendered frame back to CPU (at composition size, before crop)
        let mut rgba_data = renderer
            .read_texture(&output_texture, composition_w, composition_h)
            .await;

        // Composite cursor onto frame (CPU-based) if cursor is visible and not in cameraOnly mode
        if let Some(ref cursor_interp) = cursor_interpolator {
            // Only show cursor when screen is visible (not in cameraOnly mode)
            if camera_only_opacity < 0.99 {
                // Use SOURCE time for cursor lookup (cursor data is recorded in source time)
                let mut cursor = cursor_interp.get_cursor_at(source_time_ms);

                // Transform cursor position for crop
                // Cursor coordinates are normalized 0-1 relative to original video
                // If crop is enabled, transform to cropped region coordinates
                let mut cursor_visible = true;
                if crop_enabled {
                    let orig_w = original_width as f32;
                    let orig_h = original_height as f32;
                    let crop_x = crop.x as f32;
                    let crop_y = crop.y as f32;
                    let crop_w = crop.width as f32;
                    let crop_h = crop.height as f32;

                    // Convert cursor from original coords to crop-relative coords
                    let cursor_px_x = cursor.x * orig_w;
                    let cursor_px_y = cursor.y * orig_h;
                    cursor.x = (cursor_px_x - crop_x) / crop_w;
                    cursor.y = (cursor_px_y - crop_y) / crop_h;

                    // Skip if cursor is outside cropped region
                    if cursor.x < -0.1 || cursor.x > 1.1 || cursor.y < -0.1 || cursor.y > 1.1 {
                        cursor_visible = false;
                    }
                }

                if cursor_visible {
                    // Calculate video content bounds within composition
                    // Cursor coordinates are now relative to cropped video content
                    let video_bounds = VideoContentBounds::with_padding(
                        composition_w,
                        composition_h,
                        video_w,
                        video_h,
                        padding,
                    );

                    // Get cursor image based on cursor type
                    if project.cursor.cursor_type == CursorType::Circle {
                        // Draw circle indicator instead of actual cursor
                        draw_cursor_circle(
                            &mut rgba_data,
                            composition_w,
                            composition_h,
                            &video_bounds,
                            cursor.x,
                            cursor.y,
                            project.cursor.scale,
                        );
                    } else {
                        // Priority: SVG cursor (if shape detected) > Bitmap cursor (fallback)
                        // This matches Cap's approach for consistent, resolution-independent cursors.
                        let mut rendered = false;

                        // Calculate cursor scale relative to composition size
                        // Base cursor is 24px (same as editor DEFAULT_CURSOR_SIZE)
                        // Scale relative to 720p reference so cursor looks proportional
                        let base_cursor_height = 24.0;
                        let reference_height = 720.0;
                        let size_scale = composition_h as f32 / reference_height;
                        let final_cursor_height =
                            base_cursor_height * size_scale * project.cursor.scale;
                        let final_cursor_height = final_cursor_height.clamp(16.0, 256.0);

                        // Try SVG cursor first (if shape is detected)
                        if let Some(shape) = cursor.cursor_shape {
                            // Render SVG at final cursor height (handles any original SVG size)
                            let target_height = final_cursor_height.round() as u32;

                            if let Some(svg_cursor) =
                                render_svg_cursor_to_height(shape, target_height)
                            {
                                let svg_decoded = super::cursor::DecodedCursorImage {
                                    width: svg_cursor.width,
                                    height: svg_cursor.height,
                                    hotspot_x: svg_cursor.hotspot_x,
                                    hotspot_y: svg_cursor.hotspot_y,
                                    data: svg_cursor.data,
                                };
                                // Pass 1.0 as base_scale since SVG is already at final size
                                // cursor.scale (click animation) is applied internally
                                composite_cursor(
                                    &mut rgba_data,
                                    composition_w,
                                    composition_h,
                                    &video_bounds,
                                    &cursor,
                                    &svg_decoded,
                                    1.0,
                                );
                                rendered = true;
                            }
                        }

                        // Fall back to bitmap cursor if SVG not available
                        if !rendered {
                            if let Some(ref cursor_id) = cursor.cursor_id {
                                if let Some(cursor_image) =
                                    cursor_interp.get_cursor_image(cursor_id)
                                {
                                    // For bitmap, apply the full scale factor
                                    let bitmap_scale =
                                        final_cursor_height / cursor_image.height as f32;
                                    composite_cursor(
                                        &mut rgba_data,
                                        composition_w,
                                        composition_h,
                                        &video_bounds,
                                        &cursor,
                                        cursor_image,
                                        bitmap_scale,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        // Send to encode pipeline (async, with backpressure)
        // Note: Video crop is now applied to input frames, not extracted from output
        if encode_tx.send(rgba_data).await.is_err() {
            log::error!("[EXPORT] Encode channel closed unexpectedly");
            break;
        }

        // Increment output frame counter
        output_frame_count += 1;

        // Progress update (every 10 frames)
        if output_frame_count.is_multiple_of(10) {
            let progress = output_frame_count as f32 / total_output_frames as f32;
            let stage_progress = 0.08 + progress * 0.87;
            emit_progress(
                &app,
                stage_progress,
                ExportStage::Encoding,
                &format!("Rendering: {:.0}%", progress * 100.0),
            );
        }

        // Check if we've output enough frames
        if output_frame_count >= total_output_frames {
            break;
        }
    }

    // Signal end of render loop and wait for encode to finish
    drop(encode_tx);

    emit_progress(&app, 0.95, ExportStage::Finalizing, "Finalizing...");

    // Wait for pipeline tasks to complete
    if let Err(e) = decode_handle.await {
        log::warn!("[EXPORT] Decode task join error: {:?}", e);
    }
    if let Err(e) = encode_handle.await {
        log::warn!("[EXPORT] Encode task join error: {:?}", e);
    }

    // Wait for FFmpeg encoder to finish
    let status = ffmpeg
        .wait()
        .map_err(|e| format!("FFmpeg wait failed: {}", e))?;
    if !status.success() {
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
