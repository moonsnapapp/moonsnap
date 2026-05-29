//! Text overlay segments, animation, and the `XY` helper.
//!
//! Split out of `video_project` and re-exported from it (crate-level sibling
//! module to keep ts-rs `export_to` path depth identical).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Text Configuration
// ============================================================================

/// Generic 2D coordinate/size type.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/", concrete(T = f64))]
pub struct XY<T> {
    pub x: T,
    pub y: T,
}

impl<T: Default> Default for XY<T> {
    fn default() -> Self {
        Self {
            x: T::default(),
            y: T::default(),
        }
    }
}

impl<T> XY<T> {
    pub fn new(x: T, y: T) -> Self {
        Self { x, y }
    }
}

/// Text animation style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum TextAnimation {
    #[default]
    None,
    TypeWriter,
}

impl<'de> Deserialize<'de> for TextAnimation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "none" | "fadeIn" | "fadeOut" | "fadeInOut" => Ok(Self::None),
            "typeWriter" | "typewriter" => Ok(Self::TypeWriter),
            _ => Err(serde::de::Error::unknown_variant(
                &value,
                &[
                    "none",
                    "typeWriter",
                    "fadeIn",
                    "fadeOut",
                    "fadeInOut",
                    "typewriter",
                ],
            )),
        }
    }
}

const MIN_TYPEWRITER_CHARS_PER_SECOND: f32 = 1.0;
const MAX_TYPEWRITER_CHARS_PER_SECOND: f32 = 60.0;

fn default_typewriter_chars_per_second() -> f32 {
    16.0
}

/// A text overlay segment.
/// Matches Cap's TextSegment model for consistency.
/// Supports backward compatibility with old format (startMs/endMs/text/x/y).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct TextSegment {
    /// Start time in seconds.
    pub start: f64,
    /// End time in seconds.
    pub end: f64,
    /// Whether this segment is enabled.
    pub enabled: bool,
    /// Text content.
    pub content: String,
    /// Center position (0-1 normalized, center-based positioning).
    pub center: XY<f64>,
    /// Bounding box size (0-1 normalized).
    pub size: XY<f64>,
    /// Font family.
    pub font_family: String,
    /// Font size in pixels (at 1080p reference).
    pub font_size: f32,
    /// Font weight (100-900).
    pub font_weight: f32,
    /// Italic style.
    pub italic: bool,
    /// Text color (hex format, e.g., "#ffffff").
    pub color: String,
    /// Optional background color (hex format). None = transparent.
    #[serde(default)]
    pub background_color: Option<String>,
    /// Optional background outline color (hex format). None = no outline.
    #[serde(default)]
    pub background_stroke_color: Option<String>,
    /// Background outline width in pixels (at 1080p reference).
    #[serde(default)]
    pub background_stroke_width: f32,
    /// Optional text outline color (hex format). None = no outline.
    #[serde(default)]
    pub stroke_color: Option<String>,
    /// Text outline width in pixels (at 1080p reference).
    #[serde(default)]
    pub stroke_width: f32,
    /// Fade duration in seconds (for fade in/out animation).
    pub fade_duration: f64,
    /// Text animation mode.
    #[serde(default)]
    pub animation: TextAnimation,
    /// Typewriter reveal speed in characters per second.
    #[serde(default = "default_typewriter_chars_per_second")]
    pub typewriter_chars_per_second: f32,
    /// Whether to play looping typewriter audio while this segment is active.
    #[serde(default)]
    pub typewriter_sound_enabled: bool,
}

/// Helper struct for deserializing both old and new TextSegment formats.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextSegmentRaw {
    // New format fields
    start: Option<f64>,
    end: Option<f64>,
    content: Option<String>,
    center: Option<XY<f64>>,
    size: Option<XY<f64>>,
    fade_duration: Option<f64>,
    animation: Option<TextAnimation>,
    typewriter_chars_per_second: Option<f32>,
    typewriter_sound_enabled: Option<bool>,

    // Old format fields (for backward compatibility)
    #[serde(default)]
    start_ms: Option<u64>,
    #[serde(default)]
    end_ms: Option<u64>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    x: Option<f32>,
    #[serde(default)]
    y: Option<f32>,

    // Common fields
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    font_family: Option<String>,
    #[serde(default)]
    font_size: Option<f32>,
    #[serde(default)]
    font_weight: Option<f32>,
    #[serde(default)]
    italic: Option<bool>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    background_color: Option<String>,
    #[serde(default)]
    background_stroke_color: Option<String>,
    #[serde(default)]
    background_stroke_width: Option<f32>,
    #[serde(default)]
    stroke_color: Option<String>,
    #[serde(default)]
    stroke_width: Option<f32>,
}

impl<'de> Deserialize<'de> for TextSegment {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = TextSegmentRaw::deserialize(deserializer)?;

        // Determine start time: prefer new format, fall back to old
        let start = raw
            .start
            .unwrap_or_else(|| raw.start_ms.map(|ms| ms as f64 / 1000.0).unwrap_or(0.0));

        // Determine end time: prefer new format, fall back to old
        let end = raw
            .end
            .unwrap_or_else(|| raw.end_ms.map(|ms| ms as f64 / 1000.0).unwrap_or(3.0));

        // Determine content: prefer new format, fall back to old 'text' field
        let content = raw
            .content
            .or(raw.text)
            .unwrap_or_else(|| "Text".to_string());

        // Determine center: prefer new format, fall back to old x/y (convert top-left to center)
        let center = raw.center.unwrap_or_else(|| {
            if let (Some(x), Some(y)) = (raw.x, raw.y) {
                // Old format used top-left positioning, approximate center
                XY::new(x as f64 + 0.15, y as f64 + 0.1)
            } else {
                XY::new(0.5, 0.5)
            }
        });

        // Size: use new format or default
        let size = raw.size.unwrap_or_else(|| XY::new(0.35, 0.2));

        // Fade duration: use new format or default
        let fade_duration = raw.fade_duration.unwrap_or(0.15);
        let animation = raw.animation.unwrap_or_default();
        let typewriter_chars_per_second = raw
            .typewriter_chars_per_second
            .unwrap_or(default_typewriter_chars_per_second())
            .clamp(
                MIN_TYPEWRITER_CHARS_PER_SECOND,
                MAX_TYPEWRITER_CHARS_PER_SECOND,
            );
        let typewriter_sound_enabled = raw.typewriter_sound_enabled.unwrap_or(false);

        Ok(TextSegment {
            start,
            end,
            enabled: raw.enabled.unwrap_or(true),
            content,
            center,
            size,
            font_family: raw.font_family.unwrap_or_else(|| "sans-serif".to_string()),
            font_size: raw.font_size.unwrap_or(48.0),
            font_weight: raw.font_weight.unwrap_or(700.0),
            italic: raw.italic.unwrap_or(false),
            color: raw.color.unwrap_or_else(|| "#ffffff".to_string()),
            background_color: raw.background_color,
            background_stroke_color: raw.background_stroke_color,
            background_stroke_width: raw.background_stroke_width.unwrap_or(0.0).max(0.0),
            stroke_color: raw.stroke_color,
            stroke_width: raw.stroke_width.unwrap_or(0.0).max(0.0),
            fade_duration,
            animation,
            typewriter_chars_per_second,
            typewriter_sound_enabled,
        })
    }
}

impl Default for TextSegment {
    fn default() -> Self {
        Self {
            start: 0.0,
            end: 3.0,
            enabled: true,
            content: "Text".to_string(),
            center: XY::new(0.5, 0.5),
            size: XY::new(0.35, 0.2),
            font_family: "sans-serif".to_string(),
            font_size: 48.0,
            font_weight: 700.0,
            italic: false,
            color: "#ffffff".to_string(),
            background_color: None,
            background_stroke_color: None,
            background_stroke_width: 0.0,
            stroke_color: None,
            stroke_width: 0.0,
            fade_duration: 0.15,
            animation: TextAnimation::None,
            typewriter_chars_per_second: default_typewriter_chars_per_second(),
            typewriter_sound_enabled: false,
        }
    }
}

/// Text overlay configuration.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct TextConfig {
    /// Text overlay segments.
    pub segments: Vec<TextSegment>,
}
