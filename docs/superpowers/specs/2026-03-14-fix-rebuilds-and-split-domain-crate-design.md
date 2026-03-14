# Fix Full Rebuilds & Split moonsnap-domain Crate

**Date:** 2026-03-14
**Status:** Approved

## Problem

Two issues compound to make Rust compilation painfully slow:

1. **Full 877-file rebuilds:** The PostToolUse hook runs `cargo check` with default features, but `tauri dev` runs `cargo run --no-default-features`. This feature mismatch causes Cargo to compile different variants of shared dependencies (`thiserror`, `windows_core`, `windows`, `ffmpeg_sidecar`), creating timestamp divergence that cascades into full workspace rebuilds on every edit.

2. **Broad incremental recompilation:** `moonsnap-domain` contains all data types in a single crate. Any change to domain types recompiles 4 downstream crates (`moonsnap-capture`, `moonsnap-render`, `moonsnap-export`, main crate) even when the change only affects one pipeline.

## Part 1: Fix Full Rebuilds

### Root Cause

Evidence from `CARGO_LOG=cargo::core::compiler::fingerprint=info`:

```
dependency on `thiserror` is newer than we are 13417974155s > 13417022377s "scap-direct3d"
dependency on `windows_core` is newer than we are 13417974159s > 13417022377s "camera-windows"
dependency on `ffmpeg_sidecar` is newer than we are 13417974169s > 13417746359s "moonsnap-media"
```

All 9 internal crates recompile on every `cargo check`, even with zero source changes, because external dependency artifacts have newer timestamps than internal crate artifacts.

The divergence is caused by switching between:
- `tauri dev` → `cargo run --no-default-features` (strips Tauri's default features like `wry`, `compression`, etc.)
- PostToolUse hook → `cargo check` (uses default features)

### Fix

**1a. Align PostToolUse hook flags with `tauri dev`:**

In `.claude/settings.local.json`, change the hook command from:
```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --message-format=short
```
to:
```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --no-default-features --message-format=short
```

**1b. (Secondary) Reduce tauri_build watch surface:**

`tauri_build::build()` emits `cargo:rerun-if-changed` for 97 paths (90 background images, 10 FFmpeg binaries, `tauri.conf.json`, `capabilities/`). While this doesn't cause the cross-feature timestamp issue, it means touching any background image triggers a build script re-run.

Create a dev config overlay `src-tauri/tauri.dev.conf.json` that empties the `bundle.resources` for dev builds:
```json
{
  "bundle": {
    "resources": {}
  }
}
```

Then invoke with: `tauri dev --config src-tauri/tauri.dev.conf.json`

This removes the 90 background images from the watch list during development. They're only needed for release bundles.

## Part 2: Split moonsnap-domain

### Current State

`moonsnap-domain` (2,935 lines, 9 files) contains all data types. Every downstream crate depends on it:

```
moonsnap-domain
  ├── moonsnap-capture (uses: recording.rs, capture.rs, video_project.rs*)
  ├── moonsnap-render  (uses: video_project.rs, captions.rs)
  ├── moonsnap-export  (uses: video_project.rs, captions.rs, video_export.rs)
  └── main crate       (uses: everything)
```

*`moonsnap-capture` uses `VideoProject` only in `create_video_project_file()` — see "Prerequisite Refactor" below.

### Usage Map (from grep analysis)

| Module | moonsnap-capture | moonsnap-render | moonsnap-export | main crate |
|--------|:---:|:---:|:---:|:---:|
| video_project.rs (1,778 lines, 70+ types) | 1 type* | ~15 types | ~20 types | all |
| captions.rs | - | 3 types | 3 types | all |
| recording.rs | 6 types | - | - | all |
| capture.rs | - | - | - | all |
| capture_settings.rs | - | - | - | all |
| webcam.rs | - | - | - | all |
| storage.rs | - | - | - | all |
| video_export.rs | - | - | - | all |

### New Structure

Split into three crates along the product boundary (capture pipeline vs editor pipeline):

```
crates/
  moonsnap-capture-types/   (NEW)
    Cargo.toml
    src/
      lib.rs                (pub mod + re-exports)
      capture.rs            (CaptureResult, MonitorInfo, WindowInfo, etc.)
      capture_settings.rs   (ScreenshotSettings, VideoSettings, etc.)
      recording.rs          (RecordingMode, RecordingSettings, RecordingState, etc.)
      webcam.rs             (WebcamPosition, WebcamSize, WebcamSettings, etc.)

  moonsnap-project-types/   (NEW)
    Cargo.toml
    src/
      lib.rs                (pub mod + re-exports)
      video_project.rs      (VideoProject and all 70+ editor types)
      captions.rs           (CaptionWord, CaptionSegment, CaptionSettings, etc.)

  moonsnap-domain/          (SLIMMED — becomes a facade + main-crate-only types)
    Cargo.toml              (depends on capture-types + project-types, re-exports both)
    src/
      lib.rs                (pub use moonsnap_capture_types::*; pub use moonsnap_project_types::*;)
      storage.rs            (CaptureProject, CaptureListItem, etc. — main crate only)
      video_export.rs       (ExportProgress, ExportResult — main crate only)
```

### Prerequisite Refactor: Move `create_video_project_file` out of moonsnap-capture

`moonsnap-capture` currently imports `VideoProject` solely to create the project metadata file after recording (`recorder_helpers.rs:548`). This function bridges capture and editor concerns. To achieve clean isolation, move `create_video_project_file` and its `CreateVideoProjectRequest` struct from `moonsnap-capture` into the main crate (e.g., `src/commands/video_recording/project_file.rs`). The call site in the recording flow already lives in the main crate's command layer.

After this move, `moonsnap-capture` no longer depends on any `video_project.rs` types.

### Updated Dependency Graph

```
moonsnap-capture-types  ← moonsnap-capture, moonsnap-domain
moonsnap-project-types  ← moonsnap-render, moonsnap-export, moonsnap-domain
moonsnap-domain         ← main crate (re-exports both + owns storage/export types)
```

### Dependencies for New Crates

Both new crates need a subset of `moonsnap-domain`'s current dependencies:

**moonsnap-capture-types:**
- `serde` (with derive)
- `serde_json`
- `ts-rs`

**moonsnap-project-types:**
- `chrono` (with serde)
- `rand`
- `serde` (with derive)
- `serde_json`
- `ts-rs`

### Backwards Compatibility

`moonsnap-domain` re-exports everything from both new crates via `pub use`. All existing `use moonsnap_domain::*` imports in the main crate continue to work unchanged. Only the leaf crates (`moonsnap-capture`, `moonsnap-render`, `moonsnap-export`) get their Cargo.toml updated to depend on the specific sub-crate instead of `moonsnap-domain`.

Note: `video_export.rs` in the slimmed `moonsnap-domain` imports `ExportFormat` from `video_project.rs`. Since `moonsnap-domain` depends on `moonsnap-project-types`, this import resolves through the re-export. The facade is not purely re-exports — it also owns types that depend on the sub-crates.

Existing tests in `moonsnap-domain/src/lib.rs` (`default_values_smoke_test`, `serde_and_geometry_smoke_test`) exercise types from both pipelines. These continue to compile through the re-exports. No test migration needed.

### Recompilation Impact

**Before:** Edit `recording.rs` → recompiles capture + render + export + main (4 crates, ~63K lines)
**After:** Edit `recording.rs` → recompiles capture + main only (2 crates, ~49K lines; render + export untouched)

**Before:** Edit `video_project.rs` → recompiles capture + render + export + main (4 crates, ~63K lines)
**After:** Edit `video_project.rs` → recompiles render + export + main only (3 crates, ~53K lines; capture untouched)

### Migration for ts-rs Type Generation

The `cargo test --lib` command that generates TypeScript types currently targets the workspace root. Since `ts-rs` derives are on the types themselves, they'll move with the files. The test command continues to work because workspace-level `cargo test --lib` runs tests in all member crates.

## Implementation Order

1. Fix the PostToolUse hook — add `--no-default-features` (1 line change, immediate impact)
2. Add `tauri.dev.conf.json` overlay and wire into `package.json` scripts (optional, reduces watch surface)
3. Move `create_video_project_file` from `moonsnap-capture` to main crate (prerequisite for clean split)
4. Create `moonsnap-capture-types` crate, move files, add to workspace `members`, update deps
5. Create `moonsnap-project-types` crate, move files, add to workspace `members`, update deps
6. Slim `moonsnap-domain` to facade + main-crate-only types
7. Verify `cargo test --lib` still generates all TypeScript types
8. Verify `cargo check` caches correctly (zero recompilations on no-op re-run)
9. Verify `tauri dev` builds and runs correctly

### Success Criteria

- `cargo check` with zero source changes shows only `Finished` (no `Checking` lines)
- Editing `recording.rs` triggers recompilation of `moonsnap-capture` + main crate only
- Editing `video_project.rs` triggers recompilation of `moonsnap-render` + `moonsnap-export` + main crate only (not `moonsnap-capture`)
- `cargo test --lib` generates all TypeScript types in `src/types/generated/`
- `tauri dev` launches successfully
