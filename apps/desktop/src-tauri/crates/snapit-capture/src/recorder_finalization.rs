//! Shared planning helpers for post-recording finalization behavior.

use std::path::Path;

/// Finalization behavior switches based on capture flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FinalizationPlan {
    pub save_cursor_data: bool,
    pub mux_audio: bool,
    pub create_project_file: bool,
}

/// Artifact flags used when creating editor project metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectArtifactFlags {
    pub has_webcam: bool,
    pub has_cursor: bool,
    pub has_system_audio: bool,
    pub has_microphone_audio: bool,
}

/// Build finalization plan from flow mode.
pub fn build_finalization_plan(quick_capture: bool) -> FinalizationPlan {
    if quick_capture {
        FinalizationPlan {
            save_cursor_data: false,
            mux_audio: true,
            create_project_file: false,
        }
    } else {
        FinalizationPlan {
            save_cursor_data: true,
            mux_audio: false,
            create_project_file: true,
        }
    }
}

/// Decide whether cursor recording should be persisted.
pub fn should_persist_cursor_data(
    plan: FinalizationPlan,
    has_cursor_data_path: bool,
    cursor_event_count: usize,
) -> bool {
    plan.save_cursor_data && has_cursor_data_path && cursor_event_count > 0
}

/// Compute project artifact flags from runtime outcomes.
pub fn build_project_artifact_flags(
    has_webcam_output: bool,
    has_cursor_data_path: bool,
    cursor_event_count: usize,
    system_audio_path: Option<&Path>,
    microphone_audio_path: Option<&Path>,
) -> ProjectArtifactFlags {
    ProjectArtifactFlags {
        has_webcam: has_webcam_output,
        has_cursor: has_cursor_data_path && cursor_event_count > 0,
        has_system_audio: system_audio_path.map(|p| p.exists()).unwrap_or(false),
        has_microphone_audio: microphone_audio_path.map(|p| p.exists()).unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_finalization_plan, build_project_artifact_flags, should_persist_cursor_data,
    };
    use std::path::Path;

    #[test]
    fn quick_capture_plan() {
        let plan = build_finalization_plan(true);
        assert!(!plan.save_cursor_data);
        assert!(plan.mux_audio);
        assert!(!plan.create_project_file);
    }

    #[test]
    fn editor_capture_plan() {
        let plan = build_finalization_plan(false);
        assert!(plan.save_cursor_data);
        assert!(!plan.mux_audio);
        assert!(plan.create_project_file);
    }

    #[test]
    fn cursor_persist_requires_path_and_events() {
        let plan = build_finalization_plan(false);
        assert!(should_persist_cursor_data(plan, true, 3));
        assert!(!should_persist_cursor_data(plan, false, 3));
        assert!(!should_persist_cursor_data(plan, true, 0));
    }

    #[test]
    fn quick_capture_never_persists_cursor() {
        let plan = build_finalization_plan(true);
        assert!(!should_persist_cursor_data(plan, true, 5));
    }

    #[test]
    fn artifact_flags_reflect_inputs() {
        let flags = build_project_artifact_flags(
            true,
            true,
            2,
            Some(Path::new("C:/definitely/not/exists/system.wav")),
            Some(Path::new("C:/definitely/not/exists/mic.wav")),
        );

        assert!(flags.has_webcam);
        assert!(flags.has_cursor);
        assert!(!flags.has_system_audio);
        assert!(!flags.has_microphone_audio);
    }
}
