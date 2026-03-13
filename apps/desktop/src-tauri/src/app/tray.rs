//! System tray setup and event handling.
//!
//! This module contains all tray-related functionality extracted from lib.rs
//! for better code organization.

use std::sync::Mutex;

use moonsnap_domain::capture::ScreenRegionSelection;
use moonsnap_domain::recording::{RecordingFormat, RecordingState};
use tauri::{
    image::Image,
    menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime, WebviewWindow,
};

use crate::commands;

/// Holds references to tray menu items for dynamic updates.
pub struct TrayState {
    pub open_capture_toolbar: MenuItem<tauri::Wry>,
    pub new_capture: MenuItem<tauri::Wry>,
    pub fullscreen: MenuItem<tauri::Wry>,
    pub all_monitors: MenuItem<tauri::Wry>,
    pub record_video: MenuItem<tauri::Wry>,
    pub record_gif: MenuItem<tauri::Wry>,
    pub recording_status: MenuItem<tauri::Wry>,
    pub pause_or_resume_recording: MenuItem<tauri::Wry>,
    pub stop_recording: MenuItem<tauri::Wry>,
    pub discard_recording: MenuItem<tauri::Wry>,
}

impl TrayState {
    /// Update the "Open Capture Toolbar" menu item text.
    pub fn update_open_capture_toolbar_text(&self, text: &str) -> Result<(), tauri::Error> {
        self.open_capture_toolbar.set_text(text)
    }

    /// Update the "New Capture" menu item text (e.g., to show shortcut).
    pub fn update_new_capture_text(&self, text: &str) -> Result<(), tauri::Error> {
        self.new_capture.set_text(text)
    }

    /// Update the "Fullscreen" menu item text.
    pub fn update_fullscreen_text(&self, text: &str) -> Result<(), tauri::Error> {
        self.fullscreen.set_text(text)
    }

    /// Update the "All Monitors" menu item text.
    pub fn update_all_monitors_text(&self, text: &str) -> Result<(), tauri::Error> {
        self.all_monitors.set_text(text)
    }

    /// Update the "Record Video…" menu item text.
    pub fn update_record_video_text(&self, text: &str) -> Result<(), tauri::Error> {
        self.record_video.set_text(text)
    }

    /// Update the "Record GIF…" menu item text.
    pub fn update_record_gif_text(&self, text: &str) -> Result<(), tauri::Error> {
        self.record_gif.set_text(text)
    }

    fn set_capture_actions_enabled(&self, enabled: bool) -> Result<(), tauri::Error> {
        self.open_capture_toolbar.set_enabled(enabled)?;
        self.new_capture.set_enabled(enabled)?;
        self.fullscreen.set_enabled(enabled)?;
        self.all_monitors.set_enabled(enabled)?;
        self.record_video.set_enabled(enabled)?;
        self.record_gif.set_enabled(enabled)?;
        Ok(())
    }

    fn set_recording_controls(
        &self,
        status_text: &str,
        pause_text: &str,
        pause_enabled: bool,
        stop_enabled: bool,
        discard_text: &str,
        discard_enabled: bool,
    ) -> Result<(), tauri::Error> {
        self.recording_status.set_text(status_text)?;
        self.pause_or_resume_recording.set_text(pause_text)?;
        self.pause_or_resume_recording.set_enabled(pause_enabled)?;
        self.stop_recording.set_enabled(stop_enabled)?;
        self.discard_recording.set_text(discard_text)?;
        self.discard_recording.set_enabled(discard_enabled)?;
        Ok(())
    }

    /// Update tray affordances based on the current recording state.
    pub fn update_recording_state(
        &self,
        state: &RecordingState,
        format: Option<RecordingFormat>,
    ) -> Result<(), tauri::Error> {
        match state {
            RecordingState::Idle
            | RecordingState::Completed { .. }
            | RecordingState::Error { .. } => {
                self.set_capture_actions_enabled(true)?;
                self.set_recording_controls(
                    "Ready to Capture",
                    "Pause Recording",
                    false,
                    false,
                    "Discard Recording",
                    false,
                )?;
            },
            RecordingState::Countdown { .. } => {
                self.set_capture_actions_enabled(false)?;
                self.set_recording_controls(
                    "Starting Recording…",
                    "Pause Recording",
                    false,
                    false,
                    "Cancel Recording",
                    true,
                )?;
            },
            RecordingState::Recording { .. } => {
                self.set_capture_actions_enabled(false)?;
                let is_video = matches!(format, Some(RecordingFormat::Mp4));
                self.set_recording_controls(
                    if is_video {
                        "Recording Video…"
                    } else {
                        "Recording GIF…"
                    },
                    "Pause Recording",
                    is_video,
                    true,
                    "Discard Recording",
                    true,
                )?;
            },
            RecordingState::Paused { .. } => {
                self.set_capture_actions_enabled(false)?;
                self.set_recording_controls(
                    "Recording Paused",
                    "Resume Recording",
                    true,
                    true,
                    "Discard Recording",
                    true,
                )?;
            },
            RecordingState::Processing { .. } => {
                self.set_capture_actions_enabled(false)?;
                self.set_recording_controls(
                    "Processing Recording…",
                    "Pause Recording",
                    false,
                    false,
                    "Discard Recording",
                    false,
                )?;
            },
        }

        Ok(())
    }
}

fn should_open_tray_menu(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left | MouseButton::Right,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

fn resolve_tray_menu_owner_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    // Prefer visible windows so the native popup can reliably take foreground.
    for label in ["capture-toolbar", "library", "settings"] {
        if let Some(window) = app.get_webview_window(label) {
            if window.is_visible().unwrap_or(false) {
                return Some(window);
            }
        }
    }

    // Fall back to known windows even if hidden.
    for label in ["capture-toolbar", "library", "settings"] {
        if let Some(window) = app.get_webview_window(label) {
            return Some(window);
        }
    }

    app.webview_windows().into_values().next()
}

fn popup_tray_menu<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) {
    let Some(owner_window) = resolve_tray_menu_owner_window(app) else {
        log::warn!("No window available to anchor tray menu popup");
        return;
    };

    let window = owner_window.as_ref().window();
    if let Err(error) = menu.popup(window) {
        log::error!("Failed to open tray menu: {}", error);
    }
}

/// Set up the system tray with menu and event handlers.
///
/// Returns a `TrayState` that should be managed by the app for dynamic updates.
pub fn setup_system_tray(app: &App) -> Result<TrayState, Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit MoonSnap", true, None::<&str>)?;
    let open_capture_toolbar = MenuItem::with_id(
        app,
        "open_capture_toolbar",
        "Open Capture Toolbar",
        true,
        None::<&str>,
    )?;
    let capture = MenuItem::with_id(app, "capture", "New Screenshot", true, None::<&str>)?;
    let capture_full =
        MenuItem::with_id(app, "capture_full", "Current Display", true, None::<&str>)?;
    let capture_all = MenuItem::with_id(app, "capture_all", "All Displays", true, None::<&str>)?;
    let record_video = MenuItem::with_id(app, "record_video", "Record Video…", true, None::<&str>)?;
    let record_gif = MenuItem::with_id(app, "record_gif", "Record GIF…", true, None::<&str>)?;
    let recording_status = MenuItem::with_id(
        app,
        "recording_status",
        "Ready to Capture",
        false,
        None::<&str>,
    )?;
    let pause_or_resume_recording = MenuItem::with_id(
        app,
        "pause_or_resume_recording",
        "Pause Recording",
        false,
        None::<&str>,
    )?;
    let stop_recording =
        MenuItem::with_id(app, "stop_recording", "Stop & Save", false, None::<&str>)?;
    let discard_recording = MenuItem::with_id(
        app,
        "discard_recording",
        "Discard Recording",
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "Open Library", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let separator1 = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let separator3 = PredefinedMenuItem::separator(app)?;
    let separator4 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_capture_toolbar,
            &separator1,
            &capture,
            &capture_full,
            &capture_all,
            &record_video,
            &record_gif,
            &separator2,
            &recording_status,
            &pause_or_resume_recording,
            &stop_recording,
            &discard_recording,
            &separator3,
            &show,
            &settings,
            &separator4,
            &quit,
        ],
    )?;

    // Load custom tray icon (32x32 is standard for system tray)
    let tray_icon = Image::from_bytes(include_bytes!("../../icons/32x32.png"))
        .expect("Failed to load tray icon");

    let tray_menu = menu.clone();
    let tray_app = app.handle().clone();

    let _tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .on_tray_icon_event(move |_tray, event| {
            if should_open_tray_menu(&event) {
                popup_tray_menu(&tray_app, &tray_menu);
            }
        })
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "open_capture_toolbar" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) =
                        commands::window::show_startup_toolbar(app_handle, None, None, None).await
                    {
                        log::error!("Failed to show capture toolbar: {}", e);
                    }
                });
            },
            "capture" => {
                let _ = commands::window::trigger_capture(app, Some("screenshot"));
            },
            "capture_full" => {
                // Fast fullscreen capture - no overlay, no PNG encoding
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(result) = commands::capture::capture_fullscreen_fast().await {
                        let _ = commands::window::open_editor_fast(
                            app_handle,
                            result.file_path,
                            result.width,
                            result.height,
                        )
                        .await;
                    }
                });
            },
            "capture_all" => {
                // Capture all monitors combined
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(bounds) = commands::capture::get_virtual_screen_bounds().await {
                        let selection = ScreenRegionSelection {
                            x: bounds.x,
                            y: bounds.y,
                            width: bounds.width,
                            height: bounds.height,
                        };
                        if let Ok(result) =
                            commands::capture::capture_screen_region_fast(selection).await
                        {
                            let _ = commands::window::open_editor_fast(
                                app_handle,
                                result.file_path,
                                result.width,
                                result.height,
                            )
                            .await;
                        }
                    }
                });
            },
            "record_video" => {
                if let Err(e) =
                    commands::window::trigger_capture_with_options(app, Some("video"), true)
                {
                    log::error!("Failed to start video area capture from tray: {}", e);
                }
            },
            "record_gif" => {
                if let Err(e) =
                    commands::window::trigger_capture_with_options(app, Some("gif"), true)
                {
                    log::error!("Failed to start GIF area capture from tray: {}", e);
                }
            },
            "pause_or_resume_recording" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match commands::video_recording::get_recording_status().await {
                        Ok(status) => match status.state {
                            RecordingState::Recording { .. } => {
                                if let Err(e) =
                                    commands::video_recording::pause_recording(app_handle).await
                                {
                                    log::error!("Failed to pause recording from tray: {}", e);
                                }
                            },
                            RecordingState::Paused { .. } => {
                                if let Err(e) =
                                    commands::video_recording::resume_recording(app_handle).await
                                {
                                    log::error!("Failed to resume recording from tray: {}", e);
                                }
                            },
                            _ => {},
                        },
                        Err(e) => log::error!("Failed to read recording status from tray: {}", e),
                    }
                });
            },
            "stop_recording" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = commands::video_recording::stop_recording(app_handle).await {
                        log::error!("Failed to stop recording from tray: {}", e);
                    }
                });
            },
            "discard_recording" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = commands::video_recording::cancel_recording(app_handle).await {
                        log::error!("Failed to discard recording from tray: {}", e);
                    }
                });
            },
            "show" => {
                if let Some(window) = app.get_webview_window("library") {
                    let _ = commands::window::reveal_library_window(&window, false);

                    // Use Windows API to forcefully bring window to front
                    #[cfg(target_os = "windows")]
                    {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::UI::WindowsAndMessaging::{
                            BringWindowToTop, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
                        };

                        if let Ok(hwnd) = window.hwnd() {
                            unsafe {
                                let hwnd = HWND(hwnd.0);
                                let _ = ShowWindow(hwnd, SW_RESTORE);
                                let _ = ShowWindow(hwnd, SW_SHOW);
                                let _ = BringWindowToTop(hwnd);
                                let _ = SetForegroundWindow(hwnd);
                            }
                        }
                    }
                    let _ = window.set_focus();
                }
            },
            "settings" => {
                // Show library window and emit event to open settings modal
                if let Some(window) = app.get_webview_window("library") {
                    let _ = commands::window::reveal_library_window(&window, false);

                    // Use Windows API to forcefully bring window to front
                    #[cfg(target_os = "windows")]
                    {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::UI::WindowsAndMessaging::{
                            BringWindowToTop, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
                        };

                        if let Ok(hwnd) = window.hwnd() {
                            unsafe {
                                let hwnd = HWND(hwnd.0);
                                let _ = ShowWindow(hwnd, SW_RESTORE);
                                let _ = ShowWindow(hwnd, SW_SHOW);
                                let _ = BringWindowToTop(hwnd);
                                let _ = SetForegroundWindow(hwnd);
                            }
                        }
                    }
                    let _ = window.set_focus();
                }
                let _ = app.emit("open-settings", ());
            },
            _ => {},
        })
        .build(app)?;

    Ok(TrayState {
        open_capture_toolbar,
        new_capture: capture,
        fullscreen: capture_full,
        all_monitors: capture_all,
        record_video,
        record_gif,
        recording_status,
        pause_or_resume_recording,
        stop_recording,
        discard_recording,
    })
}

/// Initialize the system tray and register it with the app state.
///
/// This is called from the app setup hook.
pub fn init(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let tray_state = setup_system_tray(app)?;
    app.manage(Mutex::new(tray_state));
    Ok(())
}
