//! Direct2D rendering for the overlay.
//!
//! This module handles all rendering operations:
//! - Dimmed overlay around the selection
//! - Selection border
//! - Crosshair cursor
//! - Size indicator text
//! - Resize handles

use windows::core::Result;
use windows::Win32::Graphics::Direct2D::Common::{D2D1_COLOR_F, D2D_POINT_2F, D2D_RECT_F};
use windows::Win32::Graphics::Direct2D::{
    ID2D1DeviceContext, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_ROUNDED_RECT,
};
use windows::Win32::Graphics::DirectWrite::DWRITE_MEASURING_MODE_NATURAL;
use windows::Win32::Graphics::Dxgi::{IDXGISurface, DXGI_PRESENT};

use super::commands::{get_highlighted_monitor, get_highlighted_window};
use super::graphics::d2d::{create_target_bitmap, Brushes, D2DResources};
use super::state::OverlayState;
use super::types::*;

/// Render the overlay to the swap chain.
///
/// This is called after any state change to update the visual.
pub fn render(state: &OverlayState) -> Result<()> {
    let graphics = &state.graphics;
    let d2d = &graphics.d2d;

    unsafe {
        // Get the back buffer
        let surface: IDXGISurface = graphics.swap_chain.GetBuffer(0)?;
        let target_bitmap = create_target_bitmap(&d2d.context, &surface)?;

        d2d.context.SetTarget(&target_bitmap);
        d2d.context.BeginDraw();

        // Clear with fully transparent
        d2d.context.Clear(Some(&D2D1_COLOR_F {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.0,
        }));

        // Determine what to render
        let render_info = determine_render_info(state);

        // Draw dimmed overlay around the clear area
        draw_dim_overlay(&d2d.context, &d2d.brushes, render_info.clear_rect, state);

        // Draw selection border
        if render_info.draw_border {
            draw_selection_border(&d2d.context, &d2d.brushes, render_info.clear_rect);
        }

        // Draw crosshair (only when not adjusting and only in RegionSelect mode)
        if !state.adjustment.is_active && state.overlay_mode == OverlayMode::RegionSelect {
            draw_crosshair(&d2d.context, d2d, state.cursor.position, state);
        }

        // Draw size indicator (when selecting, not adjusting)
        if render_info.draw_border && !state.adjustment.is_active {
            draw_size_indicator(&d2d.context, d2d, render_info.clear_rect, state);
        }

        // Draw window name indicator (only in WindowSelect mode when hovering a window)
        if state.overlay_mode == OverlayMode::WindowSelect && !state.adjustment.is_active {
            if let Some(ref win) = state.cursor.hovered_window {
                draw_window_name_indicator(
                    &d2d.context,
                    d2d,
                    win.hwnd,
                    render_info.clear_rect,
                    state,
                );
            }
        }

        // Draw resize handles (when adjusting)
        if render_info.draw_handles {
            draw_resize_handles(&d2d.context, &d2d.brushes, render_info.clear_rect);
        }

        if state.recording_mode_chooser.is_some() {
            draw_recording_mode_chooser(&d2d.context, d2d, state);
        }

        d2d.context.EndDraw(None, None)?;

        // Present the frame
        graphics.swap_chain.Present(1, DXGI_PRESENT(0)).ok()?;
        graphics.comp_device.Commit()?;
    }

    Ok(())
}

pub fn recording_mode_chooser_rect(state: &OverlayState) -> Option<Rect> {
    state.recording_mode_chooser.as_ref()?;

    let selection = state.get_local_selection()?;
    let (selection_center_x, selection_center_y) = selection.center();
    let width = RECORDING_MODE_CHOOSER_WIDTH;
    let height = RECORDING_MODE_CHOOSER_HEIGHT;

    let max_left = state.monitor.width as i32 - width - RECORDING_MODE_CHOOSER_MARGIN;
    let max_top = state.monitor.height as i32 - height - RECORDING_MODE_CHOOSER_MARGIN;
    let left = (selection_center_x - width / 2).clamp(
        RECORDING_MODE_CHOOSER_MARGIN,
        max_left.max(RECORDING_MODE_CHOOSER_MARGIN),
    );
    let top = (selection_center_y - height / 2).clamp(
        RECORDING_MODE_CHOOSER_MARGIN,
        max_top.max(RECORDING_MODE_CHOOSER_MARGIN),
    );

    Some(Rect::new(left, top, left + width, top + height))
}

pub fn hit_test_recording_mode_chooser(
    state: &OverlayState,
    x: i32,
    y: i32,
) -> RecordingModeChooserHitTarget {
    let Some(shell) = recording_mode_chooser_rect(state) else {
        return RecordingModeChooserHitTarget::None;
    };
    if !shell.contains(x, y) {
        return RecordingModeChooserHitTarget::None;
    }

    let back = Rect::new(
        shell.left + 16,
        shell.top + 14,
        shell.left + 16 + RECORDING_MODE_CHOOSER_BACK_SIZE,
        shell.top + 14 + RECORDING_MODE_CHOOSER_BACK_SIZE,
    );
    if back.contains(x, y) {
        return RecordingModeChooserHitTarget::Back;
    }

    let card_top = shell.top + 58;
    let card_bottom = shell.top + 122;
    let quick = Rect::new(shell.left + 28, card_top, shell.left + 205, card_bottom);
    if quick.contains(x, y) {
        return RecordingModeChooserHitTarget::Quick;
    }

    let studio = Rect::new(shell.left + 225, card_top, shell.left + 402, card_bottom);
    if studio.contains(x, y) {
        return RecordingModeChooserHitTarget::Studio;
    }

    let remember = Rect::new(
        shell.left + 28,
        shell.top + 134,
        shell.right - 28,
        shell.top + 166,
    );
    if remember.contains(x, y) {
        return RecordingModeChooserHitTarget::Remember;
    }

    RecordingModeChooserHitTarget::Shell
}

/// Information about what to render.
struct RenderInfo {
    /// The "clear" area (not dimmed)
    clear_rect: D2D_RECT_F,
    /// Whether to draw a border around the clear area
    draw_border: bool,
    /// Whether to draw resize handles
    draw_handles: bool,
}

/// Determine what should be rendered based on current state.
fn determine_render_info(state: &OverlayState) -> RenderInfo {
    let width = state.monitor.width as f32;
    let height = state.monitor.height as f32;

    // Adjustment mode takes priority in all overlay modes
    if state.adjustment.is_active {
        return RenderInfo {
            clear_rect: state.adjustment.bounds.to_d2d_rect(),
            draw_border: true,
            draw_handles: true,
        };
    }

    // Mode-specific rendering
    match state.overlay_mode {
        OverlayMode::DisplaySelect => determine_display_mode_render(state, width, height),
        OverlayMode::WindowSelect => determine_window_mode_render(state, width, height),
        OverlayMode::RegionSelect => determine_region_mode_render(state, width, height),
    }
}

/// Render info for DisplaySelect mode - highlight monitor (explicit or under cursor)
fn determine_display_mode_render(state: &OverlayState, width: f32, height: f32) -> RenderInfo {
    let highlighted_index = get_highlighted_monitor();

    if let Ok(monitors) = xcap::Monitor::all() {
        // If we have an explicit highlight from frontend, use that monitor
        let target_monitor = if highlighted_index >= 0 {
            monitors.get(highlighted_index as usize)
        } else {
            // Otherwise, find monitor under cursor
            let screen_cursor_x = state.monitor.x + state.cursor.position.x;
            let screen_cursor_y = state.monitor.y + state.cursor.position.y;

            monitors.iter().find(|m| {
                let mx = m.x().unwrap_or(0);
                let my = m.y().unwrap_or(0);
                let mw = m.width().unwrap_or(1920) as i32;
                let mh = m.height().unwrap_or(1080) as i32;
                screen_cursor_x >= mx
                    && screen_cursor_x < mx + mw
                    && screen_cursor_y >= my
                    && screen_cursor_y < my + mh
            })
        };

        if let Some(mon) = target_monitor {
            let mon_x = mon.x().unwrap_or(0);
            let mon_y = mon.y().unwrap_or(0);
            let mon_w = mon.width().unwrap_or(1920) as i32;
            let mon_h = mon.height().unwrap_or(1080) as i32;

            // Convert to local coordinates
            let left = (mon_x - state.monitor.x) as f32;
            let top = (mon_y - state.monitor.y) as f32;
            let right = left + mon_w as f32;
            let bottom = top + mon_h as f32;

            return RenderInfo {
                clear_rect: D2D_RECT_F {
                    left,
                    top,
                    right,
                    bottom,
                },
                draw_border: true,
                draw_handles: false,
            };
        }
    }

    // Fallback: no dimming, no border
    RenderInfo {
        clear_rect: D2D_RECT_F {
            left: 0.0,
            top: 0.0,
            right: width,
            bottom: height,
        },
        draw_border: false,
        draw_handles: false,
    }
}

/// Render info for WindowSelect mode - highlight window (explicit or under cursor)
fn determine_window_mode_render(state: &OverlayState, width: f32, height: f32) -> RenderInfo {
    let highlighted_hwnd = get_highlighted_window();

    // Check for explicit highlight from frontend first
    if highlighted_hwnd != 0 {
        // Get window bounds for the highlighted HWND
        if let Some(bounds) = get_window_bounds_by_hwnd(highlighted_hwnd) {
            let local_bounds = state.monitor.screen_rect_to_local(bounds);

            let clear_rect = D2D_RECT_F {
                left: (local_bounds.left as f32).max(0.0),
                top: (local_bounds.top as f32).max(0.0),
                right: (local_bounds.right as f32).min(width),
                bottom: (local_bounds.bottom as f32).min(height),
            };

            return RenderInfo {
                clear_rect,
                draw_border: true,
                draw_handles: false,
            };
        }
    }

    // Fall back to cursor-detected window
    if let Some(ref win) = state.cursor.hovered_window {
        let local_bounds = state.monitor.screen_rect_to_local(win.bounds);

        // Clamp to monitor bounds
        let clear_rect = D2D_RECT_F {
            left: (local_bounds.left as f32).max(0.0),
            top: (local_bounds.top as f32).max(0.0),
            right: (local_bounds.right as f32).min(width),
            bottom: (local_bounds.bottom as f32).min(height),
        };

        return RenderInfo {
            clear_rect,
            draw_border: true,
            draw_handles: false,
        };
    }

    // No window - show nothing highlighted
    RenderInfo {
        clear_rect: D2D_RECT_F {
            left: 0.0,
            top: 0.0,
            right: width,
            bottom: height,
        },
        draw_border: false,
        draw_handles: false,
    }
}

/// Get window bounds by HWND (for explicit highlight from frontend)
pub fn get_window_bounds_by_hwnd(hwnd: isize) -> Option<Rect> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};

    unsafe {
        let hwnd = HWND(hwnd as *mut std::ffi::c_void);
        let mut rect = RECT::default();

        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok()
        {
            Some(Rect::new(rect.left, rect.top, rect.right, rect.bottom))
        } else {
            None
        }
    }
}

/// Render info for RegionSelect mode - drag to select, with window/monitor fallback
fn determine_region_mode_render(state: &OverlayState, width: f32, height: f32) -> RenderInfo {
    if state.drag.is_dragging {
        // Region selection mode - show selection rectangle
        return RenderInfo {
            clear_rect: state.drag.selection_rect().to_d2d_rect(),
            draw_border: true,
            draw_handles: false,
        };
    }

    if let Some(ref win) = state.cursor.hovered_window {
        // Window detection mode - show hovered window
        let local_bounds = state.monitor.screen_rect_to_local(win.bounds);

        // Clamp to monitor bounds
        let clear_rect = D2D_RECT_F {
            left: (local_bounds.left as f32).max(0.0),
            top: (local_bounds.top as f32).max(0.0),
            right: (local_bounds.right as f32).min(width),
            bottom: (local_bounds.bottom as f32).min(height),
        };

        return RenderInfo {
            clear_rect,
            draw_border: true,
            draw_handles: false,
        };
    }

    // No window detected - find the monitor under cursor and highlight it
    let screen_cursor_x = state.monitor.x + state.cursor.position.x;
    let screen_cursor_y = state.monitor.y + state.cursor.position.y;

    if let Ok(monitors) = xcap::Monitor::all() {
        if let Some(mon) = monitors.iter().find(|m| {
            let mx = m.x().unwrap_or(0);
            let my = m.y().unwrap_or(0);
            let mw = m.width().unwrap_or(1920) as i32;
            let mh = m.height().unwrap_or(1080) as i32;
            screen_cursor_x >= mx
                && screen_cursor_x < mx + mw
                && screen_cursor_y >= my
                && screen_cursor_y < my + mh
        }) {
            let mon_x = mon.x().unwrap_or(0);
            let mon_y = mon.y().unwrap_or(0);
            let mon_w = mon.width().unwrap_or(1920) as i32;
            let mon_h = mon.height().unwrap_or(1080) as i32;

            // Convert to local coordinates
            let left = (mon_x - state.monitor.x) as f32;
            let top = (mon_y - state.monitor.y) as f32;
            let right = left + mon_w as f32;
            let bottom = top + mon_h as f32;

            return RenderInfo {
                clear_rect: D2D_RECT_F {
                    left,
                    top,
                    right,
                    bottom,
                },
                draw_border: true,
                draw_handles: false,
            };
        }
    }

    // Fallback: no dimming, no border
    RenderInfo {
        clear_rect: D2D_RECT_F {
            left: 0.0,
            top: 0.0,
            right: width,
            bottom: height,
        },
        draw_border: false,
        draw_handles: false,
    }
}

/// Draw the dimmed overlay around the clear area.
///
/// Draws 4 rectangles to create the "cutout" effect.
fn draw_dim_overlay(
    context: &ID2D1DeviceContext,
    brushes: &Brushes,
    clear_rect: D2D_RECT_F,
    state: &OverlayState,
) {
    let width = state.monitor.width as f32;
    let height = state.monitor.height as f32;

    unsafe {
        // Top
        if clear_rect.top > 0.0 {
            context.FillRectangle(
                &D2D_RECT_F {
                    left: 0.0,
                    top: 0.0,
                    right: width,
                    bottom: clear_rect.top,
                },
                &brushes.overlay,
            );
        }

        // Bottom
        if clear_rect.bottom < height {
            context.FillRectangle(
                &D2D_RECT_F {
                    left: 0.0,
                    top: clear_rect.bottom,
                    right: width,
                    bottom: height,
                },
                &brushes.overlay,
            );
        }

        // Left
        if clear_rect.left > 0.0 {
            context.FillRectangle(
                &D2D_RECT_F {
                    left: 0.0,
                    top: clear_rect.top,
                    right: clear_rect.left,
                    bottom: clear_rect.bottom,
                },
                &brushes.overlay,
            );
        }

        // Right
        if clear_rect.right < width {
            context.FillRectangle(
                &D2D_RECT_F {
                    left: clear_rect.right,
                    top: clear_rect.top,
                    right: width,
                    bottom: clear_rect.bottom,
                },
                &brushes.overlay,
            );
        }
    }
}

/// Draw the selection border.
fn draw_selection_border(context: &ID2D1DeviceContext, brushes: &Brushes, rect: D2D_RECT_F) {
    unsafe {
        context.DrawRectangle(&rect, &brushes.border, 2.0, None);
    }
}

/// Draw the crosshair cursor.
fn draw_crosshair(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    cursor: Point,
    state: &OverlayState,
) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let cx = cursor.x as f32;
    let cy = cursor.y as f32;
    let gap = CROSSHAIR_GAP;

    // Get the monitor bounds for the current cursor position
    let screen_x = state.monitor.x + cursor.x;
    let screen_y = state.monitor.y + cursor.y;

    let (mon_left, mon_top, mon_right, mon_bottom) = unsafe {
        let cursor_point = POINT {
            x: screen_x,
            y: screen_y,
        };
        let hmonitor = MonitorFromPoint(cursor_point, MONITOR_DEFAULTTONEAREST);
        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };

        if GetMonitorInfoW(hmonitor, &mut monitor_info).as_bool() {
            let rc = monitor_info.rcMonitor;
            (
                (rc.left - state.monitor.x) as f32,
                (rc.top - state.monitor.y) as f32,
                (rc.right - state.monitor.x) as f32,
                (rc.bottom - state.monitor.y) as f32,
            )
        } else {
            // Fallback to full overlay
            (
                0.0,
                0.0,
                state.monitor.width as f32,
                state.monitor.height as f32,
            )
        }
    };

    unsafe {
        // Horizontal line (left segment)
        if cx > mon_left + gap {
            context.DrawLine(
                D2D_POINT_2F { x: mon_left, y: cy },
                D2D_POINT_2F { x: cx - gap, y: cy },
                &d2d.brushes.crosshair,
                1.0,
                &d2d.crosshair_stroke,
            );
        }

        // Horizontal line (right segment)
        if cx + gap < mon_right {
            context.DrawLine(
                D2D_POINT_2F { x: cx + gap, y: cy },
                D2D_POINT_2F {
                    x: mon_right,
                    y: cy,
                },
                &d2d.brushes.crosshair,
                1.0,
                &d2d.crosshair_stroke,
            );
        }

        // Vertical line (top segment)
        if cy > mon_top + gap {
            context.DrawLine(
                D2D_POINT_2F { x: cx, y: mon_top },
                D2D_POINT_2F { x: cx, y: cy - gap },
                &d2d.brushes.crosshair,
                1.0,
                &d2d.crosshair_stroke,
            );
        }

        // Vertical line (bottom segment)
        if cy + gap < mon_bottom {
            context.DrawLine(
                D2D_POINT_2F { x: cx, y: cy + gap },
                D2D_POINT_2F {
                    x: cx,
                    y: mon_bottom,
                },
                &d2d.brushes.crosshair,
                1.0,
                &d2d.crosshair_stroke,
            );
        }
    }
}

/// Draw the size indicator text below the selection.
fn draw_size_indicator(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    clear_rect: D2D_RECT_F,
    state: &OverlayState,
) {
    let width = state.monitor.width as f32;
    let height = state.monitor.height as f32;

    let sel_width = (clear_rect.right - clear_rect.left) as u32;
    let sel_height = (clear_rect.bottom - clear_rect.top) as u32;

    // Format the size text
    let size_text = format!("{} x {}", sel_width, sel_height);
    let size_text_wide: Vec<u16> = size_text.encode_utf16().chain(std::iter::once(0)).collect();

    // Calculate text box dimensions
    let text_width = 100.0_f32;
    let text_height = 24.0_f32;
    let padding = 6.0_f32;
    let margin = 8.0_f32;

    // Position below the selection, centered horizontally
    let box_x = clear_rect.left + (clear_rect.right - clear_rect.left - text_width) / 2.0;
    let mut box_y = clear_rect.bottom + margin;

    // Clamp to screen bounds
    let box_x = box_x.clamp(padding, width - text_width - padding);

    // If below screen, show above selection
    if box_y + text_height + padding > height {
        box_y = clear_rect.top - margin - text_height;
    }
    let box_y = box_y.max(padding);

    let bg_rect = D2D_RECT_F {
        left: box_x,
        top: box_y,
        right: box_x + text_width,
        bottom: box_y + text_height,
    };

    unsafe {
        // Draw background rounded rect
        let rounded_rect = D2D1_ROUNDED_RECT {
            rect: bg_rect,
            radiusX: 4.0,
            radiusY: 4.0,
        };
        context.FillRoundedRectangle(&rounded_rect, &d2d.brushes.text_bg);

        // Draw text
        context.DrawText(
            &size_text_wide[..size_text_wide.len() - 1], // Exclude null terminator
            &d2d.text_format,
            &bg_rect,
            &d2d.brushes.text,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
    }
}

/// Draw the 8 resize handles.
fn draw_resize_handles(context: &ID2D1DeviceContext, brushes: &Brushes, rect: D2D_RECT_F) {
    let hh = HANDLE_HALF as f32;

    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;
    let cx = (left + right) / 2.0;
    let cy = (top + bottom) / 2.0;

    // Helper to draw a single handle
    let draw_handle = |x: f32, y: f32| {
        let rect = D2D_RECT_F {
            left: x - hh,
            top: y - hh,
            right: x + hh,
            bottom: y + hh,
        };
        unsafe {
            context.FillRectangle(&rect, &brushes.handle_fill);
            context.DrawRectangle(&rect, &brushes.handle_border, 1.0, None);
        }
    };

    // Corners
    draw_handle(left, top); // TopLeft
    draw_handle(right, top); // TopRight
    draw_handle(left, bottom); // BottomLeft
    draw_handle(right, bottom); // BottomRight

    // Edges
    draw_handle(cx, top); // Top
    draw_handle(cx, bottom); // Bottom
    draw_handle(left, cy); // Left
    draw_handle(right, cy); // Right
}

fn draw_recording_mode_chooser(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    state: &OverlayState,
) {
    let Some(chooser) = &state.recording_mode_chooser else {
        return;
    };
    let Some(shell) = recording_mode_chooser_rect(state) else {
        return;
    };

    let shell_rect = shell.to_d2d_rect();
    let header = "Choose recording mode";
    let header_wide: Vec<u16> = header.encode_utf16().collect();

    unsafe {
        let rounded_shell = D2D1_ROUNDED_RECT {
            rect: shell_rect,
            radiusX: 14.0,
            radiusY: 14.0,
        };
        context.FillRoundedRectangle(&rounded_shell, &d2d.brushes.text_bg);
        context.DrawRoundedRectangle(&rounded_shell, &d2d.brushes.handle_border, 1.0, None);

        let back_rect = Rect::new(
            shell.left + 16,
            shell.top + 14,
            shell.left + 16 + RECORDING_MODE_CHOOSER_BACK_SIZE,
            shell.top + 14 + RECORDING_MODE_CHOOSER_BACK_SIZE,
        )
        .to_d2d_rect();
        let rounded_back = D2D1_ROUNDED_RECT {
            rect: back_rect,
            radiusX: 8.0,
            radiusY: 8.0,
        };
        if chooser.hovered == RecordingModeChooserHitTarget::Back {
            context.FillRoundedRectangle(&rounded_back, &d2d.brushes.overlay);
        }
        context.DrawRoundedRectangle(&rounded_back, &d2d.brushes.handle_border, 1.0, None);
        draw_text(context, d2d, "<", back_rect, false);

        let header_rect = D2D_RECT_F {
            left: shell.left as f32 + 64.0,
            top: shell.top as f32 + 16.0,
            right: shell.right as f32 - 64.0,
            bottom: shell.top as f32 + 44.0,
        };
        context.DrawText(
            &header_wide,
            &d2d.text_format,
            &header_rect,
            &d2d.brushes.text,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );

        draw_chooser_card(
            context,
            d2d,
            Rect::new(
                shell.left + 28,
                shell.top + 58,
                shell.left + 205,
                shell.top + 122,
            ),
            "Quick",
            "Ready to share",
            chooser.hovered == RecordingModeChooserHitTarget::Quick,
        );
        draw_chooser_card(
            context,
            d2d,
            Rect::new(
                shell.left + 225,
                shell.top + 58,
                shell.left + 402,
                shell.top + 122,
            ),
            "Studio",
            "Edit with effects",
            chooser.hovered == RecordingModeChooserHitTarget::Studio,
        );

        let remember_rect = Rect::new(
            shell.left + 28,
            shell.top + 134,
            shell.right - 28,
            shell.top + 166,
        );
        let rounded_remember = D2D1_ROUNDED_RECT {
            rect: remember_rect.to_d2d_rect(),
            radiusX: 9.0,
            radiusY: 9.0,
        };
        if chooser.hovered == RecordingModeChooserHitTarget::Remember {
            context.FillRoundedRectangle(&rounded_remember, &d2d.brushes.overlay);
        }
        context.DrawRoundedRectangle(&rounded_remember, &d2d.brushes.handle_border, 1.0, None);

        let checkbox = Rect::new(
            remember_rect.left + 12,
            remember_rect.top + 9,
            remember_rect.left + 26,
            remember_rect.top + 23,
        );
        let checkbox_rounded = D2D1_ROUNDED_RECT {
            rect: checkbox.to_d2d_rect(),
            radiusX: 3.0,
            radiusY: 3.0,
        };
        if chooser.remember {
            context.FillRoundedRectangle(&checkbox_rounded, &d2d.brushes.handle_border);
            draw_text(context, d2d, "✓", checkbox.to_d2d_rect(), false);
        } else {
            context.DrawRoundedRectangle(&checkbox_rounded, &d2d.brushes.handle_border, 1.0, None);
        }

        let remember_text_rect = D2D_RECT_F {
            left: remember_rect.left as f32 + 36.0,
            top: remember_rect.top as f32 + 2.0,
            right: remember_rect.right as f32 - 10.0,
            bottom: remember_rect.bottom as f32 - 2.0,
        };
        draw_text(
            context,
            d2d,
            "Remember my choice",
            remember_text_rect,
            false,
        );
    }
}

fn draw_chooser_card(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    rect: Rect,
    title: &str,
    subtitle: &str,
    is_hovered: bool,
) {
    unsafe {
        let rounded = D2D1_ROUNDED_RECT {
            rect: rect.to_d2d_rect(),
            radiusX: 11.0,
            radiusY: 11.0,
        };
        if is_hovered {
            context.FillRoundedRectangle(&rounded, &d2d.brushes.overlay);
        }
        context.DrawRoundedRectangle(&rounded, &d2d.brushes.handle_border, 1.0, None);

        draw_text(
            context,
            d2d,
            title,
            D2D_RECT_F {
                left: rect.left as f32 + 8.0,
                top: rect.top as f32 + 10.0,
                right: rect.right as f32 - 8.0,
                bottom: rect.top as f32 + 34.0,
            },
            true,
        );
        draw_text(
            context,
            d2d,
            subtitle,
            D2D_RECT_F {
                left: rect.left as f32 + 8.0,
                top: rect.top as f32 + 34.0,
                right: rect.right as f32 - 8.0,
                bottom: rect.bottom as f32 - 8.0,
            },
            false,
        );
    }
}

fn draw_text(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    text: &str,
    rect: D2D_RECT_F,
    large: bool,
) {
    let text_wide: Vec<u16> = text.encode_utf16().collect();
    unsafe {
        context.DrawText(
            &text_wide,
            if large {
                &d2d.text_format_large
            } else {
                &d2d.text_format
            },
            &rect,
            &d2d.brushes.text,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
    }
}

/// Draw the window name indicator in the center of the selection region.
fn draw_window_name_indicator(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    hwnd: windows::Win32::Foundation::HWND,
    clear_rect: D2D_RECT_F,
    state: &OverlayState,
) {
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let screen_width = state.monitor.width as f32;
    let screen_height = state.monitor.height as f32;

    // Get app name from process executable
    let app_name = unsafe {
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));

        if process_id != 0 {
            if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) {
                let mut buffer = [0u16; 260];
                let mut size = buffer.len() as u32;
                if QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(buffer.as_mut_ptr()),
                    &mut size,
                )
                .is_ok()
                {
                    let path = String::from_utf16_lossy(&buffer[..size as usize]);
                    // Extract filename without extension
                    if let Some(filename) = std::path::Path::new(&path).file_stem() {
                        filename.to_string_lossy().into_owned()
                    } else {
                        format!("Window {}", hwnd.0 as isize)
                    }
                } else {
                    format!("Window {}", hwnd.0 as isize)
                }
            } else {
                format!("Window {}", hwnd.0 as isize)
            }
        } else {
            format!("Window {}", hwnd.0 as isize)
        }
    };

    // Truncate if too long
    let display_text = if app_name.len() > 50 {
        format!("{}…", &app_name[..49])
    } else {
        app_name
    };

    let text_wide: Vec<u16> = display_text
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    // Calculate text box dimensions (larger for window name)
    let text_width = 400.0_f32;
    let text_height = 48.0_f32;
    let padding = 8.0_f32;

    // Position in the center of the selection region
    let region_center_x = (clear_rect.left + clear_rect.right) / 2.0;
    let region_center_y = (clear_rect.top + clear_rect.bottom) / 2.0;
    let box_x = region_center_x - text_width / 2.0;
    let box_y = region_center_y - text_height / 2.0;

    // Clamp to screen bounds
    let box_x = box_x.clamp(padding, screen_width - text_width - padding);
    let box_y = box_y.clamp(padding, screen_height - text_height - padding);

    let bg_rect = D2D_RECT_F {
        left: box_x,
        top: box_y,
        right: box_x + text_width,
        bottom: box_y + text_height,
    };

    unsafe {
        // Draw background rounded rect
        let rounded_rect = D2D1_ROUNDED_RECT {
            rect: bg_rect,
            radiusX: 8.0,
            radiusY: 8.0,
        };
        context.FillRoundedRectangle(&rounded_rect, &d2d.brushes.text_bg);

        // Draw text with larger format
        context.DrawText(
            &text_wide[..text_wide.len() - 1], // Exclude null terminator
            &d2d.text_format_large,
            &bg_rect,
            &d2d.brushes.text,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
    }
}
