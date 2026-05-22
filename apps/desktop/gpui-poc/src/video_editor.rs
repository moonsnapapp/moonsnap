use crate::{
    app::{EditorMode, MoonSnapGpuiPoc},
    colors::*,
    components::*,
    stage,
};
use gpui::*;
use gpui_component::{button::*, ActiveTheme, Sizable as _, StyledExt};

pub fn workspace(cx: &mut Context<MoonSnapGpuiPoc>) -> impl IntoElement {
    div()
        .flex_1()
        .min_h_0()
        .h_flex()
        .child(
            div()
                .flex_1()
                .min_w_0()
                .min_h_0()
                .v_flex()
                .p_3()
                .gap_3()
                .child(toolbar())
                .child(
                    div()
                        .flex_1()
                        .min_h(px(260.0))
                        .rounded_lg()
                        .border_1()
                        .border_color(cx.theme().border)
                        .bg(cx.theme().popover)
                        .p_4()
                        .child(stage::editor_stage(EditorMode::Video)),
                )
                .child(timeline()),
        )
        .child(properties(cx))
}

fn toolbar() -> impl IntoElement {
    div()
        .h(px(44.0))
        .rounded_lg()
        .border_1()
        .border_color(border())
        .bg(glass())
        .px_3()
        .h_flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .h_flex()
                .items_center()
                .gap_2()
                .child(Button::new("play").small().primary().label("Play"))
                .child(Button::new("split").small().outline().label("Split"))
                .child(Button::new("fit").small().outline().label("Fit")),
        )
        .child(
            div()
                .h_flex()
                .items_center()
                .gap_2()
                .child(meta_pill("00:38.420 / 02:14.000"))
                .child(Button::new("export").small().primary().label("Export")),
        )
}

fn properties<T>(_: &Context<T>) -> impl IntoElement {
    sidebar()
        .child(
            div()
                .h(px(42.0))
                .h_flex()
                .gap_1()
                .items_center()
                .child(tab("Project", true))
                .child(tab("Captions", false))
                .child(tab("Style", false))
                .child(tab("Export", false)),
        )
        .child(
            control_panel("Project")
                .child(property_row("Format", "MP4 source"))
                .child(property_row("Duration", "02:14.000"))
                .child(property_row("Resolution", "1920 x 1080")),
        )
        .child(
            control_panel("Cursor")
                .child(setting_bar("Size", "115%", 0.58))
                .child(setting_bar("Highlight", "42%", 0.42))
                .child(property_row("Path", "Interpolated")),
        )
        .child(
            control_panel("Background")
                .child(property_row("Mode", "Wallpaper blur"))
                .child(setting_bar("Padding", "64px", 0.46))
                .child(setting_bar("Radius", "18px", 0.28)),
        )
}

fn timeline() -> impl IntoElement {
    div()
        .h(px(320.0))
        .rounded_lg()
        .border_t_1()
        .border_color(stage_border())
        .bg(timeline_bg())
        .v_flex()
        .child(
            div()
                .h(px(44.0))
                .px_3()
                .border_b_1()
                .border_color(border())
                .h_flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .h_flex()
                        .items_center()
                        .gap_2()
                        .child(Button::new("select").small().outline().label("Select"))
                        .child(Button::new("cut").small().outline().label("Cut"))
                        .child(Button::new("in").small().outline().label("In"))
                        .child(Button::new("out").small().outline().label("Out")),
                )
                .child(meta_pill("Timeline zoom 100%")),
        )
        .child(
            div()
                .h(px(32.0))
                .px_3()
                .border_b_1()
                .border_color(border())
                .h_flex()
                .justify_between()
                .items_center()
                .text_size(px(11.0))
                .text_color(ink_subtle())
                .child("00:00")
                .child("00:30")
                .child("01:00")
                .child("01:30")
                .child("02:14"),
        )
        .child(track_row("Video", 0.92, hsla(0.55, 0.70, 0.46, 1.0)))
        .child(track_row("Text", 0.74, hsla(0.75, 0.58, 0.62, 1.0)))
        .child(track_row("Zoom", 0.55, hsla(0.10, 0.88, 0.58, 1.0)))
        .child(track_row("Mask", 0.42, hsla(0.0, 0.68, 0.60, 1.0)))
        .child(track_row("Cursor", 0.67, hsla(0.14, 0.90, 0.58, 1.0)))
}

fn track_row(label: &'static str, width: f32, color: Hsla) -> impl IntoElement {
    div()
        .h(px(48.0))
        .border_b_1()
        .border_color(border())
        .h_flex()
        .items_center()
        .child(
            div()
                .w(px(92.0))
                .px_3()
                .text_size(px(11.0))
                .text_color(ink_muted())
                .child(label),
        )
        .child(
            div()
                .flex_1()
                .h(px(26.0))
                .rounded_md()
                .bg(hsla(0.62, 0.12, 0.15, 0.78))
                .child(
                    div()
                        .w(relative(width))
                        .h_full()
                        .rounded_md()
                        .bg(color)
                        .child(""),
                ),
        )
        .child(div().w(px(16.0)).child(""))
}
