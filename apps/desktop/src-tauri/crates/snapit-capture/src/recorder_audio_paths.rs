//! Shared planning for recording audio artifact file paths.

use std::path::{Path, PathBuf};

/// Plan audio output file paths for a recording session.
///
/// Returns `(system_audio_path, microphone_audio_path)`.
pub fn plan_audio_artifact_paths(
    output_path: &Path,
    quick_capture: bool,
    capture_system_audio: bool,
    capture_microphone: bool,
) -> (Option<PathBuf>, Option<PathBuf>) {
    let audio_base_path = if quick_capture {
        output_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| output_path.to_path_buf())
    } else {
        output_path.to_path_buf()
    };

    let file_stem = if quick_capture {
        output_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("recording")
            .to_string()
    } else {
        String::new()
    };

    let system_path = if capture_system_audio {
        if quick_capture {
            Some(audio_base_path.join(format!("{}_system.wav", file_stem)))
        } else {
            Some(audio_base_path.join("system.wav"))
        }
    } else {
        None
    };

    let mic_path = if capture_microphone {
        if quick_capture {
            Some(audio_base_path.join(format!("{}_mic.wav", file_stem)))
        } else {
            Some(audio_base_path.join("mic.wav"))
        }
    } else {
        None
    };

    (system_path, mic_path)
}

#[cfg(test)]
mod tests {
    use super::plan_audio_artifact_paths;
    use std::path::Path;

    #[test]
    fn editor_flow_paths_live_in_project_folder() {
        let output_path = Path::new("C:/captures/project_1234");
        let (system, mic) = plan_audio_artifact_paths(output_path, false, true, true);

        assert_eq!(
            system.as_deref(),
            Some(Path::new("C:/captures/project_1234/system.wav"))
        );
        assert_eq!(
            mic.as_deref(),
            Some(Path::new("C:/captures/project_1234/mic.wav"))
        );
    }

    #[test]
    fn quick_capture_paths_use_file_stem_siblings() {
        let output_path = Path::new("C:/captures/recording_001.mp4");
        let (system, mic) = plan_audio_artifact_paths(output_path, true, true, true);

        assert_eq!(
            system.as_deref(),
            Some(Path::new("C:/captures/recording_001_system.wav"))
        );
        assert_eq!(
            mic.as_deref(),
            Some(Path::new("C:/captures/recording_001_mic.wav"))
        );
    }

    #[test]
    fn disabled_tracks_return_none() {
        let output_path = Path::new("C:/captures/recording_001.mp4");
        let (system, mic) = plan_audio_artifact_paths(output_path, true, false, false);

        assert_eq!(system, None);
        assert_eq!(mic, None);
    }
}
