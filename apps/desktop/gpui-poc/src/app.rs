use crate::{components::divider, image_editor, video_editor};
use gpui::*;
use gpui_component::{ActiveTheme, StyledExt};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EditorMode {
    Image,
    Video,
}

pub struct MoonSnapGpuiPoc {
    mode: EditorMode,
}

impl MoonSnapGpuiPoc {
    pub fn new() -> Self {
        Self {
            mode: EditorMode::Image,
        }
    }

    pub fn set_mode(&mut self, mode: EditorMode, cx: &mut Context<Self>) {
        self.mode = mode;
        cx.notify();
    }

    fn render_library_shell(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .h_flex()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(image_editor::library(self.mode, cx))
            .child(shell_resize_handle(cx))
            .child(div().flex_1().min_h_0().min_w_0().child(match self.mode {
                EditorMode::Image => image_editor::workspace(cx).into_any_element(),
                EditorMode::Video => video_editor::workspace(cx).into_any_element(),
            }))
    }
}

impl Render for MoonSnapGpuiPoc {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .text_color(cx.theme().foreground)
            .child(self.render_library_shell(cx))
    }
}

fn shell_resize_handle<T>(cx: &Context<T>) -> impl IntoElement {
    div()
        .w(px(10.0))
        .h_full()
        .border_l_1()
        .border_r_1()
        .border_color(cx.theme().border)
        .bg(cx.theme().background)
        .h_flex()
        .items_center()
        .justify_center()
        .child(divider())
}
