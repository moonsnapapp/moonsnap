//! Reusable frame pixel operations for export compositing.

use moonsnap_render::types::{DecodedFrame, PixelFormat};

/// Bounds of the video content region within a composition frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameContentBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CursorCircleStyle {
    pub scale: f32,
    pub opacity: f32,
}

/// Extract a cropped region from RGBA frame data.
///
/// Returns the cropped RGBA data with proper row ordering.
pub fn extract_crop_region(
    frame_data: &[u8],
    frame_width: u32,
    frame_height: u32,
    crop_x: u32,
    crop_y: u32,
    crop_width: u32,
    crop_height: u32,
) -> Vec<u8> {
    // Clamp crop region to frame bounds.
    let crop_x = crop_x.min(frame_width.saturating_sub(1));
    let crop_y = crop_y.min(frame_height.saturating_sub(1));
    let crop_width = crop_width.min(frame_width.saturating_sub(crop_x));
    let crop_height = crop_height.min(frame_height.saturating_sub(crop_y));

    // Ensure even dimensions for video encoding.
    let crop_width = (crop_width / 2) * 2;
    let crop_height = (crop_height / 2) * 2;

    if crop_width == 0 || crop_height == 0 {
        log::warn!(
            "[CROP] Invalid crop region: {}x{} at ({}, {})",
            crop_width,
            crop_height,
            crop_x,
            crop_y
        );
        return frame_data.to_vec();
    }

    let mut output = Vec::with_capacity((crop_width * crop_height * 4) as usize);
    let src_stride = (frame_width * 4) as usize;
    let crop_stride = (crop_width * 4) as usize;

    for row in 0..crop_height {
        let src_y = crop_y + row;
        let src_row_start = (src_y as usize * src_stride) + (crop_x as usize * 4);
        let src_row_end = src_row_start + crop_stride;

        if src_row_end <= frame_data.len() {
            output.extend_from_slice(&frame_data[src_row_start..src_row_end]);
        } else {
            // Fill with black if out of bounds.
            output.extend(vec![0u8; crop_stride]);
        }
    }

    output
}

/// Crop a decoded frame to the specified region.
pub fn crop_decoded_frame(
    frame: &DecodedFrame,
    crop_x: u32,
    crop_y: u32,
    crop_width: u32,
    crop_height: u32,
) -> DecodedFrame {
    // Clamp crop region to frame bounds.
    let crop_x = crop_x.min(frame.width.saturating_sub(1));
    let crop_y = crop_y.min(frame.height.saturating_sub(1));
    let crop_width = crop_width.min(frame.width.saturating_sub(crop_x));
    let crop_height = crop_height.min(frame.height.saturating_sub(crop_y));

    // Ensure even dimensions for video encoding.
    let crop_width = (crop_width / 2) * 2;
    let crop_height = (crop_height / 2) * 2;

    if crop_width == 0 || crop_height == 0 {
        log::warn!(
            "[CROP] Invalid frame crop: {}x{} at ({}, {})",
            crop_width,
            crop_height,
            crop_x,
            crop_y
        );
        return frame.clone();
    }

    let cropped_data = extract_crop_region(
        &frame.data,
        frame.width,
        frame.height,
        crop_x,
        crop_y,
        crop_width,
        crop_height,
    );

    DecodedFrame {
        frame_number: frame.frame_number,
        timestamp_ms: frame.timestamp_ms,
        data: cropped_data,
        width: crop_width,
        height: crop_height,
        format: PixelFormat::Rgba,
    }
}

/// Scale a frame to cover target dimensions (crop to fill).
pub fn scale_frame_to_fill(frame: &DecodedFrame, target_w: u32, target_h: u32) -> DecodedFrame {
    let src_w = frame.width as f32;
    let src_h = frame.height as f32;
    let target_w_f = target_w as f32;
    let target_h_f = target_h as f32;

    let src_aspect = src_w / src_h;
    let target_aspect = target_w_f / target_h_f;

    // Calculate crop bounds to match target aspect ratio.
    let (crop_x, crop_y, crop_w, crop_h) = if src_aspect > target_aspect {
        // Source is wider than target - crop left/right.
        let visible_width = src_h * target_aspect;
        let crop_x = (src_w - visible_width) / 2.0;
        (crop_x, 0.0, visible_width, src_h)
    } else {
        // Source is taller than target - crop top/bottom.
        let visible_height = src_w / target_aspect;
        let crop_y = (src_h - visible_height) / 2.0;
        (0.0, crop_y, src_w, visible_height)
    };

    // Create output buffer.
    let mut output = vec![0u8; (target_w * target_h * 4) as usize];

    // Scale from cropped region to target.
    let scale_x = target_w_f / crop_w;
    let scale_y = target_h_f / crop_h;

    // Nearest-neighbor scaling from cropped region.
    for dst_y in 0..target_h {
        for dst_x in 0..target_w {
            let src_x = (crop_x + (dst_x as f32 / scale_x)) as u32;
            let src_y = (crop_y + (dst_y as f32 / scale_y)) as u32;

            if src_x < frame.width && src_y < frame.height {
                let src_idx = ((src_y * frame.width + src_x) * 4) as usize;
                let dst_idx = ((dst_y * target_w + dst_x) * 4) as usize;

                if src_idx + 3 < frame.data.len() && dst_idx + 3 < output.len() {
                    output[dst_idx] = frame.data[src_idx];
                    output[dst_idx + 1] = frame.data[src_idx + 1];
                    output[dst_idx + 2] = frame.data[src_idx + 2];
                    output[dst_idx + 3] = frame.data[src_idx + 3];
                }
            }
        }
    }

    DecodedFrame {
        frame_number: frame.frame_number,
        timestamp_ms: frame.timestamp_ms,
        data: output,
        width: target_w,
        height: target_h,
        format: PixelFormat::Rgba,
    }
}

/// Blend source frame over destination with alpha opacity.
/// dest = dest * (1 - alpha) + src * alpha
pub fn blend_frames_alpha(dest: &mut DecodedFrame, src: &DecodedFrame, alpha: f32) {
    if dest.width != src.width || dest.height != src.height {
        log::warn!(
            "[EXPORT] blend_frames_alpha: size mismatch dest={}x{} src={}x{}",
            dest.width,
            dest.height,
            src.width,
            src.height
        );
        return;
    }

    let inv_alpha = 1.0 - alpha;
    for i in (0..dest.data.len()).step_by(4) {
        if i + 3 < src.data.len() {
            dest.data[i] = ((dest.data[i] as f32 * inv_alpha) + (src.data[i] as f32 * alpha)) as u8;
            dest.data[i + 1] =
                ((dest.data[i + 1] as f32 * inv_alpha) + (src.data[i + 1] as f32 * alpha)) as u8;
            dest.data[i + 2] =
                ((dest.data[i + 2] as f32 * inv_alpha) + (src.data[i + 2] as f32 * alpha)) as u8;
            // Keep destination alpha.
        }
    }
}

/// Draw a cursor circle indicator at the given position.
pub fn draw_cursor_circle(
    frame_data: &mut [u8],
    frame_width: u32,
    frame_height: u32,
    video_bounds: &FrameContentBounds,
    cursor_x: f32,
    cursor_y: f32,
    style: CursorCircleStyle,
) {
    let opacity = style.opacity.clamp(0.0, 1.0);
    if opacity <= 0.0 {
        return;
    }

    let base_radius = 12.0;
    let radius = base_radius * style.scale;
    let border_width = 2.0 * style.scale;

    // Convert normalized position to pixel position within video content area.
    let center_x = video_bounds.x + cursor_x * video_bounds.width;
    let center_y = video_bounds.y + cursor_y * video_bounds.height;

    let min_x = ((center_x - radius - border_width).floor() as i32).max(0);
    let max_x = ((center_x + radius + border_width).ceil() as i32).min(frame_width as i32 - 1);
    let min_y = ((center_y - radius - border_width).floor() as i32).max(0);
    let max_y = ((center_y + radius + border_width).ceil() as i32).min(frame_height as i32 - 1);

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x as f32 - center_x;
            let dy = y as f32 - center_y;
            let dist = (dx * dx + dy * dy).sqrt();

            let idx = ((y as u32 * frame_width + x as u32) * 4) as usize;
            if idx + 3 >= frame_data.len() {
                continue;
            }

            let inner_radius = radius - border_width;

            if dist <= inner_radius {
                let alpha = 0.5 * opacity;
                let fill_r = 255u8;
                let fill_g = 255u8;
                let fill_b = 255u8;

                let edge_dist = inner_radius - dist;
                let edge_alpha = if edge_dist < 1.0 {
                    edge_dist * alpha
                } else {
                    alpha
                };
                let inv_alpha = 1.0 - edge_alpha;

                frame_data[idx] =
                    ((fill_r as f32 * edge_alpha) + (frame_data[idx] as f32 * inv_alpha)) as u8;
                frame_data[idx + 1] =
                    ((fill_g as f32 * edge_alpha) + (frame_data[idx + 1] as f32 * inv_alpha)) as u8;
                frame_data[idx + 2] =
                    ((fill_b as f32 * edge_alpha) + (frame_data[idx + 2] as f32 * inv_alpha)) as u8;
            } else if dist <= radius {
                let alpha = 0.7 * opacity;
                let border_r = 50u8;
                let border_g = 50u8;
                let border_b = 50u8;

                let outer_edge = radius - dist;
                let inner_edge = dist - inner_radius;
                let edge_alpha = if outer_edge < 1.0 {
                    outer_edge * alpha
                } else if inner_edge < 1.0 {
                    inner_edge * alpha
                } else {
                    alpha
                };
                let inv_alpha = 1.0 - edge_alpha;

                frame_data[idx] =
                    ((border_r as f32 * edge_alpha) + (frame_data[idx] as f32 * inv_alpha)) as u8;
                frame_data[idx + 1] = ((border_g as f32 * edge_alpha)
                    + (frame_data[idx + 1] as f32 * inv_alpha))
                    as u8;
                frame_data[idx + 2] = ((border_b as f32 * edge_alpha)
                    + (frame_data[idx + 2] as f32 * inv_alpha))
                    as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_rgba_frame(width: u32, height: u32, rgba: [u8; 4]) -> DecodedFrame {
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            data.extend_from_slice(&rgba);
        }

        DecodedFrame {
            frame_number: 0,
            timestamp_ms: 0,
            data,
            width,
            height,
            format: PixelFormat::Rgba,
        }
    }

    #[test]
    fn crop_region_returns_even_dimensions() {
        let frame = solid_rgba_frame(9, 9, [10, 20, 30, 255]);
        let cropped = crop_decoded_frame(&frame, 1, 1, 7, 7);
        assert_eq!(cropped.width, 6);
        assert_eq!(cropped.height, 6);
        assert_eq!(cropped.data.len(), (6 * 6 * 4) as usize);
    }

    #[test]
    fn scale_to_fill_matches_requested_dimensions() {
        let frame = solid_rgba_frame(1280, 720, [200, 100, 50, 255]);
        let scaled = scale_frame_to_fill(&frame, 640, 640);
        assert_eq!(scaled.width, 640);
        assert_eq!(scaled.height, 640);
        assert_eq!(scaled.data.len(), (640 * 640 * 4) as usize);
    }

    #[test]
    fn blend_alpha_changes_destination_pixels() {
        let mut dest = solid_rgba_frame(2, 2, [0, 0, 0, 255]);
        let src = solid_rgba_frame(2, 2, [200, 100, 50, 255]);
        blend_frames_alpha(&mut dest, &src, 0.5);

        assert_eq!(dest.data[0], 100);
        assert_eq!(dest.data[1], 50);
        assert_eq!(dest.data[2], 25);
    }

    #[test]
    fn draw_cursor_circle_writes_pixels() {
        let mut frame = vec![0u8; (200 * 200 * 4) as usize];
        draw_cursor_circle(
            &mut frame,
            200,
            200,
            &FrameContentBounds {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 200.0,
            },
            0.5,
            0.5,
            CursorCircleStyle {
                scale: 1.0,
                opacity: 1.0,
            },
        );

        let mut has_non_zero = false;
        for chunk in frame.chunks_exact(4) {
            if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                has_non_zero = true;
                break;
            }
        }
        assert!(has_non_zero);
    }
}
