use super::super::NativeCameraFrame;
use moonsnap_core::error::MoonSnapResult;

/// Bilinear downscaling for planar data (Y plane).
/// Samples 4 neighbors and blends based on fractional position.
pub(super) fn subsample_plane(
    src: &[u8],
    src_width: usize,
    src_height: usize,
    dst_width: usize,
    dst_height: usize,
    bytes_per_sample: usize, // 1 for Y, 2 for UV pairs
    dst: &mut Vec<u8>,
) {
    dst.reserve_exact(dst_width * dst_height * bytes_per_sample);

    // Use floating point for bilinear interpolation
    let x_scale = src_width as f32 / dst_width as f32;
    let y_scale = src_height as f32 / dst_height as f32;

    for dst_y in 0..dst_height {
        let src_yf = dst_y as f32 * y_scale;
        let src_y0 = (src_yf as usize).min(src_height - 1);
        let src_y1 = (src_y0 + 1).min(src_height - 1);
        let y_frac = src_yf - src_y0 as f32;

        for dst_x in 0..dst_width {
            let src_xf = dst_x as f32 * x_scale;
            let src_x0 = (src_xf as usize).min(src_width - 1);
            let src_x1 = (src_x0 + 1).min(src_width - 1);
            let x_frac = src_xf - src_x0 as f32;

            // Bilinear blend for each byte in sample
            for i in 0..bytes_per_sample {
                let get_pixel = |x: usize, y: usize| -> f32 {
                    src.get(y * src_width * bytes_per_sample + x * bytes_per_sample + i)
                        .copied()
                        .unwrap_or(128) as f32
                };

                let p00 = get_pixel(src_x0, src_y0);
                let p10 = get_pixel(src_x1, src_y0);
                let p01 = get_pixel(src_x0, src_y1);
                let p11 = get_pixel(src_x1, src_y1);

                // Bilinear interpolation
                let top = p00 + (p10 - p00) * x_frac;
                let bot = p01 + (p11 - p01) * x_frac;
                let val = top + (bot - top) * y_frac;

                dst.push(val.clamp(0.0, 255.0) as u8);
            }
        }
    }
}

/// Bilinear downscaling for YUYV422 data.
/// Converts to YUV per-pixel, bilinear samples, then re-packs to YUYV.
pub(super) fn subsample_yuyv(
    src: &[u8],
    src_width: usize,
    src_height: usize,
    dst_width: usize,
    dst_height: usize,
    dst: &mut Vec<u8>,
) {
    dst.reserve_exact(dst_width * dst_height * 2);

    let x_scale = src_width as f32 / dst_width as f32;
    let y_scale = src_height as f32 / dst_height as f32;
    let src_stride = src_width * 2;

    // Helper to get Y value at pixel position
    let get_y = |x: usize, y: usize| -> f32 {
        let row = y * src_stride;
        let pair_offset = (x / 2) * 4;
        let y_offset = if x.is_multiple_of(2) { 0 } else { 2 };
        src.get(row + pair_offset + y_offset)
            .copied()
            .unwrap_or(128) as f32
    };

    // Helper to get U value at pixel position
    let get_u = |x: usize, y: usize| -> f32 {
        let row = y * src_stride;
        let pair_offset = (x / 2) * 4;
        src.get(row + pair_offset + 1).copied().unwrap_or(128) as f32
    };

    // Helper to get V value at pixel position
    let get_v = |x: usize, y: usize| -> f32 {
        let row = y * src_stride;
        let pair_offset = (x / 2) * 4;
        src.get(row + pair_offset + 3).copied().unwrap_or(128) as f32
    };

    // Bilinear sample a component
    let bilinear = |get_fn: &dyn Fn(usize, usize) -> f32, src_xf: f32, src_yf: f32| -> u8 {
        let src_x0 = (src_xf as usize).min(src_width - 1);
        let src_x1 = (src_x0 + 1).min(src_width - 1);
        let src_y0 = (src_yf as usize).min(src_height - 1);
        let src_y1 = (src_y0 + 1).min(src_height - 1);
        let x_frac = src_xf - src_x0 as f32;
        let y_frac = src_yf - src_y0 as f32;

        let p00 = get_fn(src_x0, src_y0);
        let p10 = get_fn(src_x1, src_y0);
        let p01 = get_fn(src_x0, src_y1);
        let p11 = get_fn(src_x1, src_y1);

        let top = p00 + (p10 - p00) * x_frac;
        let bot = p01 + (p11 - p01) * x_frac;
        let val = top + (bot - top) * y_frac;
        val.clamp(0.0, 255.0) as u8
    };

    for dst_y in 0..dst_height {
        let src_yf = dst_y as f32 * y_scale;

        for dst_x in (0..dst_width).step_by(2) {
            // Sample two pixels for YUYV pair
            let src_xf0 = dst_x as f32 * x_scale;
            let src_xf1 = (dst_x + 1) as f32 * x_scale;

            let y0 = bilinear(&get_y, src_xf0, src_yf);
            let y1 = bilinear(&get_y, src_xf1, src_yf);
            // Average U and V from both pixel positions
            let u = ((bilinear(&get_u, src_xf0, src_yf) as u16
                + bilinear(&get_u, src_xf1, src_yf) as u16)
                / 2) as u8;
            let v = ((bilinear(&get_v, src_xf0, src_yf) as u16
                + bilinear(&get_v, src_xf1, src_yf) as u16)
                / 2) as u8;

            dst.extend_from_slice(&[y0, u, y1, v]);
        }
    }
}

/// Decode MJPEG/RGB to RGBA with downsampling.
pub(super) fn frame_to_rgba_downsampled(
    frame: &NativeCameraFrame,
    dst_width: u32,
    dst_height: u32,
    rgba: &mut Vec<u8>,
) -> MoonSnapResult<()> {
    use moonsnap_camera_windows::PixelFormat;

    let bytes = frame.bytes();

    match frame.pixel_format {
        PixelFormat::MJPEG => {
            // Decode JPEG with bilinear resize for smooth downscaling
            let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to decode MJPEG: {}", e))?;
            let img = img.resize(dst_width, dst_height, image::imageops::FilterType::Triangle);
            let rgb = img.to_rgb8();
            rgba.reserve_exact((dst_width * dst_height * 4) as usize);
            rgba.extend(rgb.pixels().flat_map(|p| [p[0], p[1], p[2], 255]));
        },
        PixelFormat::RGB24 => {
            // Bilinear sample RGB24
            let src_width = frame.width as usize;
            let src_height = frame.height as usize;
            let x_scale = src_width as f32 / dst_width as f32;
            let y_scale = src_height as f32 / dst_height as f32;
            rgba.reserve_exact((dst_width * dst_height * 4) as usize);

            for dst_y in 0..dst_height as usize {
                let src_yf = dst_y as f32 * y_scale;
                let src_y0 = (src_yf as usize).min(src_height - 1);
                let src_y1 = (src_y0 + 1).min(src_height - 1);
                let y_frac = src_yf - src_y0 as f32;

                for dst_x in 0..dst_width as usize {
                    let src_xf = dst_x as f32 * x_scale;
                    let src_x0 = (src_xf as usize).min(src_width - 1);
                    let src_x1 = (src_x0 + 1).min(src_width - 1);
                    let x_frac = src_xf - src_x0 as f32;

                    // Bilinear for each RGB channel
                    for c in 0..3 {
                        let get = |x: usize, y: usize| -> f32 {
                            bytes
                                .get(y * src_width * 3 + x * 3 + c)
                                .copied()
                                .unwrap_or(128) as f32
                        };
                        let p00 = get(src_x0, src_y0);
                        let p10 = get(src_x1, src_y0);
                        let p01 = get(src_x0, src_y1);
                        let p11 = get(src_x1, src_y1);
                        let top = p00 + (p10 - p00) * x_frac;
                        let bot = p01 + (p11 - p01) * x_frac;
                        let val = top + (bot - top) * y_frac;
                        rgba.push(val.clamp(0.0, 255.0) as u8);
                    }
                    rgba.push(255); // Alpha
                }
            }
        },
        PixelFormat::RGB32 | PixelFormat::ARGB => {
            // Bilinear sample BGRA
            let src_width = frame.width as usize;
            let src_height = frame.height as usize;
            let x_scale = src_width as f32 / dst_width as f32;
            let y_scale = src_height as f32 / dst_height as f32;
            rgba.reserve_exact((dst_width * dst_height * 4) as usize);

            for dst_y in 0..dst_height as usize {
                let src_yf = dst_y as f32 * y_scale;
                let src_y0 = (src_yf as usize).min(src_height - 1);
                let src_y1 = (src_y0 + 1).min(src_height - 1);
                let y_frac = src_yf - src_y0 as f32;

                for dst_x in 0..dst_width as usize {
                    let src_xf = dst_x as f32 * x_scale;
                    let src_x0 = (src_xf as usize).min(src_width - 1);
                    let src_x1 = (src_x0 + 1).min(src_width - 1);
                    let x_frac = src_xf - src_x0 as f32;

                    // Bilinear for BGRA (reorder to RGBA)
                    let bgra_order = [2, 1, 0, 3]; // B->R, G->G, R->B, A->A
                    for &c in &bgra_order {
                        let get = |x: usize, y: usize| -> f32 {
                            bytes
                                .get(y * src_width * 4 + x * 4 + c)
                                .copied()
                                .unwrap_or(128) as f32
                        };
                        let p00 = get(src_x0, src_y0);
                        let p10 = get(src_x1, src_y0);
                        let p01 = get(src_x0, src_y1);
                        let p11 = get(src_x1, src_y1);
                        let top = p00 + (p10 - p00) * x_frac;
                        let bot = p01 + (p11 - p01) * x_frac;
                        let val = top + (bot - top) * y_frac;
                        rgba.push(val.clamp(0.0, 255.0) as u8);
                    }
                }
            }
        },
        _ => {
            return Err(format!(
                "frame_to_rgba_downsampled: unsupported format {:?}",
                frame.pixel_format
            )
            .into())
        },
    }

    Ok(())
}

/// Convert MJPEG/RGB frame to RGBA (no scaling - GPU handles that).
/// Only used for non-YUV formats; YUV formats go directly to GPU.
#[allow(dead_code)]
pub(super) fn frame_to_rgba_into(
    frame: &NativeCameraFrame,
    rgba: &mut Vec<u8>,
) -> MoonSnapResult<()> {
    use moonsnap_camera_windows::PixelFormat;

    let bytes = frame.bytes();
    let width = frame.width as usize;
    let height = frame.height as usize;
    let pixel_count = width * height;

    rgba.clear();
    rgba.reserve_exact(pixel_count * 4);

    match frame.pixel_format {
        PixelFormat::MJPEG => {
            // Decode JPEG to RGB, then add alpha
            let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to decode MJPEG: {}", e))?;
            let rgb = img.to_rgb8();
            rgba.extend(rgb.pixels().flat_map(|p| [p[0], p[1], p[2], 255]));
        },
        PixelFormat::RGB24 => {
            let expected = width * height * 3;
            if bytes.len() < expected {
                return Err("RGB24 buffer too small".into());
            }
            rgba.extend(
                bytes
                    .chunks_exact(3)
                    .take(pixel_count)
                    .flat_map(|p| [p[0], p[1], p[2], 255]),
            );
        },
        PixelFormat::RGB32 | PixelFormat::ARGB => {
            // BGRA to RGBA
            let expected = width * height * 4;
            if bytes.len() < expected {
                return Err("RGB32 buffer too small".into());
            }
            rgba.extend(
                bytes
                    .chunks_exact(4)
                    .take(pixel_count)
                    .flat_map(|p| [p[2], p[1], p[0], p[3]]),
            );
        },
        _ => {
            return Err(format!(
                "frame_to_rgba_into: unsupported format {:?}",
                frame.pixel_format
            )
            .into())
        },
    }

    Ok(())
}

/// Maximum texture size for preview (now unused - GPU handles full resolution).
/// Kept for reference; previously used for CPU downscaling before GPU upload.
#[allow(dead_code)]
pub(super) const PREVIEW_MAX_TEXTURE_SIZE: u32 = 1280;

/// Convert NativeCameraFrame to RGBA bytes with optional downscaling.
/// **DEPRECATED**: No longer used - YUV frames go directly to GPU for conversion.
/// Kept for potential future use or fallback scenarios.
#[allow(dead_code)]
pub(super) fn frame_to_rgba_scaled_into(
    frame: &NativeCameraFrame,
    max_size: u32,
    rgba: &mut Vec<u8>,
) -> Result<(u32, u32), String> {
    use moonsnap_camera_windows::PixelFormat;

    let bytes = frame.bytes();
    let src_width = frame.width as usize;
    let src_height = frame.height as usize;

    // Calculate scale factor to fit within max_size
    let needs_scale = src_width > max_size as usize || src_height > max_size as usize;
    let (dst_width, dst_height) = if needs_scale {
        let scale_w = max_size as f32 / src_width as f32;
        let scale_h = max_size as f32 / src_height as f32;
        let scale = scale_w.min(scale_h);
        (
            ((src_width as f32 * scale) as u32).max(1),
            ((src_height as f32 * scale) as u32).max(1),
        )
    } else {
        (src_width as u32, src_height as u32)
    };

    let dst_pixel_count = (dst_width * dst_height) as usize;

    // Pre-allocate exact size to avoid reallocations
    rgba.clear();
    rgba.reserve_exact(dst_pixel_count * 4);

    // Pre-calculate mapping ratios as fixed-point (16.16) for speed
    let x_ratio = if needs_scale {
        (src_width << 16) / dst_width as usize
    } else {
        1 << 16
    };
    let y_ratio = if needs_scale {
        (src_height << 16) / dst_height as usize
    } else {
        1 << 16
    };

    match frame.pixel_format {
        PixelFormat::MJPEG => {
            // Decode JPEG - use Nearest for speed when scaling
            let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to decode MJPEG: {}", e))?;
            let img = if needs_scale {
                // Use Nearest for speed - GPU bilinear will smooth it
                img.resize(dst_width, dst_height, image::imageops::FilterType::Nearest)
            } else {
                img
            };
            let rgb = img.to_rgb8();
            // Bulk extend - faster than per-pixel
            rgba.extend(rgb.pixels().flat_map(|p| [p[0], p[1], p[2], 255]));
        },
        PixelFormat::NV12 => {
            let y_size = src_width * src_height;
            let uv_size = y_size / 2;
            if bytes.len() < y_size + uv_size {
                return Err("NV12 buffer too small".into());
            }
            let y_plane = &bytes[..y_size];
            let uv_plane = &bytes[y_size..y_size + uv_size];

            for dst_y in 0..dst_height as usize {
                let src_y = ((dst_y * y_ratio) >> 16).min(src_height - 1);
                let row_offset = src_y * src_width;
                let uv_row = (src_y / 2) * src_width;

                for dst_x in 0..dst_width as usize {
                    let src_x = ((dst_x * x_ratio) >> 16).min(src_width - 1);

                    // Integer YUV to RGB (BT.601, scaled by 256)
                    let y = y_plane[row_offset + src_x] as i32;
                    let uv_idx = uv_row + (src_x / 2 * 2);
                    let u = uv_plane.get(uv_idx).copied().unwrap_or(128) as i32 - 128;
                    let v = uv_plane.get(uv_idx + 1).copied().unwrap_or(128) as i32 - 128;

                    // BT.601 coefficients scaled by 256
                    let r = (y + ((359 * v) >> 8)).clamp(0, 255) as u8;
                    let g = (y - ((88 * u + 183 * v) >> 8)).clamp(0, 255) as u8;
                    let b = (y + ((454 * u) >> 8)).clamp(0, 255) as u8;
                    rgba.extend_from_slice(&[r, g, b, 255]);
                }
            }
        },
        PixelFormat::YUYV422 => {
            let expected = src_width * src_height * 2;
            if bytes.len() < expected {
                return Err("YUYV buffer too small".into());
            }

            for dst_y in 0..dst_height as usize {
                let src_y = ((dst_y * y_ratio) >> 16).min(src_height - 1);
                let row_base = src_y * src_width * 2;

                for dst_x in 0..dst_width as usize {
                    let src_x = ((dst_x * x_ratio) >> 16).min(src_width - 1);
                    let pair_x = src_x / 2 * 2;
                    let chunk_offset = row_base + pair_x * 2;

                    if chunk_offset + 4 > bytes.len() {
                        rgba.extend_from_slice(&[128, 128, 128, 255]);
                        continue;
                    }

                    // YUYV: Y0 U Y1 V
                    let y = bytes[chunk_offset + (src_x & 1) * 2] as i32;
                    let u = bytes[chunk_offset + 1] as i32 - 128;
                    let v = bytes[chunk_offset + 3] as i32 - 128;

                    // BT.601 coefficients scaled by 256
                    let r = (y + ((359 * v) >> 8)).clamp(0, 255) as u8;
                    let g = (y - ((88 * u + 183 * v) >> 8)).clamp(0, 255) as u8;
                    let b = (y + ((454 * u) >> 8)).clamp(0, 255) as u8;
                    rgba.extend_from_slice(&[r, g, b, 255]);
                }
            }
        },
        PixelFormat::RGB24 => {
            let expected = src_width * src_height * 3;
            if bytes.len() < expected {
                return Err("RGB24 buffer too small".into());
            }

            if !needs_scale {
                // Fast path: no scaling, just add alpha channel
                rgba.extend(
                    bytes
                        .chunks_exact(3)
                        .take(src_width * src_height)
                        .flat_map(|p| [p[0], p[1], p[2], 255]),
                );
            } else {
                for dst_y in 0..dst_height as usize {
                    let src_y = ((dst_y * y_ratio) >> 16).min(src_height - 1);
                    let row_offset = src_y * src_width * 3;
                    for dst_x in 0..dst_width as usize {
                        let src_x = ((dst_x * x_ratio) >> 16).min(src_width - 1);
                        let offset = row_offset + src_x * 3;
                        rgba.extend_from_slice(&[
                            bytes[offset],
                            bytes[offset + 1],
                            bytes[offset + 2],
                            255,
                        ]);
                    }
                }
            }
        },
        PixelFormat::RGB32 | PixelFormat::ARGB => {
            let expected = src_width * src_height * 4;
            if bytes.len() < expected {
                return Err("RGB32 buffer too small".into());
            }

            if !needs_scale {
                // Fast path: no scaling, just reorder BGRA to RGBA
                rgba.extend(
                    bytes
                        .chunks_exact(4)
                        .take(src_width * src_height)
                        .flat_map(|p| [p[2], p[1], p[0], p[3]]),
                );
            } else {
                for dst_y in 0..dst_height as usize {
                    let src_y = ((dst_y * y_ratio) >> 16).min(src_height - 1);
                    let row_offset = src_y * src_width * 4;
                    for dst_x in 0..dst_width as usize {
                        let src_x = ((dst_x * x_ratio) >> 16).min(src_width - 1);
                        let offset = row_offset + src_x * 4;
                        rgba.extend_from_slice(&[
                            bytes[offset + 2],
                            bytes[offset + 1],
                            bytes[offset],
                            bytes[offset + 3],
                        ]);
                    }
                }
            }
        },
        _ => {
            return Err(format!(
                "Unsupported pixel format: {:?}",
                frame.pixel_format
            ))
        },
    }

    Ok((dst_width, dst_height))
}

/// Convert NativeCameraFrame to RGBA bytes for GPU upload, with optional downscaling.
/// Downscaling happens during conversion (point sampling) which is much faster
/// than converting at full resolution.
#[allow(dead_code)]
pub(super) fn frame_to_rgba_scaled(
    frame: &NativeCameraFrame,
    max_size: u32,
) -> Result<(Vec<u8>, u32, u32), String> {
    use moonsnap_camera_windows::PixelFormat;

    let bytes = frame.bytes();
    let src_width = frame.width as usize;
    let src_height = frame.height as usize;

    // Calculate scale factor to fit within max_size
    let scale = if src_width > max_size as usize || src_height > max_size as usize {
        let scale_w = max_size as f32 / src_width as f32;
        let scale_h = max_size as f32 / src_height as f32;
        scale_w.min(scale_h)
    } else {
        1.0
    };

    let dst_width = ((src_width as f32 * scale) as u32).max(1);
    let dst_height = ((src_height as f32 * scale) as u32).max(1);
    let dst_pixel_count = (dst_width * dst_height) as usize;

    // Step size for point sampling (how many source pixels to skip)
    let step = if scale < 1.0 {
        (1.0 / scale).ceil() as usize
    } else {
        1
    };
    let step = step.max(1); // Ensure step is at least 1

    match frame.pixel_format {
        PixelFormat::MJPEG => {
            // Decode JPEG to RGB, then resize
            let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to decode MJPEG: {}", e))?;

            // Resize if needed
            let img = if scale < 1.0 {
                img.resize(dst_width, dst_height, image::imageops::FilterType::Nearest)
            } else {
                img
            };

            let rgb = img.to_rgb8();
            let mut rgba = Vec::with_capacity(dst_pixel_count * 4);
            for pixel in rgb.pixels() {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
            Ok((rgba, dst_width, dst_height))
        },
        PixelFormat::NV12 => {
            // NV12: Y plane + interleaved UV - sample every Nth pixel
            let y_size = src_width * src_height;
            let uv_size = y_size / 2;
            if bytes.len() < y_size + uv_size {
                return Err("NV12 buffer too small".into());
            }

            let y_plane = &bytes[..y_size];
            let uv_plane = &bytes[y_size..y_size + uv_size];

            let mut rgba = Vec::with_capacity(dst_pixel_count * 4);
            for dst_y in 0..dst_height as usize {
                let src_y = dst_y * step;
                if src_y >= src_height {
                    break;
                }
                for dst_x in 0..dst_width as usize {
                    let src_x = dst_x * step;
                    if src_x >= src_width {
                        break;
                    }

                    let y = y_plane[src_y * src_width + src_x] as f32;
                    let uv_idx = (src_y / 2) * src_width + (src_x / 2 * 2);
                    let u = uv_plane[uv_idx] as f32 - 128.0;
                    let v = uv_plane[uv_idx + 1] as f32 - 128.0;

                    let r = (y + 1.402 * v).clamp(0.0, 255.0) as u8;
                    let g = (y - 0.344 * u - 0.714 * v).clamp(0.0, 255.0) as u8;
                    let b = (y + 1.772 * u).clamp(0.0, 255.0) as u8;

                    rgba.extend_from_slice(&[r, g, b, 255]);
                }
            }
            Ok((rgba, dst_width, dst_height))
        },
        PixelFormat::YUYV422 => {
            // YUYV: sample every Nth pair of pixels
            let expected = src_width * src_height * 2;
            if bytes.len() < expected {
                return Err("YUYV buffer too small".into());
            }

            let mut rgba = Vec::with_capacity(dst_pixel_count * 4);
            for dst_y in 0..dst_height as usize {
                let src_y = dst_y * step;
                if src_y >= src_height {
                    break;
                }
                for dst_x in 0..dst_width as usize {
                    let src_x = dst_x * step;
                    if src_x >= src_width {
                        break;
                    }

                    // YUYV has 2 pixels per 4 bytes, so we need to find the right chunk
                    let pair_x = src_x / 2 * 2; // Align to pair boundary
                    let chunk_offset = (src_y * src_width + pair_x) * 2;
                    let chunk = &bytes[chunk_offset..chunk_offset + 4];

                    let y = if src_x % 2 == 0 { chunk[0] } else { chunk[2] } as f32;
                    let u = chunk[1] as f32 - 128.0;
                    let v = chunk[3] as f32 - 128.0;

                    let r = (y + 1.402 * v).clamp(0.0, 255.0) as u8;
                    let g = (y - 0.344 * u - 0.714 * v).clamp(0.0, 255.0) as u8;
                    let b = (y + 1.772 * u).clamp(0.0, 255.0) as u8;

                    rgba.extend_from_slice(&[r, g, b, 255]);
                }
            }
            Ok((rgba, dst_width, dst_height))
        },
        PixelFormat::RGB24 => {
            let expected = src_width * src_height * 3;
            if bytes.len() < expected {
                return Err("RGB24 buffer too small".into());
            }

            let mut rgba = Vec::with_capacity(dst_pixel_count * 4);
            for dst_y in 0..dst_height as usize {
                let src_y = dst_y * step;
                if src_y >= src_height {
                    break;
                }
                for dst_x in 0..dst_width as usize {
                    let src_x = dst_x * step;
                    if src_x >= src_width {
                        break;
                    }

                    let offset = (src_y * src_width + src_x) * 3;
                    rgba.extend_from_slice(&[
                        bytes[offset],
                        bytes[offset + 1],
                        bytes[offset + 2],
                        255,
                    ]);
                }
            }
            Ok((rgba, dst_width, dst_height))
        },
        PixelFormat::RGB32 | PixelFormat::ARGB => {
            // Assume BGRA, convert to RGBA with sampling
            let expected = src_width * src_height * 4;
            if bytes.len() < expected {
                return Err("RGB32 buffer too small".into());
            }

            let mut rgba = Vec::with_capacity(dst_pixel_count * 4);
            for dst_y in 0..dst_height as usize {
                let src_y = dst_y * step;
                if src_y >= src_height {
                    break;
                }
                for dst_x in 0..dst_width as usize {
                    let src_x = dst_x * step;
                    if src_x >= src_width {
                        break;
                    }

                    let offset = (src_y * src_width + src_x) * 4;
                    rgba.extend_from_slice(&[
                        bytes[offset + 2],
                        bytes[offset + 1],
                        bytes[offset],
                        bytes[offset + 3],
                    ]);
                }
            }
            Ok((rgba, dst_width, dst_height))
        },
        _ => Err(format!(
            "Unsupported pixel format: {:?}",
            frame.pixel_format
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subsample_plane_keeps_constant_plane() {
        let src = vec![77_u8; 4 * 4];
        let mut dst = Vec::new();
        subsample_plane(&src, 4, 4, 2, 2, 1, &mut dst);

        assert_eq!(dst.len(), 4);
        assert!(dst.iter().all(|&value| value == 77));
    }

    #[test]
    fn subsample_yuyv_identity_preserves_bytes() {
        let src = vec![10_u8, 20, 30, 40];
        let mut dst = Vec::new();
        subsample_yuyv(&src, 2, 1, 2, 1, &mut dst);

        assert_eq!(dst, src);
    }

    #[test]
    fn frame_to_rgba_downsampled_rgb24_adds_alpha() {
        let frame = NativeCameraFrame::from_decoded_rgb(&[1, 2, 3, 4, 5, 6], 2, 1, 1)
            .expect("valid RGB24 frame");
        let mut rgba = Vec::new();

        frame_to_rgba_downsampled(&frame, 2, 1, &mut rgba).expect("conversion should succeed");

        assert_eq!(rgba, vec![1, 2, 3, 255, 4, 5, 6, 255]);
    }

    #[test]
    fn frame_to_rgba_into_rgb32_reorders_bgra() {
        let frame =
            NativeCameraFrame::from_rgb_or_yuyv(&[11, 22, 33, 44, 55, 66, 77, 88], 2, 1, 2, 2)
                .expect("valid RGB32 frame");
        let mut rgba = Vec::new();

        frame_to_rgba_into(&frame, &mut rgba).expect("conversion should succeed");

        assert_eq!(rgba, vec![33, 22, 11, 44, 77, 66, 55, 88]);
    }

    #[test]
    fn frame_to_rgba_scaled_into_nv12_resizes_output() {
        let nv12 = vec![
            16_u8, 32, 48, 64, 80, 96, 112, 128, // Y (4x2)
            128, 128, 128, 128, // UV
        ];
        let frame =
            NativeCameraFrame::from_rgb_or_yuyv(&nv12, 4, 2, 8, 3).expect("valid NV12 frame");
        let mut rgba = Vec::new();

        let (dst_width, dst_height) =
            frame_to_rgba_scaled_into(&frame, 2, &mut rgba).expect("conversion should succeed");

        assert_eq!((dst_width, dst_height), (2, 1));
        assert_eq!(rgba.len(), 8);
    }
}
