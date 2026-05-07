//! Win32 window procedure for the overlay.
//!
//! Handles all window messages including mouse input, keyboard input,
//! and cursor management.

use crate::commands::window::recording::reposition_recording_mode_chooser;
use tauri::{Emitter, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{BeginPaint, EndPaint, PAINTSTRUCT};
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, DefWindowProcW, DestroyMenu, GetCursorPos, GetWindowLongPtrW,
    GetWindowRect, IsWindowVisible, LoadCursorW, SetCursor, SetWindowPos, TrackPopupMenu,
    GWLP_USERDATA, HTCLIENT, HTTRANSPARENT, HWND_TOPMOST, IDC_ARROW, IDC_CROSS, IDC_SIZEALL,
    MF_STRING, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, TPM_LEFTALIGN, TPM_RETURNCMD, TPM_TOPALIGN,
    WM_CHAR, WM_CREATE, WM_DESTROY, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MOUSEMOVE, WM_NCHITTEST, WM_PAINT, WM_RBUTTONDOWN, WM_SETCURSOR,
};

use super::input::{get_area_target_at_point, get_window_at_point, hit_test_handle};
use super::render;
use super::state::{MonitorInfo, OverlayState};
use super::types::*;

/// Virtual key codes
const VK_ESCAPE: u32 = 0x1B;
const VK_RETURN: u32 = 0x0D;
const VK_BACK: u32 = 0x08;
const DIMENSION_PRESETS: [(&str, u32, u32); 6] = [
    ("1080p", 1920, 1080),
    ("720p", 1280, 720),
    ("480p", 854, 480),
    ("4:3", 640, 480),
    ("Square", 1080, 1080),
    ("Story", 1080, 1920),
];

/// Window procedure for the overlay.
///
/// # Safety
/// This is a Win32 callback and must be marked unsafe.
pub unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut OverlayState;

    match msg {
        WM_CREATE => LRESULT(0),
        WM_DESTROY => LRESULT(0),
        WM_PAINT => handle_paint(hwnd),
        WM_NCHITTEST => handle_nchittest(state_ptr, lparam),
        WM_SETCURSOR => handle_set_cursor(state_ptr, lparam),
        WM_LBUTTONDOWN => handle_mouse_down(state_ptr, lparam),
        WM_MOUSEMOVE => handle_mouse_move(state_ptr, lparam),
        WM_LBUTTONUP => handle_mouse_up(state_ptr),
        WM_KEYDOWN => handle_key_down(state_ptr, wparam),
        WM_KEYUP => handle_key_up(state_ptr, wparam),
        WM_CHAR => handle_char(state_ptr, wparam),
        WM_RBUTTONDOWN => LRESULT(0), // Ignore right-click
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Handle WM_PAINT - minimal handling since we use DirectComposition
fn handle_paint(hwnd: HWND) -> LRESULT {
    unsafe {
        let mut ps = PAINTSTRUCT::default();
        let _hdc = BeginPaint(hwnd, &mut ps);
        let _ = EndPaint(hwnd, &ps);
    }
    LRESULT(0)
}

/// Handle WM_NCHITTEST - pass clicks through to windows below when not on a resize handle.
///
/// When the toolbar is visible (adjustment mode active, not locked), the overlay
/// stays interactive for resize handles but returns HTTRANSPARENT for all other
/// areas so the toolbar and desktop can receive clicks.
fn handle_nchittest(state_ptr: *mut OverlayState, lparam: LPARAM) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(HTCLIENT as isize);
        }

        let state = &*state_ptr;
        // During initial selection (not yet in adjustment mode), keep overlay interactive
        if !state.adjustment.is_active {
            return LRESULT(HTCLIENT as isize);
        }

        // WM_NCHITTEST reports screen coordinates. Convert them into the overlay's
        // local coordinate space before checking resize handles.
        let (screen_x, screen_y) =
            current_screen_mouse_coords().unwrap_or_else(|| mouse_coords(lparam));

        let local = state.monitor.screen_to_local(screen_x, screen_y);
        if render::hit_test_recording_mode_chooser(state, local.x, local.y)
            != RecordingModeChooserHitTarget::None
        {
            return LRESULT(HTCLIENT as isize);
        }
        if render::hit_test_selection_hud(state, local.x, local.y) != SelectionHudHitTarget::None {
            return LRESULT(HTCLIENT as isize);
        }

        if is_screen_point_over_auxiliary_window(state, screen_x, screen_y) {
            return LRESULT(HTTRANSPARENT as isize);
        }

        // Locked selections do not expose adjustment handles. They should stay
        // click-through except while interacting with the D2D chooser above.
        if state.adjustment.is_locked {
            return LRESULT(HTTRANSPARENT as isize);
        }

        // If actively dragging a handle, keep the overlay interactive
        if state.adjustment.is_dragging {
            return LRESULT(HTCLIENT as isize);
        }

        // Check if the cursor is on the selection. Toolbar/window bounds were
        // already excluded above, so the interior remains draggable without
        // stealing toolbar input.
        let handle = hit_test_adjustment_handle_at_screen_coords(
            &state.monitor,
            state.adjustment.bounds,
            screen_x,
            screen_y,
        );
        if handle.is_active() {
            LRESULT(HTCLIENT as isize)
        } else {
            LRESULT(HTTRANSPARENT as isize)
        }
    }
}

/// Handle WM_SETCURSOR - set appropriate cursor based on state
fn handle_set_cursor(state_ptr: *mut OverlayState, lparam: LPARAM) -> LRESULT {
    unsafe {
        // Only handle cursor in client area
        if (lparam.0 & 0xFFFF) != HTCLIENT as isize {
            return LRESULT(0);
        }

        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &*state_ptr;

        let cursor_id = if state.adjustment.is_active {
            let chooser_target = render::hit_test_recording_mode_chooser(
                state,
                state.cursor.position.x,
                state.cursor.position.y,
            );
            if chooser_target != RecordingModeChooserHitTarget::None {
                if matches!(chooser_target, RecordingModeChooserHitTarget::Shell)
                    && state
                        .recording_mode_chooser
                        .as_ref()
                        .is_some_and(|chooser| chooser.allow_drag)
                {
                    IDC_SIZEALL
                } else {
                    IDC_ARROW
                }
            } else if render::hit_test_selection_hud(
                state,
                state.cursor.position.x,
                state.cursor.position.y,
            ) != SelectionHudHitTarget::None
            {
                IDC_ARROW
            } else {
                // In adjustment mode - show resize cursor based on handle
                let handle = if state.adjustment.is_dragging {
                    state.adjustment.handle
                } else {
                    hit_test_handle(
                        state.cursor.position.x,
                        state.cursor.position.y,
                        state.adjustment.bounds,
                    )
                };
                handle.cursor_id()
            }
        } else {
            // Normal mode - show crosshair
            IDC_CROSS
        };

        if let Ok(cursor) = LoadCursorW(None, cursor_id) {
            SetCursor(cursor);
            return LRESULT(1);
        }
    }
    LRESULT(0)
}

/// Handle WM_LBUTTONDOWN - start selection or adjustment drag
fn handle_mouse_down(state_ptr: *mut OverlayState, lparam: LPARAM) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &mut *state_ptr;
        let Point { x, y } = current_local_mouse_point(state, lparam);

        if state.adjustment.is_active {
            let chooser_target = render::hit_test_recording_mode_chooser(state, x, y);
            if chooser_target != RecordingModeChooserHitTarget::None {
                let can_drag_from_shell =
                    matches!(chooser_target, RecordingModeChooserHitTarget::Shell)
                        && state
                            .recording_mode_chooser
                            .as_ref()
                            .is_some_and(|chooser| chooser.allow_drag);

                if can_drag_from_shell {
                    state
                        .adjustment
                        .start_drag(HandlePosition::Interior, Point::new(x, y));
                    if state.adjustment.is_dragging {
                        capture_mouse(state.hwnd);
                    }
                } else {
                    handle_recording_mode_chooser_click(state, chooser_target);
                }
                let _ = render::render(state);
                return LRESULT(0);
            }

            let hud_target = render::hit_test_selection_hud(state, x, y);
            if hud_target != SelectionHudHitTarget::None {
                handle_selection_hud_click(state, hud_target);
                let _ = render::render(state);
                return LRESULT(0);
            }

            // Check if clicking on a resize handle or inside the selection.
            // WM_NCHITTEST keeps toolbar-window bounds pass-through, so
            // interior drags still work without blocking toolbar interaction.
            let handle = hit_test_handle(x, y, state.adjustment.bounds);
            if handle.is_active() {
                state.adjustment.start_drag(handle, Point::new(x, y));
                if state.adjustment.is_dragging {
                    capture_mouse(state.hwnd);
                }
            }
        } else {
            // Mode-specific behavior for initial click
            match state.overlay_mode {
                OverlayMode::DisplaySelect => {
                    // Display mode: click immediately selects the monitor under cursor
                    // No drag needed
                },
                OverlayMode::WindowSelect => {
                    // Window mode: click selects the hovered window
                    // No drag needed
                },
                OverlayMode::RegionSelect => {
                    // Region mode: start drag selection
                    state.drag.is_active = true;
                    state.drag.is_dragging = false;
                    state.drag.start = Point::new(x, y);
                    state.drag.current = Point::new(x, y);
                    capture_mouse(state.hwnd);
                },
            }
        }
    }
    LRESULT(0)
}

/// Handle WM_MOUSEMOVE - update selection, adjustment, or cursor position
fn handle_mouse_move(state_ptr: *mut OverlayState, lparam: LPARAM) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &mut *state_ptr;
        let Point { x, y } = current_local_mouse_point(state, lparam);

        state.cursor.set_position(x, y);

        if state.adjustment.is_active {
            if state.adjustment.is_dragging {
                // Calculate delta from drag start
                update_adjustment_drag(state, state.drag.shift_held);
                sync_recording_mode_chooser_to_selection(state);

                // Emit dimension updates to toolbar (throttled)
                if state.should_emit(50) {
                    state.mark_emitted();
                    emit_dimensions_update(state);
                }

                let _ = render::render(state);
                return LRESULT(0);
            }

            let chooser_target = render::hit_test_recording_mode_chooser(state, x, y);
            if let Some(chooser) = state.recording_mode_chooser.as_mut() {
                if chooser.hovered != chooser_target {
                    chooser.hovered = chooser_target;
                    let _ = render::render(state);
                }
            }

            if chooser_target != RecordingModeChooserHitTarget::None {
                return LRESULT(0);
            }

            let hud_target = render::hit_test_selection_hud(state, x, y);
            if let Some(hud) = state.selection_hud.as_mut() {
                if hud.hovered != hud_target {
                    hud.hovered = hud_target;
                    let _ = render::render(state);
                }
            }

            if hud_target != SelectionHudHitTarget::None {
                return LRESULT(0);
            }
        } else {
            // Mode-specific mouse move behavior
            match state.overlay_mode {
                OverlayMode::DisplaySelect => {
                    // Display mode: just update cursor, no window detection
                    // Monitor highlight is based purely on cursor position (handled in render)
                },
                OverlayMode::WindowSelect => {
                    // Window mode: detect window under cursor
                    let screen_x = state.monitor.x + x;
                    let screen_y = state.monitor.y + y;
                    state.cursor.hovered_window =
                        get_window_at_point(screen_x, screen_y, state.hwnd);
                },
                OverlayMode::RegionSelect => {
                    // Region mode: handle drag or window detection
                    if state.drag.is_active {
                        state.drag.current = Point::new(x, y);

                        // Check if we've dragged enough to enter region selection mode
                        if !state.drag.is_dragging && state.drag.exceeds_threshold() {
                            state.drag.is_dragging = true;
                            state.cursor.clear_hovered(); // Clear window detection when dragging
                        }
                    } else {
                        // Smart window detection for area mode.
                        // Clicking a hovered window can use its bounds as an area selection.
                        let screen_x = state.monitor.x + x;
                        let screen_y = state.monitor.y + y;
                        state.cursor.hovered_window =
                            get_area_target_at_point(screen_x, screen_y, state.hwnd);
                    }
                },
            }
        }

        let _ = render::render(state);
    }
    LRESULT(0)
}

/// Handle WM_LBUTTONUP - finalize selection
fn handle_mouse_up(state_ptr: *mut OverlayState) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &mut *state_ptr;
        release_mouse_capture();

        if state.adjustment.is_active {
            // End adjustment drag
            if state.adjustment.is_dragging {
                emit_final_selection(state);
            }
            state.adjustment.end_drag();
            let _ = render::render(state);
        } else {
            // Mode-specific mouse up behavior
            match state.overlay_mode {
                OverlayMode::DisplaySelect => {
                    // Display mode: select the monitor under cursor
                    handle_monitor_selection(state);
                },
                OverlayMode::WindowSelect => {
                    // Window mode: select the hovered window
                    if let Some(ref win) = state.cursor.hovered_window {
                        let hwnd = win.hwnd.0 as isize;
                        handle_window_selection(state, win.bounds, hwnd);
                    }
                    // If no window hovered, do nothing (click in empty space)
                },
                OverlayMode::RegionSelect => {
                    // Region mode: original behavior
                    if state.drag.is_active {
                        state.drag.is_active = false;

                        if state.drag.is_dragging {
                            // Region selection completed
                            handle_region_selection_complete(state);
                        } else if let Some(ref win) = state.cursor.hovered_window {
                            // Area mode smart-select: adopt hovered window bounds as a region-sized area.
                            // This keeps sourceType="area" and shows dimensions in the toolbar.
                            handle_window_sized_area_selection(
                                state,
                                win.hwnd.0 as isize,
                                win.bounds,
                            );
                        } else {
                            // Click on empty desktop: capture the full monitor
                            handle_monitor_selection(state);
                        }
                    }
                },
            }
        }

        // Bring webcam preview to front after any mouse interaction
        bring_webcam_preview_to_front(state);
    }
    LRESULT(0)
}

fn handle_recording_mode_chooser_click(
    state: &mut OverlayState,
    target: RecordingModeChooserHitTarget,
) {
    match target {
        RecordingModeChooserHitTarget::Back => {
            emit_recording_mode_chooser_back(state);
            state.recording_mode_chooser = None;
            if state.adjustment.is_locked {
                make_overlay_click_through(state);
            }
        },
        RecordingModeChooserHitTarget::Quick => {
            emit_recording_mode_selected(state, "save");
            state.recording_mode_chooser = None;
        },
        RecordingModeChooserHitTarget::Studio => {
            emit_recording_mode_selected(state, "preview");
            state.recording_mode_chooser = None;
        },
        RecordingModeChooserHitTarget::Remember => {
            if let Some(chooser) = state.recording_mode_chooser.as_mut() {
                chooser.remember = !chooser.remember;
            }
        },
        RecordingModeChooserHitTarget::Shell => {},
        RecordingModeChooserHitTarget::None => {},
    }
}

fn handle_selection_hud_click(state: &mut OverlayState, target: SelectionHudHitTarget) {
    match target {
        SelectionHudHitTarget::Back => {
            state.reselect();
            emit_reset_to_startup(state);
            let _ = state.app_handle.emit("capture-overlay-reselecting", ());
        },
        SelectionHudHitTarget::Preset => {
            show_dimension_preset_menu(state);
        },
        SelectionHudHitTarget::WidthInput => {
            if let Some(hud) = state.selection_hud.as_mut() {
                hud.begin_dimension_edit(SelectionHudDimensionEdit::Width);
            }
        },
        SelectionHudHitTarget::HeightInput => {
            if let Some(hud) = state.selection_hud.as_mut() {
                hud.begin_dimension_edit(SelectionHudDimensionEdit::Height);
            }
        },
        SelectionHudHitTarget::WidthDown => {
            clear_dimension_edit(state);
            adjust_selection_dimensions(state, -SELECTION_HUD_DIMENSION_STEP, 0);
        },
        SelectionHudHitTarget::WidthUp => {
            clear_dimension_edit(state);
            adjust_selection_dimensions(state, SELECTION_HUD_DIMENSION_STEP, 0);
        },
        SelectionHudHitTarget::HeightDown => {
            clear_dimension_edit(state);
            adjust_selection_dimensions(state, 0, -SELECTION_HUD_DIMENSION_STEP);
        },
        SelectionHudHitTarget::HeightUp => {
            clear_dimension_edit(state);
            adjust_selection_dimensions(state, 0, SELECTION_HUD_DIMENSION_STEP);
        },
        SelectionHudHitTarget::Save => {
            emit_native_selection_hud_save_area(state);
        },
        SelectionHudHitTarget::Capture => {
            emit_native_selection_hud_capture(state);
        },
        SelectionHudHitTarget::Cancel => {
            state.cancel();
        },
        SelectionHudHitTarget::Shell | SelectionHudHitTarget::None => {
            clear_dimension_edit(state);
        },
    }
}

fn clear_dimension_edit(state: &mut OverlayState) {
    if let Some(hud) = state.selection_hud.as_mut() {
        hud.clear_dimension_edit();
    }
}

fn adjust_selection_dimensions(state: &mut OverlayState, width_delta: i32, height_delta: i32) {
    if state.adjustment.is_locked {
        return;
    }

    let current = state.adjustment.bounds;
    let new_width = (current.width() as i32 + width_delta).max(MIN_SELECTION_SIZE) as u32;
    let new_height = (current.height() as i32 + height_delta).max(MIN_SELECTION_SIZE) as u32;
    set_adjustment_dimensions(state, new_width, new_height);
}

fn set_adjustment_dimensions(state: &mut OverlayState, new_width: u32, new_height: u32) {
    let current = state.adjustment.bounds;
    let (cx, cy) = current.center();
    let half_w = new_width as i32 / 2;
    let half_h = new_height as i32 / 2;
    state.adjustment.bounds = Rect::new(
        cx - half_w,
        cy - half_h,
        cx - half_w + new_width as i32,
        cy - half_h + new_height as i32,
    );
    emit_dimensions_update(state);
}

fn show_dimension_preset_menu(state: &mut OverlayState) {
    clear_dimension_edit(state);

    let Some(rect) = render::selection_hud_rect(state) else {
        return;
    };
    let screen_position = state.monitor.local_to_screen(Point::new(
        rect.left + SELECTION_HUD_BACK_WIDTH,
        rect.bottom,
    ));

    unsafe {
        let Ok(menu) = CreatePopupMenu() else {
            return;
        };

        for (index, (label, width, height)) in DIMENSION_PRESETS.iter().enumerate() {
            let text = format!("{label}  ({width}x{height})");
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                1000 + index,
                windows::core::PCWSTR(wide.as_ptr()),
            );
        }

        let selected = TrackPopupMenu(
            menu,
            TPM_LEFTALIGN | TPM_TOPALIGN | TPM_RETURNCMD,
            screen_position.x,
            screen_position.y,
            0,
            state.hwnd,
            None,
        );
        let _ = DestroyMenu(menu);

        if selected.0 >= 1000 {
            let index = (selected.0 - 1000) as usize;
            if let Some((_, width, height)) = DIMENSION_PRESETS.get(index) {
                set_adjustment_dimensions(state, *width, *height);
            }
        }
    }
}

fn emit_native_selection_hud_save_area(state: &OverlayState) {
    let Some(hud) = &state.selection_hud else {
        return;
    };
    let Some(selection) = state.get_screen_selection() else {
        return;
    };

    let _ = state.app_handle.emit(
        "native-selection-hud-save-area",
        serde_json::json!({
            "owner": hud.owner,
            "x": selection.left,
            "y": selection.top,
            "width": selection.width(),
            "height": selection.height(),
        }),
    );
}

fn emit_native_selection_hud_capture(state: &OverlayState) {
    let Some(hud) = &state.selection_hud else {
        return;
    };
    let Some(selection) = state.get_screen_selection() else {
        return;
    };

    let _ = state.app_handle.emit(
        "native-selection-hud-capture",
        serde_json::json!({
            "owner": hud.owner,
            "x": selection.left,
            "y": selection.top,
            "width": selection.width(),
            "height": selection.height(),
            "captureType": state.capture_type.as_str(),
            "sourceType": "area",
            "sourceMode": "area"
        }),
    );
}

fn emit_reset_to_startup(state: &OverlayState) {
    if let Some(owner) = &state.toolbar_owner {
        let _ = state.app_handle.emit_to(owner, "reset-to-startup", ());
    } else {
        let _ = state.app_handle.emit("reset-to-startup", ());
    }
}

fn emit_recording_mode_selected(state: &OverlayState, action: &str) {
    let Some(chooser) = &state.recording_mode_chooser else {
        return;
    };
    let Some(rect) = render::recording_mode_chooser_rect(state) else {
        return;
    };
    let screen_position = state
        .monitor
        .local_to_screen(Point::new(rect.left, rect.top));

    let _ = state.app_handle.emit(
        "recording-mode-selected",
        serde_json::json!({
            "x": screen_position.x,
            "y": screen_position.y,
            "action": action,
            "remember": chooser.remember,
            "owner": chooser.owner,
        }),
    );
}

fn emit_recording_mode_chooser_back(state: &OverlayState) {
    let Some(chooser) = &state.recording_mode_chooser else {
        return;
    };
    let Some(rect) = render::recording_mode_chooser_rect(state) else {
        return;
    };
    let screen_position = state
        .monitor
        .local_to_screen(Point::new(rect.left, rect.top));

    let _ = state.app_handle.emit(
        "recording-mode-chooser-back",
        serde_json::json!({
            "x": screen_position.x,
            "y": screen_position.y,
            "owner": chooser.owner,
        }),
    );
}

/// Handle region selection completion.
fn handle_region_selection_complete(state: &mut OverlayState) {
    let local_bounds = state.drag.selection_rect();

    if local_bounds.width() > 10 && local_bounds.height() > 10 {
        let screen_bounds = state.monitor.local_rect_to_screen(local_bounds);
        emit_area_selection_confirmed(state, screen_bounds);

        if state.capture_type == CaptureType::Screenshot {
            // For screenshots, capture immediately without adjustment mode
            state
                .result
                .confirm(screen_bounds, OverlayAction::CaptureScreenshot);
            state.should_close = true;
        } else {
            // For video/gif, enter adjustment mode
            state.enter_adjustment_mode(local_bounds);
            emit_adjustment_ready(state, screen_bounds);
            show_toolbar(state, screen_bounds, SourceType::Area);
        }
    }

    state.drag.is_dragging = false;
    let _ = render::render(state);
}

/// Handle smart area selection from a hovered window.
/// Uses window bounds as the initial area size without switching to window capture mode.
fn handle_window_sized_area_selection(
    state: &mut OverlayState,
    window_id: isize,
    window_bounds: Rect,
) {
    crate::app_log!(
        crate::commands::logging::LogLevel::Info,
        "OverlayArea",
        "Selected area target hwnd={} bounds=({}, {}) {}x{}",
        window_id,
        window_bounds.left,
        window_bounds.top,
        window_bounds.width(),
        window_bounds.height()
    );

    emit_area_selection_confirmed(state, window_bounds);

    if state.capture_type == CaptureType::Screenshot {
        // Area screenshot: capture selected rectangle immediately (region capture semantics).
        state
            .result
            .confirm(window_bounds, OverlayAction::CaptureScreenshot);
        state.should_close = true;
    } else {
        // Video/GIF area: enter normal (unlocked) adjustment mode with window-sized bounds.
        let local_bounds = state.monitor.screen_rect_to_local(window_bounds);
        state.enter_adjustment_mode(local_bounds);
        emit_adjustment_ready(state, window_bounds);
        show_toolbar(state, window_bounds, SourceType::Area);
    }

    let _ = render::render(state);
}

/// Handle window selection.
fn handle_window_selection(state: &mut OverlayState, window_bounds: Rect, window_id: isize) {
    // Get window title for debugging
    let title = unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};
        let hwnd = HWND(window_id as *mut std::ffi::c_void);
        let len = GetWindowTextLengthW(hwnd);
        if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::from("(no title)")
        }
    };
    log::debug!(
        "[OVERLAY] Window selected: hwnd={}, title='{}', bounds={}x{}",
        window_id,
        title,
        window_bounds.width(),
        window_bounds.height()
    );
    if state.capture_type == CaptureType::Screenshot {
        // For screenshots, capture immediately using window capture
        state
            .result
            .confirm_window(window_bounds, OverlayAction::CaptureScreenshot, window_id);
        state.should_close = true;
    } else {
        // For video/gif, enter locked adjustment mode (window bounds are fixed)
        let local_bounds = state.monitor.screen_rect_to_local(window_bounds);
        state.enter_adjustment_mode_locked(local_bounds);
        emit_adjustment_ready(state, window_bounds);
        show_toolbar(
            state,
            window_bounds,
            SourceType::Window {
                id: window_id,
                title,
            },
        );
    }
    let _ = render::render(state);
}

/// Handle monitor selection (click on empty area).
fn handle_monitor_selection(state: &mut OverlayState) {
    let screen_x = state.monitor.x + state.drag.start.x;
    let screen_y = state.monitor.y + state.drag.start.y;

    if let Ok(monitors) = xcap::Monitor::all() {
        // Find monitor containing the click point along with its index
        if let Some((monitor_index, mon)) = monitors.iter().enumerate().find(|(_, m)| {
            let mx = m.x().unwrap_or(0);
            let my = m.y().unwrap_or(0);
            let mw = m.width().unwrap_or(1920) as i32;
            let mh = m.height().unwrap_or(1080) as i32;
            screen_x >= mx && screen_x < mx + mw && screen_y >= my && screen_y < my + mh
        }) {
            let mon_x = mon.x().unwrap_or(0);
            let mon_y = mon.y().unwrap_or(0);
            let mon_w = mon.width().unwrap_or(1920);
            let mon_h = mon.height().unwrap_or(1080);
            let mon_name = mon.name().ok();

            let screen_bounds = Rect::from_xywh(mon_x, mon_y, mon_w, mon_h);

            if state.capture_type == CaptureType::Screenshot {
                state
                    .result
                    .confirm(screen_bounds, OverlayAction::CaptureScreenshot);
                state.should_close = true;
            } else {
                // For video/gif, enter locked adjustment mode (monitor bounds are fixed)
                let local_bounds = state.monitor.screen_rect_to_local(screen_bounds);
                state.enter_adjustment_mode_locked(local_bounds);
                emit_adjustment_ready(state, screen_bounds);
                show_toolbar(
                    state,
                    screen_bounds,
                    SourceType::Display {
                        index: monitor_index,
                        name: mon_name,
                    },
                );
            }
            let _ = render::render(state);
        }
    }
}

/// Handle WM_KEYDOWN
fn handle_key_down(state_ptr: *mut OverlayState, wparam: WPARAM) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &mut *state_ptr;
        let key = wparam.0 as u32;

        if key == VK_ESCAPE && state.suppress_escape_until_release {
            return LRESULT(0);
        }

        if handle_selection_hud_key_down(state, key) {
            let _ = render::render(state);
            return LRESULT(0);
        }

        match key {
            VK_ESCAPE => {
                release_mouse_capture();
                if state.adjustment.is_active {
                    state.adjustment.reset();
                }
                state.cancel();
            },
            VK_RETURN => {
                if state.adjustment.is_active {
                    // Confirm with recording action (Enter in adjustment mode starts recording)
                    if let Some(selection) = state.get_screen_selection() {
                        if selection.width() > 10 && selection.height() > 10 {
                            state.confirm(OverlayAction::StartRecording);
                        }
                    }
                }
            },
            k if k == VK_SHIFT.0 as u32 => {
                state.drag.shift_held = true;
                if state.adjustment.is_dragging {
                    update_adjustment_drag(state, true);
                    emit_dimensions_update(state);
                }
                let _ = render::render(state);
            },
            _ => {},
        }
    }
    LRESULT(0)
}

fn handle_selection_hud_key_down(state: &mut OverlayState, key: u32) -> bool {
    let Some(hud) = state.selection_hud.as_ref() else {
        return false;
    };
    if hud.editing_dimension.is_none() {
        return false;
    }

    match key {
        VK_ESCAPE => {
            clear_dimension_edit(state);
            state.suppress_escape_until_release = true;
            true
        },
        VK_RETURN => {
            apply_dimension_input(state);
            true
        },
        VK_BACK => {
            if let Some(hud) = state.selection_hud.as_mut() {
                hud.dimension_input.pop();
            }
            true
        },
        _ => false,
    }
}

fn handle_char(state_ptr: *mut OverlayState, wparam: WPARAM) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &mut *state_ptr;
        let Some(hud) = state.selection_hud.as_mut() else {
            return LRESULT(0);
        };
        if hud.editing_dimension.is_none() {
            return LRESULT(0);
        }

        let ch = char::from_u32(wparam.0 as u32);
        if let Some(ch) = ch {
            if ch.is_ascii_digit() && hud.dimension_input.len() < 5 {
                if hud.dimension_input == "0" {
                    hud.dimension_input.clear();
                }
                hud.dimension_input.push(ch);
                let _ = render::render(state);
            }
        }
    }

    LRESULT(0)
}

fn apply_dimension_input(state: &mut OverlayState) {
    let Some(hud) = state.selection_hud.as_mut() else {
        return;
    };
    let Some(field) = hud.editing_dimension else {
        return;
    };

    let Ok(value) = hud.dimension_input.parse::<u32>() else {
        hud.clear_dimension_edit();
        return;
    };
    let value = value.max(MIN_SELECTION_SIZE as u32);
    hud.clear_dimension_edit();

    let current = state.adjustment.bounds;
    match field {
        SelectionHudDimensionEdit::Width => {
            set_adjustment_dimensions(state, value, current.height());
        },
        SelectionHudDimensionEdit::Height => {
            set_adjustment_dimensions(state, current.width(), value);
        },
    }
}

/// Handle WM_KEYUP
fn handle_key_up(state_ptr: *mut OverlayState, wparam: WPARAM) -> LRESULT {
    unsafe {
        if state_ptr.is_null() {
            return LRESULT(0);
        }

        let state = &mut *state_ptr;
        let key = wparam.0 as u32;

        if key == VK_SHIFT.0 as u32 {
            state.drag.shift_held = false;
            if state.adjustment.is_dragging {
                update_adjustment_drag(state, false);
                emit_dimensions_update(state);
            }
            let _ = render::render(state);
        }
    }
    LRESULT(0)
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Extract mouse coordinates from LPARAM
fn mouse_coords(lparam: LPARAM) -> (i32, i32) {
    let x = (lparam.0 & 0xFFFF) as i16 as i32;
    let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
    (x, y)
}

fn current_screen_mouse_coords() -> Option<(i32, i32)> {
    unsafe {
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor).ok()?;
        Some((cursor.x, cursor.y))
    }
}

fn current_local_mouse_point(state: &OverlayState, lparam: LPARAM) -> Point {
    if let Some((screen_x, screen_y)) = current_screen_mouse_coords() {
        return state.monitor.screen_to_local(screen_x, screen_y);
    }

    let (x, y) = mouse_coords(lparam);
    Point::new(x, y)
}

fn hit_test_adjustment_handle_at_screen_coords(
    monitor: &MonitorInfo,
    bounds: Rect,
    screen_x: i32,
    screen_y: i32,
) -> HandlePosition {
    let local = monitor.screen_to_local(screen_x, screen_y);
    hit_test_handle(local.x, local.y, bounds)
}

fn is_screen_point_over_auxiliary_window(
    state: &OverlayState,
    screen_x: i32,
    screen_y: i32,
) -> bool {
    if state
        .toolbar_owner
        .as_deref()
        .is_some_and(|label| is_screen_point_over_window(state, label, screen_x, screen_y))
    {
        return true;
    }

    [
        crate::commands::window::CAPTURE_TOOLBAR_LABEL,
        crate::commands::window::RECORDING_MODE_CHOOSER_LABEL,
    ]
    .iter()
    .any(|label| is_screen_point_over_window(state, label, screen_x, screen_y))
}

fn is_screen_point_over_window(
    state: &OverlayState,
    label: &str,
    screen_x: i32,
    screen_y: i32,
) -> bool {
    let Some(win) = state.app_handle.get_webview_window(label) else {
        return false;
    };

    if !matches!(win.is_visible(), Ok(true)) {
        return false;
    }

    let Ok(hwnd) = win.hwnd() else {
        return false;
    };

    unsafe {
        let hwnd = HWND(hwnd.0);
        if !IsWindowVisible(hwnd).as_bool() {
            return false;
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }

        screen_x >= rect.left
            && screen_x < rect.right
            && screen_y >= rect.top
            && screen_y < rect.bottom
    }
}

fn capture_mouse(hwnd: HWND) {
    unsafe {
        let _ = SetCapture(hwnd);
    }
}

fn release_mouse_capture() {
    unsafe {
        let _ = ReleaseCapture();
    }
}

fn update_adjustment_drag(state: &mut OverlayState, constrain_proportions: bool) {
    let dx = state.cursor.position.x - state.adjustment.drag_start.x;
    let dy = state.cursor.position.y - state.adjustment.drag_start.y;
    state.adjustment.apply_delta(dx, dy, constrain_proportions);
}

fn sync_recording_mode_chooser_to_selection(state: &OverlayState) {
    let screen_bounds = state.monitor.local_rect_to_screen(state.adjustment.bounds);
    let _ = reposition_recording_mode_chooser(
        &state.app_handle,
        screen_bounds.left,
        screen_bounds.top,
        screen_bounds.width(),
        screen_bounds.height(),
    );
}

/// Emit adjustment ready event to show the toolbar
fn emit_adjustment_ready(state: &OverlayState, bounds: Rect) {
    let event = SelectionEvent::from(bounds);
    let _ = state
        .app_handle
        .emit("capture-overlay-adjustment-ready", event);
}

/// Emit dimensions update during adjustment drag
fn emit_dimensions_update(state: &OverlayState) {
    let screen_bounds = state.monitor.local_rect_to_screen(state.adjustment.bounds);

    emit_selection_update(state, screen_bounds);
}

/// Emit final selection when adjustment drag ends
fn emit_final_selection(state: &OverlayState) {
    let screen_bounds = state.monitor.local_rect_to_screen(state.adjustment.bounds);

    emit_selection_update(state, screen_bounds);
}

fn emit_selection_update(state: &OverlayState, screen_bounds: Rect) {
    let payload = serde_json::json!({
        "x": screen_bounds.left,
        "y": screen_bounds.top,
        "width": screen_bounds.width(),
        "height": screen_bounds.height()
    });

    if let Some(owner) = &state.toolbar_owner {
        let _ = state
            .app_handle
            .emit_to(owner, "selection-updated", payload.clone());
    } else {
        let _ = state.app_handle.emit("selection-updated", payload.clone());
    }

    let _ = state
        .app_handle
        .emit_to("webcam-preview", "selection-updated", payload);
}

/// Emit event to create capture toolbar window from frontend
/// Frontend has full control over sizing/positioning without hardcoded dimensions
/// Source type for recording mode selection
enum SourceType {
    Area,
    Window { id: isize, title: String },
    Display { index: usize, name: Option<String> },
}

fn emit_area_selection_confirmed(state: &OverlayState, screen_bounds: Rect) {
    let _ = state.app_handle.emit(
        "area-selection-confirmed",
        serde_json::json!({
            "x": screen_bounds.left,
            "y": screen_bounds.top,
            "width": screen_bounds.width(),
            "height": screen_bounds.height(),
            "captureType": state.capture_type.as_str(),
            "sourceType": "area",
        }),
    );
}

fn show_toolbar(state: &mut OverlayState, screen_bounds: Rect, source: SourceType) {
    let keep_area_overlay_interactive = matches!(source, SourceType::Area)
        && !state.adjustment.is_locked
        && !state.auto_start_recording;
    if keep_area_overlay_interactive {
        make_overlay_interactive(state);
        let owner = state
            .toolbar_owner
            .clone()
            .unwrap_or_else(|| crate::commands::window::CAPTURE_TOOLBAR_LABEL.to_string());
        state.selection_hud = Some(super::state::SelectionHudState::new(owner));
    } else {
        // Locked display/window selections do not expose adjustment handles, so
        // the overlay can become a visual-only layer while the control plane owns input.
        state.selection_hud = None;
        make_overlay_click_through(state);
    }

    let mut payload = serde_json::json!({
        "x": screen_bounds.left,
        "y": screen_bounds.top,
        "width": screen_bounds.width(),
        "height": screen_bounds.height(),
        "captureType": state.capture_type.as_str(),
        "autoStartRecording": state.auto_start_recording
    });

    // Add source-specific metadata for recording mode selection
    match source {
        SourceType::Area => {
            payload["sourceType"] = serde_json::json!("area");
            payload["sourceMode"] = serde_json::json!("area");
            payload["nativeControls"] = serde_json::json!(state.selection_hud.is_some());
        },
        SourceType::Window { id, title } => {
            payload["sourceType"] = serde_json::json!("window");
            payload["sourceMode"] = serde_json::json!("window");
            payload["windowId"] = serde_json::json!(id);
            payload["sourceTitle"] = serde_json::json!(title);
        },
        SourceType::Display { index, name } => {
            payload["sourceType"] = serde_json::json!("display");
            payload["sourceMode"] = serde_json::json!("display");
            payload["monitorIndex"] = serde_json::json!(index);
            payload["monitorName"] = serde_json::json!(name);
        },
    }

    let event_name = if state.auto_start_recording {
        "quick-recording-selection-ready"
    } else if state.toolbar_owner.is_some() {
        "confirm-selection"
    } else {
        "create-capture-toolbar"
    };

    if let Some(owner) = &state.toolbar_owner {
        let _ = state.app_handle.emit_to(owner, event_name, payload);
    } else {
        let _ = state.app_handle.emit(event_name, payload);
    }

    // From here on, interaction is routed by WM_NCHITTEST: the overlay handles
    // selection affordances and passes everything else through to the toolbar.
    // Avoid foreground/z-order loops here; they cause visible window "dancing".
}

/// Make the overlay click-through so the toolbar receives all mouse events.
/// This is bulletproof - no Z-order fighting, overlay just passes input through.
pub(crate) fn make_overlay_click_through(state: &OverlayState) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
        };

        let ex_style = GetWindowLongW(state.hwnd, GWL_EXSTYLE);
        // Add WS_EX_TRANSPARENT to make the window click-through
        // WS_EX_LAYERED is already set for our D2D rendering
        let new_style = ex_style | WS_EX_TRANSPARENT.0 as i32 | WS_EX_LAYERED.0 as i32;
        SetWindowLongW(state.hwnd, GWL_EXSTYLE, new_style);
    }
}

pub(crate) fn make_overlay_interactive(state: &OverlayState) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_TRANSPARENT,
        };

        let ex_style = GetWindowLongW(state.hwnd, GWL_EXSTYLE);
        SetWindowLongW(
            state.hwnd,
            GWL_EXSTYLE,
            ex_style & !(WS_EX_TRANSPARENT.0 as i32),
        );
        let _ = SetWindowPos(
            state.hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Bring the webcam preview window to front (above D2D overlay)
fn bring_webcam_preview_to_front(state: &OverlayState) {
    if let Some(win) = state.app_handle.get_webview_window("webcam-preview") {
        if let Ok(hwnd) = win.hwnd() {
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::BringWindowToTop;
                let hwnd = HWND(hwnd.0);
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                let _ = BringWindowToTop(hwnd);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjustment_hit_test_converts_screen_coords_to_local_space() {
        let monitor = MonitorInfo::new(-1920, 0, 3840, 2160);
        let bounds = Rect::new(100, 100, 300, 300);

        let handle = hit_test_adjustment_handle_at_screen_coords(&monitor, bounds, -1770, 200);

        assert_eq!(handle, HandlePosition::Interior);
    }

    #[test]
    fn adjustment_hit_test_detects_handles_on_offset_monitor_layouts() {
        let monitor = MonitorInfo::new(-1920, -1080, 3840, 2160);
        let bounds = Rect::new(100, 100, 300, 300);

        let handle = hit_test_adjustment_handle_at_screen_coords(&monitor, bounds, -1820, -980);

        assert_eq!(handle, HandlePosition::TopLeft);
    }
}
