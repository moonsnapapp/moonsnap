//! Stream decode planning helpers for export.

use std::path::Path;

use snapit_domain::video_project::VideoProject;

use crate::timeline_plan::ExportTimelinePlan;

/// Planned decode inputs and frame window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamDecodePlan {
    pub decode_start_ms: u64,
    pub decode_end_ms: u64,
    pub total_decode_frames: u32,
    pub use_nv12_decode: bool,
    pub screen_video_path: String,
    pub webcam_video_path: Option<String>,
}

/// Build stream decode plan from project + timeline plan.
pub fn plan_stream_decode(
    project: &VideoProject,
    timeline: &ExportTimelinePlan,
    use_nv12_decode: bool,
) -> StreamDecodePlan {
    let webcam_video_path = if project.webcam.enabled {
        project
            .sources
            .webcam_video
            .as_ref()
            .filter(|p| Path::new(p).exists())
            .cloned()
    } else {
        None
    };

    StreamDecodePlan {
        decode_start_ms: timeline.decode_start_ms,
        decode_end_ms: timeline.decode_end_ms,
        total_decode_frames: timeline.total_decode_frames,
        use_nv12_decode,
        screen_video_path: project.sources.screen_video.clone(),
        webcam_video_path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapit_domain::video_project::{VideoProject, WebcamConfig};

    fn timeline_plan() -> ExportTimelinePlan {
        ExportTimelinePlan {
            effective_duration_ms: 1_000,
            duration_secs: 1.0,
            total_output_frames: 30,
            decode_start_ms: 100,
            decode_end_ms: 900,
            has_segments: false,
            total_decode_frames: 24,
        }
    }

    fn project_with_webcam(path: Option<String>, enabled: bool) -> VideoProject {
        let mut project = VideoProject::new("screen.mp4", 1920, 1080, 1_000, 30);
        project.sources.webcam_video = path;
        project.webcam = WebcamConfig {
            enabled,
            ..WebcamConfig::default()
        };
        project
    }

    #[test]
    fn plans_decode_without_webcam_when_disabled() {
        let plan = plan_stream_decode(
            &project_with_webcam(Some("foo.mp4".to_string()), false),
            &timeline_plan(),
            true,
        );
        assert_eq!(plan.decode_start_ms, 100);
        assert_eq!(plan.decode_end_ms, 900);
        assert_eq!(plan.total_decode_frames, 24);
        assert!(plan.use_nv12_decode);
        assert!(plan.webcam_video_path.is_none());
    }

    #[test]
    fn plans_decode_with_existing_webcam_path() {
        let tmp_path = std::env::temp_dir().join(format!(
            "snapit_export_decode_plan_webcam_{}.mp4",
            std::process::id()
        ));
        std::fs::write(&tmp_path, b"test").expect("create temp file");

        let plan = plan_stream_decode(
            &project_with_webcam(Some(tmp_path.to_string_lossy().to_string()), true),
            &timeline_plan(),
            false,
        );

        assert_eq!(
            plan.webcam_video_path.as_deref(),
            Some(tmp_path.to_string_lossy().as_ref())
        );
        assert!(!plan.use_nv12_decode);

        let _ = std::fs::remove_file(tmp_path);
    }

    #[test]
    fn plans_decode_without_missing_webcam_path() {
        let plan = plan_stream_decode(
            &project_with_webcam(
                Some("__does_not_exist__/missing_webcam.mp4".to_string()),
                true,
            ),
            &timeline_plan(),
            true,
        );
        assert!(plan.webcam_video_path.is_none());
    }
}
