use crate::colors::*;
use gpui::*;

pub fn paint_workspace_texture(bounds: Bounds<Pixels>, window: &mut Window) {
    let dot = hsla(0.0, 0.0, 1.0, 0.055);
    let mut x = bounds.origin.x + px(18.0);
    while x < bounds.origin.x + bounds.size.width {
        let mut y = bounds.origin.y + px(18.0);
        while y < bounds.origin.y + bounds.size.height {
            window.paint_quad(fill(
                Bounds::new(
                    Point::new(x, y),
                    Size {
                        width: px(1.0),
                        height: px(1.0),
                    },
                ),
                dot,
            ));
            y += px(24.0);
        }
        x += px(24.0);
    }
}

pub fn paint_image_canvas(bounds: Bounds<Pixels>, window: &mut Window) {
    let artboard = centered_rect(bounds, 0.58, 0.66);
    window.paint_quad(fill(artboard, hsla(0.0, 0.0, 0.0, 1.0)));

    let header_y = artboard.origin.y + px(74.0);
    let card = Bounds::new(
        Point::new(artboard.origin.x + px(52.0), header_y + px(40.0)),
        Size {
            width: artboard.size.width * 0.43,
            height: artboard.size.width * 0.43,
        },
    );
    window.paint_quad(fill(card, hsla(0.0, 0.0, 0.10, 1.0)).corner_radii(px(9.0)));
    paint_cat_art(card, window);

    let badge = Bounds::new(
        Point::new(card.origin.x + px(10.0), card.origin.y + px(10.0)),
        Size {
            width: px(34.0),
            height: px(28.0),
        },
    );
    window.paint_quad(fill(badge, coral()).corner_radii(px(8.0)));

    let close = Bounds::new(
        Point::new(
            card.origin.x + card.size.width - px(36.0),
            card.origin.y + px(10.0),
        ),
        Size {
            width: px(28.0),
            height: px(28.0),
        },
    );
    window.paint_quad(fill(close, hsla(0.0, 0.66, 0.48, 1.0)).corner_radii(px(8.0)));

    let drop = Bounds::new(
        Point::new(
            artboard.origin.x + artboard.size.width * 0.52,
            header_y + px(40.0),
        ),
        Size {
            width: artboard.size.width * 0.43,
            height: card.size.height + px(170.0),
        },
    );
    window.paint_quad(fill(drop, hsla(0.0, 0.0, 0.02, 1.0)).corner_radii(px(10.0)));
    dashed_outline(window, drop, hsla(0.0, 0.0, 1.0, 0.13));

    let icon = Bounds::new(
        Point::new(
            drop.origin.x + drop.size.width / 2.0 - px(17.0),
            drop.origin.y + px(82.0),
        ),
        Size {
            width: px(34.0),
            height: px(34.0),
        },
    );
    outline(window, icon, hsla(0.0, 0.0, 0.72, 1.0), 3.0);

    let select = Bounds::new(
        Point::new(
            drop.origin.x + drop.size.width / 2.0 - px(78.0),
            drop.origin.y + drop.size.height * 0.60,
        ),
        Size {
            width: px(156.0),
            height: px(44.0),
        },
    );
    window.paint_quad(fill(select, hsla(0.0, 0.0, 0.055, 1.0)).corner_radii(px(6.0)));
    outline(window, select, hsla(0.0, 0.0, 1.0, 0.10), 1.0);

    let controls = Bounds::new(
        Point::new(
            bounds.origin.x + bounds.size.width / 2.0 - px(154.0),
            bounds.origin.y + bounds.size.height - px(56.0),
        ),
        Size {
            width: px(308.0),
            height: px(36.0),
        },
    );
    window.paint_quad(fill(controls, hsla(0.62, 0.10, 0.065, 0.98)).corner_radii(px(12.0)));
    outline(window, controls, border(), 1.0);
}

pub fn paint_video_preview(bounds: Bounds<Pixels>, window: &mut Window) {
    let frame = centered_rect(bounds, 0.76, 0.78);
    window.paint_quad(fill(frame, hsla(0.61, 0.09, 0.08, 1.0)).corner_radii(px(14.0)));
    outline(window, frame, hsla(0.0, 0.0, 1.0, 0.14), 1.0);

    let video = inset(frame, 38.0, 34.0);
    window.paint_quad(fill(video, hsla(0.57, 0.22, 0.20, 1.0)).corner_radii(px(9.0)));
    paint_video_content(video, window);

    let zoom = Bounds::new(
        Point::new(
            video.origin.x + video.size.width * 0.50,
            video.origin.y + px(52.0),
        ),
        Size {
            width: video.size.width * 0.34,
            height: video.size.height * 0.40,
        },
    );
    window.paint_quad(fill(zoom, hsla(0.55, 0.88, 0.58, 0.16)).corner_radii(px(10.0)));
    outline(window, zoom, hsla(0.55, 0.82, 0.62, 1.0), 2.0);

    let caption = Bounds::new(
        Point::new(
            video.origin.x + video.size.width * 0.22,
            video.origin.y + video.size.height - px(82.0),
        ),
        Size {
            width: video.size.width * 0.56,
            height: px(42.0),
        },
    );
    window.paint_quad(fill(caption, hsla(0.0, 0.0, 0.0, 0.74)).corner_radii(px(10.0)));
}

pub fn paint_thumb(bounds: Bounds<Pixels>, selected: bool, ix: usize, window: &mut Window) {
    let inner = inset(bounds, 8.0, 8.0);
    window.paint_quad(fill(inner, hsla(0.62, 0.12, 0.035, 1.0)).corner_radii(px(10.0)));
    if selected {
        let preview = inset(inner, 12.0, 16.0);
        window.paint_quad(fill(preview, hsla(0.0, 0.0, 0.0, 1.0)).corner_radii(px(8.0)));
        let image = Bounds::new(
            Point::new(preview.origin.x + px(14.0), preview.origin.y + px(26.0)),
            Size {
                width: preview.size.width * 0.44,
                height: preview.size.width * 0.44,
            },
        );
        paint_cat_art(image, window);

        let drop = Bounds::new(
            Point::new(
                preview.origin.x + preview.size.width * 0.58,
                preview.origin.y + px(26.0),
            ),
            Size {
                width: preview.size.width * 0.34,
                height: preview.size.height * 0.62,
            },
        );
        window.paint_quad(fill(drop, hsla(0.0, 0.0, 0.015, 1.0)).corner_radii(px(6.0)));
        dashed_outline(window, drop, hsla(0.0, 0.0, 1.0, 0.13));
    } else {
        let hue = match ix {
            0 => 0.56,
            1 => 0.12,
            _ => 0.08,
        };
        for row in 0..8 {
            let strip = Bounds::new(
                Point::new(
                    inner.origin.x + px(12.0),
                    inner.origin.y + px(18.0 + row as f32 * 20.0),
                ),
                Size {
                    width: inner.size.width - px(24.0),
                    height: px(12.0),
                },
            );
            window.paint_quad(
                fill(strip, hsla(hue, 0.28, 0.18 + row as f32 * 0.014, 1.0)).corner_radii(px(3.0)),
            );
        }
    }
}

fn paint_cat_art(bounds: Bounds<Pixels>, window: &mut Window) {
    window.paint_quad(fill(bounds, hsla(0.76, 0.64, 0.28, 1.0)).corner_radii(px(9.0)));
    window.paint_quad(
        fill(
            centered_rect(bounds, 0.78, 0.78),
            hsla(0.75, 0.82, 0.48, 0.62),
        )
        .corner_radii(px(90.0)),
    );

    let face = Bounds::new(
        Point::new(
            bounds.origin.x + bounds.size.width * 0.28,
            bounds.origin.y + bounds.size.height * 0.28,
        ),
        Size {
            width: bounds.size.width * 0.44,
            height: bounds.size.height * 0.34,
        },
    );
    window.paint_quad(fill(face, hsla(0.56, 0.58, 0.86, 1.0)).corner_radii(px(70.0)));

    let book = Bounds::new(
        Point::new(
            bounds.origin.x + bounds.size.width * 0.18,
            bounds.origin.y + bounds.size.height * 0.68,
        ),
        Size {
            width: bounds.size.width * 0.64,
            height: bounds.size.height * 0.18,
        },
    );
    window.paint_quad(fill(book, hsla(0.10, 0.90, 0.62, 1.0)).corner_radii(px(12.0)));
}

fn paint_video_content(video: Bounds<Pixels>, window: &mut Window) {
    let mut x = video.origin.x + px(40.0);
    while x < video.origin.x + video.size.width - px(40.0) {
        let column = Bounds::new(
            Point::new(x, video.origin.y + px(70.0)),
            Size {
                width: px(44.0),
                height: video.size.height - px(150.0),
            },
        );
        window.paint_quad(fill(column, hsla(0.57, 0.24, 0.28, 1.0)).corner_radii(px(6.0)));
        x += px(76.0);
    }
}

fn centered_rect(bounds: Bounds<Pixels>, width_pct: f32, height_pct: f32) -> Bounds<Pixels> {
    let width = bounds.size.width * width_pct;
    let height = bounds.size.height * height_pct;
    Bounds::new(
        Point::new(
            bounds.origin.x + (bounds.size.width - width) / 2.0,
            bounds.origin.y + (bounds.size.height - height) / 2.0,
        ),
        Size { width, height },
    )
}

fn inset(bounds: Bounds<Pixels>, x: f32, y: f32) -> Bounds<Pixels> {
    Bounds::new(
        Point::new(bounds.origin.x + px(x), bounds.origin.y + px(y)),
        Size {
            width: bounds.size.width - px(x * 2.0),
            height: bounds.size.height - px(y * 2.0),
        },
    )
}

fn dashed_outline(window: &mut Window, bounds: Bounds<Pixels>, color: Hsla) {
    let dash = px(9.0);
    let gap = px(7.0);
    let mut x = bounds.origin.x;
    while x < bounds.origin.x + bounds.size.width {
        line(
            window,
            Point::new(x, bounds.origin.y),
            Point::new(
                (x + dash).min(bounds.origin.x + bounds.size.width),
                bounds.origin.y,
            ),
            color,
            2.0,
        );
        line(
            window,
            Point::new(x, bounds.origin.y + bounds.size.height),
            Point::new(
                (x + dash).min(bounds.origin.x + bounds.size.width),
                bounds.origin.y + bounds.size.height,
            ),
            color,
            2.0,
        );
        x += dash + gap;
    }
    let mut y = bounds.origin.y;
    while y < bounds.origin.y + bounds.size.height {
        line(
            window,
            Point::new(bounds.origin.x, y),
            Point::new(
                bounds.origin.x,
                (y + dash).min(bounds.origin.y + bounds.size.height),
            ),
            color,
            2.0,
        );
        line(
            window,
            Point::new(bounds.origin.x + bounds.size.width, y),
            Point::new(
                bounds.origin.x + bounds.size.width,
                (y + dash).min(bounds.origin.y + bounds.size.height),
            ),
            color,
            2.0,
        );
        y += dash + gap;
    }
}

fn outline(window: &mut Window, bounds: Bounds<Pixels>, color: Hsla, width: f32) {
    let left = bounds.origin.x;
    let top = bounds.origin.y;
    let right = bounds.origin.x + bounds.size.width;
    let bottom = bounds.origin.y + bounds.size.height;
    line(
        window,
        Point::new(left, top),
        Point::new(right, top),
        color,
        width,
    );
    line(
        window,
        Point::new(right, top),
        Point::new(right, bottom),
        color,
        width,
    );
    line(
        window,
        Point::new(right, bottom),
        Point::new(left, bottom),
        color,
        width,
    );
    line(
        window,
        Point::new(left, bottom),
        Point::new(left, top),
        color,
        width,
    );
}

fn line(window: &mut Window, start: Point<Pixels>, end: Point<Pixels>, color: Hsla, width: f32) {
    let mut builder = PathBuilder::stroke(px(width));
    builder.move_to(start);
    builder.line_to(end);
    if let Ok(path) = builder.build() {
        window.paint_path(path, color);
    }
}
