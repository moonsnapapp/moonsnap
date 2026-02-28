//! Core types for GPU-accelerated video rendering.

use std::path::Path;

use super::background::hex_to_linear_rgba;
use super::coord::{Coord, FrameSpace, Size};
pub use crate::zoom_state::ZoomState;
use serde::{Deserialize, Serialize};
use snapit_domain::video_project::{
    BackgroundConfig, BackgroundType as ProjectBackgroundType, CornerStyle as ProjectCornerStyle,
};
use ts_rs::TS;

/// Pixel format of decoded frame data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    /// RGBA 8-bit per channel (width * height * 4 bytes).
    Rgba,
    /// NV12: Y plane (width * height) followed by interleaved UV plane (width * height / 2).
    /// Total size: width * height * 3 / 2 bytes.
    Nv12,
}

/// A decoded video frame ready for GPU upload.
#[derive(Debug, Clone)]
pub struct DecodedFrame {
    /// Frame number (0-indexed).
    pub frame_number: u32,
    /// Timestamp in milliseconds.
    pub timestamp_ms: u64,
    /// Pixel data (layout depends on `format`).
    pub data: Vec<u8>,
    /// Frame width in pixels.
    pub width: u32,
    /// Frame height in pixels.
    pub height: u32,
    /// Pixel format of the data.
    pub format: PixelFormat,
}

impl DecodedFrame {
    pub fn new(
        frame_number: u32,
        timestamp_ms: u64,
        data: Vec<u8>,
        width: u32,
        height: u32,
    ) -> Self {
        Self {
            frame_number,
            timestamp_ms,
            data,
            width,
            height,
            format: PixelFormat::Rgba,
        }
    }

    /// Create an empty black frame.
    pub fn empty(width: u32, height: u32) -> Self {
        let data = vec![0u8; (width * height * 4) as usize];
        Self {
            frame_number: 0,
            timestamp_ms: 0,
            data,
            width,
            height,
            format: PixelFormat::Rgba,
        }
    }

    /// Convert NV12 frame to RGBA using BT.709 limited range on CPU.
    ///
    /// Used only during rare camera-only transitions (~1 second of a multi-minute export)
    /// where CPU blending requires RGBA data.
    pub fn to_rgba(&self) -> DecodedFrame {
        if self.format == PixelFormat::Rgba {
            return self.clone();
        }

        let w = self.width as usize;
        let h = self.height as usize;
        let y_plane_size = w * h;
        let mut rgba = vec![0u8; w * h * 4];

        let y_plane = &self.data[..y_plane_size];
        let uv_plane = &self.data[y_plane_size..];

        for row in 0..h {
            for col in 0..w {
                let y_idx = row * w + col;
                let uv_idx = (row / 2) * w + (col & !1); // UV row is half height, pairs at even col

                let y_raw = y_plane[y_idx] as f32;
                let cb_raw = uv_plane[uv_idx] as f32;
                let cr_raw = uv_plane[uv_idx + 1] as f32;

                // BT.709 limited range
                let y = (y_raw - 16.0) * (255.0 / 219.0);
                let cb = (cb_raw - 128.0) * (255.0 / 224.0);
                let cr = (cr_raw - 128.0) * (255.0 / 224.0);

                let r = (y + 1.5748 * cr).clamp(0.0, 255.0) as u8;
                let g = (y - 0.1873 * cb - 0.4681 * cr).clamp(0.0, 255.0) as u8;
                let b = (y + 1.8556 * cb).clamp(0.0, 255.0) as u8;

                let out_idx = y_idx * 4;
                rgba[out_idx] = r;
                rgba[out_idx + 1] = g;
                rgba[out_idx + 2] = b;
                rgba[out_idx + 3] = 255;
            }
        }

        DecodedFrame {
            frame_number: self.frame_number,
            timestamp_ms: self.timestamp_ms,
            data: rgba,
            width: self.width,
            height: self.height,
            format: PixelFormat::Rgba,
        }
    }
}

/// Options for rendering a single frame.
#[derive(Debug, Clone)]
pub struct RenderOptions {
    /// Output width.
    pub output_width: u32,
    /// Output height.
    pub output_height: u32,
    /// Whether composition bounds should use manual fixed-output behavior.
    /// `false` means auto mode (frame starts at padding, output grows with content).
    pub use_manual_composition: bool,
    /// Current zoom state.
    pub zoom: ZoomState,
    /// Webcam overlay options (if enabled).
    pub webcam: Option<WebcamOverlay>,
    /// Cursor rendering options (if enabled).
    pub cursor: Option<CursorOverlay>,
    /// Background padding/styling.
    pub background: BackgroundStyle,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            output_width: 1920,
            output_height: 1080,
            use_manual_composition: false,
            zoom: ZoomState::default(),
            webcam: None,
            cursor: None,
            background: BackgroundStyle::default(),
        }
    }
}

/// Webcam overlay configuration for rendering.
#[derive(Debug, Clone)]
pub struct WebcamOverlay {
    /// Webcam frame data.
    pub frame: DecodedFrame,
    /// Position X (0.0-1.0, normalized).
    pub x: f32,
    /// Position Y (0.0-1.0, normalized).
    pub y: f32,
    /// Size as fraction of output width.
    pub size: f32,
    /// Shape of overlay.
    pub shape: WebcamShape,
    /// Whether to mirror horizontally.
    pub mirror: bool,
    /// Whether to use native source aspect ratio (vs forcing 1:1 square).
    pub use_source_aspect: bool,
    /// Shadow strength (0.0 = no shadow, 1.0 = full shadow).
    pub shadow: f32,
    /// Shadow size as fraction of webcam size (0.0-1.0).
    pub shadow_size: f32,
    /// Shadow opacity (0.0-1.0).
    pub shadow_opacity: f32,
    /// Shadow blur amount (0.0-1.0).
    pub shadow_blur: f32,
}

/// Per-quad rendering parameters for pre-rendered text overlay passes.
#[derive(Debug, Clone)]
pub struct TextOverlayQuad {
    /// NDC top-left x/y.
    pub quad_min: [f32; 2],
    /// NDC bottom-right x/y.
    pub quad_max: [f32; 2],
    /// Opacity (0.0-1.0).
    pub opacity: f32,
    /// Whether typewriter clipping is active.
    pub typewriter_active: bool,
    /// UV y below which all content is fully revealed.
    pub full_reveal_v: f32,
    /// UV y of the top of the last (partially revealed) line.
    pub last_line_v_top: f32,
    /// UV y of the bottom of the last (partially revealed) line.
    pub last_line_v_bottom: f32,
    /// UV x of the left edge of revealed content on the last line.
    pub last_line_u_left: f32,
    /// UV x of the right edge of revealed content on the last line.
    pub last_line_u_right: f32,
    /// Segment index for GPU texture lookup.
    pub texture_index: usize,
}

/// Shape of webcam overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebcamShape {
    /// Perfect circle.
    Circle,
    /// iOS-style squircle (superellipse with power 4).
    Squircle,
    /// Rectangle with no rounding.
    Rectangle,
    /// Rectangle with rounded corners.
    RoundedRect { radius: u32 },
}

/// Cursor overlay for rendering.
#[derive(Debug, Clone)]
pub struct CursorOverlay {
    /// Cursor position X in video coordinates.
    pub x: f32,
    /// Cursor position Y in video coordinates.
    pub y: f32,
    /// Cursor scale factor.
    pub scale: f32,
    /// Cursor image data (RGBA).
    pub image: Option<Vec<u8>>,
    /// Cursor image dimensions.
    pub image_width: u32,
    pub image_height: u32,
    /// Click highlight (if active).
    pub click_highlight: Option<ClickHighlight>,
}

/// Click highlight animation state.
#[derive(Debug, Clone)]
pub struct ClickHighlight {
    /// Highlight center X.
    pub x: f32,
    /// Highlight center Y.
    pub y: f32,
    /// Animation progress (0.0-1.0).
    pub progress: f32,
    /// Highlight color (RGBA).
    pub color: [f32; 4],
    /// Maximum radius.
    pub radius: f32,
}

impl CursorOverlay {
    /// Get cursor position as a frame space coordinate.
    pub fn position(&self) -> Coord<FrameSpace> {
        Coord::new(self.x as f64, self.y as f64)
    }

    /// Create a new cursor overlay from a frame space coordinate.
    pub fn with_position(mut self, pos: Coord<FrameSpace>) -> Self {
        self.x = pos.x as f32;
        self.y = pos.y as f32;
        self
    }

    /// Get cursor image size.
    pub fn image_size(&self) -> Size<FrameSpace> {
        Size::new(self.image_width as f64, self.image_height as f64)
    }
}

impl ClickHighlight {
    /// Get highlight center as a frame space coordinate.
    pub fn position(&self) -> Coord<FrameSpace> {
        Coord::new(self.x as f64, self.y as f64)
    }

    /// Create a click highlight from a frame space coordinate.
    pub fn at_position(
        pos: Coord<FrameSpace>,
        progress: f32,
        color: [f32; 4],
        radius: f32,
    ) -> Self {
        Self {
            x: pos.x as f32,
            y: pos.y as f32,
            progress,
            color,
            radius,
        }
    }
}

/// Corner rounding style for video frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CornerStyle {
    /// iOS-style squircle (superellipse).
    #[default]
    Squircle,
    /// Standard rounded corners.
    Rounded,
}

/// Shadow configuration for rendering.
/// Uses a single shadow value (0-100) that derives blur and opacity.
#[derive(Debug, Clone, Copy)]
pub struct ShadowStyle {
    /// Shadow enabled.
    pub enabled: bool,
    /// Shadow intensity (0-100). Controls both blur size and opacity.
    /// Blur = (shadow / 100) * minDim * 0.15
    /// Opacity = (shadow / 100) * 0.5
    pub shadow: f32,
}

impl Default for ShadowStyle {
    fn default() -> Self {
        Self {
            enabled: false,
            shadow: 50.0,
        }
    }
}

/// Border configuration for rendering.
#[derive(Debug, Clone)]
pub struct BorderStyle {
    /// Border enabled.
    pub enabled: bool,
    /// Border width in pixels.
    pub width: f32,
    /// Border color (RGBA, linear space).
    pub color: [f32; 4],
    /// Border opacity (0-1).
    pub opacity: f32,
}

impl Default for BorderStyle {
    fn default() -> Self {
        Self {
            enabled: false,
            width: 5.0,                  // Cap's default
            color: [1.0, 1.0, 1.0, 1.0], // White
            opacity: 0.8,
        }
    }
}

/// Background styling for video output.
/// Matches Cap's BackgroundConfiguration struct.
#[derive(Debug, Clone)]
pub struct BackgroundStyle {
    /// Background type.
    pub background_type: BackgroundType,
    /// Background blur amount (0-100%).
    pub blur: f32,
    /// Padding around video (pixels).
    pub padding: f32,
    /// Inset value (pixels).
    pub inset: u32,
    /// Corner rounding radius (pixels).
    pub rounding: f32,
    /// Corner rounding style (squircle or rounded).
    pub rounding_type: CornerStyle,
    /// Shadow configuration.
    pub shadow: ShadowStyle,
    /// Border configuration.
    pub border: BorderStyle,
}

impl Default for BackgroundStyle {
    fn default() -> Self {
        Self {
            background_type: BackgroundType::None,
            blur: 0.0,
            padding: 0.0,
            inset: 0,
            rounding: 0.0,
            rounding_type: CornerStyle::default(),
            shadow: ShadowStyle::default(),
            border: BorderStyle::default(),
        }
    }
}

impl BackgroundStyle {
    /// Create a BackgroundStyle from a project BackgroundConfig.
    /// `resource_dir` is used to resolve wallpaper paths (assets/backgrounds/).
    pub fn from_config(config: &BackgroundConfig, resource_dir: Option<&Path>) -> Self {
        let background_type = match config.bg_type {
            ProjectBackgroundType::Solid => {
                BackgroundType::Solid(hex_to_linear_rgba(&config.solid_color))
            },
            ProjectBackgroundType::Gradient => BackgroundType::Gradient {
                start: hex_to_linear_rgba(&config.gradient_start),
                end: hex_to_linear_rgba(&config.gradient_end),
                angle: config.gradient_angle,
            },
            ProjectBackgroundType::Wallpaper => {
                if let Some(ref wallpaper) = config.wallpaper {
                    // Resolve wallpaper path relative to resource directory
                    // wallpaper is just the ID (e.g., "macOS/sequoia-dark"), add .jpg extension
                    let wallpaper_filename = format!("{}.jpg", wallpaper);
                    let resolved_path = if let Some(res_dir) = resource_dir {
                        let wallpaper_path = res_dir
                            .join("assets")
                            .join("backgrounds")
                            .join(&wallpaper_filename);
                        if wallpaper_path.exists() {
                            wallpaper_path.to_string_lossy().to_string()
                        } else {
                            log::warn!(
                                "Wallpaper not found at {:?}, using name as-is",
                                wallpaper_path
                            );
                            wallpaper_filename
                        }
                    } else {
                        wallpaper_filename
                    };
                    BackgroundType::Wallpaper(resolved_path)
                } else {
                    // Fallback to solid color if no wallpaper specified
                    BackgroundType::Solid(hex_to_linear_rgba(&config.solid_color))
                }
            },
            ProjectBackgroundType::Image => {
                if let Some(ref image_path) = config.image_path {
                    BackgroundType::Image(image_path.clone())
                } else {
                    // Fallback to solid color if no image specified
                    BackgroundType::Solid(hex_to_linear_rgba(&config.solid_color))
                }
            },
        };

        let rounding_type = match config.rounding_type {
            ProjectCornerStyle::Squircle => CornerStyle::Squircle,
            ProjectCornerStyle::Rounded => CornerStyle::Rounded,
        };

        let shadow = ShadowStyle {
            enabled: config.shadow.enabled,
            shadow: config.shadow.shadow,
        };

        // Bake border opacity into color's alpha channel (matching Cap's approach)
        let mut border_color = hex_to_linear_rgba(&config.border.color);
        border_color[3] *= config.border.opacity / 100.0; // Apply opacity to alpha

        let border = BorderStyle {
            enabled: config.border.enabled,
            width: config.border.width,
            color: border_color,
            opacity: 1.0, // Opacity is now baked into color alpha
        };

        Self {
            background_type,
            blur: config.blur,
            padding: config.padding,
            inset: config.inset,
            rounding: config.rounding,
            rounding_type,
            shadow,
            border,
        }
    }
}

/// Background type for video output.
/// Matches Cap's Background enum structure.
#[derive(Debug, Clone)]
pub enum BackgroundType {
    /// No background (transparent or black).
    None,
    /// Solid color (RGBA).
    Solid([f32; 4]),
    /// Linear gradient.
    Gradient {
        start: [f32; 4],
        end: [f32; 4],
        angle: f32,
    },
    /// Built-in wallpaper preset (path relative to assets/backgrounds/).
    Wallpaper(String),
    /// Custom image file path.
    Image(String),
}

/// Uniforms passed to the compositor shader.
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CompositorUniforms {
    /// Video dimensions (width, height, 0, 0).
    pub video_size: [f32; 4],
    /// Output dimensions (width, height, 0, 0).
    pub output_size: [f32; 4],
    /// Zoom parameters (scale, center_x, center_y, 0).
    pub zoom: [f32; 4],
    /// Time and flags (time_ms, flags, 0, 0).
    pub time_flags: [f32; 4],
}

impl CompositorUniforms {
    pub fn new(
        video_width: u32,
        video_height: u32,
        output_width: u32,
        output_height: u32,
        zoom: &ZoomState,
        time_ms: f32,
    ) -> Self {
        Self {
            video_size: [video_width as f32, video_height as f32, 0.0, 0.0],
            output_size: [output_width as f32, output_height as f32, 0.0, 0.0],
            zoom: [zoom.scale, zoom.center_x, zoom.center_y, 0.0],
            time_flags: [time_ms, 0.0, 0.0, 0.0],
        }
    }
}

/// Playback state for the editor.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum PlaybackState {
    /// Not playing.
    #[default]
    Stopped,
    /// Currently playing.
    Playing,
    /// Paused mid-playback.
    Paused,
    /// Seeking to a position.
    Seeking,
}

/// Event emitted during playback.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct PlaybackEvent {
    /// Current frame number.
    pub frame: u32,
    /// Current timestamp in milliseconds.
    #[ts(type = "number")]
    pub timestamp_ms: u64,
    /// Playback state.
    pub state: PlaybackState,
}

/// Rendered frame ready for display.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct RenderedFrame {
    /// Frame number.
    pub frame: u32,
    /// Timestamp in milliseconds.
    #[ts(type = "number")]
    pub timestamp_ms: u64,
    /// RGBA pixel data as base64 (for WebGL upload).
    pub data_base64: String,
    /// Frame width.
    pub width: u32,
    /// Frame height.
    pub height: u32,
}

/// Result of creating an editor instance.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct EditorInstanceInfo {
    /// Instance ID for future commands.
    pub instance_id: String,
    /// Video width.
    pub width: u32,
    /// Video height.
    pub height: u32,
    /// Duration in milliseconds.
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// Frame rate.
    pub fps: u32,
    /// Total frame count.
    pub frame_count: u32,
    /// Whether webcam track exists.
    pub has_webcam: bool,
    /// Whether cursor data exists.
    pub has_cursor: bool,
}
