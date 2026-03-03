//! Video editor window commands.
//!
//! Each video opens in its own dedicated window for faster switching
//! between projects. Windows are tracked by project path to prevent duplicates.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::editor_windows::{
    find_path_by_label, focus_or_remove_stale_window, generate_window_label, remove_path_by_label,
};

/// Video editor window label prefix
const VIDEO_EDITOR_LABEL_PREFIX: &str = "video-editor-";

/// Track open video editor windows by project path
/// Maps: project_path -> window_label
static OPEN_EDITORS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn get_editors() -> std::sync::MutexGuard<'static, Option<HashMap<String, String>>> {
    let mut guard = OPEN_EDITORS
        .lock()
        .expect("video_editor: OPEN_EDITORS lock poisoned");
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

/// Show or create a video editor window for the given project path.
/// If a window for this project already exists, focus it instead.
#[command]
pub async fn show_video_editor_window(
    app: AppHandle,
    project_path: String,
) -> Result<String, String> {
    let mut editors = get_editors();
    // Safe: get_editors() initializes to Some if None
    let editors_map = editors
        .as_mut()
        .expect("editors initialized by get_editors");

    // Check if a window for this project already exists
    if let Some(existing_label) = focus_or_remove_stale_window(&app, editors_map, &project_path)? {
        return Ok(existing_label);
    }

    // Create new window
    let label = generate_window_label(VIDEO_EDITOR_LABEL_PREFIX);

    // Pass project path via URL query parameter for immediate availability
    let encoded_path = urlencoding::encode(&project_path);
    let url = WebviewUrl::App(format!("windows/video-editor.html?path={}", encoded_path).into());

    // Extract filename for window title
    let filename = std::path::Path::new(&project_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Video Editor");

    let window = WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("{} - MoonSnap", filename))
        .inner_size(1400.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .maximizable(true)
        .transparent(true)
        .decorations(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .shadow(true)
        .center()
        .visible(false) // Hidden until frontend is ready
        .focused(true)
        .build()
        .map_err(|e| format!("Failed to create video editor window: {}", e))?;

    // Track the window
    editors_map.insert(project_path.clone(), label.clone());

    // Show the window - project path is in URL query params
    let _ = window.show();

    Ok(label)
}

/// Close a video editor window by its label.
#[command]
pub async fn close_video_editor_window(app: AppHandle, label: String) -> Result<(), String> {
    // Remove from tracking
    let mut editors = get_editors();
    // Safe: get_editors() initializes to Some if None
    let editors_map = editors
        .as_mut()
        .expect("editors initialized by get_editors");

    remove_path_by_label(editors_map, &label);

    // Close the window
    if let Some(window) = app.get_webview_window(&label) {
        window
            .close()
            .map_err(|e| format!("Failed to close window: {}", e))?;
    }

    Ok(())
}

/// Get the project path for a video editor window.
#[command]
pub fn get_video_editor_project_path(label: String) -> Option<String> {
    let editors = get_editors();
    // Safe: get_editors() initializes to Some if None
    let editors_map = editors
        .as_ref()
        .expect("editors initialized by get_editors");

    find_path_by_label(editors_map, &label)
}

/// Clean up tracking when a video editor window is closed.
/// Called from window close event handler.
pub fn on_video_editor_closed(label: &str) {
    if !label.starts_with(VIDEO_EDITOR_LABEL_PREFIX) {
        return;
    }

    let mut editors = get_editors();
    // Safe: get_editors() initializes to Some if None
    let editors_map = editors
        .as_mut()
        .expect("editors initialized by get_editors");

    if let Some(path) = remove_path_by_label(editors_map, label) {
        log::info!("Cleaned up video editor window: {} ({})", label, path);
    }
}

/// Check if a label belongs to a video editor window.
pub fn is_video_editor_window(label: &str) -> bool {
    label.starts_with(VIDEO_EDITOR_LABEL_PREFIX)
}
