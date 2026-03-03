//! Type-safe coordinate system for rendering pipeline.
//!
//! Inspired by Cap's coordinate system, this module provides compile-time
//! safety for coordinate transformations between different spaces:
//!
//! ```text
//! ScreenSpace → CaptureSpace → FrameSpace → ZoomedFrameSpace
//! ```
//!
//! Each coordinate space is a phantom type that prevents mixing coordinates
//! from different spaces at compile time.

use std::ops::{Add, Div, Mul, Sub};

/// Raw screen/monitor coordinates.
/// `(0, 0)` is the top-left of the primary monitor.
/// Used for cursor positions from the OS and capture region definitions.
#[derive(Default, Clone, Copy, Debug)]
pub struct ScreenSpace;

/// Normalized screen coordinates (0.0-1.0 UV space).
/// Cursor positions are often stored in this format for resolution independence.
#[derive(Default, Clone, Copy, Debug)]
pub struct ScreenUVSpace;

/// Coordinates relative to the capture region.
/// `(0, 0)` is the top-left of the captured area.
/// The screen origin would be at negative coordinates if capture doesn't start at (0,0).
#[derive(Default, Clone, Copy, Debug)]
pub struct CaptureSpace;

/// Coordinates in the final rendered frame.
/// `(0, 0)` is the top-left of the output frame.
/// Accounts for padding, letterboxing, and aspect ratio adjustments.
#[derive(Default, Clone, Copy, Debug)]
pub struct FrameSpace;

/// Coordinates after zoom transformation.
/// `(0, 0)` is still the top-left of the frame, but positions are scaled
/// and offset based on the current zoom state.
#[derive(Default, Clone, Copy, Debug)]
pub struct ZoomedFrameSpace;

/// A 2D coordinate with an associated coordinate space.
///
/// The phantom type `TSpace` ensures coordinates from different spaces
/// cannot be mixed without explicit conversion.
#[derive(Clone, Copy, Debug, Default)]
pub struct Coord<TSpace> {
    pub x: f64,
    pub y: f64,
    _space: std::marker::PhantomData<TSpace>,
}

impl<TSpace: Default> Coord<TSpace> {
    /// Create a new coordinate in the specified space.
    pub fn new(x: f64, y: f64) -> Self {
        Self {
            x,
            y,
            _space: std::marker::PhantomData,
        }
    }

    /// Create a coordinate from a tuple.
    pub fn from_tuple(xy: (f64, f64)) -> Self {
        Self::new(xy.0, xy.1)
    }

    /// Create a coordinate from u32 values.
    pub fn from_u32(x: u32, y: u32) -> Self {
        Self::new(x as f64, y as f64)
    }

    /// Create a coordinate from i32 values.
    pub fn from_i32(x: i32, y: i32) -> Self {
        Self::new(x as f64, y as f64)
    }

    /// Create a coordinate from f32 values.
    pub fn from_f32(x: f32, y: f32) -> Self {
        Self::new(x as f64, y as f64)
    }

    /// Convert to a tuple.
    pub fn as_tuple(&self) -> (f64, f64) {
        (self.x, self.y)
    }

    /// Convert to f32 tuple.
    pub fn as_f32(&self) -> (f32, f32) {
        (self.x as f32, self.y as f32)
    }

    /// Convert to i32 tuple (truncating).
    pub fn as_i32(&self) -> (i32, i32) {
        (self.x as i32, self.y as i32)
    }

    /// Convert to u32 tuple (clamping negatives to 0).
    pub fn as_u32(&self) -> (u32, u32) {
        (self.x.max(0.0) as u32, self.y.max(0.0) as u32)
    }

    /// Clamp coordinates to a range.
    pub fn clamp(self, min: Coord<TSpace>, max: Coord<TSpace>) -> Self {
        Self::new(self.x.clamp(min.x, max.x), self.y.clamp(min.y, max.y))
    }

    /// Clamp to 0-1 range (useful for UV coordinates).
    pub fn clamp_unit(self) -> Self {
        Self::new(self.x.clamp(0.0, 1.0), self.y.clamp(0.0, 1.0))
    }

    /// Linear interpolation between two coordinates.
    pub fn lerp(self, other: Self, t: f64) -> Self {
        Self::new(
            self.x + (other.x - self.x) * t,
            self.y + (other.y - self.y) * t,
        )
    }

    /// Get the length/magnitude of the coordinate as a vector.
    pub fn length(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    /// Get the distance to another coordinate.
    pub fn distance(&self, other: &Self) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }
}

// Arithmetic operations that preserve the coordinate space

impl<T: Default> Add for Coord<T> {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl<T: Default> Sub for Coord<T> {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl<T: Default> Mul<f64> for Coord<T> {
    type Output = Self;
    fn mul(self, scalar: f64) -> Self {
        Self::new(self.x * scalar, self.y * scalar)
    }
}

impl<T: Default> Div<f64> for Coord<T> {
    type Output = Self;
    fn div(self, scalar: f64) -> Self {
        Self::new(self.x / scalar, self.y / scalar)
    }
}

impl<T: Default> Mul<Coord<T>> for Coord<T> {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        Self::new(self.x * rhs.x, self.y * rhs.y)
    }
}

impl<T: Default> Div<Coord<T>> for Coord<T> {
    type Output = Self;
    fn div(self, rhs: Self) -> Self {
        Self::new(self.x / rhs.x, self.y / rhs.y)
    }
}

/// Size in a specific coordinate space.
#[derive(Clone, Copy, Debug, Default)]
pub struct Size<TSpace> {
    pub width: f64,
    pub height: f64,
    _space: std::marker::PhantomData<TSpace>,
}

impl<TSpace: Default> Size<TSpace> {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            _space: std::marker::PhantomData,
        }
    }

    pub fn from_u32(width: u32, height: u32) -> Self {
        Self::new(width as f64, height as f64)
    }

    pub fn as_coord(&self) -> Coord<TSpace> {
        Coord::new(self.width, self.height)
    }

    pub fn aspect_ratio(&self) -> f64 {
        self.width / self.height
    }
}

/// A rectangular region in a specific coordinate space.
#[derive(Clone, Copy, Debug, Default)]
pub struct Rect<TSpace> {
    pub origin: Coord<TSpace>,
    pub size: Size<TSpace>,
    _space: std::marker::PhantomData<TSpace>,
}

impl<TSpace: Default + Copy> Rect<TSpace> {
    pub fn new(origin: Coord<TSpace>, size: Size<TSpace>) -> Self {
        Self {
            origin,
            size,
            _space: std::marker::PhantomData,
        }
    }

    pub fn from_coords(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self::new(Coord::new(x, y), Size::new(width, height))
    }

    pub fn top_left(&self) -> Coord<TSpace> {
        self.origin
    }

    pub fn bottom_right(&self) -> Coord<TSpace> {
        Coord::new(
            self.origin.x + self.size.width,
            self.origin.y + self.size.height,
        )
    }

    pub fn center(&self) -> Coord<TSpace> {
        Coord::new(
            self.origin.x + self.size.width / 2.0,
            self.origin.y + self.size.height / 2.0,
        )
    }

    pub fn contains(&self, point: Coord<TSpace>) -> bool {
        point.x >= self.origin.x
            && point.x <= self.origin.x + self.size.width
            && point.y >= self.origin.y
            && point.y <= self.origin.y + self.size.height
    }
}

// ============================================================================
// Coordinate Space Conversions
// ============================================================================

/// Parameters needed for coordinate transformations.
#[derive(Clone, Copy, Debug)]
pub struct TransformParams {
    /// Size of the screen/monitor being captured.
    pub screen_size: Size<ScreenSpace>,
    /// Capture region on the screen.
    pub capture_rect: Rect<ScreenSpace>,
    /// Output frame size.
    pub output_size: Size<FrameSpace>,
    /// Padding applied to the frame (for letterboxing).
    pub padding: Coord<FrameSpace>,
}

impl TransformParams {
    /// Create transform parameters for a simple fullscreen capture.
    pub fn fullscreen(width: u32, height: u32) -> Self {
        let w = width as f64;
        let h = height as f64;
        Self {
            screen_size: Size::new(w, h),
            capture_rect: Rect::new(Coord::new(0.0, 0.0), Size::new(w, h)),
            output_size: Size::new(w, h),
            padding: Coord::new(0.0, 0.0),
        }
    }

    /// Calculate the scale factor from capture to output.
    pub fn capture_to_output_scale(&self) -> f64 {
        let capture_aspect = self.capture_rect.size.aspect_ratio();
        let output_aspect = self.output_size.aspect_ratio();

        if capture_aspect > output_aspect {
            // Capture is wider - fit to width
            (self.output_size.width - self.padding.x * 2.0) / self.capture_rect.size.width
        } else {
            // Capture is taller - fit to height
            (self.output_size.height - self.padding.y * 2.0) / self.capture_rect.size.height
        }
    }
}

// Screen UV Space conversions
impl Coord<ScreenUVSpace> {
    /// Convert UV coordinates to screen pixel coordinates.
    pub fn to_screen_space(&self, screen_size: Size<ScreenSpace>) -> Coord<ScreenSpace> {
        Coord::new(self.x * screen_size.width, self.y * screen_size.height)
    }

    /// Convert directly to frame space (common for cursor positions).
    pub fn to_frame_space(&self, params: &TransformParams) -> Coord<FrameSpace> {
        self.to_screen_space(params.screen_size)
            .to_capture_space(params)
            .to_frame_space(params)
    }
}

// Screen Space conversions
impl Coord<ScreenSpace> {
    /// Convert to normalized UV coordinates.
    pub fn to_uv_space(&self, screen_size: Size<ScreenSpace>) -> Coord<ScreenUVSpace> {
        Coord::new(self.x / screen_size.width, self.y / screen_size.height)
    }

    /// Convert to capture-relative coordinates.
    pub fn to_capture_space(&self, params: &TransformParams) -> Coord<CaptureSpace> {
        Coord::new(
            self.x - params.capture_rect.origin.x,
            self.y - params.capture_rect.origin.y,
        )
    }
}

// Capture Space conversions
impl Coord<CaptureSpace> {
    /// Convert to frame space, accounting for scaling and padding.
    pub fn to_frame_space(&self, params: &TransformParams) -> Coord<FrameSpace> {
        let scale = params.capture_to_output_scale();

        // Scale the position
        let scaled_x = self.x * scale;
        let scaled_y = self.y * scale;

        // Add padding offset
        Coord::new(scaled_x + params.padding.x, scaled_y + params.padding.y)
    }

    /// Convert to normalized position within capture (0-1).
    pub fn to_normalized(&self, capture_size: Size<CaptureSpace>) -> Coord<CaptureSpace> {
        Coord::new(self.x / capture_size.width, self.y / capture_size.height)
    }
}

// Frame Space conversions
impl Coord<FrameSpace> {
    /// Convert to zoomed frame space.
    ///
    /// # Arguments
    /// * `zoom_scale` - Zoom multiplier (1.0 = no zoom, 2.0 = 2x zoom)
    /// * `zoom_center` - Center of zoom in frame space (normalized 0-1)
    /// * `frame_size` - Size of the frame
    pub fn to_zoomed_frame_space(
        &self,
        zoom_scale: f64,
        zoom_center: Coord<FrameSpace>,
        frame_size: Size<FrameSpace>,
    ) -> Coord<ZoomedFrameSpace> {
        if zoom_scale <= 1.0 {
            return Coord::new(self.x, self.y);
        }

        // Convert zoom center from normalized to pixel coordinates
        let center_px = Coord::<FrameSpace>::new(
            zoom_center.x * frame_size.width,
            zoom_center.y * frame_size.height,
        );

        // Apply zoom transformation:
        // 1. Translate so zoom center is at origin
        // 2. Scale
        // 3. Translate back
        let relative_x = self.x - center_px.x;
        let relative_y = self.y - center_px.y;
        let scaled_x = relative_x * zoom_scale;
        let scaled_y = relative_y * zoom_scale;

        Coord::new(scaled_x + center_px.x, scaled_y + center_px.y)
    }

    /// Convert to normalized frame coordinates (0-1).
    pub fn to_normalized(&self, frame_size: Size<FrameSpace>) -> Coord<FrameSpace> {
        Coord::new(self.x / frame_size.width, self.y / frame_size.height)
    }

    /// Transform using interpolated zoom bounds (Cap-style zoom).
    ///
    /// This method applies the zoom transformation using normalized viewport bounds,
    /// matching how Cap's rendering engine handles zoom.
    ///
    /// # Arguments
    /// * `zoom` - The interpolated zoom state from the zoom module
    /// * `frame_size` - Size of the output frame
    /// * `padding` - Padding offset applied to the frame
    pub fn apply_zoom_bounds(
        &self,
        zoom: &super::zoom::InterpolatedZoom,
        frame_size: Size<FrameSpace>,
        padding: Coord<FrameSpace>,
    ) -> Coord<ZoomedFrameSpace> {
        use super::zoom::XY;

        // Calculate display size (frame minus padding)
        let display_width = frame_size.width - padding.x * 2.0;
        let display_height = frame_size.height - padding.y * 2.0;

        // Size ratio from zoom bounds
        let size_ratio = XY::new(
            zoom.bounds.bottom_right.x - zoom.bounds.top_left.x,
            zoom.bounds.bottom_right.y - zoom.bounds.top_left.y,
        );

        // Position relative to padding
        let screen_x = self.x - padding.x;
        let screen_y = self.y - padding.y;

        // Apply zoom transformation
        let zoomed_x = screen_x * size_ratio.x + zoom.bounds.top_left.x * display_width + padding.x;
        let zoomed_y =
            screen_y * size_ratio.y + zoom.bounds.top_left.y * display_height + padding.y;

        Coord::new(zoomed_x, zoomed_y)
    }
}

// ============================================================================
// Integration with zoom module types
// ============================================================================

impl From<super::zoom::XY> for Coord<FrameSpace> {
    fn from(xy: super::zoom::XY) -> Self {
        Coord::new(xy.x, xy.y)
    }
}

impl From<Coord<FrameSpace>> for super::zoom::XY {
    fn from(coord: Coord<FrameSpace>) -> Self {
        super::zoom::XY::new(coord.x, coord.y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ========================================================================
    // Edge case handling - prevent crashes and rendering bugs
    // ========================================================================

    #[test]
    fn test_as_u32_clamps_negative_coords() {
        // Critical: prevents panic when cursor goes off-screen
        let c = Coord::<FrameSpace>::new(-10.0, -20.0);
        let (x, y) = c.as_u32();
        assert_eq!((x, y), (0, 0));
    }

    #[test]
    fn test_clamp_unit_for_uv_coords() {
        // UV coords must stay in 0-1 range for texture sampling
        let c = Coord::<ScreenUVSpace>::new(1.5, -0.5);
        let clamped = c.clamp_unit();
        assert!((clamped.x - 1.0).abs() < 0.001);
        assert!((clamped.y - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_rect_contains_boundary_inclusive() {
        let rect = Rect::<ScreenSpace>::from_coords(0.0, 0.0, 100.0, 100.0);

        // Boundaries should be inclusive (common source of off-by-one bugs)
        assert!(rect.contains(Coord::new(0.0, 0.0)));
        assert!(rect.contains(Coord::new(100.0, 100.0)));
        assert!(rect.contains(Coord::new(0.0, 100.0)));
        assert!(rect.contains(Coord::new(100.0, 0.0)));

        // Just outside
        assert!(!rect.contains(Coord::new(-0.001, 50.0)));
        assert!(!rect.contains(Coord::new(100.001, 50.0)));
    }

    // ========================================================================
    // Coordinate transformations - the rendering pipeline
    // ========================================================================

    #[test]
    fn test_screen_to_capture_offset() {
        // When capture region doesn't start at (0,0), coords must be offset
        let params = TransformParams {
            screen_size: Size::new(1920.0, 1080.0),
            capture_rect: Rect::from_coords(100.0, 50.0, 800.0, 600.0),
            output_size: Size::new(800.0, 600.0),
            padding: Coord::new(0.0, 0.0),
        };

        // Capture origin maps to (0,0)
        let at_origin = Coord::<ScreenSpace>::new(100.0, 50.0).to_capture_space(&params);
        assert!((at_origin.x, at_origin.y) == (0.0, 0.0));

        // Center of capture
        let center = Coord::<ScreenSpace>::new(500.0, 350.0).to_capture_space(&params);
        assert!((center.x - 400.0).abs() < 0.001);
        assert!((center.y - 300.0).abs() < 0.001);
    }

    #[test]
    fn test_capture_to_frame_with_padding() {
        // Padding offsets where content appears in the frame
        let params = TransformParams {
            screen_size: Size::new(1920.0, 1080.0),
            capture_rect: Rect::from_coords(0.0, 0.0, 1920.0, 1080.0),
            output_size: Size::new(1920.0, 1080.0),
            padding: Coord::new(50.0, 50.0),
        };

        let origin = Coord::<CaptureSpace>::new(0.0, 0.0).to_frame_space(&params);
        assert!((origin.x - 50.0).abs() < 0.001);
        assert!((origin.y - 50.0).abs() < 0.001);
    }

    #[test]
    fn test_uv_to_screen_conversion() {
        let screen_size = Size::<ScreenSpace>::new(1920.0, 1080.0);

        // UV (0.5, 0.5) = center of screen
        let center = Coord::<ScreenUVSpace>::new(0.5, 0.5).to_screen_space(screen_size);
        assert!((center.x - 960.0).abs() < 0.001);
        assert!((center.y - 540.0).abs() < 0.001);

        // Corners
        let tl = Coord::<ScreenUVSpace>::new(0.0, 0.0).to_screen_space(screen_size);
        let br = Coord::<ScreenUVSpace>::new(1.0, 1.0).to_screen_space(screen_size);
        assert!((tl.x, tl.y) == (0.0, 0.0));
        assert!((br.x - 1920.0).abs() < 0.001);
        assert!((br.y - 1080.0).abs() < 0.001);
    }

    #[test]
    fn test_full_transform_chain() {
        // UV -> Screen -> Capture -> Frame
        let params = TransformParams::fullscreen(1920, 1080);
        let frame = Coord::<ScreenUVSpace>::new(0.5, 0.5).to_frame_space(&params);

        assert!((frame.x - 960.0).abs() < 0.001);
        assert!((frame.y - 540.0).abs() < 0.001);
    }

    // ========================================================================
    // Zoom transformation
    // ========================================================================

    #[test]
    fn test_zoom_center_stays_fixed() {
        // The zoom center point should not move when zooming
        let frame_size = Size::<FrameSpace>::new(1920.0, 1080.0);
        let zoom_center = Coord::<FrameSpace>::new(0.5, 0.5);

        let center_px = Coord::<FrameSpace>::new(960.0, 540.0);
        let zoomed = center_px.to_zoomed_frame_space(2.0, zoom_center, frame_size);

        assert!((zoomed.x - 960.0).abs() < 0.001);
        assert!((zoomed.y - 540.0).abs() < 0.001);
    }

    #[test]
    fn test_zoom_corners_move_outward() {
        let frame_size = Size::<FrameSpace>::new(1920.0, 1080.0);
        let zoom_center = Coord::<FrameSpace>::new(0.5, 0.5);

        let corner = Coord::<FrameSpace>::new(0.0, 0.0);
        let zoomed = corner.to_zoomed_frame_space(2.0, zoom_center, frame_size);

        // 2x zoom pushes corners outside frame
        assert!(zoomed.x < 0.0);
        assert!(zoomed.y < 0.0);
    }

    #[test]
    fn test_no_zoom_passthrough() {
        let frame_size = Size::<FrameSpace>::new(1920.0, 1080.0);
        let zoom_center = Coord::<FrameSpace>::new(0.5, 0.5);
        let pos = Coord::<FrameSpace>::new(100.0, 200.0);

        // Scale <= 1.0 should pass through unchanged
        let z1 = pos.to_zoomed_frame_space(1.0, zoom_center, frame_size);
        let z05 = pos.to_zoomed_frame_space(0.5, zoom_center, frame_size);

        assert!((z1.x - 100.0).abs() < 0.001);
        assert!((z05.x - 100.0).abs() < 0.001);
    }

    // ========================================================================
    // Math operations
    // ========================================================================

    #[test]
    fn test_distance_pythagorean() {
        // Classic 3-4-5 triangle
        let a = Coord::<FrameSpace>::new(0.0, 0.0);
        let b = Coord::<FrameSpace>::new(3.0, 4.0);
        assert!((a.distance(&b) - 5.0).abs() < 0.001);
        assert!((a.distance(&a) - 0.0).abs() < 0.001); // Distance to self
    }

    #[test]
    fn test_lerp_boundaries() {
        let a = Coord::<FrameSpace>::new(10.0, 20.0);
        let b = Coord::<FrameSpace>::new(100.0, 200.0);

        let at_0 = a.lerp(b, 0.0);
        let at_1 = a.lerp(b, 1.0);
        let at_half = a.lerp(b, 0.5);

        assert!((at_0.x - 10.0).abs() < 0.001);
        assert!((at_1.x - 100.0).abs() < 0.001);
        assert!((at_half.x - 55.0).abs() < 0.001);
    }

    #[test]
    fn test_aspect_ratio() {
        let widescreen = Size::<ScreenSpace>::new(1920.0, 1080.0);
        let square = Size::<ScreenSpace>::new(100.0, 100.0);

        assert!((widescreen.aspect_ratio() - 16.0 / 9.0).abs() < 0.001);
        assert!((square.aspect_ratio() - 1.0).abs() < 0.001);
    }

    // ========================================================================
    // Property-based tests
    // ========================================================================

    proptest! {
        #[test]
        fn prop_lerp_at_boundaries(
            x1 in -1000.0f64..1000.0,
            y1 in -1000.0f64..1000.0,
            x2 in -1000.0f64..1000.0,
            y2 in -1000.0f64..1000.0
        ) {
            let a = Coord::<FrameSpace>::new(x1, y1);
            let b = Coord::<FrameSpace>::new(x2, y2);

            let at_0 = a.lerp(b, 0.0);
            let at_1 = a.lerp(b, 1.0);

            prop_assert!((at_0.x - x1).abs() < 0.001);
            prop_assert!((at_0.y - y1).abs() < 0.001);
            prop_assert!((at_1.x - x2).abs() < 0.001);
            prop_assert!((at_1.y - y2).abs() < 0.001);
        }

        #[test]
        fn prop_distance_symmetric(
            x1 in -1000.0f64..1000.0,
            y1 in -1000.0f64..1000.0,
            x2 in -1000.0f64..1000.0,
            y2 in -1000.0f64..1000.0
        ) {
            let a = Coord::<FrameSpace>::new(x1, y1);
            let b = Coord::<FrameSpace>::new(x2, y2);

            let d1 = a.distance(&b);
            let d2 = b.distance(&a);

            prop_assert!((d1 - d2).abs() < 0.001);
            prop_assert!(d1 >= 0.0);
        }

        #[test]
        fn prop_clamp_always_in_range(x in -1000.0f64..1000.0, y in -1000.0f64..1000.0) {
            let c = Coord::<FrameSpace>::new(x, y);
            let min = Coord::new(0.0, 0.0);
            let max = Coord::new(100.0, 100.0);

            let clamped = c.clamp(min, max);

            prop_assert!(clamped.x >= 0.0 && clamped.x <= 100.0);
            prop_assert!(clamped.y >= 0.0 && clamped.y <= 100.0);
        }

        #[test]
        fn prop_uv_roundtrip(x in 0.0f64..1.0, y in 0.0f64..1.0) {
            let screen_size = Size::<ScreenSpace>::new(1920.0, 1080.0);

            let uv = Coord::<ScreenUVSpace>::new(x, y);
            let screen = uv.to_screen_space(screen_size);
            let back = screen.to_uv_space(screen_size);

            prop_assert!((back.x - x).abs() < 0.001);
            prop_assert!((back.y - y).abs() < 0.001);
        }

        #[test]
        fn prop_as_u32_never_panics(x in -10000.0f64..10000.0, y in -10000.0f64..10000.0) {
            let c = Coord::<FrameSpace>::new(x, y);
            let (ux, uy) = c.as_u32();

            // Should clamp negatives to 0, never panic
            if x < 0.0 {
                prop_assert_eq!(ux, 0);
            }
            if y < 0.0 {
                prop_assert_eq!(uy, 0);
            }
        }
    }
}
