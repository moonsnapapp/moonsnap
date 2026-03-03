//! App-layer wrappers around shared preview/export parity logic.
//!
//! Canonical parity math and types live in the `moonsnap-render` crate.

use moonsnap_render::parity::{CompositionBounds, FontMetrics, ParityLayout};

/// Get the parity layout constants.
#[tauri::command]
pub fn get_parity_layout() -> ParityLayout {
    moonsnap_render::parity::get_parity_layout()
}

/// Tauri command to get composition bounds.
#[tauri::command]
pub fn get_composition_bounds(
    video_width: f32,
    video_height: f32,
    padding: f32,
    manual_width: Option<f32>,
    manual_height: Option<f32>,
) -> CompositionBounds {
    moonsnap_render::parity::get_composition_bounds(
        video_width,
        video_height,
        padding,
        manual_width,
        manual_height,
    )
}

/// Get font metrics for a given font family and size.
/// This allows CSS preview to use the exact same metrics as glyphon export.
#[tauri::command]
pub fn get_font_metrics(family: String, size: f32, weight: u32) -> FontMetrics {
    moonsnap_render::parity::get_font_metrics(family, size, weight)
}
