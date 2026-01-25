//! Caption data types with ts-rs bindings.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single word with timing information.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionWord {
    /// The word text.
    pub text: String,
    /// Start time in seconds.
    pub start: f32,
    /// End time in seconds.
    pub end: f32,
}

/// A caption segment containing multiple words.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionSegment {
    /// Unique segment identifier.
    pub id: String,
    /// Start time in seconds.
    pub start: f32,
    /// End time in seconds.
    pub end: f32,
    /// Full text of the segment.
    pub text: String,
    /// Individual words with timing.
    pub words: Vec<CaptionWord>,
}

/// Caption styling and display settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionSettings {
    /// Whether captions are enabled.
    pub enabled: bool,

    // Typography
    /// Font family name.
    pub font: String,
    /// Font size in pixels.
    pub size: u32,
    /// Font weight (400 = normal, 700 = bold).
    pub font_weight: u32,
    /// Italic style.
    pub italic: bool,

    // Colors (hex format)
    /// Text color for inactive words.
    pub color: String,
    /// Text color for active/highlighted word.
    pub highlight_color: String,
    /// Background color.
    pub background_color: String,
    /// Background opacity (0-100).
    pub background_opacity: u32,
    /// Enable text outline.
    pub outline: bool,
    /// Outline color.
    pub outline_color: String,

    // Position
    /// Position: "top" or "bottom".
    pub position: String,

    // Animation timing (seconds)
    /// Duration of word highlight transition.
    pub word_transition_duration: f32,
    /// Duration of segment fade in/out.
    pub fade_duration: f32,
    /// How long segment stays after last word.
    pub linger_duration: f32,

    // Export
    /// Whether to burn captions into exported video.
    pub export_with_subtitles: bool,
}

impl Default for CaptionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
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
}

/// Complete caption data for a video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionData {
    /// Caption segments with word-level timing.
    pub segments: Vec<CaptionSegment>,
    /// Caption display settings.
    pub settings: CaptionSettings,
}

impl Default for CaptionData {
    fn default() -> Self {
        Self {
            segments: Vec::new(),
            settings: CaptionSettings::default(),
        }
    }
}

/// Whisper model information.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct WhisperModelInfo {
    /// Model name (tiny, base, small, medium, large-v3).
    pub name: String,
    /// Approximate file size in bytes.
    pub size_bytes: u64,
    /// Whether the model is downloaded.
    pub downloaded: bool,
    /// Local file path if downloaded.
    pub path: Option<String>,
}

/// Download progress event.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct DownloadProgress {
    /// Progress percentage (0-100).
    pub progress: f64,
    /// Status message.
    pub message: String,
}

/// Transcription progress event.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct TranscriptionProgress {
    /// Current stage: "extracting_audio", "transcribing", "complete".
    pub stage: String,
    /// Progress percentage (0-100).
    pub progress: f64,
    /// Status message.
    pub message: String,
}
