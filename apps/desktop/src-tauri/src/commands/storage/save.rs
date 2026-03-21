//! Save operations for captures and imports.

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use image::{DynamicImage, GenericImageView};
use moonsnap_core::error::MoonSnapResult;
use std::fs;
use std::path::PathBuf;
use tauri::command;

use super::{ensure_directories, generate_id, get_captures_dir, remember_saved_capture_lookup};
use moonsnap_domain::storage::*;
use moonsnap_media::ffmpeg::generate_thumbnail;

#[command]
pub async fn save_capture(
    app: tauri::AppHandle,
    request: SaveCaptureRequest,
) -> MoonSnapResult<SaveCaptureResponse> {
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
        thumbnail_path: thumbnail_path.to_string_lossy().into_owned(),
        image_path: original_path.to_string_lossy().into_owned(),
    })
}

/// Fast save capture from RGBA file path - skips base64 encoding/decoding
#[command]
pub async fn save_capture_from_file(
    app: tauri::AppHandle,
    file_path: String,
    width: u32,
    height: u32,
    capture_type: String,
    source: CaptureSource,
) -> MoonSnapResult<SaveCaptureResponse> {
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

    let image_path = original_path.to_string_lossy().into_owned();
    remember_saved_capture_lookup(&file_path, &id, &image_path);

    Ok(SaveCaptureResponse {
        id,
        project,
        thumbnail_path: thumbnail_path.to_string_lossy().into_owned(),
        image_path,
    })
}

/// Import an image from a file path (used for drag-drop import)
#[command]
pub async fn import_image_from_path(
    app: tauri::AppHandle,
    file_path: String,
) -> MoonSnapResult<SaveCaptureResponse> {
    let path = PathBuf::from(&file_path);

    // Verify file exists and is an image
    if !path.exists() {
        return Err(format!("File not found: {}", file_path).into());
    }

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let valid_extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
    if !valid_extensions.contains(&extension.as_str()) {
        return Err(format!("Unsupported image format: {}", extension).into());
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
        thumbnail_path: thumbnail_path.to_string_lossy().into_owned(),
        image_path: original_path.to_string_lossy().into_owned(),
    })
}
