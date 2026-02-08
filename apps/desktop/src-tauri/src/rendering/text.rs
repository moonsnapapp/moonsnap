//! Text types for GPU rendering (captions).
//!
//! Contains PreparedText, WordColor, and parse_color used by the caption pipeline
//! (caption_layer.rs, text_layer.rs, compositor.rs).
//!
//! Note: Text overlay rendering now uses pre-rendered images from the frontend
//! (see prerendered_text.rs). The prepare_texts function was removed as text
//! overlays are rendered via CSS/OffscreenCanvas for WYSIWYG fidelity.

/// Word-level color information for highlighting.
#[derive(Debug, Clone)]
pub struct WordColor {
    /// Start byte offset in the text.
    pub start: usize,
    /// End byte offset in the text.
    pub end: usize,
    /// Color for this word as RGBA (0.0-1.0).
    pub color: [f32; 4],
}

/// Prepared text segment ready for GPU rendering.
#[derive(Debug, Clone)]
pub struct PreparedText {
    /// Text content to render.
    pub content: String,
    /// Bounding box [left, top, right, bottom] in pixels.
    pub bounds: [f32; 4],
    /// Text color as RGBA (0.0-1.0).
    pub color: [f32; 4],
    /// Font family name.
    pub font_family: String,
    /// Font size in pixels.
    pub font_size: f32,
    /// Font weight (100-900).
    pub font_weight: f32,
    /// Whether to use italic style.
    pub italic: bool,
    /// Opacity (0.0-1.0), used for fade animations.
    pub opacity: f32,
    /// Optional background color as RGBA (0.0-1.0). None = transparent.
    pub background_color: Option<[f32; 4]>,
    /// Optional text outline/shadow for readability (when no background).
    pub text_shadow: bool,
    /// Optional per-word colors for highlighting effects.
    pub word_colors: Option<Vec<WordColor>>,
}

/// Parse a hex color string to RGBA values.
pub fn parse_color(hex: &str) -> [f32; 4] {
    let color = hex.trim_start_matches('#');
    if color.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&color[0..2], 16),
            u8::from_str_radix(&color[2..4], 16),
            u8::from_str_radix(&color[4..6], 16),
        ) {
            return [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0];
        }
    }

    [1.0, 1.0, 1.0, 1.0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_color_hex() {
        let color = parse_color("#FF0000");
        assert!((color[0] - 1.0).abs() < 0.01);
        assert!(color[1].abs() < 0.01);
        assert!(color[2].abs() < 0.01);
        assert!((color[3] - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_color_white() {
        let color = parse_color("#ffffff");
        assert!((color[0] - 1.0).abs() < 0.01);
        assert!((color[1] - 1.0).abs() < 0.01);
        assert!((color[2] - 1.0).abs() < 0.01);
        assert!((color[3] - 1.0).abs() < 0.01);
    }
}
