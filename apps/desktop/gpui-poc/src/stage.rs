use crate::{app::EditorMode, colors::stage_bg, paint};
use gpui::*;

pub fn editor_stage(mode: EditorMode) -> impl IntoElement {
    div()
        .size_full()
        .rounded_lg()
        .bg(stage_bg())
        .relative()
        .overflow_hidden()
        .child(
            canvas(
                move |bounds, _, _| (bounds, mode),
                move |_, (bounds, mode), window, _| paint_editor_canvas(bounds, mode, window),
            )
            .absolute()
            .size_full(),
        )
}

fn paint_editor_canvas(bounds: Bounds<Pixels>, mode: EditorMode, window: &mut Window) {
    paint::paint_workspace_texture(bounds, window);

    match mode {
        EditorMode::Image => paint::paint_image_canvas(bounds, window),
        EditorMode::Video => paint::paint_video_preview(bounds, window),
    }
}
