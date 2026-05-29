//! Layout geometry, scaling, and hit-testing for the capture overlay.
//!
//! Pure coordinate math with no Direct2D dependencies; split out of
//! `render.rs`. Drawing code lives in `overlay_draw`; the rendering entry
//! point and `RenderInfo` selection stay in `render`.

use super::state::OverlayState;
use super::types::*;

const OVERLAY_CONTROL_MAX_SCALE: f32 = 1.3;
const OVERLAY_CONTROL_COMPACT_HEIGHT: f32 = 1440.0;
const OVERLAY_CONTROL_REFERENCE_HEIGHT: f32 = 2160.0;
const OVERLAY_CONTROL_COMPACT_MAX_SCALE: f32 = 1.12;

pub fn recording_mode_chooser_rect(state: &OverlayState) -> Option<Rect> {
    state.recording_mode_chooser.as_ref()?;

    let selection = state.get_local_selection()?;
    let (selection_center_x, selection_center_y) = selection.center();
    let metrics = RecordingModeChooserMetrics::for_state(state);
    let width = metrics.width;
    let height = metrics.height;

    let max_left = state.monitor.width as i32 - width - metrics.margin;
    let max_top = state.monitor.height as i32 - height - metrics.margin;
    let left = (selection_center_x - width / 2).clamp(metrics.margin, max_left.max(metrics.margin));
    let top = (selection_center_y - height / 2).clamp(metrics.margin, max_top.max(metrics.margin));

    Some(Rect::new(left, top, left + width, top + height))
}

#[derive(Debug, Clone, Copy)]
pub(super) struct RecordingModeChooserMetrics {
    pub(super) scale: f32,
    pub(super) width: i32,
    pub(super) height: i32,
    pub(super) margin: i32,
    pub(super) back_size: i32,
}

impl RecordingModeChooserMetrics {
    pub(super) fn for_state(state: &OverlayState) -> Self {
        let scale = recording_mode_chooser_scale(state);
        Self {
            scale,
            width: scaled_i32(RECORDING_MODE_CHOOSER_WIDTH, scale),
            height: scaled_i32(RECORDING_MODE_CHOOSER_HEIGHT, scale),
            margin: scaled_i32(RECORDING_MODE_CHOOSER_MARGIN, scale),
            back_size: scaled_i32(RECORDING_MODE_CHOOSER_BACK_SIZE, scale),
        }
    }

    pub(super) fn from_shell(shell: Rect) -> Self {
        let scale = (shell.width() as f32 / RECORDING_MODE_CHOOSER_WIDTH as f32)
            .clamp(1.0, OVERLAY_CONTROL_MAX_SCALE);
        Self {
            scale,
            width: shell.width() as i32,
            height: shell.height() as i32,
            margin: scaled_i32(RECORDING_MODE_CHOOSER_MARGIN, scale),
            back_size: scaled_i32(RECORDING_MODE_CHOOSER_BACK_SIZE, scale),
        }
    }

    pub(super) fn s(&self, value: i32) -> i32 {
        scaled_i32(value, self.scale)
    }

    pub(super) fn sf(&self, value: f32) -> f32 {
        value * self.scale
    }
}

pub(super) fn scaled_i32(value: i32, scale: f32) -> i32 {
    ((value as f32) * scale).round() as i32
}

fn overlay_control_scale(state: &OverlayState) -> f32 {
    let Some(selection) = state.get_local_selection() else {
        return 1.0;
    };

    let (center_x, center_y) = selection.center();
    let screen_center = state
        .monitor
        .local_to_screen(Point::new(center_x, center_y));

    let mut dpi_scale = 1.0_f32;
    let mut resolution_scale = (state.monitor.height as f32 / 1080.0).max(1.0);
    let mut physical_height = state.monitor.height as f32;

    if let Ok(monitors) = xcap::Monitor::all() {
        for monitor in monitors {
            let left = monitor.x().unwrap_or(0);
            let top = monitor.y().unwrap_or(0);
            let width = monitor.width().unwrap_or(0);
            let height = monitor.height().unwrap_or(0);
            let right = left + width as i32;
            let bottom = top + height as i32;

            if screen_center.x >= left
                && screen_center.x < right
                && screen_center.y >= top
                && screen_center.y < bottom
            {
                dpi_scale = monitor.scale_factor().unwrap_or(1.0).max(1.0);
                resolution_scale = (height as f32 / 1080.0).max(1.0);
                physical_height = height as f32;
                break;
            }
        }
    }

    overlay_control_scale_for_metrics(dpi_scale, resolution_scale, physical_height)
}

fn overlay_control_scale_for_metrics(
    dpi_scale: f32,
    resolution_scale: f32,
    physical_height: f32,
) -> f32 {
    let max_scale = overlay_control_max_scale_for_height(physical_height);

    dpi_scale.max(resolution_scale).clamp(1.0, max_scale)
}

fn overlay_control_max_scale_for_height(physical_height: f32) -> f32 {
    if !physical_height.is_finite() || physical_height <= 0.0 {
        return OVERLAY_CONTROL_MAX_SCALE;
    }

    if physical_height <= OVERLAY_CONTROL_COMPACT_HEIGHT {
        return OVERLAY_CONTROL_COMPACT_MAX_SCALE;
    }

    if physical_height >= OVERLAY_CONTROL_REFERENCE_HEIGHT {
        return OVERLAY_CONTROL_MAX_SCALE;
    }

    let progress = (physical_height - OVERLAY_CONTROL_COMPACT_HEIGHT)
        / (OVERLAY_CONTROL_REFERENCE_HEIGHT - OVERLAY_CONTROL_COMPACT_HEIGHT);

    OVERLAY_CONTROL_COMPACT_MAX_SCALE
        + (OVERLAY_CONTROL_MAX_SCALE - OVERLAY_CONTROL_COMPACT_MAX_SCALE) * progress
}

fn recording_mode_chooser_scale(state: &OverlayState) -> f32 {
    overlay_control_scale(state)
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

    if recording_mode_chooser_back_rect(shell).contains(x, y) {
        return RecordingModeChooserHitTarget::Back;
    }

    if recording_mode_chooser_quick_rect(shell).contains(x, y) {
        return RecordingModeChooserHitTarget::Quick;
    }

    if recording_mode_chooser_studio_rect(shell).contains(x, y) {
        return RecordingModeChooserHitTarget::Studio;
    }

    if recording_mode_chooser_remember_rect(shell).contains(x, y) {
        return RecordingModeChooserHitTarget::Remember;
    }

    RecordingModeChooserHitTarget::Shell
}

pub(super) fn recording_mode_chooser_back_rect(shell: Rect) -> Rect {
    let metrics = RecordingModeChooserMetrics::from_shell(shell);
    Rect::new(
        shell.left + metrics.s(12),
        shell.top + metrics.s(12),
        shell.left + metrics.s(12) + metrics.back_size,
        shell.top + metrics.s(12) + metrics.back_size,
    )
}

pub(super) fn recording_mode_chooser_quick_rect(shell: Rect) -> Rect {
    let metrics = RecordingModeChooserMetrics::from_shell(shell);
    Rect::new(
        shell.left + metrics.s(18),
        shell.top + metrics.s(60),
        shell.left + metrics.s(251),
        shell.top + metrics.s(132),
    )
}

pub(super) fn recording_mode_chooser_studio_rect(shell: Rect) -> Rect {
    let metrics = RecordingModeChooserMetrics::from_shell(shell);
    Rect::new(
        shell.left + metrics.s(269),
        shell.top + metrics.s(60),
        shell.right - metrics.s(18),
        shell.top + metrics.s(132),
    )
}

pub(super) fn recording_mode_chooser_remember_rect(shell: Rect) -> Rect {
    let metrics = RecordingModeChooserMetrics::from_shell(shell);
    Rect::new(
        shell.left + metrics.s(18),
        shell.top + metrics.s(146),
        shell.right - metrics.s(18),
        shell.top + metrics.s(176),
    )
}

pub fn selection_hud_rect(state: &OverlayState) -> Option<Rect> {
    if state.recording_mode_chooser.is_some() {
        return None;
    }

    state.selection_hud.as_ref()?;

    let selection = state.get_local_selection()?;
    let monitor_bounds = selection_monitor_local_rect(state, selection);
    let (selection_center_x, _) = selection.center();
    let metrics = SelectionHudMetrics::for_state(state);
    let width = metrics.width;
    let height = metrics.height;

    let min_left = monitor_bounds.left + metrics.margin;
    let max_left = monitor_bounds.right - width - metrics.margin;
    let preferred_left = selection_center_x - width / 2;
    let left = if min_left <= max_left {
        preferred_left.clamp(min_left, max_left)
    } else {
        monitor_bounds.left + (monitor_bounds.width() as i32 - width) / 2
    };

    let below = selection.bottom + metrics.margin;
    let above = selection.top - metrics.margin - height;
    let min_top = monitor_bounds.top + metrics.margin;
    let max_top = monitor_bounds.bottom - height - metrics.margin;
    let top = if below <= max_top {
        below.max(min_top)
    } else if above >= min_top {
        above.min(max_top)
    } else {
        let inside_bottom = selection.bottom - height - metrics.margin;
        inside_bottom.clamp(min_top, max_top.max(min_top))
    };

    Some(Rect::new(left, top, left + width, top + height))
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SelectionHudMetrics {
    pub(super) scale: f32,
    pub(super) width: i32,
    pub(super) height: i32,
    pub(super) margin: i32,
    pub(super) button_top: i32,
    pub(super) button_height: i32,
    pub(super) button_gap: i32,
    pub(super) step_button_width: i32,
}

impl SelectionHudMetrics {
    pub(super) fn for_state(state: &OverlayState) -> Self {
        let scale = overlay_control_scale(state);
        Self::new(scale)
    }

    pub(super) fn from_shell(shell: Rect) -> Self {
        let scale = (shell.width() as f32 / SELECTION_HUD_WIDTH as f32)
            .clamp(1.0, OVERLAY_CONTROL_MAX_SCALE);
        Self::new(scale)
    }

    pub(super) fn new(scale: f32) -> Self {
        Self {
            scale,
            width: scaled_i32(SELECTION_HUD_WIDTH, scale),
            height: scaled_i32(SELECTION_HUD_HEIGHT, scale),
            margin: scaled_i32(SELECTION_HUD_MARGIN, scale),
            button_top: scaled_i32(SELECTION_HUD_BUTTON_TOP, scale),
            button_height: scaled_i32(SELECTION_HUD_BUTTON_HEIGHT, scale),
            button_gap: scaled_i32(SELECTION_HUD_BUTTON_GAP, scale),
            step_button_width: scaled_i32(SELECTION_HUD_STEP_BUTTON_WIDTH, scale),
        }
    }

    pub(super) fn s(&self, value: i32) -> i32 {
        scaled_i32(value, self.scale)
    }

    pub(super) fn sf(&self, value: f32) -> f32 {
        value * self.scale
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SelectionHudButtonRects {
    pub(super) back: Rect,
    pub(super) preset: Rect,
    pub(super) width: Rect,
    pub(super) height: Rect,
    pub(super) save: Rect,
    pub(super) capture: Rect,
    pub(super) cancel: Rect,
}

pub(super) fn selection_hud_button_rects(shell: Rect) -> SelectionHudButtonRects {
    let metrics = SelectionHudMetrics::from_shell(shell);
    let button_top = shell.top + metrics.button_top;
    let button_bottom = button_top + metrics.button_height;
    let back = Rect::new(
        shell.left + metrics.s(10),
        button_top,
        shell.left + metrics.s(10) + metrics.s(SELECTION_HUD_BACK_WIDTH),
        button_bottom,
    );
    let preset = Rect::new(
        back.right + metrics.button_gap,
        button_top,
        back.right + metrics.button_gap + metrics.s(SELECTION_HUD_PRESET_WIDTH),
        button_bottom,
    );
    let width = Rect::new(
        preset.right + metrics.button_gap,
        button_top,
        preset.right + metrics.button_gap + metrics.s(SELECTION_HUD_DIMENSION_WIDTH),
        button_bottom,
    );
    let height = Rect::new(
        width.right + metrics.button_gap,
        button_top,
        width.right + metrics.button_gap + metrics.s(SELECTION_HUD_DIMENSION_WIDTH),
        button_bottom,
    );
    let save = Rect::new(
        height.right + metrics.button_gap,
        button_top,
        height.right + metrics.button_gap + metrics.s(SELECTION_HUD_SAVE_WIDTH),
        button_bottom,
    );
    let cancel = Rect::new(
        shell.right - metrics.s(10) - metrics.s(SELECTION_HUD_CANCEL_WIDTH),
        button_top,
        shell.right - metrics.s(10),
        button_bottom,
    );
    let capture = Rect::new(
        cancel.left - metrics.button_gap - metrics.s(SELECTION_HUD_CAPTURE_WIDTH),
        button_top,
        cancel.left - metrics.button_gap,
        button_bottom,
    );

    SelectionHudButtonRects {
        back,
        preset,
        width,
        height,
        save,
        capture,
        cancel,
    }
}

fn selection_monitor_local_rect(state: &OverlayState, selection: Rect) -> Rect {
    let fallback = Rect::from_xywh(0, 0, state.monitor.width, state.monitor.height);
    let (center_x, center_y) = selection.center();
    let screen_center = state
        .monitor
        .local_to_screen(Point::new(center_x, center_y));

    let Ok(monitors) = xcap::Monitor::all() else {
        return fallback;
    };

    let Some(monitor) = monitors.iter().find(|monitor| {
        let left = monitor.x().unwrap_or(0);
        let top = monitor.y().unwrap_or(0);
        let right = left + monitor.width().unwrap_or(0) as i32;
        let bottom = top + monitor.height().unwrap_or(0) as i32;

        screen_center.x >= left
            && screen_center.x < right
            && screen_center.y >= top
            && screen_center.y < bottom
    }) else {
        return fallback;
    };

    let screen_rect = Rect::from_xywh(
        monitor.x().unwrap_or(state.monitor.x),
        monitor.y().unwrap_or(state.monitor.y),
        monitor.width().unwrap_or(state.monitor.width),
        monitor.height().unwrap_or(state.monitor.height),
    );
    state.monitor.screen_rect_to_local(screen_rect)
}

pub fn hit_test_selection_hud(state: &OverlayState, x: i32, y: i32) -> SelectionHudHitTarget {
    let Some(shell) = selection_hud_rect(state) else {
        return SelectionHudHitTarget::None;
    };
    if !shell.contains(x, y) {
        return SelectionHudHitTarget::None;
    }

    let metrics = SelectionHudMetrics::from_shell(shell);
    let rects = selection_hud_button_rects(shell);

    if rects.back.contains(x, y) {
        return SelectionHudHitTarget::Back;
    }

    if rects.preset.contains(x, y) {
        return SelectionHudHitTarget::Preset;
    }

    if rects.width.contains(x, y) {
        if x < rects.width.left + metrics.step_button_width {
            return SelectionHudHitTarget::WidthDown;
        }
        if x >= rects.width.right - metrics.step_button_width {
            return SelectionHudHitTarget::WidthUp;
        }
        return SelectionHudHitTarget::WidthInput;
    }

    if rects.height.contains(x, y) {
        if x < rects.height.left + metrics.step_button_width {
            return SelectionHudHitTarget::HeightDown;
        }
        if x >= rects.height.right - metrics.step_button_width {
            return SelectionHudHitTarget::HeightUp;
        }
        return SelectionHudHitTarget::HeightInput;
    }

    if rects.save.contains(x, y) {
        return SelectionHudHitTarget::Save;
    }

    if rects.cancel.contains(x, y) {
        return SelectionHudHitTarget::Cancel;
    }

    if rects.capture.contains(x, y) {
        return SelectionHudHitTarget::Capture;
    }

    SelectionHudHitTarget::Shell
}

pub fn selection_hud_area_button_rect(state: &OverlayState) -> Option<Rect> {
    let shell = selection_hud_rect(state)?;
    Some(selection_hud_button_rects(shell).save)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooser_metrics_scale_all_hit_targets_from_shell_width() {
        let shell = Rect::new(100, 80, 776, 330);
        let metrics = RecordingModeChooserMetrics::from_shell(shell);

        assert!((metrics.scale - OVERLAY_CONTROL_MAX_SCALE).abs() < f32::EPSILON);
        assert_eq!(
            recording_mode_chooser_back_rect(shell),
            Rect::new(116, 96, 160, 140)
        );
        assert_eq!(
            recording_mode_chooser_quick_rect(shell),
            Rect::new(123, 158, 426, 252)
        );
        assert_eq!(
            recording_mode_chooser_studio_rect(shell),
            Rect::new(450, 158, 753, 252)
        );
        assert_eq!(
            recording_mode_chooser_remember_rect(shell),
            Rect::new(123, 270, 753, 309)
        );
    }

    #[test]
    fn selection_hud_metrics_scale_all_button_rects_from_shell_width() {
        let shell = Rect::new(100, 80, 958, 150);
        let metrics = SelectionHudMetrics::from_shell(shell);
        let rects = selection_hud_button_rects(shell);

        assert!((metrics.scale - OVERLAY_CONTROL_MAX_SCALE).abs() < f32::EPSILON);
        assert_eq!(rects.back, Rect::new(113, 93, 188, 137));
        assert_eq!(rects.preset, Rect::new(198, 93, 292, 137));
        assert_eq!(rects.width, Rect::new(302, 93, 458, 137));
        assert_eq!(rects.height, Rect::new(468, 93, 624, 137));
        assert_eq!(rects.save, Rect::new(634, 93, 712, 137));
        assert_eq!(rects.capture, Rect::new(727, 93, 841, 137));
        assert_eq!(rects.cancel, Rect::new(851, 93, 945, 137));
    }

    #[test]
    fn overlay_control_scale_keeps_4k_size() {
        let scale = overlay_control_scale_for_metrics(1.5, 2.0, 2160.0);

        assert!((scale - OVERLAY_CONTROL_MAX_SCALE).abs() < f32::EPSILON);
    }

    #[test]
    fn overlay_control_scale_caps_2k_size() {
        let scale = overlay_control_scale_for_metrics(1.5, 1440.0 / 1080.0, 1440.0);

        assert!((scale - OVERLAY_CONTROL_COMPACT_MAX_SCALE).abs() < f32::EPSILON);
    }

    #[test]
    fn overlay_control_scale_interpolates_between_2k_and_4k() {
        let scale = overlay_control_scale_for_metrics(1.5, 1800.0 / 1080.0, 1800.0);

        assert!((scale - 1.21).abs() < 0.001);
    }
}
