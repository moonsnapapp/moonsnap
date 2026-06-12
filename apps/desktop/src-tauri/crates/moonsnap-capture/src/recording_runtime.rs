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

/// Display bounds from scap-targets enumeration.
///
/// The index matches the display index consumed by D3D capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScapDisplayBounds {
    pub index: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl ScapDisplayBounds {
    pub fn contains_region(&self, x: i32, y: i32, width: u32, height: u32) -> bool {
        if width == 0 || height == 0 {
            return false;
        }

        let left = x as i64;
        let top = y as i64;
        let right = left + width as i64;
        let bottom = top + height as i64;
        let display_left = self.x as i64;
        let display_top = self.y as i64;
        let display_right = display_left + self.width as i64;
        let display_bottom = display_top + self.height as i64;

        left >= display_left
            && top >= display_top
            && right <= display_right
            && bottom <= display_bottom
    }
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

/// List display bounds using scap-targets, preserving indices used by D3D capture.
pub fn list_scap_display_bounds() -> Vec<ScapDisplayBounds> {
    scap_targets::Display::list()
        .into_iter()
        .enumerate()
        .filter_map(|(index, display)| {
            let bounds = display.physical_bounds()?;
            Some(ScapDisplayBounds {
                index,
                x: bounds.position().x() as i32,
                y: bounds.position().y() as i32,
                width: bounds.size().width() as u32,
                height: bounds.size().height() as u32,
            })
        })
        .collect()
}

/// Find the scap display that fully contains a screen-space region.
pub fn find_scap_display_for_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Option<ScapDisplayBounds> {
    list_scap_display_bounds()
        .into_iter()
        .find(|display| display.contains_region(x, y, width, height))
}

/// Get display bounds (x, y, width, height) using scap-targets display enumeration.
/// This ensures monitor_index refers to the same physical display that D3D captures.
/// CRITICAL: Always use this for cursor regions in Monitor mode to avoid offset issues.
pub fn get_scap_display_bounds(monitor_index: usize) -> Option<(i32, i32, u32, u32)> {
    // Delegate to d3d capture helper which uses scap-targets.
    crate::d3d_capture::get_display_bounds(monitor_index)
}
