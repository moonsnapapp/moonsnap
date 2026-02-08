//! Tauri commands for registering pre-rendered text images from the frontend.

use crate::rendering::prerendered_text::{PreRenderedTextImage, PreRenderedTextStore};
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{command, State};

/// Global state for pre-rendered text images.
pub struct PreRenderedTextState {
    pub store: Arc<Mutex<PreRenderedTextStore>>,
}

impl PreRenderedTextState {
    pub fn new() -> Self {
        Self {
            store: Arc::new(Mutex::new(PreRenderedTextStore::new())),
        }
    }
}

impl Default for PreRenderedTextState {
    fn default() -> Self {
        Self::new()
    }
}

/// Register a pre-rendered text image from the frontend.
///
/// Called once per text segment before export starts.
/// The frontend renders text using OffscreenCanvas (matching CSS rendering)
/// and sends the RGBA pixel data here.
#[command]
pub async fn register_prerendered_text(
    state: State<'_, PreRenderedTextState>,
    segment_index: usize,
    width: u32,
    height: u32,
    center_x: f64,
    center_y: f64,
    size_x: f64,
    size_y: f64,
    rgba_data: Vec<u8>,
) -> Result<(), String> {
    let expected_size = (width * height * 4) as usize;
    if rgba_data.len() != expected_size {
        return Err(format!(
            "RGBA data size mismatch: expected {} bytes ({}x{}x4), got {} bytes",
            expected_size,
            width,
            height,
            rgba_data.len()
        ));
    }

    let image = PreRenderedTextImage {
        segment_index,
        width,
        height,
        center_x,
        center_y,
        size_x,
        size_y,
        rgba_data,
    };

    state.store.lock().register(image);

    log::debug!(
        "[PreRenderedText] Registered segment {} ({}x{}, {:.0}KB)",
        segment_index,
        width,
        height,
        (width * height * 4) as f32 / 1024.0
    );

    Ok(())
}

/// Clear all pre-rendered text images.
///
/// Called at export start and end.
#[command]
pub async fn clear_prerendered_texts(state: State<'_, PreRenderedTextState>) -> Result<(), String> {
    state.store.lock().clear();
    log::debug!("[PreRenderedText] Cleared all pre-rendered texts");
    Ok(())
}
