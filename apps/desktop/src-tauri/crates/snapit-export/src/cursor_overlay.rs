//! Reusable per-frame CPU cursor overlay compositing for export pipelines.

use snapit_domain::video_project::CursorType;
use snapit_render::cursor_composite::{
    composite_cursor, composite_cursor_with_motion_blur, CursorCompositeInput,
    CursorCompositeState, DecodedCursorImage, VideoContentBounds,
};
use snapit_render::cursor_plan::{
    plan_cursor_geometry, plan_cursor_raster_source, should_composite_cursor, CursorCropPlan,
    CursorGeometryPlanRequest, CursorRasterSource,
};
use snapit_render::ZoomState;

use crate::frame_ops::{draw_cursor_circle, CursorCircleStyle, FrameContentBounds};

/// Static cursor-overlay context shared across export frames.
#[derive(Debug, Clone, Copy)]
pub struct CursorOverlayContext {
    pub composition_w: u32,
    pub composition_h: u32,
    pub crop_enabled: bool,
    pub crop_x: u32,
    pub crop_y: u32,
    pub crop_width: u32,
    pub crop_height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub video_bounds: VideoContentBounds,
    pub cursor_type: CursorType,
    pub cursor_scale: f32,
    pub cursor_motion_blur: f32,
}

/// Cursor sample for a single source-time frame.
#[derive(Debug, Clone, Copy)]
pub struct CursorFrameSample<'a, TShape> {
    pub x: f32,
    pub y: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub opacity: f32,
    pub scale: f32,
    pub cursor_id: Option<&'a str>,
    pub cursor_shape: Option<TShape>,
}

#[derive(Debug, Clone, Copy)]
pub struct CursorOverlayFrameRequest<'a, TShape> {
    pub camera_only_opacity: f64,
    pub zoom_state: ZoomState,
    pub sample: CursorFrameSample<'a, TShape>,
    pub fallback_shape: TShape,
}

/// Composite cursor overlay into an RGBA export frame.
///
/// Shape/bitmap lookup and fallback shape resolution are injected via callbacks to
/// keep this helper runtime-agnostic and app-shell independent.
pub fn composite_cursor_overlay_frame<'sample, 'img, TShape: Copy, FShape, FBitmap>(
    rgba_data: &mut [u8],
    context: &CursorOverlayContext,
    request: CursorOverlayFrameRequest<'sample, TShape>,
    mut shape_provider: FShape,
    mut bitmap_provider: FBitmap,
) where
    FShape: FnMut(TShape, u32) -> Option<DecodedCursorImage>,
    FBitmap: FnMut(&str) -> Option<&'img DecodedCursorImage>,
{
    if !should_composite_cursor(request.camera_only_opacity) {
        return;
    }

    let sample = request.sample;
    let Some(cursor_plan) = plan_cursor_geometry(CursorGeometryPlanRequest {
        cursor_x: sample.x,
        cursor_y: sample.y,
        zoom: request.zoom_state,
        crop: CursorCropPlan {
            enabled: context.crop_enabled,
            x: context.crop_x,
            y: context.crop_y,
            width: context.crop_width,
            height: context.crop_height,
            original_width: context.original_width,
            original_height: context.original_height,
        },
        composition_height: context.composition_h,
        cursor_scale: context.cursor_scale,
    }) else {
        return;
    };

    let cursor_state = CursorCompositeState {
        x: cursor_plan.x,
        y: cursor_plan.y,
        velocity_x: sample.velocity_x,
        velocity_y: sample.velocity_y,
        opacity: sample.opacity,
        scale: sample.scale,
    };

    if context.cursor_type == CursorType::Circle {
        let frame_bounds = FrameContentBounds {
            x: context.video_bounds.x,
            y: context.video_bounds.y,
            width: context.video_bounds.width,
            height: context.video_bounds.height,
        };
        draw_cursor_circle(
            rgba_data,
            context.composition_w,
            context.composition_h,
            &frame_bounds,
            cursor_state.x,
            cursor_state.y,
            CursorCircleStyle {
                scale: context.cursor_scale,
                opacity: cursor_state.opacity,
            },
        );
        return;
    }

    let final_cursor_height = cursor_plan.target_height_px;
    let target_height = final_cursor_height.round() as u32;
    let mut shape_svg = sample
        .cursor_shape
        .and_then(|shape| shape_provider(shape, target_height));
    let bitmap_cursor = sample.cursor_id.and_then(&mut bitmap_provider);

    match plan_cursor_raster_source(shape_svg.is_some(), bitmap_cursor.is_some()) {
        CursorRasterSource::SvgShape => {
            let svg_decoded = shape_svg.take().expect("shape svg should exist");
            if context.cursor_motion_blur > 0.0 {
                composite_cursor_with_motion_blur(
                    CursorCompositeInput {
                        frame_data: rgba_data,
                        frame_width: context.composition_w,
                        frame_height: context.composition_h,
                        video_bounds: &context.video_bounds,
                        cursor: &cursor_state,
                        cursor_image: &svg_decoded,
                        base_scale: 1.0,
                    },
                    context.cursor_motion_blur,
                );
            } else {
                composite_cursor(
                    rgba_data,
                    context.composition_w,
                    context.composition_h,
                    &context.video_bounds,
                    &cursor_state,
                    &svg_decoded,
                    1.0,
                );
            }
        },
        CursorRasterSource::BitmapImage => {
            let cursor_image = bitmap_cursor.expect("bitmap cursor should exist");
            let bitmap_scale = final_cursor_height / cursor_image.height as f32;
            if context.cursor_motion_blur > 0.0 {
                composite_cursor_with_motion_blur(
                    CursorCompositeInput {
                        frame_data: rgba_data,
                        frame_width: context.composition_w,
                        frame_height: context.composition_h,
                        video_bounds: &context.video_bounds,
                        cursor: &cursor_state,
                        cursor_image,
                        base_scale: bitmap_scale,
                    },
                    context.cursor_motion_blur,
                );
            } else {
                composite_cursor(
                    rgba_data,
                    context.composition_w,
                    context.composition_h,
                    &context.video_bounds,
                    &cursor_state,
                    cursor_image,
                    bitmap_scale,
                );
            }
        },
        CursorRasterSource::FallbackArrow => {
            if let Some(svg_decoded) = shape_provider(request.fallback_shape, target_height) {
                if context.cursor_motion_blur > 0.0 {
                    composite_cursor_with_motion_blur(
                        CursorCompositeInput {
                            frame_data: rgba_data,
                            frame_width: context.composition_w,
                            frame_height: context.composition_h,
                            video_bounds: &context.video_bounds,
                            cursor: &cursor_state,
                            cursor_image: &svg_decoded,
                            base_scale: 1.0,
                        },
                        context.cursor_motion_blur,
                    );
                } else {
                    composite_cursor(
                        rgba_data,
                        context.composition_w,
                        context.composition_h,
                        &context.video_bounds,
                        &cursor_state,
                        &svg_decoded,
                        1.0,
                    );
                }
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum DummyShape {
        Arrow,
    }

    fn sample_decoded_cursor(size: u32) -> DecodedCursorImage {
        let mut data = vec![0u8; (size * size * 4) as usize];
        for chunk in data.chunks_exact_mut(4) {
            chunk[0] = 255;
            chunk[1] = 255;
            chunk[2] = 255;
            chunk[3] = 255;
        }
        DecodedCursorImage {
            width: size,
            height: size,
            hotspot_x: (size / 2) as i32,
            hotspot_y: (size / 2) as i32,
            data,
        }
    }

    fn default_context(cursor_type: CursorType) -> CursorOverlayContext {
        CursorOverlayContext {
            composition_w: 128,
            composition_h: 128,
            crop_enabled: false,
            crop_x: 0,
            crop_y: 0,
            crop_width: 128,
            crop_height: 128,
            original_width: 128,
            original_height: 128,
            video_bounds: VideoContentBounds::full_frame(128, 128),
            cursor_type,
            cursor_scale: 1.0,
            cursor_motion_blur: 0.0,
        }
    }

    fn default_sample() -> CursorFrameSample<'static, DummyShape> {
        CursorFrameSample {
            x: 0.5,
            y: 0.5,
            velocity_x: 0.0,
            velocity_y: 0.0,
            opacity: 1.0,
            scale: 1.0,
            cursor_id: None,
            cursor_shape: Some(DummyShape::Arrow),
        }
    }

    #[test]
    fn skips_when_camera_only() {
        let mut rgba = vec![0u8; (128 * 128 * 4) as usize];
        composite_cursor_overlay_frame(
            &mut rgba,
            &default_context(CursorType::Auto),
            CursorOverlayFrameRequest {
                camera_only_opacity: 1.0,
                zoom_state: ZoomState::identity(),
                sample: default_sample(),
                fallback_shape: DummyShape::Arrow,
            },
            |_shape, _target_height| Some(sample_decoded_cursor(12)),
            |_cursor_id| None,
        );
        assert!(!rgba.iter().any(|v| *v > 0));
    }

    #[test]
    fn composites_circle_mode() {
        let mut rgba = vec![0u8; (128 * 128 * 4) as usize];
        composite_cursor_overlay_frame(
            &mut rgba,
            &default_context(CursorType::Circle),
            CursorOverlayFrameRequest {
                camera_only_opacity: 0.0,
                zoom_state: ZoomState::identity(),
                sample: default_sample(),
                fallback_shape: DummyShape::Arrow,
            },
            |_shape, _target_height| None,
            |_cursor_id| None,
        );
        assert!(rgba.iter().any(|v| *v > 0));
    }

    #[test]
    fn falls_back_to_shape_when_bitmap_missing() {
        let mut rgba = vec![0u8; (128 * 128 * 4) as usize];
        let sample = CursorFrameSample {
            cursor_shape: None,
            ..default_sample()
        };
        composite_cursor_overlay_frame(
            &mut rgba,
            &default_context(CursorType::Auto),
            CursorOverlayFrameRequest {
                camera_only_opacity: 0.0,
                zoom_state: ZoomState::identity(),
                sample,
                fallback_shape: DummyShape::Arrow,
            },
            |_shape, _target_height| Some(sample_decoded_cursor(12)),
            |_cursor_id| None,
        );
        assert!(rgba.iter().any(|v| *v > 0));
    }
}
