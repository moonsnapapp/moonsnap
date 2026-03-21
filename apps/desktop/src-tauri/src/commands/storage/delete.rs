//! Delete operations for projects and captures.

use moonsnap_core::error::MoonSnapResult;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use super::{find_project_bundle, get_app_data_dir, get_captures_dir};
use moonsnap_domain::storage::*;

pub(crate) fn resolve_capture_project_image_path(
    project_file: &Path,
    captures_dir: &Path,
) -> Option<PathBuf> {
    let content = fs::read_to_string(project_file).ok()?;
    let project = serde_json::from_str::<CaptureProject>(&content).ok()?;

    // Video/media sidecars use an empty original_image and should not be treated as screenshot projects.
    if project.original_image.is_empty() {
        return None;
    }

    let original_path = PathBuf::from(&project.original_image);
    let image_path = if original_path.is_absolute() {
        original_path
    } else {
        captures_dir.join(&project.original_image)
    };

    Some(image_path)
}

fn delete_project_metadata_dir(base_dir: &Path, project_id: &str) -> MoonSnapResult<()> {
    let project_dir = base_dir.join("projects").join(project_id);
    if project_dir.exists() {
        fs::remove_dir_all(&project_dir)
            .map_err(|e| format!("Failed to delete project metadata: {}", e))?;
    }

    Ok(())
}

/// Determines the type of capture based on its ID and returns the appropriate file path.
/// Returns (capture_type, file_path) where capture_type is:
///   - "project": Screenshot project (in app_data/projects/)
///   - "video_folder": Video project folder (in captures_dir/)
///   - "video": Legacy flat MP4 file (in captures_dir/)
///   - "gif": GIF file (in captures_dir/)
///   - "metadata": Metadata-only sidecar (in app_data/projects/)
///   - "unknown": Not found
fn determine_capture_type(
    app: &tauri::AppHandle,
    project_id: &str,
) -> MoonSnapResult<(String, Option<PathBuf>)> {
    let base_dir = get_app_data_dir(app)?;
    let captures_dir = get_captures_dir(app)?;

    // 1. Check if it's a screenshot project (has project.json in app_data/projects/)
    let project_dir = base_dir.join("projects").join(project_id);
    let project_file = project_dir.join("project.json");
    if project_file.exists() {
        if let Some(image_path) = resolve_capture_project_image_path(&project_file, &captures_dir) {
            return Ok(("project".to_string(), Some(image_path)));
        }
    }

    // 2. Check if it's a video project folder. Video project IDs live inside project.json,
    // so the folder name and the project ID are not guaranteed to match.
    if let Ok(video_folder) = find_project_bundle(&captures_dir, project_id) {
        return Ok(("video_folder".to_string(), Some(video_folder)));
    }

    // 3. Check if it's a legacy flat video file (.mp4)
    let video_path = captures_dir.join(format!("{}.mp4", project_id));
    if video_path.exists() {
        return Ok(("video".to_string(), Some(video_path)));
    }

    // 4. Check if it's a GIF file
    let gif_path = captures_dir.join(format!("{}.gif", project_id));
    if gif_path.exists() {
        return Ok(("gif".to_string(), Some(gif_path)));
    }

    // 5. Metadata-only sidecars can remain after a broken import or missing media file.
    if project_file.exists() {
        return Ok(("metadata".to_string(), Some(project_dir)));
    }

    // Unknown type - might be already deleted or invalid ID
    Ok(("unknown".to_string(), None))
}

#[command]
pub async fn delete_project(app: tauri::AppHandle, project_id: String) -> MoonSnapResult<()> {
    let base_dir = get_app_data_dir(&app)?;
    let captures_dir = get_captures_dir(&app)?;

    // Determine what type of capture this is
    let (capture_type, file_path) = determine_capture_type(&app, &project_id)?;

    match capture_type.as_str() {
        "project" => {
            // Screenshot project - delete original image, project dir, and thumbnail
            if let Some(image_path) = file_path {
                let _ = fs::remove_file(image_path);
            }

            delete_project_metadata_dir(&base_dir, &project_id)?;
        },
        "video_folder" => {
            // Video project folder - delete the entire folder and all its contents
            // This removes screen.mp4, webcam.mp4, cursor.json, project.json, etc.
            if let Some(folder_path) = file_path {
                if folder_path.exists() {
                    fs::remove_dir_all(&folder_path)
                        .map_err(|e| format!("Failed to delete video project folder: {}", e))?;
                    log::info!("[DELETE] Removed video project folder: {:?}", folder_path);
                }
            }
            delete_project_metadata_dir(&base_dir, &project_id)?;
        },
        "video" => {
            // Legacy flat MP4 file - delete main file and any associated files
            if let Some(video_path) = file_path {
                fs::remove_file(&video_path)
                    .map_err(|e| format!("Failed to delete video file: {}", e))?;

                // Also try to delete associated legacy files (_webcam.mp4, _cursor.json, etc.)
                let stem = video_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let parent = video_path.parent().unwrap_or(&captures_dir);

                // Try to delete associated files (don't error if they don't exist)
                let _ = fs::remove_file(parent.join(format!("{}_webcam.mp4", stem)));
                let _ = fs::remove_file(parent.join(format!("{}_cursor.json", stem)));
                let _ = fs::remove_file(parent.join(format!("{}_system.wav", stem)));
                let _ = fs::remove_file(parent.join(format!("{}_mic.wav", stem)));
                // Also remove legacy .moonsnap sidecar if present
                let _ = fs::remove_file(parent.join(format!("{}.moonsnap", stem)));
            }
            delete_project_metadata_dir(&base_dir, &project_id)?;
        },
        "gif" => {
            // GIF file - just delete the file
            if let Some(gif_path) = file_path {
                fs::remove_file(&gif_path)
                    .map_err(|e| format!("Failed to delete GIF file: {}", e))?;
            }
            delete_project_metadata_dir(&base_dir, &project_id)?;
        },
        "metadata" => {
            delete_project_metadata_dir(&base_dir, &project_id)?;
        },
        _ => {
            // Unknown type - nothing to delete, but don't error
            // The item might have already been deleted
        },
    }

    // Always try to delete the thumbnail (common to all types)
    let thumbnail_path = base_dir
        .join("thumbnails")
        .join(format!("{}_thumb.png", &project_id));
    let _ = fs::remove_file(thumbnail_path);

    // Clean up any empty directories in captures folder
    cleanup_empty_directories(&captures_dir);

    Ok(())
}

/// Remove empty directories in the given path (non-recursive into subdirs, just cleans immediate children)
fn cleanup_empty_directories(dir: &std::path::Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check if directory is empty
                if let Ok(mut contents) = fs::read_dir(&path) {
                    if contents.next().is_none() {
                        // Directory is empty, remove it
                        if let Err(e) = fs::remove_dir(&path) {
                            log::debug!("[CLEANUP] Failed to remove empty dir {:?}: {}", path, e);
                        } else {
                            log::debug!("[CLEANUP] Removed empty directory: {:?}", path);
                        }
                    }
                }
            }
        }
    }
}

#[command]
pub async fn delete_projects(
    app: tauri::AppHandle,
    project_ids: Vec<String>,
) -> MoonSnapResult<()> {
    for id in project_ids {
        delete_project(app.clone(), id).await?;
    }

    // Final cleanup pass after bulk deletion
    if let Ok(captures_dir) = get_captures_dir(&app) {
        cleanup_empty_directories(&captures_dir);
    }

    Ok(())
}
