# Changelog

All notable changes to MoonSnap are documented in this file.

## [0.5.21] - 2026-05-05

### Changed
- Recording mode chooser now uses a polished HUD-style panel with larger buttons, clearer spacing, and native overlay rendering.
- Free-mode Pro feature prompts now explain locked features more clearly.

### Fixed
- Recording mode chooser buttons stay clickable while adjusting a selected capture area.

## [0.5.20] - 2026-04-27

### Added
- Per-segment speed controls in the video editor — set playback speed independently for each trim segment.

### Changed
- Library search input now stays visible in the toolbar instead of expanding on click.
- Sidebar density slider snaps to refined stops for finer thumbnail sizing.

### Fixed
- Timeline navigation (prev/next, jump to start/end) now respects the in/out loop range.
- Empty editor view offers a button to reopen the last viewed capture.
- Library focus is restored to the last opened capture when returning from the editor.

## [0.5.19] - 2026-04-26

### Added
- Save As for any capture from the library, with PNG/JPG/WebP format conversion for images.
- Previous/next capture navigation buttons over the image and video editor canvas.
- Outline color and width for the text annotation box.
- Collapsible library sidebar — click the resize handle to fold the sidebar to a thin rail and click again to restore.

### Changed
- Image and video editors now open inline inside the library window instead of separate windows.
- Settings is now an in-window dialog with a header, tab breadcrumb, and a footer that shows the app version, check-for-updates button, and inline download progress.
- Opening a capture from the floating screenshot or recording preview now brings up the library editor instead of spawning a separate window.
- Drawing tools stay active after placing a shape, so you can drop several without re-selecting the tool.
- Text editor: Escape now commits the edit, font size goes up to 100px and auto-grows the box, and new text defaults to center / middle alignment.
- Dialogs animate from the center with a fade and zoom instead of sliding in from a corner.

### Fixed
- PrintScreen-based shortcuts fire reliably on Windows, and registration failures now surface in the settings UI instead of silently swallowing every shortcut.
- Default PrintScreen bindings shifted to `Ctrl+PrintScreen` and `Ctrl+Shift+PrintScreen` so the Snipping Tool doesn't steal them.
- Clicking the floating screenshot preview opens the editor again — dragging still works for repositioning.
- Embedded video editor playback buttons regained their rounded corners.
- Capture overlay focus and always-on-top handling.

## [0.5.18] - 2026-04-01

### Fixed
- "Last used area" now reflects dimension changes made via presets or manual input after selecting a capture region.

## [0.5.17] - 2026-03-29

### Changed
- Faster video and GIF exports with GPU-accelerated cursor overlays.

## [0.5.16] - 2026-03-27

### Fixed
- Area selection drag handles now respond correctly when repositioning saved areas.
- Startup toolbar is properly centered on launch.

## [0.5.15] - 2026-03-26

### Added
- Saved area selections: save up to 3 capture areas and recall them from the toolbar without redrawing.
- Aspect ratio lock toggle on dimension inputs — linked by default so resizing one dimension keeps proportions.

### Changed
- Redesigned the Saved Areas section in recording settings to match the rest of the settings dialog.

### Fixed
- Editor layout no longer clips content when the sidebar is resized.

## [0.5.14] - 2026-03-18

### Added
- Auto-copy to clipboard when taking a screenshot, with preview feedback.

### Fixed
- Text tool edit box now aligns precisely with the background box at all zoom levels.

## [0.5.13] - 2026-03-15

### Added
- HUD-style titlebar with centered branding and context labels across all windows.
- Minimize button on the floating capture toolbar.
- Smart content-area detection for Chromium browsers during area capture.

### Changed
- Redesigned window shells, cards, toolbars, and sidebar panels with a unified dark-first glassmorphism style.
- Unified toggle and choice buttons into a consistent pill style across settings, editors, and background panels.
- Smoother video editor playback with reduced unnecessary re-renders.

### Fixed
- Deleting a project now reliably cleans up metadata for all capture types.

## [0.5.12] - 2026-03-14

### Added
- Save Copy option for quick capture videos and GIFs.
- Recording mode chooser prompt before video capture with audio indicators.
- Repair UI for damaged projects in the library.
- Automatic migration from legacy project folders to the new bundle format.
- File association for `.moonsnap` project files.
- Annotation delete and undo/redo support with unclamped arrow endpoints.
- Caption language dropdown in the video editor.

### Changed
- Screenshot filenames now use a `moonsnap_` prefix for clearer identification.
- Save directory migration only moves MoonSnap-owned files.
- Redesigned recording HUD and capture toolbar appearance.
- Default save path changed to ~/MoonSnap with move folder dialog.

### Fixed
- Recording mode chooser stays centered when resizing.
- Save Copy dialog now defaults to the original filename.
- Library no longer shows File Missing after moving save directory.
- License status flickering on startup.
- GPU device loss recovery and playback robustness.
- Playhead jump-to-start after scrub.
- Library window centering.
- Hotkey shortcut handling.
- Various recording HUD and capture toolbar stability fixes.

## [0.5.11] - 2026-03-10

### Fixed
- Badge counts now stay in sync across multiple windows.

## [0.5.10] - 2026-03-10

### Fixed
- Minor bug fixes.

## [0.5.9] - 2026-03-08

### Fixed
- Capture thumbnails now fit correctly regardless of aspect ratio.
- Deleting a freshly opened capture no longer fails before the project is saved.

## [0.5.8] - 2026-03-07

### Added
- Beta update channel for early access to new features.
- Improved timeline zoom with better scroll behavior.

### Changed
- True squircle (superellipse) shape for video frame corner radius.
- Faster editor resizing with reduced lag during window resize.

### Fixed
- Capture bar now retains theme correctly.
- Tray icon context menu reliably appears in the foreground on click.
- Typewriter sound effect now ends in sync with the visual character reveal.
- Squircle border snapping at radius 0, increased max radius to 200px, and border syncs with zoom.
- Squircle border now renders with proper curve on both inner and outer edges.
- Playhead snaps to the exact end when video finishes playing.
- Playhead no longer oscillates when crossing deleted trim segments.
- Fit-to-window now fills the full timeline width for short videos.

## [0.5.7] - 2026-03-02

### Changed
- Webcam overlay rectangle shape renamed to squircle with proportional border radius.

### Fixed
- Bundle FFmpeg runtime DLLs on Windows to prevent missing dependency errors.
- Restore editor state correctly after window remount.

## [0.5.6] - 2026-02-28

### Changed
- Faster video export with GPU-accelerated text overlay compositing.
- Smoother typewriter animation with per-character reveal timing and line-aware clipping.

### Fixed
- Correct audio volume when mixing typewriter sound effects with source audio.

## [0.5.5] - 2026-02-26

### Added
- Click-to-cut mode replaces split-at-playhead for faster timeline trimming.
- Ruler scrub-to-seek for quick timeline navigation by dragging the ruler.
- Typewriter text animation with optional typing sound effect.
- Cursor fade-out after inactivity with configurable toggle.
- Media type filter (image/video/gif) in the capture library toolbar.
- Arrows and lines now participate in group selection and transforms.
- Background image is now a movable shape, independent of crop bounds.
- Wallpaper background type with auto-resolve for the compositor.
- IO markers now extend the counterpart to the timeline boundary instead of clearing it.

### Changed
- Default webcam overlay shape changed from circle to rounded rectangle.
- Playhead is now amber and IO markers are coral for clearer visual distinction.
- Stroke width uses a 1–20 px slider instead of fixed presets.
- Crop handles require Shift to snap, reducing accidental constraint.
- Faster caption overlay updates by caching data between frames.
- Faster editor scrubbing and rendering responsiveness.
- Wallpaper thumbnail caching for quicker background panel loads.

### Fixed
- Cursor sizing normalized by dominant dimension so wide cursors render at the same scale as arrow.
- Export cursor now matches preview behavior for zoom tracking and shape fallback.
- Pixel-aligned render bounds eliminate sub-pixel blurriness on artboard edges.
- Playback pauses automatically when scrubbing the timeline ruler.
- Webcam lifecycle and cursor compositing stability improvements.
- Compositor shadow and border-radius suppressed when content has transparency.
- Crop handle drag jitter and square handles outside artboard edges.
- Marquee selection no longer gets stuck when the mouse is released outside the canvas.
- Arrow and line shapes now support group drag correctly.
- Editor gizmos excluded from screenshot export and clipboard copy.
- Video preview and audio suspended when the editor view is inactive.
- FFmpeg export errors now log stderr output for diagnostics.
- Update check button loading state resets correctly on failure.

## [0.5.4] - 2026-02-17

### Added
- Quick reset crop button next to Edit Crop in the export panel.
- Output resolution display for both Auto and manual composition modes.

### Changed
- Crop dialog opens at full video size and presets fill-to-maximize within video bounds.
- Crop aspect ratio toggle shows clearer label with visible active state.
- Audio controls moved from Project tab to Export tab.
- Background toggle sets sensible default padding and rounding when enabled.

## [0.5.3] - 2026-02-16

### Added
- Click-to-place for the Text tool and crosshair cursor for drawing tools.
- Changelog viewer in desktop settings and on the web.
- Show Background toggle for the Style panel.

### Changed
- Text tool drawing and selection performance significantly improved.

### Fixed
- Consistent composition padding across different output resolutions.
- Use native file picker for background images and reset toolbar state on save.
- Fix frame jitter when cropping to odd dimensions.
- Live preview during text box resize drag.
- Autosave only triggers on actual changes, reducing unnecessary disk writes.
- Text box resizing no longer changes font size.

## [0.5.2] - 2026-02-16

### Added
- User-configurable cursor motion blur with smoother velocity ramping.

### Fixed
- Restart playback from the beginning when play is pressed at the end of the timeline.
- Improved reliability of feedback submission.

## [0.5.1] - 2026-02-15

### Fixed
- Use window bounds for area selection instead of window capture mode.

## [0.5.0] - 2026-02-15

### Added
- Caption editor improvements with per-word timing, smoother transitions, and segment regeneration.

### Changed
- Faster export pipeline via GPU resource reuse and pipeline overlap.
- Faster video decoding with GPU-accelerated path.

### Fixed
- Account for titlebar control width in toolbar window sizing.
- Open video projects in editor and quick recordings in the system player.
- Clear preview time at playback start to avoid audio sync stutter.

## [0.4.30] - 2026-02-14

### Changed
- Capped preview resolution to source dimensions on high-DPI displays.

### Fixed
- Pixelate canvas now respects visible cropped video region.
- Text overlay dragging improved (initial mousedown behavior, edge overflow, preview/export alignment).
- More reliable audio sync when seeking during playback.

## [0.4.29] - 2026-02-09

### Fixed
- Settings update button now shows the available version number.
- Reduced audio rewind artifacts from small backward seeks during playback.

## [0.4.28] - 2026-02-08

### Added
- Consistent preview and export rendering for composition layout, captions, and overlays.
- WYSIWYG text export via shared Canvas 2D rendering.
- Overlay segments are now adjusted automatically when trim segments are deleted.

### Fixed
- Crop gizmo drag jitter removed and crop lock toggle commit path corrected.
- Improved reconnect handling for preview stream disconnects.
- Caption GPU errors now tolerate brief transient failures before CSS fallback.
- Segment properties overlay dismisses correctly when switching sidebar tabs.

## [0.4.27] - 2026-02-07

### Added
- IO markers for defining export sub-ranges.

## [0.4.26] - 2026-02-06

### Added
- Audio output device selection and export cancellation support.

### Changed
- Simplified export UI by removing dead preset/aspect controls and using explicit format + FPS.

### Fixed
- Export cleanup path improvements after cancellation and failures.

## [0.4.25] - 2026-02-05

### Added
- Visual progress bar for update downloads.

## [0.4.24] - 2026-02-04

### Fixed
- Lossless SVG cursor rendering in preview.
- Cursor positioning with crop enabled in editor preview.

## [0.4.23] - 2026-02-04

### Fixed
- Audio/caption sync issues across pause/resume and segment editing.
- Playback engine stability and multi-instance behavior improvements.

## [0.4.22] - 2026-02-02

### Fixed
- Pause/resume synchronization across capture subsystems.
- Injected silence during system audio gaps to preserve A/V sync.

## [0.4.21] - 2026-01-30

### Changed
- Simplified cursor canvas sizing for better runtime performance.

### Fixed
- Removed double-zoom behavior on cursor and click overlays.

## [0.4.20] - 2026-01-29

### Changed
- Removed hide-when-idle cursor behavior.

### Fixed
- Auto-update downloads now resolve correctly from the public releases mirror.

## [0.4.19] - 2026-01-28

### Added
- Export now respects trim segments.

### Fixed
- Cursor lookup in preview/export now uses source time consistently.

## [0.4.18] - 2026-01-27

### Added
- Reset trim action to restore full video range.
- Waveform visualization for trim segments.

## [0.4.17] - 2026-01-27

### Added
- Video trim functionality with segment-based editing.

## [0.4.15] - 2026-01-26

### Added
- Public web landing page.
- Caption system with whisper transcription, GPU caption layer, and save/load support.
- Consistent preview and export rendering for captions and layout.
- Output resolution controls and improved caption rendering pipeline.
- Video editor panel reorganization (audio, cursor, webcam, export settings).

### Changed
- Editor compositor and background settings simplified.

### Fixed
- Clipboard/export wallpaper background behavior in editor.
- Undo/redo reliability for shape transforms and tool colors.
- Caption positioning/padding parity between preview and export.

## [0.4.14] - 2026-01-18

### Added
- Standalone image editor windows and editor keyboard shortcuts.
- Video cropping + composition controls.
- GPU error boundary and device-lost recovery paths.
- NVENC hardware encode path with x264 fallback.

### Changed
- Faster app startup with lazy-loading optimizations.

### Fixed
- Transparent-window corner artifacts and several overlay alignment regressions.
- Webcam overlay anchoring/positioning inside the composition container.
- Preview/export shadow parity and crop application correctness.
- Maintained aspect ratio behavior during window resize.

## [0.4.13] - 2026-01-14

### Fixed
- Export scene transitions now align with preview behavior.
- Webcam overlay hides correctly during camera-only scene transitions.

## [0.4.12] - 2026-01-14

### Added
- Improved video editor color picker and webcam shadow controls.

### Changed
- Faster zoom region thumbnail rendering.

### Fixed
- Timeline ruler click no longer clears segment selection.
- Text segment fade animation now uses the intended trapezoid curve.
- Webcam overlay anchoring now targets composition bounds.

## [0.4.11] - 2026-01-14

### Fixed
- Playback now resumes from playhead position rather than preview scrubber position.
- General video editor export/playback reliability improvements.

## [0.4.10] - 2026-01-14

### Fixed
- Preserved directory structure when bundling background wallpapers.

## [0.4.9] - 2026-01-14

### Changed
- Faster text rendering with native GPU path.

### Fixed
- Improved font handling and weight enumeration in text rendering fallback paths.

## [0.4.7] - 2026-01-13

### Fixed
- Hotkey registration race condition and stray console window visibility.

## [0.4.6] - 2026-01-13

### Fixed
- Microphone is released correctly when capture toolbar closes.
- FFmpeg DLL bundling improvements for release builds.

## [0.4.4] - 2026-01-13

### Added
- Floating video editor windows for multi-project editing.
- Caption, mask, and text segment workflows with config panels.
- Settings window and feedback submission.
- Additional webcam overlay options (shape variants, shadows, sizing/scaling controls).
- Cursor rendering improvements (shape support, opacity fade, click animation, scroll cursor support).
- Device selectors and expanded video editor UI polish.

### Changed
- Improved timeline and preview performance.

### Fixed
- Cursor fallback normalization and sync issues.
- Audio jitter and MP4 faststart playback/startup behavior.
- Multiple GPU preview corruption/skew issues and overlay zoom/frame edge cases.

## [0.4.3] - 2026-01-08

### Fixed
- Discard pre-captured frame to resolve cursor/video sync mismatch in release builds.

## [0.4.2] - 2026-01-08

### Added
- Improved region capture and cursor-video timestamp synchronization.
- Consistent cursor positioning across multi-monitor setups.

### Fixed
- FFmpeg path resolution and recording reliability on Windows.

## [0.4.1] - 2026-01-06

### Fixed
- Hidden FFmpeg console windows and improved installer bundling behavior.

## [0.4.0] - 2026-01-05

### Added
- Quick capture mode for recording flows.
- Video project save + auto-save support.
- GPU-accelerated video editor/export pipeline with timeline and waveform improvements.
- Webcam recording/compositing enhancements and cursor capture/highlight support.
- Recording pre-warm/preparation paths for faster startup.
- Settings window.

### Changed
- Migrated UI components to shadcn/ui and standardized theme/CSS variable usage.

### Fixed
- DPI/window sizing, multi-monitor capture bounds, and GIF capture reliability.
- Recording state consistency and toolbar/webcam restoration edge cases.

## [0.3.0] - 2025-12-28

### Added
- **Video Recording** - Screen recording with MP4 output, system audio, and microphone support
- **GIF Recording** - Capture screen as animated GIFs with optimized encoding
- **Webcam Overlay** - Add webcam feed to recordings
- **Countdown Timer** - Configurable countdown before recording starts
- **Cursor Capture** - Include cursor in recordings
- **Line Tool** - Draw straight lines as annotations
- **Tag Support** - Organize captures with custom tags
- **Undo/Redo** - Full history support for editor actions

### Changed
- Enhanced overlay with resize handles for region adjustment
- Improved glassmorphism styling throughout UI

### Fixed
- Windows resize lag with transparency enabled
- Stale closures in marquee selection
- Audio sync issues in recordings
- Save-on-exit race conditions

## [0.2.5] - 2025-12-24

### Added
- Momentum zoom for canvas navigation
- Double-click to open captures in library
- Momentum scroll in capture library
- WebView2 GPU optimization flags for Windows

### Changed
- Updated React to v19.2.0
- Instant theme switching (disabled transitions during switch)
- Optimized library grid animations and resize performance

### Fixed
- Virtual screen bounds calculation
- Duplicate window borders on rapid monitor switching

## [0.2.4] - 2025-12-24

### Added
- Window state persistence (remembers size/position)
- Single-instance enforcement (prevents multiple app windows)

### Changed
- Dynamic app version display in settings
- Enhanced startup cleanup with pre-created directories

## [0.2.2] - 2025-12-23

### Added
- Auto-update checking and installation
- Missing file detection with re-import option
- Delete capture with confirmation dialog
- Text shape with stroke/fill color support
- All monitors capture mode
- Minimize-to-tray option
- User-configurable save directory
- BMP image format support
- Keyboard shortcuts for editor actions

### Changed
- Auto-deselect shapes when switching tools
- Reset to select tool on new image load
- Enhanced compositor settings persistence
- Improved blur controls with preset intensity levels

### Fixed
- Alert dialog animation classes
- Crop overlay dragging during pan
- Invisible shapes fallback color

## [0.2.1] - 2025-12-23

### Changed
- Minor improvements and bug fixes

## [0.2.0] - 2025-12-23

### Added
- Compositor background effects (solid, gradient, image)
- Color picker in properties panel
- Date grouping in capture library
- Dynamic tray menu with shortcut text
- Arrow shape with improved handles
- Tooltip responsiveness improvements

### Changed
- Simplified padding calculation to absolute pixels
- Improved window detection performance

### Fixed
- Pixel alignment in screen capture
- Logical to physical pixel scaling
- Window capture reliability

## [0.1.0] - 2025-12-21

### Added
- Initial release
- Region, fullscreen, and window capture
- Annotation tools: rectangle, ellipse, arrow, text, highlight, blur, pen, steps
- Crop and expand functionality
- Global hotkey support
- Capture library with thumbnails
- Favorites system
- Light/dark theme support
- Auto-updates via GitHub releases
