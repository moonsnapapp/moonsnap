# MoonSnap Shared Crates

This folder contains reusable Rust libraries extracted from the Tauri app shell.

## Current crates

- `moonsnap-core`: shared error/result/context primitives.
- `moonsnap-domain`: shared domain models that are not Tauri-specific.
- `moonsnap-media`: FFmpeg/probe discovery and media helper utilities.
- `moonsnap-render`: shared rendering math/layout utilities.
- `moonsnap-capture`: reusable capture timing and synchronization primitives.
- `moonsnap-export`: reusable export encoder selection/orchestration primitives.
- `scap-direct3d`: Windows Graphics Capture/D3D abstractions.
- `scap-targets`: display/window target discovery abstractions.
- `camera-windows`: Windows camera capture abstractions.

## Dependency direction

Keep dependencies one-way:

1. `moonsnap-core`
2. `moonsnap-domain` and `moonsnap-media` (can depend on `moonsnap-core`)
3. runtime/engine crates (`scap-*`, `camera-*`, future rendering/recording crates)
4. app shell (`moonsnap` crate with Tauri commands, plugins, windows, and IPC wiring)

`moonsnap` should remain an integration layer, not the source of reusable business logic.

## Migration order

1. Move shared primitives into `moonsnap-core`.
2. Move reusable DTO/domain types into `moonsnap-domain`.
3. Move FFmpeg/media helpers into `moonsnap-media`.
4. Extract rendering and recording engines into dedicated crates.
5. Keep only Tauri adapters/registration in the app shell.

See the detailed phased roadmap in [`LIB_EXTRACTION_PLAN.md`](./LIB_EXTRACTION_PLAN.md).
Versioning and compatibility rules live in [`SEMVER_POLICY.md`](./SEMVER_POLICY.md).
