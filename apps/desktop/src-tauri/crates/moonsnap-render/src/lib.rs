#![doc = include_str!("../README.md")]

pub mod background;
pub mod caption_layer;
pub mod coord;
pub mod cursor_composite;
pub mod cursor_plan;
pub mod nv12_converter;
pub mod parity;
pub mod prerendered_text;
pub mod scene;
pub mod text;
pub mod text_layer;
pub mod text_overlay_layer;
pub mod types;
pub mod webcam_overlay;
pub mod zoom;
mod zoom_state;

pub use types::ZoomState;

#[cfg(test)]
mod tests {
    use super::{parity, text, ZoomState};

    #[test]
    fn root_exports_smoke_test() {
        let layout = parity::get_parity_layout();
        assert!(layout.reference_height > 0.0);
        assert!(layout.line_height_multiplier > 0.0);

        let rgba = text::parse_color("#FFFFFF");
        assert_eq!(rgba[3], 1.0);

        let state = ZoomState::identity();
        assert!(!state.is_zoomed());
    }
}
