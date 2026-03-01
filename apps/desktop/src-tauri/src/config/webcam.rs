//! Webcam configuration.
//!
//! Provides centralized, thread-safe access to webcam settings.
//! Re-exports types from the webcam module for convenience.

use lazy_static::lazy_static;
use parking_lot::RwLock;
use snapit_core::error::SnapItResult;
use snapit_domain::webcam::{WebcamPosition, WebcamSettings, WebcamShape, WebcamSize};

/// Type alias for webcam config (same as WebcamSettings).
pub type WebcamConfig = WebcamSettings;

lazy_static! {
    /// Global webcam configuration.
    ///
    /// Thread-safe access via `parking_lot::RwLock` (non-poisoning, fast).
    pub static ref WEBCAM_CONFIG: RwLock<WebcamConfig> = RwLock::new(WebcamConfig::default());
}

// ============================================================================
// Convenience Functions
// ============================================================================

/// Get the current webcam settings.
/// Returns Result for backward compatibility with existing code.
pub fn get_webcam_settings() -> SnapItResult<WebcamConfig> {
    Ok(WEBCAM_CONFIG.read().clone())
}

/// Check if webcam capture is enabled.
/// Returns Result for backward compatibility with existing code.
pub fn is_webcam_enabled() -> SnapItResult<bool> {
    Ok(WEBCAM_CONFIG.read().enabled)
}

/// Get webcam size in pixels based on frame dimensions.
pub fn get_webcam_size_pixels(frame_width: u32) -> u32 {
    let size = WEBCAM_CONFIG.read().size;
    (frame_width as f32 * size.as_fraction()) as u32
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get the current webcam settings.
#[tauri::command]
pub fn get_webcam_settings_cmd() -> SnapItResult<WebcamConfig> {
    let settings = WEBCAM_CONFIG.read().clone();
    log::debug!(
        "[CONFIG] get_webcam_settings_cmd returning enabled={}",
        settings.enabled
    );
    Ok(settings)
}

/// Update webcam configuration (batch update).
#[tauri::command]
pub fn set_webcam_config(config: WebcamConfig) {
    log::debug!("[CONFIG] Webcam config updated: {:?}", config);
    *WEBCAM_CONFIG.write() = config;
}

/// Set webcam enabled state.
#[tauri::command]
pub fn set_webcam_enabled(enabled: bool) -> SnapItResult<()> {
    log::debug!("[CONFIG] set_webcam_enabled({})", enabled);
    WEBCAM_CONFIG.write().enabled = enabled;
    Ok(())
}

/// Set webcam device index.
#[tauri::command]
pub fn set_webcam_device(device_index: usize) -> SnapItResult<()> {
    log::debug!("[CONFIG] set_webcam_device({})", device_index);
    WEBCAM_CONFIG.write().device_index = device_index;
    Ok(())
}

/// Set webcam position.
#[tauri::command]
pub fn set_webcam_position(position: WebcamPosition) -> SnapItResult<()> {
    log::debug!("[CONFIG] set_webcam_position({:?})", position);
    WEBCAM_CONFIG.write().position = position;
    Ok(())
}

/// Set webcam size.
#[tauri::command]
pub fn set_webcam_size(size: WebcamSize) -> SnapItResult<()> {
    log::debug!("[CONFIG] set_webcam_size({:?})", size);
    WEBCAM_CONFIG.write().size = size;
    Ok(())
}

/// Set webcam shape.
#[tauri::command]
pub fn set_webcam_shape(shape: WebcamShape) -> SnapItResult<()> {
    log::debug!("[CONFIG] set_webcam_shape({:?})", shape);
    WEBCAM_CONFIG.write().shape = shape;
    Ok(())
}

/// Set webcam mirror mode.
#[tauri::command]
pub fn set_webcam_mirror(mirror: bool) -> SnapItResult<()> {
    log::debug!("[CONFIG] set_webcam_mirror({})", mirror);
    WEBCAM_CONFIG.write().mirror = mirror;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn reset_webcam_config() {
        *WEBCAM_CONFIG.write() = WebcamConfig::default();
    }

    // ========================================================================
    // WebcamSize - actual rendering calculations
    // ========================================================================

    #[test]
    fn test_webcam_size_fractions() {
        // These fractions directly affect webcam overlay size in the video
        assert!((WebcamSize::Small.as_fraction() - 0.15).abs() < 0.001);
        assert!((WebcamSize::Large.as_fraction() - 0.20).abs() < 0.001);
    }

    #[test]
    fn test_get_webcam_size_pixels_calculation() {
        reset_webcam_config();

        // Verify the pixel calculation is correct for common resolutions
        let test_cases = [
            (1920, WebcamSize::Small, (1920.0 * 0.15) as u32),
            (1920, WebcamSize::Large, (1920.0 * 0.20) as u32),
            (3840, WebcamSize::Small, (3840.0 * 0.15) as u32), // 4K
            (1280, WebcamSize::Small, (1280.0 * 0.15) as u32), // 720p
        ];

        for (width, size, expected) in test_cases {
            WEBCAM_CONFIG.write().size = size;
            let actual = get_webcam_size_pixels(width);
            assert_eq!(
                actual, expected,
                "Failed for {}px width with {:?}",
                width, size
            );
        }

        reset_webcam_config();
    }

    // ========================================================================
    // Serialization - frontend/backend communication
    // ========================================================================

    #[test]
    fn test_custom_position_roundtrip() {
        // Custom position uses tagged enum - tricky to serialize correctly
        let config = WebcamSettings {
            enabled: true,
            device_index: 1,
            position: WebcamPosition::Custom { x: 50, y: 100 },
            size: WebcamSize::Large,
            shape: WebcamShape::Squircle,
            mirror: true,
        };

        let json = serde_json::to_string(&config).unwrap();
        let roundtrip: WebcamSettings = serde_json::from_str(&json).unwrap();

        if let WebcamPosition::Custom { x, y } = roundtrip.position {
            assert_eq!((x, y), (50, 100));
        } else {
            panic!("Custom position lost in serialization");
        }
    }

    #[test]
    fn test_enum_serialization_format() {
        // Frontend expects lowercase strings
        assert_eq!(
            serde_json::to_string(&WebcamSize::Small).unwrap(),
            "\"small\""
        );
        assert_eq!(
            serde_json::to_string(&WebcamSize::Large).unwrap(),
            "\"large\""
        );
        assert_eq!(
            serde_json::to_string(&WebcamShape::Circle).unwrap(),
            "\"circle\""
        );
        assert_eq!(
            serde_json::to_string(&WebcamShape::Squircle).unwrap(),
            "\"squircle\""
        );

        // Backward compatibility: legacy stored value should still deserialize.
        let legacy_shape: WebcamShape = serde_json::from_str("\"rectangle\"").unwrap();
        assert_eq!(legacy_shape, WebcamShape::Squircle);
    }

    #[test]
    fn test_all_positions_serialize_deserialize() {
        let positions = [
            WebcamPosition::TopLeft,
            WebcamPosition::TopRight,
            WebcamPosition::BottomLeft,
            WebcamPosition::BottomRight,
            WebcamPosition::Custom { x: -100, y: 500 }, // Edge case: negative x
        ];

        for pos in positions {
            let json = serde_json::to_string(&pos).unwrap();
            let roundtrip: WebcamPosition = serde_json::from_str(&json).unwrap();
            // Verify by re-serializing
            assert_eq!(json, serde_json::to_string(&roundtrip).unwrap());
        }
    }

    // ========================================================================
    // Global config state
    // ========================================================================

    #[test]
    fn test_set_webcam_config_persists_all_fields() {
        reset_webcam_config();

        let new_config = WebcamConfig {
            enabled: true,
            device_index: 2,
            position: WebcamPosition::TopLeft,
            size: WebcamSize::Large,
            shape: WebcamShape::Squircle,
            mirror: true,
        };

        set_webcam_config(new_config.clone());
        let read = WEBCAM_CONFIG.read().clone();

        assert_eq!(read.enabled, new_config.enabled);
        assert_eq!(read.device_index, new_config.device_index);
        assert_eq!(read.mirror, new_config.mirror);

        reset_webcam_config();
    }

    // ========================================================================
    // Property-based tests
    // ========================================================================

    proptest! {
        #[test]
        fn prop_size_pixels_scales_linearly(width in 100u32..8000) {
            reset_webcam_config();
            let pixels = get_webcam_size_pixels(width);
            let expected = (width as f32 * WebcamSize::Small.as_fraction()) as u32;
            prop_assert_eq!(pixels, expected);
        }

        #[test]
        fn prop_custom_position_roundtrip(x in -1000i32..5000, y in -1000i32..5000) {
            let pos = WebcamPosition::Custom { x, y };
            let json = serde_json::to_string(&pos).unwrap();
            let roundtrip: WebcamPosition = serde_json::from_str(&json).unwrap();

            match roundtrip {
                WebcamPosition::Custom { x: rx, y: ry } => {
                    prop_assert_eq!(rx, x);
                    prop_assert_eq!(ry, y);
                }
                _ => unreachable!("Position type changed during roundtrip"),
            }
        }

        #[test]
        fn prop_settings_roundtrip(
            enabled in any::<bool>(),
            device_index in 0usize..10,
            mirror in any::<bool>()
        ) {
            let config = WebcamSettings {
                enabled,
                device_index,
                position: WebcamPosition::BottomRight,
                size: WebcamSize::Small,
                shape: WebcamShape::Circle,
                mirror,
            };

            let json = serde_json::to_string(&config).unwrap();
            let roundtrip: WebcamSettings = serde_json::from_str(&json).unwrap();

            prop_assert_eq!(roundtrip.enabled, config.enabled);
            prop_assert_eq!(roundtrip.device_index, config.device_index);
            prop_assert_eq!(roundtrip.mirror, config.mirror);
        }
    }
}
