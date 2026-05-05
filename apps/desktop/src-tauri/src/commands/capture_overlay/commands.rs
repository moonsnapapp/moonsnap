//! Tauri commands for toolbar <-> overlay communication.
//!
//! These commands are called from the React toolbar window to control
//! the overlay (confirm selection, cancel, reselect).
//!
//! Communication uses an atomic pending command that the overlay polls.

use moonsnap_core::error::MoonSnapResult;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU32, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use super::types::OverlayCommand;

/// Highlighted monitor index (-1 = none, use cursor position)
static HIGHLIGHTED_MONITOR: AtomicI32 = AtomicI32::new(-1);

/// Highlighted window HWND (0 = none, use cursor position)
static HIGHLIGHTED_WINDOW: AtomicIsize = AtomicIsize::new(0);

/// Global pending command for the overlay.
///
/// The overlay polls this in its message loop to check for commands
/// from the toolbar.
static PENDING_COMMAND: AtomicU8 = AtomicU8::new(0);

/// Pending dimensions for SetDimensions command
static PENDING_WIDTH: AtomicU32 = AtomicU32::new(0);
static PENDING_HEIGHT: AtomicU32 = AtomicU32::new(0);
static PENDING_MOVE_X: AtomicI32 = AtomicI32::new(0);
static PENDING_MOVE_Y: AtomicI32 = AtomicI32::new(0);
static D2D_CHOOSER_REQUEST: OnceLock<Mutex<Option<D2DRecordingModeChooserRequest>>> =
    OnceLock::new();
static D2D_CHOOSER_CLOSE_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone)]
pub struct D2DRecordingModeChooserRequest {
    pub owner: String,
    pub allow_drag: bool,
}

fn d2d_chooser_request() -> &'static Mutex<Option<D2DRecordingModeChooserRequest>> {
    D2D_CHOOSER_REQUEST.get_or_init(|| Mutex::new(None))
}

/// Get and clear the pending command.
///
/// Returns the current pending command and resets it to None.
/// This is called by the overlay's message loop.
pub fn take_pending_command() -> OverlayCommand {
    OverlayCommand::from(PENDING_COMMAND.swap(0, Ordering::SeqCst))
}

/// Get and clear pending dimensions.
///
/// Returns the pending width and height, then clears them.
/// Should be called when handling SetDimensions command.
pub fn take_pending_dimensions() -> (u32, u32) {
    let width = PENDING_WIDTH.swap(0, Ordering::SeqCst);
    let height = PENDING_HEIGHT.swap(0, Ordering::SeqCst);
    (width, height)
}

/// Get and clear the pending move delta.
pub fn take_pending_move_delta() -> (i32, i32) {
    let dx = PENDING_MOVE_X.swap(0, Ordering::SeqCst);
    let dy = PENDING_MOVE_Y.swap(0, Ordering::SeqCst);
    (dx, dy)
}

pub fn request_d2d_recording_mode_chooser(owner: String, allow_drag: bool) {
    if let Ok(mut request) = d2d_chooser_request().lock() {
        *request = Some(D2DRecordingModeChooserRequest { owner, allow_drag });
    }
}

pub fn take_d2d_recording_mode_chooser_request() -> Option<D2DRecordingModeChooserRequest> {
    d2d_chooser_request()
        .lock()
        .ok()
        .and_then(|mut request| request.take())
}

pub fn close_d2d_recording_mode_chooser() {
    D2D_CHOOSER_CLOSE_REQUESTED.store(true, Ordering::SeqCst);
    if let Ok(mut request) = d2d_chooser_request().lock() {
        *request = None;
    }
}

pub fn take_d2d_recording_mode_chooser_close_requested() -> bool {
    D2D_CHOOSER_CLOSE_REQUESTED.swap(false, Ordering::SeqCst)
}

/// Set a pending command for the overlay.
fn set_pending_command(cmd: OverlayCommand) {
    PENDING_COMMAND.store(cmd as u8, Ordering::SeqCst);
}

/// Clear any pending command.
/// Called when starting a new overlay to ensure no stale commands.
pub fn clear_pending_command() {
    PENDING_COMMAND.store(0, Ordering::SeqCst);
    PENDING_WIDTH.store(0, Ordering::SeqCst);
    PENDING_HEIGHT.store(0, Ordering::SeqCst);
    PENDING_MOVE_X.store(0, Ordering::SeqCst);
    PENDING_MOVE_Y.store(0, Ordering::SeqCst);
    D2D_CHOOSER_CLOSE_REQUESTED.store(false, Ordering::SeqCst);
    if let Ok(mut request) = d2d_chooser_request().lock() {
        *request = None;
    }
}

/// Confirm the overlay selection.
///
/// Called from the toolbar when the user clicks the record or screenshot button.
///
/// # Arguments
/// * `action` - Either "recording" or "screenshot"
#[tauri::command]
pub async fn capture_overlay_confirm(action: String) -> MoonSnapResult<()> {
    let cmd = match action.as_str() {
        "recording" => OverlayCommand::ConfirmRecording,
        "screenshot" => OverlayCommand::ConfirmScreenshot,
        _ => {
            return Err(format!(
                "Invalid action: '{}'. Expected 'recording' or 'screenshot'.",
                action
            )
            .into())
        },
    };
    set_pending_command(cmd);
    Ok(())
}

/// Cancel the overlay and close.
///
/// Called from the toolbar when the user clicks cancel or presses Escape.
#[tauri::command]
pub async fn capture_overlay_cancel() -> MoonSnapResult<()> {
    set_pending_command(OverlayCommand::Cancel);
    Ok(())
}

/// Go back to selection mode (reselect region).
///
/// Called from the toolbar when the user clicks the redo/reselect button.
#[tauri::command]
pub async fn capture_overlay_reselect() -> MoonSnapResult<()> {
    set_pending_command(OverlayCommand::Reselect);
    Ok(())
}

/// Set the selection dimensions.
///
/// Called from the toolbar when the user edits the dimension inputs.
/// The overlay will resize the selection to match while keeping the center point.
#[tauri::command]
pub async fn capture_overlay_set_dimensions(width: u32, height: u32) -> MoonSnapResult<()> {
    if width < 20 || height < 20 {
        return Err("Dimensions must be at least 20x20".into());
    }
    PENDING_WIDTH.store(width, Ordering::SeqCst);
    PENDING_HEIGHT.store(height, Ordering::SeqCst);
    set_pending_command(OverlayCommand::SetDimensions);
    Ok(())
}

/// Move the current selection by a screen-space delta.
///
/// Used by floating HUDs that keep pointer capture locally and drive the D2D
/// selection directly.
#[tauri::command]
pub async fn capture_overlay_move_selection_by(dx: i32, dy: i32) -> MoonSnapResult<()> {
    if dx == 0 && dy == 0 {
        return Ok(());
    }

    PENDING_MOVE_X.fetch_add(dx, Ordering::SeqCst);
    PENDING_MOVE_Y.fetch_add(dy, Ordering::SeqCst);
    set_pending_command(OverlayCommand::MoveSelectionBy);
    Ok(())
}

/// Highlight a specific monitor in the overlay.
///
/// Called from the display picker panel when the user hovers over a monitor item.
/// Pass -1 to clear and use cursor position instead.
#[tauri::command]
pub async fn capture_overlay_highlight_monitor(monitor_index: i32) -> MoonSnapResult<()> {
    HIGHLIGHTED_MONITOR.store(monitor_index, Ordering::SeqCst);
    Ok(())
}

/// Highlight a specific window in the overlay.
///
/// Called from the window picker panel when the user hovers over a window item.
/// Pass 0 to clear and use cursor position instead.
#[tauri::command]
pub async fn capture_overlay_highlight_window(hwnd: isize) -> MoonSnapResult<()> {
    HIGHLIGHTED_WINDOW.store(hwnd, Ordering::SeqCst);
    Ok(())
}

/// Get the currently highlighted monitor index.
///
/// Returns -1 if no specific monitor is highlighted (use cursor position).
pub fn get_highlighted_monitor() -> i32 {
    HIGHLIGHTED_MONITOR.load(Ordering::SeqCst)
}

/// Get the currently highlighted window HWND.
///
/// Returns 0 if no specific window is highlighted (use cursor position).
pub fn get_highlighted_window() -> isize {
    HIGHLIGHTED_WINDOW.load(Ordering::SeqCst)
}

/// Clear all highlights (reset to cursor-based detection).
pub fn clear_highlights() {
    HIGHLIGHTED_MONITOR.store(-1, Ordering::SeqCst);
    HIGHLIGHTED_WINDOW.store(0, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pending_command_lifecycle() {
        // Initially should be None
        assert_eq!(take_pending_command(), OverlayCommand::None);

        // Set a command
        set_pending_command(OverlayCommand::ConfirmRecording);

        // Take should return it and clear
        assert_eq!(take_pending_command(), OverlayCommand::ConfirmRecording);

        // Should be None again
        assert_eq!(take_pending_command(), OverlayCommand::None);
    }

    #[test]
    fn test_command_overwrite() {
        // Setting a new command should overwrite the previous one
        set_pending_command(OverlayCommand::ConfirmRecording);
        set_pending_command(OverlayCommand::Cancel);

        assert_eq!(take_pending_command(), OverlayCommand::Cancel);
    }

    #[test]
    fn test_move_selection_by_command() {
        PENDING_MOVE_X.store(12, Ordering::SeqCst);
        PENDING_MOVE_Y.store(-4, Ordering::SeqCst);
        set_pending_command(OverlayCommand::MoveSelectionBy);

        assert_eq!(take_pending_command(), OverlayCommand::MoveSelectionBy);
        assert_eq!(take_pending_move_delta(), (12, -4));
        assert_eq!(take_pending_move_delta(), (0, 0));
    }
}
