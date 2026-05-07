//! Recording preview window - floating mini preview that appears after recording completes.
//!
//! Shows recording info in the bottom-right corner with action buttons.
//! Auto-dismisses after a timeout unless the user interacts with it.

use moonsnap_core::error::MoonSnapResult;
use tauri::{
    command, AppHandle, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder,
};

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
    preview_x: Option<i32>,
    preview_y: Option<i32>,
    preview_width: Option<u32>,
    preview_height: Option<u32>,
) -> MoonSnapResult<()> {
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

    let mut monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitors: {}", e))?;

    let anchor_center = preview_x
        .zip(preview_y)
        .zip(preview_width.zip(preview_height))
        .map(|((x, y), (width, height))| (x + width as i32 / 2, y + height as i32 / 2));

    let anchor_monitor_index = anchor_center.and_then(|(center_x, center_y)| {
        monitors.iter().position(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();

            center_x >= pos.x
                && center_x < pos.x + size.width as i32
                && center_y >= pos.y
                && center_y < pos.y + size.height as i32
        })
    });

    let monitor = if let Some(index) = anchor_monitor_index {
        monitors.swap_remove(index)
    } else if let Some(primary_monitor) = app.primary_monitor().ok().flatten() {
        primary_monitor
    } else if !monitors.is_empty() {
        monitors.swap_remove(0)
    } else {
        return Err("No monitor found".into());
    };

    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale_factor = monitor.scale_factor();

    let preview_width_physical = (PREVIEW_WIDTH * scale_factor).round() as i32;
    let preview_height_physical = (PREVIEW_HEIGHT * scale_factor).round() as i32;
    let margin_physical = (MARGIN * scale_factor).round() as i32;

    let x =
        monitor_position.x + monitor_size.width as i32 - preview_width_physical - margin_physical;
    let y =
        monitor_position.y + monitor_size.height as i32 - preview_height_physical - margin_physical;

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
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("Failed to create recording preview window: {}", e))?;

    window
        .set_position(Position::Physical(PhysicalPosition { x, y }))
        .map_err(|e| format!("Failed to position recording preview window: {}", e))?;

    let _ = window.show();

    Ok(())
}

/// Close the recording preview window.
#[command]
pub async fn close_recording_preview(app: AppHandle) -> MoonSnapResult<()> {
    if let Some(window) = app.get_webview_window(PREVIEW_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close preview: {}", e))?;
    }
    Ok(())
}
