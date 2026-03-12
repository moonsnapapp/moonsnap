//! Base-frame composition helpers for export render paths.

use moonsnap_domain::video_project::VideoProject;
use moonsnap_render::types::{DecodedFrame, WebcamOverlay};
use moonsnap_render::webcam_overlay::build_webcam_overlay;

use crate::frame_ops::{blend_frames_alpha, crop_decoded_frame, scale_frame_to_fill};
use crate::frame_path_plan::{BaseRenderMode, CropRectPlan, FrameRenderPlan};

/// Inputs for deciding/rendering the base frame before GPU compositing.
pub struct FrameCompositionRequest<'a> {
    pub project: &'a VideoProject,
    pub render_plan: FrameRenderPlan,
    pub screen_frame: DecodedFrame,
    pub webcam_frame: Option<&'a DecodedFrame>,
    pub is_nv12: bool,
    pub use_nv12_gpu_path: bool,
    pub camera_only_opacity: f64,
    pub crop_enabled: bool,
    pub crop: CropRectPlan,
    pub video_width: u32,
    pub video_height: u32,
    pub composition_width: u32,
    pub composition_height: u32,
}

/// Output base frame + optional overlay for compositor input.
pub struct FrameCompositionResult {
    pub frame_to_render: Option<DecodedFrame>,
    pub webcam_overlay: Option<WebcamOverlay>,
}

/// Build base frame data and webcam overlay for the selected render mode.
pub fn build_frame_composition(req: FrameCompositionRequest<'_>) -> FrameCompositionResult {
    match req.render_plan.base_mode {
        BaseRenderMode::FullscreenWebcam => {
            // Fully in cameraOnly mode - show fullscreen webcam only.
            let webcam_frame = req
                .webcam_frame
                .expect("webcam frame required for fullscreen webcam mode");
            let scaled_frame = scale_frame_to_fill(webcam_frame, req.video_width, req.video_height);
            FrameCompositionResult {
                frame_to_render: Some(scaled_frame),
                webcam_overlay: None,
            }
        },
        BaseRenderMode::BlendScreenAndWebcam => {
            // In cameraOnly transition - blend screen and fullscreen webcam.
            let webcam_frame = req
                .webcam_frame
                .expect("webcam frame required for blend webcam mode");
            let rgba_screen = if req.is_nv12 {
                let rgba = req.screen_frame.to_rgba();
                if req.crop_enabled {
                    crop_decoded_frame(
                        &rgba,
                        req.crop.x,
                        req.crop.y,
                        req.crop.width,
                        req.crop.height,
                    )
                } else {
                    rgba
                }
            } else {
                req.screen_frame.clone()
            };
            let mut blended_frame = rgba_screen;

            // Scale webcam to fill video area (matches screen dimensions).
            let fullscreen_webcam =
                scale_frame_to_fill(webcam_frame, req.video_width, req.video_height);

            // Blend fullscreen webcam over screen with camera_only_opacity.
            blend_frames_alpha(
                &mut blended_frame,
                &fullscreen_webcam,
                req.camera_only_opacity as f32,
            );

            let webcam_overlay = if req.render_plan.webcam_overlay.enabled {
                let mut overlay = build_webcam_overlay(
                    req.project,
                    webcam_frame.clone(),
                    req.composition_width,
                    req.composition_height,
                );
                overlay.shadow_opacity *= req.render_plan.webcam_overlay.opacity;
                Some(overlay)
            } else {
                None
            };

            FrameCompositionResult {
                frame_to_render: Some(blended_frame),
                webcam_overlay,
            }
        },
        BaseRenderMode::Normal => {
            // Common path: normal screen render plus optional webcam overlay.
            let webcam_overlay = if req.render_plan.webcam_overlay.enabled {
                req.webcam_frame.map(|frame| {
                    build_webcam_overlay(
                        req.project,
                        frame.clone(),
                        req.composition_width,
                        req.composition_height,
                    )
                })
            } else {
                None
            };

            let frame_to_render = if req.use_nv12_gpu_path {
                None
            } else {
                Some(req.screen_frame)
            };

            FrameCompositionResult {
                frame_to_render,
                webcam_overlay,
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame_path_plan::WebcamOverlayPlan;
    use moonsnap_domain::captions::{CaptionSegment, CaptionSettings};
    use moonsnap_domain::video_project::{
        AnnotationConfig, AudioTrackSettings, CornerStyle, CursorConfig, ExportConfig, MaskConfig,
        SceneConfig, ShadowConfig, TextConfig, TimelineState, VideoProject, VideoSources,
        WebcamBorder, WebcamConfig, WebcamOverlayPosition, WebcamOverlayShape, ZoomConfig,
    };
    use moonsnap_render::types::PixelFormat;

    fn make_test_project() -> VideoProject {
        VideoProject {
            id: "test".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            name: "test".to_string(),
            original_file_name: None,
            quick_capture: false,
            sources: VideoSources {
                screen_video: "/tmp/screen.mp4".to_string(),
                webcam_video: Some("/tmp/webcam.mp4".to_string()),
                cursor_data: None,
                audio_file: None,
                system_audio: None,
                microphone_audio: None,
                background_music: None,
                original_width: 1920,
                original_height: 1080,
                duration_ms: 10_000,
                fps: 30,
            },
            timeline: TimelineState::default(),
            zoom: ZoomConfig::default(),
            cursor: CursorConfig::default(),
            webcam: WebcamConfig {
                enabled: true,
                position: WebcamOverlayPosition::BottomRight,
                custom_x: 0.5,
                custom_y: 0.5,
                size: 0.2,
                shape: WebcamOverlayShape::Circle,
                rounding: 100.0,
                corner_style: CornerStyle::Squircle,
                shadow: 62.5,
                shadow_config: ShadowConfig::default(),
                mirror: false,
                border: WebcamBorder {
                    enabled: false,
                    width: 0,
                    color: "#ffffff".to_string(),
                },
                visibility_segments: vec![],
            },
            audio: AudioTrackSettings::default(),
            export: ExportConfig::default(),
            scene: SceneConfig::default(),
            text: TextConfig::default(),
            annotations: AnnotationConfig::default(),
            mask: MaskConfig::default(),
            captions: CaptionSettings::default(),
            caption_segments: Vec::<CaptionSegment>::new(),
        }
    }

    fn rgba_frame(width: u32, height: u32) -> DecodedFrame {
        DecodedFrame {
            frame_number: 0,
            timestamp_ms: 0,
            data: vec![0u8; (width * height * 4) as usize],
            width,
            height,
            format: PixelFormat::Rgba,
        }
    }

    fn nv12_frame(width: u32, height: u32) -> DecodedFrame {
        let size = (width * height * 3 / 2) as usize;
        DecodedFrame {
            frame_number: 0,
            timestamp_ms: 0,
            data: vec![128u8; size],
            width,
            height,
            format: PixelFormat::Nv12,
        }
    }

    #[test]
    fn normal_mode_returns_none_for_nv12_gpu_path() {
        let project = make_test_project();
        let req = FrameCompositionRequest {
            project: &project,
            render_plan: FrameRenderPlan {
                base_mode: BaseRenderMode::Normal,
                webcam_overlay: WebcamOverlayPlan {
                    enabled: true,
                    opacity: 1.0,
                },
            },
            screen_frame: rgba_frame(4, 4),
            webcam_frame: Some(&rgba_frame(2, 2)),
            is_nv12: false,
            use_nv12_gpu_path: true,
            camera_only_opacity: 0.0,
            crop_enabled: false,
            crop: CropRectPlan {
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
            video_width: 4,
            video_height: 4,
            composition_width: 4,
            composition_height: 4,
        };

        let out = build_frame_composition(req);
        assert!(out.frame_to_render.is_none());
        assert!(out.webcam_overlay.is_some());
    }

    #[test]
    fn blend_mode_converts_nv12_and_scales_overlay_opacity() {
        let project = make_test_project();
        let webcam = rgba_frame(4, 2);
        let req = FrameCompositionRequest {
            project: &project,
            render_plan: FrameRenderPlan {
                base_mode: BaseRenderMode::BlendScreenAndWebcam,
                webcam_overlay: WebcamOverlayPlan {
                    enabled: true,
                    opacity: 0.5,
                },
            },
            screen_frame: nv12_frame(4, 2),
            webcam_frame: Some(&webcam),
            is_nv12: true,
            use_nv12_gpu_path: false,
            camera_only_opacity: 0.4,
            crop_enabled: true,
            crop: CropRectPlan {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            },
            video_width: 2,
            video_height: 2,
            composition_width: 4,
            composition_height: 4,
        };

        let out = build_frame_composition(req);
        let frame = out.frame_to_render.expect("blended frame");
        assert_eq!(frame.width, 2);
        assert_eq!(frame.height, 2);
        let overlay = out.webcam_overlay.expect("webcam overlay");
        // default shadow opacity from project is 0.3125, scaled by 0.5 = 0.15625
        assert!((overlay.shadow_opacity - 0.15625).abs() < 0.0001);
    }

    #[test]
    fn fullscreen_webcam_mode_returns_scaled_webcam_without_overlay() {
        let project = make_test_project();
        let webcam = rgba_frame(6, 4);
        let req = FrameCompositionRequest {
            project: &project,
            render_plan: FrameRenderPlan {
                base_mode: BaseRenderMode::FullscreenWebcam,
                webcam_overlay: WebcamOverlayPlan {
                    enabled: false,
                    opacity: 1.0,
                },
            },
            screen_frame: rgba_frame(8, 6),
            webcam_frame: Some(&webcam),
            is_nv12: false,
            use_nv12_gpu_path: false,
            camera_only_opacity: 1.0,
            crop_enabled: false,
            crop: CropRectPlan {
                x: 0,
                y: 0,
                width: 8,
                height: 6,
            },
            video_width: 8,
            video_height: 6,
            composition_width: 8,
            composition_height: 6,
        };

        let out = build_frame_composition(req);
        let frame = out.frame_to_render.expect("fullscreen webcam frame");
        assert_eq!(frame.width, 8);
        assert_eq!(frame.height, 6);
        assert!(out.webcam_overlay.is_none());
    }
}
