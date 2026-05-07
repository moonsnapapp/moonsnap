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
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

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

/// Default library window size in logical pixels.
const LIBRARY_DEFAULT_WIDTH: f64 = 1200.0;
const LIBRARY_DEFAULT_HEIGHT: f64 = 800.0;

/// Smallest useful physical size for the library shell. Smaller restored
/// values usually come from a bad saved state for the transparent hidden window.
const LIBRARY_MIN_VISIBLE_WIDTH: u32 = 800;
const LIBRARY_MIN_VISIBLE_HEIGHT: u32 = 600;

/// Allow a little slop for window frame/shadow extents when comparing against
/// the monitor that should contain the window.
const LIBRARY_MONITOR_SLOP_PX: u32 = 80;

/// Track if main window was visible before capture started
pub(crate) static MAIN_WAS_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Track the first explicit library reveal in this process.
/// The library starts hidden, and restoring a hidden saved position can leave
/// the first reveal off-center. Recenter once, then preserve subsequent moves.
pub(crate) static LIBRARY_WAS_REVEALED: AtomicBool = AtomicBool::new(false);

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

fn library_window_geometry_is_bad(window: &tauri::WebviewWindow) -> bool {
    let Ok(size) = window.outer_size() else {
        return true;
    };

    if size.width < LIBRARY_MIN_VISIBLE_WIDTH || size.height < LIBRARY_MIN_VISIBLE_HEIGHT {
        return true;
    }

    let Ok(position) = window.outer_position() else {
        return true;
    };

    let Ok(monitors) = window.app_handle().available_monitors() else {
        return false;
    };

    if monitors.is_empty() {
        return false;
    }

    let center_x = position.x + (size.width / 2) as i32;
    let center_y = position.y + (size.height / 2) as i32;

    monitors.iter().all(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_left = monitor_position.x;
        let monitor_top = monitor_position.y;
        let monitor_right = monitor_left + monitor_size.width as i32;
        let monitor_bottom = monitor_top + monitor_size.height as i32;

        center_x < monitor_left
            || center_x > monitor_right
            || center_y < monitor_top
            || center_y > monitor_bottom
            || size.width > monitor_size.width + LIBRARY_MONITOR_SLOP_PX
            || size.height > monitor_size.height + LIBRARY_MONITOR_SLOP_PX
    })
}

fn reset_library_window_bounds(window: &tauri::WebviewWindow) -> MoonSnapResult<()> {
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: LIBRARY_DEFAULT_WIDTH,
            height: LIBRARY_DEFAULT_HEIGHT,
        }))
        .map_err(|e| format!("Failed to reset library window size: {}", e))?;
    window
        .center()
        .map_err(|e| format!("Failed to center library window: {}", e))?;

    Ok(())
}

fn normalize_library_window_for_reveal(
    window: &tauri::WebviewWindow,
    first_reveal: bool,
    was_visible: bool,
) -> MoonSnapResult<()> {
    window
        .set_always_on_top(false)
        .map_err(|e| format!("Failed to clear library always-on-top: {}", e))?;

    let is_restoring_hidden_window = first_reveal || !was_visible;
    let was_fullscreen = window.is_fullscreen().unwrap_or(false);
    if was_fullscreen && is_restoring_hidden_window {
        window
            .set_fullscreen(false)
            .map_err(|e| format!("Failed to exit library fullscreen: {}", e))?;
    }

    if window.is_minimized().unwrap_or(false) {
        window
            .unminimize()
            .map_err(|e| format!("Failed to unminimize library window: {}", e))?;
    }

    let was_maximized = window.is_maximized().unwrap_or(false);
    if was_maximized && is_restoring_hidden_window {
        window
            .unmaximize()
            .map_err(|e| format!("Failed to restore library window: {}", e))?;
    }

    let should_reset_bounds = library_window_geometry_is_bad(window)
        || (is_restoring_hidden_window && (was_maximized || was_fullscreen));
    if should_reset_bounds {
        reset_library_window_bounds(window)?;
    } else if first_reveal {
        window
            .center()
            .map_err(|e| format!("Failed to center library window: {}", e))?;
    }

    Ok(())
}

/// Show the library window, centering it the first time it is explicitly shown
/// in a process so startup restores do not leave it off-center. The library is
/// transparent and starts hidden, so stale minimized/maximized/fullscreen or
/// off-screen state can otherwise reveal as a blank black shell.
pub(crate) fn reveal_library_window(
    window: &tauri::WebviewWindow,
    focus: bool,
) -> MoonSnapResult<()> {
    let first_reveal = !LIBRARY_WAS_REVEALED.swap(true, Ordering::SeqCst);
    let was_visible = window.is_visible().unwrap_or(false);
    normalize_library_window_for_reveal(window, first_reveal, was_visible)?;

    window
        .show()
        .map_err(|e| format!("Failed to show library window: {}", e))?;

    if focus {
        bring_window_to_front_without_topmost(window, true);
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus library window: {}", e))?;
    }

    Ok(())
}

/// Restore main window if it was visible before capture started
pub(crate) fn restore_main_if_visible(app: &tauri::AppHandle) {
    if MAIN_WAS_VISIBLE.load(Ordering::SeqCst) {
        if let Some(main_window) = app.get_webview_window("library") {
            let _ = reveal_library_window(&main_window, false);
        }
    }
}
