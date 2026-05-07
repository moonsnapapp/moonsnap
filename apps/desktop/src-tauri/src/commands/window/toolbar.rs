//! Capture toolbar and startup toolbar commands.

use moonsnap_core::error::MoonSnapResult;
use parking_lot::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{
    apply_dwm_transparency, bring_window_to_front_without_topmost, exclude_window_from_capture,
    include_window_in_capture, set_physical_bounds, CAPTURE_TOOLBAR_LABEL,
};

const STARTUP_TOOLBAR_WIDTH: u32 = 738;
const STARTUP_TOOLBAR_HEIGHT: u32 = 147;
const CAPTURE_TOOLBAR_DEFAULT_WIDTH: u32 = 1280;
const CAPTURE_TOOLBAR_DEFAULT_HEIGHT: u32 = 144;
const STARTUP_TOOLBAR_CONTEXT_APPLY_DELAY_MS: u64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureToolbarSelectionPayload {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub source_type: Option<String>,
    pub window_id: Option<i64>,
    pub source_title: Option<String>,
    pub monitor_index: Option<u32>,
    pub monitor_name: Option<String>,
    pub capture_type: Option<String>,
    pub source_mode: Option<String>,
    pub auto_start_recording: Option<bool>,
    pub native_controls: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupToolbarContextPayload {
    pub capture_type: Option<String>,
    pub source_mode: Option<String>,
    pub auto_start_area_selection: bool,
}

#[derive(Default)]
pub struct CaptureToolbarWindowState {
    create_lock: Mutex<()>,
    pending_selection: Mutex<Option<CaptureToolbarSelectionPayload>>,
    pending_startup_context: Mutex<Option<StartupToolbarContextPayload>>,
    last_startup_position: Mutex<Option<(i32, i32)>>,
}

impl CaptureToolbarWindowState {
    pub fn remember_position(&self, x: i32, y: i32) {
        let mut last_startup_position = self.last_startup_position.lock();
        *last_startup_position = Some((x, y));
    }

    fn last_startup_position(&self) -> Option<(i32, i32)> {
        *self.last_startup_position.lock()
    }
}

fn build_selection_payload(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    source_type: Option<String>,
    window_id: Option<i64>,
    source_title: Option<String>,
    monitor_index: Option<u32>,
    monitor_name: Option<String>,
    capture_type: Option<String>,
    source_mode: Option<String>,
    auto_start_recording: Option<bool>,
    native_controls: Option<bool>,
) -> CaptureToolbarSelectionPayload {
    CaptureToolbarSelectionPayload {
        x,
        y,
        width,
        height,
        source_type,
        window_id,
        source_title,
        monitor_index,
        monitor_name,
        capture_type,
        source_mode,
        auto_start_recording,
        native_controls,
    }
}

fn calculate_capture_toolbar_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    toolbar_width: u32,
    _toolbar_height: u32,
) -> (i32, i32) {
    // Position below the selection, centered horizontally.
    let ix = x + (width as i32 / 2) - (toolbar_width as i32 / 2);
    let iy = y + height as i32 + 8;
    (ix, iy)
}

fn build_startup_toolbar_context(
    capture_type: Option<String>,
    source_mode: Option<String>,
    auto_start_area_selection: bool,
) -> StartupToolbarContextPayload {
    StartupToolbarContextPayload {
        capture_type,
        source_mode,
        auto_start_area_selection,
    }
}

fn calculate_startup_toolbar_position(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    toolbar_width: u32,
    toolbar_height: u32,
) -> (i32, i32) {
    let x = monitor_x + (monitor_width as i32 - toolbar_width as i32) / 2;
    let y = monitor_y + (monitor_height as i32 - toolbar_height as i32) / 2;

    (x, y)
}

// ============================================================================
// Capture Toolbar
// ============================================================================

/// Create the capture toolbar window (hidden).
/// Frontend will measure content, calculate position, and call set_capture_toolbar_bounds to show.
/// This allows frontend to fully control sizing/positioning without hardcoded dimensions.
///
/// If selection bounds are provided, emits `confirm-selection` event to the window.
#[command]
pub async fn show_capture_toolbar(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    source_type: Option<String>,
    window_id: Option<i64>,
    source_title: Option<String>,
    monitor_index: Option<u32>,
    monitor_name: Option<String>,
    capture_type: Option<String>,
    source_mode: Option<String>,
    auto_start_recording: Option<bool>,
    snap_toolbar_to_selection: Option<bool>,
    native_controls: Option<bool>,
) -> MoonSnapResult<()> {
    if crate::commands::video_recording::block_capture_attempt_while_recording(&app)? {
        return Ok(());
    }

    let toolbar_state = app.state::<CaptureToolbarWindowState>();
    let _create_guard = toolbar_state.create_lock.lock();

    let selection = build_selection_payload(
        x,
        y,
        width,
        height,
        source_type,
        window_id,
        source_title,
        monitor_index,
        monitor_name,
        capture_type,
        source_mode,
        auto_start_recording,
        native_controls,
    );
    let snap_toolbar_to_selection = snap_toolbar_to_selection.unwrap_or(true);
    if let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) {
        if !auto_start_recording.unwrap_or(false) && snap_toolbar_to_selection {
            let size = window
                .inner_size()
                .map_err(|e| format!("Failed to get toolbar size: {}", e))?;
            let (next_x, next_y) =
                calculate_capture_toolbar_position(x, y, width, height, size.width, size.height);
            set_physical_bounds(&window, next_x, next_y, size.width, size.height)?;
        }

        let mut pending_selection = toolbar_state.pending_selection.lock();
        pending_selection.take();

        let _ = window.emit("confirm-selection", &selection);
        if auto_start_recording.unwrap_or(false) || native_controls.unwrap_or(false) {
            let _ = window.hide();
        } else {
            window
                .show()
                .map_err(|e| format!("Failed to show toolbar: {}", e))?;
            window
                .set_focus()
                .map_err(|e| format!("Failed to focus toolbar: {}", e))?;
        }
        return Ok(());
    }

    {
        let mut pending_selection = toolbar_state.pending_selection.lock();
        *pending_selection = Some(selection.clone());
    }

    // No URL params - toolbar always starts in startup state
    let url = WebviewUrl::App("windows/capture-toolbar.html".into());

    // Create window hidden - frontend will configure size/position and show it
    // Uses custom titlebar like the main library window (decorations: false, transparent: true)
    let window = WebviewWindowBuilder::new(&app, CAPTURE_TOOLBAR_LABEL, url)
        .title("MoonSnap Capture")
        .transparent(true)
        .decorations(false)
        .maximizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false) // Auto-resized by frontend
        .shadow(false)
        .visible(false) // Hidden until frontend configures bounds
        .focused(false)
        .build();

    let window = match window {
        Ok(window) => window,
        Err(e) => {
            let mut pending_selection = toolbar_state.pending_selection.lock();
            pending_selection.take();
            return Err(format!("Failed to create capture toolbar window: {}", e).into());
        },
    };

    // Fixed initial window size before frontend measures actual content.
    let toolbar_width = CAPTURE_TOOLBAR_DEFAULT_WIDTH;
    let toolbar_height = CAPTURE_TOOLBAR_DEFAULT_HEIGHT;
    let (initial_x, initial_y) = if snap_toolbar_to_selection {
        calculate_capture_toolbar_position(x, y, width, height, toolbar_width, toolbar_height)
    } else {
        let monitors = app
            .available_monitors()
            .map_err(|e| format!("Failed to get monitors: {}", e))?;
        let monitor = monitors
            .first()
            .ok_or_else(|| "No monitors found".to_string())?;
        let pos = monitor.position();
        let size = monitor.size();
        (
            pos.x + (size.width as i32 - toolbar_width as i32) / 2,
            pos.y + size.height as i32 - toolbar_height as i32 - 100,
        )
    };

    set_physical_bounds(&window, initial_x, initial_y, toolbar_width, toolbar_height)?;

    Ok(())
}

/// Deliver any queued selection once the toolbar window finishes mounting its listeners.
#[command]
pub async fn capture_toolbar_ready(app: AppHandle) -> MoonSnapResult<()> {
    let toolbar_state = app.state::<CaptureToolbarWindowState>();
    let pending_selection = {
        let mut pending_selection = toolbar_state.pending_selection.lock();
        pending_selection.take()
    };
    let pending_startup_context = {
        let mut pending_startup_context = toolbar_state.pending_startup_context.lock();
        pending_startup_context.take()
    };

    if pending_selection.is_none() && pending_startup_context.is_none() {
        return Ok(());
    }

    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };

    if let Some(selection) = pending_selection {
        let _ = window.emit("confirm-selection", selection);
    }

    if let Some(startup_context) = pending_startup_context {
        let _ = window.emit("startup-toolbar-context", startup_context);
    }

    Ok(())
}

/// Update the capture toolbar with new selection dimensions.
/// Emits event to frontend which handles repositioning.
#[command]
pub async fn update_capture_toolbar(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };

    // Emit selection update - frontend will reposition
    let _ = window.emit(
        "selection-updated",
        serde_json::json!({
            "x": x, "y": y, "width": width, "height": height
        }),
    );

    // Ensure toolbar stays on top
    let _ = window.set_always_on_top(true);

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };

        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = SetWindowPos(
                    HWND(hwnd.0),
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }

    Ok(())
}

/// Hide the capture toolbar window (does NOT close it).
#[command]
pub async fn hide_capture_toolbar(app: AppHandle) -> MoonSnapResult<()> {
    if let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) {
        window
            .hide()
            .map_err(|e| format!("Failed to hide capture toolbar: {}", e))?;
    }
    Ok(())
}

/// Set whether the capture toolbar is visible in screen recordings.
/// When `show` is true, the toolbar will appear in recordings.
/// When `show` is false, the toolbar is excluded from screen capture.
#[command]
pub async fn set_toolbar_recording_visibility(app: AppHandle, show: bool) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };
    let result = if show {
        include_window_in_capture(&window)
    } else {
        exclude_window_from_capture(&window)
    };

    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!(
            "Failed to re-apply DWM transparency after capture affinity change: {}",
            e
        );
    }

    result
}

/// Close the capture toolbar window (actually destroys it).
#[command]
pub async fn close_capture_toolbar(app: AppHandle) -> MoonSnapResult<()> {
    if let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close capture toolbar: {}", e))?;
    }
    Ok(())
}

/// Show and bring the capture toolbar to front.
#[command]
pub async fn bring_capture_toolbar_to_front(
    app: AppHandle,
    include_in_capture: Option<bool>,
    focus: Option<bool>,
) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };

    if let Some(include_in_capture) = include_in_capture {
        if include_in_capture {
            include_window_in_capture(&window)?;
        } else {
            exclude_window_from_capture(&window)?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE,
            SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
        };

        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = ShowWindow(HWND(hwnd.0), SW_RESTORE);
                let _ = ShowWindow(HWND(hwnd.0), SW_SHOW);
                let _ = SetWindowPos(
                    HWND(hwnd.0),
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                );
                if focus.unwrap_or(true) {
                    let _ = SetForegroundWindow(HWND(hwnd.0));
                }
            }
        }
    }

    window
        .show()
        .map_err(|e| format!("Failed to show toolbar: {}", e))?;
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set toolbar always on top: {}", e))?;

    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!(
            "Failed to re-apply DWM transparency when bringing toolbar to front: {}",
            e
        );
    }

    if focus.unwrap_or(true) {
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus toolbar: {}", e))?;
    }

    Ok(())
}

/// Resize the capture toolbar window based on actual content size.
/// Called by frontend after measuring rendered content via getBoundingClientRect().
/// Frontend sends CSS pixels (logical), so we use Logical size to match.
#[command]
pub async fn resize_capture_toolbar(app: AppHandle, width: u32, height: u32) -> MoonSnapResult<()> {
    const MAX_WIDTH: u32 = 1280;

    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };

    // Clamp width to max
    let width = width.min(MAX_WIDTH);

    // Use Logical size since frontend sends CSS pixels from getBoundingClientRect()
    // This ensures the window size matches the content size at any DPI scaling
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: width as f64,
            height: height as f64,
        }))
        .map_err(|e| format!("Failed to set size: {}", e))?;

    Ok(())
}

/// Set only the position of the capture toolbar (preserves current size)
#[command]
pub async fn set_capture_toolbar_position(app: AppHandle, x: i32, y: i32) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };

    // Preserve the inner content size.
    // Using outer_size here causes the window to grow when shadows/frame extents
    // are reapplied repeatedly during drag reposition updates.
    let size = window
        .inner_size()
        .map_err(|e| format!("Failed to get size: {}", e))?;

    // Set position only (preserve size)
    set_physical_bounds(&window, x, y, size.width, size.height)?;

    Ok(())
}

/// Set capture toolbar bounds (position + size) and show the window.
/// Called by frontend after measuring content and calculating position.
/// This allows frontend to fully control toolbar layout without hardcoded dimensions.
#[command]
pub async fn set_capture_toolbar_bounds(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) else {
        return Ok(());
    };

    // Set position and size using physical coordinates
    set_physical_bounds(&window, x, y, width, height)?;

    // Ensure window is visible and on top
    window
        .show()
        .map_err(|e| format!("Failed to show toolbar: {}", e))?;
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    // Re-apply DWM transparency
    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!("Failed to apply DWM transparency: {}", e);
    }

    // Bring toolbar to front and focus it
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, SetForegroundWindow, SetWindowPos, HWND_TOPMOST, SWP_NOMOVE,
            SWP_NOSIZE, SWP_SHOWWINDOW,
        };

        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let hwnd = HWND(hwnd.0);
                // Set as topmost
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
                );
                // Bring to top of Z-order
                let _ = BringWindowToTop(hwnd);
                // Set as foreground window (gives keyboard focus)
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }

    Ok(())
}

/// Set whether the capture toolbar should ignore cursor events (click-through).
/// NOTE: This is now a no-op since toolbar uses decorations (title bar).
/// Kept for API compatibility.
#[command]
pub async fn set_capture_toolbar_ignore_cursor(
    _app: AppHandle,
    _ignore: bool,
) -> MoonSnapResult<()> {
    // No-op: toolbar now has decorations, no click-through needed
    Ok(())
}

// ============================================================================
// Startup Toolbar
// ============================================================================

/// Show the startup toolbar window centered on the primary monitor.
/// This is the main toolbar shown on app startup for initiating captures.
/// Different from capture toolbar which appears during region selection.
#[command]
pub async fn show_startup_toolbar(
    app: AppHandle,
    capture_type: Option<String>,
    source_mode: Option<String>,
    auto_start_area_selection: Option<bool>,
) -> MoonSnapResult<()> {
    if crate::commands::video_recording::block_capture_attempt_while_recording(&app)? {
        return Ok(());
    }

    let auto_start_area_selection = auto_start_area_selection.unwrap_or(false);
    let startup_context = build_startup_toolbar_context(
        capture_type.clone(),
        source_mode.clone(),
        auto_start_area_selection,
    );
    let toolbar_state = app.state::<CaptureToolbarWindowState>();
    let _create_guard = toolbar_state.create_lock.lock();

    // Check if window already exists
    if let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) {
        log::debug!("[show_startup_toolbar] Window already exists, bringing to front");
        let _ = window.emit("startup-toolbar-context", startup_context);

        if !auto_start_area_selection {
            std::thread::sleep(std::time::Duration::from_millis(
                STARTUP_TOOLBAR_CONTEXT_APPLY_DELAY_MS,
            ));
            window
                .show()
                .map_err(|e| format!("Failed to show toolbar: {}", e))?;
            bring_window_to_front_without_topmost(&window, true);
            window
                .set_always_on_top(false)
                .map_err(|e| format!("Failed to clear toolbar always-on-top: {}", e))?;
            window
                .set_focus()
                .map_err(|e| format!("Failed to focus toolbar: {}", e))?;
        }
        return Ok(());
    }

    log::debug!("[show_startup_toolbar] Creating new window");

    let primary_monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get primary monitor: {}", e))?
        .ok_or_else(|| "No primary monitor found".to_string())?;

    let monitor_pos = primary_monitor.position();
    let monitor_size = primary_monitor.size();

    // No URL params - toolbar starts in startup state by default
    let url = WebviewUrl::App("windows/capture-toolbar.html".into());

    let initial_width = STARTUP_TOOLBAR_WIDTH;
    let initial_height = STARTUP_TOOLBAR_HEIGHT;

    let centered_position = calculate_startup_toolbar_position(
        monitor_pos.x,
        monitor_pos.y,
        monitor_size.width,
        monitor_size.height,
        initial_width,
        initial_height,
    );
    let (x, y) = toolbar_state
        .last_startup_position()
        .unwrap_or(centered_position);

    log::debug!(
        "[show_startup_toolbar] Position ({}, {}), size {}x{}",
        x,
        y,
        initial_width,
        initial_height
    );

    {
        let mut pending_startup_context = toolbar_state.pending_startup_context.lock();
        *pending_startup_context = Some(startup_context);
    }

    // Create window hidden. The frontend measures the rendered content, resizes
    // the native window, then shows it to avoid exposing the fallback bounds.
    // Uses custom titlebar like the main library window (decorations: false, transparent: true)
    let window_result = WebviewWindowBuilder::new(&app, CAPTURE_TOOLBAR_LABEL, url)
        .title("MoonSnap Capture")
        .transparent(true)
        .decorations(false)
        .maximizable(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .resizable(false) // Auto-resized by frontend
        .shadow(false)
        .visible(false)
        .focused(false)
        .build();

    let window = match window_result {
        Ok(window) => window,
        Err(e) => {
            let mut pending_startup_context = toolbar_state.pending_startup_context.lock();
            pending_startup_context.take();
            return Err(format!("Failed to create startup toolbar window: {}", e).into());
        },
    };

    // Set position/size using physical coordinates
    set_physical_bounds(&window, x, y, initial_width, initial_height)?;

    log::info!("[show_startup_toolbar] Toolbar ready");

    Ok(())
}

/// Hide the startup toolbar (used when starting a capture).
#[command]
pub async fn hide_startup_toolbar(app: AppHandle) -> MoonSnapResult<()> {
    if let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) {
        window
            .hide()
            .map_err(|e| format!("Failed to hide toolbar: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::calculate_startup_toolbar_position;

    #[test]
    fn startup_toolbar_position_centers_on_primary_monitor() {
        let (x, y) = calculate_startup_toolbar_position(0, 0, 1920, 1080, 738, 147);

        assert_eq!(x, 591);
        assert_eq!(y, 466);
    }
}
