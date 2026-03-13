# MoonSnap Prefix & Filtered Migration

## Problem

1. Files created by MoonSnap have no distinguishing prefix, making them hard to identify as MoonSnap files.
2. When the user changes save location, `move_save_dir` moves **all** files in the old directory — including non-MoonSnap files the user may have placed there — leading to false positives.

## Solution

Two changes:

1. **Add `moonsnap_` prefix** to all new files and folders created in the user's save directory.
2. **Filter migration** to only move MoonSnap-owned files (by prefix/pattern), leaving non-MoonSnap files untouched.

## File Naming Changes

All new captures get a `moonsnap_` prefix:

| Type | Current Pattern | New Pattern |
|------|----------------|-------------|
| Screenshot | `YYYY-MM-DD_HHMMSS_{id}.png` | `moonsnap_YYYY-MM-DD_HHMMSS_{id}.png` |
| Quick capture MP4 | `recording_YYYYMMDD_HHMMSS_{rand}.mp4` | `moonsnap_YYYYMMDD_HHMMSS_{rand}.mp4` |
| Editor project folder | `recording_YYYYMMDD_HHMMSS_{rand}/` | `moonsnap_YYYYMMDD_HHMMSS_{rand}/` |
| GIF | `recording_YYYYMMDD_HHMMSS_{rand}.gif` | `moonsnap_YYYYMMDD_HHMMSS_{rand}.gif` |

**Unchanged:**
- Thumbnails (`{id}_thumb.png`) — stored in app data dir, not user's save folder.
- Fallback temp dir paths — these use `recording_` prefix but are temporary.

## Migration Filter

`move_save_dir` in `settings.rs` will only move entries whose filenames match one of:

1. **`moonsnap_*`** — new-format files/folders
2. **`recording_*`** — legacy recording files/folders
3. **`YYYY-MM-DD_HHMMSS_{id}.png`** — legacy screenshot files (regex: `^\d{4}-\d{2}-\d{2}_\d{6}_[a-f0-9]+\.png$`)

Everything else stays in the old directory. The old directory is only removed if empty after the filtered move.

## Files to Modify

### `operations.rs` — Screenshot naming (3 locations)
- Lines 76-77, 163-164, 251-252: Change `format!("{}_{}.png", date_str, &id)` to `format!("moonsnap_{}_{}.png", date_str, &id)`

### `video_recording/mod.rs` — Recording naming (`generate_output_path`)
- Line 1444: `recording_{}_{}.mp4` → `moonsnap_{}_{}.mp4`
- Line 1448: `recording_{}_{}/` → `moonsnap_{}_{}/`
- Line 1457: `recording_{}_{}.gif` → `moonsnap_{}_{}.gif`
- Lines 930, 944 (temp fallbacks): Keep `recording_` prefix — these are temp files, not in save dir.

### `settings.rs` — Migration filter (`move_save_dir`)
- Lines 279-282: Add a filter to `entries` that only includes filenames matching `moonsnap_*`, `recording_*`, or the legacy screenshot date pattern.
- Add a helper function `is_moonsnap_file(name: &str) -> bool` for the pattern matching.
- Update `total` count in progress events to reflect only filtered entries (not all entries), so the progress bar is accurate.

### `settings.rs` — Locked file check (`check_dir_for_move`)
- Apply the same `is_moonsnap_file` filter so locked-file detection only checks MoonSnap files.

## No Changes Needed

- **Gallery scan** (`operations.rs` ~line 875): Discovers files by extension (`.png`, `.mp4`, `.gif`) and folder contents (`screen.mp4`). Not prefix-dependent.
- **Video project loading** (`metadata.rs`): Uses path-based sibling discovery. Works with any prefix.

## Testing

- Verify new screenshots/recordings get `moonsnap_` prefix.
- Verify migration moves `moonsnap_*`, `recording_*`, and legacy screenshot files.
- Verify non-MoonSnap files in the save directory are NOT moved.
- Verify old directory is only removed if empty after filtered move.
- Verify gallery still loads both old `recording_*` and new `moonsnap_*` files.
