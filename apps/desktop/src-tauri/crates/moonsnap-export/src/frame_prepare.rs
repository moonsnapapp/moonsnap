//! Shared per-frame decode normalization and render-path preparation helpers.

use moonsnap_render::types::{DecodedFrame, PixelFormat};

use crate::frame_ops::crop_decoded_frame;
use crate::frame_path_plan::{
    decide_frame_path, nv12_gpu_crop_rect, rgba_normalization_crop, CropRectPlan, FramePathDecision,
};

/// Inputs required to normalize a decoded screen frame and plan render fast paths.
#[derive(Debug, Clone)]
pub struct PrepareFrameRequest {
    pub screen_frame: DecodedFrame,
    pub crop_enabled: bool,
    pub crop: CropRectPlan,
    pub force_even_source_crop: bool,
    pub video_width: u32,
    pub video_height: u32,
    pub camera_only_opacity: f64,
    pub has_webcam_frame: bool,
}

/// Prepared frame and path decisions for downstream GPU composition.
#[derive(Debug, Clone)]
pub struct PrepareFrameResult {
    pub screen_frame: DecodedFrame,
    pub frame_path: FramePathDecision,
    pub is_nv12: bool,
    pub use_nv12_gpu_path: bool,
    pub nv12_gpu_crop: Option<CropRectPlan>,
}

/// Normalize an input decoded frame and compute render fast-path decisions.
pub fn prepare_base_screen_frame(request: PrepareFrameRequest) -> PrepareFrameResult {
    let mut screen_frame = request.screen_frame;
    if let Some(crop_rect) = rgba_normalization_crop(
        screen_frame.format == PixelFormat::Rgba,
        request.crop_enabled,
        request.force_even_source_crop,
        request.crop,
        request.video_width,
        request.video_height,
    ) {
        screen_frame = crop_decoded_frame(
            &screen_frame,
            crop_rect.x,
            crop_rect.y,
            crop_rect.width,
            crop_rect.height,
        );
    }

    let is_nv12 = screen_frame.format == PixelFormat::Nv12;
    let frame_path = decide_frame_path(
        is_nv12,
        request.camera_only_opacity,
        request.has_webcam_frame,
    );
    let use_nv12_gpu_path = frame_path.use_nv12_gpu_path;
    let nv12_gpu_crop = if use_nv12_gpu_path {
        nv12_gpu_crop_rect(request.crop_enabled, request.crop)
    } else {
        None
    };

    PrepareFrameResult {
        screen_frame,
        frame_path,
        is_nv12,
        use_nv12_gpu_path,
        nv12_gpu_crop,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rgba_frame(width: u32, height: u32) -> DecodedFrame {
        DecodedFrame {
            frame_number: 0,
            timestamp_ms: 0,
            data: vec![255; (width * height * 4) as usize],
            width,
            height,
            format: PixelFormat::Rgba,
        }
    }

    fn make_nv12_frame(width: u32, height: u32) -> DecodedFrame {
        DecodedFrame {
            frame_number: 0,
            timestamp_ms: 0,
            data: vec![0; (width * height * 3 / 2) as usize],
            width,
            height,
            format: PixelFormat::Nv12,
        }
    }

    #[test]
    fn prepare_frame_applies_rgba_crop_when_enabled() {
        let result = prepare_base_screen_frame(PrepareFrameRequest {
            screen_frame: make_rgba_frame(1920, 1080),
            crop_enabled: true,
            crop: CropRectPlan {
                x: 100,
                y: 200,
                width: 1280,
                height: 720,
            },
            force_even_source_crop: false,
            video_width: 1280,
            video_height: 720,
            camera_only_opacity: 0.0,
            has_webcam_frame: true,
        });

        assert_eq!(result.screen_frame.width, 1280);
        assert_eq!(result.screen_frame.height, 720);
        assert!(!result.is_nv12);
    }

    #[test]
    fn prepare_frame_keeps_nv12_fast_path_when_not_transitioning() {
        let result = prepare_base_screen_frame(PrepareFrameRequest {
            screen_frame: make_nv12_frame(1920, 1080),
            crop_enabled: true,
            crop: CropRectPlan {
                x: 100,
                y: 200,
                width: 1280,
                height: 720,
            },
            force_even_source_crop: false,
            video_width: 1280,
            video_height: 720,
            camera_only_opacity: 0.0,
            has_webcam_frame: true,
        });

        assert!(result.is_nv12);
        assert!(result.use_nv12_gpu_path);
        assert_eq!(
            result.nv12_gpu_crop,
            Some(CropRectPlan {
                x: 100,
                y: 200,
                width: 1280,
                height: 720,
            })
        );
    }

    #[test]
    fn prepare_frame_disables_nv12_fast_path_during_camera_transition() {
        let result = prepare_base_screen_frame(PrepareFrameRequest {
            screen_frame: make_nv12_frame(1920, 1080),
            crop_enabled: false,
            crop: CropRectPlan {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            },
            force_even_source_crop: false,
            video_width: 1920,
            video_height: 1080,
            camera_only_opacity: 0.5,
            has_webcam_frame: true,
        });

        assert!(result.is_nv12);
        assert!(!result.use_nv12_gpu_path);
        assert!(result.nv12_gpu_crop.is_none());
        assert!(result.frame_path.needs_rgba_blend);
    }
}
