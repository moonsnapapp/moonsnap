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
//! - `background`: Background rendering (solid colors, gradients, images)
//! - `zoom`: Zoom interpolation with bezier easing
//! - `editor_instance`: Playback state management

pub mod background;
pub mod caption_layer;
pub mod compositor;
pub mod coord;
pub mod cursor;
pub mod decoder;
pub mod editor_instance;
pub mod exporter;
pub mod parity;
pub mod renderer;
pub mod renderer_state;
pub mod scene;
pub mod stream_decoder;
pub mod svg_cursor;
pub mod text;
pub mod text_layer;
pub mod types;

#[cfg(test)]
mod caption_parity_test;
#[cfg(test)]
mod caption_pixel_test;
pub mod zoom;

pub use background::{hex_to_linear_rgba, srgb_to_linear, Background, BackgroundLayer};
pub use caption_layer::{find_active_segment, prepare_captions};
pub use compositor::Compositor;
pub use coord::{
    CaptureSpace, Coord, FrameSpace, Rect, ScreenSpace, ScreenUVSpace, Size, TransformParams,
    ZoomedFrameSpace,
};
pub use cursor::{
    composite_cursor, composite_cursor_with_motion_blur, get_svg_cursor_image, CursorInterpolator,
    DecodedCursorImage, InterpolatedCursor,
};
pub use decoder::VideoDecoder;
pub use editor_instance::EditorInstance;
pub use exporter::export_video_gpu;
pub use parity::{
    calculate_composition_bounds, get_composition_bounds, get_parity_layout, scale_factor,
    CompositionBounds, ParityLayout,
};
pub use renderer::Renderer;
pub use renderer_state::RendererState;
pub use scene::{InterpolatedScene, SceneInterpolator};
pub use stream_decoder::StreamDecoder;
pub use svg_cursor::{get_svg_cursor, render_svg_cursor, RenderedSvgCursor};
pub use text::{parse_color, prepare_texts, PreparedText};
pub use text_layer::TextLayer;
pub use types::*;
pub use zoom::ZoomInterpolator;
