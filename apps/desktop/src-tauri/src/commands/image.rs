use image::GenericImageView;
use tauri::{command, image::Image as TauriImage, AppHandle};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Copy image from file path to clipboard
#[command]
pub async fn copy_image_to_clipboard(app: AppHandle, path: String) -> Result<(), String> {
    // Read the image file
    let image = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;

    let (width, height) = image.dimensions();
    let rgba = image.to_rgba8();
    let raw_data = rgba.into_raw();

    // Create a Tauri Image from the RGBA data
    let tauri_image = TauriImage::new_owned(raw_data, width, height);

    app.clipboard()
        .write_image(&tauri_image)
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

    Ok(())
}

/// Copy a raw RGBA file (with 8-byte header: width u32 LE, height u32 LE) to clipboard
#[command]
pub async fn copy_rgba_to_clipboard(app: AppHandle, file_path: String) -> Result<(), String> {
    let data = std::fs::read(&file_path).map_err(|e| format!("Failed to read RGBA file: {}", e))?;

    if data.len() < 8 {
        return Err("RGBA file too small".to_string());
    }

    let width = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let height = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let rgba_data = data[8..].to_vec();

    let tauri_image = TauriImage::new_owned(rgba_data, width, height);

    app.clipboard()
        .write_image(&tauri_image)
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

    Ok(())
}
