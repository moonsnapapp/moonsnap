//! Webcam overlay planning and visibility helpers.

use crate::types::{DecodedFrame, WebcamOverlay, WebcamShape};
use moonsnap_domain::video_project::{VideoProject, WebcamOverlayPosition, WebcamOverlayShape};

/// Build webcam overlay from frame and project settings.
/// Positioning logic matches WebcamOverlay.tsx exactly for WYSIWYG export.
pub fn build_webcam_overlay(
    project: &VideoProject,
    frame: DecodedFrame,
    out_w: u32,
    out_h: u32,
) -> WebcamOverlay {
    const MARGIN_PX: f32 = 16.0;

    let webcam_aspect = frame.width as f32 / frame.height as f32;
    let use_source_aspect = matches!(project.webcam.shape, WebcamOverlayShape::Source);
    let base_size_px = out_w as f32 * project.webcam.size;

    let (webcam_width_px, webcam_height_px) = if use_source_aspect {
        if webcam_aspect >= 1.0 {
            (base_size_px * webcam_aspect, base_size_px)
        } else {
            (base_size_px, base_size_px / webcam_aspect)
        }
    } else if matches!(project.webcam.shape, WebcamOverlayShape::Rectangle) {
        (base_size_px * (16.0 / 9.0), base_size_px)
    } else {
        (base_size_px, base_size_px)
    };

    let (left_px, top_px) = match project.webcam.position {
        WebcamOverlayPosition::TopLeft => (MARGIN_PX, MARGIN_PX),
        WebcamOverlayPosition::TopRight => (out_w as f32 - webcam_width_px - MARGIN_PX, MARGIN_PX),
        WebcamOverlayPosition::BottomLeft => {
            (MARGIN_PX, out_h as f32 - webcam_height_px - MARGIN_PX)
        },
        WebcamOverlayPosition::BottomRight => (
            out_w as f32 - webcam_width_px - MARGIN_PX,
            out_h as f32 - webcam_height_px - MARGIN_PX,
        ),
        WebcamOverlayPosition::Custom => {
            let custom_x = project.webcam.custom_x;
            let custom_y = project.webcam.custom_y;

            let left = if custom_x <= 0.1 {
                MARGIN_PX
            } else if custom_x >= 0.9 {
                out_w as f32 - webcam_width_px - MARGIN_PX
            } else {
                custom_x * out_w as f32 - webcam_width_px / 2.0
            };

            let top = if custom_y <= 0.1 {
                MARGIN_PX
            } else if custom_y >= 0.9 {
                out_h as f32 - webcam_height_px - MARGIN_PX
            } else {
                custom_y * out_h as f32 - webcam_height_px / 2.0
            };

            (left, top)
        },
    };

    let x_norm = left_px / out_w as f32;
    let y_norm = top_px / out_h as f32;

    log::debug!(
        "[EXPORT] Webcam: {}x{} aspect={:.3}, overlay={}x{}px, pos=({:.0},{:.0})px norm=({:.3},{:.3}), source_aspect={}",
        frame.width,
        frame.height,
        webcam_aspect,
        webcam_width_px,
        webcam_height_px,
        left_px,
        top_px,
        x_norm,
        y_norm,
        use_source_aspect
    );

    let shape = match project.webcam.shape {
        WebcamOverlayShape::Circle => WebcamShape::Circle,
        WebcamOverlayShape::Rectangle => WebcamShape::Rectangle,
        WebcamOverlayShape::RoundedRectangle | WebcamOverlayShape::Source => WebcamShape::Squircle,
    };

    let strength = project.webcam.shadow / 100.0;
    let shadow = strength;
    let shadow_size = 0.15;
    let shadow_opacity = strength * 0.5;
    let shadow_blur = 0.15;

    WebcamOverlay {
        frame,
        x: x_norm,
        y: y_norm,
        size: project.webcam.size,
        shape,
        mirror: project.webcam.mirror,
        use_source_aspect,
        shadow,
        shadow_size,
        shadow_opacity,
        shadow_blur,
    }
}

/// Check if webcam should be visible at a specific timestamp.
pub fn is_webcam_visible_at(project: &VideoProject, timestamp_ms: u64) -> bool {
    if !project.webcam.enabled {
        return false;
    }
    if project.webcam.visibility_segments.is_empty() {
        return true;
    }

    let mut is_visible = true;
    for segment in &project.webcam.visibility_segments {
        if timestamp_ms >= segment.start_ms && timestamp_ms < segment.end_ms {
            is_visible = segment.visible;
        }
    }

    is_visible
}

#[cfg(test)]
mod tests {
    use super::*;
    use moonsnap_domain::captions::{CaptionSegment, CaptionSettings};
    use moonsnap_domain::video_project::{
        AudioTrackSettings, CornerStyle, CursorConfig, ExportConfig, MaskConfig, SceneConfig,
        ShadowConfig, TextConfig, TimelineState, VideoSources, WebcamBorder, WebcamConfig,
        ZoomConfig,
    };

    fn make_project(
        position: WebcamOverlayPosition,
        size: f32,
        custom_x: f32,
        custom_y: f32,
    ) -> VideoProject {
        VideoProject {
            id: "test".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            name: "test".to_string(),
            sources: VideoSources {
                screen_video: "screen.mp4".to_string(),
                webcam_video: Some("webcam.mp4".to_string()),
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
                position,
                custom_x,
                custom_y,
                size,
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
            mask: MaskConfig::default(),
            captions: CaptionSettings::default(),
            caption_segments: Vec::<CaptionSegment>::new(),
        }
    }

    fn make_test_frame(width: u32, height: u32) -> DecodedFrame {
        DecodedFrame {
            frame_number: 0,
            timestamp_ms: 0,
            data: vec![0u8; (width * height * 4) as usize],
            width,
            height,
            format: crate::types::PixelFormat::Rgba,
        }
    }

    #[test]
    fn webcam_overlay_bottom_right_position_matches_preview_math() {
        let project = make_project(WebcamOverlayPosition::BottomRight, 0.2, 0.0, 0.0);
        let out_w = 2262u32;
        let out_h = 1228u32;
        let overlay = build_webcam_overlay(&project, make_test_frame(1280, 720), out_w, out_h);

        let webcam_size_px = out_w as f32 * 0.2;
        let expected_x = out_w as f32 - webcam_size_px - 16.0;
        let expected_y = out_h as f32 - webcam_size_px - 16.0;
        let actual_x = overlay.x * out_w as f32;
        let actual_y = overlay.y * out_h as f32;

        assert!((actual_x - expected_x).abs() < 1.0);
        assert!((actual_y - expected_y).abs() < 1.0);
    }

    #[test]
    fn webcam_visibility_defaults_to_true_when_segments_empty() {
        let project = make_project(WebcamOverlayPosition::TopLeft, 0.2, 0.0, 0.0);
        assert!(is_webcam_visible_at(&project, 0));
        assert!(is_webcam_visible_at(&project, 50_000));
    }
}
