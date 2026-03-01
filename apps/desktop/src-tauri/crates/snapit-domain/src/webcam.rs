//! Shared webcam overlay domain types.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Position of the webcam overlay on the recording.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum WebcamPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
    /// Custom position (x, y from top-left of recording).
    Custom {
        x: i32,
        y: i32,
    },
}

/// Size of the webcam overlay.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum WebcamSize {
    /// ~15% of recording width.
    #[default]
    Small,
    /// ~20% of recording width.
    Large,
}

impl WebcamSize {
    /// Get the diameter/width as a fraction of the recording width.
    pub fn as_fraction(&self) -> f32 {
        match self {
            WebcamSize::Small => 0.15,
            WebcamSize::Large => 0.20,
        }
    }
}

/// Shape of the webcam overlay.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum WebcamShape {
    /// Circular overlay (common for PiP).
    #[default]
    Circle,
    /// Rectangular overlay with rounded corners.
    Rectangle,
}

/// Settings for webcam overlay during recording.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct WebcamSettings {
    /// Enable webcam overlay.
    pub enabled: bool,
    /// Selected webcam device index.
    pub device_index: usize,
    /// Position of the webcam overlay.
    pub position: WebcamPosition,
    /// Size of the webcam overlay.
    pub size: WebcamSize,
    /// Shape of the webcam overlay (circle or rectangle).
    pub shape: WebcamShape,
    /// Whether to mirror the webcam horizontally (selfie mode).
    pub mirror: bool,
}

/// Compute the position and size of the webcam overlay on a frame.
pub fn compute_webcam_rect(
    frame_width: u32,
    frame_height: u32,
    settings: &WebcamSettings,
) -> (i32, i32, u32) {
    let diameter = (frame_width as f32 * settings.size.as_fraction()) as u32;
    let margin = 20_i32;

    let (x, y) = match &settings.position {
        WebcamPosition::TopLeft => (margin, margin),
        WebcamPosition::TopRight => ((frame_width as i32) - (diameter as i32) - margin, margin),
        WebcamPosition::BottomLeft => (margin, (frame_height as i32) - (diameter as i32) - margin),
        WebcamPosition::BottomRight => (
            (frame_width as i32) - (diameter as i32) - margin,
            (frame_height as i32) - (diameter as i32) - margin,
        ),
        WebcamPosition::Custom { x, y } => (*x, *y),
    };

    (x, y, diameter)
}
