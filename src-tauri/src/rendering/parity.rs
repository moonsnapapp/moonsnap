//! Preview/Export parity constants and calculations.
//!
//! This module is the SINGLE SOURCE OF TRUTH for all layout values used
//! by both the CSS preview and GPU export. Never hardcode these values
//! elsewhere - always reference this module.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Layout constants for caption and background rendering.
/// All values are defined at 1080p reference resolution.
pub mod layout {
    /// Reference resolution height for scaling (1080p)
    pub const REFERENCE_HEIGHT: f32 = 1080.0;

    /// Caption padding from edges (px at 1080p)
    pub const CAPTION_PADDING: f32 = 40.0;

    /// Caption background horizontal padding (px at 1080p)
    pub const CAPTION_BG_PADDING_H: f32 = 16.0;

    /// Caption background vertical padding (px at 1080p)
    pub const CAPTION_BG_PADDING_V: f32 = 8.0;

    /// Caption corner radius (px at 1080p)
    pub const CAPTION_CORNER_RADIUS: f32 = 12.0;

    /// Line height multiplier (glyphon uses font_size * this)
    pub const LINE_HEIGHT_MULTIPLIER: f32 = 1.2;

    /// Default background padding (px at 1080p)
    pub const DEFAULT_BG_PADDING: f32 = 40.0;

    /// Default background corner rounding (px at 1080p)
    pub const DEFAULT_BG_ROUNDING: f32 = 12.0;
}

/// Calculate scale factor for any resolution relative to 1080p.
#[inline]
pub fn scale_factor(height: f32) -> f32 {
    height / layout::REFERENCE_HEIGHT
}

/// Parity layout constants exported to TypeScript.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ParityLayout {
    pub reference_height: f32,
    pub caption_padding: f32,
    pub caption_bg_padding_h: f32,
    pub caption_bg_padding_v: f32,
    pub caption_corner_radius: f32,
    pub line_height_multiplier: f32,
    pub default_bg_padding: f32,
    pub default_bg_rounding: f32,
}

impl Default for ParityLayout {
    fn default() -> Self {
        Self {
            reference_height: layout::REFERENCE_HEIGHT,
            caption_padding: layout::CAPTION_PADDING,
            caption_bg_padding_h: layout::CAPTION_BG_PADDING_H,
            caption_bg_padding_v: layout::CAPTION_BG_PADDING_V,
            caption_corner_radius: layout::CAPTION_CORNER_RADIUS,
            line_height_multiplier: layout::LINE_HEIGHT_MULTIPLIER,
            default_bg_padding: layout::DEFAULT_BG_PADDING,
            default_bg_rounding: layout::DEFAULT_BG_ROUNDING,
        }
    }
}

/// Get the parity layout constants.
#[tauri::command]
pub fn get_parity_layout() -> ParityLayout {
    ParityLayout::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scale_factor() {
        assert_eq!(scale_factor(1080.0), 1.0);
        assert!((scale_factor(720.0) - 0.6667).abs() < 0.001);
        assert_eq!(scale_factor(2160.0), 2.0);
    }

    #[test]
    fn test_parity_layout_default() {
        let layout = ParityLayout::default();
        assert_eq!(layout.reference_height, 1080.0);
        assert_eq!(layout.caption_padding, 40.0);
        assert_eq!(layout.line_height_multiplier, 1.2);
    }
}
