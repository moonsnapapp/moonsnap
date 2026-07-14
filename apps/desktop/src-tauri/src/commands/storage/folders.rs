//! Folder organization commands.
//!
//! Folders are pure metadata: the registry lives in `{app_data}/folders.json`
//! and items point at a folder via the `folder_id` field on their metadata
//! sidecar. Moving an item between folders never touches media files on disk.

use chrono::Utc;
use moonsnap_domain::storage::{CaptureProject, Folder};
use moonsnap_error::error::MoonSnapResult;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{command, AppHandle};

use super::update::update_sidecar_metadata;
use super::{generate_id, get_app_data_dir};

/// Guards read-modify-write cycles on folders.json.
static FOLDERS_FILE_LOCK: Mutex<()> = Mutex::new(());

fn lock_folders_file() -> std::sync::MutexGuard<'static, ()> {
    FOLDERS_FILE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn folders_file_path(app: &AppHandle) -> MoonSnapResult<PathBuf> {
    Ok(get_app_data_dir(app)?.join("folders.json"))
}

fn read_folders(path: &Path) -> Vec<Folder> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn write_folders(path: &Path, folders: &[Folder]) -> MoonSnapResult<()> {
    let json = serde_json::to_string_pretty(folders)
        .map_err(|e| format!("Failed to serialize folders: {}", e))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    fs::write(path, json).map_err(|e| format!("Failed to write folders: {}", e))?;
    Ok(())
}

fn validate_folder_name(name: &str) -> MoonSnapResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".into());
    }
    Ok(trimmed.to_string())
}

/// Clear `folder_id` on every metadata sidecar that references the deleted
/// folder, so items return to the root library instead of pointing at a
/// dangling folder id.
fn clear_folder_assignments(base_dir: &Path, folder_id: &str) {
    let projects_dir = base_dir.join("projects");
    let Ok(entries) = fs::read_dir(&projects_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let project_file = entry.path().join("project.json");
        let Ok(content) = fs::read_to_string(&project_file) else {
            continue;
        };
        let Ok(mut project) = serde_json::from_str::<CaptureProject>(&content) else {
            continue;
        };
        if project.folder_id.as_deref() != Some(folder_id) {
            continue;
        }

        project.folder_id = None;
        if let Ok(json) = serde_json::to_string_pretty(&project) {
            if let Err(e) = fs::write(&project_file, json) {
                log::warn!(
                    "[FOLDERS] Failed to clear folder assignment on {:?}: {}",
                    project_file,
                    e
                );
            }
        }
    }
}

#[command]
pub async fn list_folders(app: AppHandle) -> MoonSnapResult<Vec<Folder>> {
    let path = folders_file_path(&app)?;
    let _guard = lock_folders_file();
    Ok(read_folders(&path))
}

#[command]
pub async fn create_folder(app: AppHandle, name: String) -> MoonSnapResult<Folder> {
    let name = validate_folder_name(&name)?;
    let path = folders_file_path(&app)?;

    let _guard = lock_folders_file();
    let mut folders = read_folders(&path);

    let folder = Folder {
        id: generate_id(),
        name,
        created_at: Utc::now(),
    };
    folders.push(folder.clone());
    write_folders(&path, &folders)?;

    Ok(folder)
}

#[command]
pub async fn rename_folder(
    app: AppHandle,
    folder_id: String,
    name: String,
) -> MoonSnapResult<Folder> {
    let name = validate_folder_name(&name)?;
    let path = folders_file_path(&app)?;

    let _guard = lock_folders_file();
    let mut folders = read_folders(&path);

    let folder = folders
        .iter_mut()
        .find(|folder| folder.id == folder_id)
        .ok_or("Folder not found")?;
    folder.name = name;
    let renamed = folder.clone();

    write_folders(&path, &folders)?;
    Ok(renamed)
}

#[command]
pub async fn delete_folder(app: AppHandle, folder_id: String) -> MoonSnapResult<()> {
    let path = folders_file_path(&app)?;

    {
        let _guard = lock_folders_file();
        let mut folders = read_folders(&path);
        folders.retain(|folder| folder.id != folder_id);
        write_folders(&path, &folders)?;
    }

    // Items in the deleted folder return to the root library.
    let base_dir = get_app_data_dir(&app)?;
    clear_folder_assignments(&base_dir, &folder_id);

    Ok(())
}

#[command]
pub async fn move_captures_to_folder(
    app: AppHandle,
    project_ids: Vec<String>,
    folder_id: Option<String>,
) -> MoonSnapResult<()> {
    if let Some(target_id) = &folder_id {
        let path = folders_file_path(&app)?;
        let _guard = lock_folders_file();
        let folders = read_folders(&path);
        if !folders.iter().any(|folder| &folder.id == target_id) {
            return Err("Folder not found".into());
        }
    }

    let base_dir = get_app_data_dir(&app)?;
    for project_id in &project_ids {
        update_sidecar_metadata(&base_dir, project_id, |project| {
            project.folder_id = folder_id.clone();
        })?;
    }

    Ok(())
}
