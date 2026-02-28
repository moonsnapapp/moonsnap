//! Cursor compositing planning helpers shared by preview/export.

use crate::{zoom::apply_zoom_to_normalized_point, ZoomState};

/// Crop-space parameters used for cursor planning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CursorCropPlan {
    pub enabled: bool,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
}

/// Request payload for frame-level cursor geometry planning.
#[derive(Debug, Clone, Copy)]
pub struct CursorGeometryPlanRequest {
    pub cursor_x: f32,
    pub cursor_y: f32,
    pub zoom: ZoomState,
    pub crop: CursorCropPlan,
    pub composition_height: u32,
    pub cursor_scale: f32,
}

/// Frame-level cursor plan consumed by CPU compositing adapters.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CursorGeometryPlan {
    pub x: f32,
    pub y: f32,
    pub target_height_px: f32,
}

/// Selected raster source for CPU cursor compositing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorRasterSource {
    SvgShape,
    BitmapImage,
    FallbackArrow,
}

/// Return whether CPU cursor compositing should run for this frame.
pub fn should_composite_cursor(camera_only_opacity: f64) -> bool {
    camera_only_opacity < 0.99
}

/// Map cursor position from original frame-space UV to crop-local UV.
///
/// Returns `None` when the cursor is outside the crop visibility margin.
pub fn map_cursor_to_crop_if_needed(
    cursor_x: f32,
    cursor_y: f32,
    crop_enabled: bool,
    original_width: u32,
    original_height: u32,
    crop_x: u32,
    crop_y: u32,
    crop_width: u32,
    crop_height: u32,
) -> Option<(f32, f32)> {
    if !crop_enabled {
        return Some((cursor_x, cursor_y));
    }
    if original_width == 0 || original_height == 0 || crop_width == 0 || crop_height == 0 {
        return None;
    }

    let orig_w = original_width as f32;
    let orig_h = original_height as f32;
    let crop_x = crop_x as f32;
    let crop_y = crop_y as f32;
    let crop_w = crop_width as f32;
    let crop_h = crop_height as f32;

    let cursor_px_x = cursor_x * orig_w;
    let cursor_px_y = cursor_y * orig_h;
    let mapped_x = (cursor_px_x - crop_x) / crop_w;
    let mapped_y = (cursor_px_y - crop_y) / crop_h;

    if !(-0.1..=1.1).contains(&mapped_x) || !(-0.1..=1.1).contains(&mapped_y) {
        return None;
    }

    Some((mapped_x, mapped_y))
}

/// Compute cursor target height for export compositing.
pub fn cursor_target_height_px(composition_height: u32, cursor_scale: f32) -> f32 {
    let base_cursor_height = 24.0;
    let reference_height = 720.0;
    let size_scale = composition_height as f32 / reference_height;
    (base_cursor_height * size_scale * cursor_scale).clamp(16.0, 256.0)
}

/// Plan per-frame cursor geometry (crop remap + zoom transform + target size).
///
/// Returns `None` when crop mapping rejects the cursor position.
pub fn plan_cursor_geometry(request: CursorGeometryPlanRequest) -> Option<CursorGeometryPlan> {
    let (mapped_x, mapped_y) = map_cursor_to_crop_if_needed(
        request.cursor_x,
        request.cursor_y,
        request.crop.enabled,
        request.crop.original_width,
        request.crop.original_height,
        request.crop.x,
        request.crop.y,
        request.crop.width,
        request.crop.height,
    )?;

    let (zoomed_x, zoomed_y) =
        apply_zoom_to_normalized_point(mapped_x as f64, mapped_y as f64, request.zoom);

    Some(CursorGeometryPlan {
        x: zoomed_x as f32,
        y: zoomed_y as f32,
        target_height_px: cursor_target_height_px(request.composition_height, request.cursor_scale),
    })
}

/// Choose cursor raster source in preview/export fallback order.
pub fn plan_cursor_raster_source(
    has_shape_svg: bool,
    has_bitmap_image: bool,
) -> CursorRasterSource {
    if has_shape_svg {
        CursorRasterSource::SvgShape
    } else if has_bitmap_image {
        CursorRasterSource::BitmapImage
    } else {
        CursorRasterSource::FallbackArrow
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composite_cursor_gated_by_camera_only_opacity() {
        assert!(should_composite_cursor(0.0));
        assert!(should_composite_cursor(0.5));
        assert!(!should_composite_cursor(0.99));
        assert!(!should_composite_cursor(1.0));
    }

    #[test]
    fn crop_mapping_passthrough_when_disabled() {
        let mapped =
            map_cursor_to_crop_if_needed(0.3, 0.7, false, 1920, 1080, 100, 100, 800, 600).unwrap();
        assert!((mapped.0 - 0.3).abs() < 0.0001);
        assert!((mapped.1 - 0.7).abs() < 0.0001);
    }

    #[test]
    fn crop_mapping_maps_to_crop_local_space() {
        // Cursor at screen px (600, 400) with crop starting at (400, 200) size 400x400.
        // In crop-local UV => (0.5, 0.5).
        let cursor_x = 600.0 / 1920.0;
        let cursor_y = 400.0 / 1080.0;
        let mapped = map_cursor_to_crop_if_needed(
            cursor_x as f32,
            cursor_y as f32,
            true,
            1920,
            1080,
            400,
            200,
            400,
            400,
        )
        .unwrap();

        assert!((mapped.0 - 0.5).abs() < 0.001);
        assert!((mapped.1 - 0.5).abs() < 0.001);
    }

    #[test]
    fn crop_mapping_rejects_out_of_bounds_cursor() {
        let mapped = map_cursor_to_crop_if_needed(0.95, 0.95, true, 1920, 1080, 0, 0, 200, 200);
        assert!(mapped.is_none());
    }

    #[test]
    fn cursor_target_height_clamped_and_scaled() {
        assert!((cursor_target_height_px(720, 1.0) - 24.0).abs() < 0.0001);
        assert_eq!(cursor_target_height_px(100, 0.1), 16.0);
        assert_eq!(cursor_target_height_px(8000, 10.0), 256.0);
    }

    #[test]
    fn cursor_geometry_returns_none_when_crop_mapping_rejects_cursor() {
        let plan = plan_cursor_geometry(CursorGeometryPlanRequest {
            cursor_x: 0.95,
            cursor_y: 0.95,
            zoom: ZoomState::identity(),
            crop: CursorCropPlan {
                enabled: true,
                x: 0,
                y: 0,
                width: 200,
                height: 200,
                original_width: 1920,
                original_height: 1080,
            },
            composition_height: 1080,
            cursor_scale: 1.0,
        });
        assert!(plan.is_none());
    }

    #[test]
    fn cursor_geometry_applies_crop_zoom_and_size() {
        let plan = plan_cursor_geometry(CursorGeometryPlanRequest {
            cursor_x: 600.0 / 1920.0,
            cursor_y: 400.0 / 1080.0,
            zoom: ZoomState {
                scale: 2.0,
                center_x: 0.5,
                center_y: 0.5,
            },
            crop: CursorCropPlan {
                enabled: true,
                x: 400,
                y: 200,
                width: 400,
                height: 400,
                original_width: 1920,
                original_height: 1080,
            },
            composition_height: 1080,
            cursor_scale: 1.0,
        })
        .unwrap();

        // Crop-local midpoint (0.5,0.5) remains centered under zoom.
        assert!((plan.x - 0.5).abs() < 0.001);
        assert!((plan.y - 0.5).abs() < 0.001);
        assert!((plan.target_height_px - 36.0).abs() < 0.001);
    }

    #[test]
    fn cursor_raster_source_prefers_shape_then_bitmap_then_fallback() {
        assert_eq!(
            plan_cursor_raster_source(true, true),
            CursorRasterSource::SvgShape
        );
        assert_eq!(
            plan_cursor_raster_source(false, true),
            CursorRasterSource::BitmapImage
        );
        assert_eq!(
            plan_cursor_raster_source(false, false),
            CursorRasterSource::FallbackArrow
        );
    }
}
