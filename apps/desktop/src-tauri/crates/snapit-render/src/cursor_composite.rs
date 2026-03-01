//! CPU cursor compositing primitives shared by preview/export adapters.

/// Decoded cursor image ready for compositing.
#[derive(Debug, Clone)]
pub struct DecodedCursorImage {
    pub width: u32,
    pub height: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub data: Vec<u8>, // RGBA
}

/// Video content bounds within the composition frame.
/// Used to correctly position cursor when padding is applied.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VideoContentBounds {
    /// X offset of video content within composition.
    pub x: f32,
    /// Y offset of video content within composition.
    pub y: f32,
    /// Width of video content area.
    pub width: f32,
    /// Height of video content area.
    pub height: f32,
}

impl VideoContentBounds {
    /// Create bounds where video fills the entire frame (no padding).
    pub fn full_frame(frame_width: u32, frame_height: u32) -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: frame_width as f32,
            height: frame_height as f32,
        }
    }

    /// Create bounds with padding (video centered within composition).
    pub fn with_padding(
        _composition_width: u32,
        _composition_height: u32,
        video_width: u32,
        video_height: u32,
        padding: u32,
    ) -> Self {
        Self {
            x: padding as f32,
            y: padding as f32,
            width: video_width as f32,
            height: video_height as f32,
        }
    }
}

/// Cursor state used by CPU compositing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CursorCompositeState {
    pub x: f32,
    pub y: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub opacity: f32,
    pub scale: f32,
}

/// Input bundle for cursor compositing functions.
pub struct CursorCompositeInput<'a> {
    pub frame_data: &'a mut [u8],
    pub frame_width: u32,
    pub frame_height: u32,
    pub video_bounds: &'a VideoContentBounds,
    pub cursor: &'a CursorCompositeState,
    pub cursor_image: &'a DecodedCursorImage,
    pub base_scale: f32,
}

// Motion blur configuration (aligned with existing SnapIt behavior).
const MOTION_BLUR_SAMPLES: usize = 32;
const MOTION_BLUR_BASE_TRAIL_SAMPLES: f32 = 19.0;
const MOTION_BLUR_MIN_VELOCITY: f32 = 0.005;
const MOTION_BLUR_VELOCITY_RAMP_END: f32 = 0.03;
const MOTION_BLUR_MAX_TRAIL: f32 = 0.15;
const MOTION_BLUR_MAX_USER_AMOUNT: f32 = 0.15;
const MOTION_BLUR_VELOCITY_SCALE: f32 = 2.0;
const MAX_MOTION_PIXELS: f32 = 320.0;
const MIN_MOTION_THRESHOLD: f32 = 0.01;

fn smoothstep(low: f32, high: f32, v: f32) -> f32 {
    let t = f32::clamp((v - low) / (high - low), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn sample_cursor_bilinear(cursor_image: &DecodedCursorImage, src_x: f32, src_y: f32) -> [f32; 4] {
    let width = cursor_image.width as i32;
    let height = cursor_image.height as i32;

    if width <= 0 || height <= 0 {
        return [0.0, 0.0, 0.0, 0.0];
    }

    let clamped_x = src_x.clamp(0.0, (width - 1) as f32);
    let clamped_y = src_y.clamp(0.0, (height - 1) as f32);

    let x0 = clamped_x.floor() as i32;
    let y0 = clamped_y.floor() as i32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);

    let tx = clamped_x - x0 as f32;
    let ty = clamped_y - y0 as f32;

    let sample = |x: i32, y: i32| -> [f32; 4] {
        let idx = ((y as u32 * cursor_image.width + x as u32) * 4) as usize;
        if idx + 3 >= cursor_image.data.len() {
            return [0.0, 0.0, 0.0, 0.0];
        }
        [
            cursor_image.data[idx] as f32,
            cursor_image.data[idx + 1] as f32,
            cursor_image.data[idx + 2] as f32,
            cursor_image.data[idx + 3] as f32,
        ]
    };

    let p00 = sample(x0, y0);
    let p10 = sample(x1, y0);
    let p01 = sample(x0, y1);
    let p11 = sample(x1, y1);

    let mut out = [0.0_f32; 4];
    for channel in 0..4 {
        let top = p00[channel] * (1.0 - tx) + p10[channel] * tx;
        let bottom = p01[channel] * (1.0 - tx) + p11[channel] * tx;
        out[channel] = top * (1.0 - ty) + bottom * ty;
    }

    out
}

/// Composite cursor image onto frame (CPU-based).
///
/// Uses cursor opacity and scale for idle fade-out and click animation.
/// The `base_scale` parameter applies additional scaling on top of cursor scale.
pub fn composite_cursor(
    frame_data: &mut [u8],
    frame_width: u32,
    frame_height: u32,
    video_bounds: &VideoContentBounds,
    cursor: &CursorCompositeState,
    cursor_image: &DecodedCursorImage,
    base_scale: f32,
) {
    if cursor.opacity <= 0.0 {
        return;
    }

    let scale = base_scale * cursor.scale;
    if scale <= 0.0 {
        return;
    }

    let pixel_x = video_bounds.x + cursor.x * video_bounds.width;
    let pixel_y = video_bounds.y + cursor.y * video_bounds.height;
    let draw_x = pixel_x - (cursor_image.hotspot_x as f32 * scale);
    let draw_y = pixel_y - (cursor_image.hotspot_y as f32 * scale);

    let scaled_width = cursor_image.width as f32 * scale;
    let scaled_height = cursor_image.height as f32 * scale;
    if scaled_width <= 0.0 || scaled_height <= 0.0 {
        return;
    }

    let min_x = draw_x.floor().max(0.0) as i32;
    let min_y = draw_y.floor().max(0.0) as i32;
    let max_x = (draw_x + scaled_width).ceil().min(frame_width as f32) as i32;
    let max_y = (draw_y + scaled_height).ceil().min(frame_height as f32) as i32;
    if min_x >= max_x || min_y >= max_y {
        return;
    }

    for dst_y in min_y..max_y {
        for dst_x in min_x..max_x {
            let src_x = ((dst_x as f32 + 0.5) - draw_x) / scale - 0.5;
            let src_y = ((dst_y as f32 + 0.5) - draw_y) / scale - 0.5;

            if src_x < 0.0
                || src_y < 0.0
                || src_x > (cursor_image.width as f32 - 1.0)
                || src_y > (cursor_image.height as f32 - 1.0)
            {
                continue;
            }

            let [src_r, src_g, src_b, src_a] = sample_cursor_bilinear(cursor_image, src_x, src_y);
            if src_a <= 0.0 {
                continue;
            }

            let dst_idx = ((dst_y as u32 * frame_width + dst_x as u32) * 4) as usize;
            if dst_idx + 3 >= frame_data.len() {
                continue;
            }

            let alpha = (src_a / 255.0) * cursor.opacity;
            let inv_alpha = 1.0 - alpha;

            frame_data[dst_idx] = ((src_r * cursor.opacity)
                + (frame_data[dst_idx] as f32 * inv_alpha))
                .min(255.0) as u8;
            frame_data[dst_idx + 1] = ((src_g * cursor.opacity)
                + (frame_data[dst_idx + 1] as f32 * inv_alpha))
                .min(255.0) as u8;
            frame_data[dst_idx + 2] = ((src_b * cursor.opacity)
                + (frame_data[dst_idx + 2] as f32 * inv_alpha))
                .min(255.0) as u8;
            // Keep destination alpha.
        }
    }
}

/// Composite cursor with motion blur effect onto frame (CPU-based).
pub fn composite_cursor_with_motion_blur(input: CursorCompositeInput<'_>, motion_blur_amount: f32) {
    let CursorCompositeInput {
        frame_data,
        frame_width,
        frame_height,
        video_bounds,
        cursor,
        cursor_image,
        base_scale,
    } = input;

    let motion_blur_amount = motion_blur_amount.clamp(0.0, MOTION_BLUR_MAX_USER_AMOUNT);
    if motion_blur_amount <= 0.0 {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    let velocity_magnitude =
        (cursor.velocity_x * cursor.velocity_x + cursor.velocity_y * cursor.velocity_y).sqrt();
    if velocity_magnitude < MOTION_BLUR_MIN_VELOCITY {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    let velocity_factor = smoothstep(
        MOTION_BLUR_MIN_VELOCITY,
        MOTION_BLUR_VELOCITY_RAMP_END,
        velocity_magnitude,
    );
    if velocity_factor <= 0.0 {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    let frame_diagonal = ((frame_width * frame_width + frame_height * frame_height) as f32).sqrt();
    let motion_pixels = velocity_magnitude * frame_diagonal * MOTION_BLUR_VELOCITY_SCALE;
    let clamped_motion = motion_pixels.min(MAX_MOTION_PIXELS);

    let trail_length = ((clamped_motion / frame_diagonal).min(MOTION_BLUR_MAX_TRAIL))
        * motion_blur_amount
        * velocity_factor;
    if trail_length < MIN_MOTION_THRESHOLD {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    let dir_x = -cursor.velocity_x / velocity_magnitude;
    let dir_y = -cursor.velocity_y / velocity_magnitude;
    let trail_sample_count = (MOTION_BLUR_SAMPLES.saturating_sub(1)) as f32;
    let weight_normalization = if trail_sample_count > 0.0 {
        MOTION_BLUR_BASE_TRAIL_SAMPLES / trail_sample_count
    } else {
        1.0
    };

    for i in (1..MOTION_BLUR_SAMPLES).rev() {
        let t = i as f32 / (MOTION_BLUR_SAMPLES - 1) as f32;
        let eased_t = smoothstep(0.0, 1.0, t);
        let offset_x = dir_x * trail_length * eased_t;
        let offset_y = dir_y * trail_length * eased_t;
        let weight = (1.0 - t * 0.75) * motion_blur_amount * velocity_factor * weight_normalization;
        if weight <= 0.0 {
            continue;
        }

        let trail_cursor = CursorCompositeState {
            x: cursor.x + offset_x,
            y: cursor.y + offset_y,
            velocity_x: cursor.velocity_x,
            velocity_y: cursor.velocity_y,
            opacity: cursor.opacity * weight,
            scale: cursor.scale,
        };

        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            &trail_cursor,
            cursor_image,
            base_scale,
        );
    }

    composite_cursor(
        frame_data,
        frame_width,
        frame_height,
        video_bounds,
        cursor,
        cursor_image,
        base_scale,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_cursor_image(size: u32) -> DecodedCursorImage {
        let mut data = vec![0u8; (size * size * 4) as usize];
        for y in 0..size {
            for x in 0..size {
                let idx = ((y * size + x) * 4) as usize;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = 255;
            }
        }
        DecodedCursorImage {
            width: size,
            height: size,
            hotspot_x: (size / 2) as i32,
            hotspot_y: (size / 2) as i32,
            data,
        }
    }

    #[test]
    fn composite_cursor_draws_non_zero_pixels() {
        let mut frame = vec![0u8; (64 * 64 * 4) as usize];
        let cursor = CursorCompositeState {
            x: 0.5,
            y: 0.5,
            velocity_x: 0.0,
            velocity_y: 0.0,
            opacity: 1.0,
            scale: 1.0,
        };
        composite_cursor(
            &mut frame,
            64,
            64,
            &VideoContentBounds::full_frame(64, 64),
            &cursor,
            &sample_cursor_image(12),
            1.0,
        );

        assert!(frame.iter().any(|v| *v > 0));
    }

    #[test]
    fn motion_blur_falls_back_for_low_velocity() {
        let mut frame_no_blur = vec![0u8; (64 * 64 * 4) as usize];
        let mut frame_blur_call = vec![0u8; (64 * 64 * 4) as usize];
        let cursor = CursorCompositeState {
            x: 0.5,
            y: 0.5,
            velocity_x: 0.0,
            velocity_y: 0.0,
            opacity: 1.0,
            scale: 1.0,
        };
        let bounds = VideoContentBounds::full_frame(64, 64);
        let image = sample_cursor_image(12);

        composite_cursor(&mut frame_no_blur, 64, 64, &bounds, &cursor, &image, 1.0);
        composite_cursor_with_motion_blur(
            CursorCompositeInput {
                frame_data: &mut frame_blur_call,
                frame_width: 64,
                frame_height: 64,
                video_bounds: &bounds,
                cursor: &cursor,
                cursor_image: &image,
                base_scale: 1.0,
            },
            1.0,
        );

        assert_eq!(frame_no_blur, frame_blur_call);
    }
}
