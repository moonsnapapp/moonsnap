//! Maintenance and repair operations: stats, ffmpeg, startup cleanup, video migration, repair.

use moonsnap_core::error::MoonSnapResult;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use super::{
    calculate_dir_size, ensure_directories, find_project_bundle, get_app_data_dir, get_captures_dir,
};
use moonsnap_domain::storage::*;
use moonsnap_media::ffmpeg::{
    find_ffmpeg, find_ffprobe, generate_thumbnail, get_video_metadata_for_migration,
};

// ============================================================================
// Stats and Utility Operations
// ============================================================================

#[command]
pub async fn get_storage_stats(app: tauri::AppHandle) -> MoonSnapResult<StorageStats> {
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
        storage_path: base_dir.to_string_lossy().into_owned(),
    })
}

/// Ensure ffmpeg is available for video thumbnail generation.
/// Downloads if not already cached.
#[command]
pub async fn ensure_ffmpeg() -> MoonSnapResult<bool> {
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
pub async fn startup_cleanup(app: tauri::AppHandle) -> MoonSnapResult<StartupCleanupResult> {
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
                    if name.starts_with("moonsnap_capture_")
                        && name.ends_with(".rgba")
                        && fs::remove_file(&path).is_ok()
                    {
                        temp_files_cleaned += 1;
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
    video_path: &Path,
    captures_dir: &Path,
    thumbnails_dir: &Path,
) -> MoonSnapResult<()> {
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
    folder_path: &Path,
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

/// Repair a damaged project bundle by re-linking a video file.
///
/// Steps:
/// 1. Move (or copy+delete) the selected video file into the bundle as `screen.mp4`
/// 2. Re-extract metadata via ffprobe and update `project.json`
/// 3. Set the Hidden attribute on the new file (Windows)
#[command]
pub async fn repair_project(
    app: tauri::AppHandle,
    project_id: String,
    new_video_path: String,
) -> MoonSnapResult<()> {
    let captures_dir = get_captures_dir(&app)?;
    let bundle_path = find_project_bundle(&captures_dir, &project_id)?;

    let target = bundle_path.join("screen.mp4");
    let source = std::path::Path::new(&new_video_path);

    if !source.exists() {
        return Err("Selected video file does not exist".into());
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
