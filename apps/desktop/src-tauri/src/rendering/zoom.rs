//! Zoom interpolation system with bezier easing.
//!
//! Ported from Cap's zoom.rs - provides smooth zoom transitions
//! using bounds-based interpolation and bezier easing curves.

// Allow unused interpolation modes - keeping full implementation
#![allow(dead_code)]

use super::types::ZoomState;
use crate::commands::video_recording::video_project::{ZoomConfig, ZoomRegion, ZoomRegionMode};

/// Fixed zoom transition duration in seconds (matches Cap).
pub const ZOOM_DURATION: f64 = 1.0;

/// XY coordinate for bounds calculations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct XY {
    pub x: f64,
    pub y: f64,
}

impl XY {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

impl std::ops::Add for XY {
    type Output = Self;
    fn add(self, other: Self) -> Self {
        XY::new(self.x + other.x, self.y + other.y)
    }
}

impl std::ops::Sub for XY {
    type Output = Self;
    fn sub(self, other: Self) -> Self {
        XY::new(self.x - other.x, self.y - other.y)
    }
}

impl std::ops::Mul<f64> for XY {
    type Output = Self;
    fn mul(self, scalar: f64) -> Self {
        XY::new(self.x * scalar, self.y * scalar)
    }
}

/// Viewport bounds for zoom calculations.
/// Uses normalized coordinates (0-1 for unzoomed, extends beyond for zoomed).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SegmentBounds {
    pub top_left: XY,
    pub bottom_right: XY,
}

impl Default for SegmentBounds {
    fn default() -> Self {
        Self {
            top_left: XY::new(0.0, 0.0),
            bottom_right: XY::new(1.0, 1.0),
        }
    }
}

impl SegmentBounds {
    pub fn new(top_left: XY, bottom_right: XY) -> Self {
        Self {
            top_left,
            bottom_right,
        }
    }

    /// Create bounds from a zoom region using Cap's calculation.
    ///
    /// The key insight: for a zoom centered at (cx, cy) with scale `amount`:
    /// - The zoomed viewport is `amount` times larger
    /// - We offset to keep the center point at the same screen position
    pub fn from_region(region: &ZoomRegion, cursor_pos: Option<(f64, f64)>) -> Self {
        // Get position - either from cursor (Auto mode) or fixed target
        let position = match region.mode {
            ZoomRegionMode::Auto => {
                cursor_pos.unwrap_or((region.target_x as f64, region.target_y as f64))
            },
            ZoomRegionMode::Manual => (region.target_x as f64, region.target_y as f64),
        };

        let amount = region.scale as f64;

        // Cap's calculation: scale the center, then offset to maintain position
        let scaled_center = [position.0 * amount, position.1 * amount];
        let center_diff = [scaled_center[0] - position.0, scaled_center[1] - position.1];

        SegmentBounds::new(
            XY::new(0.0 - center_diff[0], 0.0 - center_diff[1]),
            XY::new(amount - center_diff[0], amount - center_diff[1]),
        )
    }

    /// Get the zoom amount (width of the viewport).
    pub fn zoom_amount(&self) -> f64 {
        (self.bottom_right - self.top_left).x
    }

    /// Interpolate between two bounds.
    pub fn lerp(&self, other: &SegmentBounds, t: f64) -> SegmentBounds {
        SegmentBounds::new(
            self.top_left * (1.0 - t) + other.top_left * t,
            self.bottom_right * (1.0 - t) + other.bottom_right * t,
        )
    }
}

/// Cursor for tracking position within zoom segments.
#[derive(Debug, Clone, Copy)]
pub struct SegmentsCursor<'a> {
    /// Current time in seconds.
    time: f64,
    /// Current active segment (if any).
    segment: Option<&'a ZoomRegion>,
    /// Previous segment (for transitions).
    prev_segment: Option<&'a ZoomRegion>,
    /// Reference to all segments.
    segments: &'a [ZoomRegion],
}

impl<'a> SegmentsCursor<'a> {
    /// Create a cursor for a specific time.
    pub fn new(time: f64, segments: &'a [ZoomRegion]) -> Self {
        // Find active segment (time is within start..end)
        let active_idx = segments.iter().position(|s| {
            let start_s = s.start_ms as f64 / 1000.0;
            let end_s = s.end_ms as f64 / 1000.0;
            time > start_s && time <= end_s
        });

        match active_idx {
            Some(idx) => SegmentsCursor {
                time,
                segment: Some(&segments[idx]),
                prev_segment: if idx > 0 {
                    Some(&segments[idx - 1])
                } else {
                    None
                },
                segments,
            },
            None => {
                // Not in a segment - find the most recent previous segment
                let prev = segments
                    .iter()
                    .enumerate()
                    .rev()
                    .find(|(_, s)| (s.end_ms as f64 / 1000.0) <= time);

                SegmentsCursor {
                    time,
                    segment: None,
                    prev_segment: prev.map(|(_, s)| s),
                    segments,
                }
            },
        }
    }
}

/// Result of zoom interpolation for a given time.
#[derive(Debug, Clone, Copy)]
pub struct InterpolatedZoom {
    /// Ratio of current zoom (0 = no zoom, 1 = full zoom).
    pub t: f64,
    /// Current viewport bounds.
    pub bounds: SegmentBounds,
}

impl InterpolatedZoom {
    /// Create interpolated zoom state using Cap's bezier easing.
    pub fn new(cursor: SegmentsCursor, cursor_pos: Option<(f64, f64)>) -> Self {
        Self::new_internal(cursor, cursor_pos, true)
    }

    /// Internal implementation with optional bezier easing.
    fn new_internal(
        cursor: SegmentsCursor,
        cursor_pos: Option<(f64, f64)>,
        use_bezier: bool,
    ) -> Self {
        let default = SegmentBounds::default();

        // Helper to apply easing
        let apply_ease_in = |t: f32| -> f32 {
            if use_bezier {
                bezier_easing::bezier_easing(0.1, 0.0, 0.3, 1.0).unwrap()(t)
            } else {
                t
            }
        };
        let apply_ease_out = |t: f32| -> f32 {
            if use_bezier {
                bezier_easing::bezier_easing(0.5, 0.0, 0.5, 1.0).unwrap()(t)
            } else {
                t
            }
        };

        match (cursor.prev_segment, cursor.segment) {
            // Case 1: After a segment, zooming out
            (Some(prev_segment), None) => {
                let prev_end_s = prev_segment.end_ms as f64 / 1000.0;
                let zoom_t =
                    apply_ease_out(t_clamp((cursor.time - prev_end_s) / ZOOM_DURATION) as f32)
                        as f64;

                let prev_bounds = SegmentBounds::from_region(prev_segment, cursor_pos);

                Self {
                    t: 1.0 - zoom_t,
                    bounds: prev_bounds.lerp(&default, zoom_t),
                }
            },

            // Case 2: In first segment, zooming in
            (None, Some(segment)) => {
                let start_s = segment.start_ms as f64 / 1000.0;
                let t =
                    apply_ease_in(t_clamp((cursor.time - start_s) / ZOOM_DURATION) as f32) as f64;

                let segment_bounds = SegmentBounds::from_region(segment, cursor_pos);

                Self {
                    t,
                    bounds: default.lerp(&segment_bounds, t),
                }
            },

            // Case 3: Transitioning between segments
            (Some(prev_segment), Some(segment)) => {
                let prev_bounds = SegmentBounds::from_region(prev_segment, cursor_pos);
                let segment_bounds = SegmentBounds::from_region(segment, cursor_pos);
                let segment_start_s = segment.start_ms as f64 / 1000.0;
                let prev_end_s = prev_segment.end_ms as f64 / 1000.0;

                let zoom_t =
                    apply_ease_in(t_clamp((cursor.time - segment_start_s) / ZOOM_DURATION) as f32)
                        as f64;

                // No gap: direct transition between segments
                if (segment.start_ms as i64 - prev_segment.end_ms as i64).abs() < 10 {
                    Self {
                        t: 1.0,
                        bounds: prev_bounds.lerp(&segment_bounds, zoom_t),
                    }
                }
                // Small gap: interrupted zoom-out
                else if segment_start_s - prev_end_s < ZOOM_DURATION {
                    // Find where the zoom-out was interrupted
                    let min = Self::new_internal(
                        SegmentsCursor::new(segment_start_s, cursor.segments),
                        cursor_pos,
                        use_bezier,
                    );

                    Self {
                        t: (min.t * (1.0 - zoom_t)) + zoom_t,
                        bounds: min.bounds.lerp(&segment_bounds, zoom_t),
                    }
                }
                // Large gap: fully separate segments
                else {
                    Self {
                        t: zoom_t,
                        bounds: default.lerp(&segment_bounds, zoom_t),
                    }
                }
            },

            // No segments active
            _ => Self {
                t: 0.0,
                bounds: default,
            },
        }
    }

    /// Create with linear easing (for testing).
    #[cfg(test)]
    fn new_linear(cursor: SegmentsCursor, cursor_pos: Option<(f64, f64)>) -> Self {
        Self::new_internal(cursor, cursor_pos, false)
    }

    /// Convert to ZoomState for rendering.
    pub fn to_zoom_state(&self) -> ZoomState {
        let scale = self.bounds.zoom_amount();

        // No zoom (scale ~= 1.0)
        if (scale - 1.0).abs() < 0.001 {
            return ZoomState::identity();
        }

        // Recover the original zoom target from bounds.
        // The bounds were calculated as:
        //   topLeft = (0 - centerDiff.x, 0 - centerDiff.y)
        //   where centerDiff = target * (scale - 1)
        // So: topLeft = -target * (scale - 1)
        // Therefore: target = -topLeft / (scale - 1)
        let center_x = (-self.bounds.top_left.x / (scale - 1.0)) as f32;
        let center_y = (-self.bounds.top_left.y / (scale - 1.0)) as f32;

        ZoomState {
            scale: scale as f32,
            center_x,
            center_y,
        }
    }
}

/// Clamp value to 0-1 range.
fn t_clamp(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

/// Zoom interpolator that calculates zoom state for any timestamp.
pub struct ZoomInterpolator {
    /// Sorted zoom regions.
    regions: Vec<ZoomRegion>,
}

impl ZoomInterpolator {
    /// Create a new interpolator from zoom configuration.
    pub fn new(config: &ZoomConfig) -> Self {
        let mut regions = config.regions.clone();
        // Sort by start time
        regions.sort_by_key(|r| r.start_ms);

        Self { regions }
    }

    /// Get the zoom state at a specific timestamp.
    pub fn get_zoom_at(&self, timestamp_ms: u64) -> ZoomState {
        self.get_zoom_at_with_cursor(timestamp_ms, None)
    }

    /// Get zoom state with optional cursor position for Auto mode.
    pub fn get_zoom_at_with_cursor(
        &self,
        timestamp_ms: u64,
        cursor_pos: Option<(f64, f64)>,
    ) -> ZoomState {
        if self.regions.is_empty() {
            return ZoomState::identity();
        }

        let time_s = timestamp_ms as f64 / 1000.0;
        let cursor = SegmentsCursor::new(time_s, &self.regions);
        let interpolated = InterpolatedZoom::new(cursor, cursor_pos);

        interpolated.to_zoom_state()
    }

    /// Check if any zoom is active at the given timestamp.
    pub fn is_zoomed_at(&self, timestamp_ms: u64) -> bool {
        let state = self.get_zoom_at(timestamp_ms);
        state.scale > 1.001
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::video_recording::video_project::{EasingFunction, ZoomTransition};

    fn make_region(start_ms: u64, end_ms: u64, scale: f32, x: f32, y: f32) -> ZoomRegion {
        ZoomRegion {
            id: format!("test_{}", start_ms),
            start_ms,
            end_ms,
            scale,
            target_x: x,
            target_y: y,
            mode: ZoomRegionMode::Manual,
            is_auto: false,
            transition: ZoomTransition {
                duration_in_ms: 300,
                duration_out_ms: 300,
                easing: EasingFunction::EaseInOut,
            },
        }
    }

    // ========================================================================
    // XY type tests
    // ========================================================================

    #[test]
    fn test_xy_new() {
        let xy = XY::new(10.0, 20.0);
        assert!((xy.x - 10.0).abs() < 0.001);
        assert!((xy.y - 20.0).abs() < 0.001);
    }

    #[test]
    fn test_xy_add() {
        let a = XY::new(10.0, 20.0);
        let b = XY::new(5.0, 10.0);
        let result = a + b;
        assert!((result.x - 15.0).abs() < 0.001);
        assert!((result.y - 30.0).abs() < 0.001);
    }

    #[test]
    fn test_xy_sub() {
        let a = XY::new(10.0, 20.0);
        let b = XY::new(3.0, 5.0);
        let result = a - b;
        assert!((result.x - 7.0).abs() < 0.001);
        assert!((result.y - 15.0).abs() < 0.001);
    }

    #[test]
    fn test_xy_mul_scalar() {
        let xy = XY::new(10.0, 20.0);
        let result = xy * 2.0;
        assert!((result.x - 20.0).abs() < 0.001);
        assert!((result.y - 40.0).abs() < 0.001);
    }

    #[test]
    fn test_xy_equality() {
        let a = XY::new(10.0, 20.0);
        let b = XY::new(10.0, 20.0);
        let c = XY::new(10.0, 21.0);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    // ========================================================================
    // SegmentBounds tests
    // ========================================================================

    #[test]
    fn test_segment_bounds_default() {
        let bounds = SegmentBounds::default();
        assert!((bounds.top_left.x - 0.0).abs() < 0.001);
        assert!((bounds.top_left.y - 0.0).abs() < 0.001);
        assert!((bounds.bottom_right.x - 1.0).abs() < 0.001);
        assert!((bounds.bottom_right.y - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_segment_bounds_new() {
        let bounds = SegmentBounds::new(XY::new(-0.5, -0.5), XY::new(1.5, 1.5));
        assert!((bounds.top_left.x - (-0.5)).abs() < 0.001);
        assert!((bounds.bottom_right.x - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_segment_bounds_zoom_amount() {
        let bounds = SegmentBounds::new(XY::new(-0.5, -0.5), XY::new(1.5, 1.5));
        assert!((bounds.zoom_amount() - 2.0).abs() < 0.001);

        let default = SegmentBounds::default();
        assert!((default.zoom_amount() - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_segment_bounds_lerp() {
        let a = SegmentBounds::default();
        let b = SegmentBounds::new(XY::new(-0.5, -0.5), XY::new(1.5, 1.5));

        let mid = a.lerp(&b, 0.5);
        assert!((mid.top_left.x - (-0.25)).abs() < 0.001);
        assert!((mid.top_left.y - (-0.25)).abs() < 0.001);
        assert!((mid.bottom_right.x - 1.25).abs() < 0.001);
        assert!((mid.bottom_right.y - 1.25).abs() < 0.001);
    }

    #[test]
    fn test_segment_bounds_lerp_boundaries() {
        let a = SegmentBounds::default();
        let b = SegmentBounds::new(XY::new(-1.0, -1.0), XY::new(2.0, 2.0));

        // t=0 should give a
        let start = a.lerp(&b, 0.0);
        assert!((start.top_left.x - a.top_left.x).abs() < 0.001);

        // t=1 should give b
        let end = a.lerp(&b, 1.0);
        assert!((end.top_left.x - b.top_left.x).abs() < 0.001);
    }

    #[test]
    fn test_segment_bounds_calculation() {
        let region = make_region(0, 1000, 2.0, 0.5, 0.5);
        let bounds = SegmentBounds::from_region(&region, None);

        // For 2x zoom centered at (0.5, 0.5):
        // The bounds should extend from (-0.5, -0.5) to (1.5, 1.5)
        assert!((bounds.top_left.x - (-0.5)).abs() < 0.01);
        assert!((bounds.top_left.y - (-0.5)).abs() < 0.01);
        assert!((bounds.bottom_right.x - 1.5).abs() < 0.01);
        assert!((bounds.bottom_right.y - 1.5).abs() < 0.01);
    }

    #[test]
    fn test_segment_bounds_corner() {
        // Zoom to top-left corner
        let region = make_region(0, 1000, 2.0, 0.0, 0.0);
        let bounds = SegmentBounds::from_region(&region, None);

        // For 2x zoom at (0, 0): bounds (0, 0) to (2, 2)
        assert!((bounds.top_left.x - 0.0).abs() < 0.01);
        assert!((bounds.top_left.y - 0.0).abs() < 0.01);
        assert!((bounds.bottom_right.x - 2.0).abs() < 0.01);
        assert!((bounds.bottom_right.y - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_segment_bounds_bottom_right_corner() {
        // Zoom to bottom-right corner
        let region = make_region(0, 1000, 2.0, 1.0, 1.0);
        let bounds = SegmentBounds::from_region(&region, None);

        // For 2x zoom at (1, 1): bounds (-1, -1) to (1, 1)
        assert!((bounds.top_left.x - (-1.0)).abs() < 0.01);
        assert!((bounds.top_left.y - (-1.0)).abs() < 0.01);
        assert!((bounds.bottom_right.x - 1.0).abs() < 0.01);
        assert!((bounds.bottom_right.y - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_segment_bounds_with_cursor_pos() {
        // Auto mode should use cursor position
        let mut region = make_region(0, 1000, 2.0, 0.5, 0.5);
        region.mode = ZoomRegionMode::Auto;

        let bounds = SegmentBounds::from_region(&region, Some((0.3, 0.7)));

        // Should use cursor position (0.3, 0.7) instead of target (0.5, 0.5)
        // For 2x zoom at (0.3, 0.7):
        // center_diff = [0.3 * 2 - 0.3, 0.7 * 2 - 0.7] = [0.3, 0.7]
        // topLeft = [0 - 0.3, 0 - 0.7] = [-0.3, -0.7]
        assert!((bounds.top_left.x - (-0.3)).abs() < 0.01);
        assert!((bounds.top_left.y - (-0.7)).abs() < 0.01);
    }

    // ========================================================================
    // ZoomInterpolator tests
    // ========================================================================

    #[test]
    fn test_no_regions() {
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions: vec![],
        };
        let interpolator = ZoomInterpolator::new(&config);

        let state = interpolator.get_zoom_at(0);
        assert!((state.scale - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_single_region_lifecycle() {
        // Region from 2s to 4s with 2x zoom
        let regions = vec![make_region(2000, 4000, 2.0, 0.5, 0.5)];
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        // Before zoom starts
        let state = interpolator.get_zoom_at(0);
        assert!(
            (state.scale - 1.0).abs() < 0.01,
            "Before: scale should be 1.0"
        );

        // During zoom (fully zoomed in)
        let state = interpolator.get_zoom_at(3000);
        assert!(
            state.scale > 1.5,
            "During: scale should be > 1.5, got {}",
            state.scale
        );

        // After zoom ends + transition (5s = 4s end + 1s duration)
        let state = interpolator.get_zoom_at(5500);
        assert!(
            (state.scale - 1.0).abs() < 0.1,
            "After: scale should be ~1.0, got {}",
            state.scale
        );
    }

    #[test]
    fn test_two_regions_no_gap() {
        // Two adjacent regions
        let regions = vec![
            make_region(2000, 4000, 2.0, 0.0, 0.0),
            make_region(4000, 6000, 4.0, 0.5, 0.5),
        ];
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        // At transition point - should be transitioning
        let state = interpolator.get_zoom_at(4500);
        assert!(state.scale > 1.5, "Should be zoomed during transition");
    }

    #[test]
    fn test_is_zoomed_at() {
        let regions = vec![make_region(1000, 3000, 2.0, 0.5, 0.5)];
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        // Before zoom
        assert!(!interpolator.is_zoomed_at(0));

        // During zoom
        assert!(interpolator.is_zoomed_at(2000));

        // After zoom settles
        assert!(!interpolator.is_zoomed_at(5000));
    }

    #[test]
    fn test_regions_sorted_by_start() {
        // Regions provided out of order
        let regions = vec![
            make_region(4000, 6000, 2.0, 0.5, 0.5),
            make_region(1000, 2000, 3.0, 0.5, 0.5),
        ];
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        // Should work correctly even with out-of-order input
        let state_early = interpolator.get_zoom_at(1500);
        assert!(state_early.scale > 1.5, "Early region should be active");

        let state_late = interpolator.get_zoom_at(5000);
        assert!(state_late.scale > 1.5, "Late region should be active");
    }

    // ========================================================================
    // InterpolatedZoom and to_zoom_state tests
    // ========================================================================

    #[test]
    fn test_to_zoom_state_recovers_center() {
        // Test that to_zoom_state correctly recovers the original zoom center
        // This is critical for export to match preview

        // Test 1: Corner zoom at (0, 0)
        let bounds1 = SegmentBounds::from_region(&make_region(0, 1000, 2.0, 0.0, 0.0), None);
        let interp1 = InterpolatedZoom {
            t: 1.0,
            bounds: bounds1,
        };
        let state1 = interp1.to_zoom_state();
        assert!(
            (state1.center_x - 0.0).abs() < 0.01,
            "Corner zoom: center_x should be 0.0, got {}",
            state1.center_x
        );
        assert!(
            (state1.center_y - 0.0).abs() < 0.01,
            "Corner zoom: center_y should be 0.0, got {}",
            state1.center_y
        );

        // Test 2: Center zoom at (0.5, 0.5)
        let bounds2 = SegmentBounds::from_region(&make_region(0, 1000, 2.0, 0.5, 0.5), None);
        let interp2 = InterpolatedZoom {
            t: 1.0,
            bounds: bounds2,
        };
        let state2 = interp2.to_zoom_state();
        assert!(
            (state2.center_x - 0.5).abs() < 0.01,
            "Center zoom: center_x should be 0.5, got {}",
            state2.center_x
        );
        assert!(
            (state2.center_y - 0.5).abs() < 0.01,
            "Center zoom: center_y should be 0.5, got {}",
            state2.center_y
        );

        // Test 3: Off-center zoom at (0.7, 0.3)
        let bounds3 = SegmentBounds::from_region(&make_region(0, 1000, 2.0, 0.7, 0.3), None);
        let interp3 = InterpolatedZoom {
            t: 1.0,
            bounds: bounds3,
        };
        let state3 = interp3.to_zoom_state();
        assert!(
            (state3.center_x - 0.7).abs() < 0.01,
            "Off-center zoom: center_x should be 0.7, got {}",
            state3.center_x
        );
        assert!(
            (state3.center_y - 0.3).abs() < 0.01,
            "Off-center zoom: center_y should be 0.3, got {}",
            state3.center_y
        );
    }

    #[test]
    fn test_to_zoom_state_identity_when_no_zoom() {
        let bounds = SegmentBounds::default();
        let interp = InterpolatedZoom { t: 0.0, bounds };
        let state = interp.to_zoom_state();

        assert!((state.scale - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_interpolated_zoom_with_different_scales() {
        // Test 3x zoom
        let region_3x = make_region(0, 1000, 3.0, 0.5, 0.5);
        let bounds_3x = SegmentBounds::from_region(&region_3x, None);
        let interp_3x = InterpolatedZoom {
            t: 1.0,
            bounds: bounds_3x,
        };
        let state_3x = interp_3x.to_zoom_state();
        assert!((state_3x.scale - 3.0).abs() < 0.01);

        // Test 1.5x zoom
        let region_15x = make_region(0, 1000, 1.5, 0.5, 0.5);
        let bounds_15x = SegmentBounds::from_region(&region_15x, None);
        let interp_15x = InterpolatedZoom {
            t: 1.0,
            bounds: bounds_15x,
        };
        let state_15x = interp_15x.to_zoom_state();
        assert!((state_15x.scale - 1.5).abs() < 0.01);
    }

    // ========================================================================
    // SegmentsCursor tests
    // ========================================================================

    #[test]
    fn test_segments_cursor_no_segments() {
        let segments: Vec<ZoomRegion> = vec![];
        let cursor = SegmentsCursor::new(1.0, &segments);

        assert!(cursor.segment.is_none());
        assert!(cursor.prev_segment.is_none());
    }

    #[test]
    fn test_segments_cursor_before_first_segment() {
        let segments = vec![make_region(2000, 4000, 2.0, 0.5, 0.5)];
        let cursor = SegmentsCursor::new(1.0, &segments); // 1s, before 2s start

        assert!(cursor.segment.is_none());
        assert!(cursor.prev_segment.is_none());
    }

    #[test]
    fn test_segments_cursor_during_segment() {
        let segments = vec![make_region(2000, 4000, 2.0, 0.5, 0.5)];
        let cursor = SegmentsCursor::new(3.0, &segments); // 3s, during 2s-4s

        assert!(cursor.segment.is_some());
        assert!(cursor.prev_segment.is_none());
    }

    #[test]
    fn test_segments_cursor_after_segment() {
        let segments = vec![make_region(2000, 4000, 2.0, 0.5, 0.5)];
        let cursor = SegmentsCursor::new(5.0, &segments); // 5s, after 4s end

        assert!(cursor.segment.is_none());
        assert!(cursor.prev_segment.is_some());
    }

    // ========================================================================
    // Linear easing tests (for deterministic testing)
    // ========================================================================

    #[test]
    fn test_interpolated_zoom_linear_zoom_in() {
        let segments = vec![make_region(0, 2000, 2.0, 0.5, 0.5)];

        // Halfway through zoom-in (0.5s into 1s transition)
        let cursor = SegmentsCursor::new(0.5, &segments);
        let interp = InterpolatedZoom::new_linear(cursor, None);

        // With linear easing, t should be 0.5
        assert!(
            (interp.t - 0.5).abs() < 0.01,
            "t should be ~0.5, got {}",
            interp.t
        );
    }

    #[test]
    fn test_interpolated_zoom_linear_zoom_out() {
        let segments = vec![make_region(0, 1000, 2.0, 0.5, 0.5)];

        // Halfway through zoom-out (0.5s after end)
        let cursor = SegmentsCursor::new(1.5, &segments);
        let interp = InterpolatedZoom::new_linear(cursor, None);

        // With linear easing, t should be 0.5 (halfway zoomed out)
        assert!(
            (interp.t - 0.5).abs() < 0.01,
            "t should be ~0.5, got {}",
            interp.t
        );
    }

    // ========================================================================
    // t_clamp tests
    // ========================================================================

    #[test]
    fn test_t_clamp() {
        assert!((t_clamp(0.5) - 0.5).abs() < 0.001);
        assert!((t_clamp(-0.5) - 0.0).abs() < 0.001);
        assert!((t_clamp(1.5) - 1.0).abs() < 0.001);
        assert!((t_clamp(0.0) - 0.0).abs() < 0.001);
        assert!((t_clamp(1.0) - 1.0).abs() < 0.001);
    }

    // ========================================================================
    // Edge cases
    // ========================================================================

    #[test]
    fn test_very_short_region() {
        let regions = vec![make_region(1000, 1100, 2.0, 0.5, 0.5)]; // 100ms region
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        // Should still work even with very short regions
        let state = interpolator.get_zoom_at(1050);
        assert!(state.scale > 1.0);
    }

    #[test]
    fn test_very_long_region() {
        let regions = vec![make_region(0, 3600000, 2.0, 0.5, 0.5)]; // 1 hour region
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        // Should be zoomed in middle of hour-long region
        let state = interpolator.get_zoom_at(1800000); // 30 minutes
        assert!(state.scale > 1.5);
    }

    #[test]
    fn test_extreme_zoom_scale() {
        let regions = vec![make_region(0, 2000, 10.0, 0.5, 0.5)]; // 10x zoom
        let config = ZoomConfig {
            mode: crate::commands::video_recording::video_project::ZoomMode::Manual,
            auto_zoom_scale: 2.0,
            regions,
        };
        let interpolator = ZoomInterpolator::new(&config);

        let state = interpolator.get_zoom_at(1500);
        assert!(state.scale > 5.0, "Should support high zoom levels");
    }
}
