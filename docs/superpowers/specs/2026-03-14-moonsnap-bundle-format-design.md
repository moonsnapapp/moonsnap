# `.moonsnap` Bundle Format

**Date**: 2026-03-14
**Status**: Draft

## Problem

Users don't know that project folders (containing `screen.mp4`, `cursor.json`, etc.) are managed by MoonSnap. They rename, move, or delete internal files, which breaks project parsing. Quick capture files also get silently moved into folders when opened in the editor, causing confusion.

## Solution

Rename project folders to use a `.moonsnap` extension, making them look like app-managed documents rather than browsable directories. Register the extension with the OS so double-clicking opens MoonSnap.

## Decisions

- **Approach**: Rename-only (folder gets `.moonsnap` extension, internal structure unchanged)
- **Migration**: Automatic on first launch after update; existing folders renamed in-place
- **Quick captures**: Stay as plain `.mp4`/`.gif` files, unchanged
- **Damaged bundles**: Show in library with repair option (re-link or delete)

## Bundle Format

A `.moonsnap` bundle is a directory with the `.moonsnap` extension:

```
moonsnap_20260314_123456_abc12.moonsnap/
├── project.json        # VideoProject metadata (relative paths)
├── screen.mp4          # Main recording
├── webcam.mp4          # Optional
├── cursor.json         # Optional
├── system.wav          # Optional
└── microphone.wav      # Optional
```

The folder name is the user-visible project name. Users can rename the bundle freely — the app resolves paths relative to the bundle root, never by folder name.

**Project identity**: The project ID comes from `project.json` (the `id` field), not from the folder name. The library and sidecar metadata (`projects/{id}/project.json` in AppData) use this internal ID for lookups. Renaming the bundle folder has no effect on project identity.

No changes to the `project.json` schema.

## OS Integration

### All platforms
- Register `.moonsnap` as a known file type during installation
- Custom icon for `.moonsnap` bundles
- Double-clicking opens MoonSnap and loads the project in the editor

### Windows
- Register in Windows registry via Tauri's file association config
- Set `Hidden` attribute on internal files (`screen.mp4`, `cursor.json`, etc.) whenever files are written into a `.moonsnap` bundle — during recording, migration, save, and repair
- Bundle folder itself stays visible with custom icon

### macOS
- `LSTypeIsPackage` flag in `Info.plist` so Finder treats `.moonsnap` as opaque (not browsable)
- Register UTI for the `.moonsnap` type

### Linux
- `.desktop` file and MIME type registration (standard XDG approach)

### File-open handler behavior
- When the app is already running with unsaved changes, prompt to save before loading the new bundle
- Bundles outside the captures directory open in-place (not copied)
- If `project.json` references unknown fields from a newer version, open in read-only mode with a warning

## Migration

**When**: First app launch after the update.

**Process**:
1. Scan captures directory for existing project folders (directories containing `screen.mp4` and/or `project.json`)
2. If `{foldername}.moonsnap` already exists as a file (legacy sidecar), delete the sidecar first — its data is already in the folder's `project.json`
3. Rename each folder by appending `.moonsnap` to the folder name
4. On Windows, set `Hidden` attribute on internal files
5. Update any stored absolute paths in app state (recent projects, library cache)
6. Quick capture flat files (`.mp4`, `.gif`) left untouched

**Safety**:
- Log each migration step
- If a rename fails (permissions, etc.), skip and show summary: "X of Y projects migrated. Z failed — [Show details]"
- No data deleted or moved — only parent folder renamed (and legacy sidecar cleaned up)

## Codebase Changes

### Rust backend
- `generate_output_path` (`video_recording/mod.rs`) — append `.moonsnap` to generated folder name
- `load_video_project_from_file` (`metadata.rs`) — recognize `.moonsnap` directories same as current project folders
- `load_video_project_folder` (`operations.rs`) — use the `id` field from `project.json` for project identity, not the folder name
- `get_capture_list` (`operations.rs`) — scan for both `*.moonsnap/` directories AND legacy bare project folders (backward compatibility for partially-failed migrations)
- New `migrate_projects` command — called on startup, handles folder renames
- New `repair_project` command — opens file picker to re-link missing `screen.mp4`
- Set `Hidden` attribute on Windows whenever writing files into a `.moonsnap` bundle (recording, save, repair)

### Frontend
- `CaptureCard.tsx` / `CaptureContextMenu.tsx` — add "Repair" option for damaged bundles
- Add `damaged: boolean` field to `CaptureListItem` for library repair UI
- Path display strips final `.moonsnap` extension from display names (standard `Path::file_stem` behavior — only removes the last extension)

### Tauri config
- `tauri.conf.json` — register `.moonsnap` file association, custom icon, deep link handler
- Handle `tauri://file-open` event to load bundle passed as CLI argument

## Repair Flow

When a `.moonsnap` bundle is missing `screen.mp4` (or file is zero-length/unreadable):

1. **Detection**: During `get_capture_list`, check `screen.mp4` exists and is >0 bytes. If not, mark as `damaged: true`.
2. **Library UI**: Damaged bundles show with a warning badge. Clicking opens repair dialog instead of editor.
3. **Repair dialog**: "The video file for this project is missing or damaged. Would you like to locate it?"
   - **Browse** — file picker filtered to video files. Selected file is moved into the bundle as `screen.mp4` (avoids doubling disk usage for large files). Metadata re-extracted via ffprobe. On Windows, `Hidden` attribute is set on the new file.
   - **Delete project** — removes entire `.moonsnap` bundle.
4. **After repair**: Re-validate, update library, open in editor if valid.

## Edge Cases

- **User renames `.moonsnap` folder**: Works fine — all internal paths are relative, project identity comes from `project.json` ID, library scans by contents not name.
- **User removes `.moonsnap` extension**: Folder becomes a plain directory. Library still finds it via legacy bare-folder scanning (backward compatibility). On next migration run, it gets the `.moonsnap` extension re-applied.
- **Duplicate names**: Not an issue — unique IDs in `project.json` and unique folder names from timestamp+random suffix.
- **Antivirus/backup software**: Bundle is a normal directory with standard files — should work fine.
- **Legacy `.moonsnap` sidecar files**: Cleaned up during migration (deleted before folder rename). Sidecar format is deprecated going forward.
- **Downgrade**: Users downgrading to an older MoonSnap version will not see `.moonsnap` bundles in the library. They would need to manually remove `.moonsnap` extensions from folder names. This is a known limitation.

## Export Behavior

Export behavior is unchanged — exports produce standalone video files (`.mp4`, `.gif`), not bundles. The `.moonsnap` format is internal to the app for project management only.
