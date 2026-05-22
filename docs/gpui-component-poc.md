# GPUI Component POC

This branch contains a native Rust UI proof of concept for evaluating
`longbridge/gpui-component` without changing the shipping Tauri + React app.

## Run

```bash
bun run gpui:poc
```

The POC lives in:

- `apps/desktop/gpui-poc`

It is intentionally outside the existing desktop Rust workspace. The first
attempt to place it inside `apps/desktop/src-tauri` exposed lockfile conflicts
between GPUI's dependency graph and MoonSnap's production Rust graph before any
UI assumptions could be tested. Keeping the POC standalone lets the GPUI
experiment move independently until there is a concrete service boundary to
share.

## What It Proves

- A GPUI application can live beside the current MoonSnap desktop crate.
- `gpui-component` can render a themed native window using its `Root` view and
  component primitives.
- The POC can model MoonSnap's two highest-risk editor surfaces: the image
  annotation editor and the video editor.
- The image editor shell exercises a dense tool rail, canvas-like GPUI painting,
  annotation overlays, and an inspector panel.
- The video editor shell exercises preview composition, overlay hints,
  inspector state, action controls, and a multi-track timeline.
- The capture toolbar POC opens as a separate transparent GPUI window and
  models the floating glass toolbar chrome, mode selector, source controls,
  device meters, settings/library actions, and primary capture button.
- The experiment can be run from the repo's normal `bun` workflow.
- The production `src-tauri` workspace can remain unchanged while GPUI's
  dependency graph is evaluated.

## What Is Still Unknown

- Whether GPUI can support MoonSnap's always-on-top, skip-taskbar,
  click-through, and multi-monitor overlay behavior without platform-specific
  window hooks.
- How much of the existing `wgpu` preview/export rendering can be embedded in a
  GPUI surface without duplicating the renderer.
- How to replace Tauri plugins for dialogs, updater, filesystem, clipboard,
  global shortcuts, window state, and autostart.
- Whether the Konva annotation editor should be ported to GPUI primitives, a
  custom GPUI canvas, or a shared Rust rendering surface.

## Recommended Next Spike

Wire one real editor input path into the POC:

- Image editor: add pointer-driven shape selection/dragging in the GPUI canvas
  and compare the ergonomics with the current Konva event model.
- Video editor: add timeline scrub state and preview overlay synchronization,
  then compare it with the current React timeline and Rust preview renderer
  boundary.

Those two spikes are better benchmarks than library metadata because they test
the surfaces most likely to decide whether GPUI is viable for MoonSnap.
