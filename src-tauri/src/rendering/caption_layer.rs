//! Caption rendering layer for video editor.
//!
//! Converts caption segments to prepared texts for GPU rendering.
//! Handles timing, word highlighting, and positioning.

use crate::commands::captions::{CaptionSegment, CaptionSettings, CaptionWord};
use crate::rendering::text::{PreparedText, WordColor};

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

/// Calculate background color with opacity from settings.
fn get_background_color(settings: &CaptionSettings) -> Option<[f32; 4]> {
    if settings.background_opacity > 0 {
        let mut bg = hex_to_rgba(&settings.background_color);
        bg[3] = (settings.background_opacity as f32) / 100.0;
        Some(bg)
    } else {
        None
    }
}

/// Build word colors for per-word highlighting.
fn build_word_colors(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    active_word_idx: Option<usize>,
) -> Option<Vec<WordColor>> {
    // Only build word colors if we have words and colors differ
    if segment.words.is_empty() || settings.color == settings.highlight_color {
        return None;
    }

    let base_color = hex_to_rgba(&settings.color);
    let highlight_color = hex_to_rgba(&settings.highlight_color);

    // Build the full text by joining words with spaces to get accurate byte positions
    let mut word_colors = Vec::with_capacity(segment.words.len());
    let mut byte_offset = 0;

    for (idx, word) in segment.words.iter().enumerate() {
        let word_bytes = word.text.len();
        let color = if Some(idx) == active_word_idx {
            highlight_color
        } else {
            base_color
        };

        word_colors.push(WordColor {
            start: byte_offset,
            end: byte_offset + word_bytes,
            color,
        });

        // Account for space after word (except last word)
        byte_offset += word_bytes;
        if idx < segment.words.len() - 1 {
            byte_offset += 1; // space
        }
    }

    Some(word_colors)
}

/// Prepare caption text for rendering.
///
/// Returns a PreparedText with background and shadow settings.
/// Word highlighting uses the highlight color when a word is active.
pub fn prepare_caption_text(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    time_secs: f32,
    output_width: f32,
    output_height: f32,
) -> PreparedText {
    let active_word_idx = find_active_word_index(&segment.words, time_secs);
    let background_color = get_background_color(settings);
    let text_shadow = settings.background_opacity == 0;

    // Calculate position
    let padding = 40.0;
    let text_height = settings.size as f32 * 2.5; // Approximate height with line spacing
    let text_width = output_width - (padding * 2.0);

    let y_position = if settings.position == "top" {
        padding
    } else {
        output_height - text_height - padding
    };

    let bounds = [
        padding,
        y_position,
        padding + text_width,
        y_position + text_height,
    ];

    // Base color (used for text without word highlighting)
    let base_color = hex_to_rgba(&settings.color);

    // Build word colors for per-word highlighting
    let word_colors = build_word_colors(segment, settings, active_word_idx);

    // Reconstruct text from words to ensure byte positions match
    let content = if !segment.words.is_empty() {
        segment
            .words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        segment.text.clone()
    };

    PreparedText {
        content,
        font_family: settings.font.clone(),
        font_size: settings.size as f32,
        font_weight: settings.font_weight as f32,
        italic: settings.italic,
        color: base_color,
        bounds,
        opacity: 1.0,
        background_color,
        text_shadow,
        word_colors,
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
