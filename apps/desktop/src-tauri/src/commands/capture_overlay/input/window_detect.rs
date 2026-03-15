//! Window detection under cursor.
//!
//! Enumerates windows in z-order to find valid capture targets at a given
//! screen position. Filters out system windows, tool windows, and other
//! windows that shouldn't be captured.

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetClientRect, GetDesktopWindow, GetTopWindow, GetWindow,
    GetWindowLongW, GetWindowRect, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE, GW_HWNDNEXT, WS_CHILD,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

use crate::commands::capture_overlay::types::{DetectedWindow, Rect};

const MIN_DETECTED_WINDOW_SIZE: u32 = 50;
const MIN_CHROMIUM_CONTENT_TOP_INSET: i32 = 24;
const MAX_CHROMIUM_CONTENT_BOTTOM_GAP: i32 = 48;
const MIN_CHROMIUM_CONTENT_WIDTH_RATIO: f32 = 0.6;
const MIN_CHROMIUM_CONTENT_HEIGHT_RATIO: f32 = 0.5;
const CHROMIUM_RENDER_WIDGET_HOST_CLASS: &str = "Chrome_RenderWidgetHostHWND";

/// Get the topmost valid window at a screen point.
///
/// Iterates through windows in z-order (front to back) and returns the first
/// valid window that contains the given point.
///
/// # Arguments
/// * `screen_x` - X coordinate in screen space
/// * `screen_y` - Y coordinate in screen space
/// * `exclude` - Window handle to exclude (typically the overlay itself)
///
/// # Returns
/// The detected window if found, or None
pub fn get_window_at_point(screen_x: i32, screen_y: i32, exclude: HWND) -> Option<DetectedWindow> {
    get_window_at_point_impl(screen_x, screen_y, exclude, false)
}

/// Get the topmost valid area target at a screen point.
///
/// Unlike window mode, area smart-select can prefer a Chromium content rect
/// when the cursor is inside the rendered page.
pub fn get_area_target_at_point(
    screen_x: i32,
    screen_y: i32,
    exclude: HWND,
) -> Option<DetectedWindow> {
    get_window_at_point_impl(screen_x, screen_y, exclude, true)
}

fn get_window_at_point_impl(
    screen_x: i32,
    screen_y: i32,
    exclude: HWND,
    prefer_chromium_content_bounds: bool,
) -> Option<DetectedWindow> {
    unsafe {
        let desktop = GetDesktopWindow();
        let mut hwnd = GetTopWindow(desktop).ok()?;

        loop {
            if hwnd.0.is_null() {
                break;
            }

            // Check if point is inside this window
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok()
                && screen_x >= rect.left
                && screen_x < rect.right
                && screen_y >= rect.top
                && screen_y < rect.bottom
            {
                if let Some(detected) = validate_window(
                    hwnd,
                    exclude,
                    screen_x,
                    screen_y,
                    prefer_chromium_content_bounds,
                ) {
                    return Some(detected);
                }
            }

            // Next window in z-order
            hwnd = match GetWindow(hwnd, GW_HWNDNEXT) {
                Ok(next) if !next.0.is_null() => next,
                _ => break,
            };
        }

        None
    }
}

/// Validate that a window is suitable for capture.
///
/// Filters out:
/// - The overlay window itself
/// - Invisible windows
/// - Child windows
/// - Tool windows (unless they have WS_EX_APPWINDOW)
/// - Very small windows (< 50x50)
fn validate_window(
    hwnd: HWND,
    exclude: HWND,
    screen_x: i32,
    screen_y: i32,
    prefer_chromium_content_bounds: bool,
) -> Option<DetectedWindow> {
    unsafe {
        // Skip excluded window (our overlay)
        if hwnd == exclude {
            return None;
        }

        // Must be visible
        if !IsWindowVisible(hwnd).as_bool() {
            return None;
        }

        // Get styles
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;

        // Skip child windows
        if (style & WS_CHILD.0) != 0 {
            return None;
        }

        // Skip tool windows (unless they have WS_EX_APPWINDOW)
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 && (ex_style & WS_EX_APPWINDOW.0) == 0 {
            return None;
        }

        // Skip desktop shell windows (Progman, WorkerW) - these cover the
        // work area and would prevent the "no window" fallback to full monitor bounds
        let mut class_buf = [0u16; 64];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        if class_len > 0 {
            let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);
            match class_name.as_str() {
                "Progman"
                | "WorkerW"
                | "SHELLDLL_DefView"
                | "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "Windows.UI.Core.CoreWindow"
                | "ApplicationFrameWindow" => return None,
                _ => {},
            }
        }

        // Get actual visible bounds (without shadow) using DWM
        let bounds = get_detected_bounds(hwnd, screen_x, screen_y, prefer_chromium_content_bounds)?;

        // Skip tiny windows
        if bounds.width() < MIN_DETECTED_WINDOW_SIZE || bounds.height() < MIN_DETECTED_WINDOW_SIZE {
            return None;
        }

        Some(DetectedWindow::new(hwnd, bounds))
    }
}

fn get_detected_bounds(
    hwnd: HWND,
    screen_x: i32,
    screen_y: i32,
    prefer_chromium_content_bounds: bool,
) -> Option<Rect> {
    let frame_bounds = get_window_frame_bounds(hwnd)?;
    let window_bounds = inset_window_bounds(frame_bounds, hwnd);

    if prefer_chromium_content_bounds {
        // Chromium-based browsers expose the page content as a descendant HWND.
        // Prefer that rect when the cursor is inside the rendered page so smart
        // area selection excludes the tab/address/bookmark chrome.
        get_chromium_content_bounds(hwnd, screen_x, screen_y, frame_bounds).or(Some(window_bounds))
    } else {
        Some(window_bounds)
    }
}

fn get_chromium_content_bounds(
    hwnd: HWND,
    screen_x: i32,
    screen_y: i32,
    window_bounds: Rect,
) -> Option<Rect> {
    let class_name = get_class_name(hwnd)?;
    if !class_name.starts_with("Chrome_WidgetWin_") {
        return None;
    }

    let search_point = POINT {
        x: screen_x,
        y: screen_y,
    };

    find_best_chromium_content_bounds(hwnd, search_point, window_bounds)
}

fn get_class_name(hwnd: HWND) -> Option<String> {
    unsafe {
        let mut class_buf = [0u16; 64];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        (class_len > 0).then(|| String::from_utf16_lossy(&class_buf[..class_len as usize]))
    }
}

struct ChromiumContentSearch {
    screen_point: POINT,
    window_bounds: Rect,
    best: Option<ChromiumContentCandidate>,
}

#[derive(Clone, Copy)]
struct ChromiumContentCandidate {
    bounds: Rect,
    score: i64,
}

fn find_best_chromium_content_bounds(
    hwnd: HWND,
    screen_point: POINT,
    window_bounds: Rect,
) -> Option<Rect> {
    unsafe {
        let mut search = ChromiumContentSearch {
            screen_point,
            window_bounds,
            best: None,
        };

        let _ = EnumChildWindows(
            hwnd,
            Some(enum_chromium_content_window),
            LPARAM(&mut search as *mut ChromiumContentSearch as isize),
        );

        search.best.map(|candidate| candidate.bounds)
    }
}

unsafe extern "system" fn enum_chromium_content_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam.0 as *mut ChromiumContentSearch);

    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }

    let Some(bounds) = get_client_bounds(hwnd) else {
        return BOOL(1);
    };

    if !bounds.contains(search.screen_point.x, search.screen_point.y)
        || !should_prefer_chromium_content_bounds(search.window_bounds, bounds)
    {
        return BOOL(1);
    }

    let class_name = get_class_name(hwnd).unwrap_or_default();
    let score = chromium_content_candidate_score(search.window_bounds, bounds, &class_name);
    let candidate = ChromiumContentCandidate { bounds, score };

    if search.best.is_none_or(|best| candidate.score > best.score) {
        search.best = Some(candidate);
    }

    BOOL(1)
}

fn get_client_bounds(hwnd: HWND) -> Option<Rect> {
    unsafe {
        let mut client_rect = RECT::default();
        if GetClientRect(hwnd, &mut client_rect).is_err() {
            return None;
        }

        if client_rect.right <= client_rect.left || client_rect.bottom <= client_rect.top {
            return None;
        }

        let mut top_left = POINT {
            x: client_rect.left,
            y: client_rect.top,
        };
        let mut bottom_right = POINT {
            x: client_rect.right,
            y: client_rect.bottom,
        };

        if !ClientToScreen(hwnd, &mut top_left).as_bool()
            || !ClientToScreen(hwnd, &mut bottom_right).as_bool()
        {
            return None;
        }

        Some(Rect::new(
            top_left.x,
            top_left.y,
            bottom_right.x,
            bottom_right.y,
        ))
    }
}

fn should_prefer_chromium_content_bounds(window_bounds: Rect, content_bounds: Rect) -> bool {
    if content_bounds.width() < MIN_DETECTED_WINDOW_SIZE
        || content_bounds.height() < MIN_DETECTED_WINDOW_SIZE
    {
        return false;
    }

    if content_bounds.left < window_bounds.left
        || content_bounds.top < window_bounds.top
        || content_bounds.right > window_bounds.right
        || content_bounds.bottom > window_bounds.bottom
    {
        return false;
    }

    let window_width = window_bounds.width().max(1) as f32;
    let window_height = window_bounds.height().max(1) as f32;
    let width_ratio = content_bounds.width() as f32 / window_width;
    let height_ratio = content_bounds.height() as f32 / window_height;
    let top_inset = content_bounds.top - window_bounds.top;
    let bottom_gap = window_bounds.bottom - content_bounds.bottom;

    width_ratio >= MIN_CHROMIUM_CONTENT_WIDTH_RATIO
        && height_ratio >= MIN_CHROMIUM_CONTENT_HEIGHT_RATIO
        && top_inset >= MIN_CHROMIUM_CONTENT_TOP_INSET
        && bottom_gap <= MAX_CHROMIUM_CONTENT_BOTTOM_GAP
}

fn chromium_content_candidate_score(
    window_bounds: Rect,
    content_bounds: Rect,
    class_name: &str,
) -> i64 {
    let top_inset = i64::from(content_bounds.top - window_bounds.top);
    let area = i64::from(content_bounds.width()) * i64::from(content_bounds.height());
    let class_bonus = if class_name == CHROMIUM_RENDER_WIDGET_HOST_CLASS {
        1_000_000_000_000i64
    } else {
        0
    };

    class_bonus + (top_inset * 1_000_000) - area
}

/// Get window frame bounds, preferring DWM extended frame bounds (excludes shadow).
fn get_window_frame_bounds(hwnd: HWND) -> Option<Rect> {
    unsafe {
        let mut rect = RECT::default();

        // Try DWM first for accurate bounds without shadow
        let dwm_result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        );

        // Fall back to GetWindowRect if DWM fails
        if dwm_result.is_err() && GetWindowRect(hwnd, &mut rect).is_err() {
            return None;
        }

        Some(Rect::new(rect.left, rect.top, rect.right, rect.bottom))
    }
}

/// Inset visible frame bounds to remove the thin browser/window border.
fn inset_window_bounds(frame_bounds: Rect, hwnd: HWND) -> Rect {
    let border = crate::commands::win_utils::get_visible_border_thickness(hwnd);
    Rect::new(
        frame_bounds.left + border,
        frame_bounds.top,
        frame_bounds.right - border,
        frame_bounds.bottom - border,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_null_hwnd() {
        // Should handle null handles gracefully
        let result = get_window_at_point(0, 0, HWND::default());
        // Result depends on what's at 0,0 on the test machine
        // Just verify it doesn't crash
        let _ = result;
    }

    #[test]
    fn test_exclude_self() {
        // When excluding a specific window, it shouldn't be returned
        // This is hard to test without creating actual windows
    }

    #[test]
    fn prefers_large_chromium_content_rect() {
        let window_bounds = Rect::new(0, 0, 1280, 900);
        let content_bounds = Rect::new(0, 112, 1280, 894);

        assert!(should_prefer_chromium_content_bounds(
            window_bounds,
            content_bounds
        ));
    }

    #[test]
    fn rejects_small_toolbar_rect() {
        let window_bounds = Rect::new(0, 0, 1280, 900);
        let toolbar_bounds = Rect::new(160, 72, 1120, 124);

        assert!(!should_prefer_chromium_content_bounds(
            window_bounds,
            toolbar_bounds
        ));
    }

    #[test]
    fn rejects_rect_that_reaches_window_top() {
        let window_bounds = Rect::new(0, 0, 1280, 900);
        let full_window_bounds = Rect::new(0, 0, 1280, 892);

        assert!(!should_prefer_chromium_content_bounds(
            window_bounds,
            full_window_bounds
        ));
    }

    #[test]
    fn prefers_render_widget_host_class_when_bounds_compete() {
        let window_bounds = Rect::new(0, 0, 1280, 900);
        let generic_bounds = Rect::new(0, 110, 1280, 894);
        let render_host_bounds = Rect::new(0, 111, 1280, 894);

        let generic_score = chromium_content_candidate_score(
            window_bounds,
            generic_bounds,
            "Intermediate D3D Window",
        );
        let render_host_score = chromium_content_candidate_score(
            window_bounds,
            render_host_bounds,
            CHROMIUM_RENDER_WIDGET_HOST_CLASS,
        );

        assert!(render_host_score > generic_score);
    }

    #[test]
    fn chromium_content_rect_can_extend_past_inset_frame_edges() {
        let uninset_frame_bounds = Rect::new(0, 0, 2560, 1400);
        let inset_frame_bounds = Rect::new(1, 0, 2559, 1399);
        let content_bounds = Rect::new(0, 121, 2560, 1400);

        assert!(should_prefer_chromium_content_bounds(
            uninset_frame_bounds,
            content_bounds
        ));
        assert!(!should_prefer_chromium_content_bounds(
            inset_frame_bounds,
            content_bounds
        ));
    }
}
