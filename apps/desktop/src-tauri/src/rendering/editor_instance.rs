//! Editor instance for managing playback state.
//!
//! Each video project gets its own EditorInstance that manages:
//! - Video decoders (screen + optional webcam)
//! - Playback state (playing, paused, current frame)
//! - Frame rendering pipeline
//! - Event emission to frontend

use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::compositor::Compositor;
use super::cursor::{composite_cursor, CursorInterpolator, DecodedCursorImage, VideoContentBounds};
use super::decoder::VideoDecoder;
use super::exporter::{build_webcam_overlay, is_webcam_visible_at};
use super::renderer::Renderer;
use super::svg_cursor::render_svg_cursor_to_height;
use super::types::{
    BackgroundStyle, EditorInstanceInfo, PlaybackEvent, PlaybackState, RenderOptions, RenderedFrame,
};
use super::zoom::ZoomInterpolator;
use crate::commands::video_recording::cursor::events::load_cursor_recording;
use crate::commands::video_recording::video_project::VideoProject;

/// Events sent from playback loop to main thread.
enum PlaybackCommand {
    Play,
    Pause,
    Stop,
    Seek(u64), // timestamp_ms
    SetSpeed(f32),
}

/// Editor instance managing a video project's playback.
pub struct EditorInstance {
    /// Unique instance ID.
    pub id: String,
    /// Video project configuration.
    project: VideoProject,
    /// Screen video decoder.
    screen_decoder: VideoDecoder,
    /// Webcam video decoder (if present).
    webcam_decoder: Option<VideoDecoder>,
    /// Cursor interpolator (if cursor data exists).
    cursor_interpolator: Option<CursorInterpolator>,
    /// GPU renderer.
    renderer: Arc<Renderer>,
    /// Frame compositor.
    compositor: Compositor,
    /// Zoom interpolator.
    zoom: ZoomInterpolator,
    /// Current playback state.
    state: Arc<Mutex<PlaybackStateInner>>,
    /// Channel to send commands to playback loop.
    command_tx: Option<mpsc::Sender<PlaybackCommand>>,
    /// Playback task handle.
    playback_task: Option<tokio::task::JoinHandle<()>>,
    /// Resource directory for resolving wallpaper paths.
    resource_dir: Option<PathBuf>,
}

struct PlaybackStateInner {
    state: PlaybackState,
    current_frame: u32,
    current_timestamp_ms: u64,
    speed: f32,
}

impl EditorInstance {
    /// Create a new editor instance for a video project.
    ///
    /// `renderer` is the shared GPU renderer from RendererState.
    /// `resource_dir` is used to resolve wallpaper paths for backgrounds.
    pub async fn new(
        project: VideoProject,
        renderer: Arc<Renderer>,
        resource_dir: Option<PathBuf>,
    ) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4().to_string();

        // Create screen decoder
        let screen_path = Path::new(&project.sources.screen_video);
        log::info!("[GPU_EDITOR] Creating decoder for: {:?}", screen_path);
        let mut screen_decoder = VideoDecoder::new(screen_path)?;
        log::info!("[GPU_EDITOR] Starting decoder...");
        screen_decoder.start()?;

        // Pre-decode frame 0 so it's ready immediately
        log::info!("[GPU_EDITOR] Pre-decoding frame 0...");
        match screen_decoder.seek(0).await {
            Ok(_) => log::info!("[GPU_EDITOR] Frame 0 pre-decoded successfully"),
            Err(e) => log::warn!("[GPU_EDITOR] Failed to pre-decode frame 0: {}", e),
        }

        // Create webcam decoder if present
        let webcam_decoder = if let Some(webcam_path) = &project.sources.webcam_video {
            let path = Path::new(webcam_path);
            if path.exists() {
                match VideoDecoder::new(path) {
                    Ok(mut decoder) => {
                        decoder.start()?;
                        log::info!("[GPU_EDITOR] Webcam decoder initialized");
                        Some(decoder)
                    },
                    Err(e) => {
                        log::warn!("[GPU_EDITOR] Failed to create webcam decoder: {}", e);
                        None
                    },
                }
            } else {
                None
            }
        } else {
            None
        };

        // Create cursor interpolator if cursor data exists
        let cursor_interpolator = if let Some(ref cursor_data_path) = project.sources.cursor_data {
            let cursor_path = Path::new(cursor_data_path);
            if cursor_path.exists() {
                match load_cursor_recording(cursor_path) {
                    Ok(recording) => {
                        log::info!(
                            "[GPU_EDITOR] Loaded cursor recording: {} events, {} images",
                            recording.events.len(),
                            recording.cursor_images.len()
                        );
                        Some(CursorInterpolator::new(&recording))
                    },
                    Err(e) => {
                        log::warn!("[GPU_EDITOR] Failed to load cursor recording: {}", e);
                        None
                    },
                }
            } else {
                log::debug!(
                    "[GPU_EDITOR] Cursor data file not found: {}",
                    cursor_data_path
                );
                None
            }
        } else {
            None
        };

        // Create compositor
        let compositor = Compositor::new(&renderer);

        // Create zoom interpolator
        let zoom = ZoomInterpolator::new(&project.zoom);

        let state = Arc::new(Mutex::new(PlaybackStateInner {
            state: PlaybackState::Stopped,
            current_frame: 0,
            current_timestamp_ms: 0,
            speed: project.timeline.speed,
        }));

        Ok(Self {
            id,
            project,
            screen_decoder,
            webcam_decoder,
            cursor_interpolator,
            renderer,
            compositor,
            zoom,
            state,
            command_tx: None,
            playback_task: None,
            resource_dir,
        })
    }

    /// Get instance info for the frontend.
    pub fn info(&self) -> EditorInstanceInfo {
        EditorInstanceInfo {
            instance_id: self.id.clone(),
            width: self.screen_decoder.width(),
            height: self.screen_decoder.height(),
            duration_ms: self.screen_decoder.duration_ms(),
            fps: self.screen_decoder.fps() as u32,
            frame_count: self.screen_decoder.frame_count(),
            has_webcam: self.webcam_decoder.is_some(),
            has_cursor: self.project.sources.cursor_data.is_some(),
        }
    }

    /// Start playback loop.
    pub fn start_playback(&mut self, app_handle: AppHandle) -> Result<(), String> {
        if self.command_tx.is_some() {
            // Already running
            return Ok(());
        }

        let (tx, rx) = mpsc::channel(32);
        self.command_tx = Some(tx.clone());

        let state = Arc::clone(&self.state);
        let fps = self.screen_decoder.fps();
        let frame_count = self.screen_decoder.frame_count();
        let duration_ms = self.screen_decoder.duration_ms();
        let instance_id = self.id.clone();

        let handle = tokio::spawn(async move {
            playback_loop(
                rx,
                state,
                fps,
                frame_count,
                duration_ms,
                instance_id,
                app_handle,
            )
            .await;
        });

        self.playback_task = Some(handle);
        Ok(())
    }

    /// Play video.
    pub async fn play(&self) -> Result<(), String> {
        if let Some(tx) = &self.command_tx {
            tx.send(PlaybackCommand::Play)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Pause video.
    pub async fn pause(&self) -> Result<(), String> {
        if let Some(tx) = &self.command_tx {
            tx.send(PlaybackCommand::Pause)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Stop playback.
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(tx) = self.command_tx.take() {
            let _ = tx.send(PlaybackCommand::Stop).await;
        }
        if let Some(handle) = self.playback_task.take() {
            let _ = handle.await;
        }
        Ok(())
    }

    /// Seek to timestamp.
    pub async fn seek(&self, timestamp_ms: u64) -> Result<(), String> {
        if let Some(tx) = &self.command_tx {
            tx.send(PlaybackCommand::Seek(timestamp_ms))
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Set playback speed.
    pub async fn set_speed(&self, speed: f32) -> Result<(), String> {
        if let Some(tx) = &self.command_tx {
            tx.send(PlaybackCommand::SetSpeed(speed))
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Render a single frame at the given timestamp.
    pub async fn render_frame(&mut self, timestamp_ms: u64) -> Result<RenderedFrame, String> {
        let frame_num = self.screen_decoder.timestamp_to_frame(timestamp_ms);
        let frame = self.screen_decoder.seek(frame_num).await?;

        // Get zoom state
        let zoom_state = self.zoom.get_zoom_at(timestamp_ms);

        // Use project's background settings for WYSIWYG preview
        let background_style = BackgroundStyle::from_config(
            &self.project.export.background,
            self.resource_dir.as_deref(),
        );

        let output_width = self.screen_decoder.width();
        let output_height = self.screen_decoder.height();

        // Build webcam overlay if enabled and visible at this timestamp
        let webcam_overlay =
            if self.project.webcam.enabled && is_webcam_visible_at(&self.project, timestamp_ms) {
                if let Some(ref mut webcam_decoder) = self.webcam_decoder {
                    let webcam_frame_num = webcam_decoder.timestamp_to_frame(timestamp_ms);
                    match webcam_decoder.seek(webcam_frame_num).await {
                        Ok(webcam_frame) => Some(build_webcam_overlay(
                            &self.project,
                            webcam_frame,
                            output_width,
                            output_height,
                        )),
                        Err(e) => {
                            log::warn!("[GPU_EDITOR] Failed to decode webcam frame: {}", e);
                            None
                        },
                    }
                } else {
                    None
                }
            } else {
                None
            };

        // Set up render options (cursor is composited on CPU after GPU pass)
        let options = RenderOptions {
            output_width,
            output_height,
            zoom: zoom_state,
            webcam: webcam_overlay,
            cursor: None, // Cursor is composited on CPU below
            background: background_style,
        };

        // GPU composite frame (screen + webcam + background)
        let output_texture = self
            .compositor
            .composite(&self.renderer, &frame, &options, timestamp_ms as f32)
            .await;

        // Read back to CPU
        let mut rgba_data = self
            .renderer
            .read_texture(&output_texture, output_width, output_height)
            .await;

        // Check if crop is enabled - we'll apply it after cursor compositing
        let crop = &self.project.export.crop;
        let crop_enabled = crop.enabled && crop.width > 0 && crop.height > 0;
        let (final_width, final_height) = if crop_enabled {
            (crop.width, crop.height)
        } else {
            (output_width, output_height)
        };

        // Debug: Log crop and zoom state
        if crop_enabled {
            log::debug!(
                "[CURSOR] crop enabled: x={}, y={}, w={}, h={}, zoom_scale={}",
                crop.x,
                crop.y,
                crop.width,
                crop.height,
                zoom_state.scale
            );
        }

        // CPU cursor compositing (matches exporter behavior for accurate hotspot/scale)
        // Cursor is composited at original coordinates onto full frame, then frame is cropped.
        // This ensures cursor position is correct in the final cropped output.
        if self.project.cursor.visible {
            if let Some(ref cursor_interp) = self.cursor_interpolator {
                let cursor = cursor_interp.get_cursor_at(timestamp_ms);
                let original_cursor_x = cursor.x;
                let original_cursor_y = cursor.y;

                // Track zoom scale for cursor sizing only (GPU zoom is CSS-style,
                // it scales the entire frame but shows the same video content)
                let zoom_scale = zoom_state.scale;
                let mut cursor_visible = true;

                // Check if cursor is within crop region (if crop enabled)
                if crop_enabled {
                    let original_w = output_width as f32;
                    let original_h = output_height as f32;
                    let cursor_px_x = cursor.x * original_w;
                    let cursor_px_y = cursor.y * original_h;
                    let crop_x = crop.x as f32;
                    let crop_y = crop.y as f32;
                    let crop_w = crop.width as f32;
                    let crop_h = crop.height as f32;

                    // Hide cursor if outside cropped region (with margin for cursor size)
                    let margin = 50.0; // pixels
                    if cursor_px_x < crop_x - margin
                        || cursor_px_x > crop_x + crop_w + margin
                        || cursor_px_y < crop_y - margin
                        || cursor_px_y > crop_y + crop_h + margin
                    {
                        cursor_visible = false;
                    }
                }

                // Note: GPU zoom is CSS-style (scales frame, shows same content)
                // Cursor position doesn't need transformation for zoom

                if cursor_visible {
                    // Debug: Log cursor position before composite
                    if crop_enabled {
                        let pixel_x = cursor.x * output_width as f32;
                        let pixel_y = cursor.y * output_height as f32;
                        log::debug!(
                            "[CURSOR] original=({:.3},{:.3}) final=({:.3},{:.3}) pixel=({:.0},{:.0}) frame={}x{}",
                            original_cursor_x, original_cursor_y,
                            cursor.x, cursor.y,
                            pixel_x, pixel_y,
                            output_width, output_height
                        );
                    }

                    // Video bounds - in preview, video fills the frame (no padding)
                    let video_bounds = VideoContentBounds::full_frame(output_width, output_height);

                    // Calculate cursor scale relative to composition size
                    // Base cursor is 24px, scaled relative to 720p reference
                    // Also scale with zoom to maintain apparent cursor size on screen
                    let base_cursor_height = 24.0_f32;
                    let reference_height = 720.0_f32;
                    let size_scale = output_height as f32 / reference_height;
                    let final_cursor_height =
                        (base_cursor_height * size_scale * self.project.cursor.scale * zoom_scale)
                            .clamp(16.0, 256.0);

                    // Try SVG cursor first (if shape is detected)
                    let mut rendered = false;
                    if let Some(shape) = cursor.cursor_shape {
                        let target_height = final_cursor_height.round() as u32;
                        if let Some(svg_cursor) = render_svg_cursor_to_height(shape, target_height)
                        {
                            let svg_decoded = DecodedCursorImage {
                                width: svg_cursor.width,
                                height: svg_cursor.height,
                                hotspot_x: svg_cursor.hotspot_x,
                                hotspot_y: svg_cursor.hotspot_y,
                                data: svg_cursor.data,
                            };
                            // Pass 1.0 as base_scale since SVG is already at final size
                            composite_cursor(
                                &mut rgba_data,
                                output_width,
                                output_height,
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
                            if let Some(cursor_image) = cursor_interp.get_cursor_image(cursor_id) {
                                // For bitmap, calculate scale to reach final_cursor_height
                                let bitmap_scale = final_cursor_height / cursor_image.height as f32;
                                composite_cursor(
                                    &mut rgba_data,
                                    output_width,
                                    output_height,
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

        // Apply crop if enabled - extract crop region from full frame
        let final_rgba_data = if crop_enabled {
            let crop_x = crop.x as usize;
            let crop_y = crop.y as usize;
            let crop_w = crop.width as usize;
            let crop_h = crop.height as usize;
            let src_stride = output_width as usize * 4; // 4 bytes per pixel (RGBA)
            let dst_stride = crop_w * 4;

            let mut cropped = vec![0u8; crop_w * crop_h * 4];
            for row in 0..crop_h {
                let src_row = crop_y + row;
                if src_row >= output_height as usize {
                    break;
                }
                let src_start = src_row * src_stride + crop_x * 4;
                let src_end = src_start + dst_stride.min(src_stride - crop_x * 4);
                let dst_start = row * dst_stride;
                let copy_len = src_end - src_start;
                cropped[dst_start..dst_start + copy_len]
                    .copy_from_slice(&rgba_data[src_start..src_end]);
            }
            cropped
        } else {
            rgba_data
        };

        // Encode as base64
        let data_base64 =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &final_rgba_data);

        Ok(RenderedFrame {
            frame: frame_num,
            timestamp_ms,
            data_base64,
            width: final_width,
            height: final_height,
        })
    }

    /// Get current playback state.
    pub fn get_state(&self) -> PlaybackState {
        self.state.lock().state
    }

    /// Get current timestamp.
    pub fn get_current_timestamp(&self) -> u64 {
        self.state.lock().current_timestamp_ms
    }
}

/// Background playback loop.
async fn playback_loop(
    mut rx: mpsc::Receiver<PlaybackCommand>,
    state: Arc<Mutex<PlaybackStateInner>>,
    fps: f64,
    frame_count: u32,
    duration_ms: u64,
    instance_id: String,
    app_handle: AppHandle,
) {
    let frame_duration = Duration::from_secs_f64(1.0 / fps);
    let mut last_frame_time = Instant::now();
    let mut playing = false;

    loop {
        // Check for commands (non-blocking when playing)
        let timeout = if playing {
            Duration::from_millis(1)
        } else {
            Duration::from_millis(100)
        };

        match tokio::time::timeout(timeout, rx.recv()).await {
            Ok(Some(cmd)) => match cmd {
                PlaybackCommand::Play => {
                    playing = true;
                    last_frame_time = Instant::now();
                    let mut s = state.lock();
                    s.state = PlaybackState::Playing;
                },
                PlaybackCommand::Pause => {
                    playing = false;
                    let mut s = state.lock();
                    s.state = PlaybackState::Paused;
                },
                PlaybackCommand::Stop => {
                    break;
                },
                PlaybackCommand::Seek(timestamp_ms) => {
                    let mut s = state.lock();
                    s.current_timestamp_ms = timestamp_ms.min(duration_ms);
                    s.current_frame = ((timestamp_ms as f64 / 1000.0) * fps).floor() as u32;
                    s.state = PlaybackState::Seeking;

                    // Emit seek event
                    let event = PlaybackEvent {
                        frame: s.current_frame,
                        timestamp_ms: s.current_timestamp_ms,
                        state: s.state,
                    };
                    let _ = app_handle.emit(&format!("playback:{}", instance_id), event);
                },
                PlaybackCommand::SetSpeed(speed) => {
                    let mut s = state.lock();
                    s.speed = speed.clamp(0.1, 4.0);
                },
            },
            Ok(None) => {
                // Channel closed
                break;
            },
            Err(_) => {
                // Timeout - continue playback if playing
            },
        }

        // Advance playback
        if playing {
            let elapsed = last_frame_time.elapsed();
            let speed = state.lock().speed;
            let effective_frame_duration = frame_duration.div_f32(speed);

            if elapsed >= effective_frame_duration {
                last_frame_time = Instant::now();

                let mut s = state.lock();
                s.current_frame += 1;

                if s.current_frame >= frame_count {
                    // Loop or stop at end
                    s.current_frame = 0;
                    s.current_timestamp_ms = 0;
                    s.state = PlaybackState::Stopped;
                    playing = false;
                } else {
                    s.current_timestamp_ms = ((s.current_frame as f64 / fps) * 1000.0) as u64;
                }

                // Emit playback event
                let event = PlaybackEvent {
                    frame: s.current_frame,
                    timestamp_ms: s.current_timestamp_ms,
                    state: s.state,
                };
                drop(s); // Release lock before emit

                let _ = app_handle.emit(&format!("playback:{}", instance_id), event);
            }
        }
    }
}
