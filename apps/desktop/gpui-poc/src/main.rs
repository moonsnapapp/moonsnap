mod app;
mod capture_toolbar;
mod colors;
mod components;
mod image_editor;
mod paint;
mod stage;
mod video_editor;

use app::MoonSnapGpuiPoc;
use capture_toolbar::CaptureToolbarPoc;
use gpui::*;
use gpui_component::{Root, Theme, ThemeMode};

fn main() -> anyhow::Result<()> {
    let app = gpui_platform::application().with_assets(gpui_component_assets::Assets);

    app.run(move |cx| {
        gpui_component::init(cx);
        Theme::change(ThemeMode::Dark, None, cx);

        cx.spawn(async move |cx| {
            cx.open_window(WindowOptions::default(), |window, cx| {
                let view = cx.new(|_| MoonSnapGpuiPoc::new());
                cx.new(|cx| Root::new(view, window, cx))
            })
            .expect("failed to open GPUI POC window");

            let toolbar_bounds = Bounds {
                origin: point(px(640.0), px(64.0)),
                size: size(px(760.0), px(154.0)),
            };
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(toolbar_bounds)),
                    titlebar: None,
                    focus: false,
                    show: true,
                    is_resizable: false,
                    is_minimizable: true,
                    kind: WindowKind::Normal,
                    window_background: WindowBackgroundAppearance::Transparent,
                    window_decorations: Some(WindowDecorations::Client),
                    ..WindowOptions::default()
                },
                |window, cx| {
                    let view = cx.new(|_| CaptureToolbarPoc::new());
                    cx.new(|cx| Root::new(view, window, cx))
                },
            )
            .expect("failed to open GPUI toolbar POC window");
        })
        .detach();
    });

    Ok(())
}
