//! Shared post-processing helpers for finalized screen video artifacts.

use std::path::Path;

use crate::recorder_finalization::FinalizationPlan;

/// Verify that the video file exists and is non-empty.
pub fn verify_video_file_non_empty(screen_video_path: &Path) -> Result<u64, String> {
    let video_file_size = std::fs::metadata(screen_video_path)
        .map(|m| m.len())
        .unwrap_or(0);
    log::info!(
        "[CAPTURE] Video file after encoder.finish(): {} ({} bytes)",
        screen_video_path.to_string_lossy(),
        video_file_size
    );
    if video_file_size == 0 {
        return Err(format!(
            "Video encoder produced empty file: {}",
            screen_video_path.to_string_lossy()
        ));
    }
    Ok(video_file_size)
}

/// Run postprocess steps after main video encoder finishes.
///
/// Behavior matches current app flow:
/// - validate non-empty output
/// - optionally mux audio (warn on error)
/// - attempt faststart (warn on error)
pub fn postprocess_screen_video<FMux, FFaststart>(
    finalization_plan: FinalizationPlan,
    screen_video_path: &Path,
    system_audio_path: Option<&Path>,
    mic_audio_path: Option<&Path>,
    mut mux_audio_to_video: FMux,
    mut make_video_faststart: FFaststart,
) -> Result<u64, String>
where
    FMux: FnMut(&Path, Option<&Path>, Option<&Path>) -> Result<(), String>,
    FFaststart: FnMut(&Path) -> Result<(), String>,
{
    let video_file_size = verify_video_file_non_empty(screen_video_path)?;

    if finalization_plan.mux_audio {
        if let Err(e) = mux_audio_to_video(screen_video_path, system_audio_path, mic_audio_path) {
            log::warn!("Audio muxing failed: {}", e);
        }
    } else {
        log::debug!("[CAPTURE] Editor flow: keeping separate audio files for editing");
    }

    if let Err(e) = make_video_faststart(screen_video_path) {
        log::warn!("[CAPTURE] Faststart failed (video will load slowly): {}", e);
    }

    Ok(video_file_size)
}

#[cfg(test)]
mod tests {
    use super::{postprocess_screen_video, verify_video_file_non_empty};
    use crate::recorder_finalization::build_finalization_plan;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("snapit_capture_{}_{}", name, nanos))
    }

    #[test]
    fn verify_rejects_missing_file() {
        let path = temp_file("missing");
        let result = verify_video_file_non_empty(&path);
        assert!(result.is_err());
    }

    #[test]
    fn verify_rejects_empty_file() {
        let path = temp_file("empty");
        let _ = std::fs::write(&path, []);
        let result = verify_video_file_non_empty(&path);
        let _ = std::fs::remove_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn postprocess_mux_path_calls_mux_and_faststart() {
        let path = temp_file("mux");
        let _ = std::fs::write(&path, [1u8, 2, 3]);

        let mux_calls = Arc::new(AtomicU64::new(0));
        let faststart_calls = Arc::new(AtomicU64::new(0));

        let result = postprocess_screen_video(
            build_finalization_plan(true),
            &path,
            Some(Path::new("C:/tmp/system.wav")),
            Some(Path::new("C:/tmp/mic.wav")),
            {
                let mux_calls = Arc::clone(&mux_calls);
                move |_video, _sys, _mic| {
                    mux_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let faststart_calls = Arc::clone(&faststart_calls);
                move |_video| {
                    faststart_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
        );

        let _ = std::fs::remove_file(&path);
        assert_eq!(result, Ok(3));
        assert_eq!(mux_calls.load(Ordering::Relaxed), 1);
        assert_eq!(faststart_calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn postprocess_editor_path_skips_mux() {
        let path = temp_file("editor");
        let _ = std::fs::write(&path, [7u8, 8]);

        let mux_calls = Arc::new(AtomicU64::new(0));
        let faststart_calls = Arc::new(AtomicU64::new(0));

        let result = postprocess_screen_video(
            build_finalization_plan(false),
            &path,
            None,
            None,
            {
                let mux_calls = Arc::clone(&mux_calls);
                move |_video, _sys, _mic| {
                    mux_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            {
                let faststart_calls = Arc::clone(&faststart_calls);
                move |_video| {
                    faststart_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
        );

        let _ = std::fs::remove_file(&path);
        assert_eq!(result, Ok(2));
        assert_eq!(mux_calls.load(Ordering::Relaxed), 0);
        assert_eq!(faststart_calls.load(Ordering::Relaxed), 1);
    }
}
