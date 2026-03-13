//! Type definitions for video projects.
//!
//! A VideoProject represents all the data needed to edit and export a video recording:
//! - Source files (screen video, webcam video, cursor data)
//! - Timeline state (trim points, playback speed)
//! - Zoom configuration (auto/manual zoom regions)
//! - Cursor configuration (size, highlighting, motion blur)
//! - Webcam configuration (position, size, visibility segments)
//! - Export settings

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

use crate::captions::{CaptionSegment, CaptionSettings};

// ============================================================================
// Video Project
// ============================================================================

/// Complete video project with all editing metadata.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct VideoProject {
    /// Unique project identifier.
    pub id: String,
    /// Creation timestamp (ISO 8601).
    pub created_at: String,
    /// Last modified timestamp (ISO 8601).
    pub updated_at: String,
    /// Project name (usually derived from filename).
    pub name: String,
    /// Original on-disk filename preserved for quick-share/save defaults.
    #[serde(default)]
    pub original_file_name: Option<String>,
    /// Whether this recording originated from the quick capture flow.
    #[serde(default)]
    pub quick_capture: bool,
    /// Source files for this project.
    pub sources: VideoSources,
    /// Timeline editing state.
    pub timeline: TimelineState,
    /// Zoom configuration.
    pub zoom: ZoomConfig,
    /// Cursor configuration.
    pub cursor: CursorConfig,
    /// Webcam configuration.
    pub webcam: WebcamConfig,
    /// Audio track settings (volume, mixing).
    pub audio: AudioTrackSettings,
    /// Export settings.
    pub export: ExportConfig,
    /// Scene/camera mode configuration.
    pub scene: SceneConfig,
    /// Text overlay configuration.
    pub text: TextConfig,
    /// Timed annotation overlay configuration.
    #[serde(default)]
    pub annotations: AnnotationConfig,
    /// Mask/blur region configuration.
    #[serde(default)]
    pub mask: MaskConfig,
    /// Caption/transcription configuration.
    #[serde(default)]
    pub captions: CaptionSettings,
    /// Transcribed caption segments.
    #[serde(default)]
    pub caption_segments: Vec<CaptionSegment>,
}

/// Source files for a video project.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct VideoSources {
    /// Path to main screen recording.
    pub screen_video: String,
    /// Path to separate webcam recording (optional).
    pub webcam_video: Option<String>,
    /// Path to cursor events JSON file.
    pub cursor_data: Option<String>,
    /// Path to audio file if recorded separately (legacy, use system_audio/microphone_audio instead).
    pub audio_file: Option<String>,
    /// Path to system audio recording (desktop/app audio).
    pub system_audio: Option<String>,
    /// Path to microphone audio recording.
    pub microphone_audio: Option<String>,
    /// Path to background music file (user-added).
    pub background_music: Option<String>,
    /// Original recording dimensions.
    pub original_width: u32,
    pub original_height: u32,
    /// Recording duration in milliseconds.
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// Recording frame rate.
    pub fps: u32,
}

// ============================================================================
// Timeline
// ============================================================================

/// A trim segment representing a portion of the original video to include.
/// Multiple segments allow for non-linear editing (cutting out parts of the video).
/// The order of segments in the array determines playback order.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct TrimSegment {
    /// Unique identifier for this segment.
    pub id: String,
    /// Start position in the ORIGINAL video (milliseconds).
    #[ts(type = "number")]
    pub source_start_ms: u64,
    /// End position in the ORIGINAL video (milliseconds).
    #[ts(type = "number")]
    pub source_end_ms: u64,
}

/// Timeline editing state.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct TimelineState {
    /// Total duration in milliseconds (from source).
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// Trim start point in ms.
    #[ts(type = "number")]
    pub in_point: u64,
    /// Trim end point in ms.
    #[ts(type = "number")]
    pub out_point: u64,
    /// Playback speed multiplier (1.0 = normal).
    pub speed: f32,
    /// Trim segments for non-linear editing.
    /// Empty array means use the full video (no cuts).
    /// When segments exist, only the specified portions are included in playback/export.
    #[serde(default)]
    pub segments: Vec<TrimSegment>,
}

impl Default for TimelineState {
    fn default() -> Self {
        Self {
            duration_ms: 0,
            in_point: 0,
            out_point: 0,
            speed: 1.0,
            segments: Vec::new(),
        }
    }
}

impl TimelineState {
    /// Get the effective duration based on segments.
    /// If segments exist, returns sum of all segment durations.
    /// Otherwise returns out_point - in_point.
    pub fn effective_duration_ms(&self) -> u64 {
        if self.segments.is_empty() {
            self.out_point - self.in_point
        } else {
            self.segments
                .iter()
                .map(|s| s.source_end_ms - s.source_start_ms)
                .sum()
        }
    }

    /// Convert timeline time (position in edited video) to source time (position in original video).
    /// Timeline time is the accumulated position after edits.
    /// Returns None if timeline_time is out of range.
    pub fn timeline_to_source(&self, timeline_time_ms: u64) -> Option<u64> {
        if self.segments.is_empty() {
            // No segments - simple offset from in_point
            Some(self.in_point + timeline_time_ms)
        } else {
            let mut accumulated = 0u64;
            for segment in &self.segments {
                let segment_duration = segment.source_end_ms - segment.source_start_ms;
                if timeline_time_ms < accumulated + segment_duration {
                    // Found the segment - calculate offset within it
                    let offset = timeline_time_ms - accumulated;
                    return Some(segment.source_start_ms + offset);
                }
                accumulated += segment_duration;
            }
            // Past all segments - return end of last segment
            self.segments.last().map(|s| s.source_end_ms)
        }
    }

    /// Check if a source time falls within any kept segment.
    pub fn is_source_time_in_segments(&self, source_time_ms: u64) -> bool {
        if self.segments.is_empty() {
            source_time_ms >= self.in_point && source_time_ms <= self.out_point
        } else {
            self.segments
                .iter()
                .any(|s| source_time_ms >= s.source_start_ms && source_time_ms < s.source_end_ms)
        }
    }

    /// Get the decode range (start, end) in source time.
    /// When segments exist, returns (first_segment_start, last_segment_end).
    pub fn decode_range(&self) -> (u64, u64) {
        if self.segments.is_empty() {
            (self.in_point, self.out_point)
        } else {
            let start = self
                .segments
                .first()
                .map(|s| s.source_start_ms)
                .unwrap_or(0);
            let end = self.segments.last().map(|s| s.source_end_ms).unwrap_or(0);
            (start, end)
        }
    }

    /// Convert source time (position in original video) to timeline time (position in edited video).
    /// Returns None if source_time is not in any kept segment.
    pub fn source_to_timeline(&self, source_time_ms: u64) -> Option<u64> {
        if self.segments.is_empty() {
            // No segments - simple offset from in_point
            if source_time_ms >= self.in_point && source_time_ms <= self.out_point {
                Some(source_time_ms - self.in_point)
            } else {
                None
            }
        } else {
            let mut timeline_pos = 0u64;
            for segment in &self.segments {
                if source_time_ms >= segment.source_start_ms
                    && source_time_ms < segment.source_end_ms
                {
                    // Found the segment - calculate offset within it
                    let offset = source_time_ms - segment.source_start_ms;
                    return Some(timeline_pos + offset);
                }
                timeline_pos += segment.source_end_ms - segment.source_start_ms;
            }
            // Not in any segment
            None
        }
    }
}

// ============================================================================
// Audio Track Settings
// ============================================================================

/// Audio track mixing settings for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AudioTrackSettings {
    /// System audio volume (0.0 - 1.0).
    pub system_volume: f32,
    /// Microphone audio volume (0.0 - 1.0).
    pub microphone_volume: f32,
    /// Background music volume (0.0 - 1.0).
    pub music_volume: f32,
    /// Fade in duration for background music (seconds).
    pub music_fade_in_secs: f32,
    /// Fade out duration for background music (seconds).
    pub music_fade_out_secs: f32,
    /// Normalize output audio to -16 LUFS.
    pub normalize_output: bool,
    /// Mute system audio track.
    pub system_muted: bool,
    /// Mute microphone track.
    pub microphone_muted: bool,
    /// Mute background music.
    pub music_muted: bool,
}

impl Default for AudioTrackSettings {
    fn default() -> Self {
        Self {
            system_volume: 1.0,
            microphone_volume: 1.0,
            music_volume: 0.25,
            music_fade_in_secs: 2.0,
            music_fade_out_secs: 3.0,
            normalize_output: true,
            system_muted: false,
            microphone_muted: false,
            music_muted: false,
        }
    }
}

// ============================================================================
// Zoom Configuration
// ============================================================================

/// Zoom configuration for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ZoomConfig {
    /// Zoom mode.
    pub mode: ZoomMode,
    /// Default zoom scale for auto-generated zooms (e.g., 2.0 = 2x zoom).
    pub auto_zoom_scale: f32,
    /// All zoom regions (both auto and manual).
    pub regions: Vec<ZoomRegion>,
}

impl Default for ZoomConfig {
    fn default() -> Self {
        Self {
            mode: ZoomMode::Off,
            auto_zoom_scale: 2.0,
            regions: Vec::new(),
        }
    }
}

/// Zoom mode - controls how zooms are applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ZoomMode {
    /// No zoom effects.
    Off,
    /// Automatically zoom to click locations.
    Auto,
    /// Only use manually placed zoom regions.
    Manual,
    /// Use both auto-generated and manual zooms.
    Both,
}

/// Per-region zoom mode - controls whether a region follows the cursor or uses a fixed position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ZoomRegionMode {
    /// Follow cursor position during playback (like Cap's Auto mode).
    /// The zoom center tracks the interpolated cursor position.
    #[default]
    Auto,
    /// Fixed position zoom (targetX/targetY determine the zoom center).
    Manual,
}

/// A zoom region defining when and where to zoom.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ZoomRegion {
    /// Unique identifier for this region.
    pub id: String,
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// Zoom scale (1.0 = no zoom, 2.0 = 2x zoom).
    pub scale: f32,
    /// Target X position (normalized 0-1, where 0.5 = center).
    /// Used as fallback when mode is Auto and no cursor data available.
    pub target_x: f32,
    /// Target Y position (normalized 0-1, where 0.5 = center).
    /// Used as fallback when mode is Auto and no cursor data available.
    pub target_y: f32,
    /// Zoom region mode - Auto follows cursor, Manual uses fixed position.
    #[serde(default)]
    pub mode: ZoomRegionMode,
    /// Whether this was auto-generated from a click event.
    pub is_auto: bool,
    /// Transition settings.
    pub transition: ZoomTransition,
}

/// Zoom transition settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ZoomTransition {
    /// Duration of zoom-in transition in milliseconds.
    pub duration_in_ms: u32,
    /// Duration of zoom-out transition in milliseconds.
    pub duration_out_ms: u32,
    /// Easing function for transitions.
    pub easing: EasingFunction,
}

impl Default for ZoomTransition {
    fn default() -> Self {
        Self {
            duration_in_ms: 300,
            duration_out_ms: 300,
            easing: EasingFunction::EaseInOut,
        }
    }
}

/// Easing function for animations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum EasingFunction {
    /// Linear interpolation.
    Linear,
    /// Slow start.
    EaseIn,
    /// Slow end.
    EaseOut,
    /// Slow start and end.
    EaseInOut,
    /// Very smooth (smoothstep).
    Smooth,
    /// Quick start, gradual end.
    Snappy,
    /// Slight overshoot at end.
    Bouncy,
}

/// Configuration for auto-zoom generation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AutoZoomConfig {
    /// Zoom scale factor (e.g., 2.0 = 2x zoom).
    pub scale: f32,
    /// How long to hold the zoom at the click location (ms).
    pub hold_duration_ms: u32,
    /// Minimum gap between zoom regions (ms). Clicks closer than this are merged.
    pub min_gap_ms: u32,
    /// Transition in duration (ms).
    pub transition_in_ms: u32,
    /// Transition out duration (ms).
    pub transition_out_ms: u32,
    /// Easing function for transitions.
    pub easing: EasingFunction,
    /// Only include left clicks (ignore right/middle clicks).
    pub left_clicks_only: bool,
}

impl Default for AutoZoomConfig {
    fn default() -> Self {
        Self {
            scale: 2.0,
            hold_duration_ms: 1500,
            min_gap_ms: 500,
            transition_in_ms: 300,
            transition_out_ms: 300,
            easing: EasingFunction::EaseInOut,
            left_clicks_only: true,
        }
    }
}

// ============================================================================
// Cursor Configuration
// ============================================================================

/// Type of cursor to display in output video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum CursorType {
    /// Use the actual recorded cursor appearance.
    #[default]
    Auto,
    /// Display a simple circle indicator instead of actual cursor.
    Circle,
}

/// Cursor rendering configuration.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct CursorConfig {
    /// Show cursor in output video.
    pub visible: bool,
    /// Type of cursor to display (actual cursor or circle indicator).
    #[serde(default)]
    pub cursor_type: CursorType,
    /// Scale factor (1.0 = native size, 2.0 = double size).
    pub scale: f32,
    /// Zoom-adaptive cursor smoothing amount (0.0 = linear, 1.0 = smooth).
    #[serde(default = "default_cursor_dampening")]
    pub dampening: f32,
    /// Motion blur amount (0.0 = none, 1.0 = maximum).
    #[serde(default)]
    pub motion_blur: f32,
    /// Fade cursor out after inactivity.
    #[serde(default = "default_cursor_hide_when_idle")]
    pub hide_when_idle: bool,
    /// Click highlight settings.
    pub click_highlight: ClickHighlightConfig,
}

const fn default_cursor_hide_when_idle() -> bool {
    true
}

const fn default_cursor_dampening() -> f32 {
    0.5
}

impl Default for CursorConfig {
    fn default() -> Self {
        Self {
            visible: true,
            cursor_type: CursorType::default(),
            scale: 1.0,
            dampening: default_cursor_dampening(),
            motion_blur: 0.0,
            hide_when_idle: default_cursor_hide_when_idle(),
            click_highlight: ClickHighlightConfig::default(),
        }
    }
}

/// Click highlight animation settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ClickHighlightConfig {
    /// Enable click highlighting.
    pub enabled: bool,
    /// Highlight color (CSS color string, e.g., "#FF6B6B" or "rgba(255,107,107,0.5)").
    pub color: String,
    /// Highlight radius in pixels.
    pub radius: u32,
    /// Animation duration in milliseconds.
    pub duration_ms: u32,
    /// Highlight style.
    pub style: ClickHighlightStyle,
}

impl Default for ClickHighlightConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            color: "#FF6B6B".to_string(),
            radius: 30,
            duration_ms: 400,
            style: ClickHighlightStyle::Ripple,
        }
    }
}

/// Style of click highlight animation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ClickHighlightStyle {
    /// Expanding circle animation.
    Ripple,
    /// Static glow effect.
    Spotlight,
    /// Hollow ring animation.
    Ring,
}

// ============================================================================
// Webcam Configuration
// ============================================================================

/// Webcam overlay configuration.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct WebcamConfig {
    /// Show webcam in output video.
    pub enabled: bool,
    /// Position preset.
    pub position: WebcamOverlayPosition,
    /// Custom position (used when position is Custom).
    pub custom_x: f32,
    pub custom_y: f32,
    /// Size as percentage of video width (e.g., 0.2 = 20%).
    pub size: f32,
    /// Shape of webcam overlay.
    pub shape: WebcamOverlayShape,
    /// Corner rounding percentage (0-100). At 100%, a square becomes a circle/squircle.
    #[serde(default = "default_rounding")]
    pub rounding: f32,
    /// Corner style - Squircle (iOS-style) or Rounded (standard border-radius).
    #[serde(default)]
    pub corner_style: CornerStyle,
    /// Shadow strength (0-100). 0 = no shadow.
    #[serde(default = "default_shadow")]
    pub shadow: f32,
    /// Advanced shadow settings (size, opacity, blur).
    #[serde(default)]
    pub shadow_config: ShadowConfig,
    /// Mirror horizontally.
    pub mirror: bool,
    /// Border settings.
    pub border: WebcamBorder,
    /// Visibility segments (for toggling on/off during video).
    pub visibility_segments: Vec<VisibilitySegment>,
}

fn default_rounding() -> f32 {
    100.0
}

fn default_shadow() -> f32 {
    62.5
}

impl Default for WebcamConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            position: WebcamOverlayPosition::BottomRight,
            custom_x: 0.95,
            custom_y: 0.95,
            size: 0.2, // 20% of video width
            shape: WebcamOverlayShape::RoundedRectangle,
            rounding: default_rounding(),
            corner_style: CornerStyle::default(),
            shadow: default_shadow(),
            shadow_config: ShadowConfig::default(),
            mirror: false,
            border: WebcamBorder::default(),
            visibility_segments: Vec::new(),
        }
    }
}

/// Shadow configuration for webcam overlay.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ShadowConfig {
    /// Shadow size as percentage (0-100).
    pub size: f32,
    /// Shadow opacity (0-100).
    pub opacity: f32,
    /// Shadow blur amount (0-100).
    pub blur: f32,
}

impl Default for ShadowConfig {
    fn default() -> Self {
        Self {
            size: 33.9,
            opacity: 44.2,
            blur: 10.5,
        }
    }
}

/// Webcam overlay position preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum WebcamOverlayPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    /// Custom position using custom_x and custom_y.
    Custom,
}

/// Webcam overlay shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum WebcamOverlayShape {
    /// Perfect circle (forces 1:1 aspect ratio).
    Circle,
    /// Rectangle with no rounding (forces 16:9 aspect ratio).
    Rectangle,
    /// Squircle shape (forces 1:1 aspect ratio).
    RoundedRectangle,
    /// Native aspect ratio with squircle rounding.
    Source,
}

/// Corner style for rounded shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum CornerStyle {
    /// iOS-style superellipse corners.
    #[default]
    Squircle,
    /// Standard circular border-radius corners.
    Rounded,
}

/// Webcam border settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct WebcamBorder {
    /// Show border.
    pub enabled: bool,
    /// Border width in pixels.
    pub width: u32,
    /// Border color (CSS color string).
    pub color: String,
}

impl Default for WebcamBorder {
    fn default() -> Self {
        Self {
            enabled: false,
            width: 3,
            color: "#FFFFFF".to_string(),
        }
    }
}

/// A segment defining visibility state over time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct VisibilitySegment {
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// Whether visible during this segment.
    pub visible: bool,
}

// ============================================================================
// Export Configuration
// ============================================================================

/// Export settings for the final video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ExportConfig {
    /// Output format.
    pub format: ExportFormat,
    /// Quality (1-100).
    pub quality: u32,
    /// Frames per second.
    pub fps: u32,
    /// Background configuration for letterboxing/padding.
    pub background: BackgroundConfig,
    /// Crop configuration for video content (crops source video before composition).
    #[serde(default)]
    pub crop: CropConfig,
    /// Composition configuration (output canvas size/aspect).
    #[serde(default)]
    pub composition: CompositionConfig,
    /// Prefer hardware encoding (NVENC) when available.
    /// Defaults to true. Set to false to force software encoding.
    #[serde(default = "default_prefer_hardware")]
    pub prefer_hardware_encoding: Option<bool>,
}

fn default_prefer_hardware() -> Option<bool> {
    Some(false)
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            format: ExportFormat::Mp4,
            quality: 80,
            fps: 30,
            background: BackgroundConfig::default(),
            crop: CropConfig::default(),
            composition: CompositionConfig::default(),
            prefer_hardware_encoding: Some(false),
        }
    }
}

/// Export format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ExportFormat {
    Mp4,
    Webm,
    Gif,
}

/// Background type for letterboxing.
/// Matches Cap's BackgroundSource enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum BackgroundType {
    /// Solid color background.
    Solid,
    /// Gradient background.
    Gradient,
    /// Built-in wallpaper preset.
    Wallpaper,
    /// Custom image background.
    Image,
}

/// Shadow configuration for video frame background.
/// Uses a single shadow value (0-100) like webcam for simplicity.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct BackgroundShadowConfig {
    /// Shadow enabled.
    pub enabled: bool,
    /// Shadow intensity (0-100). Controls both blur size and opacity.
    /// Blur = (shadow / 100) * minDim * 0.15
    /// Opacity = (shadow / 100) * 0.5
    #[serde(default = "default_shadow_value")]
    pub shadow: f32,
}

fn default_true() -> bool {
    true
}

fn default_shadow_value() -> f32 {
    50.0 // Sensible default - visible but not overwhelming
}

impl Default for BackgroundShadowConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            shadow: default_shadow_value(),
        }
    }
}

/// Border configuration for video frame.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct BorderConfig {
    /// Border enabled.
    pub enabled: bool,
    /// Border width in pixels (1-20).
    pub width: f32,
    /// Border color (hex format).
    pub color: String,
    /// Border opacity (0-100).
    pub opacity: f32,
}

impl Default for BorderConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            width: 5.0, // Cap's default
            color: "#ffffff".to_string(),
            opacity: 80.0,
        }
    }
}

/// Background configuration for letterboxing/padding.
/// Matches Cap's BackgroundConfiguration struct.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct BackgroundConfig {
    /// Whether the background styling is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Type of background (Solid, Gradient, Wallpaper, Image).
    pub bg_type: BackgroundType,
    /// Solid color (hex format, e.g., "#000000").
    pub solid_color: String,
    /// Gradient start color (hex format).
    pub gradient_start: String,
    /// Gradient end color (hex format).
    pub gradient_end: String,
    /// Gradient angle in degrees (0-360).
    pub gradient_angle: f32,
    /// Wallpaper preset name (e.g., "macOS/sequoia-dark").
    #[serde(default)]
    pub wallpaper: Option<String>,
    /// Custom image path.
    #[serde(default)]
    pub image_path: Option<String>,
    /// Background blur amount (0-100%).
    #[serde(default)]
    pub blur: f32,
    /// Padding around video frame (0-200 pixels).
    #[serde(default)]
    pub padding: f32,
    /// Inset value (pixels).
    #[serde(default)]
    pub inset: u32,
    /// Corner rounding radius (0-200 pixels).
    #[serde(default)]
    pub rounding: f32,
    /// Corner rounding style (squircle or rounded).
    #[serde(default)]
    pub rounding_type: CornerStyle,
    /// Shadow configuration.
    #[serde(default)]
    pub shadow: BackgroundShadowConfig,
    /// Border configuration.
    #[serde(default)]
    pub border: BorderConfig,
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bg_type: BackgroundType::Wallpaper,
            solid_color: "#ffffff".to_string(), // Cap's default: white
            gradient_start: "#4785ff".to_string(), // Cap's default: blue [71, 133, 255]
            gradient_end: "#ff4766".to_string(), // Cap's default: red/pink [255, 71, 102]
            gradient_angle: 135.0,
            wallpaper: Some("macOS/sequoia-dark".to_string()),
            image_path: None,
            blur: 0.0,
            padding: 0.0,
            inset: 0,
            rounding: 0.0,
            rounding_type: CornerStyle::default(),
            shadow: BackgroundShadowConfig::default(),
            border: BorderConfig::default(),
        }
    }
}

/// Crop configuration for video output.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct CropConfig {
    /// Enable cropping.
    pub enabled: bool,
    /// Crop X position (pixels from left).
    pub x: u32,
    /// Crop Y position (pixels from top).
    pub y: u32,
    /// Crop width (pixels).
    pub width: u32,
    /// Crop height (pixels).
    pub height: u32,
    /// Lock aspect ratio.
    pub lock_aspect_ratio: bool,
    /// Locked aspect ratio (width/height), e.g., 1.7778 for 16:9.
    pub aspect_ratio: Option<f32>,
}

/// Composition mode for output canvas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum CompositionMode {
    /// Auto mode - composition matches video crop dimensions (+ padding).
    #[default]
    Auto,
    /// Manual mode - user specifies composition aspect ratio.
    Manual,
}

/// Composition configuration for output canvas.
/// Defines how the cropped video is placed within the output frame.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct CompositionConfig {
    /// Composition mode (auto or manual).
    #[serde(default)]
    pub mode: CompositionMode,
    /// Target aspect ratio for manual mode (width/height, e.g., 1.7778 for 16:9).
    /// In auto mode, this is ignored.
    pub aspect_ratio: Option<f32>,
    /// Preset aspect ratio name for UI (e.g., "16:9", "1:1").
    pub aspect_preset: Option<String>,
    /// Fixed width for manual mode (if set, overrides aspect_ratio calculation).
    pub width: Option<u32>,
    /// Fixed height for manual mode (if set, overrides aspect_ratio calculation).
    pub height: Option<u32>,
}

impl Default for CompositionConfig {
    fn default() -> Self {
        Self {
            mode: CompositionMode::Auto,
            aspect_ratio: None,
            aspect_preset: None,
            width: None,
            height: None,
        }
    }
}

/// Audio waveform data for visualization.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AudioWaveform {
    /// Downsampled audio samples (normalized -1.0 to 1.0).
    pub samples: Vec<f32>,
    /// Duration of the audio in milliseconds.
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// Number of samples per second in this waveform data.
    pub samples_per_second: u32,
}

// ============================================================================
// Scene Configuration
// ============================================================================

/// Scene mode for different camera/screen configurations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum SceneMode {
    /// Default mode - screen with webcam overlay.
    Default,
    /// Camera-only mode - fullscreen webcam.
    CameraOnly,
    /// Screen-only mode - hide webcam.
    ScreenOnly,
}

impl std::fmt::Display for SceneMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SceneMode::Default => write!(f, "Default"),
            SceneMode::CameraOnly => write!(f, "CameraOnly"),
            SceneMode::ScreenOnly => write!(f, "ScreenOnly"),
        }
    }
}

/// A scene segment defining the mode for a time range.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct SceneSegment {
    /// Unique identifier for this segment.
    pub id: String,
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// Scene mode for this segment.
    pub mode: SceneMode,
}

/// Scene configuration for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct SceneConfig {
    /// Scene segments defining modes over time.
    pub segments: Vec<SceneSegment>,
    /// Default scene mode when no segment applies.
    pub default_mode: SceneMode,
}

impl Default for SceneConfig {
    fn default() -> Self {
        Self {
            segments: Vec::new(),
            default_mode: SceneMode::Default,
        }
    }
}

// ============================================================================
// Annotation Configuration
// ============================================================================

/// Supported annotation shape types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum AnnotationShapeType {
    Rectangle,
    Ellipse,
    #[default]
    Arrow,
    Line,
    Step,
    Text,
}

fn default_annotation_stroke_color() -> String {
    "#F97316".to_string()
}

fn default_annotation_fill_color() -> String {
    "rgba(249, 115, 22, 0.16)".to_string()
}

fn default_annotation_text() -> String {
    "Note".to_string()
}

fn default_annotation_font_family() -> String {
    "sans-serif".to_string()
}

/// A single annotation shape drawn within an annotation segment.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AnnotationShape {
    /// Unique identifier.
    pub id: String,
    /// Shape type.
    #[serde(default)]
    pub shape_type: AnnotationShapeType,
    /// X position (0-1, normalized from left).
    pub x: f32,
    /// Y position (0-1, normalized from top).
    pub y: f32,
    /// Width (0-1, normalized).
    pub width: f32,
    /// Height (0-1, normalized).
    pub height: f32,
    /// Arrow/line start X position (0-1 normalized).
    #[serde(default)]
    pub arrow_start_x: Option<f32>,
    /// Arrow/line start Y position (0-1 normalized).
    #[serde(default)]
    pub arrow_start_y: Option<f32>,
    /// Arrow/line end X position (0-1 normalized).
    #[serde(default)]
    pub arrow_end_x: Option<f32>,
    /// Arrow/line end Y position (0-1 normalized).
    #[serde(default)]
    pub arrow_end_y: Option<f32>,
    /// Stroke color.
    #[serde(default = "default_annotation_stroke_color")]
    pub stroke_color: String,
    /// Fill color for closed shapes.
    #[serde(default = "default_annotation_fill_color")]
    pub fill_color: String,
    /// Stroke width in 1080p reference pixels.
    #[serde(default = "AnnotationShape::default_stroke_width")]
    pub stroke_width: f32,
    /// Opacity multiplier (0-1).
    #[serde(default = "AnnotationShape::default_opacity")]
    pub opacity: f32,
    /// Step number for badge annotations.
    #[serde(default = "AnnotationShape::default_number")]
    pub number: u32,
    /// Text content for text annotations.
    #[serde(default = "default_annotation_text")]
    pub text: String,
    /// Font size in 1080p reference pixels.
    #[serde(default = "AnnotationShape::default_font_size")]
    pub font_size: f32,
    /// Font family for text annotations.
    #[serde(default = "default_annotation_font_family")]
    pub font_family: String,
    /// Font weight for text annotations.
    #[serde(default = "AnnotationShape::default_font_weight")]
    pub font_weight: f32,
}

impl AnnotationShape {
    fn default_stroke_width() -> f32 {
        16.0
    }

    fn default_opacity() -> f32 {
        1.0
    }

    fn default_number() -> u32 {
        1
    }

    fn default_font_size() -> f32 {
        42.0
    }

    fn default_font_weight() -> f32 {
        700.0
    }
}

impl Default for AnnotationShape {
    fn default() -> Self {
        Self {
            id: "annotation-shape".to_string(),
            shape_type: AnnotationShapeType::Arrow,
            x: 0.2,
            y: 0.2,
            width: 0.3,
            height: 0.2,
            arrow_start_x: None,
            arrow_start_y: None,
            arrow_end_x: None,
            arrow_end_y: None,
            stroke_color: default_annotation_stroke_color(),
            fill_color: default_annotation_fill_color(),
            stroke_width: Self::default_stroke_width(),
            opacity: Self::default_opacity(),
            number: Self::default_number(),
            text: default_annotation_text(),
            font_size: Self::default_font_size(),
            font_family: default_annotation_font_family(),
            font_weight: Self::default_font_weight(),
        }
    }
}

/// A timed annotation segment containing one or more shapes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AnnotationSegment {
    /// Unique identifier for this segment.
    pub id: String,
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// Whether this segment is enabled.
    #[serde(default = "default_annotation_segment_enabled")]
    pub enabled: bool,
    /// Shapes drawn during this segment.
    #[serde(default)]
    pub shapes: Vec<AnnotationShape>,
}

const fn default_annotation_segment_enabled() -> bool {
    true
}

/// Annotation overlay configuration for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AnnotationConfig {
    /// Timed annotation segments.
    pub segments: Vec<AnnotationSegment>,
}

// ============================================================================
// Mask Configuration
// ============================================================================

/// Type of mask effect for hiding sensitive content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum MaskType {
    /// Gaussian blur effect.
    #[default]
    Blur,
    /// Mosaic/pixelation effect.
    Pixelate,
    /// Solid color overlay.
    Solid,
}

/// A mask segment for hiding sensitive content.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct MaskSegment {
    /// Unique identifier.
    pub id: String,
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// X position (0-1, normalized from left).
    pub x: f32,
    /// Y position (0-1, normalized from top).
    pub y: f32,
    /// Width (0-1, normalized).
    pub width: f32,
    /// Height (0-1, normalized).
    pub height: f32,
    /// Type of mask effect.
    #[serde(default)]
    pub mask_type: MaskType,
    /// Blur/pixelate intensity (0-100).
    #[serde(default = "MaskSegment::default_intensity")]
    pub intensity: f32,
    /// Edge feather/softness (0-100).
    #[serde(default)]
    pub feather: f32,
    /// Color for Solid type (hex format).
    #[serde(default = "MaskSegment::default_color")]
    pub color: String,
}

impl MaskSegment {
    fn default_intensity() -> f32 {
        50.0
    }

    fn default_color() -> String {
        "#000000".to_string()
    }
}

/// Mask configuration for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct MaskConfig {
    /// Mask segments.
    pub segments: Vec<MaskSegment>,
}

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

// ============================================================================
// VideoProject Implementation
// ============================================================================

impl VideoProject {
    /// Create a new video project from a recording.
    pub fn new(
        screen_video_path: &str,
        width: u32,
        height: u32,
        duration_ms: u64,
        fps: u32,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        // Generate a simple unique ID using timestamp + random number
        let id = format!(
            "proj_{}_{:08x}",
            chrono::Utc::now().timestamp_millis(),
            rand::random::<u32>()
        );

        Self {
            id,
            created_at: now.clone(),
            updated_at: now,
            name: PathBuf::from(screen_video_path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string()),
            original_file_name: PathBuf::from(screen_video_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string()),
            quick_capture: false,
            sources: VideoSources {
                screen_video: screen_video_path.to_string(),
                webcam_video: None,
                cursor_data: None,
                audio_file: None,
                system_audio: None,
                microphone_audio: None,
                background_music: None,
                original_width: width,
                original_height: height,
                duration_ms,
                fps,
            },
            timeline: TimelineState {
                duration_ms,
                in_point: 0,
                out_point: duration_ms,
                speed: 1.0,
                segments: Vec::new(),
            },
            zoom: ZoomConfig::default(),
            cursor: CursorConfig::default(),
            webcam: WebcamConfig::default(),
            audio: AudioTrackSettings::default(),
            export: ExportConfig::default(),
            scene: SceneConfig::default(),
            text: TextConfig::default(),
            annotations: AnnotationConfig::default(),
            mask: MaskConfig::default(),
            captions: CaptionSettings::default(),
            caption_segments: Vec::new(),
        }
    }

    /// Add webcam video source.
    pub fn with_webcam(mut self, webcam_video_path: &str) -> Self {
        self.sources.webcam_video = Some(webcam_video_path.to_string());
        self
    }

    /// Add cursor data source.
    pub fn with_cursor_data(mut self, cursor_data_path: &str) -> Self {
        self.sources.cursor_data = Some(cursor_data_path.to_string());
        self
    }

    /// Add system audio source.
    pub fn with_system_audio(mut self, system_audio_path: &str) -> Self {
        self.sources.system_audio = Some(system_audio_path.to_string());
        self
    }

    /// Add microphone audio source.
    pub fn with_microphone_audio(mut self, microphone_audio_path: &str) -> Self {
        self.sources.microphone_audio = Some(microphone_audio_path.to_string());
        self
    }

    /// Add background music source.
    pub fn with_background_music(mut self, music_path: &str) -> Self {
        self.sources.background_music = Some(music_path.to_string());
        self
    }

    /// Save project to JSON file.
    pub fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize project: {}", e))?;

        std::fs::write(path, json).map_err(|e| format!("Failed to write project file: {}", e))?;

        Ok(())
    }

    /// Load project from JSON file.
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let json = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read project file: {}", e))?;

        let project: VideoProject =
            serde_json::from_str(&json).map_err(|e| format!("Failed to parse project: {}", e))?;

        Ok(project)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AnnotationConfig, AnnotationSegment, AnnotationShape, AnnotationShapeType,
        AudioTrackSettings, AutoZoomConfig, BackgroundConfig, ClickHighlightConfig,
        ClickHighlightStyle, CompositionConfig, CompositionMode, CornerStyle, CropConfig,
        CursorConfig, CursorType, EasingFunction, ExportConfig, ExportFormat, MaskConfig,
        MaskSegment, MaskType, SceneConfig, SceneMode, SceneSegment, ShadowConfig, TextAnimation,
        TextConfig, TextSegment, TimelineState, VideoProject, VideoSources, WebcamBorder,
        WebcamConfig, WebcamOverlayPosition, WebcamOverlayShape, ZoomConfig, ZoomMode, ZoomRegion,
        ZoomRegionMode, ZoomTransition, XY,
    };
    use ts_rs::TS;

    #[test]
    fn export_types() {
        VideoProject::export_all().unwrap();
        VideoSources::export_all().unwrap();
        TimelineState::export_all().unwrap();
        AudioTrackSettings::export_all().unwrap();
        ZoomConfig::export_all().unwrap();
        ZoomMode::export_all().unwrap();
        ZoomRegionMode::export_all().unwrap();
        ZoomRegion::export_all().unwrap();
        ZoomTransition::export_all().unwrap();
        EasingFunction::export_all().unwrap();
        AutoZoomConfig::export_all().unwrap();
        CursorType::export_all().unwrap();
        CursorConfig::export_all().unwrap();
        ClickHighlightConfig::export_all().unwrap();
        ClickHighlightStyle::export_all().unwrap();
        WebcamConfig::export_all().unwrap();
        WebcamOverlayPosition::export_all().unwrap();
        WebcamOverlayShape::export_all().unwrap();
        WebcamBorder::export_all().unwrap();
        CornerStyle::export_all().unwrap();
        ShadowConfig::export_all().unwrap();
        ExportConfig::export_all().unwrap();
        ExportFormat::export_all().unwrap();
        BackgroundConfig::export_all().unwrap();
        CropConfig::export_all().unwrap();
        CompositionMode::export_all().unwrap();
        CompositionConfig::export_all().unwrap();
        SceneMode::export_all().unwrap();
        SceneSegment::export_all().unwrap();
        SceneConfig::export_all().unwrap();
        AnnotationShapeType::export_all().unwrap();
        AnnotationShape::export_all().unwrap();
        AnnotationSegment::export_all().unwrap();
        AnnotationConfig::export_all().unwrap();
        MaskType::export_all().unwrap();
        MaskSegment::export_all().unwrap();
        MaskConfig::export_all().unwrap();
        XY::<f64>::export_all().unwrap();
        TextAnimation::export_all().unwrap();
        TextSegment::export_all().unwrap();
        TextConfig::export_all().unwrap();
    }

    #[test]
    fn text_animation_deserializes_legacy_aliases() {
        let fade_in: TextAnimation = serde_json::from_str("\"fadeIn\"").expect("parse fadeIn");
        let fade_out: TextAnimation = serde_json::from_str("\"fadeOut\"").expect("parse fadeOut");
        let fade_in_out: TextAnimation =
            serde_json::from_str("\"fadeInOut\"").expect("parse fadeInOut");
        let typewriter: TextAnimation =
            serde_json::from_str("\"typewriter\"").expect("parse typewriter");

        assert_eq!(fade_in, TextAnimation::None);
        assert_eq!(fade_out, TextAnimation::None);
        assert_eq!(fade_in_out, TextAnimation::None);
        assert_eq!(typewriter, TextAnimation::TypeWriter);
    }

    #[test]
    fn text_animation_uses_camel_case_serialization() {
        let none = serde_json::to_string(&TextAnimation::None).expect("serialize none");
        let typewriter =
            serde_json::to_string(&TextAnimation::TypeWriter).expect("serialize typeWriter");

        assert_eq!(none, "\"none\"");
        assert_eq!(typewriter, "\"typeWriter\"");
    }
}
