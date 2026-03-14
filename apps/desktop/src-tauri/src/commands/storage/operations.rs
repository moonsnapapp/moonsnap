//! Tauri command handlers for storage operations.

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use image::{DynamicImage, GenericImageView};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::{command, AppHandle, Emitter};
use tokio::fs as async_fs;

use super::{
    calculate_dir_size, ensure_directories, generate_id, get_app_data_dir, get_captures_dir,
};
use moonsnap_domain::storage::*;
use moonsnap_media::ffmpeg::{
    find_ffmpeg, find_ffprobe, generate_gif_thumbnail, generate_thumbnail,
    generate_video_thumbnail, get_video_metadata_for_migration,
};

static SAVED_CAPTURE_LOOKUPS: LazyLock<Mutex<HashMap<String, SavedCaptureLookup>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCaptureLookup {
    pub project_id: String,
    pub image_path: String,
}

fn remember_saved_capture_lookup(original_path: &str, project_id: &str, image_path: &str) {
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

fn get_saved_capture_lookup_for_path(path: &str) -> Option<SavedCaptureLookup> {
    SAVED_CAPTURE_LOOKUPS
        .lock()
        .ok()
        .and_then(|lookups| lookups.get(path).cloned())
}

// ============================================================================
// Save Operations
// ============================================================================

#[command]
pub async fn save_capture(
    app: AppHandle,
    request: SaveCaptureRequest,
) -> Result<SaveCaptureResponse, String> {
    let base_dir = ensure_directories(&app)?;
    let captures_dir = get_captures_dir(&app)?;
    let id = generate_id();
    let now = Utc::now();

    let decoded = STANDARD
        .decode(&request.image_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let image =
        image::load_from_memory(&decoded).map_err(|e| format!("Failed to load image: {}", e))?;

    let (width, height) = image.dimensions();

    let date_str = now.format("%Y-%m-%d_%H%M%S").to_string();
    let original_filename = format!("moonsnap_{}_{}.png", date_str, &id);
    let thumbnail_filename = format!("{}_thumb.png", &id);

    // Save original image to user's configured directory
    let original_path = captures_dir.join(&original_filename);
    image
        .save(&original_path)
        .map_err(|e| format!("Failed to save image: {}", e))?;

    // Generate and save thumbnail (always in app data dir)
    let thumbnail = generate_thumbnail(&image)?;
    let thumbnails_dir = base_dir.join("thumbnails");
    let thumbnail_path = thumbnails_dir.join(&thumbnail_filename);
    thumbnail
        .save(&thumbnail_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Create project data - store relative filename only
    let project = CaptureProject {
        id: id.clone(),
        created_at: now,
        updated_at: now,
        capture_type: request.capture_type,
        source: request.source,
        original_image: original_filename.clone(),
        dimensions: Dimensions { width, height },
        annotations: Vec::new(),
        tags: Vec::new(),
        favorite: false,
    };

    // Save project file
    let projects_dir = base_dir.join("projects");
    let project_dir = projects_dir.join(&id);
    fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create project dir: {}", e))?;

    let project_file = project_dir.join("project.json");
    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project file: {}", e))?;

    Ok(SaveCaptureResponse {
        id,
        project,
        thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
        image_path: original_path.to_string_lossy().to_string(),
    })
}

/// Fast save capture from RGBA file path - skips base64 encoding/decoding
#[command]
pub async fn save_capture_from_file(
    app: AppHandle,
    file_path: String,
    width: u32,
    height: u32,
    capture_type: String,
    source: CaptureSource,
) -> Result<SaveCaptureResponse, String> {
    let base_dir = ensure_directories(&app)?;
    let captures_dir = get_captures_dir(&app)?;
    let id = generate_id();
    let now = Utc::now();

    // Read RGBA file - skip 8-byte header (width + height stored in file)
    use std::io::Read;
    let mut file =
        fs::File::open(&file_path).map_err(|e| format!("Failed to open RGBA file: {}", e))?;

    // Skip the 8-byte header (4 bytes width + 4 bytes height)
    let mut header = [0u8; 8];
    file.read_exact(&mut header)
        .map_err(|e| format!("Failed to read header: {}", e))?;

    // Read RGBA data
    let expected_size = (width * height * 4) as usize;
    let mut rgba_data = vec![0u8; expected_size];
    file.read_exact(&mut rgba_data)
        .map_err(|e| format!("Failed to read RGBA data: {}", e))?;

    // Create image from RGBA data
    let image: DynamicImage = image::RgbaImage::from_raw(width, height, rgba_data)
        .ok_or_else(|| "Failed to create image from RGBA data".to_string())?
        .into();

    let date_str = now.format("%Y-%m-%d_%H%M%S").to_string();
    let original_filename = format!("moonsnap_{}_{}.png", date_str, &id);
    let thumbnail_filename = format!("{}_thumb.png", &id);

    // Save original image to user's configured directory
    let original_path = captures_dir.join(&original_filename);
    image
        .save(&original_path)
        .map_err(|e| format!("Failed to save image: {}", e))?;

    // Generate and save thumbnail (always in app data dir)
    let thumbnail = generate_thumbnail(&image)?;
    let thumbnails_dir = base_dir.join("thumbnails");
    let thumbnail_path = thumbnails_dir.join(&thumbnail_filename);
    thumbnail
        .save(&thumbnail_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Create project data - store relative filename only
    let project = CaptureProject {
        id: id.clone(),
        created_at: now,
        updated_at: now,
        capture_type,
        source,
        original_image: original_filename.clone(),
        dimensions: Dimensions { width, height },
        annotations: Vec::new(),
        tags: Vec::new(),
        favorite: false,
    };

    // Save project file
    let projects_dir = base_dir.join("projects");
    let project_dir = projects_dir.join(&id);
    fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create project dir: {}", e))?;

    let project_file = project_dir.join("project.json");
    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project file: {}", e))?;

    let image_path = original_path.to_string_lossy().to_string();
    remember_saved_capture_lookup(&file_path, &id, &image_path);

    Ok(SaveCaptureResponse {
        id,
        project,
        thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
        image_path,
    })
}

/// Import an image from a file path (used for drag-drop import)
#[command]
pub async fn import_image_from_path(
    app: AppHandle,
    file_path: String,
) -> Result<SaveCaptureResponse, String> {
    let path = PathBuf::from(&file_path);

    // Verify file exists and is an image
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let valid_extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
    if !valid_extensions.contains(&extension.as_str()) {
        return Err(format!("Unsupported image format: {}", extension));
    }

    // Load image directly from file
    let image = image::open(&path).map_err(|e| format!("Failed to load image: {}", e))?;

    let (width, height) = image.dimensions();

    let base_dir = ensure_directories(&app)?;
    let captures_dir = get_captures_dir(&app)?;
    let id = generate_id();
    let now = Utc::now();

    let date_str = now.format("%Y-%m-%d_%H%M%S").to_string();
    let original_filename = format!("moonsnap_{}_{}.png", date_str, &id);
    let thumbnail_filename = format!("{}_thumb.png", &id);

    // Save as PNG to user's configured directory
    let original_path = captures_dir.join(&original_filename);
    image
        .save(&original_path)
        .map_err(|e| format!("Failed to save image: {}", e))?;

    // Generate and save thumbnail
    let thumbnail = generate_thumbnail(&image)?;
    let thumbnails_dir = base_dir.join("thumbnails");
    let thumbnail_path = thumbnails_dir.join(&thumbnail_filename);
    thumbnail
        .save(&thumbnail_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Create project data
    let project = CaptureProject {
        id: id.clone(),
        created_at: now,
        updated_at: now,
        capture_type: "import".to_string(),
        source: CaptureSource {
            monitor: None,
            window_id: None,
            window_title: None,
            region: None,
        },
        original_image: original_filename.clone(),
        dimensions: Dimensions { width, height },
        annotations: Vec::new(),
        tags: Vec::new(),
        favorite: false,
    };

    // Save project file
    let projects_dir = base_dir.join("projects");
    let project_dir = projects_dir.join(&id);
    fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create project dir: {}", e))?;

    let project_file = project_dir.join("project.json");
    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project file: {}", e))?;

    Ok(SaveCaptureResponse {
        id,
        project,
        thumbnail_path: thumbnail_path.to_string_lossy().to_string(),
        image_path: original_path.to_string_lossy().to_string(),
    })
}

// ============================================================================
// Update Operations
// ============================================================================

#[command]
pub async fn update_project_annotations(
    app: AppHandle,
    project_id: String,
    annotations: Vec<Annotation>,
) -> Result<CaptureProject, String> {
    let base_dir = get_app_data_dir(&app)?;
    let project_file = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    if !project_file.exists() {
        return Err("Project not found".to_string());
    }

    let content =
        fs::read_to_string(&project_file).map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    project.annotations = annotations;
    project.updated_at = Utc::now();

    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;

    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project: {}", e))?;

    Ok(project)
}

#[command]
pub async fn update_project_metadata(
    app: AppHandle,
    project_id: String,
    tags: Option<Vec<String>>,
    favorite: Option<bool>,
) -> Result<CaptureProject, String> {
    let base_dir = get_app_data_dir(&app)?;

    // Use projects/{id}/project.json for all metadata
    let projects_path = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    let project_file = if projects_path.exists() {
        projects_path
    } else {
        // No project.json exists (e.g. legacy media file) — create one in projects/
        let project_dir = base_dir.join("projects").join(&project_id);
        fs::create_dir_all(&project_dir)
            .map_err(|e| format!("Failed to create project dir: {}", e))?;

        let now = Utc::now();
        let project = CaptureProject {
            id: project_id.clone(),
            created_at: now,
            updated_at: now,
            capture_type: "video".to_string(),
            source: CaptureSource {
                monitor: None,
                window_id: None,
                window_title: None,
                region: None,
            },
            original_image: String::new(),
            dimensions: Dimensions {
                width: 0,
                height: 0,
            },
            annotations: Vec::new(),
            tags: tags.clone().unwrap_or_default(),
            favorite: favorite.unwrap_or(false),
        };

        let json = serde_json::to_string_pretty(&project)
            .map_err(|e| format!("Failed to serialize project: {}", e))?;
        let path = project_dir.join("project.json");
        fs::write(&path, json).map_err(|e| format!("Failed to write project: {}", e))?;

        return Ok(project);
    };

    let content =
        fs::read_to_string(&project_file).map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    if let Some(t) = tags {
        project.tags = t;
    }
    if let Some(f) = favorite {
        project.favorite = f;
    }
    project.updated_at = Utc::now();

    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project: {}", e))?;

    Ok(project)
}

// ============================================================================
// Query Operations
// ============================================================================

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
    let image_path = image_path_buf.to_string_lossy().to_string();

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
                .map(|t| DateTime::<Utc>::from(t))
                .unwrap_or_else(|_| Utc::now());
            let updated = metadata
                .modified()
                .map(|t| DateTime::<Utc>::from(t))
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
                            thumbnail_path: thumb_path.to_string_lossy().to_string(),
                        },
                    );
                },
                Err(e) => log::warn!("[THUMB] Video project FAILED: {}", e),
            }
        });
    }

    let thumbnail_path_str = if thumb_exists {
        thumbnail_path.to_string_lossy().to_string()
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
        image_path: screen_mp4.to_string_lossy().to_string(),
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
        .map(|t| DateTime::<Utc>::from(t))
        .unwrap_or_else(|_| Utc::now());

    let updated_at = metadata
        .modified()
        .map(|t| DateTime::<Utc>::from(t))
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
                            thumbnail_path: thumb_path.to_string_lossy().to_string(),
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
        thumbnail_path.to_string_lossy().to_string()
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
        image_path: path.to_string_lossy().to_string(),
        has_annotations: false,
        tags: sidecar_tags,
        favorite: sidecar_favorite,
        quick_capture: capture_type == "video" || capture_type == "gif",
        is_missing: false,
        damaged: false,
    })
}

#[command]
pub async fn get_capture_list(app: AppHandle) -> Result<Vec<CaptureListItem>, String> {
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
pub async fn get_project(app: AppHandle, project_id: String) -> Result<CaptureProject, String> {
    let base_dir = get_app_data_dir(&app)?;
    let project_file = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    if !project_file.exists() {
        return Err("Project not found".to_string());
    }

    let content =
        fs::read_to_string(&project_file).map_err(|e| format!("Failed to read project: {}", e))?;

    let project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    Ok(project)
}

#[command]
pub async fn get_project_image(app: AppHandle, project_id: String) -> Result<String, String> {
    let base_dir = get_app_data_dir(&app)?;
    let project_file = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    if !project_file.exists() {
        return Err("Project not found".to_string());
    }

    let content =
        fs::read_to_string(&project_file).map_err(|e| format!("Failed to read project: {}", e))?;

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

    let image_data = fs::read(&image_path).map_err(|e| format!("Failed to read image: {}", e))?;

    Ok(STANDARD.encode(&image_data))
}

#[command]
pub fn get_saved_capture_by_temp_path(file_path: String) -> Option<SavedCaptureLookup> {
    get_saved_capture_lookup_for_path(&file_path)
}

#[command]
pub fn get_library_folder(app: AppHandle) -> Result<String, String> {
    let captures_dir = get_captures_dir(&app)?;
    Ok(captures_dir.to_string_lossy().to_string())
}

// ============================================================================
// Delete Operations
// ============================================================================

fn resolve_capture_project_image_path(project_file: &Path, captures_dir: &Path) -> Option<PathBuf> {
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

fn delete_project_metadata_dir(base_dir: &Path, project_id: &str) -> Result<(), String> {
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
    app: &AppHandle,
    project_id: &str,
) -> Result<(String, Option<PathBuf>), String> {
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
pub async fn delete_project(app: AppHandle, project_id: String) -> Result<(), String> {
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
pub async fn delete_projects(app: AppHandle, project_ids: Vec<String>) -> Result<(), String> {
    for id in project_ids {
        delete_project(app.clone(), id).await?;
    }

    // Final cleanup pass after bulk deletion
    if let Ok(captures_dir) = get_captures_dir(&app) {
        cleanup_empty_directories(&captures_dir);
    }

    Ok(())
}

// ============================================================================
// Export Operations
// ============================================================================

#[command]
pub async fn export_project(
    app: AppHandle,
    project_id: String,
    rendered_image_data: String,
    file_path: String,
    format: String,
) -> Result<(), String> {
    let decoded = STANDARD
        .decode(&rendered_image_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let image =
        image::load_from_memory(&decoded).map_err(|e| format!("Failed to load image: {}", e))?;

    let img_format = match format.to_lowercase().as_str() {
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "webp" => image::ImageFormat::WebP,
        _ => image::ImageFormat::Png,
    };

    image
        .save_with_format(&file_path, img_format)
        .map_err(|e| format!("Failed to save image: {}", e))?;

    // Save a copy in the project folder
    let base_dir = get_app_data_dir(&app)?;
    let edited_path = base_dir
        .join("projects")
        .join(&project_id)
        .join("edited.png");

    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode image: {}", e))?;
    fs::write(&edited_path, buffer.get_ref())
        .map_err(|e| format!("Failed to save edited copy: {}", e))?;

    Ok(())
}

// ============================================================================
// Stats and Utility Operations
// ============================================================================

#[command]
pub async fn get_storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let base_dir = get_app_data_dir(&app)?;

    let mut total_size: u64 = 0;
    let mut capture_count: u32 = 0;

    let projects_dir = base_dir.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    capture_count += 1;
                }
            }
        }
    }

    for dir in ["captures", "projects", "thumbnails"] {
        let path = base_dir.join(dir);
        if path.exists() {
            total_size += calculate_dir_size(&path);
        }
    }

    Ok(StorageStats {
        total_size_bytes: total_size,
        total_size_mb: total_size as f64 / (1024.0 * 1024.0),
        capture_count,
        storage_path: base_dir.to_string_lossy().to_string(),
    })
}

/// Ensure ffmpeg is available for video thumbnail generation.
/// Downloads if not already cached.
#[command]
pub async fn ensure_ffmpeg() -> Result<bool, String> {
    // Check if ffmpeg is already available
    if find_ffmpeg().is_some() {
        log::info!("ffmpeg already available");
        return Ok(true);
    }

    // Try to download ffmpeg in background
    log::info!("ffmpeg not found, attempting download...");
    match ffmpeg_sidecar::download::auto_download() {
        Ok(()) => {
            log::info!("ffmpeg downloaded successfully");
            Ok(true)
        },
        Err(e) => {
            log::warn!("Failed to download ffmpeg: {:?}", e);
            Ok(false)
        },
    }
}

// ============================================================================
// Migration and Cleanup Operations
// ============================================================================

/// Startup cleanup: ensure directories exist, remove orphan temp files,
/// migrate legacy video files to folder structure, and regenerate missing thumbnails.
/// Returns immediately and runs heavy work in background thread to avoid blocking UI
#[command]
pub async fn startup_cleanup(app: AppHandle) -> Result<StartupCleanupResult, String> {
    // 0. Pre-create storage directories so first capture isn't slow (fast, do sync)
    ensure_directories(&app)?;

    // Also pre-create the user's save directory (~/MoonSnap or custom)
    let captures_dir = get_captures_dir(&app)?;

    // Get paths for background work
    let base_dir = get_app_data_dir(&app)?;
    let projects_dir = base_dir.join("projects");
    let thumbnails_dir = base_dir.join("thumbnails");
    let temp_dir = std::env::temp_dir();

    // Spawn background thread for heavy cleanup work (don't block UI)
    std::thread::spawn(move || {
        let mut temp_files_cleaned = 0;
        let mut thumbnails_regenerated = 0;
        let mut videos_migrated = 0;

        // 1. Clean up orphan RGBA temp files
        if let Ok(entries) = fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with("moonsnap_capture_") && name.ends_with(".rgba") {
                        if fs::remove_file(&path).is_ok() {
                            temp_files_cleaned += 1;
                        }
                    }
                }
            }
        }

        // 2. Migrate legacy flat MP4 files to folder structure
        if captures_dir.exists() {
            if let Ok(entries) = fs::read_dir(&captures_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();

                    // Skip directories and non-MP4 files
                    if !path.is_file() {
                        continue;
                    }
                    let extension = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase())
                        .unwrap_or_default();
                    if extension != "mp4" {
                        continue;
                    }

                    // Skip auxiliary files (webcam, etc.)
                    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    if stem.ends_with("_webcam") || stem.ends_with("_cursor") {
                        continue;
                    }

                    // Migrate this MP4 to folder structure
                    if let Err(e) = migrate_legacy_video(&path, &captures_dir, &thumbnails_dir) {
                        log::warn!("Failed to migrate video {:?}: {}", path, e);
                    } else {
                        videos_migrated += 1;
                    }
                }
            }
        }

        // 3. Regenerate missing thumbnails for screenshot projects
        if projects_dir.exists() {
            if let Ok(entries) = fs::read_dir(&projects_dir) {
                for entry in entries.flatten() {
                    let project_dir = entry.path();
                    if !project_dir.is_dir() {
                        continue;
                    }

                    let project_id = project_dir
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    let thumbnail_path = thumbnails_dir.join(format!("{}_thumb.png", &project_id));

                    // Check if thumbnail is missing
                    if !thumbnail_path.exists() {
                        // Try to read project.json to get the original image path
                        let project_file = project_dir.join("project.json");
                        if let Ok(content) = fs::read_to_string(&project_file) {
                            if let Ok(project) = serde_json::from_str::<CaptureProject>(&content) {
                                // Try to regenerate thumbnail from original image
                                let original_path = PathBuf::from(&project.original_image);
                                let original_path = if original_path.is_absolute() {
                                    original_path
                                } else {
                                    captures_dir.join(&project.original_image)
                                };
                                if original_path.exists() {
                                    if let Ok(image) = image::open(&original_path) {
                                        if let Ok(thumbnail) = generate_thumbnail(&image) {
                                            if thumbnail.save(&thumbnail_path).is_ok() {
                                                thumbnails_regenerated += 1;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        log::debug!(
            "Startup cleanup: {} temp files, {} thumbnails, {} videos migrated",
            temp_files_cleaned,
            thumbnails_regenerated,
            videos_migrated
        );
    });

    // Return immediately - cleanup runs in background
    Ok(StartupCleanupResult {
        temp_files_cleaned: 0, // Actual count determined in background
        thumbnails_regenerated: 0,
    })
}

/// Migrate a legacy flat MP4 video to the new folder structure.
///
/// Converts: recording_123456.mp4 + recording_123456_webcam.mp4 + recording_123456_cursor.json
/// Into: recording_123456/screen.mp4 + webcam.mp4 + cursor.json + project.json
fn migrate_legacy_video(
    video_path: &PathBuf,
    captures_dir: &PathBuf,
    thumbnails_dir: &PathBuf,
) -> Result<(), String> {
    let stem = video_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid video path")?
        .to_string();
    let original_file_name = video_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid video filename")?
        .to_string();

    // Create the project folder
    let folder_path = captures_dir.join(&stem);
    if folder_path.exists() {
        // Already migrated or folder exists with same name
        return Ok(());
    }

    fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create project folder: {}", e))?;

    // Move main video to screen.mp4
    let screen_path = folder_path.join("screen.mp4");
    fs::rename(video_path, &screen_path)
        .map_err(|e| format!("Failed to move main video: {}", e))?;

    // Move associated files if they exist
    let webcam_src = captures_dir.join(format!("{}_webcam.mp4", stem));
    if webcam_src.exists() {
        let _ = fs::rename(&webcam_src, folder_path.join("webcam.mp4"));
    }

    let cursor_src = captures_dir.join(format!("{}_cursor.json", stem));
    if cursor_src.exists() {
        let _ = fs::rename(&cursor_src, folder_path.join("cursor.json"));
    }

    let system_src = captures_dir.join(format!("{}_system.wav", stem));
    if system_src.exists() {
        let _ = fs::rename(&system_src, folder_path.join("system.wav"));
    }

    let mic_src = captures_dir.join(format!("{}_mic.wav", stem));
    if mic_src.exists() {
        let _ = fs::rename(&mic_src, folder_path.join("mic.wav"));
    }

    // Get video metadata using ffprobe if available
    let (width, height, duration_ms, fps) = if let Some(ffprobe) = find_ffprobe() {
        get_video_metadata_for_migration(&ffprobe, &screen_path).unwrap_or((0, 0, 0, 30))
    } else {
        (0, 0, 0, 30)
    };

    // Create project.json
    // Note: For quick capture videos with embedded audio, we intentionally leave
    // systemAudio as null — the <video> element plays its own embedded audio.
    // Setting systemAudio to "screen.mp4" would create a redundant <audio> element
    // loading the same file, causing triple asset protocol load and UI hangs.
    let has_system_audio = folder_path.join("system.wav").exists();
    let project = create_migration_project_json(
        &stem,
        &original_file_name,
        width,
        height,
        duration_ms,
        fps,
        &folder_path,
        has_system_audio,
    );
    let project_file = folder_path.join("project.json");
    fs::write(&project_file, project)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;

    // Rename thumbnail if it exists (from stem_thumb.png to new folder ID)
    let old_thumb = thumbnails_dir.join(format!("{}_thumb.png", stem));
    if old_thumb.exists() {
        // Thumbnail ID stays the same (folder name = old stem)
        // No need to rename, just keep it
    }

    log::info!(
        "[MIGRATION] Migrated legacy video: {} -> {:?}",
        stem,
        folder_path
    );

    Ok(())
}

/// Create a minimal project.json for a migrated video.
fn create_migration_project_json(
    id: &str,
    original_file_name: &str,
    width: u32,
    height: u32,
    duration_ms: u64,
    fps: u32,
    folder_path: &PathBuf,
    has_system_audio_file: bool,
) -> String {
    let now = chrono::Utc::now().to_rfc3339();
    let has_webcam = folder_path.join("webcam.mp4").exists();
    let has_cursor = folder_path.join("cursor.json").exists();

    // System audio: only set when a separate WAV file exists (editor flow).
    // Quick capture videos have audio muxed into screen.mp4 — leave null so
    // the <video> element plays its own embedded audio directly.
    let system_audio: Option<&str> = if has_system_audio_file {
        Some("system.wav")
    } else {
        None
    };

    // Use serde_json to create a proper VideoProject-compatible JSON
    let sources = serde_json::json!({
        "screenVideo": "screen.mp4",
        "webcamVideo": if has_webcam { Some("webcam.mp4") } else { None::<&str> },
        "cursorData": if has_cursor { Some("cursor.json") } else { None::<&str> },
        "audioFile": null,
        "systemAudio": system_audio,
        "microphoneAudio": null,
        "backgroundMusic": null,
        "originalWidth": width,
        "originalHeight": height,
        "durationMs": duration_ms,
        "fps": fps
    });

    let project = serde_json::json!({
        "id": format!("proj_migrated_{}", id),
        "createdAt": now,
        "updatedAt": now,
        "name": id,
        "originalFileName": original_file_name,
        "quickCapture": true,
        "sources": sources,
        "timeline": {
            "durationMs": duration_ms,
            "inPoint": 0,
            "outPoint": duration_ms,
            "speed": 1.0
        },
        "zoom": {
            "mode": "auto",
            "autoZoomScale": 2.0,
            "regions": []
        },
        "cursor": {
            "visible": true,
            "cursorType": "auto",
            "scale": 1.0,
            "dampening": 0.5,
            "motionBlur": 0.0,
            "clickHighlight": {
                "enabled": true,
                "color": "#FF6B6B",
                "radius": 30,
                "durationMs": 400,
                "style": "ripple"
            },
            "hideWhenIdle": false,
            "idleTimeoutMs": 3000
        },
        "webcam": {
            "enabled": has_webcam,
            "position": "bottomRight",
            "customX": 0.95,
            "customY": 0.95,
            "size": 0.2,
            "shape": "circle",
            "rounding": 100.0,
            "cornerStyle": "squircle",
            "shadow": 62.5,
            "shadowConfig": { "size": 33.9, "opacity": 44.2, "blur": 10.5 },
            "mirror": false,
            "border": { "enabled": false, "width": 3, "color": "#FFFFFF" },
            "visibilitySegments": []
        },
        "audio": {
            "systemVolume": 1.0,
            "microphoneVolume": 0.9,
            "musicVolume": 0.25,
            "musicFadeInSecs": 2.0,
            "musicFadeOutSecs": 3.0,
            "normalizeOutput": true,
            "systemMuted": false,
            "microphoneMuted": false,
            "musicMuted": false
        },
        "export": {
            "format": "mp4",
            "quality": 80,
            "fps": 30,
            "background": {
                "enabled": false,
                "bgType": "wallpaper",
                "solidColor": "#000000",
                "gradientStart": "#1a1a2e",
                "gradientEnd": "#16213e",
                "gradientAngle": 135.0,
                "wallpaper": "macOS/sequoia-dark"
            }
        },
        "scene": {
            "segments": [],
            "defaultMode": "default"
        },
        "text": {
            "segments": []
        }
    });

    serde_json::to_string_pretty(&project).unwrap_or_else(|_| "{}".to_string())
}

// ============================================================================
// Repair Operations
// ============================================================================

/// Find the bundle folder for a given project_id.
/// Find a project folder by project ID.
fn find_project_bundle(
    captures_dir: &std::path::Path,
    project_id: &str,
) -> Result<std::path::PathBuf, String> {
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

    Err(format!("Project folder not found for ID: {}", project_id))
}

/// Repair a damaged project bundle by re-linking a video file.
///
/// Steps:
/// 1. Move (or copy+delete) the selected video file into the bundle as `screen.mp4`
/// 2. Re-extract metadata via ffprobe and update `project.json`
/// 3. Set the Hidden attribute on the new file (Windows)
#[command]
pub async fn repair_project(
    app: AppHandle,
    project_id: String,
    new_video_path: String,
) -> Result<(), String> {
    let captures_dir = get_captures_dir(&app)?;
    let bundle_path = find_project_bundle(&captures_dir, &project_id)?;

    let target = bundle_path.join("screen.mp4");
    let source = std::path::Path::new(&new_video_path);

    if !source.exists() {
        return Err("Selected video file does not exist".to_string());
    }

    // Move the file into the bundle (try rename first, fall back to copy+delete for cross-device)
    std::fs::rename(source, &target)
        .or_else(|_| {
            std::fs::copy(source, &target)
                .and_then(|_| std::fs::remove_file(source))
                .map(|_| ())
        })
        .map_err(|e| format!("Failed to move video into bundle: {}", e))?;

    // Re-extract metadata via ffprobe and update project.json
    let project_json_path = bundle_path.join("project.json");
    if project_json_path.exists() {
        // Extract video metadata using ffprobe
        let (width, height, duration_ms, fps) = if let Some(ffprobe) = find_ffprobe() {
            get_video_metadata_for_migration(&ffprobe, &target).unwrap_or((0, 0, 0, 30))
        } else {
            log::warn!("[REPAIR] ffprobe not found; metadata fields will remain unchanged");
            (0, 0, 0, 0)
        };

        // Read existing project.json and patch the relevant fields
        if let Ok(content) = std::fs::read_to_string(&project_json_path) {
            if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                let now = chrono::Utc::now().to_rfc3339();
                parsed["updatedAt"] = serde_json::Value::String(now);

                if width > 0 {
                    if let Some(sources) = parsed.get_mut("sources") {
                        sources["originalWidth"] = serde_json::json!(width);
                        sources["originalHeight"] = serde_json::json!(height);
                        sources["durationMs"] = serde_json::json!(duration_ms);
                        if fps > 0 {
                            sources["fps"] = serde_json::json!(fps);
                        }
                    }
                    if let Some(timeline) = parsed.get_mut("timeline") {
                        timeline["durationMs"] = serde_json::json!(duration_ms);
                        timeline["outPoint"] = serde_json::json!(duration_ms);
                    }
                }

                if let Ok(updated) = serde_json::to_string_pretty(&parsed) {
                    if let Err(e) = std::fs::write(&project_json_path, updated) {
                        log::warn!("[REPAIR] Failed to write updated project.json: {}", e);
                    }
                }
            }
        }
    }

    log::info!(
        "[REPAIR] Successfully repaired project {} in {:?}",
        project_id,
        bundle_path
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_project_bundle, resolve_capture_project_image_path};
    use chrono::Utc;
    use moonsnap_domain::storage::{CaptureProject, CaptureSource, Dimensions};
    use std::fs;
    use tempfile::TempDir;

    fn make_capture_project(original_image: &str, capture_type: &str) -> CaptureProject {
        CaptureProject {
            id: "project-123".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            capture_type: capture_type.to_string(),
            source: CaptureSource {
                monitor: None,
                window_id: None,
                window_title: None,
                region: None,
            },
            original_image: original_image.to_string(),
            dimensions: Dimensions {
                width: 1920,
                height: 1080,
            },
            annotations: Vec::new(),
            tags: Vec::new(),
            favorite: false,
        }
    }

    #[test]
    fn find_project_bundle_matches_project_json_id_when_folder_name_differs() {
        let temp_dir = TempDir::new().unwrap();
        let bundle_path = temp_dir.path().join("recording_2026-03-15_123456");
        fs::create_dir_all(&bundle_path).unwrap();
        fs::write(
            bundle_path.join("project.json"),
            r#"{"id":"proj_12345678","name":"Recording"}"#,
        )
        .unwrap();

        let resolved = find_project_bundle(temp_dir.path(), "proj_12345678").unwrap();

        assert_eq!(resolved, bundle_path);
    }

    #[test]
    fn resolve_capture_project_image_path_skips_metadata_only_video_sidecars() {
        let temp_dir = TempDir::new().unwrap();
        let project_file = temp_dir.path().join("project.json");
        let project = make_capture_project("", "video");
        fs::write(&project_file, serde_json::to_string(&project).unwrap()).unwrap();

        let resolved = resolve_capture_project_image_path(&project_file, temp_dir.path());

        assert_eq!(resolved, None);
    }

    #[test]
    fn resolve_capture_project_image_path_returns_relative_screenshot_image_path() {
        let temp_dir = TempDir::new().unwrap();
        let captures_dir = temp_dir.path().join("captures");
        fs::create_dir_all(&captures_dir).unwrap();

        let project_file = temp_dir.path().join("project.json");
        let project = make_capture_project("shot.png", "image");
        fs::write(&project_file, serde_json::to_string(&project).unwrap()).unwrap();

        let resolved = resolve_capture_project_image_path(&project_file, &captures_dir);

        assert_eq!(resolved, Some(captures_dir.join("shot.png")));
    }
}
