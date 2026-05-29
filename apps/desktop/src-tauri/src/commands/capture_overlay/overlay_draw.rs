//! Direct2D drawing primitives for the capture overlay.
//!
//! Split out of `render.rs`; consumes layout from `overlay_geometry` and is
//! driven by `render::render`.

use windows::core::{Interface, Result};
use windows::Foundation::Numerics::Matrix3x2;
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_COLOR_F, D2D1_GRADIENT_STOP, D2D_POINT_2F, D2D_RECT_F,
};
use windows::Win32::Graphics::Direct2D::{
    ID2D1DeviceContext, ID2D1LinearGradientBrush, ID2D1RenderTarget, ID2D1SolidColorBrush,
    D2D1_BRUSH_PROPERTIES, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_EXTEND_MODE_CLAMP, D2D1_GAMMA_2_2,
    D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES, D2D1_ROUNDED_RECT,
};
use windows::Win32::Graphics::DirectWrite::{IDWriteTextFormat, DWRITE_MEASURING_MODE_NATURAL};
use windows::Win32::Graphics::DirectWrite::{
    DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_TEXT_ALIGNMENT_CENTER,
    DWRITE_TEXT_ALIGNMENT_LEADING,
};

use super::graphics::d2d::{create_text_format_with_size, Brushes, D2DResources};
use super::overlay_geometry::*;
use super::state::{OverlayState, SelectionHudState};
use super::types::*;

/// Draw the dimmed overlay around the clear area.
///
/// Draws 4 rectangles to create the "cutout" effect.
pub(super) fn draw_dim_overlay(
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
pub(super) fn draw_selection_border(
    context: &ID2D1DeviceContext,
    brushes: &Brushes,
    rect: D2D_RECT_F,
    state: &OverlayState,
) {
    let rect = if state.overlay_mode == OverlayMode::DisplaySelect {
        inset_rect(rect, 1.0)
    } else {
        rect
    };

    unsafe {
        context.DrawRectangle(&rect, &brushes.border, 2.0, None);
    }
}

fn inset_rect(rect: D2D_RECT_F, inset: f32) -> D2D_RECT_F {
    if rect.right - rect.left <= inset * 2.0 || rect.bottom - rect.top <= inset * 2.0 {
        return rect;
    }

    D2D_RECT_F {
        left: rect.left + inset,
        top: rect.top + inset,
        right: rect.right - inset,
        bottom: rect.bottom - inset,
    }
}

/// Draw the crosshair cursor.
pub(super) fn draw_crosshair(
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
pub(super) fn draw_size_indicator(
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
        context.FillRoundedRectangle(&rounded_rect, &d2d.brushes.window_label_bg);

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
pub(super) fn draw_resize_handles(
    context: &ID2D1DeviceContext,
    brushes: &Brushes,
    rect: D2D_RECT_F,
) {
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

pub(super) fn draw_selection_hud(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    state: &OverlayState,
) -> Result<()> {
    let Some(hud) = &state.selection_hud else {
        return Ok(());
    };
    let Some(shell) = selection_hud_rect(state) else {
        return Ok(());
    };
    let Some(selection) = state.get_local_selection() else {
        return Ok(());
    };

    let metrics = SelectionHudMetrics::from_shell(shell);
    let rects = selection_hud_button_rects(shell);
    let text_tiny = create_text_format_with_size(
        metrics.sf(13.0),
        DWRITE_FONT_WEIGHT_NORMAL,
        DWRITE_TEXT_ALIGNMENT_CENTER,
    )?;
    let text_small = create_text_format_with_size(
        metrics.sf(16.0),
        DWRITE_FONT_WEIGHT_SEMI_BOLD,
        DWRITE_TEXT_ALIGNMENT_CENTER,
    )?;
    let capture_label = match state.capture_type {
        CaptureType::Gif => "GIF",
        _ => "Record",
    };
    let width_text = if hud.editing_dimension == Some(SelectionHudDimensionEdit::Width) {
        format!("W {}_", hud.dimension_input)
    } else {
        format!("W {}", selection.width())
    };
    let height_text = if hud.editing_dimension == Some(SelectionHudDimensionEdit::Height) {
        format!("H {}_", hud.dimension_input)
    } else {
        format!("H {}", selection.height())
    };

    unsafe {
        let rounded_shell = D2D1_ROUNDED_RECT {
            rect: shell.to_d2d_rect(),
            radiusX: metrics.sf(14.0),
            radiusY: metrics.sf(14.0),
        };
        let shell_brush = create_vertical_gradient(
            context,
            shell.to_d2d_rect(),
            [
                gradient_stop(0.0, 0.12, 0.12, 0.14, 0.97),
                gradient_stop(1.0, 0.045, 0.047, 0.055, 0.97),
            ],
        )?;
        context.FillRoundedRectangle(&rounded_shell, &shell_brush);
        context.DrawRoundedRectangle(
            &rounded_shell,
            &d2d.brushes.chooser_border,
            metrics.sf(1.0),
            None,
        );

        draw_hud_button(
            context,
            d2d,
            metrics,
            rects.back,
            "Redraw",
            hud.hovered == SelectionHudHitTarget::Back,
            false,
            &text_tiny,
        )?;
        draw_hud_button(
            context,
            d2d,
            metrics,
            rects.preset,
            "Preset",
            hud.hovered == SelectionHudHitTarget::Preset,
            false,
            &text_tiny,
        )?;
        draw_dimension_stepper(
            context,
            d2d,
            metrics,
            rects.width,
            &width_text,
            hud.hovered == SelectionHudHitTarget::WidthDown,
            hud.hovered == SelectionHudHitTarget::WidthUp,
            hud.hovered == SelectionHudHitTarget::WidthInput,
            hud.editing_dimension == Some(SelectionHudDimensionEdit::Width),
            &text_small,
            &text_tiny,
        )?;
        draw_dimension_stepper(
            context,
            d2d,
            metrics,
            rects.height,
            &height_text,
            hud.hovered == SelectionHudHitTarget::HeightDown,
            hud.hovered == SelectionHudHitTarget::HeightUp,
            hud.hovered == SelectionHudHitTarget::HeightInput,
            hud.editing_dimension == Some(SelectionHudDimensionEdit::Height),
            &text_small,
            &text_tiny,
        )?;
        draw_hud_button(
            context,
            d2d,
            metrics,
            rects.save,
            "Areas",
            hud.hovered == SelectionHudHitTarget::Save,
            false,
            &text_tiny,
        )?;
        draw_hud_button(
            context,
            d2d,
            metrics,
            rects.capture,
            capture_label,
            hud.hovered == SelectionHudHitTarget::Capture,
            true,
            &text_tiny,
        )?;
        draw_hud_button(
            context,
            d2d,
            metrics,
            rects.cancel,
            "Cancel",
            hud.hovered == SelectionHudHitTarget::Cancel,
            false,
            &text_tiny,
        )?;
        draw_selection_hud_feedback(context, d2d, state, shell, hud, metrics, &text_tiny)?;
    }

    Ok(())
}

fn draw_selection_hud_feedback(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    state: &OverlayState,
    shell: Rect,
    hud: &SelectionHudState,
    metrics: SelectionHudMetrics,
    text_format: &IDWriteTextFormat,
) -> Result<()> {
    let Some(feedback) = &hud.feedback else {
        return Ok(());
    };

    let width = scaled_i32(
        ((feedback.message.chars().count() as i32 * 7) + 28).clamp(70, 180),
        metrics.scale,
    );
    let height = metrics.s(26);
    let margin = metrics.s(8);
    let monitor_width = state.monitor.width as i32;
    let monitor_height = state.monitor.height as i32;
    let max_left = (monitor_width - width - margin).max(margin);
    let left = (shell.left + (shell.width() as i32 - width) / 2).clamp(margin, max_left);
    let mut top = shell.top - height - metrics.s(8);
    if top < margin {
        top = (shell.bottom + metrics.s(8)).min((monitor_height - height - margin).max(margin));
    }

    let rect = Rect::new(left, top, left + width, top + height);
    unsafe {
        let rounded = D2D1_ROUNDED_RECT {
            rect: rect.to_d2d_rect(),
            radiusX: metrics.sf(13.0),
            radiusY: metrics.sf(13.0),
        };
        context.FillRoundedRectangle(&rounded, &d2d.brushes.window_label_bg);
        context.DrawRoundedRectangle(&rounded, &d2d.brushes.chooser_border, metrics.sf(1.0), None);
        draw_text_with_style(
            context,
            &feedback.message,
            rect.to_d2d_rect(),
            text_format,
            &d2d.brushes.text,
        );
    }

    Ok(())
}

fn draw_dimension_stepper(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    metrics: SelectionHudMetrics,
    rect: Rect,
    label: &str,
    is_minus_hovered: bool,
    is_plus_hovered: bool,
    is_input_hovered: bool,
    is_input_active: bool,
    text_small: &IDWriteTextFormat,
    text_tiny: &IDWriteTextFormat,
) -> Result<()> {
    unsafe {
        let rounded = D2D1_ROUNDED_RECT {
            rect: rect.to_d2d_rect(),
            radiusX: metrics.sf(9.0),
            radiusY: metrics.sf(9.0),
        };
        if is_input_active {
            context.FillRoundedRectangle(&rounded, &d2d.brushes.chooser_surface_hover);
        } else {
            context.FillRoundedRectangle(&rounded, &d2d.brushes.chooser_surface);
        }
        context.DrawRoundedRectangle(&rounded, &d2d.brushes.chooser_border, metrics.sf(1.0), None);

        let minus_rect = Rect::new(
            rect.left,
            rect.top,
            rect.left + metrics.step_button_width,
            rect.bottom,
        );
        let plus_rect = Rect::new(
            rect.right - metrics.step_button_width,
            rect.top,
            rect.right,
            rect.bottom,
        );

        if is_minus_hovered {
            context.FillRoundedRectangle(
                &D2D1_ROUNDED_RECT {
                    rect: minus_rect.to_d2d_rect(),
                    radiusX: metrics.sf(9.0),
                    radiusY: metrics.sf(9.0),
                },
                &d2d.brushes.chooser_surface_hover,
            );
        }
        if is_plus_hovered {
            context.FillRoundedRectangle(
                &D2D1_ROUNDED_RECT {
                    rect: plus_rect.to_d2d_rect(),
                    radiusX: metrics.sf(9.0),
                    radiusY: metrics.sf(9.0),
                },
                &d2d.brushes.chooser_surface_hover,
            );
        }

        let input_rect = D2D_RECT_F {
            left: minus_rect.right as f32,
            top: rect.top as f32,
            right: plus_rect.left as f32,
            bottom: rect.bottom as f32,
        };
        if is_input_hovered && !is_input_active {
            context.FillRectangle(&input_rect, &d2d.brushes.chooser_surface_hover);
        }

        draw_text_with_style(
            context,
            "-",
            minus_rect.to_d2d_rect(),
            text_small,
            &d2d.brushes.text,
        );
        draw_text_with_style(
            context,
            "+",
            plus_rect.to_d2d_rect(),
            text_small,
            &d2d.brushes.text,
        );
        draw_text_with_style(
            context,
            label,
            input_rect,
            text_tiny,
            &d2d.brushes.chooser_muted_text,
        );
    }

    Ok(())
}

fn draw_hud_button(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    metrics: SelectionHudMetrics,
    rect: Rect,
    label: &str,
    is_hovered: bool,
    is_primary: bool,
    text_format: &IDWriteTextFormat,
) -> Result<()> {
    unsafe {
        let rounded = D2D1_ROUNDED_RECT {
            rect: rect.to_d2d_rect(),
            radiusX: metrics.sf(9.0),
            radiusY: metrics.sf(9.0),
        };
        if is_primary {
            let brush = create_vertical_gradient(
                context,
                rect.to_d2d_rect(),
                [
                    gradient_stop(0.0, 0.12, 0.48, 0.95, if is_hovered { 0.96 } else { 0.86 }),
                    gradient_stop(1.0, 0.02, 0.32, 0.82, if is_hovered { 0.96 } else { 0.86 }),
                ],
            )?;
            context.FillRoundedRectangle(&rounded, &brush);
        } else if is_hovered {
            context.FillRoundedRectangle(&rounded, &d2d.brushes.chooser_surface_hover);
        } else {
            context.FillRoundedRectangle(&rounded, &d2d.brushes.chooser_surface);
        }
        context.DrawRoundedRectangle(&rounded, &d2d.brushes.chooser_border, metrics.sf(1.0), None);
        draw_text_with_style(
            context,
            label,
            rect.to_d2d_rect(),
            text_format,
            &d2d.brushes.text,
        );
    }

    Ok(())
}

pub(super) fn draw_recording_mode_chooser(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    state: &OverlayState,
) -> Result<()> {
    let Some(chooser) = &state.recording_mode_chooser else {
        return Ok(());
    };
    let Some(shell) = recording_mode_chooser_rect(state) else {
        return Ok(());
    };
    let metrics = RecordingModeChooserMetrics::from_shell(shell);
    let text_small = create_text_format_with_size(
        metrics.sf(16.0),
        DWRITE_FONT_WEIGHT_SEMI_BOLD,
        DWRITE_TEXT_ALIGNMENT_CENTER,
    )?;
    let text_small_left = create_text_format_with_size(
        metrics.sf(16.0),
        DWRITE_FONT_WEIGHT_SEMI_BOLD,
        DWRITE_TEXT_ALIGNMENT_LEADING,
    )?;
    let text_tiny = create_text_format_with_size(
        metrics.sf(13.0),
        DWRITE_FONT_WEIGHT_NORMAL,
        DWRITE_TEXT_ALIGNMENT_CENTER,
    )?;
    let text_tiny_left = create_text_format_with_size(
        metrics.sf(13.0),
        DWRITE_FONT_WEIGHT_NORMAL,
        DWRITE_TEXT_ALIGNMENT_LEADING,
    )?;

    unsafe {
        let rounded_shell = D2D1_ROUNDED_RECT {
            rect: shell.to_d2d_rect(),
            radiusX: metrics.sf(14.0),
            radiusY: metrics.sf(14.0),
        };
        let shell_brush = create_vertical_gradient(
            context,
            shell.to_d2d_rect(),
            [
                gradient_stop(0.0, 0.12, 0.12, 0.14, 0.98),
                gradient_stop(0.72, 0.055, 0.057, 0.066, 0.98),
                gradient_stop(1.0, 0.035, 0.037, 0.044, 0.985),
            ],
        )?;
        context.FillRoundedRectangle(&rounded_shell, &shell_brush);

        let header_band = D2D1_ROUNDED_RECT {
            rect: D2D_RECT_F {
                left: shell.left as f32 + metrics.sf(1.0),
                top: shell.top as f32 + metrics.sf(1.0),
                right: shell.right as f32 - metrics.sf(1.0),
                bottom: shell.top as f32 + metrics.sf(54.0),
            },
            radiusX: metrics.sf(13.0),
            radiusY: metrics.sf(13.0),
        };
        context.FillRoundedRectangle(&header_band, &d2d.brushes.chooser_surface);
        context.DrawRoundedRectangle(
            &rounded_shell,
            &d2d.brushes.chooser_border,
            metrics.sf(1.0),
            None,
        );

        let back_rect = recording_mode_chooser_back_rect(shell).to_d2d_rect();
        let rounded_back = D2D1_ROUNDED_RECT {
            rect: back_rect,
            radiusX: metrics.sf(8.0),
            radiusY: metrics.sf(8.0),
        };
        if chooser.hovered == RecordingModeChooserHitTarget::Back {
            context.FillRoundedRectangle(&rounded_back, &d2d.brushes.chooser_surface_hover);
        } else {
            context.FillRoundedRectangle(&rounded_back, &d2d.brushes.chooser_surface);
        }
        context.DrawRoundedRectangle(
            &rounded_back,
            &d2d.brushes.chooser_border,
            metrics.sf(1.0),
            None,
        );
        draw_text_with_style(context, "<", back_rect, &text_small, &d2d.brushes.text);

        let header_rect = D2D_RECT_F {
            left: shell.left as f32 + metrics.sf(58.0),
            top: shell.top as f32 + metrics.sf(10.0),
            right: shell.right as f32 - metrics.sf(18.0),
            bottom: shell.top as f32 + metrics.sf(30.0),
        };
        draw_text_with_style(
            context,
            "Recording Mode",
            header_rect,
            &text_small_left,
            &d2d.brushes.text,
        );
        draw_text_with_style(
            context,
            "Choose what happens after capture.",
            D2D_RECT_F {
                left: shell.left as f32 + metrics.sf(58.0),
                top: shell.top as f32 + metrics.sf(28.0),
                right: shell.right as f32 - metrics.sf(18.0),
                bottom: shell.top as f32 + metrics.sf(47.0),
            },
            &text_tiny_left,
            &d2d.brushes.chooser_muted_text,
        );

        draw_chooser_card(
            context,
            d2d,
            metrics,
            recording_mode_chooser_quick_rect(shell),
            "Quick Save",
            "Record and export",
            &d2d.brushes.chooser_quick_icon,
            chooser.hovered == RecordingModeChooserHitTarget::Quick,
            &text_small_left,
            &text_tiny_left,
        )?;
        draw_chooser_card(
            context,
            d2d,
            metrics,
            recording_mode_chooser_studio_rect(shell),
            "Open Studio",
            "Record then edit",
            &d2d.brushes.chooser_studio_icon,
            chooser.hovered == RecordingModeChooserHitTarget::Studio,
            &text_small_left,
            &text_tiny_left,
        )?;

        let remember_rect = recording_mode_chooser_remember_rect(shell);
        let rounded_remember = D2D1_ROUNDED_RECT {
            rect: remember_rect.to_d2d_rect(),
            radiusX: metrics.sf(8.0),
            radiusY: metrics.sf(8.0),
        };
        if chooser.hovered == RecordingModeChooserHitTarget::Remember {
            context.FillRoundedRectangle(&rounded_remember, &d2d.brushes.chooser_surface_hover);
        } else {
            context.FillRoundedRectangle(&rounded_remember, &d2d.brushes.chooser_surface);
        }
        context.DrawRoundedRectangle(
            &rounded_remember,
            &d2d.brushes.chooser_border,
            metrics.sf(1.0),
            None,
        );

        let checkbox = Rect::new(
            remember_rect.left + metrics.s(12),
            remember_rect.top + metrics.s(8),
            remember_rect.left + metrics.s(26),
            remember_rect.top + metrics.s(22),
        );
        let checkbox_rounded = D2D1_ROUNDED_RECT {
            rect: checkbox.to_d2d_rect(),
            radiusX: metrics.sf(3.0),
            radiusY: metrics.sf(3.0),
        };
        if chooser.remember {
            context.FillRoundedRectangle(&checkbox_rounded, &d2d.brushes.chooser_quick_icon);
            draw_text_with_style(
                context,
                "x",
                checkbox.to_d2d_rect(),
                &text_tiny,
                &d2d.brushes.text,
            );
        } else {
            context.FillRoundedRectangle(&checkbox_rounded, &d2d.brushes.chooser_surface);
            context.DrawRoundedRectangle(
                &checkbox_rounded,
                &d2d.brushes.chooser_border,
                metrics.sf(1.0),
                None,
            );
        }

        let remember_text_rect = D2D_RECT_F {
            left: remember_rect.left as f32 + metrics.sf(36.0),
            top: remember_rect.top as f32 + metrics.sf(5.0),
            right: remember_rect.right as f32 - metrics.sf(10.0),
            bottom: remember_rect.bottom as f32 - metrics.sf(5.0),
        };
        draw_text_with_style(
            context,
            "Remember this choice",
            remember_text_rect,
            &text_tiny_left,
            &d2d.brushes.chooser_muted_text,
        );
    }

    Ok(())
}

fn draw_chooser_card(
    context: &ID2D1DeviceContext,
    d2d: &D2DResources,
    metrics: RecordingModeChooserMetrics,
    rect: Rect,
    title: &str,
    subtitle: &str,
    icon_brush: &ID2D1SolidColorBrush,
    is_hovered: bool,
    text_small_left: &IDWriteTextFormat,
    text_tiny_left: &IDWriteTextFormat,
) -> Result<()> {
    unsafe {
        let rounded = D2D1_ROUNDED_RECT {
            rect: rect.to_d2d_rect(),
            radiusX: metrics.sf(10.0),
            radiusY: metrics.sf(10.0),
        };
        let card_brush = if is_hovered {
            create_vertical_gradient(
                context,
                rect.to_d2d_rect(),
                [
                    gradient_stop(0.0, 0.27, 0.29, 0.33, 0.36),
                    gradient_stop(1.0, 0.12, 0.13, 0.15, 0.28),
                ],
            )?
        } else {
            create_vertical_gradient(
                context,
                rect.to_d2d_rect(),
                [
                    gradient_stop(0.0, 1.0, 1.0, 1.0, 0.09),
                    gradient_stop(1.0, 1.0, 1.0, 1.0, 0.04),
                ],
            )?
        };
        context.FillRoundedRectangle(&rounded, &card_brush);
        context.DrawRoundedRectangle(&rounded, &d2d.brushes.chooser_border, metrics.sf(1.0), None);

        let icon_rect = Rect::new(
            rect.left + metrics.s(14),
            rect.top + metrics.s(18),
            rect.left + metrics.s(48),
            rect.top + metrics.s(52),
        );
        let rounded_icon = D2D1_ROUNDED_RECT {
            rect: icon_rect.to_d2d_rect(),
            radiusX: metrics.sf(9.0),
            radiusY: metrics.sf(9.0),
        };
        context.FillRoundedRectangle(&rounded_icon, icon_brush);
        context.DrawRoundedRectangle(
            &rounded_icon,
            &d2d.brushes.chooser_border,
            metrics.sf(1.0),
            None,
        );

        draw_text_with_style(
            context,
            title,
            D2D_RECT_F {
                left: rect.left as f32 + metrics.sf(60.0),
                top: rect.top as f32 + metrics.sf(15.0),
                right: rect.right as f32 - metrics.sf(14.0),
                bottom: rect.top as f32 + metrics.sf(35.0),
            },
            text_small_left,
            &d2d.brushes.text,
        );
        draw_text_with_style(
            context,
            subtitle,
            D2D_RECT_F {
                left: rect.left as f32 + metrics.sf(60.0),
                top: rect.top as f32 + metrics.sf(35.0),
                right: rect.right as f32 - metrics.sf(14.0),
                bottom: rect.bottom as f32 - metrics.sf(12.0),
            },
            text_tiny_left,
            &d2d.brushes.chooser_muted_text,
        );
    }

    Ok(())
}

fn gradient_stop(position: f32, r: f32, g: f32, b: f32, a: f32) -> D2D1_GRADIENT_STOP {
    D2D1_GRADIENT_STOP {
        position,
        color: D2D1_COLOR_F { r, g, b, a },
    }
}

fn create_vertical_gradient<const N: usize>(
    context: &ID2D1DeviceContext,
    rect: D2D_RECT_F,
    stops: [D2D1_GRADIENT_STOP; N],
) -> Result<ID2D1LinearGradientBrush> {
    create_vertical_gradient_from_stops(context, rect, &stops)
}

fn create_vertical_gradient_from_stops(
    context: &ID2D1DeviceContext,
    rect: D2D_RECT_F,
    stops: &[D2D1_GRADIENT_STOP],
) -> Result<ID2D1LinearGradientBrush> {
    unsafe {
        let render_target: ID2D1RenderTarget = context.cast()?;
        let stop_collection = render_target.CreateGradientStopCollection(
            stops,
            D2D1_GAMMA_2_2,
            D2D1_EXTEND_MODE_CLAMP,
        )?;
        let props = D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
            startPoint: D2D_POINT_2F {
                x: rect.left,
                y: rect.top,
            },
            endPoint: D2D_POINT_2F {
                x: rect.left,
                y: rect.bottom,
            },
        };
        let brush_props = D2D1_BRUSH_PROPERTIES {
            opacity: 1.0,
            transform: Matrix3x2::identity(),
        };

        render_target.CreateLinearGradientBrush(&props, Some(&brush_props), &stop_collection)
    }
}

fn draw_text_with_style(
    context: &ID2D1DeviceContext,
    text: &str,
    rect: D2D_RECT_F,
    format: &IDWriteTextFormat,
    brush: &ID2D1SolidColorBrush,
) {
    let text_wide: Vec<u16> = text.encode_utf16().collect();
    unsafe {
        context.DrawText(
            &text_wide,
            format,
            &rect,
            brush,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
    }
}

/// Draw the window name indicator in the center of the selection region.
pub(super) fn draw_window_name_indicator(
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
        context.FillRoundedRectangle(&rounded_rect, &d2d.brushes.window_label_bg);

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
