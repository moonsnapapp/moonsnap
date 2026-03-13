//! Recording border and countdown window commands.

use tauri::{command, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{
    apply_dwm_transparency, exclude_window_from_capture, set_physical_bounds,
    COUNTDOWN_WINDOW_LABEL, RECORDING_BORDER_LABEL, RECORDING_CONTROLS_LABEL,
};

// ============================================================================
// Recording Border Window
// ============================================================================

/// Show the recording border window around the recording region.
/// This is a transparent click-through window that shows a border to indicate
/// what area is being recorded. The window is excluded from screen capture
/// so it won't appear in recordings.
///
/// Parameters:
/// - x, y: Top-left corner of the recording region (screen coordinates)
/// - width, height: Dimensions of the recording region
#[command]
pub async fn show_recording_border(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    show_recording_border_impl(app, x, y, width, height)
}

fn show_recording_border_impl(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    // No padding - position window exactly at the recording region
    // The border will be drawn at the exact edge of the recording area
    let window_x = x;
    let window_y = y;
    let window_width = width;
    let window_height = height;

    // Check if window already exists
    if let Some(window) = app.get_webview_window(RECORDING_BORDER_LABEL) {
        // Window exists - reposition and resize it using physical coordinates
        let _ = set_physical_bounds(&window, window_x, window_y, window_width, window_height);
        window
            .show()
            .map_err(|e| format!("Failed to show recording border: {}", e))?;
        window
            .set_always_on_top(true)
            .map_err(|e| format!("Failed to set always on top: {}", e))?;
        return Ok(());
    }

    // Create the window
    let url = WebviewUrl::App("windows/recording-border.html".into());

    let window = WebviewWindowBuilder::new(&app, RECORDING_BORDER_LABEL, url)
        .title("")
        .inner_size(window_width as f64, window_height as f64)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // Start hidden, position first
        .focused(false) // Don't steal focus from user's work
        .build()
        .map_err(|e| format!("Failed to create recording border window: {}", e))?;

    // Set position/size using physical coordinates to match recording coordinates
    set_physical_bounds(&window, window_x, window_y, window_width, window_height)?;

    // CRITICAL: Exclude window from screen capture so it doesn't appear in recordings
    exclude_window_from_capture(&window)?;

    // Apply DWM blur-behind for true transparency on Windows
    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!("Failed to apply DWM transparency to border: {}", e);
    }

    // Make it click-through so users can interact with the content below
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| format!("Failed to set ignore cursor events: {}", e))?;

    // Now show the window
    window
        .show()
        .map_err(|e| format!("Failed to show window: {}", e))?;

    // Ensure always on top
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    Ok(())
}

/// Hide the recording border window.
#[command]
pub async fn hide_recording_border(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(RECORDING_BORDER_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close recording border: {}", e))?;
    }
    Ok(())
}

// ============================================================================
// Recording Controls Window
// ============================================================================

const RECORDING_CONTROLS_INITIAL_WIDTH: u32 = 328;
const RECORDING_CONTROLS_INITIAL_HEIGHT: u32 = 52;

/// Show the recording controls window used while the main toolbar is excluded from capture.
#[command]
pub async fn show_recording_controls(
    app: AppHandle,
    x: i32,
    y: i32,
    _width: u32,
    _height: u32,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(RECORDING_CONTROLS_LABEL) {
        set_physical_bounds(
            &window,
            x,
            y,
            RECORDING_CONTROLS_INITIAL_WIDTH,
            RECORDING_CONTROLS_INITIAL_HEIGHT,
        )?;
        window
            .show()
            .map_err(|e| format!("Failed to show recording controls: {}", e))?;
        if let Err(e) = apply_dwm_transparency(&window) {
            log::warn!(
                "Failed to re-apply DWM transparency to recording controls: {}",
                e
            );
        }
        exclude_window_from_capture(&window)?;
        window
            .set_always_on_top(true)
            .map_err(|e| format!("Failed to keep recording controls on top: {}", e))?;
        return Ok(());
    }

    let url = WebviewUrl::App("windows/recording-controls.html".into());

    let window = WebviewWindowBuilder::new(&app, RECORDING_CONTROLS_LABEL, url)
        .title("Recording Controls")
        .inner_size(
            RECORDING_CONTROLS_INITIAL_WIDTH as f64,
            RECORDING_CONTROLS_INITIAL_HEIGHT as f64,
        )
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("Failed to create recording controls window: {}", e))?;

    set_physical_bounds(
        &window,
        x,
        y,
        RECORDING_CONTROLS_INITIAL_WIDTH,
        RECORDING_CONTROLS_INITIAL_HEIGHT,
    )?;

    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!(
            "Failed to apply DWM transparency to recording controls: {}",
            e
        );
    }

    window
        .show()
        .map_err(|e| format!("Failed to show recording controls window: {}", e))?;
    exclude_window_from_capture(&window)?;
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set recording controls always on top: {}", e))?;

    Ok(())
}

#[command]
pub async fn close_recording_controls(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(RECORDING_CONTROLS_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close recording controls: {}", e))?;
    }
    Ok(())
}

// ============================================================================
// Countdown Window
// ============================================================================

/// Show the countdown overlay window during recording countdown.
/// The window is transparent, click-through, and displays a centered countdown number.
/// Window size matches the recording region exactly (physical coordinates).
#[command]
pub async fn show_countdown_window(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    countdown_secs: u32,
) -> Result<(), String> {
    // Close existing window if any
    if let Some(window) = app.get_webview_window(COUNTDOWN_WINDOW_LABEL) {
        let _ = window.close();
    }

    let url = WebviewUrl::App(format!("windows/countdown.html?secs={}", countdown_secs).into());

    let window = WebviewWindowBuilder::new(&app, COUNTDOWN_WINDOW_LABEL, url)
        .title("Countdown")
        .inner_size(width as f64, height as f64)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // Start hidden, position first
        .build()
        .map_err(|e| format!("Failed to create countdown window: {}", e))?;

    // Use physical coordinates to match the recording region exactly
    set_physical_bounds(&window, x, y, width, height)?;

    // Make click-through
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| format!("Failed to set cursor events: {}", e))?;

    // Apply DWM blur-behind for true transparency on Windows
    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!("Failed to apply DWM transparency to countdown: {}", e);
    }

    // Now show the window
    window
        .show()
        .map_err(|e| format!("Failed to show window: {}", e))?;

    // Exclude from capture
    // TEMPORARILY DISABLED FOR MARKETING SCREENSHOTS
    // let _ = exclude_window_from_capture(&window);

    Ok(())
}

/// Hide the countdown window.
#[command]
pub async fn hide_countdown_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(COUNTDOWN_WINDOW_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close countdown window: {}", e))?;
    }
    Ok(())
}
