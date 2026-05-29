//! Cursor-image capture: GDI bitmap extraction, I-beam shadow, whitespace
//! trimming, and SHA256 deduplication.
//!
//! Split out of `events`; a child module so it can use the parent's private
//! cursor types and shape detection directly. Only `capture_and_dedupe_cursor`
//! is called back by the capture loops.

use super::*;

/// Result of cursor image capture with raw PNG data for deduplication.
struct CapturedCursor {
    image: CursorImage,
    png_data: Vec<u8>,
}

/// Capture cursor image as base64-encoded PNG with proper alpha, dynamic sizing,
/// I-beam shadow enhancement, and whitespace trimming.
/// Returns both the CursorImage (with base64 data) and raw PNG bytes for hashing.
#[cfg(target_os = "windows")]
fn capture_cursor_image_with_data(cursor_handle: isize) -> Option<CapturedCursor> {
    use image::{ImageBuffer, RgbaImage};
    use std::mem;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetObjectA, ReleaseDC,
        SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSORINFO_FLAGS, DI_NORMAL, HCURSOR,
        HICON, ICONINFO,
    };

    unsafe {
        // Get cursor info to verify handle
        let mut cursor_info = CURSORINFO {
            cbSize: mem::size_of::<CURSORINFO>() as u32,
            flags: CURSORINFO_FLAGS(0),
            hCursor: HCURSOR(cursor_handle as *mut std::ffi::c_void),
            ptScreenPos: POINT::default(),
        };

        if GetCursorInfo(&mut cursor_info).is_err() || cursor_info.hCursor.is_invalid() {
            return None;
        }

        let hcursor = cursor_info.hCursor;
        let hicon = HICON(hcursor.0);

        // Get icon info for hotspot and bitmap handles
        let mut icon_info: ICONINFO = mem::zeroed();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            return None;
        }

        // Get actual cursor dimensions from bitmap
        let mut bitmap: BITMAP = mem::zeroed();
        let bitmap_handle = if !icon_info.hbmColor.is_invalid() {
            icon_info.hbmColor
        } else {
            icon_info.hbmMask
        };

        if GetObjectA(
            bitmap_handle,
            mem::size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut _ as *mut _),
        ) == 0
        {
            // Clean up handles
            if !icon_info.hbmColor.is_invalid() {
                let _ = DeleteObject(icon_info.hbmColor);
            }
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return None;
        }

        // Create DCs
        let screen_dc = GetDC(None);
        let mem_dc = CreateCompatibleDC(screen_dc);

        // Get cursor dimensions (mask cursors have doubled height for AND/XOR masks)
        let width = bitmap.bmWidth;
        let height = if icon_info.hbmColor.is_invalid() && bitmap.bmHeight > 0 {
            bitmap.bmHeight / 2
        } else {
            bitmap.bmHeight
        };

        // Create bitmap info header for 32-bit RGBA with proper alpha
        let bi = BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // Negative for top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };

        let bitmap_info = BITMAPINFO {
            bmiHeader: bi,
            bmiColors: [Default::default()],
        };

        // Create DIB section for proper alpha channel support
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(mem_dc, &bitmap_info, DIB_RGB_COLORS, &mut bits, None, 0);

        if dib.is_err() {
            let _ = DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);
            if !icon_info.hbmColor.is_invalid() {
                let _ = DeleteObject(icon_info.hbmColor);
            }
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return None;
        }

        // Safe: checked is_err() above and returned early
        let dib = dib.expect("dib error checked above");

        // Select DIB into DC
        let old_bitmap = SelectObject(mem_dc, dib);

        // Draw the cursor onto our bitmap with transparency
        if DrawIconEx(mem_dc, 0, 0, hicon, 0, 0, 0, None, DI_NORMAL).is_err() {
            SelectObject(mem_dc, old_bitmap);
            let _ = DeleteObject(dib);
            let _ = DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);
            if !icon_info.hbmColor.is_invalid() {
                let _ = DeleteObject(icon_info.hbmColor);
            }
            if !icon_info.hbmMask.is_invalid() {
                let _ = DeleteObject(icon_info.hbmMask);
            }
            return None;
        }

        // Get image data
        let size = (width * height * 4) as usize;
        let mut image_data = vec![0u8; size];
        std::ptr::copy_nonoverlapping(bits, image_data.as_mut_ptr() as *mut _, size);

        // Calculate hotspot (original pixel values)
        let hotspot_x = if !icon_info.fIcon.as_bool() {
            icon_info.xHotspot as i32
        } else {
            width / 2
        };

        let hotspot_y = if !icon_info.fIcon.as_bool() {
            icon_info.yHotspot as i32
        } else {
            height / 2
        };

        // Cleanup GDI objects
        SelectObject(mem_dc, old_bitmap);
        let _ = DeleteObject(dib);
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);
        if !icon_info.hbmColor.is_invalid() {
            let _ = DeleteObject(icon_info.hbmColor);
        }
        if !icon_info.hbmMask.is_invalid() {
            let _ = DeleteObject(icon_info.hbmMask);
        }

        // Process the image data: BGRA -> RGBA
        for i in (0..size).step_by(4) {
            image_data.swap(i, i + 2);
        }

        // Convert to RGBA image
        let mut rgba_image: RgbaImage =
            ImageBuffer::from_raw(width as u32, height as u32, image_data)?;

        // Enhance I-beam cursor visibility (thin vertical cursors)
        let is_text_cursor = width <= 20 && height >= 20 && width <= height / 2;
        if is_text_cursor {
            add_ibeam_shadow(&mut rgba_image);
        }

        // Trim whitespace and adjust hotspot
        let (trimmed_image, new_hotspot_x, new_hotspot_y) =
            trim_cursor_image(rgba_image, hotspot_x, hotspot_y);

        let final_width = trimmed_image.width();
        let final_height = trimmed_image.height();

        // Convert to PNG
        let mut png_data = Vec::new();
        if trimmed_image
            .write_to(
                &mut std::io::Cursor::new(&mut png_data),
                image::ImageFormat::Png,
            )
            .is_err()
        {
            return None;
        }

        // Base64 encode
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let data_base64 = STANDARD.encode(&png_data);

        // Detect cursor shape (for SVG fallback)
        let cursor_shape = detect_cursor_shape(cursor_handle);

        Some(CapturedCursor {
            image: CursorImage {
                width: final_width,
                height: final_height,
                hotspot_x: new_hotspot_x,
                hotspot_y: new_hotspot_y,
                data_base64,
                cursor_shape,
            },
            png_data,
        })
    }
}

/// Legacy wrapper for backwards compatibility.
#[cfg(target_os = "windows")]
fn capture_cursor_image(cursor_handle: isize) -> Option<CursorImage> {
    capture_cursor_image_with_data(cursor_handle).map(|c| c.image)
}

/// Add shadow/outline to I-beam cursor for visibility on white backgrounds.
#[cfg(target_os = "windows")]
fn add_ibeam_shadow(image: &mut image::RgbaImage) {
    let width = image.width() as i32;
    let height = image.height() as i32;

    // Collect pixels that need shadows first (to avoid borrow issues)
    let mut shadow_pixels: Vec<(u32, u32)> = Vec::new();

    for y in 0..height {
        for x in 0..width {
            let pixel = image.get_pixel(x as u32, y as u32);
            if pixel[3] > 200 {
                // If this is a solid pixel
                for dx in [-1, 0, 1].iter() {
                    for dy in [-1, 0, 1].iter() {
                        let nx = x + dx;
                        let ny = y + dy;

                        if nx < 0 || ny < 0 || nx >= width || ny >= height || (*dx == 0 && *dy == 0)
                        {
                            continue;
                        }

                        let shadow_pixel = image.get_pixel(nx as u32, ny as u32);
                        if shadow_pixel[3] < 100 {
                            shadow_pixels.push((nx as u32, ny as u32));
                        }
                    }
                }
            }
        }
    }

    // Apply shadow pixels
    for (x, y) in shadow_pixels {
        image.put_pixel(x, y, image::Rgba([0, 0, 0, 100]));
    }
}

/// Trim whitespace from cursor image and adjust hotspot.
#[cfg(target_os = "windows")]
fn trim_cursor_image(
    image: image::RgbaImage,
    hotspot_x: i32,
    hotspot_y: i32,
) -> (image::RgbaImage, i32, i32) {
    let width = image.width();
    let height = image.height();

    // Find bounds of non-transparent pixels
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut has_content = false;

    for y in 0..height {
        for x in 0..width {
            let pixel = image.get_pixel(x, y);
            if pixel[3] > 0 {
                has_content = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }

    // Only trim if there's whitespace to remove
    if has_content && (min_x > 0 || min_y > 0 || max_x < width - 1 || max_y < height - 1) {
        let padding = 2u32;
        let trim_min_x = min_x.saturating_sub(padding);
        let trim_min_y = min_y.saturating_sub(padding);
        let trim_max_x = (max_x + padding).min(width - 1);
        let trim_max_y = (max_y + padding).min(height - 1);

        let trim_width = trim_max_x - trim_min_x + 1;
        let trim_height = trim_max_y - trim_min_y + 1;

        let mut trimmed = image::RgbaImage::new(trim_width, trim_height);
        for y in 0..trim_height {
            for x in 0..trim_width {
                let src_x = trim_min_x + x;
                let src_y = trim_min_y + y;
                let pixel = image.get_pixel(src_x, src_y);
                trimmed.put_pixel(x, y, *pixel);
            }
        }

        // Adjust hotspot for trimmed image (keep as pixel coordinates)
        let new_hotspot_x = hotspot_x - trim_min_x as i32;
        let new_hotspot_y = hotspot_y - trim_min_y as i32;

        (trimmed, new_hotspot_x, new_hotspot_y)
    } else {
        (image, hotspot_x, hotspot_y)
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_cursor_image(_cursor_handle: isize) -> Option<CursorImage> {
    None
}

#[cfg(not(target_os = "windows"))]
fn capture_cursor_image_with_data(_cursor_handle: isize) -> Option<CapturedCursor> {
    None
}

/// Capture cursor image with SHA256-based deduplication.
/// Returns the cursor_id (either existing or newly created) if successful.
pub(super) fn capture_and_dedupe_cursor(
    cursor_handle: isize,
    data: &mut SharedCursorData,
    log_context: &str,
) -> Option<String> {
    use sha2::{Digest, Sha256};

    // Capture cursor with PNG data
    let captured = capture_cursor_image_with_data(cursor_handle)?;

    // Compute SHA256 hash of PNG data (use first 8 bytes as u64 key)
    let hash_bytes = Sha256::digest(&captured.png_data);
    let hash_key = u64::from_le_bytes(
        hash_bytes[..8]
            .try_into()
            .expect("sha256 produces at least 8 bytes"),
    );

    // Check if we already have this exact image
    if let Some(existing_id) = data.image_hashes.get(&hash_key) {
        log::debug!(
            "[CURSOR_EVENTS] {} cursor reused existing: {} (hash {:x})",
            log_context,
            existing_id,
            hash_key
        );
        data.last_cursor_id = Some(existing_id.clone());
        return Some(existing_id.clone());
    }

    // New cursor image - assign sequential ID
    let cursor_id = format!("cursor_{}", data.next_cursor_id);
    data.next_cursor_id += 1;

    log::debug!(
        "[CURSOR_EVENTS] {} cursor captured: {} ({}x{}, hash {:x})",
        log_context,
        cursor_id,
        captured.image.width,
        captured.image.height,
        hash_key
    );

    // Store the image and hash mapping
    data.cursor_images.insert(cursor_id.clone(), captured.image);
    data.image_hashes.insert(hash_key, cursor_id.clone());
    data.last_cursor_id = Some(cursor_id.clone());

    Some(cursor_id)
}
