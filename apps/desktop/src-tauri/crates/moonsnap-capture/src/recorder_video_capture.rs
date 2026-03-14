//! Shared capture planning/opening helpers for video recording.

use crate::capture_source::{CaptureSource, CapturedFrame};
use crate::recording_runtime::find_monitor_for_point;
use moonsnap_capture_types::recording::RecordingMode;

/// Planned capture selection derived from recording mode.
#[derive(Debug, Clone, Copy)]
pub struct CapturePlan {
    /// Window handle for native window capture.
    pub window_id: Option<u32>,
    /// Region capture rectangle in screen coordinates.
    pub crop_region: Option<(i32, i32, u32, u32)>,
    /// Monitor index for monitor/region capture.
    pub monitor_index: usize,
    /// Monitor screen-space offset used to convert region coordinates.
    pub monitor_offset: (i32, i32),
}

impl CapturePlan {
    /// Build capture plan from recording mode.
    pub fn from_mode(mode: &RecordingMode) -> Self {
        let window_id = match mode {
            RecordingMode::Window { window_id } => Some(*window_id),
            _ => None,
        };

        let crop_region = match mode {
            RecordingMode::Region {
                x,
                y,
                width,
                height,
            } => Some((*x, *y, *width, *height)),
            _ => None,
        };

        let (monitor_index, monitor_offset) = match mode {
            RecordingMode::Monitor { monitor_index } => (*monitor_index, (0, 0)),
            RecordingMode::Region { x, y, .. } => {
                if let Some((idx, name, mx, my)) = find_monitor_for_point(*x, *y) {
                    log::info!(
                        "[CAPTURE] Region ({}, {}) is on monitor {} '{}' at offset ({}, {})",
                        x,
                        y,
                        idx,
                        &name,
                        mx,
                        my
                    );

                    (idx, (mx, my))
                } else {
                    (0, (0, 0))
                }
            },
            _ => (0, (0, 0)),
        };

        Self {
            window_id,
            crop_region,
            monitor_index,
            monitor_offset,
        }
    }
}

pub type FirstCaptureFrame = (u32, u32, CapturedFrame);
pub type CaptureSourceInit = (CaptureSource, Option<FirstCaptureFrame>);

/// Create capture source from a plan and wait for first frame.
pub fn create_capture_source(
    plan: &CapturePlan,
    fps: u32,
    include_cursor: bool,
) -> Result<CaptureSourceInit, String> {
    if let Some(wid) = plan.window_id {
        log::debug!("[CAPTURE] Using Scap window capture for hwnd={}", wid);
        let source = CaptureSource::new_window(wid, include_cursor)
            .map_err(|e| format!("Failed to create Scap window capture: {}", e))?;

        let first_frame = source.wait_for_first_frame(1000);
        Ok((source, first_frame))
    } else if let Some((x, y, w, h)) = plan.crop_region {
        log::debug!(
            "[CAPTURE] Using WGC region capture: ({}, {}) {}x{} on monitor {} (offset {:?})",
            x,
            y,
            w,
            h,
            plan.monitor_index,
            plan.monitor_offset
        );
        let source = CaptureSource::new_region(
            plan.monitor_index,
            (x, y, w, h),
            plan.monitor_offset,
            fps,
            include_cursor,
        )
        .map_err(|e| format!("Failed to create WGC region capture: {}", e))?;

        let first_frame = source.wait_for_first_frame(1000);
        Ok((source, first_frame))
    } else {
        log::debug!(
            "[CAPTURE] Using Scap monitor capture, index={}",
            plan.monitor_index
        );
        let source = CaptureSource::new_monitor(plan.monitor_index, include_cursor)
            .map_err(|e| format!("Failed to create Scap capture: {}", e))?;

        let first_frame = source.wait_for_first_frame(1000);
        Ok((source, first_frame))
    }
}

/// Resolve final capture dimensions from first-frame probe + mode fallback.
pub fn resolve_capture_dimensions(
    plan: &CapturePlan,
    first_frame_dims: Option<(u32, u32)>,
    source_fallback: (u32, u32),
) -> (u32, u32) {
    if let Some((w, h)) = first_frame_dims {
        (w, h)
    } else if let Some((_, _, w, h)) = plan.crop_region {
        (w, h)
    } else {
        source_fallback
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_capture_dimensions, CapturePlan};
    use moonsnap_capture_types::recording::RecordingMode;

    #[test]
    fn capture_plan_from_window_mode() {
        let plan = CapturePlan::from_mode(&RecordingMode::Window { window_id: 42 });
        assert_eq!(plan.window_id, Some(42));
        assert_eq!(plan.crop_region, None);
        assert_eq!(plan.monitor_index, 0);
        assert_eq!(plan.monitor_offset, (0, 0));
    }

    #[test]
    fn capture_plan_from_monitor_mode() {
        let plan = CapturePlan::from_mode(&RecordingMode::Monitor { monitor_index: 3 });
        assert_eq!(plan.window_id, None);
        assert_eq!(plan.crop_region, None);
        assert_eq!(plan.monitor_index, 3);
        assert_eq!(plan.monitor_offset, (0, 0));
    }

    #[test]
    fn capture_plan_from_region_mode_preserves_crop() {
        let plan = CapturePlan::from_mode(&RecordingMode::Region {
            x: 100,
            y: 200,
            width: 1280,
            height: 720,
        });
        assert_eq!(plan.window_id, None);
        assert_eq!(plan.crop_region, Some((100, 200, 1280, 720)));
    }

    #[test]
    fn dimensions_prefer_first_frame() {
        let plan = CapturePlan {
            window_id: None,
            crop_region: Some((10, 20, 1920, 1080)),
            monitor_index: 0,
            monitor_offset: (0, 0),
        };
        let dims = resolve_capture_dimensions(&plan, Some((640, 480)), (800, 600));
        assert_eq!(dims, (640, 480));
    }

    #[test]
    fn dimensions_fallback_to_crop_region() {
        let plan = CapturePlan {
            window_id: None,
            crop_region: Some((10, 20, 1920, 1080)),
            monitor_index: 0,
            monitor_offset: (0, 0),
        };
        let dims = resolve_capture_dimensions(&plan, None, (800, 600));
        assert_eq!(dims, (1920, 1080));
    }

    #[test]
    fn dimensions_fallback_to_source_dims() {
        let plan = CapturePlan {
            window_id: Some(5),
            crop_region: None,
            monitor_index: 0,
            monitor_offset: (0, 0),
        };
        let dims = resolve_capture_dimensions(&plan, None, (1280, 720));
        assert_eq!(dims, (1280, 720));
    }
}
