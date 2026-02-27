//! Storage for pre-rendered text images from the frontend.
//!
//! The frontend renders text using OffscreenCanvas (same font rasterizer as CSS)
//! and sends the RGBA pixel data here for compositing during export.

use std::collections::HashMap;
use std::sync::Arc;

use crate::commands::video_recording::video_project::{TextAnimation, TextSegment};
use crate::rendering::types::ZoomState;

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
    /// RGBA pixel data (shared via Arc to avoid per-frame cloning).
    pub rgba_data: Arc<Vec<u8>>,
    /// Per-line layout for typewriter reveal: each entry is
    /// `(line_top_px, line_height_px, cumulative_char_count)`.
    /// When empty, falls back to proportional-width clipping.
    pub line_metrics: Vec<LineMetric>,
}

/// Layout info for a single rendered line of text.
#[derive(Debug, Clone)]
pub struct LineMetric {
    /// Y offset from top of the pre-rendered image (pixels).
    pub top_px: u32,
    /// Height of this line box (pixels).
    pub height_px: u32,
    /// Cumulative character count at the END of this line (across all prior lines + this one).
    pub cumulative_chars: usize,
    /// Pixel width of the actual text content on this line.
    pub content_width_px: u32,
    /// Reveal width after each grapheme on this line.
    pub reveal_widths_px: Vec<u32>,
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
    /// RGBA pixel data (shared Arc — zero-copy from store).
    pub rgba_data: Arc<Vec<u8>>,
    /// Source image dimensions.
    pub src_w: u32,
    pub src_h: u32,
    /// Zoom scale factor (1.0 = no scaling).
    pub zoom_scale: f64,
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

/// Region of the pre-rendered image to reveal for typewriter animation.
struct TypewriterReveal {
    /// How many rows from the top to show in full.
    full_height_px: u32,
    /// Left edge of actual text content on the last visible line.
    last_line_content_left_px: u32,
    /// Width of revealed text content on the last visible line.
    last_line_content_width_px: u32,
    /// Y offset where the last (partial) line starts.
    last_line_top_px: u32,
    /// Height of the last (partial) line.
    last_line_height_px: u32,
}

fn calculate_typewriter_reveal(
    segment: &TextSegment,
    image: &PreRenderedTextImage,
    frame_time: f64,
) -> Option<TypewriterReveal> {
    if segment.animation != TextAnimation::TypeWriter {
        return None; // No clipping needed
    }

    let total_chars = image
        .line_metrics
        .last()
        .map(|metric| metric.cumulative_chars)
        .filter(|count| *count > 0)
        .unwrap_or_else(|| segment.content.chars().count());
    if total_chars == 0 {
        return Some(TypewriterReveal {
            full_height_px: 0,
            last_line_content_left_px: 0,
            last_line_content_width_px: 0,
            last_line_top_px: 0,
            last_line_height_px: 0,
        });
    }

    let chars_per_second = calculate_effective_typewriter_chars_per_second(segment, total_chars);
    let elapsed = (frame_time - segment.start).max(0.0);
    let visible_chars = (elapsed * chars_per_second).floor() as usize;
    let clamped_visible = visible_chars.min(total_chars);

    if clamped_visible == 0 {
        return Some(TypewriterReveal {
            full_height_px: 0,
            last_line_content_left_px: 0,
            last_line_content_width_px: 0,
            last_line_top_px: 0,
            last_line_height_px: 0,
        });
    }

    if clamped_visible >= total_chars {
        return None; // Fully revealed
    }

    // If we have per-line metrics, do line-aware clipping
    if !image.line_metrics.is_empty() {
        let mut prev_cumulative = 0usize;
        for metric in &image.line_metrics {
            if clamped_visible <= metric.cumulative_chars {
                // This is the line being partially revealed
                let chars_on_this_line = metric.cumulative_chars - prev_cumulative;
                let chars_visible_on_this_line = clamped_visible - prev_cumulative;

                // Text is center-aligned, so the left edge of actual content is
                // offset from the image's left edge. Include that blank space in
                // the reveal so the clip reaches the visible text immediately.
                let text_left =
                    (image.width as f64 / 2.0 - metric.content_width_px as f64 / 2.0).max(0.0);

                // Prefer measured grapheme reveal widths for exact glyph boundaries.
                let measured_reveal = if chars_visible_on_this_line > 0 {
                    metric
                        .reveal_widths_px
                        .get(chars_visible_on_this_line.saturating_sub(1))
                        .copied()
                } else {
                    Some(0)
                };

                let reveal_content_width = measured_reveal
                    .unwrap_or_else(|| {
                        let fraction = if chars_on_this_line > 0 {
                            chars_visible_on_this_line as f64 / chars_on_this_line as f64
                        } else {
                            1.0
                        };
                        (metric.content_width_px as f64 * fraction).ceil() as u32
                    })
                    .min(metric.content_width_px);

                return Some(TypewriterReveal {
                    full_height_px: metric.top_px,
                    last_line_content_left_px: text_left.floor() as u32,
                    last_line_content_width_px: reveal_content_width
                        .clamp(1, metric.content_width_px),
                    last_line_top_px: metric.top_px,
                    last_line_height_px: metric.height_px,
                });
            }
            prev_cumulative = metric.cumulative_chars;
        }
    }

    // Fallback: proportional width clipping (single-line or no metrics)
    let reveal_w = ((image.width as f64 * (clamped_visible as f64 / total_chars as f64)).ceil()
        as u32)
        .clamp(1, image.width);
    Some(TypewriterReveal {
        full_height_px: 0,
        last_line_content_left_px: 0,
        last_line_content_width_px: reveal_w,
        last_line_top_px: 0,
        last_line_height_px: image.height,
    })
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

    /// Log a summary of registered images (call once at export start).
    pub fn log_summary(&self) {
        log::info!(
            "[PreRenderedText] {} image(s) registered",
            self.images.len()
        );
        for (idx, image) in &self.images {
            log::info!(
                "[PreRenderedText]   segment {}: {}x{} ({:.1}KB), center=({:.3},{:.3}), size=({:.3},{:.3}), {} line metrics",
                idx,
                image.width,
                image.height,
                (image.width * image.height * 4) as f32 / 1024.0,
                image.center_x,
                image.center_y,
                image.size_x,
                image.size_y,
                image.line_metrics.len()
            );
        }
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
        zoom: ZoomState,
    ) -> Vec<TextCompositeInfo> {
        let mut result = Vec::new();

        for (idx, image) in &self.images {
            let idx = *idx;
            if idx >= segments.len() {
                log::warn!(
                    "[PreRenderedText] Segment index {} >= segments.len() {}",
                    idx,
                    segments.len()
                );
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

            // Apply zoom transform to text center (same math as cursor zoom).
            let (zoomed_cx, zoomed_cy) = if zoom.scale > 1.0 {
                let s = zoom.scale as f64;
                let zx =
                    0.5 - (zoom.center_x as f64 - 0.5) * (s - 1.0) + (image.center_x - 0.5) * s;
                let zy =
                    0.5 - (zoom.center_y as f64 - 0.5) * (s - 1.0) + (image.center_y - 0.5) * s;
                (zx, zy)
            } else {
                (image.center_x, image.center_y)
            };

            // Scale text image size by zoom factor.
            let scale = (zoom.scale as f64).max(1.0);
            let scaled_w = (image.width as f64 * scale).round();
            let scaled_h = (image.height as f64 * scale).round();

            // Map from video-content-relative coords to composition pixel coords.
            let half_w = scaled_w / 2.0;
            let half_h = scaled_h / 2.0;
            let center_px_x = video_x as f64 + zoomed_cx * video_w as f64;
            let center_px_y = video_y as f64 + zoomed_cy * video_h as f64;

            // Allow negative positions — text can overflow edges and gets clipped.
            // When the top-left is negative, skip destination pixels accordingly.
            // src_offset is in *scaled* pixels (will be mapped back to source in compositor).
            let raw_x = (center_px_x - half_w).round();
            let raw_y = (center_px_y - half_h).round();
            let scaled_w_u = scaled_w as u32;
            let scaled_h_u = scaled_h as u32;
            let src_offset_x = if raw_x < 0.0 { (-raw_x) as u32 } else { 0 };
            let src_offset_y = if raw_y < 0.0 { (-raw_y) as u32 } else { 0 };
            let dst_x = raw_x.max(0.0) as u32;
            let dst_y = raw_y.max(0.0) as u32;
            let dst_w = scaled_w_u
                .saturating_sub(src_offset_x)
                .min(output_w.saturating_sub(dst_x));

            // Typewriter: progressively reveal text line-by-line.
            // Reveal dimensions are in source-image pixels; scale to output.
            if let Some(reveal) = calculate_typewriter_reveal(segment, image, frame_time) {
                let s = scale;
                let reveal_full_h = (reveal.full_height_px as f64 * s).round() as u32;
                let reveal_last_h = (reveal.last_line_height_px as f64 * s).round() as u32;
                let reveal_last_top = (reveal.last_line_top_px as f64 * s).round() as u32;
                let reveal_last_left = (reveal.last_line_content_left_px as f64 * s).floor() as u32;
                let reveal_last_content_w =
                    (reveal.last_line_content_width_px as f64 * s).ceil() as u32;
                let reveal_last_right = reveal_last_left.saturating_add(reveal_last_content_w);

                let total_reveal_h = reveal_full_h + reveal_last_h;
                if total_reveal_h == 0 || reveal_last_content_w == 0 {
                    continue;
                }

                // Emit fully-revealed lines (top portion).
                // Start from the first line's top to skip blank space above text.
                let content_start = if !image.line_metrics.is_empty() {
                    (image.line_metrics[0].top_px as f64 * s).floor() as u32
                } else {
                    0
                };
                let tight_src_y = src_offset_y.max(content_start);
                if reveal_full_h > 0 && tight_src_y < reveal_full_h {
                    let tight_dst_y = dst_y + (tight_src_y - src_offset_y);
                    let full_dst_h =
                        (reveal_full_h - tight_src_y).min(output_h.saturating_sub(tight_dst_y));
                    if full_dst_h > 0 && dst_w > 0 {
                        result.push(TextCompositeInfo {
                            dst_x,
                            dst_y: tight_dst_y,
                            dst_w,
                            dst_h: full_dst_h,
                            src_offset_x,
                            src_offset_y: tight_src_y,
                            opacity,
                            rgba_data: image.rgba_data.clone(),
                            src_w: image.width,
                            src_h: image.height,
                            zoom_scale: scale,
                        });
                    }
                }

                // Emit partially-revealed current line
                if reveal_last_h > 0 {
                    let line_src_offset_y = if src_offset_y > reveal_last_top {
                        src_offset_y - reveal_last_top
                    } else {
                        0
                    };
                    let line_dst_y_offset = if reveal_last_top > src_offset_y {
                        reveal_last_top - src_offset_y
                    } else {
                        0
                    };
                    let line_dst_y = dst_y + line_dst_y_offset;
                    let line_dst_h = (reveal_last_h - line_src_offset_y)
                        .min(output_h.saturating_sub(line_dst_y));
                    let line_src_offset_x = src_offset_x.max(reveal_last_left);
                    let line_dst_x_offset = line_src_offset_x.saturating_sub(src_offset_x);
                    let line_dst_x = dst_x + line_dst_x_offset;
                    let line_dst_w = dst_w
                        .saturating_sub(line_dst_x_offset)
                        .min(reveal_last_right.saturating_sub(line_src_offset_x));

                    if line_dst_h > 0 && line_dst_w > 0 {
                        result.push(TextCompositeInfo {
                            dst_x: line_dst_x,
                            dst_y: line_dst_y,
                            dst_w: line_dst_w,
                            dst_h: line_dst_h,
                            src_offset_x: line_src_offset_x,
                            src_offset_y: reveal_last_top + line_src_offset_y,
                            opacity,
                            rgba_data: image.rgba_data.clone(),
                            src_w: image.width,
                            src_h: image.height,
                            zoom_scale: scale,
                        });
                    }
                }
            } else {
                // No typewriter animation or fully revealed.
                // Tighten vertical bounds to content rows to avoid blitting
                // large blank regions above/below the centered text.
                let (content_top, content_bottom) = if !image.line_metrics.is_empty() {
                    let first = &image.line_metrics[0];
                    let last = &image.line_metrics[image.line_metrics.len() - 1];
                    let top = (first.top_px as f64 * scale).floor() as u32;
                    let bottom = ((last.top_px + last.height_px) as f64 * scale).ceil() as u32;
                    (top, bottom.min(scaled_h_u))
                } else {
                    (0, scaled_h_u)
                };

                // Adjust source and destination for the tight content rect.
                let tight_src_y = src_offset_y.max(content_top);
                let tight_dst_y = dst_y + (tight_src_y - src_offset_y);
                let tight_dst_h = content_bottom
                    .saturating_sub(tight_src_y)
                    .min(output_h.saturating_sub(tight_dst_y));

                if dst_w == 0 || tight_dst_h == 0 {
                    continue;
                }

                result.push(TextCompositeInfo {
                    dst_x,
                    dst_y: tight_dst_y,
                    dst_w,
                    dst_h: tight_dst_h,
                    src_offset_x,
                    src_offset_y: tight_src_y,
                    opacity,
                    rgba_data: image.rgba_data.clone(),
                    src_w: image.width,
                    src_h: image.height,
                    zoom_scale: scale,
                });
            }
        }

        result
    }
}

/// Sample a source pixel with bilinear interpolation, returning (r, g, b, a) as f32.
#[inline]
fn sample_bilinear(rgba: &[u8], src_w: u32, src_h: u32, sx: f64, sy: f64) -> (f32, f32, f32, f32) {
    let x0 = (sx.floor() as i64).clamp(0, src_w as i64 - 1) as u32;
    let y0 = (sy.floor() as i64).clamp(0, src_h as i64 - 1) as u32;
    let x1 = (x0 + 1).min(src_w - 1);
    let y1 = (y0 + 1).min(src_h - 1);
    let fx = (sx - sx.floor()) as f32;
    let fy = (sy - sy.floor()) as f32;

    let stride = src_w as usize * 4;
    let i00 = y0 as usize * stride + x0 as usize * 4;
    let i10 = y0 as usize * stride + x1 as usize * 4;
    let i01 = y1 as usize * stride + x0 as usize * 4;
    let i11 = y1 as usize * stride + x1 as usize * 4;

    let mut out = [0.0f32; 4];
    for c in 0..4 {
        let c00 = rgba.get(i00 + c).copied().unwrap_or(0) as f32;
        let c10 = rgba.get(i10 + c).copied().unwrap_or(0) as f32;
        let c01 = rgba.get(i01 + c).copied().unwrap_or(0) as f32;
        let c11 = rgba.get(i11 + c).copied().unwrap_or(0) as f32;
        out[c] = c00 * (1.0 - fx) * (1.0 - fy)
            + c10 * fx * (1.0 - fy)
            + c01 * (1.0 - fx) * fy
            + c11 * fx * fy;
    }
    (out[0], out[1], out[2], out[3])
}

/// Alpha-blend pre-rendered text images onto an RGBA frame buffer (CPU-based).
///
/// This is called after GPU compositing and texture readback, just before
/// sending the frame to the encoder. Two paths:
/// - **No zoom (fast)**: direct integer indexing, integer-only alpha blending.
/// - **Zoomed**: bilinear sampling for smooth upscaling.
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

        if text.zoom_scale > 1.001 {
            composite_text_scaled(frame, frame_w, frame_h, stride, text);
        } else {
            composite_text_fast(frame, frame_w, frame_h, stride, text);
        }
    }
}

/// Integer alpha blend: `dst = (src * a + dst * (255 - a) + 128) / 255`
/// Avoids all float math. The `+ 128` rounds to nearest instead of truncating.
#[inline(always)]
fn blend_u8(src: u8, dst: u8, alpha: u32) -> u8 {
    let inv = 255 - alpha;
    ((src as u32 * alpha + dst as u32 * inv + 128) / 255) as u8
}

/// Fast path: 1:1 pixel blit with integer-only alpha blending.
/// No float math at all — uses `(src * a + dst * (255-a) + 128) / 255`.
/// Skips fully-transparent source pixels with a cheap byte check.
#[inline]
fn composite_text_fast(
    frame: &mut [u8],
    frame_w: u32,
    frame_h: u32,
    stride: usize,
    text: &TextCompositeInfo,
) {
    let src_stride = text.src_w as usize * 4;
    let src_data = &*text.rgba_data;
    // Pre-compute integer opacity (0-255) once outside the loop.
    let opacity_u = (text.opacity * 255.0 + 0.5) as u32;
    let full_opacity = opacity_u >= 255;

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
            let sa_raw = src_data[si + 3];

            // Skip transparent pixels — most of the text image is empty.
            if sa_raw == 0 {
                continue;
            }

            let di = dst_row_offset + dx as usize * 4;

            // Compute effective alpha entirely in integer math.
            let alpha = if full_opacity {
                sa_raw as u32
            } else {
                (sa_raw as u32 * opacity_u + 128) / 255
            };

            if alpha >= 255 {
                // Fully opaque: direct copy, no blending needed.
                frame[di] = src_data[si];
                frame[di + 1] = src_data[si + 1];
                frame[di + 2] = src_data[si + 2];
                frame[di + 3] = 255;
            } else {
                frame[di] = blend_u8(src_data[si], frame[di], alpha);
                frame[di + 1] = blend_u8(src_data[si + 1], frame[di + 1], alpha);
                frame[di + 2] = blend_u8(src_data[si + 2], frame[di + 2], alpha);
                // Output alpha: src_a + dst_a * (1 - src_a)
                let dst_a = frame[di + 3] as u32;
                frame[di + 3] = (alpha + (dst_a * (255 - alpha) + 128) / 255).min(255) as u8;
            }
        }
    }
}

/// Scaled path: bilinear sampling for zoomed text.
/// Bilinear interpolation requires float math for sampling, but the final
/// alpha blend uses the same integer approach as the fast path.
#[inline]
fn composite_text_scaled(
    frame: &mut [u8],
    frame_w: u32,
    frame_h: u32,
    stride: usize,
    text: &TextCompositeInfo,
) {
    let inv_scale = 1.0 / text.zoom_scale;
    let opacity_u = (text.opacity * 255.0 + 0.5) as u32;
    let full_opacity = opacity_u >= 255;
    let src_w_f = text.src_w as f64;
    let src_h_f = text.src_h as f64;

    for row in 0..text.dst_h {
        let dy = text.dst_y + row;
        if dy >= frame_h {
            break;
        }

        let dst_row_offset = dy as usize * stride;
        let src_fy = (text.src_offset_y + row) as f64 * inv_scale;
        if src_fy >= src_h_f {
            continue;
        }

        for col in 0..text.dst_w {
            let dx = text.dst_x + col;
            if dx >= frame_w {
                break;
            }

            let src_fx = (text.src_offset_x + col) as f64 * inv_scale;
            if src_fx >= src_w_f {
                continue;
            }

            let (sr, sg, sb, sa) =
                sample_bilinear(&text.rgba_data, text.src_w, text.src_h, src_fx, src_fy);

            // Convert bilinear result to integer alpha for blending.
            let sa_u = (sa + 0.5) as u32;
            if sa_u == 0 {
                continue;
            }

            let alpha = if full_opacity {
                sa_u.min(255)
            } else {
                (sa_u * opacity_u + 128) / 255
            };
            if alpha == 0 {
                continue;
            }

            let di = dst_row_offset + dx as usize * 4;
            if di + 3 >= frame.len() {
                continue;
            }

            let sr_u = (sr + 0.5) as u8;
            let sg_u = (sg + 0.5) as u8;
            let sb_u = (sb + 0.5) as u8;

            if alpha >= 255 {
                frame[di] = sr_u;
                frame[di + 1] = sg_u;
                frame[di + 2] = sb_u;
                frame[di + 3] = 255;
            } else {
                frame[di] = blend_u8(sr_u, frame[di], alpha);
                frame[di + 1] = blend_u8(sg_u, frame[di + 1], alpha);
                frame[di + 2] = blend_u8(sb_u, frame[di + 2], alpha);
                let dst_a = frame[di + 3] as u32;
                frame[di + 3] = (alpha + (dst_a * (255 - alpha) + 128) / 255).min(255) as u8;
            }
        }
    }
}
