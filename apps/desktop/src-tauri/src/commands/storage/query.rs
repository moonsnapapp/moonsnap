//! Query and list operations for captures and projects.

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use moonsnap_core::error::MoonSnapResult;
use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter};
use tokio::fs as async_fs;

use super::{
    get_app_data_dir, get_captures_dir, get_saved_capture_lookup_for_path, SavedCaptureLookup,
};
use moonsnap_domain::storage::*;
use moonsnap_media::ffmpeg::{generate_gif_thumbnail, generate_video_thumbnail};

/// Process a single project directory into a CaptureListItem.
/// Returns None if the project can't be loaded.
async fn load_project_item(
    project_dir: PathBuf,
    captures_dir: PathBuf,
    thumbnails_dir: PathBuf,
) -> Option<CaptureListItem> {
    let project_file = project_dir.join("project.json");
    let content = async_fs::read_to_string(&project_file).await.ok()?;
    let project: CaptureProject = serde_json::from_str(&content).ok()?;

    // Skip metadata-only sidecars (created for video/media favorites/tags)
    if project.original_image.is_empty() {
        return None;
    }

    let thumbnail_path = thumbnails_dir
        .join(format!("{}_thumb.png", &project.id))
        .to_string_lossy()
        .to_string();

    // Resolve relative filenames against the user's save directory
    let original_path = PathBuf::from(&project.original_image);
    let image_path_buf = if original_path.is_absolute() {
        original_path
    } else {
        captures_dir.join(&project.original_image)
    };
    let image_path = image_path_buf.to_string_lossy().into_owned();

    // Check if the original image file exists
    let is_missing = !async_fs::try_exists(&image_path_buf).await.unwrap_or(false);

    Some(CaptureListItem {
        id: project.id,
        created_at: project.created_at,
        updated_at: project.updated_at,
        capture_type: project.capture_type,
        dimensions: project.dimensions,
        thumbnail_path,
        image_path,
        has_annotations: !project.annotations.is_empty(),
        tags: project.tags,
        favorite: project.favorite,
        quick_capture: false,
        is_missing,
        damaged: false,
    })
}

/// Process a video project folder into a CaptureListItem.
///
/// Video project folders contain:
///   - project.json (metadata)
///   - screen.mp4 (main recording)
///   - webcam.mp4 (optional)
///   - cursor.json (optional)
///
/// Returns None if the folder isn't a valid video project.
async fn load_video_project_folder(
    folder_path: PathBuf,
    thumbnails_dir: PathBuf,
    app: AppHandle,
) -> Option<CaptureListItem> {
    // Check if this is a video project folder
    let project_json = folder_path.join("project.json");
    let mut screen_mp4 = folder_path.join("screen.mp4");

    // If screen.mp4 is missing, scan for any .mp4 file (user may have renamed it).
    // Only auto-recover if exactly one .mp4 exists — multiple means we can't guess.
    let mut screen_mp4_meta = async_fs::metadata(&screen_mp4).await.ok();
    if screen_mp4_meta.is_none()
        || screen_mp4_meta
            .as_ref()
            .map(|m| m.len() == 0)
            .unwrap_or(true)
    {
        let mut found_mp4s: Vec<(PathBuf, std::fs::Metadata)> = Vec::new();
        if let Ok(mut entries) = async_fs::read_dir(&folder_path).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("mp4") && path.is_file() {
                    if let Ok(meta) = async_fs::metadata(&path).await {
                        if meta.len() > 0 {
                            found_mp4s.push((path, meta));
                        }
                    }
                }
            }
        }
        if found_mp4s.len() == 1 {
            let (path, meta) = found_mp4s.into_iter().next().unwrap();
            log::info!(
                "[RECOVERY] Found renamed video: {:?} (screen.mp4 missing)",
                path
            );
            screen_mp4 = path;
            screen_mp4_meta = Some(meta);
        }
    }

    let screen_ok = screen_mp4_meta
        .as_ref()
        .map(|m| m.len() > 0)
        .unwrap_or(false);

    if !screen_ok {
        return None;
    }
    let damaged = false;

    // Use folder name as fallback ID
    let fallback_id = folder_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("recording")
        .to_string();

    // Check for metadata sidecar in projects/{id}/project.json
    let base_dir = get_app_data_dir(&app).ok()?;
    let sidecar_path = base_dir
        .join("projects")
        .join(&fallback_id)
        .join("project.json");
    let (sidecar_tags, sidecar_favorite) =
        if async_fs::try_exists(&sidecar_path).await.unwrap_or(false) {
            if let Ok(content) = async_fs::read_to_string(&sidecar_path).await {
                if let Ok(project) = serde_json::from_str::<CaptureProject>(&content) {
                    (project.tags, project.favorite)
                } else {
                    (Vec::new(), false)
                }
            } else {
                (Vec::new(), false)
            }
        } else {
            (Vec::new(), false)
        };

    // Try to read metadata from project.json, fall back to file metadata
    let (created_at, updated_at, dimensions, json_tags, json_favorite, json_quick_capture) =
        if async_fs::try_exists(&project_json).await.unwrap_or(false) {
            if let Ok(content) = async_fs::read_to_string(&project_json).await {
                if let Ok(project) = serde_json::from_str::<serde_json::Value>(&content) {
                    let created = project
                        .get("createdAt")
                        .and_then(|v| v.as_str())
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(Utc::now);
                    let updated = project
                        .get("updatedAt")
                        .and_then(|v| v.as_str())
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or(created);
                    let dims = project
                        .get("sources")
                        .map(|s| Dimensions {
                            width: s.get("originalWidth").and_then(|v| v.as_u64()).unwrap_or(0)
                                as u32,
                            height: s
                                .get("originalHeight")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32,
                        })
                        .unwrap_or(Dimensions {
                            width: 0,
                            height: 0,
                        });
                    let tags: Vec<String> = project
                        .get("tags")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default();
                    let fav = project
                        .get("favorite")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let quick_capture = project
                        .get("quickCapture")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    (created, updated, dims, tags, fav, quick_capture)
                } else {
                    (
                        Utc::now(),
                        Utc::now(),
                        Dimensions {
                            width: 0,
                            height: 0,
                        },
                        Vec::new(),
                        false,
                        false,
                    )
                }
            } else {
                (
                    Utc::now(),
                    Utc::now(),
                    Dimensions {
                        width: 0,
                        height: 0,
                    },
                    Vec::new(),
                    false,
                    false,
                )
            }
        } else {
            // Fall back to folder metadata
            let metadata = async_fs::metadata(&folder_path).await.ok()?;
            let created = metadata
                .created()
                .or_else(|_| metadata.modified())
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(|_| Utc::now());
            let updated = metadata
                .modified()
                .map(DateTime::<Utc>::from)
                .unwrap_or(created);
            (
                created,
                updated,
                Dimensions {
                    width: 0,
                    height: 0,
                },
                Vec::new(),
                false,
                false,
            )
        };

    // Extract project ID from project.json, falling back to folder name
    let json_id: Option<String> = if async_fs::try_exists(&project_json).await.unwrap_or(false) {
        if let Ok(content) = async_fs::read_to_string(&project_json).await {
            serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|p| p.get("id").and_then(|v| v.as_str()).map(String::from))
        } else {
            None
        }
    } else {
        None
    };
    let id = json_id.unwrap_or(fallback_id);

    // Sidecar metadata (from projects/ dir) takes priority over video project.json
    let final_tags = if !sidecar_tags.is_empty() {
        sidecar_tags
    } else {
        json_tags
    };
    let final_favorite = sidecar_favorite || json_favorite;

    // Check/generate thumbnail
    let thumbnail_filename = format!("{}_thumb.png", &id);
    let thumbnail_path = thumbnails_dir.join(&thumbnail_filename);
    let thumb_exists = async_fs::try_exists(&thumbnail_path).await.unwrap_or(false);

    if !thumb_exists {
        let video_path = screen_mp4.clone();
        let thumb_path = thumbnail_path.clone();
        let capture_id = id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            match generate_video_thumbnail(&video_path, &thumb_path) {
                Ok(()) => {
                    log::debug!("[THUMB] Video project OK: {:?}", thumb_path);
                    // Emit event to notify frontend
                    let _ = app_clone.emit(
                        "thumbnail-ready",
                        ThumbnailReadyEvent {
                            capture_id,
                            thumbnail_path: thumb_path.to_string_lossy().into_owned(),
                        },
                    );
                },
                Err(e) => log::warn!("[THUMB] Video project FAILED: {}", e),
            }
        });
    }

    let thumbnail_path_str = if thumb_exists {
        thumbnail_path.to_string_lossy().into_owned()
    } else {
        String::new()
    };

    Some(CaptureListItem {
        id,
        created_at,
        updated_at,
        capture_type: "video".to_string(),
        dimensions,
        thumbnail_path: thumbnail_path_str,
        // Point to the video file inside the folder (used to load the video in editor)
        image_path: screen_mp4.to_string_lossy().into_owned(),
        has_annotations: false,
        tags: final_tags,
        favorite: final_favorite,
        quick_capture: json_quick_capture,
        is_missing: false,
        damaged,
    })
}

/// Process a single media file (GIF or legacy flat MP4) into a CaptureListItem.
/// Returns None if the file can't be processed.
///
/// Note: New MP4 recordings are stored in project folders, but we still support
/// legacy flat MP4 files for backward compatibility.
async fn load_media_item(
    path: PathBuf,
    thumbnails_dir: PathBuf,
    app: AppHandle,
) -> Option<CaptureListItem> {
    let metadata = async_fs::metadata(&path).await.ok()?;
    if !metadata.is_file() {
        return None;
    }

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())?;

    if extension != "mp4" && extension != "gif" {
        return None;
    }

    // Filter out auxiliary video editor files (webcam recordings, cursor data)
    // These are stored alongside the main recording but shouldn't appear in library
    let file_stem = path.file_stem().and_then(|n| n.to_str()).unwrap_or("");
    if file_stem.ends_with("_webcam") || file_stem.ends_with("_cursor") {
        return None;
    }

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("recording")
        .to_string();

    // Use file name as ID (without extension)
    let id = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(&file_name)
        .to_string();

    // Get creation/modification time
    let created_at = metadata
        .created()
        .or_else(|_| metadata.modified())
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(|_| Utc::now());

    let updated_at = metadata
        .modified()
        .map(DateTime::<Utc>::from)
        .unwrap_or(created_at);

    let capture_type = if extension == "gif" { "gif" } else { "video" };

    // Check thumbnail
    let thumbnail_filename = format!("{}_thumb.png", &id);
    let thumbnail_path = thumbnails_dir.join(&thumbnail_filename);
    let thumb_exists = async_fs::try_exists(&thumbnail_path).await.unwrap_or(false);

    if !thumb_exists {
        // Generate thumbnail in background to avoid blocking UI
        let video_path = path.clone();
        let thumb_path = thumbnail_path.clone();
        let is_gif = extension == "gif";
        let capture_id = id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let result = if is_gif {
                generate_gif_thumbnail(&video_path, &thumb_path)
            } else {
                generate_video_thumbnail(&video_path, &thumb_path)
            };
            match result {
                Ok(()) => {
                    log::debug!(
                        "[THUMB] {} OK: {:?}",
                        if is_gif { "GIF" } else { "Video" },
                        thumb_path
                    );
                    // Emit event to notify frontend
                    let _ = app_clone.emit(
                        "thumbnail-ready",
                        ThumbnailReadyEvent {
                            capture_id,
                            thumbnail_path: thumb_path.to_string_lossy().into_owned(),
                        },
                    );
                },
                Err(e) => log::warn!(
                    "[THUMB] {} FAILED: {}",
                    if is_gif { "GIF" } else { "Video" },
                    e
                ),
            }
        });
    }

    let thumbnail_path_str = if thumb_exists {
        thumbnail_path.to_string_lossy().into_owned()
    } else {
        String::new()
    };

    // Skip video dimension fetching on startup for faster load
    let dimensions = Dimensions {
        width: 0,
        height: 0,
    };

    // Check for metadata sidecar in projects/{id}/project.json
    let (sidecar_tags, sidecar_favorite) = if let Ok(base_dir) = get_app_data_dir(&app) {
        let sidecar_path = base_dir.join("projects").join(&id).join("project.json");
        if async_fs::try_exists(&sidecar_path).await.unwrap_or(false) {
            if let Ok(content) = async_fs::read_to_string(&sidecar_path).await {
                if let Ok(project) = serde_json::from_str::<CaptureProject>(&content) {
                    (project.tags, project.favorite)
                } else {
                    (Vec::new(), false)
                }
            } else {
                (Vec::new(), false)
            }
        } else {
            (Vec::new(), false)
        }
    } else {
        (Vec::new(), false)
    };

    Some(CaptureListItem {
        id,
        created_at,
        updated_at,
        capture_type: capture_type.to_string(),
        dimensions,
        thumbnail_path: thumbnail_path_str,
        image_path: path.to_string_lossy().into_owned(),
        has_annotations: false,
        tags: sidecar_tags,
        favorite: sidecar_favorite,
        quick_capture: capture_type == "video" || capture_type == "gif",
        is_missing: false,
        damaged: false,
    })
}

#[command]
pub async fn get_capture_list(app: AppHandle) -> MoonSnapResult<Vec<CaptureListItem>> {
    use futures::future::join_all;

    let base_dir = get_app_data_dir(&app)?;
    let projects_dir = base_dir.join("projects");
    let thumbnails_dir = base_dir.join("thumbnails");
    let captures_dir = get_captures_dir(&app)?;

    let mut captures: Vec<CaptureListItem> = Vec::new();

    // 1. Load screenshot projects in PARALLEL
    if async_fs::try_exists(&projects_dir).await.unwrap_or(false) {
        // First, collect all project directory paths
        let mut project_dirs: Vec<PathBuf> = Vec::new();
        let mut entries = async_fs::read_dir(&projects_dir)
            .await
            .map_err(|e| format!("Failed to read projects dir: {}", e))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read entry: {}", e))?
        {
            let path = entry.path();
            if path.is_dir() {
                project_dirs.push(path);
            }
        }

        // Process all projects in parallel
        let project_futures: Vec<_> = project_dirs
            .into_iter()
            .map(|dir| {
                let caps = captures_dir.clone();
                let thumbs = thumbnails_dir.clone();
                load_project_item(dir, caps, thumbs)
            })
            .collect();

        let project_results = join_all(project_futures).await;
        captures.extend(project_results.into_iter().flatten());
    }

    // 2. Scan for video project folders and GIF/legacy MP4 files in PARALLEL
    if async_fs::try_exists(&captures_dir).await.unwrap_or(false) {
        // Collect all entries, separating folders (potential video projects) from files
        let mut video_project_folders: Vec<PathBuf> = Vec::new();
        let mut media_files: Vec<PathBuf> = Vec::new();

        if let Ok(mut entries) = async_fs::read_dir(&captures_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    // Check if folder contains screen.mp4 (video project folder)
                    if path.join("screen.mp4").exists() {
                        video_project_folders.push(path);
                    }
                } else {
                    media_files.push(path);
                }
            }
        }

        // Process video project folders in parallel
        let folder_futures: Vec<_> = video_project_folders
            .into_iter()
            .map(|path| {
                let thumbs = thumbnails_dir.clone();
                let app_clone = app.clone();
                load_video_project_folder(path, thumbs, app_clone)
            })
            .collect();

        // Process media files (GIF and legacy MP4) in parallel
        let file_futures: Vec<_> = media_files
            .into_iter()
            .map(|path| {
                let thumbs = thumbnails_dir.clone();
                let app_clone = app.clone();
                load_media_item(path, thumbs, app_clone)
            })
            .collect();

        let folder_results = join_all(folder_futures).await;
        let file_results = join_all(file_futures).await;

        captures.extend(folder_results.into_iter().flatten());
        captures.extend(file_results.into_iter().flatten());
    }

    captures.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(captures)
}

#[command]
pub async fn get_project(app: AppHandle, project_id: String) -> MoonSnapResult<CaptureProject> {
    let base_dir = get_app_data_dir(&app)?;
    let project_file = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    if !project_file.exists() {
        return Err("Project not found".into());
    }

    let content = std::fs::read_to_string(&project_file)
        .map_err(|e| format!("Failed to read project: {}", e))?;

    let project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    Ok(project)
}

#[command]
pub async fn get_project_image(app: AppHandle, project_id: String) -> MoonSnapResult<String> {
    let base_dir = get_app_data_dir(&app)?;
    let project_file = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    if !project_file.exists() {
        return Err("Project not found".into());
    }

    let content = std::fs::read_to_string(&project_file)
        .map_err(|e| format!("Failed to read project: {}", e))?;

    let project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    // Resolve relative filenames against the user's save directory
    let captures_dir = get_captures_dir(&app)?;
    let original_path = PathBuf::from(&project.original_image);
    let image_path = if original_path.is_absolute() {
        original_path
    } else {
        captures_dir.join(&project.original_image)
    };

    let image_data =
        std::fs::read(&image_path).map_err(|e| format!("Failed to read image: {}", e))?;

    Ok(STANDARD.encode(&image_data))
}

#[command]
pub fn get_saved_capture_by_temp_path(file_path: String) -> Option<SavedCaptureLookup> {
    get_saved_capture_lookup_for_path(&file_path)
}

#[command]
pub fn get_library_folder(app: AppHandle) -> MoonSnapResult<String> {
    let captures_dir = get_captures_dir(&app)?;
    Ok(captures_dir.to_string_lossy().into_owned())
}
