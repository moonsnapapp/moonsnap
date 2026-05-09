//! Tauri commands for registering pre-rendered text images from the frontend.

use moonsnap_core::error::MoonSnapResult;
use moonsnap_render::prerendered_text::{LineMetric, PreRenderedTextImage, PreRenderedTextStore};
use parking_lot::Mutex;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{command, State};

/// JSON-friendly line metric from the frontend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMetricInput {
    pub top_px: u32,
    pub height_px: u32,
    pub cumulative_chars: usize,
    pub content_width_px: u32,
    #[serde(default)]
    pub reveal_widths_px: Vec<u32>,
}

/// Global state for pre-rendered text images.
pub struct PreRenderedTextState {
    pub text_store: Arc<Mutex<PreRenderedTextStore>>,
    pub annotation_store: Arc<Mutex<PreRenderedTextStore>>,
}

impl PreRenderedTextState {
    pub fn new() -> Self {
        Self {
            text_store: Arc::new(Mutex::new(PreRenderedTextStore::new())),
            annotation_store: Arc::new(Mutex::new(PreRenderedTextStore::new())),
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
    line_metrics: Option<Vec<LineMetricInput>>,
) -> MoonSnapResult<()> {
    register_prerendered_overlay(
        &state.text_store,
        "PreRenderedText",
        segment_index,
        width,
        height,
        center_x,
        center_y,
        size_x,
        size_y,
        rgba_data,
        line_metrics,
    )
}

/// Register a pre-rendered annotation image from the frontend.
///
/// Annotation overlays are deliberately stored separately from Text-track
/// overlays so their segment indices, bitmap sizes, and zoom behavior cannot
/// affect each other.
#[command]
pub async fn register_prerendered_annotation(
    state: State<'_, PreRenderedTextState>,
    segment_index: usize,
    width: u32,
    height: u32,
    center_x: f64,
    center_y: f64,
    size_x: f64,
    size_y: f64,
    rgba_data: Vec<u8>,
    line_metrics: Option<Vec<LineMetricInput>>,
) -> MoonSnapResult<()> {
    register_prerendered_overlay(
        &state.annotation_store,
        "PreRenderedAnnotation",
        segment_index,
        width,
        height,
        center_x,
        center_y,
        size_x,
        size_y,
        rgba_data,
        line_metrics,
    )
}

fn register_prerendered_overlay(
    store: &Arc<Mutex<PreRenderedTextStore>>,
    label: &str,
    segment_index: usize,
    width: u32,
    height: u32,
    center_x: f64,
    center_y: f64,
    size_x: f64,
    size_y: f64,
    rgba_data: Vec<u8>,
    line_metrics: Option<Vec<LineMetricInput>>,
) -> MoonSnapResult<()> {
    let expected_size = (width * height * 4) as usize;
    if rgba_data.len() != expected_size {
        return Err(format!(
            "RGBA data size mismatch: expected {} bytes ({}x{}x4), got {} bytes",
            expected_size,
            width,
            height,
            rgba_data.len()
        )
        .into());
    }

    let metrics: Vec<LineMetric> = line_metrics
        .unwrap_or_default()
        .into_iter()
        .map(|m| LineMetric {
            top_px: m.top_px,
            height_px: m.height_px,
            cumulative_chars: m.cumulative_chars,
            content_width_px: m.content_width_px,
            reveal_widths_px: m.reveal_widths_px,
        })
        .collect();

    let line_metrics_len = metrics.len();
    let image = PreRenderedTextImage {
        segment_index,
        width,
        height,
        center_x,
        center_y,
        size_x,
        size_y,
        rgba_data: Arc::new(rgba_data),
        line_metrics: metrics,
    };

    store.lock().register(image);

    log::info!(
        "[{}] Registered segment {} bitmap={}x{} center=({:.4},{:.4}) size=({:.4},{:.4}) bytes={:.0}KB lines={}",
        label,
        segment_index,
        width,
        height,
        center_x,
        center_y,
        size_x,
        size_y,
        (width * height * 4) as f32 / 1024.0,
        line_metrics_len
    );

    Ok(())
}

/// Clear all pre-rendered text images.
///
/// Called at export start and end.
#[command]
pub async fn clear_prerendered_texts(state: State<'_, PreRenderedTextState>) -> MoonSnapResult<()> {
    state.text_store.lock().clear();
    log::debug!("[PreRenderedText] Cleared all pre-rendered texts");
    Ok(())
}

/// Clear all pre-rendered annotation images.
#[command]
pub async fn clear_prerendered_annotations(
    state: State<'_, PreRenderedTextState>,
) -> MoonSnapResult<()> {
    state.annotation_store.lock().clear();
    log::debug!("[PreRenderedAnnotation] Cleared all pre-rendered annotations");
    Ok(())
}
