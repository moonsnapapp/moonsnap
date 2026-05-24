"""Regenerate MoonSnap app icons in the graphite palette.

Reads the existing red aperture logo and recolors it:
  - red gradient background  -> diagonal graphite gradient
  - white aperture glyph     -> near-black

Uses min(G, B) per-pixel as the glyph mask. On the saturated red background
this value is low; on the white glyph it is high; on anti-aliased edges it
is intermediate, giving a smooth recolor without re-rasterizing the shape.
"""
from __future__ import annotations

import os
from PIL import Image

ROOT = r"E:\moonsnap"
TAURI_ICONS = os.path.join(ROOT, "apps", "desktop", "src-tauri", "icons")
WEB_PUBLIC = os.path.join(ROOT, "apps", "web", "public")
WEB_APP = os.path.join(ROOT, "apps", "web", "src", "app")

# Pick the highest-resolution source we have. Skip .icns: Pillow's ICNS
# reader exposes size as (w, h, scale) which trips up downstream code paths.
SOURCE_CANDIDATES = [
    os.path.join(TAURI_ICONS, "icon.ico"),
    os.path.join(TAURI_ICONS, "128x128@2x.png"),
]

# Graphite palette (matches desktop --coral-* and web --accent-*).
# Top-down gradient: lifted graphite at top, darker mid-graphite at bottom.
TOP = (210, 215, 222)   # lifted, slightly cool
BOTTOM = (108, 116, 130)  # between --coral-500 and --coral-600
GLYPH = (20, 22, 26)    # slightly off-black


def load_source() -> Image.Image:
    for path in SOURCE_CANDIDATES:
        if not os.path.exists(path):
            continue
        im = Image.open(path)
        # .icns / .ico can hold multiple frames; pick the largest.
        if hasattr(im, "info") and "sizes" in im.info:
            sizes = im.info["sizes"]
            if sizes:
                biggest = max(sizes)
                im.size = biggest  # type: ignore[attr-defined]
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        # Force a clean RGBA copy so .size becomes the canonical (w, h).
        im = im.copy()
        # If it has multiple frames (ICO), seek to largest.
        try:
            n_frames = getattr(im, "n_frames", 1)
        except Exception:
            n_frames = 1
        if n_frames > 1:
            best = im
            best_area = im.size[0] * im.size[1]
            for i in range(n_frames):
                im.seek(i)
                frame = im.convert("RGBA")
                if frame.size[0] * frame.size[1] > best_area:
                    best = frame.copy()
                    best_area = frame.size[0] * frame.size[1]
            im = best
        print(f"source: {path} {im.size}")
        return im
    raise FileNotFoundError("no source icon found")


def render_master(src: Image.Image, size: int) -> Image.Image:
    """Recolor src and resample to (size, size)."""
    # Work at source resolution then downscale (avoids upscaling artifacts on small sources).
    work_size = max(src.size[0], size)
    if src.size[0] != work_size:
        src = src.resize((work_size, work_size), Image.LANCZOS)

    w, h = src.size
    src_data = src.load()
    out = Image.new("RGBA", (w, h))
    out_data = out.load()

    inv = 1.0 / 255.0
    for y in range(h):
        for x in range(w):
            r, g, b, a = src_data[x, y]
            if a == 0:
                out_data[x, y] = (0, 0, 0, 0)
                continue
            glyph = min(g, b) * inv  # 0 on bg, ~1 on white glyph
            t = y / (h - 1)  # top-down gradient
            bg_r = TOP[0] + (BOTTOM[0] - TOP[0]) * t
            bg_g = TOP[1] + (BOTTOM[1] - TOP[1]) * t
            bg_b = TOP[2] + (BOTTOM[2] - TOP[2]) * t

            out_r = bg_r + (GLYPH[0] - bg_r) * glyph
            out_g = bg_g + (GLYPH[1] - bg_g) * glyph
            out_b = bg_b + (GLYPH[2] - bg_b) * glyph

            out_data[x, y] = (int(out_r + 0.5), int(out_g + 0.5), int(out_b + 0.5), a)

    if w != size:
        out = out.resize((size, size), Image.LANCZOS)
    return out


def main() -> None:
    src = load_source()

    targets: list[tuple[str, int]] = [
        (os.path.join(TAURI_ICONS, "32x32.png"), 32),
        (os.path.join(TAURI_ICONS, "128x128.png"), 128),
        (os.path.join(TAURI_ICONS, "128x128@2x.png"), 256),
        (os.path.join(TAURI_ICONS, "icon.png"), 128),
        (os.path.join(TAURI_ICONS, "Square30x30Logo.png"), 30),
        (os.path.join(TAURI_ICONS, "Square44x44Logo.png"), 44),
        (os.path.join(TAURI_ICONS, "Square71x71Logo.png"), 71),
        (os.path.join(TAURI_ICONS, "Square89x89Logo.png"), 89),
        (os.path.join(TAURI_ICONS, "Square107x107Logo.png"), 107),
        (os.path.join(TAURI_ICONS, "Square142x142Logo.png"), 142),
        (os.path.join(TAURI_ICONS, "Square150x150Logo.png"), 150),
        (os.path.join(TAURI_ICONS, "Square284x284Logo.png"), 284),
        (os.path.join(TAURI_ICONS, "Square310x310Logo.png"), 310),
        (os.path.join(TAURI_ICONS, "StoreLogo.png"), 50),
        (os.path.join(WEB_PUBLIC, "app-icon.png"), 128),
        (os.path.join(WEB_APP, "icon.png"), 32),
    ]

    # Render the largest first as a master, then downsample for each target
    # so antialiasing is consistent.
    master = render_master(src, 512)
    master.save(os.path.join(ROOT, "scripts", "new-icon-master.png"))

    for path, size in targets:
        if size == 512:
            im = master
        else:
            im = master.resize((size, size), Image.LANCZOS)
        im.save(path)
        print(f"wrote {path} ({size}x{size})")

    # Multi-resolution .ico (Windows expects this).
    ico_path = os.path.join(TAURI_ICONS, "icon.ico")
    master.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote {ico_path} (multi-res ICO)")

    # .icns — Pillow supports writing on Pillow >= 9.x via the ICNS encoder.
    icns_path = os.path.join(TAURI_ICONS, "icon.icns")
    try:
        master.save(icns_path, format="ICNS")
        print(f"wrote {icns_path}")
    except Exception as exc:
        print(f"WARN: could not write {icns_path}: {exc}")


if __name__ == "__main__":
    main()
