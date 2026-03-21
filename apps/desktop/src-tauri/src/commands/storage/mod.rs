//! Storage module for capture projects, thumbnails, and media files.
//!
//! ## Architecture
//!
//! ```text
//! mod.rs (public API + shared helpers + crate re-exports)
//!   |
//!   +-- save.rs       (save_capture, save_capture_from_file, import_image_from_path)
//!   +-- update.rs     (update_project_annotations, update_project_metadata)
//!   +-- query.rs      (get_capture_list, get_project, get_project_image, ...)
//!   +-- delete.rs     (delete_project, delete_projects)
//!   +-- export.rs     (export_project)
//!   +-- maintenance.rs (get_storage_stats, ensure_ffmpeg, startup_cleanup, repair_project)
//!   +-- tests.rs      (unit tests)
//!
//! Shared types now come from `moonsnap-domain::storage`.
//! Shared FFmpeg utilities now come from `moonsnap-media::ffmpeg`.
//! `

pub mod delete;
pub mod export;
pub mod maintenance;
pub mod query;
pub mod save;
#[cfg(test)]
mod tests;
pub mod update;

use moonsnap_core::error::MoonSnapResult;
use rand::Rng;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

// ============================================================================
// Shared Types
// ============================================================================

static SAVED_CAPTURE_LOOKUPS: LazyLock<Mutex<HashMap<String, SavedCaptureLookup>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCaptureLookup {
    pub project_id: String,
    pub image_path: String,
}

pub(crate) fn remember_saved_capture_lookup(
    original_path: &str,
    project_id: &str,
    image_path: &str,
) {
    if let Ok(mut lookups) = SAVED_CAPTURE_LOOKUPS.lock() {
        lookups.insert(
            original_path.to_string(),
            SavedCaptureLookup {
                project_id: project_id.to_string(),
                image_path: image_path.to_string(),
            },
        );
    }
}

pub(crate) fn get_saved_capture_lookup_for_path(path: &str) -> Option<SavedCaptureLookup> {
    SAVED_CAPTURE_LOOKUPS
        .lock()
        .ok()
        .and_then(|lookups| lookups.get(path).cloned())
}

// ============================================================================
// Shared Helper Functions
// ============================================================================

/// Get the user's configured save directory from settings, falling back to ~/MoonSnap
pub(crate) fn get_captures_dir(app: &AppHandle) -> MoonSnapResult<PathBuf> {
    let app_data_dir = get_app_data_dir(app)?;
    let settings_path = app_data_dir.join("settings.json");

    // Try to read settings file
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
            // Get the "general" object and then "defaultSaveDir"
            if let Some(general) = settings.get("general") {
                if let Some(default_dir) = general.get("defaultSaveDir") {
                    if let Some(dir_str) = default_dir.as_str() {
                        let path = PathBuf::from(dir_str);
                        // Ensure directory exists
                        if !path.exists() {
                            fs::create_dir_all(&path)
                                .map_err(|e| format!("Failed to create save directory: {}", e))?;
                        }
                        return Ok(path);
                    }
                }
            }
        }
    }

    // Fallback to ~/Documents/MoonSnap
    let docs_dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("Failed to get documents directory: {}", e))?;
    let moonsnap_path = docs_dir.join("MoonSnap");

    if !moonsnap_path.exists() {
        fs::create_dir_all(&moonsnap_path)
            .map_err(|e| format!("Failed to create MoonSnap directory: {}", e))?;
    }

    Ok(moonsnap_path)
}

/// Get the app data directory.
pub(crate) fn get_app_data_dir(app: &AppHandle) -> MoonSnapResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e).into())
}

/// Ensure all storage directories exist.
pub(crate) fn ensure_directories(app: &AppHandle) -> MoonSnapResult<PathBuf> {
    let base_dir = get_app_data_dir(app)?;

    let dirs = ["captures", "projects", "thumbnails"];
    for dir in dirs {
        let path = base_dir.join(dir);
        if !path.exists() {
            fs::create_dir_all(&path)
                .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
        }
    }

    Ok(base_dir)
}

/// Generate a unique ID for a capture.
pub(crate) fn generate_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_millis();
    let random: u32 = rand::thread_rng().gen();
    format!("{:x}{:06x}", timestamp, random & 0xFFFFFF)
}

/// Calculate the total size of a directory recursively.
pub(crate) fn calculate_dir_size(path: &PathBuf) -> u64 {
    let mut size: u64 = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(metadata) = fs::metadata(&path) {
                    size += metadata.len();
                }
            } else if path.is_dir() {
                size += calculate_dir_size(&path);
            }
        }
    }
    size
}

/// Find a project folder by project ID.
pub(crate) fn find_project_bundle(
    captures_dir: &std::path::Path,
    project_id: &str,
) -> MoonSnapResult<std::path::PathBuf> {
    let direct_path = captures_dir.join(project_id);
    if direct_path.is_dir() {
        return Ok(direct_path);
    }

    // Scan all project folders for matching project.json ID
    if let Ok(entries) = std::fs::read_dir(captures_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let project_json = path.join("project.json");
                if project_json.exists() {
                    if let Ok(content) = std::fs::read_to_string(&project_json) {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                            if parsed.get("id").and_then(|v| v.as_str()) == Some(project_id) {
                                return Ok(path);
                            }
                        }
                    }
                }
            }
        }
    }

    Err(format!("Project folder not found for ID: {}", project_id).into())
}
