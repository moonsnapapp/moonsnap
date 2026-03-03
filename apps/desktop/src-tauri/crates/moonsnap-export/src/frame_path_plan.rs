//! Frame-path planning helpers for decode/render fast paths.

use moonsnap_domain::video_project::SceneMode;

/// Decision for how a decoded frame should flow through the exporter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FramePathDecision {
    pub needs_rgba_blend: bool,
    pub needs_fullscreen_webcam: bool,
    pub use_nv12_gpu_path: bool,
}

/// Generic crop rectangle used by frame normalization/crop planning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CropRectPlan {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// High-level base-frame render branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseRenderMode {
    FullscreenWebcam,
    BlendScreenAndWebcam,
    Normal,
}

/// Plan for optional webcam overlay compositing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WebcamOverlayPlan {
    pub enabled: bool,
    pub opacity: f32,
}

/// Combined per-frame render decision for base frame + optional overlay.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameRenderPlan {
    pub base_mode: BaseRenderMode,
    pub webcam_overlay: WebcamOverlayPlan,
}

/// NV12 fast path requires even dimensions for stable chroma sampling/strides.
/// Also requires even crop alignment when crop is active.
pub fn can_use_nv12_fast_path(
    source_width: u32,
    source_height: u32,
    crop_enabled: bool,
    crop_x: u32,
    crop_y: u32,
    crop_width: u32,
    crop_height: u32,
) -> bool {
    let even_source = source_width.is_multiple_of(2) && source_height.is_multiple_of(2);
    if !even_source {
        return false;
    }

    if !crop_enabled {
        return true;
    }

    crop_x.is_multiple_of(2)
        && crop_y.is_multiple_of(2)
        && crop_width.is_multiple_of(2)
        && crop_height.is_multiple_of(2)
}

/// Decide which per-frame render path to use based on scene transition and input format.
pub fn decide_frame_path(
    is_nv12: bool,
    camera_only_opacity: f64,
    has_webcam_frame: bool,
) -> FramePathDecision {
    let needs_rgba_blend =
        camera_only_opacity > 0.01 && camera_only_opacity <= 0.99 && has_webcam_frame;
    let needs_fullscreen_webcam = camera_only_opacity > 0.99 && has_webcam_frame;
    let use_nv12_gpu_path = is_nv12 && !needs_rgba_blend && !needs_fullscreen_webcam;

    FramePathDecision {
        needs_rgba_blend,
        needs_fullscreen_webcam,
        use_nv12_gpu_path,
    }
}

/// Decide frame render mode and webcam overlay visibility/opacity.
pub fn plan_frame_render(
    scene_mode: SceneMode,
    frame_path: FramePathDecision,
    webcam_visible: bool,
    regular_camera_opacity: f64,
) -> FrameRenderPlan {
    let overlay_opacity = regular_camera_opacity as f32;
    let overlay_enabled = webcam_visible && regular_camera_opacity > 0.01;

    if frame_path.needs_fullscreen_webcam {
        return FrameRenderPlan {
            base_mode: BaseRenderMode::FullscreenWebcam,
            webcam_overlay: WebcamOverlayPlan {
                enabled: false,
                opacity: overlay_opacity,
            },
        };
    }

    if frame_path.needs_rgba_blend {
        return FrameRenderPlan {
            base_mode: BaseRenderMode::BlendScreenAndWebcam,
            webcam_overlay: WebcamOverlayPlan {
                enabled: overlay_enabled,
                opacity: overlay_opacity,
            },
        };
    }

    let normal_overlay_enabled = scene_mode != SceneMode::ScreenOnly && overlay_enabled;
    FrameRenderPlan {
        base_mode: BaseRenderMode::Normal,
        webcam_overlay: WebcamOverlayPlan {
            enabled: normal_overlay_enabled,
            opacity: overlay_opacity,
        },
    }
}

/// Decide if an RGBA decoded frame should be CPU-cropped before composition.
pub fn rgba_normalization_crop(
    is_rgba: bool,
    crop_enabled: bool,
    force_even_source_crop: bool,
    crop: CropRectPlan,
    video_width: u32,
    video_height: u32,
) -> Option<CropRectPlan> {
    if !is_rgba {
        return None;
    }
    if crop_enabled {
        return Some(crop);
    }
    if force_even_source_crop {
        return Some(CropRectPlan {
            x: 0,
            y: 0,
            width: video_width,
            height: video_height,
        });
    }
    None
}

/// Decide if NV12 GPU conversion should receive a crop rect.
pub fn nv12_gpu_crop_rect(crop_enabled: bool, crop: CropRectPlan) -> Option<CropRectPlan> {
    if crop_enabled {
        Some(crop)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nv12_fast_path_requires_even_source_and_crop() {
        assert!(can_use_nv12_fast_path(1920, 1080, false, 0, 0, 0, 0));
        assert!(!can_use_nv12_fast_path(1919, 1080, false, 0, 0, 0, 0));
        assert!(!can_use_nv12_fast_path(1920, 1079, false, 0, 0, 0, 0));
        assert!(can_use_nv12_fast_path(
            1920, 1080, true, 100, 200, 1280, 720
        ));
        assert!(!can_use_nv12_fast_path(
            1920, 1080, true, 101, 200, 1280, 720
        ));
        assert!(!can_use_nv12_fast_path(
            1920, 1080, true, 100, 201, 1280, 720
        ));
        assert!(!can_use_nv12_fast_path(
            1920, 1080, true, 100, 200, 1279, 720
        ));
        assert!(!can_use_nv12_fast_path(
            1920, 1080, true, 100, 200, 1280, 721
        ));
    }

    #[test]
    fn frame_path_uses_nv12_for_common_case() {
        let plan = decide_frame_path(true, 0.0, true);
        assert_eq!(
            plan,
            FramePathDecision {
                needs_rgba_blend: false,
                needs_fullscreen_webcam: false,
                use_nv12_gpu_path: true,
            }
        );
    }

    #[test]
    fn frame_path_switches_to_rgba_for_camera_transition() {
        let plan = decide_frame_path(true, 0.5, true);
        assert_eq!(
            plan,
            FramePathDecision {
                needs_rgba_blend: true,
                needs_fullscreen_webcam: false,
                use_nv12_gpu_path: false,
            }
        );
    }

    #[test]
    fn frame_path_switches_to_fullscreen_webcam_when_fully_transitioned() {
        let plan = decide_frame_path(true, 1.0, true);
        assert_eq!(
            plan,
            FramePathDecision {
                needs_rgba_blend: false,
                needs_fullscreen_webcam: true,
                use_nv12_gpu_path: false,
            }
        );
    }

    #[test]
    fn rgba_normalization_uses_crop_when_enabled() {
        let crop = CropRectPlan {
            x: 10,
            y: 20,
            width: 1280,
            height: 720,
        };
        let plan = rgba_normalization_crop(true, true, false, crop, 1920, 1080);
        assert_eq!(plan, Some(crop));
    }

    #[test]
    fn rgba_normalization_uses_even_source_crop_when_needed() {
        let crop = CropRectPlan {
            x: 10,
            y: 20,
            width: 1280,
            height: 720,
        };
        let plan = rgba_normalization_crop(true, false, true, crop, 1918, 1078);
        assert_eq!(
            plan,
            Some(CropRectPlan {
                x: 0,
                y: 0,
                width: 1918,
                height: 1078
            })
        );
    }

    #[test]
    fn rgba_normalization_none_for_non_rgba_or_no_adjustment() {
        let crop = CropRectPlan {
            x: 10,
            y: 20,
            width: 1280,
            height: 720,
        };
        assert_eq!(
            rgba_normalization_crop(false, true, true, crop, 1920, 1080),
            None
        );
        assert_eq!(
            rgba_normalization_crop(true, false, false, crop, 1920, 1080),
            None
        );
    }

    #[test]
    fn nv12_gpu_crop_rect_only_when_crop_enabled() {
        let crop = CropRectPlan {
            x: 10,
            y: 20,
            width: 1280,
            height: 720,
        };
        assert_eq!(nv12_gpu_crop_rect(true, crop), Some(crop));
        assert_eq!(nv12_gpu_crop_rect(false, crop), None);
    }

    #[test]
    fn frame_render_plan_for_fullscreen_webcam() {
        let path = decide_frame_path(true, 1.0, true);
        let plan = plan_frame_render(SceneMode::Default, path, true, 1.0);
        assert_eq!(plan.base_mode, BaseRenderMode::FullscreenWebcam);
        assert!(!plan.webcam_overlay.enabled);
    }

    #[test]
    fn frame_render_plan_for_blend_transition_with_overlay() {
        let path = decide_frame_path(true, 0.5, true);
        let plan = plan_frame_render(SceneMode::Default, path, true, 0.6);
        assert_eq!(plan.base_mode, BaseRenderMode::BlendScreenAndWebcam);
        assert!(plan.webcam_overlay.enabled);
        assert!((plan.webcam_overlay.opacity - 0.6).abs() < 0.0001);
    }

    #[test]
    fn frame_render_plan_disables_normal_overlay_in_screen_only() {
        let path = decide_frame_path(true, 0.0, true);
        let plan = plan_frame_render(SceneMode::ScreenOnly, path, true, 1.0);
        assert_eq!(plan.base_mode, BaseRenderMode::Normal);
        assert!(!plan.webcam_overlay.enabled);
    }
}
