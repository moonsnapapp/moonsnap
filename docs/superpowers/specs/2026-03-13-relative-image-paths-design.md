# Switch original_image to Relative Paths

## Problem

`original_image` in project.json stores absolute paths (e.g., `C:\Users\walter\Documents\MoonSnap\moonsnap_2026-03-13_143022_abc123.png`). When the user changes save location, `move_save_dir` must rewrite every project.json to update these paths. This is fragile and was the root cause of the metadata migration complexity.

## Solution

Store only the filename (e.g., `moonsnap_2026-03-13_143022_abc123.png`) in `original_image`. Resolve it at read time against the user's configured save directory (`get_captures_dir()`).

## Changes

### Write side — `operations.rs` (3 locations)

Lines 101, 188, 281: Currently store `original_path.to_string_lossy().to_string()` (full absolute path). Change to store just the filename (`original_filename`), which is already available as a local variable at each location.

### Read side — `operations.rs` (3 locations)

Lines 446-452, 961-966, 1009-1014: The existing code checks `is_absolute()` and falls back to `base_dir.join("captures")` for relative paths. Change the fallback to resolve against the user's configured save directory instead.

Function availability:
- `load_project_item` (line 446): Does **not** have `AppHandle`. Add a `captures_dir: PathBuf` parameter and pass it from the caller (`list_captures`, which has `app`).
- `get_project_image` (line 961): Has `app: AppHandle`. Call `get_captures_dir(&app)` directly.
- `determine_capture_type` (line 1009): Has `app: &AppHandle`. Call `get_captures_dir(app)` directly.

### Read side — `operations.rs` (1 location for thumbnail regen)

Line 1365: Uses `PathBuf::from(&project.original_image)` directly. Needs the same relative-path resolution using `get_captures_dir`.

### Remove path rewriting from `move_save_dir` — `settings.rs`

Lines 336-365: The block that rewrites `original_image` paths in project.json files after moving is no longer needed. Remove it entirely. With relative filenames, moving files to a new directory doesn't require metadata updates.

### Backwards compatibility

The existing `is_absolute()` check provides natural backwards compatibility. Old projects with absolute paths continue to work. New projects get relative filenames. No forced migration required — it just works.

### Optional: one-time migration of existing project.json files

Strip directory prefix from `original_image` in all existing project.json files, leaving just the filename. This is a one-time operation, not code — run manually or as a script. Not strictly necessary since absolute paths still work, but keeps data consistent.

## Files to Modify

- `apps/desktop/src-tauri/src/commands/storage/operations.rs` — write side (3 locations) + read side (4 locations)
- `apps/desktop/src-tauri/src/commands/settings.rs` — remove path rewriting block

## No Changes Needed

- `moonsnap-domain/src/storage.rs` — `original_image: String` type is unchanged
- Frontend TypeScript — consumes `image_path` from the backend response, never reads `original_image` directly
- Gallery scan — discovers files by extension, not by metadata

## Testing

- Verify new captures store relative filename in project.json
- Verify gallery correctly resolves relative filenames against save directory
- Verify old projects with absolute paths still load correctly
- Verify `move_save_dir` no longer rewrites project.json paths
- Verify folder migration works end-to-end (move files, gallery still shows everything)
