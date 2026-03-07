//! Video project types and operations for the video editor.
//!
//! A VideoProject represents all the data needed to edit and export a video recording:
//! - Source files (screen video, webcam video, cursor data)
//! - Timeline state (trim points, playback speed)
//! - Zoom configuration (auto/manual zoom regions)
//! - Cursor configuration (size, highlighting, motion blur)
//! - Webcam configuration (position, size, visibility segments)
//! - Export settings
//!
//! ## Architecture
//!
//! ```text
//! video_project/
//!   mod.rs       - Re-exports and tests
//!   moonsnap-domain::video_project - shared type definitions (VideoProject, configs, etc.)
//!   metadata.rs  - Video metadata extraction and project loading
//!   frames.rs    - Video frame extraction and caching
//!   auto_zoom.rs - Auto-zoom generation from cursor data
//! ```

pub mod auto_zoom;
pub mod frames;
pub mod metadata;

// Re-export all types for convenience
pub use auto_zoom::apply_auto_zoom_to_project;
pub use frames::{clear_frame_cache, get_video_frame_cached};
pub use metadata::{load_video_project_from_file, VideoMetadata};

#[cfg(test)]
mod tests {
    use moonsnap_domain::video_project::{
        AutoZoomConfig, CursorConfig, VideoProject, ZoomRegion, ZoomRegionMode, ZoomTransition,
    };

    #[test]
    fn test_video_project_serialization() {
        let project = VideoProject::new("test.mp4", 1920, 1080, 60000, 30);

        let json = serde_json::to_string(&project).unwrap();
        let deserialized: VideoProject = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.sources.original_width, 1920);
        assert_eq!(deserialized.timeline.duration_ms, 60000);
    }

    #[test]
    fn test_zoom_region_serialization() {
        let region = ZoomRegion {
            id: "test-id".to_string(),
            start_ms: 1000,
            end_ms: 3000,
            scale: 2.0,
            target_x: 0.5,
            target_y: 0.5,
            mode: ZoomRegionMode::Manual,
            is_auto: true,
            transition: ZoomTransition::default(),
        };

        let json = serde_json::to_string(&region).unwrap();
        assert!(json.contains("startMs"));
        assert!(json.contains("targetX"));
    }

    #[test]
    fn test_auto_zoom_config_serialization() {
        let config = AutoZoomConfig::default();

        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("scale"));
        assert!(json.contains("holdDurationMs"));
        assert!(json.contains("minGapMs"));

        let deserialized: AutoZoomConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.scale, 2.0);
        assert_eq!(deserialized.hold_duration_ms, 1500);
    }

    #[test]
    fn test_cursor_config_deserializes_with_legacy_smooth_fields() {
        let legacy_cursor_json = serde_json::json!({
            "visible": true,
            "cursorType": "auto",
            "scale": 1.0,
            "smoothMovement": true,
            "animationStyle": "mellow",
            "tension": 120.0,
            "mass": 1.1,
            "friction": 18.0,
            "motionBlur": 0.05,
            "clickHighlight": {
                "enabled": true,
                "color": "#FF6B6B",
                "radius": 30,
                "durationMs": 400,
                "style": "ripple"
            }
        });

        let deserialized: CursorConfig = serde_json::from_value(legacy_cursor_json).unwrap();
        assert!(deserialized.visible);
        assert_eq!(deserialized.scale, 1.0);
        assert_eq!(deserialized.dampening, 0.5);
        assert_eq!(deserialized.motion_blur, 0.05);
    }
}
