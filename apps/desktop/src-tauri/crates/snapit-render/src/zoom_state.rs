//! Shared zoom-state type used across interpolation and rendering layers.

/// Current zoom state for a frame.
#[derive(Debug, Clone, Copy, Default)]
pub struct ZoomState {
    /// Zoom scale (1.0 = no zoom).
    pub scale: f32,
    /// Zoom center X (0.0-1.0, normalized).
    pub center_x: f32,
    /// Zoom center Y (0.0-1.0, normalized).
    pub center_y: f32,
}

impl ZoomState {
    pub fn identity() -> Self {
        Self {
            scale: 1.0,
            center_x: 0.5,
            center_y: 0.5,
        }
    }

    pub fn is_zoomed(&self) -> bool {
        self.scale > 1.001
    }
}
