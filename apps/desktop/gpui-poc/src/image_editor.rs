use crate::{
    app::{EditorMode, MoonSnapGpuiPoc},
    colors::*,
    components::*,
    paint, stage,
};
use gpui::*;
use gpui_component::{button::*, ActiveTheme, IconName, Selectable as _, Sizable as _, StyledExt};

pub fn library(active_mode: EditorMode, cx: &mut Context<MoonSnapGpuiPoc>) -> impl IntoElement {
    div()
        .w(px(264.0))
        .h_full()
        .border_r_1()
        .border_color(border())
        .bg(hsla(0.62, 0.10, 0.040, 1.0))
        .v_flex()
        .child(
            div()
                .flex_1()
                .min_h_0()
                .p_3()
                .v_flex()
                .gap_3()
                .child(library_mode_switch(active_mode, cx))
                .child(section_header("Yesterday", "3 captures"))
                .child(capture_thumb(false, 0))
                .child(capture_thumb(false, 1))
                .child(capture_thumb(false, 2))
                .child(section_header("This Month", "1 capture"))
                .child(capture_thumb(true, 3)),
        )
        .child(
            div()
                .h(px(132.0))
                .border_t_1()
                .border_color(border())
                .p_3()
                .v_flex()
                .gap_2()
                .child(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(nav_chip("*", false))
                        .child(nav_chip("tag", false))
                        .child(nav_chip("img", true))
                        .child(nav_chip("vid", false))
                        .child(nav_chip("grid", false)),
                )
                .child(
                    div()
                        .h_flex()
                        .gap_2()
                        .child(nav_chip("x", false))
                        .child(nav_chip("1", false))
                        .child(nav_chip("bin", false))
                        .child(nav_chip("close", false)),
                )
                .child(search_box()),
        )
}

fn library_mode_switch(
    active_mode: EditorMode,
    cx: &mut Context<MoonSnapGpuiPoc>,
) -> impl IntoElement {
    ButtonGroup::new("library-editor-mode")
        .outline()
        .compact()
        .child(
            Button::new("library-image-mode")
                .label("Image")
                .selected(active_mode == EditorMode::Image),
        )
        .child(
            Button::new("library-video-mode")
                .label("Video")
                .selected(active_mode == EditorMode::Video),
        )
        .on_click(cx.listener(|this, selected: &Vec<usize>, _, cx| {
            this.set_mode(
                if selected.first() == Some(&1) {
                    EditorMode::Video
                } else {
                    EditorMode::Image
                },
                cx,
            );
        }))
}

pub fn workspace<T>(cx: &Context<T>) -> impl IntoElement {
    div()
        .size_full()
        .min_w_0()
        .min_h_0()
        .v_flex()
        .child(
            div()
                .flex_1()
                .min_h_0()
                .h_flex()
                .child(
                    div().flex_1().min_w_0().p_4().child(
                        div()
                            .size_full()
                            .rounded_lg()
                            .overflow_hidden()
                            .border_1()
                            .border_color(cx.theme().border)
                            .bg(cx.theme().popover)
                            .p_4()
                            .child(stage::editor_stage(EditorMode::Image)),
                    ),
                )
                .child(properties(cx)),
        )
        .child(
            div()
                .h(px(86.0))
                .border_t_1()
                .border_color(cx.theme().border)
                .bg(cx.theme().popover)
                .h_flex()
                .items_center()
                .justify_center()
                .child(toolbar()),
        )
}

fn section_header(title: &'static str, count: &'static str) -> impl IntoElement {
    div()
        .h_flex()
        .items_center()
        .gap_3()
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::BOLD)
                .child(title),
        )
        .child(div().flex_1().h(px(1.0)).bg(border()).child(""))
        .child(
            div()
                .text_size(px(12.0))
                .text_color(ink_faint())
                .child(count),
        )
}

fn search_box() -> impl IntoElement {
    div()
        .h(px(34.0))
        .rounded_md()
        .border_1()
        .border_color(border())
        .bg(hsla(0.62, 0.08, 0.075, 1.0))
        .px_2()
        .h_flex()
        .items_center()
        .gap_2()
        .text_size(px(12.0))
        .text_color(ink_subtle())
        .child("Search...")
        .child(div().flex_1().child(""))
        .child(nav_chip("dir", false))
}

fn capture_thumb(selected: bool, ix: usize) -> impl IntoElement {
    div()
        .h(px(if selected { 170.0 } else { 205.0 }))
        .rounded_lg()
        .border_2()
        .border_color(if selected { coral() } else { border() })
        .bg(hsla(0.62, 0.10, 0.070, 1.0))
        .p(px(4.0))
        .relative()
        .overflow_hidden()
        .child(
            canvas(
                move |bounds, _, _| (bounds, selected, ix),
                move |_, (bounds, selected, ix), window, _| {
                    paint::paint_thumb(bounds, selected, ix, window);
                },
            )
            .absolute()
            .size_full(),
        )
}

pub fn toolbar() -> impl IntoElement {
    div()
        .h(px(66.0))
        .h_flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .h(px(48.0))
                .rounded_lg()
                .border_1()
                .border_color(border_light())
                .bg(toolbar_bg())
                .px_2()
                .h_flex()
                .items_center()
                .gap_1()
                .child(toolbar_icon_button(
                    "tool-undo",
                    IconName::Undo,
                    "Undo",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-redo",
                    IconName::Redo,
                    "Redo",
                    false,
                ))
                .child(divider())
                .child(toolbar_icon_button(
                    "tool-select",
                    IconName::ArrowUp,
                    "Select",
                    true,
                ))
                .child(toolbar_icon_button(
                    "tool-crop",
                    IconName::Frame,
                    "Crop",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-arrow",
                    IconName::ArrowRight,
                    "Arrow",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-rectangle",
                    IconName::Replace,
                    "Rectangle",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-external",
                    IconName::ExternalLink,
                    "Callout",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-text",
                    IconName::BookOpen,
                    "Text",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-highlight",
                    IconName::Heart,
                    "Highlight",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-style",
                    IconName::Palette,
                    "Style",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-sparkle",
                    IconName::Asterisk,
                    "Effects",
                    false,
                ))
                .child(toolbar_icon_button(
                    "tool-add",
                    IconName::Plus,
                    "Add",
                    false,
                ))
                .child(divider())
                .child(
                    Button::new("copy")
                        .small()
                        .outline()
                        .icon(IconName::Copy)
                        .tooltip("Copy"),
                )
                .child(
                    Button::new("save")
                        .small()
                        .outline()
                        .icon(IconName::Check)
                        .tooltip("Save"),
                )
                .child(
                    Button::new("delete")
                        .small()
                        .outline()
                        .icon(IconName::Delete)
                        .tooltip("Delete"),
                ),
        )
}

pub fn properties<T>(_: &Context<T>) -> impl IntoElement {
    sidebar()
        .child(sidebar_header("Select", "Properties"))
        .child(
            control_panel("Quick Styles")
                .child(style_tiles())
                .child(setting_bar("Stroke width", "4px", 0.42))
                .child(setting_bar("Opacity", "100%", 1.0)),
        )
        .child(control_panel("Stroke Color").child(swatch_row([
            coral(),
            hsla(0.55, 0.74, 0.60, 1.0),
            hsla(0.14, 0.90, 0.58, 1.0),
            hsla(0.74, 0.62, 0.66, 1.0),
            white(),
        ])))
        .child(
            control_panel("Canvas")
                .child(property_row("Zoom", "82%"))
                .child(property_row("Background", "Glass shadow"))
                .child(property_row("Autosave", "Idle")),
        )
}

fn style_tiles() -> impl IntoElement {
    div()
        .h_flex()
        .gap_2()
        .child(style_tile("Solid", true))
        .child(style_tile("Outline", false))
        .child(style_tile("Glass", false))
}

fn style_tile(label: &'static str, active: bool) -> impl IntoElement {
    div()
        .flex_1()
        .h(px(48.0))
        .rounded_md()
        .border_1()
        .border_color(if active { coral() } else { border() })
        .bg(if active { coral_subtle() } else { polar_mist() })
        .v_flex()
        .items_center()
        .justify_center()
        .gap_1()
        .child(
            div()
                .w(px(24.0))
                .h(px(8.0))
                .rounded_sm()
                .bg(if active { coral() } else { ink_faint() })
                .child(""),
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(if active { coral() } else { ink_muted() })
                .child(label),
        )
}
