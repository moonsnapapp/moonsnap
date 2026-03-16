//! Screenshot preview window - macOS-style mini preview that appears after capture.
//!
//! Shows a thumbnail in the bottom-right corner with action buttons.
//! Auto-dismisses after a timeout unless the user interacts with it.

use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Screenshot preview window label
const PREVIEW_LABEL: &str = "screenshot-preview";

/// Preview window dimensions (logical pixels)
const PREVIEW_WIDTH: f64 = 340.0;
const PREVIEW_HEIGHT: f64 = 220.0;

/// Margin from screen edges (logical pixels)
const MARGIN: f64 = 20.0;

/// Show the screenshot preview window in the bottom-right corner.
/// If a preview is already showing, close it first and show the new one.
#[command]
pub async fn show_screenshot_preview(
    app: AppHandle,
    file_path: String,
    width: u32,
    height: u32,
    copied: Option<bool>,
) -> Result<(), String> {
    // Close existing preview if any
    if let Some(existing) = app.get_webview_window(PREVIEW_LABEL) {
        let _ = existing.close();
        // Small delay to let the window close
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let encoded_path = urlencoding::encode(&file_path);
    let copied_param = if copied.unwrap_or(false) { 1 } else { 0 };
    let url = WebviewUrl::App(
        format!(
            "windows/screenshot-preview.html?path={}&w={}&h={}&copied={}",
            encoded_path, width, height, copied_param
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

    // Calculate position: bottom-right corner with margin
    let logical_width = monitor_size.width as f64 / scale_factor;
    let logical_height = monitor_size.height as f64 / scale_factor;

    let x = logical_width - PREVIEW_WIDTH - MARGIN;
    let y = logical_height - PREVIEW_HEIGHT - MARGIN;

    let window = WebviewWindowBuilder::new(&app, PREVIEW_LABEL, url)
        .title("Screenshot Preview")
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
        .map_err(|e| format!("Failed to create preview window: {}", e))?;

    let _ = window.show();

    Ok(())
}

/// Close the screenshot preview window.
#[command]
pub async fn close_screenshot_preview(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PREVIEW_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close preview: {}", e))?;
    }
    Ok(())
}
