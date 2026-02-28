//! Shared per-frame overlay planning (render options + caption preparation).

use snapit_domain::captions::{CaptionSegment, CaptionSettings};
use snapit_domain::video_project::TextSegment;
use snapit_render::caption_layer::prepare_captions;
use snapit_render::prerendered_text::PreRenderedTextStore;
use snapit_render::text::PreparedText;
use snapit_render::types::{BackgroundStyle, RenderOptions, TextOverlayQuad, WebcamOverlay};
use snapit_render::ZoomState;

/// Inputs required to build render options and caption overlays for one frame.
#[derive(Debug, Clone)]
pub struct FrameOverlayRequest<'a> {
    pub relative_time_ms: u64,
    pub composition_width: u32,
    pub composition_height: u32,
    pub use_manual_composition: bool,
    pub zoom_state: ZoomState,
    pub webcam_overlay: Option<WebcamOverlay>,
    pub background_style: &'a BackgroundStyle,
    pub timeline_captions: &'a [CaptionSegment],
    pub caption_settings: &'a CaptionSettings,
}

/// Planned per-frame overlays consumed by compositor submission.
#[derive(Debug, Clone)]
pub struct FrameOverlayPlan {
    pub render_options: RenderOptions,
    pub frame_time_secs: f64,
    pub prepared_captions: Vec<PreparedText>,
}

/// Inputs for pre-rendered GPU text overlay quad planning.
#[derive(Debug, Clone)]
pub struct FrameTextOverlayRequest<'a> {
    pub frame_time_secs: f64,
    pub text_segments: &'a [TextSegment],
    pub composition_width: u32,
    pub composition_height: u32,
    pub video_frame_x: u32,
    pub video_frame_y: u32,
    pub video_frame_width: u32,
    pub video_frame_height: u32,
    pub zoom_state: ZoomState,
}

/// Build render options and prepared caption overlays for a frame.
pub fn build_frame_overlay_plan(request: FrameOverlayRequest<'_>) -> FrameOverlayPlan {
    let frame_time_secs = request.relative_time_ms as f64 / 1000.0;
    let prepared_captions = if request.caption_settings.enabled {
        prepare_captions(
            request.timeline_captions,
            request.caption_settings,
            frame_time_secs as f32,
            request.composition_width as f32,
            request.composition_height as f32,
        )
    } else {
        Vec::new()
    };

    let render_options = RenderOptions {
        output_width: request.composition_width,
        output_height: request.composition_height,
        use_manual_composition: request.use_manual_composition,
        zoom: request.zoom_state,
        webcam: request.webcam_overlay,
        cursor: None,
        background: request.background_style.clone(),
    };

    FrameOverlayPlan {
        render_options,
        frame_time_secs,
        prepared_captions,
    }
}

/// Build pre-rendered text overlay quads for one frame.
pub fn build_frame_text_overlay_quads(
    store: &PreRenderedTextStore,
    request: FrameTextOverlayRequest<'_>,
) -> Vec<TextOverlayQuad> {
    store.get_gpu_quads_for_frame(
        request.frame_time_secs,
        request.text_segments,
        request.composition_width,
        request.composition_height,
        request.video_frame_x,
        request.video_frame_y,
        request.video_frame_width,
        request.video_frame_height,
        request.zoom_state,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapit_domain::captions::CaptionWord;
    use snapit_render::prerendered_text::{LineMetric, PreRenderedTextImage};
    use snapit_render::types::{DecodedFrame, PixelFormat, WebcamShape};
    use std::sync::Arc;

    fn sample_caption_segment() -> CaptionSegment {
        CaptionSegment {
            id: "seg-1".to_string(),
            start: 0.0,
            end: 2.0,
            text: "hello world".to_string(),
            words: vec![
                CaptionWord {
                    text: "hello".to_string(),
                    start: 0.0,
                    end: 1.0,
                },
                CaptionWord {
                    text: "world".to_string(),
                    start: 1.0,
                    end: 2.0,
                },
            ],
        }
    }

    fn sample_webcam_overlay() -> WebcamOverlay {
        WebcamOverlay {
            frame: DecodedFrame {
                frame_number: 0,
                timestamp_ms: 0,
                data: vec![0; 4 * 4 * 4],
                width: 4,
                height: 4,
                format: PixelFormat::Rgba,
            },
            x: 0.1,
            y: 0.2,
            size: 0.3,
            shape: WebcamShape::Circle,
            mirror: false,
            use_source_aspect: false,
            shadow: 0.0,
            shadow_size: 0.0,
            shadow_opacity: 0.0,
            shadow_blur: 0.0,
        }
    }

    fn sample_text_store() -> PreRenderedTextStore {
        let mut store = PreRenderedTextStore::new();
        store.register(PreRenderedTextImage {
            segment_index: 0,
            width: 64,
            height: 16,
            center_x: 0.5,
            center_y: 0.5,
            size_x: 0.0,
            size_y: 0.0,
            rgba_data: Arc::new(vec![255; 64 * 16 * 4]),
            line_metrics: vec![LineMetric {
                top_px: 0,
                height_px: 16,
                cumulative_chars: 5,
                content_width_px: 64,
                reveal_widths_px: vec![12, 24, 36, 48, 64],
            }],
        });
        store
    }

    #[test]
    fn overlay_plan_sets_render_options_and_frame_time() {
        let background = BackgroundStyle {
            padding: 24.0,
            ..BackgroundStyle::default()
        };
        let plan = build_frame_overlay_plan(FrameOverlayRequest {
            relative_time_ms: 1_500,
            composition_width: 1920,
            composition_height: 1080,
            use_manual_composition: true,
            zoom_state: ZoomState::identity(),
            webcam_overlay: Some(sample_webcam_overlay()),
            background_style: &background,
            timeline_captions: &[],
            caption_settings: &CaptionSettings::default(),
        });

        assert!((plan.frame_time_secs - 1.5).abs() < f64::EPSILON);
        assert_eq!(plan.render_options.output_width, 1920);
        assert_eq!(plan.render_options.output_height, 1080);
        assert!(plan.render_options.use_manual_composition);
        assert!(plan.render_options.webcam.is_some());
        assert!((plan.render_options.background.padding - 24.0).abs() < f32::EPSILON);
    }

    #[test]
    fn overlay_plan_skips_captions_when_disabled() {
        let captions = vec![sample_caption_segment()];
        let settings = CaptionSettings::default();
        let plan = build_frame_overlay_plan(FrameOverlayRequest {
            relative_time_ms: 500,
            composition_width: 1280,
            composition_height: 720,
            use_manual_composition: false,
            zoom_state: ZoomState::identity(),
            webcam_overlay: None,
            background_style: &BackgroundStyle::default(),
            timeline_captions: &captions,
            caption_settings: &settings,
        });

        assert!(plan.prepared_captions.is_empty());
    }

    #[test]
    fn overlay_plan_prepares_captions_when_enabled_and_active() {
        let captions = vec![sample_caption_segment()];
        let settings = CaptionSettings {
            enabled: true,
            ..CaptionSettings::default()
        };
        let plan = build_frame_overlay_plan(FrameOverlayRequest {
            relative_time_ms: 1_000,
            composition_width: 1280,
            composition_height: 720,
            use_manual_composition: false,
            zoom_state: ZoomState::identity(),
            webcam_overlay: None,
            background_style: &BackgroundStyle::default(),
            timeline_captions: &captions,
            caption_settings: &settings,
        });

        assert!(!plan.prepared_captions.is_empty());
    }

    #[test]
    fn text_overlay_quads_empty_when_store_has_no_images() {
        let store = PreRenderedTextStore::new();
        let quads = build_frame_text_overlay_quads(
            &store,
            FrameTextOverlayRequest {
                frame_time_secs: 1.0,
                text_segments: &[],
                composition_width: 1280,
                composition_height: 720,
                video_frame_x: 0,
                video_frame_y: 0,
                video_frame_width: 1280,
                video_frame_height: 720,
                zoom_state: ZoomState::identity(),
            },
        );
        assert!(quads.is_empty());
    }

    #[test]
    fn text_overlay_quads_generated_for_active_segment() {
        let store = sample_text_store();
        let segments = vec![TextSegment {
            start: 0.0,
            end: 2.0,
            enabled: true,
            content: "hello".to_string(),
            center: snapit_domain::video_project::XY { x: 0.5, y: 0.5 },
            size: snapit_domain::video_project::XY { x: 0.3, y: 0.1 },
            font_family: "Arial".to_string(),
            font_size: 42.0,
            font_weight: 500.0,
            italic: false,
            color: "#ffffff".to_string(),
            fade_duration: 0.2,
            animation: snapit_domain::video_project::TextAnimation::None,
            typewriter_chars_per_second: 24.0,
            typewriter_sound_enabled: false,
        }];

        let quads = build_frame_text_overlay_quads(
            &store,
            FrameTextOverlayRequest {
                frame_time_secs: 1.0,
                text_segments: &segments,
                composition_width: 1280,
                composition_height: 720,
                video_frame_x: 0,
                video_frame_y: 0,
                video_frame_width: 1280,
                video_frame_height: 720,
                zoom_state: ZoomState::identity(),
            },
        );
        assert_eq!(quads.len(), 1);
        assert_eq!(quads[0].texture_index, 0);
    }
}
