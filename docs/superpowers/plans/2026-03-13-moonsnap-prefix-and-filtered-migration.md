# MoonSnap Prefix & Filtered Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `moonsnap_` prefix to all new files/folders and filter folder migration to only move MoonSnap-owned files.

**Architecture:** Change file naming at creation points (3 screenshot locations, 1 recording function). Add an `is_moonsnap_file` helper to `settings.rs` and use it to filter both `move_save_dir` and `check_dir_for_move`.

**Tech Stack:** Rust (Tauri backend)

**Spec:** `docs/superpowers/specs/2026-03-13-moonsnap-prefix-and-filtered-migration-design.md`

---

## Chunk 1: is_moonsnap_file helper + tests

### Task 1: Add `is_moonsnap_file` helper with tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/settings.rs`

- [ ] **Step 1: Write the failing tests**

Add a `#[cfg(test)]` module at the bottom of `settings.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::is_moonsnap_file;

    #[test]
    fn test_new_prefix_screenshot() {
        assert!(is_moonsnap_file("moonsnap_2024-03-13_143022_abc123.png"));
    }

    #[test]
    fn test_new_prefix_mp4() {
        assert!(is_moonsnap_file("moonsnap_20240313_143022_12345.mp4"));
    }

    #[test]
    fn test_new_prefix_folder() {
        assert!(is_moonsnap_file("moonsnap_20240313_143022_12345"));
    }

    #[test]
    fn test_new_prefix_gif() {
        assert!(is_moonsnap_file("moonsnap_20240313_143022_12345.gif"));
    }

    #[test]
    fn test_legacy_recording_mp4() {
        assert!(is_moonsnap_file("recording_20240313_143022_12345.mp4"));
    }

    #[test]
    fn test_legacy_recording_folder() {
        assert!(is_moonsnap_file("recording_20240313_143022_12345"));
    }

    #[test]
    fn test_legacy_screenshot() {
        assert!(is_moonsnap_file("2024-03-13_143022_abc123def456.png"));
    }

    #[test]
    fn test_rejects_random_png() {
        assert!(!is_moonsnap_file("vacation_photo.png"));
    }

    #[test]
    fn test_rejects_date_named_non_moonsnap_png() {
        assert!(!is_moonsnap_file("2024-01-15_vacation_photo.png"));
    }

    #[test]
    fn test_rejects_random_folder() {
        assert!(!is_moonsnap_file("my_documents"));
    }

    #[test]
    fn test_rejects_random_mp4() {
        assert!(!is_moonsnap_file("family_video.mp4"));
    }

    #[test]
    fn test_rejects_empty() {
        assert!(!is_moonsnap_file(""));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib settings::tests -- --nocapture`
Expected: FAIL — `is_moonsnap_file` not found.

- [ ] **Step 3: Implement `is_moonsnap_file`**

Add this function above the `#[cfg(test)]` block in `settings.rs`:

```rust
/// Check if a filename matches known MoonSnap naming patterns.
/// Used to filter migration and locked-file checks to only MoonSnap-owned files.
///
/// Matches:
/// - `moonsnap_*` (new prefix)
/// - `recording_*` (legacy recordings)
/// - `YYYY-MM-DD_HHMMSS_{hex_id}.png` (legacy screenshots)
fn is_moonsnap_file(name: &str) -> bool {
    if name.starts_with("moonsnap_") || name.starts_with("recording_") {
        return true;
    }

    // Legacy screenshot pattern: YYYY-MM-DD_HHMMSS_{hex_id}.png
    if name.ends_with(".png") && name.len() > 20 {
        let bytes = name.as_bytes();
        // Check date: YYYY-MM-DD_ (11 chars)
        if bytes.len() >= 18
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && bytes[10] == b'_'
            && bytes[0..4].iter().all(|b| b.is_ascii_digit())
            && bytes[5..7].iter().all(|b| b.is_ascii_digit())
            && bytes[8..10].iter().all(|b| b.is_ascii_digit())
            // Check time: HHMMSS_ (7 chars starting at index 11)
            && bytes[11..17].iter().all(|b| b.is_ascii_digit())
            && bytes[17] == b'_'
            // Check remaining is hex + .png
            && name[18..name.len() - 4]
                .chars()
                .all(|c| c.is_ascii_hexdigit())
        {
            return true;
        }
    }

    false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib settings::tests -- --nocapture`
Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/settings.rs
git commit -m "feat: add is_moonsnap_file helper for identifying MoonSnap-owned files"
```

---

## Chunk 2: Filter move_save_dir and check_dir_for_move

### Task 2: Filter `check_dir_for_move` to only check MoonSnap files

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/settings.rs:193-231`

- [ ] **Step 1: Apply filter to `check_dir_for_move`**

In the `check_dir_for_move` function, change the entries collection (line 199-202) from:

```rust
    let entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .collect();
```

to:

```rust
    let entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| is_moonsnap_file(&e.file_name().to_string_lossy()))
        .collect();
```

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/settings.rs
git commit -m "feat: filter check_dir_for_move to only check MoonSnap files"
```

### Task 3: Filter `move_save_dir` to only move MoonSnap files

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/settings.rs:255-371`

- [ ] **Step 1: Apply filter to `move_save_dir`**

In the `move_save_dir` function, change the entries collection (line 279-282) from:

```rust
    let entries: Vec<_> = std::fs::read_dir(&old)
        .map_err(|e| format!("Failed to read old directory: {}", e))?
        .filter_map(|e| e.ok())
        .collect();
```

to:

```rust
    let entries: Vec<_> = std::fs::read_dir(&old)
        .map_err(|e| format!("Failed to read old directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| is_moonsnap_file(&e.file_name().to_string_lossy()))
        .collect();
```

The `total` variable on line 284 already derives from `entries.len()`, so after filtering it will correctly reflect only MoonSnap files — no further change needed for progress reporting.

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Run existing tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/settings.rs
git commit -m "feat: filter move_save_dir to only migrate MoonSnap-owned files"
```

---

## Chunk 3: Add moonsnap_ prefix to file naming

### Task 4: Add `moonsnap_` prefix to screenshot filenames

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/storage/operations.rs:77,164,252`

- [ ] **Step 1: Update screenshot naming (3 locations)**

Change all three instances of the screenshot filename format. Each appears as:

```rust
    let original_filename = format!("{}_{}.png", date_str, &id);
```

Change to:

```rust
    let original_filename = format!("moonsnap_{}_{}.png", date_str, &id);
```

Locations:
1. Line 77 (in `save_capture`)
2. Line 164 (in `save_capture_from_rgba`)
3. Line 252 (in `save_capture_from_file`)

- [ ] **Step 2: Run `cargo check`**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/storage/operations.rs
git commit -m "feat: add moonsnap_ prefix to screenshot filenames"
```

### Task 5: Add `moonsnap_` prefix to recording filenames

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/video_recording/mod.rs:1444,1448,1457`

- [ ] **Step 1: Update recording naming in `generate_output_path`**

Change the three format strings in the `generate_output_path` function:

Line 1444 — quick capture MP4:
```rust
                let filename = format!("recording_{}_{}.mp4", timestamp, rand::random::<u16>());
```
→
```rust
                let filename = format!("moonsnap_{}_{}.mp4", timestamp, rand::random::<u16>());
```

Line 1448 — editor project folder:
```rust
                let folder_name = format!("recording_{}_{}", timestamp, rand::random::<u16>());
```
→
```rust
                let folder_name = format!("moonsnap_{}_{}", timestamp, rand::random::<u16>());
```

Line 1457 — GIF:
```rust
            let filename = format!("recording_{}_{}.gif", timestamp, rand::random::<u16>());
```
→
```rust
            let filename = format!("moonsnap_{}_{}.gif", timestamp, rand::random::<u16>());
```

**Do NOT change** the temp fallback paths at lines 930 and 944 — those use `recording_` prefix in `temp_dir()`.

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
git add apps/desktop/src-tauri/src/commands/video_recording/mod.rs
git commit -m "feat: add moonsnap_ prefix to recording filenames and folders"
```
