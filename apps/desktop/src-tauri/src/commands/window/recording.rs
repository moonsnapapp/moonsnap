//! Recording border and countdown window commands.

use tauri::{command, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{
    apply_dwm_transparency, exclude_window_from_capture, include_window_in_capture,
    set_physical_bounds, COUNTDOWN_WINDOW_LABEL, RECORDING_BORDER_LABEL, RECORDING_CONTROLS_LABEL,
    RECORDING_MODE_CHOOSER_LABEL,
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

const RECORDING_CONTROLS_INITIAL_WIDTH: u32 = 360;
const RECORDING_CONTROLS_INITIAL_HEIGHT: u32 = 60;
const RECORDING_MODE_CHOOSER_INITIAL_WIDTH: u32 = 430;
const RECORDING_MODE_CHOOSER_INITIAL_HEIGHT: u32 = 180;
const FLOATING_WINDOW_EDGE_MARGIN: i32 = 16;

fn center_floating_window(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    floating_width: u32,
    floating_height: u32,
) -> (i32, i32) {
    (
        x + (width as i32 - floating_width as i32) / 2,
        y + (height as i32 - floating_height as i32) / 2,
    )
}

fn clamp_floating_window_to_monitor(
    app: &AppHandle,
    anchor_x: i32,
    anchor_y: i32,
    anchor_width: u32,
    anchor_height: u32,
    window_x: i32,
    window_y: i32,
    floating_width: u32,
    floating_height: u32,
) -> (i32, i32) {
    let Ok(monitors) = app.available_monitors() else {
        return (window_x, window_y);
    };

    let anchor_center_x = anchor_x + anchor_width as i32 / 2;
    let anchor_center_y = anchor_y + anchor_height as i32 / 2;

    let Some(monitor) = monitors
        .iter()
        .find(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();

            anchor_center_x >= pos.x
                && anchor_center_x < pos.x + size.width as i32
                && anchor_center_y >= pos.y
                && anchor_center_y < pos.y + size.height as i32
        })
        .or_else(|| monitors.first())
    else {
        return (window_x, window_y);
    };

    let pos = monitor.position();
    let size = monitor.size();
    let min_x = pos.x + FLOATING_WINDOW_EDGE_MARGIN;
    let min_y = pos.y + FLOATING_WINDOW_EDGE_MARGIN;
    let max_x = pos.x + size.width as i32 - floating_width as i32 - FLOATING_WINDOW_EDGE_MARGIN;
    let max_y = pos.y + size.height as i32 - floating_height as i32 - FLOATING_WINDOW_EDGE_MARGIN;

    let clamped_x = if max_x >= min_x {
        window_x.clamp(min_x, max_x)
    } else {
        pos.x
    };

    let clamped_y = if max_y >= min_y {
        window_y.clamp(min_y, max_y)
    } else {
        pos.y
    };

    (clamped_x, clamped_y)
}

fn get_window_size_or_default(
    window: &tauri::WebviewWindow,
    fallback_width: u32,
    fallback_height: u32,
) -> (u32, u32) {
    window
        .outer_size()
        .map(|size| (size.width.max(1), size.height.max(1)))
        .unwrap_or((fallback_width, fallback_height))
}

fn chooser_window_bounds(
    app: &AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    chooser_width: u32,
    chooser_height: u32,
) -> (i32, i32, u32, u32) {
    let (preferred_x, preferred_y) =
        center_floating_window(x, y, width, height, chooser_width, chooser_height);
    let (window_x, window_y) = clamp_floating_window_to_monitor(
        app,
        x,
        y,
        width,
        height,
        preferred_x,
        preferred_y,
        chooser_width,
        chooser_height,
    );

    (window_x, window_y, chooser_width, chooser_height)
}

fn bring_floating_window_to_front(
    window: &tauri::WebviewWindow,
    focus: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST,
            SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOW,
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
                let _ = BringWindowToTop(hwnd);
                if focus {
                    let _ = SetForegroundWindow(hwnd);
                }
            }
        }
    }

    window
        .show()
        .map_err(|e| format!("Failed to show floating window: {}", e))?;
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to keep floating window on top: {}", e))?;

    if focus {
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus floating window: {}", e))?;
    }

    Ok(())
}

/// Show the recording controls window used while the main toolbar is excluded from capture.
#[command]
pub async fn show_recording_controls(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    include_in_capture: Option<bool>,
    center_on_selection: Option<bool>,
    microphone_device_index: Option<usize>,
    system_audio_enabled: Option<bool>,
    recording_format: Option<String>,
) -> Result<(), String> {
    let include_in_capture = include_in_capture.unwrap_or(false);
    let center_on_selection = center_on_selection.unwrap_or(false);
    let system_audio_enabled = system_audio_enabled.unwrap_or(true);
    let recording_format = recording_format.unwrap_or_else(|| "mp4".to_string());

    let (window_x, window_y) = if center_on_selection {
        center_floating_window(
            x,
            y,
            width,
            height,
            RECORDING_CONTROLS_INITIAL_WIDTH,
            RECORDING_CONTROLS_INITIAL_HEIGHT,
        )
    } else {
        (x, y)
    };

    let audio_config_script = format!(
        "window.__MOONSNAP_RECORDING_AUDIO_CONFIG = {}; window.__MOONSNAP_RECORDING_FORMAT = {};",
        serde_json::to_string(&serde_json::json!({
            "microphoneDeviceIndex": microphone_device_index,
            "systemAudioEnabled": system_audio_enabled,
        }))
        .map_err(|e| format!("Failed to serialize recording audio config: {}", e))?,
        serde_json::to_string(&recording_format)
            .map_err(|e| format!("Failed to serialize recording format: {}", e))?
    );

    if let Some(window) = app.get_webview_window(RECORDING_CONTROLS_LABEL) {
        // Preserve the current position once the user has dragged the HUD.
        // State transitions like pause/resume should only refresh visibility and
        // capture affinity, not snap the controls back to their initial anchor.
        let _ = window.eval(&audio_config_script);
        window
            .show()
            .map_err(|e| format!("Failed to show recording controls: {}", e))?;
        if let Err(e) = apply_dwm_transparency(&window) {
            log::warn!(
                "Failed to re-apply DWM transparency to recording controls: {}",
                e
            );
        }
        if include_in_capture {
            include_window_in_capture(&window)?;
        } else {
            exclude_window_from_capture(&window)?;
        }
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
        .initialization_script(audio_config_script)
        .build()
        .map_err(|e| format!("Failed to create recording controls window: {}", e))?;

    set_physical_bounds(
        &window,
        window_x,
        window_y,
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
    if include_in_capture {
        include_window_in_capture(&window)?;
    } else {
        exclude_window_from_capture(&window)?;
    }
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
// Recording Mode Chooser Window
// ============================================================================

#[command]
pub async fn show_recording_mode_chooser(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    owner: Option<String>,
) -> Result<(), String> {
    let owner = owner.unwrap_or_else(|| "capture-toolbar".to_string());
    let (window_x, window_y, chooser_width, chooser_height) = chooser_window_bounds(
        &app,
        x,
        y,
        width,
        height,
        RECORDING_MODE_CHOOSER_INITIAL_WIDTH,
        RECORDING_MODE_CHOOSER_INITIAL_HEIGHT,
    );

    if let Some(window) = app.get_webview_window(RECORDING_MODE_CHOOSER_LABEL) {
        reposition_recording_mode_chooser(&app, x, y, width, height)?;
        if let Err(e) = apply_dwm_transparency(&window) {
            log::warn!(
                "Failed to re-apply DWM transparency to recording mode chooser: {}",
                e
            );
        }
        bring_floating_window_to_front(&window, true)?;
        let _ = window.emit(
            "recording-mode-chooser-context",
            serde_json::json!({ "owner": owner }),
        );
        return Ok(());
    }

    let url = WebviewUrl::App("windows/recording-mode-chooser.html".into());
    let owner_script = format!(
        "window.__MOONSNAP_RECORDING_MODE_CHOOSER_OWNER = {};",
        serde_json::to_string(&owner)
            .map_err(|e| format!("Failed to serialize recording mode chooser owner: {}", e))?
    );

    let window = WebviewWindowBuilder::new(&app, RECORDING_MODE_CHOOSER_LABEL, url)
        .title("Recording Mode")
        .inner_size(
            RECORDING_MODE_CHOOSER_INITIAL_WIDTH as f64,
            RECORDING_MODE_CHOOSER_INITIAL_HEIGHT as f64,
        )
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .initialization_script(owner_script)
        .build()
        .map_err(|e| format!("Failed to create recording mode chooser window: {}", e))?;

    set_physical_bounds(&window, window_x, window_y, chooser_width, chooser_height)?;

    if let Err(e) = apply_dwm_transparency(&window) {
        log::warn!(
            "Failed to apply DWM transparency to recording mode chooser: {}",
            e
        );
    }

    bring_floating_window_to_front(&window, true)?;
    let _ = window.emit(
        "recording-mode-chooser-context",
        serde_json::json!({ "owner": owner }),
    );

    Ok(())
}

pub(crate) fn reposition_recording_mode_chooser(
    app: &AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(RECORDING_MODE_CHOOSER_LABEL) else {
        return Ok(());
    };

    let (chooser_width, chooser_height) = get_window_size_or_default(
        &window,
        RECORDING_MODE_CHOOSER_INITIAL_WIDTH,
        RECORDING_MODE_CHOOSER_INITIAL_HEIGHT,
    );
    let (window_x, window_y, chooser_width, chooser_height) =
        chooser_window_bounds(app, x, y, width, height, chooser_width, chooser_height);

    set_physical_bounds(&window, window_x, window_y, chooser_width, chooser_height)
}

#[command]
pub async fn close_recording_mode_chooser(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(RECORDING_MODE_CHOOSER_LABEL) {
        window
            .close()
            .map_err(|e| format!("Failed to close recording mode chooser: {}", e))?;
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
