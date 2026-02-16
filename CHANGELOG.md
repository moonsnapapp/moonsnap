# Changelog

All notable changes to SnapIt are documented in this file.

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
