//! Preview rendering module.
//!
//! Provides GPU-rendered preview frames streamed via WebSocket.
//! This ensures the preview exactly matches the exported video.
//!
//! Also provides native wgpu surface rendering for zero-latency text preview.

mod decoder;
mod frame_ws;
pub mod native_surface;

pub use decoder::{spawn_decoder, AsyncVideoDecoderHandle, DecodedFrame as AsyncDecodedFrame};
pub use frame_ws::{create_frame_ws, ShutdownSignal, WSFrame};
pub use native_surface::{
    get_caption_preview_instance, remove_caption_preview_instance, NativeCaptionPreview,
};

use crate::rendering::compositor::Compositor;
use crate::rendering::renderer::Renderer;
use log::info;
use moonsnap_domain::captions::{CaptionSegment, CaptionSettings};
use moonsnap_domain::video_project::{TextAnimation, TextSegment, VideoProject};
use moonsnap_render::caption_layer::prepare_captions;
use moonsnap_render::text::{parse_color, PreparedText};
use moonsnap_render::types::{
    BackgroundStyle, BackgroundType, BorderStyle, CornerStyle, DecodedFrame, PixelFormat,
    RenderOptions, ShadowStyle, ZoomState,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{watch, Mutex, RwLock};

/// Cached caption payload for fast frame-only scrub commands.
struct CaptionOverlayData {
    segments: Vec<CaptionSegment>,
    settings: CaptionSettings,
}

/// Preview renderer state.
pub struct PreviewRenderer {
    /// GPU renderer (shared with EditorInstance and Export).
    renderer: Arc<Renderer>,
    /// Frame compositor.
    compositor: Mutex<Compositor>,
    /// Frame sender for WebSocket.
    frame_tx: watch::Sender<Option<WSFrame>>,
    /// Current project configuration.
    project: Mutex<Option<VideoProject>>,
    /// Async video decoder handle.
    decoder: Mutex<Option<AsyncVideoDecoderHandle>>,
    /// Current frame number.
    frame_number: Mutex<u32>,
    /// Cached caption overlay data updated only when content changes.
    caption_overlay_data: RwLock<Option<Arc<CaptionOverlayData>>>,
}

fn calculate_text_segment_opacity(segment: &TextSegment, frame_time: f64) -> f32 {
    let fade_duration = segment.fade_duration.max(0.0);
    if fade_duration <= 0.0 {
        return 1.0;
    }

    let time_since_start = frame_time - segment.start;
    let time_until_end = segment.end - frame_time;
    let segment_duration = segment.end - segment.start;

    if time_since_start < fade_duration {
        return (time_since_start / fade_duration).clamp(0.0, 1.0) as f32;
    }

    if time_until_end < fade_duration && segment_duration > fade_duration * 2.0 {
        return (time_until_end / fade_duration).clamp(0.0, 1.0) as f32;
    }

    1.0
}

fn calculate_typewriter_typing_window_secs(segment: &TextSegment) -> f64 {
    let segment_duration = (segment.end - segment.start).max(0.0);
    let fade_duration = segment.fade_duration.max(0.0);
    let has_fade_out_window = fade_duration > 0.0 && segment_duration > fade_duration * 2.0;
    let outro_duration = if has_fade_out_window {
        fade_duration
    } else {
        0.0
    };
    (segment_duration - outro_duration).max(0.0)
}

fn calculate_effective_typewriter_chars_per_second(
    segment: &TextSegment,
    total_chars: usize,
) -> f64 {
    let requested = segment.typewriter_chars_per_second.clamp(1.0, 60.0) as f64;
    if total_chars == 0 {
        return requested;
    }

    let typing_window_secs = calculate_typewriter_typing_window_secs(segment);
    if typing_window_secs <= 0.0 {
        return requested;
    }

    let minimum_required = total_chars as f64 / typing_window_secs;
    requested.max(minimum_required)
}

fn animated_text_content(segment: &TextSegment, time_secs: f64) -> String {
    if segment.animation != TextAnimation::TypeWriter {
        return segment.content.clone();
    }

    let total_chars = segment.content.chars().count();
    if total_chars == 0 {
        return String::new();
    }

    let elapsed = (time_secs - segment.start).max(0.0);
    let chars_per_second = calculate_effective_typewriter_chars_per_second(segment, total_chars);
    let visible_chars = (elapsed * chars_per_second).floor() as usize;
    let clamped_chars = visible_chars.min(total_chars);
    segment.content.chars().take(clamped_chars).collect()
}

fn prepare_text_overlays(
    segments: &[TextSegment],
    time_secs: f64,
    output_width: u32,
    output_height: u32,
) -> Vec<PreparedText> {
    let mut texts = Vec::new();
    let out_w = output_width as f64;
    let out_h = output_height as f64;

    for segment in segments {
        if !segment.enabled {
            continue;
        }
        if time_secs < segment.start || time_secs > segment.end {
            continue;
        }

        let opacity = calculate_text_segment_opacity(segment, time_secs);
        if opacity < 0.001 {
            continue;
        }

        let content = animated_text_content(segment, time_secs);
        if content.is_empty() {
            continue;
        }

        let width = (segment.size.x * out_w).max(1.0) as f32;
        let height = (segment.size.y * out_h).max(1.0) as f32;
        let center_x = (segment.center.x * out_w) as f32;
        let center_y = (segment.center.y * out_h) as f32;
        let left = center_x - width * 0.5;
        let top = center_y - height * 0.5;

        texts.push(PreparedText {
            content,
            bounds: [left, top, left + width, top + height],
            color: parse_color(&segment.color),
            font_family: segment.font_family.clone(),
            font_size: segment.font_size,
            font_weight: segment.font_weight,
            italic: segment.italic,
            opacity,
            background_color: None,
            text_shadow: true,
            word_colors: None,
        });
    }

    texts
}

impl PreviewRenderer {
    /// Create a new preview renderer.
    ///
    /// `renderer` is the shared GPU renderer from RendererState.
    pub fn new(renderer: Arc<Renderer>, frame_tx: watch::Sender<Option<WSFrame>>) -> Self {
        let compositor = Compositor::new(&renderer);

        Self {
            renderer,
            compositor: Mutex::new(compositor),
            frame_tx,
            project: Mutex::new(None),
            decoder: Mutex::new(None),
            frame_number: Mutex::new(0),
            caption_overlay_data: RwLock::new(None),
        }
    }

    /// Set the project for rendering.
    pub async fn set_project(&self, project: VideoProject) -> Result<(), String> {
        let video_path = PathBuf::from(&project.sources.screen_video);
        if !video_path.exists() {
            return Err(format!("Video file not found: {:?}", video_path));
        }

        // Spawn async decoder
        let decoder_handle = spawn_decoder(video_path)?;

        info!(
            "Preview decoder ready: {}x{} @ {}fps",
            decoder_handle.width, decoder_handle.height, decoder_handle.fps
        );

        *self.decoder.lock().await = Some(decoder_handle);
        *self.project.lock().await = Some(project);
        // Project swap invalidates cached caption data from the previous file.
        *self.caption_overlay_data.write().await = None;
        Ok(())
    }

    /// Render a single frame at the given time.
    pub async fn render_frame(&self, time_ms: u64) -> Result<(), String> {
        let project = self.project.lock().await;
        let project = project
            .as_ref()
            .ok_or_else(|| "No project set".to_string())?;

        let decoder = self.decoder.lock().await;
        let decoder = decoder
            .as_ref()
            .ok_or_else(|| "No decoder initialized".to_string())?;

        // Request frame from async decoder
        let time_secs = time_ms as f32 / 1000.0;
        let async_frame = decoder
            .get_frame(time_secs)
            .await
            .ok_or_else(|| "Failed to decode frame".to_string())?;

        // Convert to rendering DecodedFrame type
        let frame = DecodedFrame {
            frame_number: async_frame.frame_number,
            timestamp_ms: async_frame.timestamp_ms,
            data: async_frame.data,
            width: async_frame.width,
            height: async_frame.height,
            format: PixelFormat::Rgba,
        };

        // Build render options from project
        let render_options = self.build_render_options(project);
        let prepared_texts = prepare_text_overlays(
            &project.text.segments,
            time_ms as f64 / 1000.0,
            render_options.output_width,
            render_options.output_height,
        );

        // Render frame with compositor + text overlays.
        let mut compositor = self.compositor.lock().await;
        let output_texture = compositor
            .composite_with_text(
                &self.renderer,
                &frame,
                &render_options,
                time_ms as f32,
                &prepared_texts,
            )
            .await;

        // Read rendered frame back to CPU
        let rgba_data = self
            .renderer
            .read_texture(
                &output_texture,
                render_options.output_width,
                render_options.output_height,
            )
            .await;

        // Update frame number
        let mut frame_num = self.frame_number.lock().await;
        *frame_num += 1;

        // Send frame to WebSocket
        let ws_frame = WSFrame {
            data: rgba_data,
            width: render_options.output_width,
            height: render_options.output_height,
            stride: render_options.output_width * 4,
            frame_number: *frame_num,
            target_time_ns: time_ms * 1_000_000,
            created_at: Instant::now(),
        };

        self.frame_tx.send(Some(ws_frame)).ok();

        Ok(())
    }

    /// Render caption overlay with segments and settings passed directly.
    /// Uses the same GPU pipeline as export for visual consistency.
    pub async fn render_captions_with_data(
        &self,
        time_ms: u64,
        width: u32,
        height: u32,
        segments: &[CaptionSegment],
        settings: &CaptionSettings,
    ) -> Result<(), String> {
        self.set_caption_overlay_data(segments.to_vec(), settings.clone())
            .await;
        self.render_caption_overlay_frame(time_ms, width, height)
            .await
    }

    /// Cache caption overlay data so scrub commands only send timestamp and dimensions.
    pub async fn set_caption_overlay_data(
        &self,
        segments: Vec<CaptionSegment>,
        settings: CaptionSettings,
    ) {
        *self.caption_overlay_data.write().await =
            Some(Arc::new(CaptionOverlayData { segments, settings }));
    }

    /// Render caption overlay frame using cached caption data.
    pub async fn render_caption_overlay_frame(
        &self,
        time_ms: u64,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let caption_data = self
            .caption_overlay_data
            .read()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| "Caption overlay data not set".to_string())?;

        // Prepare captions using the caption_layer module (same as export)
        let time_secs = time_ms as f32 / 1000.0;
        let prepared_captions = prepare_captions(
            &caption_data.segments,
            &caption_data.settings,
            time_secs,
            width as f32,
            height as f32,
        );

        // Render captions as text-only (transparent background)
        let mut compositor = self.compositor.lock().await;
        let output_texture = compositor.composite_text_only(width, height, &prepared_captions);

        // Read rendered frame back to CPU
        let rgba_data = self
            .renderer
            .read_texture(&output_texture, width, height)
            .await;

        // Update frame number
        let mut frame_num = self.frame_number.lock().await;
        *frame_num += 1;

        // Send frame to WebSocket
        let ws_frame = WSFrame {
            data: rgba_data,
            width,
            height,
            stride: width * 4,
            frame_number: *frame_num,
            target_time_ns: time_ms * 1_000_000,
            created_at: Instant::now(),
        };

        self.frame_tx.send(Some(ws_frame)).ok();

        Ok(())
    }

    /// Build render options from project configuration.
    /// For preview, we render at video dimensions (no padding) - CSS handles frame styling.
    fn build_render_options(&self, project: &VideoProject) -> RenderOptions {
        // Preview renders at video dimensions (CSS handles padding/background)
        let output_width = project.sources.original_width;
        let output_height = project.sources.original_height;

        // For preview: minimal styling - just render video content with text overlays
        let background = BackgroundStyle {
            background_type: BackgroundType::None,
            blur: 0.0,
            padding: 0.0,
            inset: 0,
            rounding: 0.0,
            rounding_type: CornerStyle::Rounded,
            shadow: ShadowStyle {
                enabled: false,
                shadow: 0.0,
            },
            border: BorderStyle {
                enabled: false,
                width: 0.0,
                color: [0.0, 0.0, 0.0, 0.0],
                opacity: 0.0,
            },
        };

        RenderOptions {
            output_width,
            output_height,
            use_manual_composition: false,
            zoom: ZoomState::default(),
            webcam: None,
            cursor: None,
            background,
        }
    }
}
