//! Recording preview window - floating mini preview that appears after recording completes.
//!
//! Shows recording info in the bottom-right corner with action buttons.
//! Auto-dismisses after a timeout unless the user interacts with it.

use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Recording preview window label
const PREVIEW_LABEL: &str = "recording-preview";

/// Preview window dimensions (logical pixels)
const PREVIEW_WIDTH: f64 = 340.0;
const PREVIEW_HEIGHT: f64 = 220.0;

/// Margin from screen edges (logical pixels)
const MARGIN: f64 = 20.0;

/// Show the recording preview window in the bottom-right corner.
/// If a preview is already showing, close it first and show the new one.
#[command]
pub async fn show_recording_preview(
    app: AppHandle,
    output_path: String,
    duration_secs: f64,
    file_size_bytes: u64,
) -> Result<(), String> {
    // Close existing preview if any
    if let Some(existing) = app.get_webview_window(PREVIEW_LABEL) {
        let _ = existing.close();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    // Also close any screenshot preview that might be showing
    if let Some(existing) = app.get_webview_window("screenshot-preview") {
        let _ = existing.close();
    }

    let encoded_path = urlencoding::encode(&output_path);
    let url = WebviewUrl::App(
        format!(
            "windows/recording-preview.html?path={}&duration={}&size={}",
            encoded_path, duration_secs, file_size_bytes
        )
        .into(),
    );

    // Get primary monitor to position in bottom-right
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get monitor: {}", e))?
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    let logical_width = monitor_size.width as f64 / scale_factor;
    let logical_height = monitor_size.height as f64 / scale_factor;

    let x = logical_width - PREVIEW_WIDTH - MARGIN;
    let y = logical_height - PREVIEW_HEIGHT - MARGIN;

    let window = WebviewWindowBuilder::new(&app, PREVIEW_LABEL, url)
        .title("Recording Preview")
        .inner_size(PREVIEW_WIDTH, PREVIEW_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .position(x, y)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("Failed to create recording preview window: {}", e))?;

    let _ = window.show();

    Ok(())
}

/// Close the recording preview window.
#[command]
pub async fn close_recording_preview(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PREVIEW_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close preview: {}", e))?;
    }
    Ok(())
}
