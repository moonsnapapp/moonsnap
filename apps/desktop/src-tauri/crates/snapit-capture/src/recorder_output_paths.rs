//! Shared planning for video recording output artifact paths.

use std::path::{Path, PathBuf};

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
    use super::{plan_video_output_paths, VideoOutputPaths};
    use std::path::Path;

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
