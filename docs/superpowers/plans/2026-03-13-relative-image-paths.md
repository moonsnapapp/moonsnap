# Relative Image Paths Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch `original_image` in project.json from absolute paths to relative filenames, eliminating the need for path rewriting during folder migration.

**Architecture:** Store only the filename in `original_image` at write time. At read time, resolve relative filenames against `get_captures_dir()`. Remove the path-rewriting block from `move_save_dir`. Backwards compatible — absolute paths from old projects still work via `is_absolute()` check.

**Tech Stack:** Rust (Tauri backend)

**Spec:** `docs/superpowers/specs/2026-03-13-relative-image-paths-design.md`

---

## Chunk 1: Write side — store relative filenames

### Task 1: Change `original_image` to store filename only

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:101,188,281`

- [ ] **Step 1: Update `save_capture` (line 101)**

Change:
```rust
        original_image: original_path.to_string_lossy().to_string(),
```
To:
```rust
        original_image: original_filename.clone(),
```

- [ ] **Step 2: Update `save_capture_from_rgba` (line 188)**

Same change:
```rust
        original_image: original_path.to_string_lossy().to_string(),
```
To:
```rust
        original_image: original_filename.clone(),
```

- [ ] **Step 3: Update `save_capture_from_file` (line 281)**

Same change:
```rust
        original_image: original_path.to_string_lossy().to_string(),
```
To:
```rust
        original_image: original_filename.clone(),
```

- [ ] **Step 4: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "feat: store relative filename in original_image instead of absolute path"
```

---

## Chunk 2: Read side — resolve relative paths against captures dir

### Task 2: Update `load_project_item` to use captures_dir

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:426-452,856-862`

- [ ] **Step 1: Add `captures_dir` parameter to `load_project_item`**

Change the function signature (line 426-430) from:
```rust
async fn load_project_item(
    project_dir: PathBuf,
    base_dir: PathBuf,
    thumbnails_dir: PathBuf,
) -> Option<CaptureListItem> {
```
To:
```rust
async fn load_project_item(
    project_dir: PathBuf,
    captures_dir: PathBuf,
    thumbnails_dir: PathBuf,
) -> Option<CaptureListItem> {
```

- [ ] **Step 2: Update the relative path fallback (lines 445-452)**

Change:
```rust
    // Handle both old format (filename only) and new format (full path)
    let original_path = PathBuf::from(&project.original_image);
    let image_path_buf = if original_path.is_absolute() {
        original_path
    } else {
        // Legacy: construct path from app data dir
        base_dir.join("captures").join(&project.original_image)
    };
```
To:
```rust
    // Resolve relative filenames against the user's save directory
    let original_path = PathBuf::from(&project.original_image);
    let image_path_buf = if original_path.is_absolute() {
        original_path
    } else {
        captures_dir.join(&project.original_image)
    };
```

- [ ] **Step 3: Update the caller (lines 856-862)**

Change:
```rust
            .map(|dir| {
                let base = base_dir.clone();
                let thumbs = thumbnails_dir.clone();
                load_project_item(dir, base, thumbs)
            })
```
To:
```rust
            .map(|dir| {
                let caps = captures_dir.clone();
                let thumbs = thumbnails_dir.clone();
                load_project_item(dir, caps, thumbs)
            })
```

- [ ] **Step 4: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "feat: resolve relative original_image against captures dir in load_project_item"
```

### Task 3: Update `get_project_image` to use captures_dir

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:943-966`

- [ ] **Step 1: Update the relative path fallback (lines 960-966)**

Change:
```rust
    // Handle both old format (filename only) and new format (full path)
    let original_path = PathBuf::from(&project.original_image);
    let image_path = if original_path.is_absolute() {
        original_path
    } else {
        base_dir.join("captures").join(&project.original_image)
    };
```
To:
```rust
    // Resolve relative filenames against the user's save directory
    let captures_dir = get_captures_dir(&app)?;
    let original_path = PathBuf::from(&project.original_image);
    let image_path = if original_path.is_absolute() {
        original_path
    } else {
        captures_dir.join(&project.original_image)
    };
```

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "feat: resolve relative original_image against captures dir in get_project_image"
```

### Task 4: Update `determine_capture_type` to use captures_dir

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:1009-1014`

- [ ] **Step 1: Update the relative path fallback (lines 1009-1014)**

Note: `captures_dir` is already available at line 1000.

Change:
```rust
                let original_path = PathBuf::from(&project.original_image);
                let image_path = if original_path.is_absolute() {
                    original_path
                } else {
                    base_dir.join("captures").join(&project.original_image)
                };
```
To:
```rust
                let original_path = PathBuf::from(&project.original_image);
                let image_path = if original_path.is_absolute() {
                    original_path
                } else {
                    captures_dir.join(&project.original_image)
                };
```

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "feat: resolve relative original_image against captures dir in determine_capture_type"
```

### Task 5: Update `startup_cleanup` thumbnail regen to use captures_dir

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:1365-1366`

- [ ] **Step 1: Update thumbnail regen path resolution (lines 1365-1366)**

Note: `captures_dir` is already available at line 1278.

Change:
```rust
                                let original_path = PathBuf::from(&project.original_image);
                                if original_path.exists() {
```
To:
```rust
                                let original_path = PathBuf::from(&project.original_image);
                                let original_path = if original_path.is_absolute() {
                                    original_path
                                } else {
                                    captures_dir.join(&project.original_image)
                                };
                                if original_path.exists() {
```

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "feat: resolve relative original_image in startup_cleanup thumbnail regen"
```

---

## Chunk 3: Remove path rewriting from move_save_dir

### Task 6: Remove path rewriting block from `move_save_dir`

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/settings.rs:336-365`

- [ ] **Step 1: Remove the path rewriting block**

Delete lines 336-365 (the block starting with `// Update project.json files to reflect the new paths.` through the closing `}`):

```rust
    // Update project.json files to reflect the new paths.
    // Projects store absolute paths to original images, so after moving
    // files we need to rewrite those paths from old_path → new_path.
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let projects_dir = app_data_dir.join("projects");
    if projects_dir.exists() {
        let old_prefix = old.to_string_lossy().to_string();
        let new_prefix = new.to_string_lossy().to_string();
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let project_file = entry.path().join("project.json");
                if let Ok(content) = std::fs::read_to_string(&project_file) {
                    if let Ok(mut project) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(img) = project.get("original_image").and_then(|v| v.as_str()) {
                            if img.starts_with(&old_prefix) {
                                let new_img = format!("{}{}", new_prefix, &img[old_prefix.len()..]);
                                project["original_image"] = serde_json::Value::String(new_img);
                                if let Ok(json) = serde_json::to_string_pretty(&project) {
                                    let _ = std::fs::write(&project_file, json);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
```

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Run all tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: All tests pass.

- [ ] **Step 4: Run full quality suite**

Run: `bun run typecheck && bun run lint && bun run test:run`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/settings.rs
git commit -m "refactor: remove path rewriting from move_save_dir — no longer needed with relative paths"
```

---

## Chunk 4: One-time migration of existing project.json files

### Task 7: Migrate existing project.json files to relative paths

This is a one-time script run, not a code change to commit.

- [ ] **Step 1: Run Python migration script**

Create and run a temporary Python script that strips directory prefixes from `original_image` in all project.json files at `C:\Users\walter\AppData\Roaming\com.moonsnap.app\projects\`:

```python
import os, json

projects_dir = r'C:\Users\walter\AppData\Roaming\com.moonsnap.app\projects'
updated = 0

for proj_id in os.listdir(projects_dir):
    pf = os.path.join(projects_dir, proj_id, 'project.json')
    if not os.path.isfile(pf):
        continue
    try:
        with open(pf, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError:
        continue

    if 'original_image' not in data:
        continue

    img = data['original_image']
    if not img or not os.path.isabs(img):
        continue

    data['original_image'] = os.path.basename(img)
    with open(pf, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    updated += 1

print(f'Updated {updated} project.json files')
```

- [ ] **Step 2: Verify migration**

Check a few project.json files to confirm `original_image` now contains just a filename.

- [ ] **Step 3: Delete the temporary script**
