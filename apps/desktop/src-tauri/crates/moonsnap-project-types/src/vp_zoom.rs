//! Zoom configuration, regions, transitions, and auto-zoom.
//!
//! Split out of `video_project` and re-exported from it (crate-level sibling
//! module to keep ts-rs `export_to` path depth identical).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Zoom Configuration
// ============================================================================

pub const DEFAULT_ZOOM_SCALE: f32 = 1.4;

/// Zoom configuration for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ZoomConfig {
    /// Zoom mode.
    pub mode: ZoomMode,
    /// Default zoom scale for auto-generated zooms (e.g., 2.0 = 2x zoom).
    pub auto_zoom_scale: f32,
    /// All zoom regions (both auto and manual).
    pub regions: Vec<ZoomRegion>,
}

impl Default for ZoomConfig {
    fn default() -> Self {
        Self {
            mode: ZoomMode::Off,
            auto_zoom_scale: DEFAULT_ZOOM_SCALE,
            regions: Vec::new(),
        }
    }
}

/// Zoom mode - controls how zooms are applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ZoomMode {
    /// No zoom effects.
    Off,
    /// Automatically zoom to click locations.
    Auto,
    /// Only use manually placed zoom regions.
    Manual,
    /// Use both auto-generated and manual zooms.
    Both,
}

/// Per-region zoom mode - controls whether a region follows the cursor or uses a fixed position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ZoomRegionMode {
    /// Follow cursor position during playback (like Cap's Auto mode).
    /// The zoom center tracks the interpolated cursor position.
    #[default]
    Auto,
    /// Fixed position zoom (targetX/targetY determine the zoom center).
    Manual,
}

/// A zoom region defining when and where to zoom.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ZoomRegion {
    /// Unique identifier for this region.
    pub id: String,
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// Zoom scale (1.0 = no zoom, 2.0 = 2x zoom).
    pub scale: f32,
    /// Target X position (normalized 0-1, where 0.5 = center).
    /// Used as fallback when mode is Auto and no cursor data available.
    pub target_x: f32,
    /// Target Y position (normalized 0-1, where 0.5 = center).
    /// Used as fallback when mode is Auto and no cursor data available.
    pub target_y: f32,
    /// Zoom region mode - Auto follows cursor, Manual uses fixed position.
    #[serde(default)]
    pub mode: ZoomRegionMode,
    /// Whether this was auto-generated from a click event.
    pub is_auto: bool,
    /// Transition settings.
    pub transition: ZoomTransition,
    /// Motion blur strength for this zoom transition (0.0 = off, 2.0 = max).
    /// Snappier zooms benefit from more blur; gentle pans from less.
    #[serde(default = "crate::video_project::default_zoom_motion_blur")]
    pub motion_blur: f32,
}

/// Zoom transition settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ZoomTransition {
    /// Duration of zoom-in transition in milliseconds.
    pub duration_in_ms: u32,
    /// Duration of zoom-out transition in milliseconds.
    pub duration_out_ms: u32,
    /// Easing function for transitions.
    pub easing: EasingFunction,
}

impl Default for ZoomTransition {
    fn default() -> Self {
        Self {
            duration_in_ms: 1200,
            duration_out_ms: 900,
            easing: EasingFunction::EaseInOut,
        }
    }
}

/// Easing function for animations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum EasingFunction {
    /// Linear interpolation.
    Linear,
    /// Slow start.
    EaseIn,
    /// Slow end.
    EaseOut,
    /// Slow start and end.
    EaseInOut,
    /// Very smooth (smoothstep).
    Smooth,
    /// Quick start, gradual end.
    Snappy,
    /// Slight overshoot at end.
    Bouncy,
}

/// Configuration for auto-zoom generation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AutoZoomConfig {
    /// Zoom scale factor (e.g., 2.0 = 2x zoom).
    pub scale: f32,
    /// How long to hold the zoom at the click location (ms).
    pub hold_duration_ms: u32,
    /// Minimum gap between zoom regions (ms). Clicks closer than this are merged.
    pub min_gap_ms: u32,
    /// Transition in duration (ms).
    pub transition_in_ms: u32,
    /// Transition out duration (ms).
    pub transition_out_ms: u32,
    /// Easing function for transitions.
    pub easing: EasingFunction,
    /// Only include left clicks (ignore right/middle clicks).
    pub left_clicks_only: bool,
}

impl Default for AutoZoomConfig {
    fn default() -> Self {
        Self {
            scale: DEFAULT_ZOOM_SCALE,
            hold_duration_ms: 1500,
            min_gap_ms: 500,
            transition_in_ms: 1200,
            transition_out_ms: 900,
            easing: EasingFunction::EaseInOut,
            left_clicks_only: true,
        }
    }
}
