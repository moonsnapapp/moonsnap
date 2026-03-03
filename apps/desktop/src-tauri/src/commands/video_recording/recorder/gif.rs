//! App-layer wrapper for GIF capture.
//! Canonical capture engine implementation lives in `moonsnap-capture`.

use std::path::PathBuf;
use std::sync::Arc;

use crossbeam_channel::Receiver;
use moonsnap_capture::state::{RecorderCommand, RecordingProgress};
use tauri::AppHandle;

use super::super::{emit_state_change, RecordingSettings};

/// Run GIF capture and emit recording state updates through Tauri.
pub fn run_gif_capture(
    app: &AppHandle,
    settings: &RecordingSettings,
    output_path: &PathBuf,
    progress: Arc<RecordingProgress>,
    command_rx: Receiver<RecorderCommand>,
    started_at: &str,
) -> Result<f64, String> {
    moonsnap_capture::recorder_gif::run_gif_capture(
        settings,
        output_path,
        progress,
        command_rx,
        started_at,
        |state| emit_state_change(app, &state),
    )
}
