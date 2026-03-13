use std::sync::Mutex;
use tauri::Manager;

#[cfg(desktop)]
use crate::TrayState;

// Note: close_to_tray functions are in crate::config::app module

/// Update tray menu item text for a shortcut
#[tauri::command]
pub fn update_tray_shortcut(
    app: tauri::AppHandle,
    shortcut_id: String,
    display_text: String,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let tray_state = app.state::<Mutex<TrayState>>();
        let tray = tray_state
            .lock()
            .map_err(|e| format!("Failed to lock tray state: {}", e))?;

        match shortcut_id.as_str() {
            "open_capture_toolbar" => tray
                .update_open_capture_toolbar_text(&display_text)
                .map_err(|e| format!("Failed to update capture toolbar text: {}", e))?,
            "new_capture" => tray
                .update_new_capture_text(&display_text)
                .map_err(|e| format!("Failed to update new capture text: {}", e))?,
            "fullscreen_capture" => tray
                .update_fullscreen_text(&display_text)
                .map_err(|e| format!("Failed to update fullscreen text: {}", e))?,
            "all_monitors_capture" => tray
                .update_all_monitors_text(&display_text)
                .map_err(|e| format!("Failed to update all monitors text: {}", e))?,
            "record_video" => tray
                .update_record_video_text(&display_text)
                .map_err(|e| format!("Failed to update record video text: {}", e))?,
            "record_gif" => tray
                .update_record_gif_text(&display_text)
                .map_err(|e| format!("Failed to update record GIF text: {}", e))?,
            _ => {}, // Ignore unknown shortcut IDs
        }
    }

    Ok(())
}

/// Set autostart enabled/disabled
#[tauri::command]
pub async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app.autolaunch();

        if enabled {
            autostart_manager
                .enable()
                .map_err(|e| format!("Failed to enable autostart: {}", e))?;
        } else {
            autostart_manager
                .disable()
                .map_err(|e| format!("Failed to disable autostart: {}", e))?;
        }
    }

    Ok(())
}

/// Check if autostart is enabled
#[tauri::command]
pub async fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app.autolaunch();
        autostart_manager
            .is_enabled()
            .map_err(|e| format!("Failed to check autostart status: {}", e))
    }

    #[cfg(not(desktop))]
    Ok(false)
}

/// Open file explorer at the given path
#[tauri::command]
pub async fn open_path_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}

/// Reveal a file in the file explorer (opens containing folder and selects the file)
#[tauri::command]
pub async fn reveal_file_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux doesn't have a standard way to select a file, so open the parent folder
        let path = std::path::Path::new(&path);
        let parent = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}

/// Get the default save directory path
#[tauri::command]
pub async fn get_default_save_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .home_dir()
        .map_err(|e| format!("Failed to get home directory: {}", e))?;

    let moonsnap_path = path.join("MoonSnap");

    // Create the directory if it doesn't exist
    if !moonsnap_path.exists() {
        std::fs::create_dir_all(&moonsnap_path)
            .map_err(|e| format!("Failed to create MoonSnap directory: {}", e))?;
    }

    Ok(moonsnap_path.to_string_lossy().to_string())
}

/// Get the default save directory path (synchronous version for internal use).
pub fn get_default_save_dir_sync() -> Result<std::path::PathBuf, String> {
    let path = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let moonsnap_path = path.join("MoonSnap");

    // Create the directory if it doesn't exist
    if !moonsnap_path.exists() {
        std::fs::create_dir_all(&moonsnap_path)
            .map_err(|e| format!("Failed to create MoonSnap directory: {}", e))?;
    }

    Ok(moonsnap_path)
}

/// Pre-check a directory before moving: count items and detect locked files.
/// Returns { item_count: u32, locked_files: Vec<String> }.
#[tauri::command]
pub async fn check_dir_for_move(path: String) -> Result<serde_json::Value, String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.exists() {
        return Ok(serde_json::json!({ "item_count": 0, "locked_files": [] }));
    }

    let entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    let item_count = entries.len() as u32;
    let mut locked_files: Vec<String> = Vec::new();

    for entry in &entries {
        let file_path = entry.path();
        // For files, try to open with exclusive write access to detect locks
        if file_path.is_file() {
            match std::fs::OpenOptions::new().write(true).open(&file_path) {
                Ok(_) => {}, // File is accessible
                Err(_) => {
                    locked_files.push(entry.file_name().to_string_lossy().to_string());
                },
            }
        } else if file_path.is_dir() {
            // For directories, check if any immediate children are locked
            collect_locked_files_in_dir(
                &file_path,
                &entry.file_name().to_string_lossy(),
                &mut locked_files,
            );
        }
    }

    Ok(serde_json::json!({
        "item_count": item_count,
        "locked_files": locked_files,
    }))
}

/// Check a directory for locked files (non-recursive, one level deep).
fn collect_locked_files_in_dir(dir: &std::path::Path, parent_name: &str, locked: &mut Vec<String>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let file_path = entry.path();
            if file_path.is_file() {
                if std::fs::OpenOptions::new()
                    .write(true)
                    .open(&file_path)
                    .is_err()
                {
                    locked.push(format!(
                        "{}/{}",
                        parent_name,
                        entry.file_name().to_string_lossy()
                    ));
                }
            }
        }
    }
}

/// Move save directory contents from old location to a new location.
/// Emits `move-save-dir-progress` events with { moved: u32, total: u32, name: String }.
#[tauri::command]
pub async fn move_save_dir(
    app: tauri::AppHandle,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let old = std::path::PathBuf::from(&old_path);
    let new = std::path::PathBuf::from(&new_path);

    if !old.exists() {
        std::fs::create_dir_all(&new)
            .map_err(|e| format!("Failed to create new directory: {}", e))?;
        return Ok(());
    }

    if old == new {
        return Ok(());
    }

    // Collect entries first to get total count
    let entries: Vec<_> = std::fs::read_dir(&old)
        .map_err(|e| format!("Failed to read old directory: {}", e))?
        .filter_map(|e| e.ok())
        .collect();

    let total = entries.len() as u32;

    // Create new directory
    std::fs::create_dir_all(&new).map_err(|e| format!("Failed to create new directory: {}", e))?;

    for (i, entry) in entries.iter().enumerate() {
        let dest = new.join(entry.file_name());
        let name = entry.file_name().to_string_lossy().to_string();

        // Emit progress
        let _ = app.emit(
            "move-save-dir-progress",
            serde_json::json!({
                "moved": i as u32,
                "total": total,
                "name": name,
            }),
        );

        // Skip if destination already exists
        if dest.exists() {
            continue;
        }

        // Try rename first (fast, same filesystem), fall back to copy
        if std::fs::rename(entry.path(), &dest).is_err() {
            if entry.path().is_dir() {
                copy_dir_recursive(&entry.path(), &dest)?;
                std::fs::remove_dir_all(entry.path()).map_err(|e| {
                    format!("Failed to remove old directory {:?}: {}", entry.path(), e)
                })?;
            } else {
                std::fs::copy(entry.path(), &dest)
                    .map_err(|e| format!("Failed to copy file: {}", e))?;
                std::fs::remove_file(entry.path())
                    .map_err(|e| format!("Failed to remove old file: {}", e))?;
            }
        }
    }

    // Final progress emit
    let _ = app.emit(
        "move-save-dir-progress",
        serde_json::json!({
            "moved": total,
            "total": total,
            "name": "",
        }),
    );

    // Remove old directory if empty
    if old.read_dir().map_or(false, |mut d| d.next().is_none()) {
        let _ = std::fs::remove_dir(&old);
    }

    Ok(())
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;

    for entry in
        std::fs::read_dir(src).map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let dest = dst.join(entry.file_name());

        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }
    Ok(())
}

/// Open a file with the system's default application
#[tauri::command]
pub async fn open_file_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

/// Copy a file to a user-selected destination without re-encoding.
#[tauri::command]
pub async fn save_copy_of_file(
    source_path: String,
    destination_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let source = std::path::PathBuf::from(&source_path);
        let destination = std::path::PathBuf::from(&destination_path);

        if !source.exists() {
            return Err(format!("Source file not found: {}", source_path));
        }

        if source == destination {
            return Ok(());
        }

        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination folder: {}", e))?;
        }

        std::fs::copy(&source, &destination).map_err(|e| format!("Failed to copy file: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Copy task panicked: {}", e))?
}
