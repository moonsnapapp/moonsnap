# `.moonsnap` Bundle Format Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename video project folders to use a `.moonsnap` extension so users treat them as opaque app documents, not browsable directories.

**Architecture:** Project folders get `.moonsnap` appended to their name. Internal structure is unchanged. Library scanning recognizes both `.moonsnap` bundles and legacy bare folders. Existing projects are migrated on first launch. Damaged bundles show a repair UI.

**Tech Stack:** Rust (Tauri backend), React/TypeScript (frontend), Tauri file associations

---

## Chunk 1: Backend — Bundle creation and recognition

### Task 1: Generate output paths with `.moonsnap` extension

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/video_recording/mod.rs:1484-1489`

- [ ] **Step 1: Write the failing test**

In a new test module at the bottom of `mod.rs` (or existing test module), add a test that calls `generate_output_path` with `quick_capture: false` and asserts the returned path ends with `.moonsnap`:

```rust
#[test]
fn test_generate_output_path_editor_flow_has_moonsnap_extension() {
    let settings = RecordingSettings {
        format: RecordingFormat::Mp4,
        quick_capture: false,
        ..Default::default()
    };
    let path = generate_output_path(&settings).unwrap();
    assert!(
        path.to_string_lossy().ends_with(".moonsnap"),
        "Editor flow path should end with .moonsnap, got: {:?}",
        path
    );
    // Clean up created directory
    let _ = std::fs::remove_dir(&path);
}
```

Note: This test creates a real directory in the user's save dir. Clean up after.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml test_generate_output_path_editor_flow -- --nocapture`
Expected: FAIL — path does not end with `.moonsnap`

- [ ] **Step 3: Update `generate_output_path` to append `.moonsnap`**

In `apps/desktop/src-tauri/src/commands/video_recording/mod.rs`, change line 1485 from:
```rust
let folder_name = format!("moonsnap_{}_{}", timestamp, rand::random::<u16>());
```
to:
```rust
let folder_name = format!("moonsnap_{}_{}.moonsnap", timestamp, rand::random::<u16>());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml test_generate_output_path_editor_flow -- --nocapture`
Expected: PASS

- [ ] **Step 5: Verify quick capture is unchanged**

Add a test that `quick_capture: true` does NOT produce `.moonsnap`:

```rust
#[test]
fn test_generate_output_path_quick_capture_no_moonsnap() {
    let settings = RecordingSettings {
        format: RecordingFormat::Mp4,
        quick_capture: true,
        ..Default::default()
    };
    let path = generate_output_path(&settings).unwrap();
    assert!(
        path.to_string_lossy().ends_with(".mp4"),
        "Quick capture should end with .mp4, got: {:?}",
        path
    );
    let _ = std::fs::remove_file(&path);
}
```

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml test_generate_output_path_quick_capture -- --nocapture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/video_recording/mod.rs
git commit -m "feat: generate .moonsnap bundle paths for editor flow recordings"
```

---

### Task 2: Add Windows Hidden attribute utility

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/storage/bundle_utils.rs`
- Modify: `apps/desktop/src-tauri/src/commands/storage/mod.rs` (add module)

- [ ] **Step 1: Create `bundle_utils.rs` with `set_hidden_on_contents`**

```rust
use std::path::Path;

/// Set the Windows Hidden attribute on all files inside a .moonsnap bundle.
/// On non-Windows platforms, this is a no-op.
pub fn set_hidden_on_bundle_contents(bundle_path: &Path) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(entries) = std::fs::read_dir(bundle_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    set_hidden_attribute(&path);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = bundle_path;
    }
}

/// Set the Hidden attribute on a single file (Windows only).
#[cfg(target_os = "windows")]
fn set_hidden_attribute(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN,
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        let attrs = GetFileAttributesW(wide.as_ptr());
        if attrs != u32::MAX {
            SetFileAttributesW(wide.as_ptr(), attrs | FILE_ATTRIBUTE_HIDDEN);
        }
    }
}
```

Note: Check if `windows-sys` is already a dependency. If not, add it to `Cargo.toml` with feature `Win32_Storage_FileSystem`. Alternatively, use the `winapi` crate if already present in the project.

- [ ] **Step 2: Register the module**

In `apps/desktop/src-tauri/src/commands/storage/mod.rs`, add:

```rust
pub mod bundle_utils;
```

- [ ] **Step 3: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/bundle_utils.rs apps/desktop/src-tauri/src/commands/storage/mod.rs
git commit -m "feat: add Windows Hidden attribute utility for .moonsnap bundles"
```

---

### Task 3: Fix project identity — use `project.json` ID instead of folder name

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:496-501, 1022-1026`

Currently `load_video_project_folder` uses the folder name as the project ID. This breaks when users rename `.moonsnap` bundles. Fix it to prefer the `id` field from `project.json`.

- [ ] **Step 1: Update ID extraction in `load_video_project_folder`**

Replace lines 496-501:

```rust
// Use folder name as ID
let id = folder_path
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("recording")
    .to_string();
```

with:

```rust
// Compute fallback ID from folder name (stripped of .moonsnap extension)
let folder_name = folder_path
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("recording");
let fallback_id = folder_name.strip_suffix(".moonsnap").unwrap_or(folder_name).to_string();
```

Then, **after** the existing `project.json` parsing block (the big `if` at lines 522-614) but **before** the sidecar lookup merge (line 616), extract the ID separately. This avoids modifying the existing 6-element tuple:

```rust
// Extract project ID from project.json, falling back to folder name
let json_id: Option<String> = if async_fs::try_exists(&project_json).await.unwrap_or(false) {
    if let Ok(content) = async_fs::read_to_string(&project_json).await {
        serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|p| p.get("id").and_then(|v| v.as_str()).map(String::from))
    } else {
        None
    }
} else {
    None
};
let id = json_id.unwrap_or(fallback_id);
```

Note: This reads `project.json` a second time, but it's already cached by the OS. Alternatively, refactor to read once and parse both the existing tuple and the ID from the same parsed value — but that's a larger refactor. The double-read approach is simpler and safe.

- [ ] **Step 2: Migrate sidecar directories during bundle migration**

In the migration module (Task 5), after renaming a folder to `.moonsnap`, also migrate the sidecar directory in AppData. The old sidecar was stored at `projects/{folder_name}/project.json`. After migration, it should be at `projects/{project_json_id}/project.json`.

Add to the migration logic (after the folder rename succeeds):

```rust
// Migrate sidecar directory if needed
if let Ok(content) = fs::read_to_string(target.join("project.json")) {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
        if let Some(project_id) = parsed.get("id").and_then(|v| v.as_str()) {
            if project_id != folder_name {
                // Sidecar was stored under folder name, needs to move to project ID
                let old_sidecar = app_data_projects_dir.join(&folder_name);
                let new_sidecar = app_data_projects_dir.join(project_id);
                if old_sidecar.exists() && !new_sidecar.exists() {
                    let _ = fs::rename(&old_sidecar, &new_sidecar);
                    log::info!(
                        "[MIGRATION] Renamed sidecar {:?} -> {:?}",
                        old_sidecar, new_sidecar
                    );
                }
            }
        }
    }
}
```

This requires passing `app_data_projects_dir` into `migrate_captures_dir`. Update the function signature to accept both `captures_dir` and `projects_dir`:

```rust
pub fn migrate_captures_dir(
    captures_dir: &std::path::Path,
    projects_dir: Option<&std::path::Path>,
) -> Result<MigrationResult, String>
```

Tests can pass `None` for `projects_dir` to skip sidecar migration.

- [ ] **Step 3: Update `determine_capture_type` for `.moonsnap` folders**

In `determine_capture_type` at lines 1022-1026, replace the video folder check with:

```rust
// 2. Check if project_id directly points to a .moonsnap bundle or bare folder
let direct_path = captures_dir.join(project_id);
if direct_path.is_dir() && direct_path.join("screen.mp4").exists() {
    return Ok(("video_folder".to_string(), Some(direct_path)));
}
// Try appending .moonsnap (ID from project.json won't have the extension)
let bundle_path = captures_dir.join(format!("{}.moonsnap", project_id));
if bundle_path.is_dir() && bundle_path.join("screen.mp4").exists() {
    return Ok(("video_folder".to_string(), Some(bundle_path)));
}
// Scan all project folders for matching project.json ID (handles renamed bundles)
if let Ok(entries) = std::fs::read_dir(&captures_dir) {
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("screen.mp4").exists() {
            let pj = path.join("project.json");
            if pj.exists() {
                if let Ok(content) = std::fs::read_to_string(&pj) {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                        if parsed.get("id").and_then(|v| v.as_str()) == Some(project_id) {
                            return Ok(("video_folder".to_string(), Some(path)));
                        }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "fix: use project.json ID for project identity instead of folder name"
```

---

## Chunk 2: Migration

### Task 4: Add migration command

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/storage/migration.rs`
- Modify: `apps/desktop/src-tauri/src/commands/storage/mod.rs` (add module)
- Modify: `apps/desktop/src-tauri/src/lib.rs:188-194` (call migration on startup)

- [ ] **Step 1: Create migration module**

Create `apps/desktop/src-tauri/src/commands/storage/migration.rs`:

```rust
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use super::{bundle_utils, get_captures_dir};

/// Result of migrating project folders to .moonsnap bundles.
pub struct MigrationResult {
    pub migrated: usize,
    pub skipped: usize,
    pub failed: Vec<(String, String)>, // (folder_name, error_message)
}

/// Core migration logic, testable without AppHandle.
/// If `projects_dir` is provided, also migrates sidecar directories.
pub fn migrate_captures_dir(
    captures_dir: &std::path::Path,
    projects_dir: Option<&std::path::Path>,
) -> Result<MigrationResult, String> {
    if !captures_dir.exists() {
        return Ok(MigrationResult {
            migrated: 0,
            skipped: 0,
            failed: Vec::new(),
        });
    }

    let mut result = MigrationResult {
        migrated: 0,
        skipped: 0,
        failed: Vec::new(),
    };

    let entries = fs::read_dir(captures_dir)
        .map_err(|e| format!("Failed to read captures directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // Only process directories
        if !path.is_dir() {
            continue;
        }

        // Skip if already a .moonsnap bundle
        if path.extension().and_then(|e| e.to_str()) == Some("moonsnap") {
            result.skipped += 1;
            continue;
        }

        // Skip if doesn't contain screen.mp4 (not a video project folder)
        if !path.join("screen.mp4").exists() {
            continue;
        }

        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Check for legacy .moonsnap sidecar file collision
        let target = captures_dir.join(format!("{}.moonsnap", folder_name));
        if target.exists() && !target.is_dir() {
            // Legacy sidecar file exists — remove it (data is in project.json)
            log::info!("[MIGRATION] Removing legacy sidecar: {:?}", target);
            let _ = fs::remove_file(&target);
        }

        // Rename folder to .moonsnap bundle
        match fs::rename(&path, &target) {
            Ok(()) => {
                log::info!("[MIGRATION] Renamed {:?} -> {:?}", path, target);

                // Set Hidden attribute on internal files (Windows)
                bundle_utils::set_hidden_on_bundle_contents(&target);

                // Migrate sidecar directory if needed
                if let Some(projects_dir) = projects_dir {
                    migrate_sidecar_dir(&target, &folder_name, projects_dir);
                }

                result.migrated += 1;
            }
            Err(e) => {
                log::warn!("[MIGRATION] Failed to rename {:?}: {}", path, e);
                result.failed.push((folder_name, e.to_string()));
            }
        }
    }

    if result.migrated > 0 || !result.failed.is_empty() {
        log::info!(
            "[MIGRATION] Complete: {} migrated, {} skipped, {} failed",
            result.migrated,
            result.skipped,
            result.failed.len()
        );
    }

    Ok(result)
}

/// Migrate sidecar directory from folder-name-based key to project.json ID key.
fn migrate_sidecar_dir(
    bundle_path: &std::path::Path,
    old_folder_name: &str,
    projects_dir: &std::path::Path,
) {
    if let Ok(content) = fs::read_to_string(bundle_path.join("project.json")) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(project_id) = parsed.get("id").and_then(|v| v.as_str()) {
                if project_id != old_folder_name {
                    let old_sidecar = projects_dir.join(old_folder_name);
                    let new_sidecar = projects_dir.join(project_id);
                    if old_sidecar.exists() && !new_sidecar.exists() {
                        let _ = fs::rename(&old_sidecar, &new_sidecar);
                        log::info!(
                            "[MIGRATION] Renamed sidecar {:?} -> {:?}",
                            old_sidecar, new_sidecar
                        );
                    }
                }
            }
        }
    }
}

/// Entry point: migrate all project folders in the captures directory.
pub fn migrate_to_bundles(app: &AppHandle) -> Result<MigrationResult, String> {
    let captures_dir = get_captures_dir(app)?;
    let projects_dir = super::get_app_data_dir(app)
        .map(|d| d.join("projects"))
        .ok();
    migrate_captures_dir(&captures_dir, projects_dir.as_deref())
}
```

- [ ] **Step 2: Register the module**

In `apps/desktop/src-tauri/src/commands/storage/mod.rs`, add:

```rust
pub mod migration;
```

- [ ] **Step 3: Call migration synchronously on app startup (before UI)**

In `apps/desktop/src-tauri/src/lib.rs`, after the default save directory creation (line 194), add migration **synchronously** to avoid race conditions with library scanning:

```rust
// Migrate legacy project folders to .moonsnap bundles (runs synchronously
// before UI to prevent race conditions with library scanning)
{
    let app_handle = app.handle().clone();
    match commands::storage::migration::migrate_to_bundles(&app_handle) {
        Ok(result) => {
            if result.migrated > 0 {
                log::info!(
                    "[STARTUP] Migrated {} project folders to .moonsnap bundles",
                    result.migrated
                );
            }
            if !result.failed.is_empty() {
                log::warn!(
                    "[STARTUP] {} folders failed to migrate: {:?}",
                    result.failed.len(),
                    result.failed
                );
            }
        }
        Err(e) => log::error!("[STARTUP] Migration failed: {}", e),
    }
}
```

Note: Migration is just `fs::rename()` calls — should complete in under a second even for hundreds of projects. Running synchronously prevents the library from seeing a half-migrated state.

- [ ] **Step 4: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: No errors

- [ ] **Step 5: Write migration tests**

Add tests to `migration.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_project_folder(dir: &std::path::Path, name: &str) {
        let folder = dir.join(name);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("screen.mp4"), b"fake video").unwrap();
        fs::write(folder.join("project.json"), r#"{"id":"test123"}"#).unwrap();
    }

    #[test]
    fn test_migrates_bare_folder_to_bundle() {
        let tmp = TempDir::new().unwrap();
        create_project_folder(tmp.path(), "moonsnap_20260314_123456_12345");

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 1);
        assert!(tmp.path().join("moonsnap_20260314_123456_12345.moonsnap").exists());
        assert!(!tmp.path().join("moonsnap_20260314_123456_12345").exists());
    }

    #[test]
    fn test_skips_already_migrated_bundles() {
        let tmp = TempDir::new().unwrap();
        create_project_folder(tmp.path(), "moonsnap_20260314_123456_12345.moonsnap");

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
        assert_eq!(result.skipped, 1);
    }

    #[test]
    fn test_skips_non_project_folders() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("random_folder")).unwrap();

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
    }

    #[test]
    fn test_removes_legacy_sidecar_before_rename() {
        let tmp = TempDir::new().unwrap();
        create_project_folder(tmp.path(), "moonsnap_20260314_123456_12345");
        // Create legacy sidecar file that would collide
        fs::write(
            tmp.path().join("moonsnap_20260314_123456_12345.moonsnap"),
            b"legacy sidecar",
        ).unwrap();

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 1);
        assert!(tmp.path().join("moonsnap_20260314_123456_12345.moonsnap").is_dir());
    }

    #[test]
    fn test_leaves_quick_capture_files_alone() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("moonsnap_20260314_123456_12345.mp4"), b"video").unwrap();

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
        assert!(tmp.path().join("moonsnap_20260314_123456_12345.mp4").exists());
    }

    #[test]
    fn test_migrates_sidecar_directory() {
        let tmp = TempDir::new().unwrap();
        let captures = tmp.path().join("captures");
        let projects = tmp.path().join("projects");
        fs::create_dir_all(&captures).unwrap();
        fs::create_dir_all(&projects).unwrap();

        // Create project folder with ID different from folder name
        let folder = captures.join("moonsnap_20260314_123456_12345");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("screen.mp4"), b"fake video").unwrap();
        fs::write(
            folder.join("project.json"),
            r#"{"id":"abc123def456"}"#,
        ).unwrap();

        // Create sidecar under old folder name
        let old_sidecar = projects.join("moonsnap_20260314_123456_12345");
        fs::create_dir_all(&old_sidecar).unwrap();
        fs::write(old_sidecar.join("project.json"), r#"{"tags":["test"]}"#).unwrap();

        let result = migrate_captures_dir(&captures, Some(&projects)).unwrap();
        assert_eq!(result.migrated, 1);

        // Sidecar should be renamed to project ID
        assert!(!projects.join("moonsnap_20260314_123456_12345").exists());
        assert!(projects.join("abc123def456").exists());
    }

    #[test]
    fn test_empty_captures_dir() {
        let tmp = TempDir::new().unwrap();
        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
        assert_eq!(result.skipped, 0);
        assert!(result.failed.is_empty());
    }
}
```

- [ ] **Step 6: Run migration tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml migrate -- --nocapture`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/migration.rs apps/desktop/src-tauri/src/commands/storage/mod.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: add startup migration from project folders to .moonsnap bundles"
```

---

## Chunk 3: Damaged bundle detection and repair

### Task 5: Add `damaged` field to `CaptureListItem`

**Files:**
- Modify: `apps/desktop/src-tauri/crates/moonsnap-domain/src/storage.rs:75-93`
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:486-493, 658-672`

- [ ] **Step 1: Add `damaged` field to Rust struct**

In `apps/desktop/src-tauri/crates/moonsnap-domain/src/storage.rs`, add a `damaged` field to `CaptureListItem`:

```rust
pub struct CaptureListItem {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub capture_type: String,
    pub dimensions: Dimensions,
    pub thumbnail_path: String,
    pub image_path: String,
    pub has_annotations: bool,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub quick_capture: bool,
    pub is_missing: bool,
    pub damaged: bool,
}
```

- [ ] **Step 2: Update all `CaptureListItem` constructors to include `damaged: false`**

Search for all places that construct `CaptureListItem` and add `damaged: false`. These are in `operations.rs` at the `Some(CaptureListItem { ... })` blocks (at least in `load_video_project_folder`, `load_media_item`, and `load_project_item`).

- [ ] **Step 3: Detect damaged bundles in `load_video_project_folder`**

In `operations.rs`, update `load_video_project_folder` to detect damaged bundles instead of returning `None`. Change lines 492-494 from:

```rust
if !async_fs::try_exists(&screen_mp4).await.unwrap_or(false) {
    return None;
}
```

to:

```rust
let screen_mp4_meta = async_fs::metadata(&screen_mp4).await.ok();
let screen_ok = screen_mp4_meta.as_ref().map(|m| m.len() > 0).unwrap_or(false);
let is_bundle = folder_path.extension().and_then(|e| e.to_str()) == Some("moonsnap");

// For .moonsnap bundles, show as damaged instead of hiding
if !screen_ok && !is_bundle {
    return None;
}
let damaged = !screen_ok;
```

Then at the `CaptureListItem` construction (line 658-672), use `damaged`:

```rust
Some(CaptureListItem {
    id,
    // ... other fields ...
    is_missing: false,
    damaged,
})
```

- [ ] **Step 4: Regenerate TypeScript types**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

This regenerates `apps/desktop/src/types/generated/CaptureListItem.ts` with the new `damaged` field.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: May have TS errors where `CaptureListItem` is used — fix any missing `damaged` references in frontend code.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/crates/moonsnap-domain/src/storage.rs apps/desktop/src-tauri/src/commands/storage/operations.rs apps/desktop/src/types/generated/CaptureListItem.ts
git commit -m "feat: add damaged field to CaptureListItem for bundle integrity detection"
```

---

### Task 6: Add `repair_project` Tauri command

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs` (add new command)
- Modify: Tauri command registry (wherever commands are registered)

- [ ] **Step 1: Add `repair_project` command**

In `operations.rs`, add a new command:

```rust
#[command]
pub async fn repair_project(
    app: AppHandle,
    project_id: String,
    new_video_path: String,
) -> Result<(), String> {
    let captures_dir = get_captures_dir(&app)?;

    // Find the bundle folder for this project
    let bundle_path = find_project_bundle(&captures_dir, &project_id)?;

    let target = bundle_path.join("screen.mp4");
    let source = std::path::Path::new(&new_video_path);

    if !source.exists() {
        return Err("Selected video file does not exist".to_string());
    }

    // Move the file into the bundle
    std::fs::rename(source, &target).or_else(|_| {
        // Cross-device move: copy then delete
        std::fs::copy(source, &target)
            .and_then(|_| std::fs::remove_file(source))
            .map(|_| ())
    }).map_err(|e| format!("Failed to move video into bundle: {}", e))?;

    // Re-extract metadata via ffprobe and update project.json
    let project_json_path = bundle_path.join("project.json");
    if project_json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&project_json_path) {
            if let Ok(mut project) = serde_json::from_str::<serde_json::Value>(&content) {
                // Extract video dimensions and duration from the new file
                if let Ok(info) = crate::commands::video_recording::ffprobe::get_video_info(
                    target.to_string_lossy().as_ref()
                ) {
                    if let Some(sources) = project.get_mut("sources") {
                        if let Some(obj) = sources.as_object_mut() {
                            obj.insert("originalWidth".to_string(), serde_json::json!(info.width));
                            obj.insert("originalHeight".to_string(), serde_json::json!(info.height));
                        }
                    }
                    if let Some(timeline) = project.get_mut("timeline") {
                        if let Some(obj) = timeline.as_object_mut() {
                            obj.insert("durationMs".to_string(), serde_json::json!(info.duration_ms));
                        }
                    }
                }
                // Update timestamp
                project.as_object_mut().map(|obj| {
                    obj.insert("updatedAt".to_string(), serde_json::json!(chrono::Utc::now().to_rfc3339()));
                });
                let _ = std::fs::write(&project_json_path, serde_json::to_string_pretty(&project).unwrap_or_default());
            }
        }
    }

    // Set Hidden attribute on the new file (Windows)
    super::bundle_utils::set_hidden_on_bundle_contents(&bundle_path);

    Ok(())
}

/// Find a project bundle folder by project ID.
/// Checks direct path, .moonsnap path, then scans all bundles for matching project.json ID.
fn find_project_bundle(captures_dir: &std::path::Path, project_id: &str) -> Result<PathBuf, String> {
    // Try direct path (bare folder or ID-as-folder-name)
    let direct_path = captures_dir.join(project_id);
    if direct_path.is_dir() {
        return Ok(direct_path);
    }

    // Try .moonsnap bundle
    let bundle = captures_dir.join(format!("{}.moonsnap", project_id));
    if bundle.is_dir() {
        return Ok(bundle);
    }

    // Scan all bundles for matching project.json ID (handles renamed bundles)
    if let Ok(entries) = std::fs::read_dir(captures_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let project_json = path.join("project.json");
                if project_json.exists() {
                    if let Ok(content) = std::fs::read_to_string(&project_json) {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                            if parsed.get("id").and_then(|v| v.as_str()) == Some(project_id) {
                                return Ok(path);
                            }
                        }
                    }
                }
            }
        }
    }

    Err(format!("Project bundle not found for ID: {}", project_id))
}
```

Note: The `ffprobe::get_video_info` function path may vary — check the actual module path for ffprobe utilities. Adjust the import accordingly.

- [ ] **Step 2: Register the command in Tauri's command registry**

Find the command registry macro (likely in `apps/desktop/src-tauri/src/commands/registry.rs` or similar) and add `repair_project`.

- [ ] **Step 3: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs apps/desktop/src-tauri/src/commands/registry.rs
git commit -m "feat: add repair_project command with ffprobe metadata re-extraction"
```

---

## Chunk 4: Frontend — Repair UI

### Task 7: Add repair UI to library

**Files:**
- Modify: `apps/desktop/src/components/Library/components/CaptureContextMenu.tsx`
- Modify: `apps/desktop/src/components/Library/components/CaptureCard.tsx`

- [ ] **Step 1: Add `onRepair` prop and menu item to `CaptureContextMenu`**

In `CaptureContextMenu.tsx`, add `onRepair` and `damaged` to the props interface and render a repair menu item for damaged captures:

```tsx
interface CaptureContextMenuProps {
  // ... existing props ...
  damaged?: boolean;
  onRepair?: () => void;
}
```

Add to destructured props: `damaged = false, onRepair,`

Add the menu item after the Play/Edit items (around line 64):

```tsx
{damaged && onRepair && (
  <ContextMenuItem onClick={onRepair}>
    <Wrench className="w-4 h-4 mr-2" />
    Repair Project
  </ContextMenuItem>
)}
```

Import `Wrench` from `lucide-react`.

- [ ] **Step 2: Add damaged badge to `CaptureCard`**

In `CaptureCard.tsx`, add a visual indicator for damaged bundles. Show a warning badge on the thumbnail:

```tsx
{capture.damaged && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
    <AlertTriangle className="w-8 h-8 text-yellow-400" />
  </div>
)}
```

Import `AlertTriangle` from `lucide-react`.

When a damaged card is clicked, trigger repair instead of edit:

```tsx
const handleClick = () => {
  if (capture.damaged) {
    onRepair?.();
    return;
  }
  // ... existing click handling
};
```

- [ ] **Step 3: Wire up repair handler in the parent component**

In the component that renders `CaptureCard` (likely a library grid/list component), add a repair handler that:
1. Opens a file dialog (via Tauri's `dialog.open`)
2. Calls the `repair_project` command with the selected file
3. Refreshes the capture list

```tsx
const handleRepair = async (captureId: string) => {
  const selected = await open({
    title: 'Select video file to repair project',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm'] }],
  });
  if (selected && typeof selected === 'string') {
    await invoke('repair_project', {
      projectId: captureId,
      newVideoPath: selected,
    });
    // Refresh the capture list
    await refreshCaptures();
  }
};
```

- [ ] **Step 4: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/Library/
git commit -m "feat: add repair UI for damaged .moonsnap bundles in library"
```

---

## Chunk 5: Display name, file association, and integration

### Task 8: Strip `.moonsnap` from display names

**Files:**
- Modify: `apps/desktop/src/components/Library/components/CaptureCard.tsx` (or wherever project names are displayed)

- [ ] **Step 1: Add display name helper**

Create a utility function (inline or in a utils file) that strips the `.moonsnap` suffix:

```tsx
const getDisplayName = (name: string): string => {
  return name.endsWith('.moonsnap') ? name.slice(0, -'.moonsnap'.length) : name;
};
```

Apply this wherever the project/capture name is rendered in the library UI.

- [ ] **Step 2: Verify delete flow for `.moonsnap` bundles**

In `operations.rs`, the `determine_capture_type` function now handles `.moonsnap` bundles (from Task 3). The `video_folder` type uses `remove_dir_all` which works for `.moonsnap` directories. No additional change needed.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/Library/
git commit -m "feat: strip .moonsnap extension from display names in library"
```

---

### Task 9: Register `.moonsnap` file association in Tauri config

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (file-open handler)
- Modify: `apps/desktop/src-tauri/Cargo.toml` (if deep-link plugin needed)

- [ ] **Step 1: Add file association config**

In `tauri.conf.json`, add a `fileAssociations` section inside `bundle`:

```json
"fileAssociations": [
  {
    "ext": ["moonsnap"],
    "mimeType": "application/x-moonsnap",
    "description": "MoonSnap Project",
    "role": "Editor"
  }
]
```

- [ ] **Step 2: Handle file-open event**

In `apps/desktop/src-tauri/src/lib.rs`, handle the case where the app is launched with a `.moonsnap` path as a CLI argument. Tauri v2 surfaces file association opens via `tauri::RunEvent::Opened { urls }` on macOS, or via CLI args on Windows/Linux.

Add to the `.run()` callback (or to `setup`):

```rust
// Check CLI args for .moonsnap bundle paths (Windows/Linux file association)
let args: Vec<String> = std::env::args().collect();
if let Some(path_arg) = args.get(1) {
    let path = std::path::Path::new(path_arg);
    if path.is_dir() && path.extension().and_then(|e| e.to_str()) == Some("moonsnap") {
        let app_handle = app.handle().clone();
        let path_str = path_arg.clone();
        tauri::async_runtime::spawn(async move {
            let _ = app_handle.emit("open-moonsnap-bundle", path_str);
        });
    }
}
```

On the frontend, listen for `open-moonsnap-bundle` events and load the project in the editor.

Note: macOS requires handling `tauri::RunEvent::Opened` in the `.run()` closure — research the exact Tauri v2 API and add appropriate handling. This may also require the `deep-link` plugin for full cross-platform support.

- [ ] **Step 3: Add macOS `LSTypeIsPackage` for Finder bundle semantics**

For macOS builds, the `Info.plist` needs `LSTypeIsPackage = true` for the `.moonsnap` UTI. Tauri v2 allows custom plist entries. Check `tauri.conf.json` docs or create a custom `Info.plist` template in the Tauri source directory with:

```xml
<key>UTExportedTypeDeclarations</key>
<array>
  <dict>
    <key>UTTypeIdentifier</key>
    <string>com.moonsnap.project</string>
    <key>UTTypeDescription</key>
    <string>MoonSnap Project</string>
    <key>UTTypeConformsTo</key>
    <array>
      <string>com.apple.package</string>
    </array>
    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key>
      <array>
        <string>moonsnap</string>
      </array>
    </dict>
  </dict>
</array>
```

The key line is `UTTypeConformsTo: com.apple.package` — this tells Finder to treat `.moonsnap` directories as opaque packages.

Note: This only applies to macOS builds. Currently the app only targets Windows (`"targets": ["nsis"]`), so this can be deferred until macOS support is added. Add a TODO comment in the config.

- [ ] **Step 4: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: register .moonsnap file association for OS integration"
```

---

### Task 10: Final integration test

- [ ] **Step 1: Run full quality suite**

```bash
bun run typecheck && bun run lint && bun run test:run
```

Expected: All pass

- [ ] **Step 2: Run Rust tests**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

Expected: All pass (also regenerates TS types)

- [ ] **Step 3: Manual smoke test**

1. Start the app with `npm run tauri dev`
2. Verify existing projects appear in library (migration should have run)
3. Make a new recording — verify folder is created as `.moonsnap`
4. Rename the `.moonsnap` bundle in file explorer — verify it still loads
5. Delete `screen.mp4` from inside a bundle — verify damaged state shows with warning badge
6. Use repair to re-link a video file — verify metadata is updated
7. Delete a `.moonsnap` bundle from the library — verify it's fully removed
8. On Windows: verify internal files have Hidden attribute

- [ ] **Step 4: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix: integration fixes from .moonsnap bundle smoke testing"
```
