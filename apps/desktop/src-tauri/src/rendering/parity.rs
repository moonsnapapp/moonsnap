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
    pub const CAPTION_BG_PADDING_V: f32 = 16.0;

    /// Caption corner radius (px at 1080p)
    pub const CAPTION_CORNER_RADIUS: f32 = 20.0;

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

/// Composition bounds calculated for both preview and export.
/// This ensures identical frame positioning in both systems.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct CompositionBounds {
    /// Total output width
    pub output_width: f32,
    /// Total output height
    pub output_height: f32,
    /// Video frame X position within output
    pub frame_x: f32,
    /// Video frame Y position within output
    pub frame_y: f32,
    /// Video frame width
    pub frame_width: f32,
    /// Video frame height
    pub frame_height: f32,
    /// Actual padding used (may differ from requested in manual mode)
    pub effective_padding: f32,
}

/// Calculate composition bounds - THE source of truth for both preview and export.
///
/// # Arguments
/// * `video_width` - Source video width (after crop if applicable)
/// * `video_height` - Source video height (after crop if applicable)
/// * `requested_padding` - Desired padding around video
/// * `manual_output` - If Some, fixed output dimensions (manual composition mode)
pub fn calculate_composition_bounds(
    video_width: f32,
    video_height: f32,
    requested_padding: f32,
    manual_output: Option<(f32, f32)>,
) -> CompositionBounds {
    let video_aspect = video_width / video_height;

    match manual_output {
        None => {
            // Auto mode: output = video + padding
            let output_width = video_width + requested_padding * 2.0;
            let output_height = video_height + requested_padding * 2.0;
            CompositionBounds {
                output_width,
                output_height,
                frame_x: requested_padding,
                frame_y: requested_padding,
                frame_width: video_width,
                frame_height: video_height,
                effective_padding: requested_padding,
            }
        },
        Some((fixed_w, fixed_h)) => {
            // Manual mode: fit video + padding INTO fixed output
            let available_w = (fixed_w - requested_padding * 2.0).max(1.0);
            let available_h = (fixed_h - requested_padding * 2.0).max(1.0);
            let available_aspect = available_w / available_h;

            let (frame_w, frame_h) = if video_aspect > available_aspect {
                // Video is wider - fit to width
                (available_w, available_w / video_aspect)
            } else {
                // Video is taller - fit to height
                (available_h * video_aspect, available_h)
            };

            // Center the frame in the output
            let frame_x = (fixed_w - frame_w) / 2.0;
            let frame_y = (fixed_h - frame_h) / 2.0;

            CompositionBounds {
                output_width: fixed_w,
                output_height: fixed_h,
                frame_x,
                frame_y,
                frame_width: frame_w,
                frame_height: frame_h,
                effective_padding: requested_padding,
            }
        },
    }
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
    let manual_output = manual_width.zip(manual_height);
    calculate_composition_bounds(video_width, video_height, padding, manual_output)
}

/// Font metrics from glyphon for CSS preview synchronization.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FontMetrics {
    /// Actual font family that was resolved (e.g., "Arial" when "sans-serif" requested)
    pub resolved_family: String,
    /// Font size used for calculation
    pub font_size: f32,
    /// Line height in px (font_size * LINE_HEIGHT_MULTIPLIER)
    pub line_height: f32,
    /// Whether the requested font was found
    pub font_found: bool,
}

/// Get font metrics for a given font family and size.
/// This allows CSS preview to use the exact same metrics as glyphon export.
#[tauri::command]
pub fn get_font_metrics(family: String, size: f32, _weight: u32) -> FontMetrics {
    use glyphon::{Family, FontSystem};

    let font_system = FontSystem::new();
    let line_height = size * layout::LINE_HEIGHT_MULTIPLIER;

    // Parse family string to glyphon Family
    let glyphon_family = match family.to_lowercase().as_str() {
        "serif" => Family::Serif,
        "sans-serif" | "sans serif" | "system-ui" => Family::SansSerif,
        "monospace" | "mono" => Family::Monospace,
        "cursive" => Family::Cursive,
        "fantasy" => Family::Fantasy,
        _ => Family::Name(&family),
    };

    // Try to resolve the actual font
    let resolved_family = match glyphon_family {
        Family::Name(name) => name.to_string(),
        Family::Serif => "serif".to_string(),
        Family::SansSerif => "sans-serif".to_string(),
        Family::Monospace => "monospace".to_string(),
        Family::Cursive => "cursive".to_string(),
        Family::Fantasy => "fantasy".to_string(),
    };

    // Check if font exists by attempting to query the font system
    let font_found = font_system.db().faces().any(|face| {
        face.families
            .iter()
            .any(|(name, _)| name.to_lowercase() == family.to_lowercase())
    });

    FontMetrics {
        resolved_family,
        font_size: size,
        line_height,
        font_found: font_found
            || matches!(
                glyphon_family,
                Family::SansSerif | Family::Serif | Family::Monospace
            ),
    }
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

    #[test]
    fn test_composition_bounds_auto_mode() {
        let bounds = calculate_composition_bounds(1920.0, 1080.0, 40.0, None);
        assert_eq!(bounds.output_width, 2000.0);
        assert_eq!(bounds.output_height, 1160.0);
        assert_eq!(bounds.frame_x, 40.0);
        assert_eq!(bounds.frame_y, 40.0);
        assert_eq!(bounds.frame_width, 1920.0);
        assert_eq!(bounds.frame_height, 1080.0);
    }

    #[test]
    fn test_composition_bounds_manual_mode() {
        let bounds = calculate_composition_bounds(1920.0, 1080.0, 40.0, Some((1920.0, 1080.0)));
        assert_eq!(bounds.output_width, 1920.0);
        assert_eq!(bounds.output_height, 1080.0);
        // Video should be shrunk to fit within fixed output minus padding
        assert!(bounds.frame_width < 1920.0);
        assert!(bounds.frame_height < 1080.0);
        // Should be centered
        assert!(bounds.frame_x > 0.0);
        assert!(bounds.frame_y > 0.0);
    }

    #[test]
    fn test_composition_bounds_no_padding() {
        let bounds = calculate_composition_bounds(1920.0, 1080.0, 0.0, None);
        assert_eq!(bounds.output_width, 1920.0);
        assert_eq!(bounds.output_height, 1080.0);
        assert_eq!(bounds.frame_x, 0.0);
        assert_eq!(bounds.frame_y, 0.0);
    }
}
