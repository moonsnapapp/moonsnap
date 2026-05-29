//! GIF editor window commands.
//!
//! Each GIF opens in its own dedicated window. Windows are tracked by
//! capture path to prevent duplicates.

use moonsnap_error::error::MoonSnapResult;
use parking_lot::Mutex;
use std::collections::HashMap;
use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::editor_windows::{
    find_path_by_label, focus_or_remove_stale_window, generate_window_label, remove_path_by_label,
    show_maximized_and_focus_window,
};

const GIF_EDITOR_LABEL_PREFIX: &str = "gif-editor-";

static OPEN_EDITORS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn get_editors() -> parking_lot::MutexGuard<'static, Option<HashMap<String, String>>> {
    let mut guard = OPEN_EDITORS.lock();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

#[command]
pub async fn show_gif_editor_window(
    app: AppHandle,
    capture_path: String,
) -> MoonSnapResult<String> {
    let mut editors = get_editors();
    let editors_map = editors
        .as_mut()
        .expect("editors initialized by get_editors");

    if let Some(existing_label) = focus_or_remove_stale_window(&app, editors_map, &capture_path)? {
        return Ok(existing_label);
    }

    let label = generate_window_label(GIF_EDITOR_LABEL_PREFIX);

    let encoded_path = urlencoding::encode(&capture_path);
    let url = WebviewUrl::App(format!("windows/gif-editor.html?path={}", encoded_path).into());

    let filename = std::path::Path::new(&capture_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("GIF Editor");

    let window = WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("{} - MoonSnap", filename))
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 540.0)
        .resizable(true)
        .maximizable(true)
        .maximized(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .shadow(true)
        .center()
        .visible(false)
        .focused(true)
        .build()
        .map_err(|e| format!("Failed to create gif editor window: {}", e))?;

    editors_map.insert(capture_path.clone(), label.clone());

    show_maximized_and_focus_window(&window)?;

    Ok(label)
}

#[command]
pub async fn close_gif_editor_window(app: AppHandle, label: String) -> MoonSnapResult<()> {
    let mut editors = get_editors();
    let editors_map = editors
        .as_mut()
        .expect("editors initialized by get_editors");

    remove_path_by_label(editors_map, &label);

    if let Some(window) = app.get_webview_window(&label) {
        window
            .close()
            .map_err(|e| format!("Failed to close window: {}", e))?;
    }

    Ok(())
}

#[command]
pub fn get_gif_editor_capture_path(label: String) -> Option<String> {
    let editors = get_editors();
    let editors_map = editors
        .as_ref()
        .expect("editors initialized by get_editors");

    find_path_by_label(editors_map, &label)
}

pub fn on_gif_editor_closed(label: &str) {
    if !label.starts_with(GIF_EDITOR_LABEL_PREFIX) {
        return;
    }

    let mut editors = get_editors();
    let editors_map = editors
        .as_mut()
        .expect("editors initialized by get_editors");

    if let Some(path) = remove_path_by_label(editors_map, label) {
        log::info!("Cleaned up gif editor window: {} ({})", label, path);
    }
}

pub fn is_gif_editor_window(label: &str) -> bool {
    label.starts_with(GIF_EDITOR_LABEL_PREFIX)
}
