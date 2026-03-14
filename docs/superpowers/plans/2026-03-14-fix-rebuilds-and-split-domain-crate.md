# Fix Rebuilds & Split Domain Crate — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate spurious full workspace rebuilds and split `moonsnap-domain` into focused crates to reduce incremental recompilation cascades.

**Architecture:** Part 1 fixes a feature-flag mismatch between the PostToolUse hook and `tauri dev` that poisons Cargo's fingerprint cache. Part 2 splits domain types along the capture/editor boundary, with a facade crate for backwards compatibility. A prerequisite refactor moves `create_video_project_file` out of `moonsnap-capture` to break its dependency on editor types.

**Tech Stack:** Rust workspace (Cargo), Tauri v2, ts-rs for TypeScript codegen

**Spec:** `docs/superpowers/specs/2026-03-14-fix-rebuilds-and-split-domain-crate-design.md`

---

## Task 1: Fix PostToolUse Hook Feature Mismatch

**Files:**
- Modify: `.claude/settings.local.json:191`

- [ ] **Step 1: Edit the hook command**

In `.claude/settings.local.json`, change line 191 from:
```json
"command": "if [[ \"$CLAUDE_FILE_PATHS\" == *.rs ]]; then cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --message-format=short 2>&1 | head -30; fi"
```
to:
```json
"command": "if [[ \"$CLAUDE_FILE_PATHS\" == *.rs ]]; then cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --no-default-features --message-format=short 2>&1 | head -30; fi"
```

- [ ] **Step 2: Clean stale fingerprints and rebuild**

```bash
cd apps/desktop/src-tauri && cargo clean && cargo check --no-default-features
```

Expected: Compiles ~291 crates, then `Finished`.

- [ ] **Step 3: Verify cache holds**

```bash
cd apps/desktop/src-tauri && cargo check --no-default-features 2>&1 | grep "Checking\|Compiling\|Finished"
```

Expected: Only `Finished` line, no `Checking` or `Compiling`.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.local.json
git commit -m "fix: align PostToolUse cargo check with tauri dev feature flags"
```

---

## Task 2: Move `create_video_project_file` from moonsnap-capture to Main Crate

**Files:**
- Modify: `apps/desktop/src-tauri/crates/moonsnap-capture/src/recorder_helpers.rs` (remove lines 8-9, 530-601, update doc comment)
- Create: `apps/desktop/src-tauri/src/commands/video_recording/project_file.rs`
- Modify: `apps/desktop/src-tauri/src/commands/video_recording/mod.rs` (add `mod project_file;`)
- Modify: `apps/desktop/src-tauri/src/commands/video_recording/recorder/video.rs:14-17` (update import)

- [ ] **Step 1: Create `project_file.rs` in the main crate**

Create `apps/desktop/src-tauri/src/commands/video_recording/project_file.rs`:

```rust
//! Video project file creation after recording.

use std::path::Path;

use moonsnap_domain::video_project::VideoProject;

/// Request to create a project.json file after recording.
pub struct CreateVideoProjectRequest<'a> {
    pub project_folder: &'a Path,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
    pub fps: u32,
    pub quick_capture: bool,
    pub has_webcam: bool,
    pub has_cursor_data: bool,
    pub has_system_audio: bool,
    pub has_mic_audio: bool,
}

/// Create a project.json file in the video project folder.
///
/// This creates the VideoProject metadata file that allows the video editor
/// to load and edit the recording with all its associated files.
pub fn create_video_project_file(request: CreateVideoProjectRequest<'_>) -> Result<(), String> {
    let screen_video = "screen.mp4".to_string();

    let mut project = VideoProject::new(
        &screen_video,
        request.width,
        request.height,
        request.duration_ms,
        request.fps,
    );
    project.quick_capture = request.quick_capture;

    if let Some(folder_name) = request.project_folder.file_name() {
        let folder_name = folder_name.to_string_lossy().to_string();
        project.name = folder_name.clone();
        project.original_file_name = if request.quick_capture {
            Some(format!("{}.mp4", folder_name))
        } else {
            None
        };
    }

    if request.has_webcam {
        project.sources.webcam_video = Some("webcam.mp4".to_string());
        project.webcam.enabled = true;
    }

    if request.has_cursor_data {
        project.sources.cursor_data = Some("cursor.json".to_string());
    }

    if request.has_system_audio {
        project.sources.system_audio = Some("system.wav".to_string());
    }

    if request.has_mic_audio {
        project.sources.microphone_audio = Some("mic.wav".to_string());
    }

    let project_file = request.project_folder.join("project.json");
    project.save(&project_file)?;

    log::info!(
        "[PROJECT] Created project.json in {:?}",
        request.project_folder
    );

    Ok(())
}
```

- [ ] **Step 2: Register the module**

In `apps/desktop/src-tauri/src/commands/video_recording/mod.rs`, add:

```rust
pub mod project_file;
```

- [ ] **Step 3: Update the call site import**

In `apps/desktop/src-tauri/src/commands/video_recording/recorder/video.rs`, change:

```rust
use moonsnap_capture::recorder_helpers::{
    create_video_project_file, get_window_rect, make_video_faststart, mux_audio_to_video,
    CreateVideoProjectRequest,
};
```

to:

```rust
use moonsnap_capture::recorder_helpers::{
    get_window_rect, make_video_faststart, mux_audio_to_video,
};
use super::super::project_file::{create_video_project_file, CreateVideoProjectRequest};
```

- [ ] **Step 4: Remove function from moonsnap-capture**

In `apps/desktop/src-tauri/crates/moonsnap-capture/src/recorder_helpers.rs`:

1. Remove the import `use moonsnap_domain::video_project::VideoProject;` (line 9)
2. Remove `CreateVideoProjectRequest` struct and `create_video_project_file` function (lines 530-601)
3. Update the module doc comment (line 4) — remove "and project file creation"

- [ ] **Step 5: Verify no other references to VideoProject in moonsnap-capture**

```bash
cd apps/desktop/src-tauri && grep -r "video_project\|VideoProject" crates/moonsnap-capture/src/
```

Expected: No matches.

- [ ] **Step 6: Build check**

```bash
cd apps/desktop/src-tauri && cargo check --no-default-features
```

Expected: Compiles successfully.

- [ ] **Step 7: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test --lib
```

Expected: All tests pass (including ts-rs type generation).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/video_recording/project_file.rs \
       apps/desktop/src-tauri/src/commands/video_recording/mod.rs \
       apps/desktop/src-tauri/src/commands/video_recording/recorder/video.rs \
       apps/desktop/src-tauri/crates/moonsnap-capture/src/recorder_helpers.rs
git commit -m "refactor: move create_video_project_file from moonsnap-capture to main crate"
```

---

## Task 3: Create `moonsnap-capture-types` Crate

**Files:**
- Create: `apps/desktop/src-tauri/crates/moonsnap-capture-types/Cargo.toml`
- Create: `apps/desktop/src-tauri/crates/moonsnap-capture-types/src/lib.rs`
- Move: `apps/desktop/src-tauri/crates/moonsnap-domain/src/capture.rs` → `moonsnap-capture-types/src/`
- Move: `apps/desktop/src-tauri/crates/moonsnap-domain/src/capture_settings.rs` → `moonsnap-capture-types/src/`
- Move: `apps/desktop/src-tauri/crates/moonsnap-domain/src/recording.rs` → `moonsnap-capture-types/src/`
- Move: `apps/desktop/src-tauri/crates/moonsnap-domain/src/webcam.rs` → `moonsnap-capture-types/src/`
- Modify: `apps/desktop/src-tauri/Cargo.toml:9-21` (add to workspace members)
- Modify: `apps/desktop/src-tauri/crates/moonsnap-capture/Cargo.toml:19` (change dep from moonsnap-domain to moonsnap-capture-types)

- [ ] **Step 1: Create the Cargo.toml**

Create `apps/desktop/src-tauri/crates/moonsnap-capture-types/Cargo.toml`:

```toml
[package]
name = "moonsnap-capture-types"
version = "0.1.0"
edition = "2021"
license = "MIT"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ts-rs = "10"
```

- [ ] **Step 2: Move source files**

```bash
cd apps/desktop/src-tauri
mkdir -p crates/moonsnap-capture-types/src
cp crates/moonsnap-domain/src/capture.rs crates/moonsnap-capture-types/src/
cp crates/moonsnap-domain/src/capture_settings.rs crates/moonsnap-capture-types/src/
cp crates/moonsnap-domain/src/recording.rs crates/moonsnap-capture-types/src/
cp crates/moonsnap-domain/src/webcam.rs crates/moonsnap-capture-types/src/
```

Note: We copy first, then remove from moonsnap-domain after the facade is set up (Task 5).

- [ ] **Step 3: Create lib.rs**

Create `apps/desktop/src-tauri/crates/moonsnap-capture-types/src/lib.rs`:

```rust
pub mod capture;
pub mod capture_settings;
pub mod recording;
pub mod webcam;
```

- [ ] **Step 4: Fix any `crate::` imports in moved files**

Check each moved file for `use crate::` imports. These files should be self-contained (no cross-references to other domain modules). Verify:

```bash
grep -n "use crate::" crates/moonsnap-capture-types/src/*.rs
```

Expected: Only intra-crate references (e.g., `capture_settings.rs` uses `crate::recording::GifQualityPreset`). These resolve correctly because both files live in the same new crate. No cross-crate `crate::` references should exist.

- [ ] **Step 5: Add to workspace members**

In `apps/desktop/src-tauri/Cargo.toml`, add `"crates/moonsnap-capture-types"` to the `[workspace] members` list:

```toml
[workspace]
members = [
    ".",
    "crates/camera-windows",
    "crates/moonsnap-hotkeys",
    "crates/moonsnap-capture",
    "crates/moonsnap-capture-types",
    "crates/scap-direct3d",
    "crates/scap-targets",
    "crates/moonsnap-core",
    "crates/moonsnap-domain",
    "crates/moonsnap-media",
    "crates/moonsnap-render",
    "crates/moonsnap-export",
]
```

- [ ] **Step 6: Update moonsnap-capture to depend on moonsnap-capture-types**

In `apps/desktop/src-tauri/crates/moonsnap-capture/Cargo.toml`, change:

```toml
moonsnap-domain = { path = "../moonsnap-domain" }
```

to:

```toml
moonsnap-capture-types = { path = "../moonsnap-capture-types" }
```

- [ ] **Step 7: Update moonsnap-capture imports**

In all files under `crates/moonsnap-capture/src/`, replace `moonsnap_domain::recording` with `moonsnap_capture_types::recording`. The affected files:

- `audio_wasapi.rs:15` — `use moonsnap_domain::recording::AudioOutputDevice` → `use moonsnap_capture_types::recording::AudioOutputDevice`
- `recorder_cursor_region.rs:6,88` — same pattern
- `ffmpeg_gif_encoder.rs:11` — same pattern
- `recorder_gif.rs:17` — same pattern
- `recorder_progress.rs:3,33` — same pattern
- `recorder_video_capture.rs:5,137` — same pattern
- `recorder_helpers.rs:8` — same pattern
- `recorder_video_loop.rs:11` — same pattern
- `state.rs:15,347` — same pattern
- `lib.rs:62` (test) — same pattern

Run a bulk replace:

```bash
cd apps/desktop/src-tauri
find crates/moonsnap-capture/src -name "*.rs" -exec sed -i 's/moonsnap_domain::recording/moonsnap_capture_types::recording/g' {} +
```

- [ ] **Step 8: Build check**

```bash
cd apps/desktop/src-tauri && cargo check --no-default-features -p moonsnap-capture-types -p moonsnap-capture
```

Expected: Both crates compile successfully.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src-tauri/crates/moonsnap-capture-types/ \
       apps/desktop/src-tauri/crates/moonsnap-capture/ \
       apps/desktop/src-tauri/Cargo.toml \
       apps/desktop/src-tauri/Cargo.lock
git commit -m "refactor: create moonsnap-capture-types crate, update moonsnap-capture deps"
```

---

## Task 4: Create `moonsnap-project-types` Crate

**Files:**
- Create: `apps/desktop/src-tauri/crates/moonsnap-project-types/Cargo.toml`
- Create: `apps/desktop/src-tauri/crates/moonsnap-project-types/src/lib.rs`
- Move: `apps/desktop/src-tauri/crates/moonsnap-domain/src/video_project.rs` → `moonsnap-project-types/src/`
- Move: `apps/desktop/src-tauri/crates/moonsnap-domain/src/captions.rs` → `moonsnap-project-types/src/`
- Modify: `apps/desktop/src-tauri/Cargo.toml:9-22` (add to workspace members)
- Modify: `apps/desktop/src-tauri/crates/moonsnap-render/Cargo.toml:14` (change dep)
- Modify: `apps/desktop/src-tauri/crates/moonsnap-export/Cargo.toml:9` (change dep)

- [ ] **Step 1: Create the Cargo.toml**

Create `apps/desktop/src-tauri/crates/moonsnap-project-types/Cargo.toml`:

```toml
[package]
name = "moonsnap-project-types"
version = "0.1.0"
edition = "2021"
license = "MIT"

[dependencies]
chrono = { version = "0.4", features = ["serde"] }
rand = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ts-rs = "10"
```

- [ ] **Step 2: Move source files**

```bash
cd apps/desktop/src-tauri
mkdir -p crates/moonsnap-project-types/src
cp crates/moonsnap-domain/src/video_project.rs crates/moonsnap-project-types/src/
cp crates/moonsnap-domain/src/captions.rs crates/moonsnap-project-types/src/
```

- [ ] **Step 3: Create lib.rs**

Create `apps/desktop/src-tauri/crates/moonsnap-project-types/src/lib.rs`:

```rust
pub mod captions;
pub mod video_project;
```

- [ ] **Step 4: Fix any `crate::` imports in moved files**

```bash
grep -n "use crate::" crates/moonsnap-project-types/src/*.rs
```

Expected: Only intra-crate references (e.g., `video_project.rs` uses `crate::captions::{CaptionSegment, CaptionSettings}`). These resolve correctly because both files live in the same new crate.

- [ ] **Step 5: Add to workspace members**

In `apps/desktop/src-tauri/Cargo.toml`, add `"crates/moonsnap-project-types"` to the members list (after `moonsnap-capture-types`).

- [ ] **Step 6: Update moonsnap-render to depend on moonsnap-project-types**

In `apps/desktop/src-tauri/crates/moonsnap-render/Cargo.toml`, change:

```toml
moonsnap-domain = { path = "../moonsnap-domain" }
```

to:

```toml
moonsnap-project-types = { path = "../moonsnap-project-types" }
```

- [ ] **Step 7: Update moonsnap-render imports**

In all files under `crates/moonsnap-render/src/`, replace `moonsnap_domain` with `moonsnap_project_types`:

```bash
cd apps/desktop/src-tauri
find crates/moonsnap-render/src -name "*.rs" -exec sed -i 's/moonsnap_domain::/moonsnap_project_types::/g' {} +
```

- [ ] **Step 8: Update moonsnap-export to depend on moonsnap-project-types**

In `apps/desktop/src-tauri/crates/moonsnap-export/Cargo.toml`, change:

```toml
moonsnap-domain = { path = "../moonsnap-domain" }
```

to:

```toml
moonsnap-project-types = { path = "../moonsnap-project-types" }
```

- [ ] **Step 9: Update moonsnap-export imports**

```bash
cd apps/desktop/src-tauri
find crates/moonsnap-export/src -name "*.rs" -exec sed -i 's/moonsnap_domain::/moonsnap_project_types::/g' {} +
```

- [ ] **Step 10: Build check**

```bash
cd apps/desktop/src-tauri && cargo check --no-default-features -p moonsnap-project-types -p moonsnap-render -p moonsnap-export
```

Expected: All three crates compile successfully.

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src-tauri/crates/moonsnap-project-types/ \
       apps/desktop/src-tauri/crates/moonsnap-render/ \
       apps/desktop/src-tauri/crates/moonsnap-export/ \
       apps/desktop/src-tauri/Cargo.toml \
       apps/desktop/src-tauri/Cargo.lock
git commit -m "refactor: create moonsnap-project-types crate, update render and export deps"
```

---

## Task 5: Slim moonsnap-domain to Facade

**Files:**
- Modify: `apps/desktop/src-tauri/crates/moonsnap-domain/Cargo.toml` (add deps on sub-crates, remove moved deps)
- Modify: `apps/desktop/src-tauri/crates/moonsnap-domain/src/lib.rs` (replace `pub mod` with re-exports)
- Delete: `apps/desktop/src-tauri/crates/moonsnap-domain/src/capture.rs`
- Delete: `apps/desktop/src-tauri/crates/moonsnap-domain/src/capture_settings.rs`
- Delete: `apps/desktop/src-tauri/crates/moonsnap-domain/src/recording.rs`
- Delete: `apps/desktop/src-tauri/crates/moonsnap-domain/src/webcam.rs`
- Delete: `apps/desktop/src-tauri/crates/moonsnap-domain/src/video_project.rs`
- Delete: `apps/desktop/src-tauri/crates/moonsnap-domain/src/captions.rs`
- Modify: `apps/desktop/src-tauri/crates/moonsnap-domain/src/video_export.rs:6` (fix import)

- [ ] **Step 1: Update Cargo.toml**

Replace `apps/desktop/src-tauri/crates/moonsnap-domain/Cargo.toml` with:

```toml
[package]
name = "moonsnap-domain"
version = "0.1.0"
edition = "2021"
license = "MIT"

[dependencies]
chrono = { version = "0.4", features = ["serde"] }
moonsnap-capture-types = { path = "../moonsnap-capture-types" }
moonsnap-project-types = { path = "../moonsnap-project-types" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ts-rs = "10"

[dev-dependencies]
```

Note: `chrono` is still needed directly because `storage.rs` uses `chrono::{DateTime, Utc}`. `rand` is no longer needed — it moved to `moonsnap-project-types`.

- [ ] **Step 2: Remove moved source files**

```bash
cd apps/desktop/src-tauri/crates/moonsnap-domain/src
rm capture.rs capture_settings.rs recording.rs webcam.rs video_project.rs captions.rs
```

- [ ] **Step 3: Fix video_export.rs import**

In `apps/desktop/src-tauri/crates/moonsnap-domain/src/video_export.rs`, change line 6:

```rust
use crate::video_project::ExportFormat;
```

to:

```rust
use moonsnap_project_types::video_project::ExportFormat;
```

- [ ] **Step 4: Rewrite lib.rs as facade**

Replace `apps/desktop/src-tauri/crates/moonsnap-domain/src/lib.rs` with:

```rust
//! Shared domain models used by MoonSnap backend and frontend type generation.
//!
//! This crate re-exports types from focused sub-crates and owns
//! storage/export types used only by the main application crate.

// Re-export capture pipeline types
pub use moonsnap_capture_types::capture;
pub use moonsnap_capture_types::capture_settings;
pub use moonsnap_capture_types::recording;
pub use moonsnap_capture_types::webcam;

// Re-export editor pipeline types
pub use moonsnap_project_types::captions;
pub use moonsnap_project_types::video_project;

// Types owned by this crate (main-crate-only consumers)
pub mod storage;
pub mod video_export;

#[cfg(test)]
mod tests {
    use super::{captions, capture_settings, recording, video_project, webcam};

    #[test]
    fn default_values_smoke_test() {
        let capture = capture_settings::CaptureSettings::default();
        assert_eq!(capture.video.fps, 30);
        assert_eq!(capture.gif.max_duration_secs, 30);

        let mut recording_settings = recording::RecordingSettings::default();
        recording_settings.validate();
        assert!((10..=60).contains(&recording_settings.fps));

        let composition = video_project::CompositionConfig::default();
        assert_eq!(composition.mode, video_project::CompositionMode::Auto);
        assert_eq!(
            video_project::SceneMode::CameraOnly.to_string(),
            "CameraOnly"
        );
    }

    #[test]
    fn serde_and_geometry_smoke_test() {
        let captions_data = captions::CaptionData::default();
        let json = serde_json::to_string(&captions_data).expect("caption data should serialize");
        let parsed: captions::CaptionData =
            serde_json::from_str(&json).expect("caption data should deserialize");
        assert_eq!(parsed.segments.len(), 0);

        let webcam_settings = webcam::WebcamSettings::default();
        let (x, y, size) = webcam::compute_webcam_rect(1920, 1080, &webcam_settings);
        assert!(x >= 0);
        assert!(y >= 0);
        assert!(size > 0);
    }
}
```

- [ ] **Step 5: Build check — full workspace**

```bash
cd apps/desktop/src-tauri && cargo check --no-default-features
```

Expected: Full workspace compiles. The main crate's `use moonsnap_domain::*` imports resolve through the facade.

- [ ] **Step 6: Run all tests**

```bash
cd apps/desktop/src-tauri && cargo test --lib
```

Expected: All tests pass, including:
- `moonsnap_domain::tests::default_values_smoke_test`
- `moonsnap_domain::tests::serde_and_geometry_smoke_test`
- ts-rs type generation (writes to `src/types/generated/`)

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/crates/moonsnap-domain/
git commit -m "refactor: slim moonsnap-domain to facade re-exporting capture-types and project-types"
```

---

## Task 6: Verify Success Criteria

- [ ] **Step 1: Verify cache holds with no changes**

```bash
cd apps/desktop/src-tauri && cargo check --no-default-features 2>&1 | grep "Checking\|Compiling\|Finished"
```

Expected: Only `Finished` — no `Checking` or `Compiling`.

- [ ] **Step 2: Verify capture-type isolation**

```bash
cd apps/desktop/src-tauri
# Touch a capture-only type
echo "" >> crates/moonsnap-capture-types/src/recording.rs
cargo check --no-default-features 2>&1 | grep "Checking\|Compiling"
```

Expected: Only `moonsnap-capture-types`, `moonsnap-capture`, `moonsnap-domain`, and `moonsnap` recompile. NOT `moonsnap-render` or `moonsnap-export`.

```bash
# Undo the touch
cd apps/desktop/src-tauri && git checkout crates/moonsnap-capture-types/src/recording.rs
```

- [ ] **Step 3: Verify project-type isolation**

```bash
cd apps/desktop/src-tauri
# Touch an editor-only type
echo "" >> crates/moonsnap-project-types/src/video_project.rs
cargo check --no-default-features 2>&1 | grep "Checking\|Compiling"
```

Expected: Only `moonsnap-project-types`, `moonsnap-render`, `moonsnap-export`, `moonsnap-domain`, and `moonsnap` recompile. NOT `moonsnap-capture`.

```bash
# Undo the touch
cd apps/desktop/src-tauri && git checkout crates/moonsnap-project-types/src/video_project.rs
```

- [ ] **Step 4: Verify TypeScript types are generated**

```bash
cd apps/desktop/src-tauri && cargo test --lib 2>&1 | tail -5
```

Expected: All tests pass. Check that `apps/desktop/src/types/generated/` contains `.ts` files for types from both sub-crates.

- [ ] **Step 5: Verify tauri dev builds**

```bash
cd apps/desktop && npm run tauri dev
```

Expected: App launches successfully. Ctrl+C to stop after confirming it builds.

- [ ] **Step 6: Run quality suite**

```bash
bun run typecheck && bun run lint && bun run test:run
```

Expected: All pass.

- [ ] **Step 7: Final commit if any fixups needed, otherwise done**
