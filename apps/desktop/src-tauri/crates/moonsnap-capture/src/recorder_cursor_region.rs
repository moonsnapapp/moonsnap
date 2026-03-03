//! Shared cursor-region resolution for recording modes.
//!
//! Keeps capture-mode interpretation in `moonsnap-capture` while allowing the app shell
//! to inject platform/app-specific lookups (window rect + monitor bounds).

use moonsnap_domain::recording::RecordingMode;

/// Cursor normalization region in screen coordinates `(x, y, width, height)`.
pub type CursorRegion = (i32, i32, u32, u32);

/// Resolve cursor normalization region from recording mode.
///
/// Returns `None` for all-monitors mode, where cursor coordinates are interpreted
/// against the virtual desktop.
pub fn resolve_cursor_region<FWindow, FMonitor>(
    mode: &RecordingMode,
    monitor_offset: (i32, i32),
    mut get_window_rect: FWindow,
    mut get_monitor_bounds: FMonitor,
) -> Option<CursorRegion>
where
    FWindow: FnMut(u32) -> Result<CursorRegion, String>,
    FMonitor: FnMut(usize) -> Option<CursorRegion>,
{
    match mode {
        RecordingMode::Region {
            x,
            y,
            width,
            height,
        } => {
            log::info!(
                "[CAPTURE] Region mode - screen coords: ({}, {}) {}x{}, monitor_offset: ({}, {})",
                x,
                y,
                width,
                height,
                monitor_offset.0,
                monitor_offset.1
            );
            Some((*x, *y, *width, *height))
        },
        RecordingMode::Window { window_id } => match get_window_rect(*window_id) {
            Ok((x, y, w, h)) => {
                log::debug!(
                    "[CAPTURE] Window mode cursor region: ({}, {}) {}x{}",
                    x,
                    y,
                    w,
                    h
                );
                Some((x, y, w, h))
            },
            Err(e) => {
                log::warn!("[CAPTURE] Could not get window rect for cursor: {}", e);
                None
            },
        },
        RecordingMode::Monitor { monitor_index } => get_monitor_bounds(*monitor_index)
            .map(|(x, y, w, h)| {
                log::debug!(
                    "[CAPTURE] Monitor mode cursor region (from scap): ({}, {}) {}x{} (monitor {})",
                    x,
                    y,
                    w,
                    h,
                    monitor_index
                );
                (x, y, w, h)
            })
            .or_else(|| {
                log::warn!(
                    "[CAPTURE] Monitor {} not found in scap, cursor coordinates may be incorrect",
                    monitor_index
                );
                None
            }),
        RecordingMode::AllMonitors => {
            log::debug!("[CAPTURE] AllMonitors mode - cursor region spans virtual screen");
            None
        },
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_cursor_region;
    use moonsnap_domain::recording::RecordingMode;
    use std::cell::Cell;

    #[test]
    fn region_mode_returns_exact_region() {
        let mode = RecordingMode::Region {
            x: 10,
            y: 20,
            width: 1280,
            height: 720,
        };

        let region = resolve_cursor_region(
            &mode,
            (0, 0),
            |_window_id| Err("unused".to_string()),
            |_monitor| None,
        );

        assert_eq!(region, Some((10, 20, 1280, 720)));
    }

    #[test]
    fn window_mode_uses_window_lookup() {
        let mode = RecordingMode::Window { window_id: 77 };
        let called = Cell::new(false);

        let region = resolve_cursor_region(
            &mode,
            (0, 0),
            |window_id| {
                called.set(true);
                assert_eq!(window_id, 77);
                Ok((1, 2, 3, 4))
            },
            |_monitor| None,
        );

        assert!(called.get());
        assert_eq!(region, Some((1, 2, 3, 4)));
    }

    #[test]
    fn window_mode_returns_none_on_lookup_error() {
        let mode = RecordingMode::Window { window_id: 77 };

        let region = resolve_cursor_region(
            &mode,
            (0, 0),
            |_window_id| Err("not found".to_string()),
            |_monitor| None,
        );

        assert_eq!(region, None);
    }

    #[test]
    fn monitor_mode_uses_monitor_lookup() {
        let mode = RecordingMode::Monitor { monitor_index: 2 };
        let called = Cell::new(false);

        let region = resolve_cursor_region(
            &mode,
            (0, 0),
            |_window_id| Err("unused".to_string()),
            |monitor_index| {
                called.set(true);
                assert_eq!(monitor_index, 2);
                Some((11, 22, 333, 444))
            },
        );

        assert!(called.get());
        assert_eq!(region, Some((11, 22, 333, 444)));
    }

    #[test]
    fn monitor_mode_returns_none_when_missing() {
        let mode = RecordingMode::Monitor { monitor_index: 0 };

        let region = resolve_cursor_region(
            &mode,
            (0, 0),
            |_window_id| Err("unused".to_string()),
            |_monitor_index| None,
        );

        assert_eq!(region, None);
    }

    #[test]
    fn all_monitors_mode_returns_none() {
        let mode = RecordingMode::AllMonitors;

        let region = resolve_cursor_region(
            &mode,
            (0, 0),
            |_window_id| Err("unused".to_string()),
            |_monitor| None,
        );

        assert_eq!(region, None);
    }
}
