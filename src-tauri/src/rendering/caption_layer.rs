//! Caption rendering layer for video editor.
//!
//! Converts caption segments to prepared texts for GPU rendering.
//! Handles timing, word highlighting, and positioning.

use crate::commands::captions::{CaptionSegment, CaptionSettings, CaptionWord};
use crate::rendering::text::PreparedText;

/// Find the active caption segment at a given time.
pub fn find_active_segment(segments: &[CaptionSegment], time_secs: f32) -> Option<&CaptionSegment> {
    segments
        .iter()
        .find(|s| time_secs >= s.start && time_secs <= s.end)
}

/// Find the active word index within a segment.
pub fn find_active_word_index(words: &[CaptionWord], time_secs: f32) -> Option<usize> {
    words
        .iter()
        .position(|w| time_secs >= w.start && time_secs <= w.end)
}

/// Convert a hex color string to RGBA floats.
fn hex_to_rgba(hex: &str) -> [f32; 4] {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255) as f32 / 255.0;
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255) as f32 / 255.0;
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255) as f32 / 255.0;
        let a = if hex.len() >= 8 {
            u8::from_str_radix(&hex[6..8], 16).unwrap_or(255) as f32 / 255.0
        } else {
            1.0
        };
        [r, g, b, a]
    } else {
        [1.0, 1.0, 1.0, 1.0]
    }
}

/// Prepare caption text for rendering.
///
/// Returns a PreparedText that can be passed to the TextLayer for GPU rendering.
pub fn prepare_caption_text(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    time_secs: f32,
    output_width: f32,
    output_height: f32,
) -> PreparedText {
    let active_word_idx = find_active_word_index(&segment.words, time_secs);

    // Build text content with proper formatting
    // For simple rendering, we use the full segment text
    // Advanced word-level highlighting would require multiple text renders
    let content = segment.text.clone();

    // Determine color based on active word (simplified - full highlighting needs multiple passes)
    let color = if active_word_idx.is_some() {
        hex_to_rgba(&settings.highlight_color)
    } else {
        hex_to_rgba(&settings.color)
    };

    // Calculate position
    let padding = 40.0;
    let text_height = settings.size as f32 * 2.5; // Approximate height with line spacing
    let text_width = output_width - (padding * 2.0);

    let y_position = if settings.position == "top" {
        padding
    } else {
        output_height - text_height - padding
    };

    PreparedText {
        content,
        font_family: settings.font.clone(),
        font_size: settings.size as f32,
        font_weight: settings.font_weight as f32,
        italic: settings.italic,
        color,
        bounds: [
            padding,
            y_position,
            padding + text_width,
            y_position + text_height,
        ],
        opacity: 1.0,
    }
}

/// Prepare all active captions for rendering at a given time.
///
/// Returns a list of PreparedText items ready for the TextLayer.
pub fn prepare_captions(
    segments: &[CaptionSegment],
    settings: &CaptionSettings,
    time_secs: f32,
    output_width: f32,
    output_height: f32,
) -> Vec<PreparedText> {
    if !settings.enabled || segments.is_empty() {
        return Vec::new();
    }

    let mut texts = Vec::new();

    // Find and prepare the active segment
    if let Some(segment) = find_active_segment(segments, time_secs) {
        // Add background if opacity > 0
        // Note: Background rendering would need a separate shader/quad render
        // For now, we just prepare the text

        let text = prepare_caption_text(segment, settings, time_secs, output_width, output_height);
        texts.push(text);
    }

    texts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_settings() -> CaptionSettings {
        CaptionSettings {
            enabled: true,
            font: "System Sans-Serif".to_string(),
            size: 32,
            font_weight: 700,
            italic: false,
            color: "#A0A0A0".to_string(),
            highlight_color: "#FFFFFF".to_string(),
            background_color: "#000000".to_string(),
            background_opacity: 60,
            outline: false,
            outline_color: "#000000".to_string(),
            position: "bottom".to_string(),
            word_transition_duration: 0.25,
            fade_duration: 0.15,
            linger_duration: 0.4,
            export_with_subtitles: false,
        }
    }

    #[test]
    fn test_find_active_segment() {
        let segments = vec![
            CaptionSegment {
                id: "1".to_string(),
                start: 0.0,
                end: 2.0,
                text: "Hello world".to_string(),
                words: vec![],
            },
            CaptionSegment {
                id: "2".to_string(),
                start: 2.5,
                end: 4.0,
                text: "How are you".to_string(),
                words: vec![],
            },
        ];

        assert!(find_active_segment(&segments, 1.0).is_some());
        assert!(find_active_segment(&segments, 2.2).is_none());
        assert!(find_active_segment(&segments, 3.0).is_some());
    }

    #[test]
    fn test_hex_to_rgba() {
        let white = hex_to_rgba("#FFFFFF");
        assert!((white[0] - 1.0).abs() < 0.01);
        assert!((white[1] - 1.0).abs() < 0.01);
        assert!((white[2] - 1.0).abs() < 0.01);

        let red = hex_to_rgba("#FF0000");
        assert!((red[0] - 1.0).abs() < 0.01);
        assert!(red[1] < 0.01);
        assert!(red[2] < 0.01);
    }

    #[test]
    fn test_prepare_captions_disabled() {
        let mut settings = make_test_settings();
        settings.enabled = false;

        let texts = prepare_captions(&[], &settings, 1.0, 1920.0, 1080.0);
        assert!(texts.is_empty());
    }
}
