# moonsnap-render

Reusable rendering primitives and interpolation logic for MoonSnap video workflows.

## Scope

- Coordinate spaces and transforms (`coord`)
- Caption/text preparation helpers (`caption_layer`, `text`, `text_layer`)
- Scene/zoom interpolation (`scene`, `zoom`, `ZoomState`)
- Shared normalized-point zoom transform helper (`zoom::apply_zoom_to_normalized_point`)
- Cursor compositing planning helpers (`cursor_plan`, including geometry + raster fallback decisions)
- CPU cursor image compositing primitives (`cursor_composite`)
- Webcam overlay/visibility planning helpers (`webcam_overlay`)
- Render-side composition/background types (`types`, `background`)
- NV12 conversion and parity math (`nv12_converter`, `parity`)

## Usage

```rust
use moonsnap_render::{parity, ZoomState};

let layout = parity::get_parity_layout();
let zoom = ZoomState::identity();
assert!(!zoom.is_zoomed());
```

## Non-goals

- Tauri command handlers
- Export job lifecycle orchestration
- Platform capture backends
