//! Outbound Tauri event emission for the capture overlay.
//!
//! Leaf layer split out of `wndproc.rs`: every function reads `OverlayState`
//! and emits a frontend event. Called by the message handlers and menus.

use tauri::Emitter;

use super::render;
use super::state::OverlayState;
use super::types::*;

pub(super) fn emit_native_selection_hud_save_area(state: &OverlayState) {
    let Some(hud) = &state.selection_hud else {
        return;
    };
    let Some(selection) = state.get_screen_selection() else {
        return;
    };

    let _ = state.app_handle.emit(
        "native-selection-hud-save-area",
        serde_json::json!({
            "owner": hud.owner,
            "x": selection.left,
            "y": selection.top,
            "width": selection.width(),
            "height": selection.height(),
        }),
    );
}

pub(super) fn emit_native_selection_hud_delete_saved_area(state: &OverlayState, id: &str) {
    let Some(hud) = &state.selection_hud else {
        return;
    };

    let _ = state.app_handle.emit(
        "native-selection-hud-delete-saved-area",
        serde_json::json!({
            "owner": hud.owner,
            "id": id,
        }),
    );
}

pub(super) fn emit_native_selection_hud_capture(state: &OverlayState) {
    let Some(hud) = &state.selection_hud else {
        return;
    };
    let Some(selection) = state.get_screen_selection() else {
        return;
    };

    let _ = state.app_handle.emit(
        "native-selection-hud-capture",
        serde_json::json!({
            "owner": hud.owner,
            "x": selection.left,
            "y": selection.top,
            "width": selection.width(),
            "height": selection.height(),
            "captureType": state.capture_type.as_str(),
            "sourceType": "area",
            "sourceMode": "area"
        }),
    );
}

pub(super) fn emit_recording_mode_selected(state: &OverlayState, action: &str) {
    let Some(chooser) = &state.recording_mode_chooser else {
        return;
    };
    let Some(rect) = render::recording_mode_chooser_rect(state) else {
        return;
    };
    let screen_position = state
        .monitor
        .local_to_screen(Point::new(rect.left, rect.top));

    let _ = state.app_handle.emit(
        "recording-mode-selected",
        serde_json::json!({
            "x": screen_position.x,
            "y": screen_position.y,
            "action": action,
            "remember": chooser.remember,
            "owner": chooser.owner,
        }),
    );
}

pub(super) fn emit_recording_mode_chooser_back(state: &OverlayState) {
    let Some(chooser) = &state.recording_mode_chooser else {
        return;
    };
    let Some(rect) = render::recording_mode_chooser_rect(state) else {
        return;
    };
    let screen_position = state
        .monitor
        .local_to_screen(Point::new(rect.left, rect.top));

    let _ = state.app_handle.emit(
        "recording-mode-chooser-back",
        serde_json::json!({
            "x": screen_position.x,
            "y": screen_position.y,
            "owner": chooser.owner,
        }),
    );
}
/// Emit adjustment ready event to show the toolbar
pub(super) fn emit_adjustment_ready(state: &OverlayState, bounds: Rect) {
    let event = SelectionEvent::from(bounds);
    let _ = state
        .app_handle
        .emit("capture-overlay-adjustment-ready", event);
}

/// Emit dimensions update during adjustment drag
pub(super) fn emit_dimensions_update(state: &OverlayState) {
    let screen_bounds = state.monitor.local_rect_to_screen(state.adjustment.bounds);

    emit_selection_update(state, screen_bounds);
}

/// Emit final selection when adjustment drag ends
pub(super) fn emit_final_selection(state: &OverlayState) {
    let screen_bounds = state.monitor.local_rect_to_screen(state.adjustment.bounds);

    emit_selection_update(state, screen_bounds);
}

pub(super) fn emit_selection_update(state: &OverlayState, screen_bounds: Rect) {
    let payload = serde_json::json!({
        "x": screen_bounds.left,
        "y": screen_bounds.top,
        "width": screen_bounds.width(),
        "height": screen_bounds.height()
    });

    if let Some(owner) = &state.toolbar_owner {
        let _ = state
            .app_handle
            .emit_to(owner, "selection-updated", payload.clone());
    } else {
        let _ = state.app_handle.emit("selection-updated", payload.clone());
    }

    let _ = state
        .app_handle
        .emit_to("webcam-preview", "selection-updated", payload);
}
pub(super) fn emit_area_selection_confirmed(state: &OverlayState, screen_bounds: Rect) {
    let _ = state.app_handle.emit(
        "area-selection-confirmed",
        serde_json::json!({
            "x": screen_bounds.left,
            "y": screen_bounds.top,
            "width": screen_bounds.width(),
            "height": screen_bounds.height(),
            "captureType": state.capture_type.as_str(),
            "sourceType": "area",
        }),
    );
}
