//! Shared planning for video recording output artifact paths.

use std::path::{Path, PathBuf};

use moonsnap_capture_types::recording::RecordingFormat;

/// Where a freshly started recording should write its top-level output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordingOutput {
    /// A single flat file written directly (quick-capture MP4 or any GIF).
    File(PathBuf),
    /// A project folder (editor flow) that downstream artifacts populate.
    ProjectFolder(PathBuf),
}

/// Decide the top-level output location for a new recording.
///
/// This is the pure structural decision extracted from the Tauri command layer:
/// the caller resolves `save_dir`, `timestamp`, and `suffix` from the running
/// environment and is responsible for creating the returned directories.
pub fn plan_recording_output(
    save_dir: &Path,
    format: RecordingFormat,
    quick_capture: bool,
    timestamp: &str,
    suffix: u16,
) -> RecordingOutput {
    match format {
        // Quick capture: flat file, skip the editor project.
        RecordingFormat::Mp4 if quick_capture => {
            RecordingOutput::File(save_dir.join(format!("moonsnap_{timestamp}_{suffix}.mp4")))
        },
        // Editor flow: a project folder holding screen/webcam artifacts.
        RecordingFormat::Mp4 => {
            RecordingOutput::ProjectFolder(save_dir.join(format!("moonsnap_{timestamp}_{suffix}")))
        },
        // GIF: always a flat file (no complex artifacts).
        RecordingFormat::Gif => {
            RecordingOutput::File(save_dir.join(format!("moonsnap_{timestamp}_{suffix}.gif")))
        },
    }
}

/// Planned output paths for video recording artifacts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoOutputPaths {
    pub screen_video_path: PathBuf,
    pub webcam_output_path: Option<PathBuf>,
}

/// Plan screen/webcam output paths for quick-capture vs editor flow.
pub fn plan_video_output_paths(
    output_path: &Path,
    quick_capture: bool,
    webcam_enabled_for_editor: bool,
) -> VideoOutputPaths {
    if quick_capture {
        VideoOutputPaths {
            screen_video_path: output_path.to_path_buf(),
            webcam_output_path: None,
        }
    } else {
        VideoOutputPaths {
            screen_video_path: output_path.join("screen.mp4"),
            webcam_output_path: if webcam_enabled_for_editor {
                Some(output_path.join("webcam.mp4"))
            } else {
                None
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        plan_recording_output, plan_video_output_paths, RecordingOutput, VideoOutputPaths,
    };
    use moonsnap_capture_types::recording::RecordingFormat;
    use std::path::Path;

    #[test]
    fn quick_capture_mp4_is_a_flat_file() {
        let out = plan_recording_output(
            Path::new("C:/captures"),
            RecordingFormat::Mp4,
            true,
            "20260529_120000",
            42,
        );
        assert_eq!(
            out,
            RecordingOutput::File(Path::new("C:/captures/moonsnap_20260529_120000_42.mp4").into())
        );
    }

    #[test]
    fn editor_mp4_is_a_project_folder() {
        let out = plan_recording_output(
            Path::new("C:/captures"),
            RecordingFormat::Mp4,
            false,
            "20260529_120000",
            42,
        );
        assert_eq!(
            out,
            RecordingOutput::ProjectFolder(
                Path::new("C:/captures/moonsnap_20260529_120000_42").into()
            )
        );
    }

    #[test]
    fn gif_is_always_a_flat_file_even_in_editor_flow() {
        let out = plan_recording_output(
            Path::new("C:/captures"),
            RecordingFormat::Gif,
            false,
            "20260529_120000",
            7,
        );
        assert_eq!(
            out,
            RecordingOutput::File(Path::new("C:/captures/moonsnap_20260529_120000_7.gif").into())
        );
    }

    #[test]
    fn quick_capture_uses_file_path_and_no_webcam() {
        let output = plan_video_output_paths(Path::new("C:/captures/recording.mp4"), true, true);
        assert_eq!(
            output,
            VideoOutputPaths {
                screen_video_path: Path::new("C:/captures/recording.mp4").to_path_buf(),
                webcam_output_path: None,
            }
        );
    }

    #[test]
    fn editor_flow_adds_screen_mp4_and_optional_webcam() {
        let output = plan_video_output_paths(Path::new("C:/captures/project_1"), false, true);
        assert_eq!(
            output,
            VideoOutputPaths {
                screen_video_path: Path::new("C:/captures/project_1/screen.mp4").to_path_buf(),
                webcam_output_path: Some(
                    Path::new("C:/captures/project_1/webcam.mp4").to_path_buf()
                ),
            }
        );
    }

    #[test]
    fn editor_flow_without_webcam() {
        let output = plan_video_output_paths(Path::new("C:/captures/project_1"), false, false);
        assert_eq!(
            output,
            VideoOutputPaths {
                screen_video_path: Path::new("C:/captures/project_1/screen.mp4").to_path_buf(),
                webcam_output_path: None,
            }
        );
    }
}
