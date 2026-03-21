use moonsnap_core::error::MoonSnapResult;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

pub(super) fn generate_window_label(prefix: &str) -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_millis();
    format!("{}{}", prefix, timestamp)
}

pub(super) fn focus_existing_window(app: &AppHandle, label: &str) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(label) else {
        return Err("Window not found".into());
    };

    show_maximized_and_focus_window(&window)?;

    Ok(())
}

pub(super) fn show_maximized_and_focus_window(window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    window
        .show()
        .map_err(|e| format!("Failed to show window: {}", e))?;
    window
        .maximize()
        .map_err(|e| format!("Failed to maximize window: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus window: {}", e))?;

    Ok(())
}

pub(super) fn focus_or_remove_stale_window(
    app: &AppHandle,
    editors_map: &mut HashMap<String, String>,
    key: &str,
) -> MoonSnapResult<Option<String>> {
    let existing_label = match editors_map.get(key) {
        Some(label) => label.clone(),
        None => return Ok(None),
    };

    if app.get_webview_window(&existing_label).is_some() {
        focus_existing_window(app, &existing_label)?;
        return Ok(Some(existing_label));
    }

    editors_map.remove(key);
    Ok(None)
}

pub(super) fn remove_path_by_label(
    editors_map: &mut HashMap<String, String>,
    label: &str,
) -> Option<String> {
    let key = editors_map
        .iter()
        .find(|(_, value)| value.as_str() == label)
        .map(|(k, _)| k.clone());

    if let Some(ref found_key) = key {
        editors_map.remove(found_key);
    }

    key
}

pub(super) fn find_path_by_label(
    editors_map: &HashMap<String, String>,
    label: &str,
) -> Option<String> {
    editors_map
        .iter()
        .find(|(_, value)| value.as_str() == label)
        .map(|(k, _)| k.clone())
}
