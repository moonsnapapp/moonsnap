//! Video project file creation after recording.

use moonsnap_core::error::MoonSnapResult;
use std::path::Path;

use moonsnap_domain::video_project::VideoProject;

/// Request to create a project.json file after recording.
pub struct CreateVideoProjectRequest<'a> {
    pub project_folder: &'a Path,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
    pub fps: u32,
    pub quick_capture: bool,
    pub has_webcam: bool,
    pub has_cursor_data: bool,
    pub has_system_audio: bool,
    pub has_mic_audio: bool,
}

/// Create a project.json file in the video project folder.
///
/// This creates the VideoProject metadata file that allows the video editor
/// to load and edit the recording with all its associated files.
pub fn create_video_project_file(request: CreateVideoProjectRequest<'_>) -> MoonSnapResult<()> {
    let screen_video = "screen.mp4".to_string();

    let mut project = VideoProject::new(
        &screen_video,
        request.width,
        request.height,
        request.duration_ms,
        request.fps,
    );
    project.quick_capture = request.quick_capture;

    if let Some(folder_name) = request.project_folder.file_name() {
        let folder_name = folder_name.to_string_lossy().into_owned();
        project.name = folder_name.clone();
        project.original_file_name = if request.quick_capture {
            Some(format!("{}.mp4", folder_name))
        } else {
            None
        };
    }

    if request.has_webcam {
        project.sources.webcam_video = Some("webcam.mp4".to_string());
        project.webcam.enabled = true;
    }

    if request.has_cursor_data {
        project.sources.cursor_data = Some("cursor.json".to_string());
    }

    if request.has_system_audio {
        project.sources.system_audio = Some("system.wav".to_string());
    }

    if request.has_mic_audio {
        project.sources.microphone_audio = Some("mic.wav".to_string());
    }

    let project_file = request.project_folder.join("project.json");
    project.save(&project_file)?;

    log::info!(
        "[PROJECT] Created project.json in {:?}",
        request.project_folder
    );

    Ok(())
}
