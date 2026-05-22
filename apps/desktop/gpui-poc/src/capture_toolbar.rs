use crate::colors::*;
use gpui::*;
use gpui_component::{button::*, Icon, IconName, Sizable as _, StyledExt};

#[derive(Clone, Copy, PartialEq, Eq)]
enum CaptureMode {
    Video,
    Gif,
    Image,
}

pub struct CaptureToolbarPoc {
    mode: CaptureMode,
}

impl CaptureToolbarPoc {
    pub fn new() -> Self {
        Self {
            mode: CaptureMode::Video,
        }
    }

    fn set_mode(&mut self, mode: CaptureMode, cx: &mut Context<Self>) {
        self.mode = mode;
        cx.notify();
    }
}

impl Render for CaptureToolbarPoc {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .p(px(14.0))
            .bg(hsla(0.0, 0.0, 0.0, 0.0))
            .child(
                div()
                    .w_full()
                    .rounded_lg()
                    .border_1()
                    .border_color(border_light())
                    .bg(hsla(0.08, 0.055, 0.082, 0.97))
                    .overflow_hidden()
                    .v_flex()
                    .shadow_lg()
                    .child(top_strip(window))
                    .child(
                        div()
                            .p(px(8.0))
                            .pt(px(7.0))
                            .v_flex()
                            .gap_2()
                            .child(mode_selector(self.mode, cx))
                            .child(control_row()),
                    ),
            )
    }
}

fn top_strip(_window: &mut Window) -> impl IntoElement {
    div()
        .h(px(30.0))
        .px_3()
        .border_b_1()
        .border_color(hsla(0.0, 0.0, 1.0, 0.07))
        .bg(hsla(0.08, 0.045, 0.045, 0.66))
        .window_control_area(WindowControlArea::Drag)
        .h_flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .w(px(82.0))
                .h_flex()
                .items_center()
                .gap_1()
                .text_color(ink_faint())
                .children(
                    (0..4).map(|_| div().size(px(3.0)).rounded_full().bg(ink_faint()).child("")),
                ),
        )
        .child(
            div()
                .h_flex()
                .items_center()
                .gap_2()
                .text_size(px(11.0))
                .font_weight(FontWeight::BOLD)
                .text_color(ink_muted())
                .child("MOONSNAP")
                .child(
                    div()
                        .px_2()
                        .py(px(2.0))
                        .rounded_md()
                        .border_1()
                        .border_color(border())
                        .bg(hsla(0.0, 0.0, 1.0, 0.055))
                        .text_size(px(9.0))
                        .text_color(ink_subtle())
                        .child("PRO"),
                ),
        )
        .child(
            div()
                .w(px(82.0))
                .h_flex()
                .items_center()
                .justify_end()
                .gap_1()
                .child(
                    toolbar_button("toolbar-minimize", IconName::WindowMinimize, "Minimize")
                        .on_click(|_, window, _| window.minimize_window()),
                )
                .child(
                    toolbar_button("toolbar-close", IconName::WindowClose, "Close")
                        .on_click(|_, window, _| window.remove_window()),
                ),
        )
        .on_mouse_down(MouseButton::Left, |_, window, cx| {
            window.start_window_move();
            cx.stop_propagation();
        })
}

fn mode_selector(mode: CaptureMode, cx: &mut Context<CaptureToolbarPoc>) -> impl IntoElement {
    div()
        .w_full()
        .h(px(32.0))
        .p(px(2.0))
        .rounded_md()
        .border_1()
        .border_color(hsla(0.0, 0.0, 1.0, 0.06))
        .bg(hsla(0.0, 0.0, 0.0, 0.25))
        .h_flex()
        .gap_1()
        .child(mode_segment(
            "Video",
            IconName::Play,
            mode == CaptureMode::Video,
            CaptureMode::Video,
            cx,
        ))
        .child(mode_segment(
            "GIF",
            IconName::GalleryVerticalEnd,
            mode == CaptureMode::Gif,
            CaptureMode::Gif,
            cx,
        ))
        .child(mode_segment(
            "Photo",
            IconName::Frame,
            mode == CaptureMode::Image,
            CaptureMode::Image,
            cx,
        ))
}

fn mode_segment(
    label: &'static str,
    icon: IconName,
    active: bool,
    target: CaptureMode,
    cx: &mut Context<CaptureToolbarPoc>,
) -> impl IntoElement {
    div()
        .flex_1()
        .h_full()
        .rounded_sm()
        .bg(if active {
            hsla(0.0, 0.0, 1.0, 0.10)
        } else {
            hsla(0.0, 0.0, 0.0, 0.0)
        })
        .text_color(if active { ink() } else { ink_faint() })
        .text_size(px(11.0))
        .font_weight(FontWeight::MEDIUM)
        .h_flex()
        .items_center()
        .justify_center()
        .gap_1()
        .child(Icon::new(icon).xsmall())
        .child(label)
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |this, _, _, cx| this.set_mode(target, cx)),
        )
}

fn control_row() -> impl IntoElement {
    div()
        .h(px(56.0))
        .h_flex()
        .items_center()
        .gap_2()
        .child(drag_handle())
        .child(source_cluster())
        .child(vertical_rule())
        .child(device_cell(
            "Camera",
            "FaceTime HD",
            IconName::CircleUser,
            0.52,
            false,
        ))
        .child(device_cell("Mic", "Default", IconName::User, 0.76, true))
        .child(device_cell(
            "System",
            "Desktop audio",
            IconName::HardDrive,
            0.36,
            true,
        ))
        .child(vertical_rule())
        .child(toolbar_button(
            "toolbar-settings",
            IconName::Settings,
            "Settings",
        ))
        .child(toolbar_button(
            "toolbar-library",
            IconName::FolderOpen,
            "Open library",
        ))
        .child(capture_button())
}

fn drag_handle() -> impl IntoElement {
    div()
        .w(px(22.0))
        .h_full()
        .rounded_md()
        .window_control_area(WindowControlArea::Drag)
        .h_flex()
        .items_center()
        .justify_center()
        .gap_1()
        .children((0..2).map(|_| {
            div().v_flex().gap_1().children(
                (0..3).map(|_| div().size(px(3.0)).rounded_full().bg(ink_faint()).child("")),
            )
        }))
        .on_mouse_down(MouseButton::Left, |_, window, cx| {
            window.start_window_move();
            cx.stop_propagation();
        })
}

fn source_cluster() -> impl IntoElement {
    div()
        .h_full()
        .min_w(px(262.0))
        .rounded_md()
        .border_1()
        .border_color(border())
        .bg(hsla(0.62, 0.08, 0.040, 0.72))
        .p_1()
        .h_flex()
        .items_center()
        .gap_1()
        .child(source_button("Area", IconName::Frame, true))
        .child(source_button("Window", IconName::WindowMaximize, false))
        .child(source_button("Display", IconName::PanelBottom, false))
        .child(
            div()
                .ml_1()
                .px_2()
                .h(px(30.0))
                .rounded_md()
                .border_1()
                .border_color(border())
                .bg(hsla(0.0, 0.0, 1.0, 0.045))
                .h_flex()
                .items_center()
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(ink())
                .child("1440 x 900"),
        )
}

fn source_button(label: &'static str, icon: IconName, active: bool) -> impl IntoElement {
    div()
        .h(px(34.0))
        .px_2()
        .rounded_md()
        .border_1()
        .border_color(if active {
            coral()
        } else {
            hsla(0.0, 0.0, 1.0, 0.055)
        })
        .bg(if active {
            coral_subtle()
        } else {
            hsla(0.0, 0.0, 1.0, 0.035)
        })
        .text_color(if active { coral() } else { ink_muted() })
        .text_size(px(11.0))
        .font_weight(FontWeight::MEDIUM)
        .h_flex()
        .items_center()
        .gap_1()
        .child(Icon::new(icon).xsmall())
        .child(label)
}

fn device_cell(
    label: &'static str,
    value: &'static str,
    icon: IconName,
    level: f32,
    enabled: bool,
) -> impl IntoElement {
    div()
        .w(px(100.0))
        .h_full()
        .rounded_md()
        .border_1()
        .border_color(border())
        .bg(hsla(0.0, 0.0, 1.0, if enabled { 0.050 } else { 0.028 }))
        .p_2()
        .v_flex()
        .justify_center()
        .gap_1()
        .child(
            div()
                .h_flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .h_flex()
                        .items_center()
                        .gap_1()
                        .text_size(px(10.0))
                        .text_color(ink_muted())
                        .child(Icon::new(icon).xsmall())
                        .child(label),
                )
                .child(
                    div()
                        .size(px(6.0))
                        .rounded_full()
                        .bg(if enabled { coral() } else { ink_faint() })
                        .child(""),
                ),
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(if enabled { ink() } else { ink_faint() })
                .line_height(px(13.0))
                .child(value),
        )
        .child(level_meter(level, enabled))
}

fn level_meter(level: f32, enabled: bool) -> impl IntoElement {
    div()
        .h(px(4.0))
        .rounded_sm()
        .bg(hsla(0.0, 0.0, 1.0, 0.065))
        .overflow_hidden()
        .child(
            div()
                .w(relative(if enabled { level } else { 0.0 }))
                .h_full()
                .rounded_sm()
                .bg(if enabled { coral() } else { ink_faint() })
                .child(""),
        )
}

fn toolbar_button(id: &'static str, icon: IconName, tooltip: &'static str) -> Button {
    Button::new(id).small().ghost().icon(icon).tooltip(tooltip)
}

fn capture_button() -> impl IntoElement {
    div()
        .ml_1()
        .size(px(48.0))
        .rounded_full()
        .border_1()
        .border_color(hsla(0.012, 0.90, 0.72, 0.78))
        .bg(coral())
        .h_flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .size(px(20.0))
                .rounded_full()
                .border_2()
                .border_color(hsla(0.0, 0.0, 1.0, 0.85))
                .child(""),
        )
}

fn vertical_rule() -> impl IntoElement {
    div()
        .w(px(1.0))
        .h(px(36.0))
        .bg(hsla(0.0, 0.0, 1.0, 0.085))
        .child("")
}
