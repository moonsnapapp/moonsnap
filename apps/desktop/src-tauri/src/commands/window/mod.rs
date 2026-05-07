//! Window management commands for MoonSnap.
//!
//! ## Architecture
//!
//! ```text
//! window/
//!   mod.rs      - Shared helpers (DWM, physical coords), re-exports
//!   capture.rs  - Capture flow, overlay commands
//!   toolbar.rs  - Capture toolbar and startup toolbar
//!   recording.rs - Recording border and countdown windows
//! ```

pub mod capture;
pub(crate) mod editor_windows;
pub mod image_editor;
pub mod recording;
pub mod recording_preview;
pub mod screenshot_preview;
pub mod settings;
pub mod toolbar;
pub mod video_editor;

// Re-export commonly used functions for internal use (used by app/tray.rs)
pub use capture::{trigger_capture, trigger_capture_with_options};
pub use toolbar::show_startup_toolbar;

use moonsnap_core::error::MoonSnapResult;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_window_state::{StateFlags, WindowExt, DEFAULT_FILENAME};

// ============================================================================
// Constants
// ============================================================================

/// Recording border window label (legacy, kept for compatibility)
pub(crate) const RECORDING_BORDER_LABEL: &str = "recording-border";

/// Capture toolbar window label
pub(crate) const CAPTURE_TOOLBAR_LABEL: &str = "capture-toolbar";

/// Countdown window label
pub(crate) const COUNTDOWN_WINDOW_LABEL: &str = "countdown";

/// Recording controls window label
pub(crate) const RECORDING_CONTROLS_LABEL: &str = "recording-controls";

/// Recording mode chooser window label
pub(crate) const RECORDING_MODE_CHOOSER_LABEL: &str = "recording-mode-chooser";

/// Track if main window was visible before capture started
pub(crate) static MAIN_WAS_VISIBLE: AtomicBool = AtomicBool::new(false);

// ============================================================================
// Physical Coordinate Helpers
// ============================================================================
// Windows APIs return physical (pixel) coordinates. Tauri's builder methods
// use logical coordinates which don't match on scaled displays.
// These helpers ensure windows are positioned/sized using physical coordinates.

/// Position a window using physical (pixel) coordinates.
/// Use this when you have screen coordinates from Windows APIs.
pub(crate) fn set_physical_position(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
) -> MoonSnapResult<()> {
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| format!("Failed to set position: {}", e).into())
}

/// Resize a window using physical (pixel) dimensions.
/// Use this when you have dimensions from Windows APIs.
pub(crate) fn set_physical_size(
    window: &tauri::WebviewWindow,
    width: u32,
    height: u32,
) -> MoonSnapResult<()> {
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| format!("Failed to set size: {}", e).into())
}

/// Position and resize a window using physical (pixel) coordinates.
/// Convenience wrapper for set_physical_position + set_physical_size.
pub(crate) fn set_physical_bounds(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> MoonSnapResult<()> {
    set_physical_position(window, x, y)?;
    set_physical_size(window, width, height)
}

#[cfg(target_os = "windows")]
pub(crate) fn bring_window_to_front_without_topmost(window: &tauri::WebviewWindow, focus: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST,
        HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
    };

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let hwnd = HWND(hwnd.0);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = SetWindowPos(
                hwnd,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = BringWindowToTop(hwnd);
            if focus {
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn bring_window_to_front_without_topmost(_window: &tauri::WebviewWindow, _focus: bool) {}

// ============================================================================
// DWM Helpers (Windows-specific)
// ============================================================================

/// Apply DWM blur-behind transparency to a window.
/// This uses a tiny off-screen blur region trick (from PowerToys) to get
/// DWM-composited transparency without WS_EX_LAYERED, avoiding hardware video blackout.
#[cfg(target_os = "windows")]
pub fn apply_dwm_transparency(window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
    };
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, HRGN};
    use windows::Win32::UI::WindowsAndMessaging::GetSystemMetrics;
    use windows::Win32::UI::WindowsAndMessaging::SM_CXVIRTUALSCREEN;

    let hwnd = window
        .hwnd()
        .map_err(|e| format!("Failed to get HWND: {}", e))?;

    unsafe {
        // Create a tiny region way off-screen (PowerToys trick)
        // This enables DWM blur/transparency without actually blurring anything visible
        let pos = -GetSystemMetrics(SM_CXVIRTUALSCREEN) - 8;
        let hrgn: HRGN = CreateRectRgn(pos, 0, pos + 1, 1);

        if hrgn.is_invalid() {
            return Err("Failed to create region".into());
        }

        let blur_behind = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: true.into(),
            hRgnBlur: hrgn,
            fTransitionOnMaximized: false.into(),
        };

        let result = DwmEnableBlurBehindWindow(HWND(hwnd.0), &blur_behind);

        // Clean up the region
        let _ = DeleteObject(hrgn);

        result.map_err(|e| format!("Failed to enable blur behind: {:?}", e))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn apply_dwm_transparency(_window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    // DWM is Windows-only, use regular transparency on other platforms
    Ok(())
}

/// Apply Windows 11 native rounded corners to a window.
/// Exclude a window from screen capture using Windows API.
/// This prevents the window from appearing in screenshots and screen recordings.
#[cfg(target_os = "windows")]
pub(crate) fn exclude_window_from_capture(window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    let hwnd = window
        .hwnd()
        .map_err(|e| format!("Failed to get HWND: {}", e))?;

    unsafe {
        SetWindowDisplayAffinity(HWND(hwnd.0), WDA_EXCLUDEFROMCAPTURE)
            .map_err(|e| format!("Failed to set display affinity: {:?}", e))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn exclude_window_from_capture(_window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    // Not supported on non-Windows platforms
    Ok(())
}

/// Include a window in screen capture by resetting display affinity.
/// This reverses `exclude_window_from_capture`.
#[cfg(target_os = "windows")]
pub(crate) fn include_window_in_capture(window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_NONE};

    let hwnd = window
        .hwnd()
        .map_err(|e| format!("Failed to get HWND: {}", e))?;

    unsafe {
        SetWindowDisplayAffinity(HWND(hwnd.0), WDA_NONE)
            .map_err(|e| format!("Failed to reset display affinity: {:?}", e))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn include_window_in_capture(_window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    Ok(())
}

// ============================================================================
// Internal Helpers
// ============================================================================

/// Close recording border window (not toolbar - it persists)
pub(crate) fn close_recording_border_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(RECORDING_BORDER_LABEL) {
        let _ = window.close();
    }
}

/// Close recording controls window.
pub(crate) fn close_recording_controls_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(RECORDING_CONTROLS_LABEL) {
        let _ = window.close();
    }
}

/// Close recording mode chooser window.
pub(crate) fn close_recording_mode_chooser_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(RECORDING_MODE_CHOOSER_LABEL) {
        let _ = window.close();
    }
}

/// Close all capture-related windows including toolbar
pub(crate) fn close_all_capture_windows(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(CAPTURE_TOOLBAR_LABEL) {
        let _ = window.close();
    }
    close_recording_border_window(app);
    close_recording_controls_window(app);
    close_recording_mode_chooser_window(app);
}

/// Show the library window at its current/restored position.
pub(crate) fn reveal_library_window(
    window: &tauri::WebviewWindow,
    focus: bool,
) -> MoonSnapResult<()> {
    let has_saved_bounds = has_usable_saved_library_window_bounds(window);
    if let Err(error) =
        window.restore_state(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
    {
        log::warn!(
            "Failed to restore library window state before reveal: {}",
            error
        );
    }

    if !has_saved_bounds {
        window
            .center()
            .map_err(|e| format!("Failed to center library window: {}", e))?;
    }

    window
        .show()
        .map_err(|e| format!("Failed to show library window: {}", e))?;

    if focus {
        bring_window_to_front_without_topmost(window, true);
        window
            .set_always_on_top(false)
            .map_err(|e| format!("Failed to clear library always-on-top: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus library window: {}", e))?;
    }

    Ok(())
}

fn has_usable_saved_library_window_bounds(window: &tauri::WebviewWindow) -> bool {
    let app_handle = window.app_handle();
    let Ok(config_dir) = app_handle.path().app_config_dir() else {
        return false;
    };
    let Ok(raw_state) = std::fs::read_to_string(config_dir.join(DEFAULT_FILENAME)) else {
        return false;
    };
    let Ok(state) = serde_json::from_str::<Value>(&raw_state) else {
        return false;
    };
    let Some(library_state) = state.get("library") else {
        return false;
    };

    let Some(width) = library_state.get("width").and_then(Value::as_u64) else {
        return false;
    };
    let Some(height) = library_state.get("height").and_then(Value::as_u64) else {
        return false;
    };
    let Some(x) = library_state.get("x").and_then(Value::as_i64) else {
        return false;
    };
    let Some(y) = library_state.get("y").and_then(Value::as_i64) else {
        return false;
    };

    if width == 0 || height == 0 {
        return false;
    }

    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    monitors.into_iter().any(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let monitor_left = position.x as i64;
        let monitor_top = position.y as i64;
        let monitor_right = monitor_left + size.width as i64;
        let monitor_bottom = monitor_top + size.height as i64;
        let window_right = x + width as i64;
        let window_bottom = y + height as i64;

        x < monitor_right
            && window_right > monitor_left
            && y < monitor_bottom
            && window_bottom > monitor_top
    })
}

/// Restore main window if it was visible before capture started
pub(crate) fn restore_main_if_visible(app: &tauri::AppHandle) {
    if MAIN_WAS_VISIBLE.load(Ordering::SeqCst) {
        if let Some(main_window) = app.get_webview_window("library") {
            let _ = reveal_library_window(&main_window, false);
        }
    }
}
