//! Runtime recording helpers that are not domain DTOs.

/// Monitor information from Windows API.
/// Used to get monitor positions for coordinate conversion.
#[derive(Debug, Clone)]
pub struct MonitorBounds {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Get all monitors with their bounds using Windows API.
/// This replaces xcap for monitor enumeration in video recording.
#[cfg(target_os = "windows")]
pub fn get_monitor_bounds() -> Vec<MonitorBounds> {
    use std::mem;
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
    };

    let mut monitors: Vec<MonitorBounds> = Vec::new();

    unsafe extern "system" fn enum_callback(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let monitors = &mut *(lparam.0 as *mut Vec<MonitorBounds>);

        let mut info: MONITORINFOEXW = mem::zeroed();
        info.monitorInfo.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;

        if GetMonitorInfoW(hmonitor, &mut info as *mut _ as *mut _).as_bool() {
            let rect = info.monitorInfo.rcMonitor;
            let name = String::from_utf16_lossy(
                &info.szDevice[..info.szDevice.iter().position(|&c| c == 0).unwrap_or(0)],
            );

            monitors.push(MonitorBounds {
                name,
                x: rect.left,
                y: rect.top,
                width: (rect.right - rect.left) as u32,
                height: (rect.bottom - rect.top) as u32,
            });
        }

        BOOL(1)
    }

    unsafe {
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_callback),
            LPARAM(&mut monitors as *mut _ as isize),
        );
    }

    monitors
}

#[cfg(not(target_os = "windows"))]
pub fn get_monitor_bounds() -> Vec<MonitorBounds> {
    Vec::new()
}

/// Find which monitor contains the given point.
/// Returns (monitor_index, monitor_name, monitor_offset_x, monitor_offset_y).
pub fn find_monitor_for_point(x: i32, y: i32) -> Option<(usize, String, i32, i32)> {
    let monitors = get_monitor_bounds();

    for (idx, m) in monitors.into_iter().enumerate() {
        let mx = m.x;
        let my = m.y;
        let mw = m.width as i32;
        let mh = m.height as i32;

        if x >= mx && x < mx + mw && y >= my && y < my + mh {
            return Some((idx, m.name, mx, my));
        }
    }
    None
}

/// Get display bounds (x, y, width, height) using scap-targets display enumeration.
/// This ensures monitor_index refers to the same physical display that D3D captures.
/// CRITICAL: Always use this for cursor regions in Monitor mode to avoid offset issues.
pub fn get_scap_display_bounds(monitor_index: usize) -> Option<(i32, i32, u32, u32)> {
    // Delegate to d3d capture helper which uses scap-targets.
    crate::d3d_capture::get_display_bounds(monitor_index)
}
