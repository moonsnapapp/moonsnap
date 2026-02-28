//! Shared finalization orchestration for MP4 capture flows.

use std::path::Path;

use crate::recorder_cursor_persistence::maybe_persist_cursor_data;
use crate::recorder_finalization::{
    build_project_artifact_flags, FinalizationPlan, ProjectArtifactFlags,
};
use crate::recorder_video_postprocess::postprocess_screen_video;

/// Finalization result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoFinalizeOutcome {
    Cancelled,
    Finalized { video_file_size: u64 },
}

/// Finalize MP4 recording artifacts using callback-driven app/runtime adapters.
pub fn finalize_video_capture<FPersistCursor, FFinishEncoder, FMux, FFaststart, FProject>(
    finalization_plan: FinalizationPlan,
    was_cancelled: bool,
    has_cursor_data_path: bool,
    cursor_event_count: usize,
    has_webcam_output: bool,
    screen_video_path: &Path,
    system_audio_path: Option<&Path>,
    microphone_audio_path: Option<&Path>,
    mut persist_cursor_data: FPersistCursor,
    finish_encoder: FFinishEncoder,
    mut mux_audio_to_video: FMux,
    mut make_video_faststart: FFaststart,
    mut create_project_file: FProject,
) -> Result<VideoFinalizeOutcome, String>
where
    FPersistCursor: FnMut() -> Result<(), String>,
    FFinishEncoder: FnOnce() -> Result<(), String>,
    FMux: FnMut(&Path, Option<&Path>, Option<&Path>) -> Result<(), String>,
    FFaststart: FnMut(&Path) -> Result<(), String>,
    FProject: FnMut(ProjectArtifactFlags) -> Result<(), String>,
{
    if was_cancelled {
        return Ok(VideoFinalizeOutcome::Cancelled);
    }

    let _ = maybe_persist_cursor_data(
        finalization_plan,
        has_cursor_data_path,
        cursor_event_count,
        || persist_cursor_data(),
    );

    finish_encoder()?;
    let video_file_size = postprocess_screen_video(
        finalization_plan,
        screen_video_path,
        system_audio_path,
        microphone_audio_path,
        |video_path, system_path, mic_path| mux_audio_to_video(video_path, system_path, mic_path),
        |video_path| make_video_faststart(video_path),
    )?;

    if finalization_plan.create_project_file {
        let artifact_flags = build_project_artifact_flags(
            has_webcam_output,
            has_cursor_data_path,
            cursor_event_count,
            system_audio_path,
            microphone_audio_path,
        );
        create_project_file(artifact_flags)?;
    }

    Ok(VideoFinalizeOutcome::Finalized { video_file_size })
}

#[cfg(test)]
mod tests {
    use super::{finalize_video_capture, VideoFinalizeOutcome};
    use crate::recorder_finalization::build_finalization_plan;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("snapit_capture_finalize_{}_{}", name, nanos))
    }

    #[test]
    fn cancelled_flow_skips_all_callbacks() {
        let calls = Arc::new(AtomicU64::new(0));
        let path = temp_file_path("cancelled");

        let outcome = finalize_video_capture(
            build_finalization_plan(false),
            true,
            true,
            3,
            true,
            &path,
            None,
            None,
            {
                let calls = Arc::clone(&calls);
                move || {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let calls = Arc::clone(&calls);
                move || {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let calls = Arc::clone(&calls);
                move |_, _, _| {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let calls = Arc::clone(&calls);
                move |_| {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let calls = Arc::clone(&calls);
                move |_| {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
        )
        .expect("cancelled finalize result");

        assert_eq!(outcome, VideoFinalizeOutcome::Cancelled);
        assert_eq!(calls.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn editor_flow_runs_persist_finish_faststart_and_project() {
        let video_path = temp_file_path("editor");
        std::fs::write(&video_path, [1u8, 2, 3]).expect("write temp video");

        let persist_calls = Arc::new(AtomicU64::new(0));
        let finish_calls = Arc::new(AtomicU64::new(0));
        let mux_calls = Arc::new(AtomicU64::new(0));
        let faststart_calls = Arc::new(AtomicU64::new(0));
        let project_calls = Arc::new(AtomicU64::new(0));

        let outcome = finalize_video_capture(
            build_finalization_plan(false),
            false,
            true,
            5,
            true,
            &video_path,
            None,
            None,
            {
                let persist_calls = Arc::clone(&persist_calls);
                move || {
                    persist_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let finish_calls = Arc::clone(&finish_calls);
                move || {
                    finish_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let mux_calls = Arc::clone(&mux_calls);
                move |_, _, _| {
                    mux_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let faststart_calls = Arc::clone(&faststart_calls);
                move |_| {
                    faststart_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let project_calls = Arc::clone(&project_calls);
                move |flags| {
                    assert!(flags.has_webcam);
                    assert!(flags.has_cursor);
                    project_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
        )
        .expect("editor finalize result");

        let _ = std::fs::remove_file(&video_path);

        assert_eq!(
            outcome,
            VideoFinalizeOutcome::Finalized { video_file_size: 3 }
        );
        assert_eq!(persist_calls.load(Ordering::Relaxed), 1);
        assert_eq!(finish_calls.load(Ordering::Relaxed), 1);
        assert_eq!(mux_calls.load(Ordering::Relaxed), 0);
        assert_eq!(faststart_calls.load(Ordering::Relaxed), 1);
        assert_eq!(project_calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn quick_capture_flow_runs_mux_and_skips_project() {
        let video_path = temp_file_path("quick");
        std::fs::write(&video_path, [9u8, 8]).expect("write temp video");

        let mux_calls = Arc::new(AtomicU64::new(0));
        let project_calls = Arc::new(AtomicU64::new(0));

        let outcome = finalize_video_capture(
            build_finalization_plan(true),
            false,
            false,
            0,
            false,
            &video_path,
            Some(Path::new("C:/tmp/system.wav")),
            Some(Path::new("C:/tmp/mic.wav")),
            || Ok(()),
            || Ok(()),
            {
                let mux_calls = Arc::clone(&mux_calls);
                move |_, _, _| {
                    mux_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            |_| Ok(()),
            {
                let project_calls = Arc::clone(&project_calls);
                move |_| {
                    project_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
        )
        .expect("quick finalize result");

        let _ = std::fs::remove_file(&video_path);

        assert_eq!(
            outcome,
            VideoFinalizeOutcome::Finalized { video_file_size: 2 }
        );
        assert_eq!(mux_calls.load(Ordering::Relaxed), 1);
        assert_eq!(project_calls.load(Ordering::Relaxed), 0);
    }
}
