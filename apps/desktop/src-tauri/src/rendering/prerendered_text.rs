//! Storage for pre-rendered text images from the frontend.
//!
//! The frontend renders text using OffscreenCanvas (same font rasterizer as CSS)
//! and sends the RGBA pixel data here for compositing during export.

use std::collections::HashMap;

use crate::commands::video_recording::video_project::{TextAnimation, TextSegment};

/// A pre-rendered text image from the frontend.
#[derive(Debug, Clone)]
pub struct PreRenderedTextImage {
    pub segment_index: usize,
    pub width: u32,
    pub height: u32,
    /// Center position (normalized 0-1).
    pub center_x: f64,
    pub center_y: f64,
    /// Bounding box size (normalized 0-1).
    pub size_x: f64,
    pub size_y: f64,
    /// RGBA pixel data.
    pub rgba_data: Vec<u8>,
}

/// Data needed to composite a pre-rendered text image onto a frame.
pub struct TextCompositeInfo {
    /// Destination rectangle in pixels: (x, y, width, height).
    pub dst_x: u32,
    pub dst_y: u32,
    pub dst_w: u32,
    pub dst_h: u32,
    /// Source offset when text overflows left/top edges (pixels clipped).
    pub src_offset_x: u32,
    pub src_offset_y: u32,
    /// Opacity (0.0-1.0) from fade animation.
    pub opacity: f32,
    /// RGBA pixel data (pre-rendered at correct size).
    pub rgba_data: Vec<u8>,
    /// Source image dimensions.
    pub src_w: u32,
    pub src_h: u32,
}

/// Store for pre-rendered text images.
#[derive(Default)]
pub struct PreRenderedTextStore {
    images: HashMap<usize, PreRenderedTextImage>,
}

fn calculate_segment_opacity(segment: &TextSegment, frame_time: f64) -> f32 {
    let fade_duration = segment.fade_duration.max(0.0);
    if fade_duration <= 0.0 {
        return 1.0;
    }

    let time_since_start = frame_time - segment.start;
    let time_until_end = segment.end - frame_time;
    let segment_duration = segment.end - segment.start;

    let apply_intro = matches!(
        segment.animation,
        TextAnimation::None | TextAnimation::TypeWriter
    );
    let apply_outro = matches!(
        segment.animation,
        TextAnimation::None | TextAnimation::TypeWriter
    );

    if apply_intro && time_since_start < fade_duration {
        return (time_since_start / fade_duration).clamp(0.0, 1.0) as f32;
    }

    if apply_outro && time_until_end < fade_duration && segment_duration > fade_duration * 2.0 {
        return (time_until_end / fade_duration).clamp(0.0, 1.0) as f32;
    }

    1.0
}

fn calculate_typewriter_typing_window_secs(segment: &TextSegment) -> f64 {
    let segment_duration = (segment.end - segment.start).max(0.0);
    let fade_duration = segment.fade_duration.max(0.0);
    let has_fade_out_window = fade_duration > 0.0 && segment_duration > fade_duration * 2.0;
    let outro_duration = if has_fade_out_window {
        fade_duration
    } else {
        0.0
    };
    (segment_duration - outro_duration).max(0.0)
}

fn calculate_effective_typewriter_chars_per_second(
    segment: &TextSegment,
    total_chars: usize,
) -> f64 {
    let requested = segment.typewriter_chars_per_second.clamp(1.0, 60.0) as f64;
    if total_chars == 0 {
        return requested;
    }

    let typing_window_secs = calculate_typewriter_typing_window_secs(segment);
    if typing_window_secs <= 0.0 {
        return requested;
    }

    let minimum_required = total_chars as f64 / typing_window_secs;
    requested.max(minimum_required)
}

fn calculate_typewriter_reveal_width(
    segment: &TextSegment,
    image_width: u32,
    frame_time: f64,
) -> u32 {
    if segment.animation != TextAnimation::TypeWriter {
        return image_width;
    }

    let total_chars = segment.content.chars().count();
    if total_chars == 0 {
        return 0;
    }

    let chars_per_second = calculate_effective_typewriter_chars_per_second(segment, total_chars);
    let elapsed = (frame_time - segment.start).max(0.0);
    let visible_chars = (elapsed * chars_per_second).floor() as usize;
    let clamped_visible_chars = visible_chars.min(total_chars);
    if clamped_visible_chars == 0 {
        return 0;
    }

    ((image_width as f64 * (clamped_visible_chars as f64 / total_chars as f64)).ceil() as u32)
        .clamp(1, image_width)
}

impl PreRenderedTextStore {
    pub fn new() -> Self {
        Self {
            images: HashMap::new(),
        }
    }

    /// Register a pre-rendered text image.
    pub fn register(&mut self, image: PreRenderedTextImage) {
        self.images.insert(image.segment_index, image);
    }

    /// Clear all stored images.
    pub fn clear(&mut self) {
        self.images.clear();
    }

    /// Get pre-rendered text images visible at the given frame time.
    /// Returns compositing info with pixel bounds and opacity for each visible segment.
    pub fn get_for_frame(
        &self,
        frame_time: f64,
        segments: &[TextSegment],
        output_w: u32,
        output_h: u32,
        video_x: u32,
        video_y: u32,
        video_w: u32,
        video_h: u32,
    ) -> Vec<TextCompositeInfo> {
        let mut result = Vec::new();

        for (idx, image) in &self.images {
            let idx = *idx;
            if idx >= segments.len() {
                continue;
            }

            let segment = &segments[idx];
            if !segment.enabled {
                continue;
            }
            if frame_time < segment.start || frame_time > segment.end {
                continue;
            }

            let opacity = calculate_segment_opacity(segment, frame_time);

            if opacity < 0.001 {
                continue;
            }

            // Map from video-content-relative coords to composition pixel coords.
            // Use actual image dimensions for half-size (not size_x * video_w) because
            // the pre-rendered image includes padding for anti-aliasing.
            let half_w = image.width as f64 / 2.0;
            let half_h = image.height as f64 / 2.0;
            let center_px_x = video_x as f64 + image.center_x * video_w as f64;
            let center_px_y = video_y as f64 + image.center_y * video_h as f64;

            // Allow negative positions — text can overflow edges and gets clipped.
            // When the top-left is negative, skip source pixels accordingly.
            let raw_x = (center_px_x - half_w).round();
            let raw_y = (center_px_y - half_h).round();
            let src_offset_x = if raw_x < 0.0 { (-raw_x) as u32 } else { 0 };
            let src_offset_y = if raw_y < 0.0 { (-raw_y) as u32 } else { 0 };
            let dst_x = raw_x.max(0.0) as u32;
            let dst_y = raw_y.max(0.0) as u32;
            let mut dst_w = image
                .width
                .saturating_sub(src_offset_x)
                .min(output_w.saturating_sub(dst_x));
            let dst_h = image
                .height
                .saturating_sub(src_offset_y)
                .min(output_h.saturating_sub(dst_y));

            // Typewriter: progressively reveal text from left to right.
            // We keep a single pre-rendered image and clip source width per frame.
            let reveal_src_w = calculate_typewriter_reveal_width(segment, image.width, frame_time);
            if reveal_src_w == 0 || src_offset_x >= reveal_src_w {
                continue;
            }
            dst_w = dst_w.min(reveal_src_w - src_offset_x);

            if dst_w == 0 || dst_h == 0 {
                continue;
            }

            result.push(TextCompositeInfo {
                dst_x,
                dst_y,
                dst_w,
                dst_h,
                src_offset_x,
                src_offset_y,
                opacity,
                rgba_data: image.rgba_data.clone(),
                src_w: image.width,
                src_h: image.height,
            });
        }

        result
    }
}

/// Alpha-blend pre-rendered text images onto an RGBA frame buffer (CPU-based).
///
/// This is called after GPU compositing and texture readback, just before
/// sending the frame to the encoder. Pre-rendered images are already at the
/// correct resolution so no scaling is needed — just positioned alpha blending.
pub fn composite_prerendered_texts(
    frame: &mut [u8],
    frame_w: u32,
    frame_h: u32,
    texts: &[TextCompositeInfo],
) {
    let stride = frame_w as usize * 4;

    for text in texts {
        if text.opacity < 0.001 {
            continue;
        }

        let src_stride = text.src_w as usize * 4;

        // Blit each row, accounting for source offsets when text overflows edges
        for row in 0..text.dst_h {
            let sy = text.src_offset_y + row;
            let dy = text.dst_y + row;
            if dy >= frame_h || sy >= text.src_h {
                break;
            }

            let src_row_offset = sy as usize * src_stride;
            let dst_row_offset = dy as usize * stride;

            for col in 0..text.dst_w {
                let sx = text.src_offset_x + col;
                let dx = text.dst_x + col;
                if dx >= frame_w || sx >= text.src_w {
                    break;
                }

                let si = src_row_offset + sx as usize * 4;
                let di = dst_row_offset + dx as usize * 4;

                if si + 3 >= text.rgba_data.len() || di + 3 >= frame.len() {
                    continue;
                }

                let src_a = text.rgba_data[si + 3] as f32 / 255.0 * text.opacity;
                if src_a < 0.001 {
                    continue;
                }

                let inv_a = 1.0 - src_a;
                frame[di] = (text.rgba_data[si] as f32 * src_a + frame[di] as f32 * inv_a) as u8;
                frame[di + 1] =
                    (text.rgba_data[si + 1] as f32 * src_a + frame[di + 1] as f32 * inv_a) as u8;
                frame[di + 2] =
                    (text.rgba_data[si + 2] as f32 * src_a + frame[di + 2] as f32 * inv_a) as u8;
                frame[di + 3] =
                    ((src_a + frame[di + 3] as f32 / 255.0 * inv_a) * 255.0).min(255.0) as u8;
            }
        }
    }
}
