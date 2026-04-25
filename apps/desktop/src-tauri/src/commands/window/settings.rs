//! Settings dialog commands.
//!
//! The settings UI is rendered as an in-window dialog inside the main library
//! window. This command exists so that other webviews (e.g. the capture
//! toolbar) can request the dialog without having direct access to the
//! library window's Zustand store.

use moonsnap_core::error::MoonSnapResult;
use tauri::{command, AppHandle, Emitter, Manager};

/// Main library window label — the only window that hosts the settings dialog.
const LIBRARY_WINDOW_LABEL: &str = "library";

/// Focus the library window and ask it to open the settings dialog.
/// `tab` selects which section to show.
#[command]
pub async fn show_settings_window(app: AppHandle, tab: Option<String>) -> MoonSnapResult<()> {
    let Some(window) = app.get_webview_window(LIBRARY_WINDOW_LABEL) else {
        return Err("Library window is not available".into());
    };

    window
        .show()
        .map_err(|e| format!("Failed to show library window: {}", e))?;
    window
        .unminimize()
        .map_err(|e| format!("Failed to unminimize library window: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus library window: {}", e))?;

    let payload = serde_json::json!({ "tab": tab });
    window
        .emit("open-settings", payload)
        .map_err(|e| format!("Failed to emit open-settings event: {}", e))?;

    Ok(())
}
