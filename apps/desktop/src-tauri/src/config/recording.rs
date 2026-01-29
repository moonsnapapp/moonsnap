//! Recording configuration.
//!
//! Consolidates all recording settings into a single typed struct with
//! thread-safe access via RwLock. Replaces 10+ scattered atomic variables.

use lazy_static::lazy_static;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use crate::commands::video_recording::GifQualityPreset;

/// Centralized recording configuration.
///
/// All recording settings in one place, updated atomically via RwLock.
/// Frontend can batch-update all settings in a single IPC call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingConfig {
    /// Countdown duration before recording starts (0-10 seconds).
    pub countdown_secs: u32,

    /// Whether to capture system audio (what's playing on the computer).
    pub system_audio_enabled: bool,

    /// Frames per second (10-60).
    pub fps: u32,

    /// Quality setting (1-100). Affects video bitrate.
    pub quality: u32,

    /// GIF encoding preset (Fast/Balanced/High).
    pub gif_quality_preset: GifQualityPreset,

    /// Whether to include the cursor in the recording.
    /// When false (editor flow), cursor is captured separately for flexibility.
    pub include_cursor: bool,

    /// Maximum recording duration in seconds. None = unlimited.
    pub max_duration_secs: Option<u32>,

    /// Selected microphone device index. None = no microphone.
    pub microphone_device_index: Option<usize>,

    /// Quick capture mode - saves directly to file, skips video editor.
    pub quick_capture: bool,

    /// Whether to hide desktop icons during recording.
    pub hide_desktop_icons: bool,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self {
            countdown_secs: 3,
            system_audio_enabled: true,
            fps: 30,
            quality: 80,
            gif_quality_preset: GifQualityPreset::default(),
            include_cursor: false, // Cursor captured separately for editor flexibility
            max_duration_secs: None,
            microphone_device_index: None,
            quick_capture: false,
            hide_desktop_icons: false,
        }
    }
}

impl RecordingConfig {
    /// Validate and clamp settings to acceptable ranges.
    pub fn validate(&mut self) {
        self.countdown_secs = self.countdown_secs.clamp(0, 10);
        self.fps = self.fps.clamp(10, 60);
        self.quality = self.quality.clamp(1, 100);
    }

    /// Reset all settings to defaults.
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

lazy_static! {
    /// Global recording configuration.
    ///
    /// Thread-safe access via `parking_lot::RwLock` (non-poisoning, fast).
    ///
    /// # Example
    /// ```ignore
    /// // Read current config
    /// let config = RECORDING_CONFIG.read().clone();
    ///
    /// // Update config atomically
    /// {
    ///     let mut config = RECORDING_CONFIG.write();
    ///     config.fps = 60;
    ///     config.quality = 90;
    /// }
    /// ```
    pub static ref RECORDING_CONFIG: RwLock<RecordingConfig> = RwLock::new(RecordingConfig::default());
}

// ============================================================================
// Convenience Getters (for backward compatibility with existing code)
// ============================================================================

/// Get the current countdown setting.
pub fn get_countdown_secs() -> u32 {
    RECORDING_CONFIG.read().countdown_secs
}

/// Get the current system audio setting.
pub fn get_system_audio_enabled() -> bool {
    RECORDING_CONFIG.read().system_audio_enabled
}

/// Get the current FPS setting.
pub fn get_fps() -> u32 {
    RECORDING_CONFIG.read().fps
}

/// Get the current quality setting.
pub fn get_quality() -> u32 {
    RECORDING_CONFIG.read().quality
}

/// Get the current GIF quality preset.
pub fn get_gif_quality_preset() -> GifQualityPreset {
    RECORDING_CONFIG.read().gif_quality_preset
}

/// Get the current include_cursor setting.
pub fn get_include_cursor() -> bool {
    RECORDING_CONFIG.read().include_cursor
}

/// Get the current max duration setting (None = unlimited).
pub fn get_max_duration_secs() -> Option<u32> {
    RECORDING_CONFIG.read().max_duration_secs
}

/// Get the current microphone device index (None = no microphone).
pub fn get_microphone_device_index() -> Option<usize> {
    RECORDING_CONFIG.read().microphone_device_index
}

/// Get the current quick capture setting.
pub fn get_quick_capture() -> bool {
    RECORDING_CONFIG.read().quick_capture
}

/// Get whether to hide desktop icons.
pub fn get_hide_desktop_icons() -> bool {
    RECORDING_CONFIG.read().hide_desktop_icons
}

/// Reset all recording settings to defaults.
pub fn reset_recording_config() {
    let mut config = RECORDING_CONFIG.write();
    config.reset();
    log::debug!("[CONFIG] Recording settings reset to defaults");
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Update recording configuration (batch update).
///
/// This allows the frontend to update all settings in a single IPC call.
#[tauri::command]
pub fn set_recording_config(config: RecordingConfig) {
    let mut current = RECORDING_CONFIG.write();
    *current = config;
    current.validate();
    log::debug!("[CONFIG] Recording config updated: {:?}", *current);
}

/// Get the current recording configuration.
#[tauri::command]
pub fn get_recording_config() -> RecordingConfig {
    RECORDING_CONFIG.read().clone()
}

/// Reset recording configuration to defaults.
#[tauri::command]
pub fn reset_recording_config_cmd() {
    reset_recording_config();
}

// ============================================================================
// Individual Setters (backward compatibility - prefer batch update)
// ============================================================================

/// Set the countdown preference.
#[tauri::command]
pub fn set_recording_countdown(secs: u32) {
    RECORDING_CONFIG.write().countdown_secs = secs.clamp(0, 10);
}

/// Set the system audio preference.
#[tauri::command]
pub fn set_recording_system_audio(enabled: bool) {
    RECORDING_CONFIG.write().system_audio_enabled = enabled;
}

/// Set the FPS.
#[tauri::command]
pub fn set_recording_fps(fps: u32) {
    RECORDING_CONFIG.write().fps = fps.clamp(10, 60);
}

/// Set the quality.
#[tauri::command]
pub fn set_recording_quality(quality: u32) {
    RECORDING_CONFIG.write().quality = quality.clamp(1, 100);
}

/// Set the GIF quality preset.
#[tauri::command]
pub fn set_gif_quality_preset(preset: GifQualityPreset) {
    RECORDING_CONFIG.write().gif_quality_preset = preset;
}

/// Set whether to include cursor.
#[tauri::command]
pub fn set_recording_include_cursor(include: bool) {
    log::debug!("[CONFIG] set_recording_include_cursor({})", include);
    RECORDING_CONFIG.write().include_cursor = include;
}

/// Set whether to use quick capture mode.
#[tauri::command]
pub fn set_recording_quick_capture(quick: bool) {
    log::debug!("[CONFIG] set_recording_quick_capture({})", quick);
    RECORDING_CONFIG.write().quick_capture = quick;
}

/// Set the max duration.
#[tauri::command]
pub fn set_recording_max_duration(secs: u32) {
    RECORDING_CONFIG.write().max_duration_secs = if secs == 0 { None } else { Some(secs) };
}

/// Set the microphone device index.
#[tauri::command]
pub fn set_recording_microphone_device(index: Option<u32>) {
    let device_index = index.map(|i| i as usize);
    log::debug!(
        "[CONFIG] set_recording_microphone_device({:?})",
        device_index
    );
    RECORDING_CONFIG.write().microphone_device_index = device_index;
}

/// Set whether to hide desktop icons during recording.
#[tauri::command]
pub fn set_hide_desktop_icons(enabled: bool) {
    log::debug!("[CONFIG] set_hide_desktop_icons({})", enabled);
    RECORDING_CONFIG.write().hide_desktop_icons = enabled;
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ========================================================================
    // Validation tests - prevent invalid recording settings
    // ========================================================================

    #[test]
    fn test_validation_clamps_out_of_range() {
        let mut config = RecordingConfig {
            fps: 100,           // Over max 60
            quality: 0,         // Under min 1
            countdown_secs: 20, // Over max 10
            ..Default::default()
        };
        config.validate();

        assert_eq!(config.fps, 60);
        assert_eq!(config.quality, 1);
        assert_eq!(config.countdown_secs, 10);
    }

    #[test]
    fn test_validation_boundary_values() {
        // Min boundaries
        let mut min_config = RecordingConfig {
            countdown_secs: 0,
            fps: 10,
            quality: 1,
            ..Default::default()
        };
        min_config.validate();
        assert_eq!(
            (
                min_config.countdown_secs,
                min_config.fps,
                min_config.quality
            ),
            (0, 10, 1)
        );

        // Max boundaries
        let mut max_config = RecordingConfig {
            countdown_secs: 10,
            fps: 60,
            quality: 100,
            ..Default::default()
        };
        max_config.validate();
        assert_eq!(
            (
                max_config.countdown_secs,
                max_config.fps,
                max_config.quality
            ),
            (10, 60, 100)
        );
    }

    #[test]
    fn test_reset_clears_all_fields() {
        let mut config = RecordingConfig {
            countdown_secs: 10,
            fps: 60,
            quality: 100,
            system_audio_enabled: false,
            include_cursor: true,
            quick_capture: true,
            max_duration_secs: Some(300),
            microphone_device_index: Some(1),
            hide_desktop_icons: true,
            ..Default::default()
        };

        config.reset();

        // Verify ALL fields reset, not just some
        let default = RecordingConfig::default();
        assert_eq!(config.countdown_secs, default.countdown_secs);
        assert_eq!(config.fps, default.fps);
        assert_eq!(config.quality, default.quality);
        assert_eq!(config.system_audio_enabled, default.system_audio_enabled);
        assert_eq!(config.include_cursor, default.include_cursor);
        assert_eq!(config.quick_capture, default.quick_capture);
        assert_eq!(config.max_duration_secs, default.max_duration_secs);
        assert_eq!(
            config.microphone_device_index,
            default.microphone_device_index
        );
        assert_eq!(config.hide_desktop_icons, default.hide_desktop_icons);
    }

    // ========================================================================
    // Serialization tests - frontend/backend communication
    // ========================================================================

    #[test]
    fn test_json_uses_camel_case_for_frontend() {
        // Critical: TypeScript frontend expects camelCase
        let json = serde_json::to_string(&RecordingConfig::default()).unwrap();

        assert!(
            json.contains("countdownSecs"),
            "Frontend expects countdownSecs"
        );
        assert!(
            json.contains("systemAudioEnabled"),
            "Frontend expects systemAudioEnabled"
        );
        assert!(
            json.contains("maxDurationSecs"),
            "Frontend expects maxDurationSecs"
        );
        assert!(
            !json.contains("countdown_secs"),
            "snake_case would break frontend"
        );
    }

    #[test]
    fn test_serialization_roundtrip_all_fields() {
        let config = RecordingConfig {
            countdown_secs: 5,
            fps: 60,
            quality: 90,
            system_audio_enabled: false,
            include_cursor: true,
            quick_capture: true,
            max_duration_secs: Some(120),
            microphone_device_index: Some(2),
            hide_desktop_icons: true,
            ..Default::default()
        };

        let json = serde_json::to_string(&config).unwrap();
        let roundtrip: RecordingConfig = serde_json::from_str(&json).unwrap();

        // Every field must survive roundtrip
        assert_eq!(roundtrip.countdown_secs, config.countdown_secs);
        assert_eq!(roundtrip.fps, config.fps);
        assert_eq!(roundtrip.quality, config.quality);
        assert_eq!(roundtrip.system_audio_enabled, config.system_audio_enabled);
        assert_eq!(roundtrip.include_cursor, config.include_cursor);
        assert_eq!(roundtrip.quick_capture, config.quick_capture);
        assert_eq!(roundtrip.max_duration_secs, config.max_duration_secs);
        assert_eq!(
            roundtrip.microphone_device_index,
            config.microphone_device_index
        );
        assert_eq!(roundtrip.hide_desktop_icons, config.hide_desktop_icons);
    }

    // ========================================================================
    // Global config tests
    // ========================================================================

    #[test]
    fn test_global_config_write_persists() {
        reset_recording_config();

        {
            let mut config = RECORDING_CONFIG.write();
            config.countdown_secs = 7;
            config.fps = 45;
        }

        assert_eq!(get_countdown_secs(), 7);
        assert_eq!(get_fps(), 45);

        reset_recording_config();
    }

    // ========================================================================
    // Property-based tests
    // ========================================================================

    proptest! {
        #[test]
        fn prop_validation_always_produces_valid_config(
            countdown in 0u32..100,
            fps in 0u32..200,
            quality in 0u32..200
        ) {
            let mut config = RecordingConfig {
                countdown_secs: countdown,
                fps,
                quality,
                ..Default::default()
            };
            config.validate();

            // After validation, all values must be in valid ranges
            prop_assert!(config.countdown_secs <= 10);
            prop_assert!(config.fps >= 10 && config.fps <= 60);
            prop_assert!(config.quality >= 1 && config.quality <= 100);
        }

        #[test]
        fn prop_serialization_roundtrip(
            countdown in 0u32..10,
            fps in 10u32..60,
            quality in 1u32..100,
            system_audio in any::<bool>(),
            include_cursor in any::<bool>()
        ) {
            let config = RecordingConfig {
                countdown_secs: countdown,
                fps,
                quality,
                system_audio_enabled: system_audio,
                include_cursor,
                ..Default::default()
            };

            let json = serde_json::to_string(&config).unwrap();
            let roundtrip: RecordingConfig = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(roundtrip.countdown_secs, config.countdown_secs);
            prop_assert_eq!(roundtrip.fps, config.fps);
            prop_assert_eq!(roundtrip.quality, config.quality);
        }
    }
}
