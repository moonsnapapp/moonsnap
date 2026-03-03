//! Caption rendering layer for video editor.
//!
//! Converts caption segments to prepared texts for GPU rendering.
//! Handles timing, word highlighting, and positioning.

use crate::parity::{layout, scale_factor};
use crate::text::{PreparedText, WordColor};
use moonsnap_domain::captions::{CaptionSegment, CaptionSettings, CaptionWord};

/// Find the active caption segment at a given time.
pub fn find_active_segment<'a>(
    segments: &'a [CaptionSegment],
    settings: &CaptionSettings,
    time_secs: f32,
) -> Option<&'a CaptionSegment> {
    let linger_duration = settings.linger_duration.max(0.0);
    segments.iter().find(|s| {
        let visible_end = s.end + linger_duration;
        time_secs >= s.start && time_secs <= visible_end
    })
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

fn lerp_color(base: [f32; 4], highlight: [f32; 4], factor: f32) -> [f32; 4] {
    let t = factor.clamp(0.0, 1.0);
    [
        base[0] + (highlight[0] - base[0]) * t,
        base[1] + (highlight[1] - base[1]) * t,
        base[2] + (highlight[2] - base[2]) * t,
        base[3] + (highlight[3] - base[3]) * t,
    ]
}

fn word_highlight_factor(word: &CaptionWord, time_secs: f32, transition_duration: f32) -> f32 {
    let duration = transition_duration.max(0.0);
    if duration == 0.0 {
        if time_secs >= word.start && time_secs <= word.end {
            return 1.0;
        }
        return 0.0;
    }

    if time_secs >= word.start && time_secs <= word.end {
        return 1.0;
    }

    if time_secs < word.start {
        let distance = word.start - time_secs;
        if distance < duration {
            return 1.0 - distance / duration;
        }
        return 0.0;
    }

    let distance = time_secs - word.end;
    if distance < duration {
        return 1.0 - distance / duration;
    }
    0.0
}

fn calculate_segment_opacity(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    time_secs: f32,
) -> f32 {
    let visible_end = segment.end + settings.linger_duration.max(0.0);
    if time_secs < segment.start || time_secs > visible_end {
        return 0.0;
    }

    let fade_duration = settings.fade_duration.max(0.0);
    if fade_duration == 0.0 {
        return 1.0;
    }

    let visible_duration = (visible_end - segment.start).max(0.0);
    let time_since_start = time_secs - segment.start;
    let time_until_end = visible_end - time_secs;

    if time_since_start < fade_duration {
        return (time_since_start / fade_duration).clamp(0.0, 1.0);
    }

    if time_until_end < fade_duration && visible_duration > fade_duration * 2.0 {
        return (time_until_end / fade_duration).clamp(0.0, 1.0);
    }

    1.0
}

/// Build word colors for per-word highlighting.
fn build_word_colors(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    time_secs: f32,
) -> Option<Vec<WordColor>> {
    // Only build word colors if we have words and colors differ
    if segment.words.is_empty() || settings.color == settings.highlight_color {
        return None;
    }

    let base_color = hex_to_rgba(&settings.color);
    let highlight_color = hex_to_rgba(&settings.highlight_color);
    let transition_duration = settings.word_transition_duration.max(0.0);

    // Build the full text by joining words with spaces to get accurate byte positions
    let mut word_colors = Vec::with_capacity(segment.words.len());
    let mut byte_offset = 0;

    for (idx, word) in segment.words.iter().enumerate() {
        let word_bytes = word.text.len();
        let factor = word_highlight_factor(word, time_secs, transition_duration);
        let color = lerp_color(base_color, highlight_color, factor);

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
    let background_color = get_background_color(settings);
    let text_shadow = settings.background_opacity == 0;
    let opacity = calculate_segment_opacity(segment, settings, time_secs);

    // Scale factor based on output resolution (reference: 1080p)
    // This ensures captions look the same relative to frame at any export resolution
    let scale = scale_factor(output_height);

    // Calculate position - all values scale with output resolution
    let padding = layout::CAPTION_PADDING * scale;
    let font_size = settings.size as f32 * scale;
    let text_width = output_width - (padding * 2.0);

    // CSS positions caption using `bottom: padding` - the bottom edge of the background
    // is `padding` pixels from container bottom.
    // text_layer.rs computes: background_bottom = text_top + line_height + bg_padding_v
    // So: text_top = output_height - padding - line_height - bg_padding_v
    let line_height = font_size * layout::LINE_HEIGHT_MULTIPLIER;
    // bg_padding_v scales with resolution (reference: 1080p)
    let bg_padding_v = layout::CAPTION_BG_PADDING_V * scale;

    let y_position = if settings.position == "top" {
        // Top: background top at `padding`, so text_top = padding + bg_padding_v
        padding + bg_padding_v
    } else {
        // Bottom: background bottom at `output_height - padding`
        output_height - padding - line_height - bg_padding_v
    };

    // Bounds height just needs to contain the text (with some buffer for descenders)
    let bounds_height = font_size * 1.5;

    let bounds = [
        padding,
        y_position,
        padding + text_width,
        y_position + bounds_height,
    ];

    // Base color (used for text without word highlighting)
    let base_color = hex_to_rgba(&settings.color);

    // Build word colors for per-word highlighting
    let word_colors = build_word_colors(segment, settings, time_secs);

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
        font_size,
        font_weight: settings.font_weight as f32,
        italic: settings.italic,
        color: base_color,
        bounds,
        opacity,
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
    if let Some(segment) = find_active_segment(segments, settings, time_secs) {
        let text = prepare_caption_text(segment, settings, time_secs, output_width, output_height);
        if text.opacity > 0.001 {
            texts.push(text);
        }
    }

    texts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_settings() -> CaptionSettings {
        CaptionSettings {
            enabled: true,
            font: "sans-serif".to_string(),
            size: 32,
            font_weight: 700,
            italic: false,
            color: "#FFFFFF".to_string(),
            highlight_color: "#FFFF00".to_string(),
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
        let settings = make_test_settings();

        assert!(find_active_segment(&segments, &settings, 1.0).is_some());
        // Segment 1 remains visible during linger window (end + linger_duration = 2.4).
        assert!(find_active_segment(&segments, &settings, 2.2).is_some());
        assert!(find_active_segment(&segments, &settings, 3.0).is_some());
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
