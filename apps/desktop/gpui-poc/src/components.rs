use crate::colors::*;
use gpui::*;
use gpui_component::{button::*, IconName, Selectable as _, Sizable as _, StyledExt};

pub fn meta_pill(label: &'static str) -> impl IntoElement {
    div()
        .px_2()
        .py_1()
        .rounded_md()
        .border_1()
        .border_color(border())
        .bg(polar_mist())
        .text_color(ink_subtle())
        .text_size(px(10.0))
        .child(label)
}

pub fn toolbar_icon_button(
    id: &'static str,
    icon: IconName,
    tooltip: &'static str,
    active: bool,
) -> impl IntoElement {
    Button::new(id)
        .small()
        .ghost()
        .selected(active)
        .icon(icon)
        .tooltip(tooltip)
}

pub fn divider() -> impl IntoElement {
    div()
        .mx_1()
        .w(px(1.0))
        .h(px(24.0))
        .bg(hsla(0.0, 0.0, 1.0, 0.12))
        .child("")
}

pub fn nav_chip(label: &'static str, active: bool) -> impl IntoElement {
    div()
        .h(px(32.0))
        .min_w(px(32.0))
        .px_2()
        .rounded_md()
        .border_1()
        .border_color(if active { coral() } else { border() })
        .bg(if active { coral_subtle() } else { polar_mist() })
        .text_color(if active { coral() } else { ink_muted() })
        .text_size(px(10.0))
        .h_flex()
        .items_center()
        .justify_center()
        .child(label)
}

pub fn sidebar() -> Div {
    div()
        .w(px(340.0))
        .h_full()
        .p_3()
        .border_l_1()
        .border_color(border())
        .bg(sidebar_bg())
        .v_flex()
        .gap_3()
}

pub fn sidebar_header(title: &'static str, detail: &'static str) -> impl IntoElement {
    div()
        .h(px(42.0))
        .border_b_1()
        .border_color(border())
        .h_flex()
        .items_center()
        .gap_2()
        .child(
            div()
                .size(px(20.0))
                .rounded_sm()
                .bg(coral_subtle())
                .text_color(coral())
                .text_size(px(12.0))
                .h_flex()
                .items_center()
                .justify_center()
                .child("*"),
        )
        .child(
            div()
                .v_flex()
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(title),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(ink_subtle())
                        .child(detail),
                ),
        )
}

pub fn control_panel(title: &'static str) -> Div {
    div()
        .rounded_lg()
        .border_1()
        .border_color(border())
        .bg(panel())
        .p_3()
        .v_flex()
        .gap_3()
        .child(
            div()
                .text_size(px(11.0))
                .text_color(ink_muted())
                .font_weight(FontWeight::BOLD)
                .child(title),
        )
}

pub fn tab(label: &'static str, active: bool) -> impl IntoElement {
    div()
        .flex_1()
        .h(px(30.0))
        .rounded_md()
        .bg(if active {
            polar_frost()
        } else {
            hsla(0.0, 0.0, 0.0, 0.0)
        })
        .text_color(if active { ink() } else { ink_muted() })
        .text_size(px(11.0))
        .h_flex()
        .items_center()
        .justify_center()
        .child(label)
}

pub fn property_row(label: &'static str, value: &'static str) -> impl IntoElement {
    div()
        .h_flex()
        .justify_between()
        .gap_3()
        .text_size(px(12.0))
        .child(div().text_color(ink_muted()).child(label))
        .child(div().text_color(ink()).child(value))
}

pub fn setting_bar(label: &'static str, value: &'static str, pct: f32) -> impl IntoElement {
    div()
        .v_flex()
        .gap_2()
        .child(
            div()
                .h_flex()
                .justify_between()
                .text_size(px(12.0))
                .child(div().text_color(ink_muted()).child(label))
                .child(div().text_color(ink()).child(value)),
        )
        .child(
            div().h(px(5.0)).rounded_sm().bg(polar_mist()).child(
                div()
                    .w(relative(pct))
                    .h_full()
                    .rounded_sm()
                    .bg(coral())
                    .child(""),
            ),
        )
}

pub fn swatch_row(colors: [Hsla; 5]) -> impl IntoElement {
    div().h_flex().gap_2().children(colors.map(|color| {
        div()
            .size(px(24.0))
            .rounded_sm()
            .border_1()
            .border_color(border_light())
            .bg(color)
            .child("")
    }))
}
