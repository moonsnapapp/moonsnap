//! GPU-accelerated video rendering for the video editor.
//!
//! This module provides real-time compositing with wgpu for smooth 60fps playback.
//! Architecture inspired by Cap's rendering engine.
//!
//! ## Components
//! - `types`: Core data structures (DecodedFrame, RenderOptions, etc.)
//! - `decoder`: Async video decoder with frame prefetching
//! - `renderer`: wgpu device/queue management and shader compilation
//! - `compositor`: Frame compositing pipeline
//! - `moonsnap-render`: Shared rendering math/types (background, coord, text, scene, zoom, captions)
//! - `editor_instance`: Playback state management

pub mod compositor;
pub mod cursor;
pub mod decoder;
pub mod editor_instance;
pub mod exporter;
pub mod parity;
pub mod renderer;
pub mod renderer_state;
pub mod stream_decoder;
pub mod svg_cursor;

#[cfg(test)]
mod caption_parity_test;
#[cfg(test)]
mod caption_pixel_test;

pub use compositor::Compositor;
pub use cursor::{
    composite_cursor, composite_cursor_with_motion_blur, get_svg_cursor_image, CursorInterpolator,
    DecodedCursorImage, InterpolatedCursor, VideoContentBounds,
};
pub use decoder::VideoDecoder;
pub use editor_instance::EditorInstance;
pub use exporter::export_video_gpu;
pub use parity::{get_composition_bounds, get_font_metrics, get_parity_layout};
pub use renderer::Renderer;
pub use renderer_state::RendererState;
pub use stream_decoder::StreamDecoder;
pub use svg_cursor::{get_svg_cursor, render_svg_cursor, RenderedSvgCursor};
