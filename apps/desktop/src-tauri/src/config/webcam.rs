//! Webcam configuration.
//!
//! Provides centralized, thread-safe access to webcam settings.
//! Re-exports types from the webcam module for convenience.

use lazy_static::lazy_static;
use parking_lot::RwLock;

// Re-export webcam types for convenience
pub use crate::commands::video_recording::webcam::{
    WebcamPosition, WebcamSettings, WebcamShape, WebcamSize,
};

use crate::error::SnapItResult;

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

    // Helper to reset config between tests
    fn reset_webcam_config() {
        *WEBCAM_CONFIG.write() = WebcamConfig::default();
    }

    // ========================================================================
    // Default values tests
    // ========================================================================

    #[test]
    fn test_default_webcam_config() {
        let config = WebcamConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.device_index, 0);
        assert!(matches!(config.position, WebcamPosition::BottomRight));
        assert!(matches!(config.size, WebcamSize::Small));
        assert!(matches!(config.shape, WebcamShape::Circle));
        assert!(!config.mirror);
    }

    // ========================================================================
    // WebcamSize tests
    // ========================================================================

    #[test]
    fn test_webcam_size_as_fraction() {
        assert!((WebcamSize::Small.as_fraction() - 0.15).abs() < 0.001);
        assert!((WebcamSize::Large.as_fraction() - 0.20).abs() < 0.001);
    }

    #[test]
    fn test_webcam_size_default() {
        assert!(matches!(WebcamSize::default(), WebcamSize::Small));
    }

    #[test]
    fn test_webcam_size_equality() {
        assert_eq!(WebcamSize::Small, WebcamSize::Small);
        assert_eq!(WebcamSize::Large, WebcamSize::Large);
        assert_ne!(WebcamSize::Small, WebcamSize::Large);
    }

    // ========================================================================
    // WebcamPosition tests
    // ========================================================================

    #[test]
    fn test_webcam_position_default() {
        assert!(matches!(
            WebcamPosition::default(),
            WebcamPosition::BottomRight
        ));
    }

    #[test]
    fn test_webcam_position_custom() {
        let pos = WebcamPosition::Custom { x: 100, y: 200 };
        if let WebcamPosition::Custom { x, y } = pos {
            assert_eq!(x, 100);
            assert_eq!(y, 200);
        } else {
            panic!("Expected Custom position");
        }
    }

    // ========================================================================
    // WebcamShape tests
    // ========================================================================

    #[test]
    fn test_webcam_shape_default() {
        assert!(matches!(WebcamShape::default(), WebcamShape::Circle));
    }

    #[test]
    fn test_webcam_shape_equality() {
        assert_eq!(WebcamShape::Circle, WebcamShape::Circle);
        assert_eq!(WebcamShape::Rectangle, WebcamShape::Rectangle);
        assert_ne!(WebcamShape::Circle, WebcamShape::Rectangle);
    }

    // ========================================================================
    // Global config tests
    // ========================================================================

    #[test]
    fn test_get_webcam_settings() {
        reset_webcam_config();

        let settings = get_webcam_settings().unwrap();
        assert!(!settings.enabled);
        assert_eq!(settings.device_index, 0);
    }

    #[test]
    fn test_is_webcam_enabled() {
        reset_webcam_config();

        assert!(!is_webcam_enabled().unwrap());

        WEBCAM_CONFIG.write().enabled = true;
        assert!(is_webcam_enabled().unwrap());

        reset_webcam_config();
    }

    #[test]
    fn test_get_webcam_size_pixels() {
        reset_webcam_config();

        // Small size = 15% of frame width
        let size_small = get_webcam_size_pixels(1920);
        assert_eq!(size_small, (1920.0 * 0.15) as u32);

        // Change to Large
        WEBCAM_CONFIG.write().size = WebcamSize::Large;
        let size_large = get_webcam_size_pixels(1920);
        assert_eq!(size_large, (1920.0 * 0.20) as u32);

        reset_webcam_config();
    }

    #[test]
    fn test_get_webcam_size_pixels_various_widths() {
        reset_webcam_config();

        // Test with different frame widths
        let widths = [640, 1280, 1920, 2560, 3840];
        for width in widths {
            let size = get_webcam_size_pixels(width);
            let expected = (width as f32 * 0.15) as u32;
            assert_eq!(size, expected, "Failed for width {}", width);
        }
    }

    // ========================================================================
    // Config modification tests
    // ========================================================================

    #[test]
    fn test_set_webcam_config() {
        reset_webcam_config();

        let new_config = WebcamConfig {
            enabled: true,
            device_index: 2,
            position: WebcamPosition::TopLeft,
            size: WebcamSize::Large,
            shape: WebcamShape::Rectangle,
            mirror: true,
        };

        set_webcam_config(new_config);

        let current = WEBCAM_CONFIG.read().clone();
        assert!(current.enabled);
        assert_eq!(current.device_index, 2);
        assert!(matches!(current.position, WebcamPosition::TopLeft));
        assert!(matches!(current.size, WebcamSize::Large));
        assert!(matches!(current.shape, WebcamShape::Rectangle));
        assert!(current.mirror);

        reset_webcam_config();
    }

    // ========================================================================
    // Serialization tests
    // ========================================================================

    #[test]
    fn test_webcam_settings_serialization_roundtrip() {
        let config = WebcamSettings {
            enabled: true,
            device_index: 1,
            position: WebcamPosition::Custom { x: 50, y: 100 },
            size: WebcamSize::Large,
            shape: WebcamShape::Rectangle,
            mirror: true,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: WebcamSettings = serde_json::from_str(&json).unwrap();

        assert!(deserialized.enabled);
        assert_eq!(deserialized.device_index, 1);
        assert!(matches!(deserialized.size, WebcamSize::Large));
        assert!(matches!(deserialized.shape, WebcamShape::Rectangle));
        assert!(deserialized.mirror);

        if let WebcamPosition::Custom { x, y } = deserialized.position {
            assert_eq!(x, 50);
            assert_eq!(y, 100);
        } else {
            panic!("Expected Custom position after deserialization");
        }
    }

    #[test]
    fn test_webcam_size_serialization() {
        let small = WebcamSize::Small;
        let large = WebcamSize::Large;

        let small_json = serde_json::to_string(&small).unwrap();
        let large_json = serde_json::to_string(&large).unwrap();

        assert_eq!(small_json, "\"small\"");
        assert_eq!(large_json, "\"large\"");

        let deserialized_small: WebcamSize = serde_json::from_str(&small_json).unwrap();
        let deserialized_large: WebcamSize = serde_json::from_str(&large_json).unwrap();

        assert_eq!(deserialized_small, WebcamSize::Small);
        assert_eq!(deserialized_large, WebcamSize::Large);
    }

    #[test]
    fn test_webcam_shape_serialization() {
        let circle = WebcamShape::Circle;
        let rect = WebcamShape::Rectangle;

        let circle_json = serde_json::to_string(&circle).unwrap();
        let rect_json = serde_json::to_string(&rect).unwrap();

        assert_eq!(circle_json, "\"circle\"");
        assert_eq!(rect_json, "\"rectangle\"");
    }

    #[test]
    fn test_webcam_position_serialization() {
        // Test fixed positions
        let positions = vec![
            WebcamPosition::TopLeft,
            WebcamPosition::TopRight,
            WebcamPosition::BottomLeft,
            WebcamPosition::BottomRight,
        ];

        for pos in positions {
            let json = serde_json::to_string(&pos).unwrap();
            let deserialized: WebcamPosition = serde_json::from_str(&json).unwrap();
            // Can't directly compare enums, but should not panic
            let _ = format!("{:?}", deserialized);
        }

        // Test custom position
        let custom = WebcamPosition::Custom { x: 123, y: 456 };
        let json = serde_json::to_string(&custom).unwrap();
        assert!(json.contains("123"));
        assert!(json.contains("456"));
    }

    // ========================================================================
    // Thread safety tests
    // ========================================================================

    #[test]
    fn test_concurrent_reads() {
        reset_webcam_config();

        let config1 = WEBCAM_CONFIG.read().clone();
        let config2 = WEBCAM_CONFIG.read().clone();

        assert_eq!(config1.device_index, config2.device_index);
        assert_eq!(config1.enabled, config2.enabled);
    }
}
