//! Win32 popup-menu subsystem for the capture overlay.
//!
//! Split out of `wndproc.rs`: builds the dimension-preset and saved-area
//! context menus and applies the chosen result. Driven by the selection-HUD
//! message handlers.

use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, DestroyMenu, TrackPopupMenu, MF_GRAYED, MF_SEPARATOR, MF_STRING,
    TPM_LEFTALIGN, TPM_RETURNCMD, TPM_TOPALIGN,
};

use super::commands::get_saved_area_menu_state;
use super::overlay_events::*;
use super::render;
use super::state::OverlayState;
use super::types::*;
use super::wndproc::{clear_dimension_edit, set_adjustment_dimensions};

const DIMENSION_PRESETS: [(&str, u32, u32); 6] = [
    ("1080p", 1920, 1080),
    ("720p", 1280, 720),
    ("480p", 854, 480),
    ("4:3", 640, 480),
    ("Square", 1080, 1080),
    ("Story", 1080, 1920),
];
const SAVED_AREA_MENU_SAVE_CURRENT: usize = 2001;
const SAVED_AREA_MENU_USE_LAST: usize = 2002;
const SAVED_AREA_MENU_SAVED_BASE: usize = 2100;
const SAVED_AREA_MENU_DELETE_BASE: usize = 2200;
pub(super) fn show_dimension_preset_menu(state: &mut OverlayState) {
    clear_dimension_edit(state);

    let Some(rect) = render::selection_hud_rect(state) else {
        return;
    };
    let screen_position = state.monitor.local_to_screen(Point::new(
        rect.left + SELECTION_HUD_BACK_WIDTH,
        rect.bottom,
    ));

    unsafe {
        let Ok(menu) = CreatePopupMenu() else {
            return;
        };

        for (index, (label, width, height)) in DIMENSION_PRESETS.iter().enumerate() {
            let text = format!("{label}  ({width}x{height})");
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let _ = AppendMenuW(
                menu,
                MF_STRING,
                1000 + index,
                windows::core::PCWSTR(wide.as_ptr()),
            );
        }

        let selected = TrackPopupMenu(
            menu,
            TPM_LEFTALIGN | TPM_TOPALIGN | TPM_RETURNCMD,
            screen_position.x,
            screen_position.y,
            0,
            state.hwnd,
            None,
        );
        let _ = DestroyMenu(menu);

        if selected.0 >= 1000 {
            let index = (selected.0 - 1000) as usize;
            if let Some((_, width, height)) = DIMENSION_PRESETS.get(index) {
                set_adjustment_dimensions(state, *width, *height);
            }
        }
    }
}

pub(super) fn show_saved_area_menu(state: &mut OverlayState) {
    clear_dimension_edit(state);
    sync_saved_area_menu_state(state);

    let Some(rect) = render::selection_hud_area_button_rect(state) else {
        return;
    };
    let screen_position = state
        .monitor
        .local_to_screen(Point::new(rect.left, rect.bottom + 4));
    let menu_state = state
        .selection_hud
        .as_ref()
        .map(|hud| hud.saved_areas.clone())
        .unwrap_or_default();

    unsafe {
        let Ok(menu) = CreatePopupMenu() else {
            return;
        };

        append_menu_item(menu, 0, "Area Options", false);
        let _ = AppendMenuW(menu, MF_SEPARATOR, 0, windows::core::PCWSTR::null());
        append_menu_item(
            menu,
            SAVED_AREA_MENU_USE_LAST,
            &menu_state
                .last_area
                .map(|area| format!("Use Last Area ({})", format_area_label(area.to_rect())))
                .unwrap_or_else(|| "Use Last Area".to_string()),
            menu_state.last_area.is_some(),
        );
        append_menu_item(
            menu,
            SAVED_AREA_MENU_SAVE_CURRENT,
            "Save Current Area",
            menu_state.can_save_current,
        );

        if !menu_state.saved_areas.is_empty() {
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, windows::core::PCWSTR::null());
            for (index, saved_area) in menu_state.saved_areas.iter().enumerate() {
                append_menu_item(
                    menu,
                    SAVED_AREA_MENU_SAVED_BASE + index,
                    &format!(
                        "{} ({})",
                        saved_area.name,
                        format_area_label(saved_area.bounds.to_rect())
                    ),
                    true,
                );
            }

            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, windows::core::PCWSTR::null());
            for (index, saved_area) in menu_state.saved_areas.iter().enumerate() {
                append_menu_item(
                    menu,
                    SAVED_AREA_MENU_DELETE_BASE + index,
                    &format!("Delete {}", saved_area.name),
                    true,
                );
            }
        }

        let selected = TrackPopupMenu(
            menu,
            TPM_LEFTALIGN | TPM_TOPALIGN | TPM_RETURNCMD,
            screen_position.x,
            screen_position.y,
            0,
            state.hwnd,
            None,
        );
        let _ = DestroyMenu(menu);

        match selected.0 {
            value if value == SAVED_AREA_MENU_SAVE_CURRENT as i32 => {
                emit_native_selection_hud_save_area(state);
            },
            value if value == SAVED_AREA_MENU_USE_LAST as i32 => {
                if let Some(area) = menu_state.last_area {
                    set_adjustment_screen_rect(state, area.to_rect());
                }
            },
            value
                if value >= SAVED_AREA_MENU_SAVED_BASE as i32
                    && value < SAVED_AREA_MENU_DELETE_BASE as i32 =>
            {
                let index = (value as usize).saturating_sub(SAVED_AREA_MENU_SAVED_BASE);
                if let Some(area) = menu_state.saved_areas.get(index) {
                    set_adjustment_screen_rect(state, area.bounds.to_rect());
                }
            },
            value if value >= SAVED_AREA_MENU_DELETE_BASE as i32 => {
                let index = (value as usize).saturating_sub(SAVED_AREA_MENU_DELETE_BASE);
                if let Some(area) = menu_state.saved_areas.get(index) {
                    emit_native_selection_hud_delete_saved_area(state, &area.id);
                }
            },
            _ => {},
        }
    }
}

fn sync_saved_area_menu_state(state: &mut OverlayState) {
    if let Some(hud) = state.selection_hud.as_mut() {
        hud.saved_areas = get_saved_area_menu_state();
    }
}

unsafe fn append_menu_item(
    menu: windows::Win32::UI::WindowsAndMessaging::HMENU,
    id: usize,
    text: &str,
    enabled: bool,
) {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let flags = if enabled {
        MF_STRING
    } else {
        MF_STRING | MF_GRAYED
    };
    let _ = AppendMenuW(menu, flags, id, windows::core::PCWSTR(wide.as_ptr()));
}

fn format_area_label(area: Rect) -> String {
    format!(
        "{}x{} at {}, {}",
        area.width(),
        area.height(),
        area.left,
        area.top
    )
}

fn set_adjustment_screen_rect(state: &mut OverlayState, screen_rect: Rect) {
    if state.adjustment.is_locked {
        return;
    }

    state.adjustment.bounds = state.monitor.screen_rect_to_local(screen_rect);
    emit_dimensions_update(state);
}
