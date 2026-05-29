//! Direct2D rendering entry point for the overlay.
//!
//! Drives a single frame: clears the swap chain, decides what to show via
//! [`RenderInfo`], and dispatches to the drawing primitives in
//! [`overlay_draw`]. Layout math and hit-testing live in [`overlay_geometry`]
//! (re-exported here so existing `render::*` call sites keep working).

use windows::core::Result;
use windows::Win32::Graphics::Direct2D::Common::{D2D1_COLOR_F, D2D_RECT_F};
use windows::Win32::Graphics::Dxgi::{IDXGISurface, DXGI_PRESENT};

use super::commands::{get_highlighted_monitor, get_highlighted_window};
use super::graphics::d2d::create_target_bitmap;
use super::overlay_draw::*;
pub use super::overlay_geometry::*;
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
            draw_selection_border(&d2d.context, &d2d.brushes, render_info.clear_rect, state);
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
            draw_recording_mode_chooser(&d2d.context, d2d, state)?;
        } else if state.selection_hud.is_some() {
            draw_selection_hud(&d2d.context, d2d, state)?;
        }

        d2d.context.EndDraw(None, None)?;

        // Present the frame
        graphics.swap_chain.Present(1, DXGI_PRESENT(0)).ok()?;
        graphics.comp_device.Commit()?;
    }

    Ok(())
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
            draw_handles: !state.adjustment.is_locked
                && !state.is_resize_locked_by_recording_mode_chooser(),
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
