# MoonSnap Rust Library Extraction Plan

## Goal

Turn MoonSnap's Rust backend into reusable crates that can be consumed by future capture/editor products, while keeping the Tauri app as a thin integration shell.

## Current Baseline (Done)

- Workspace created under `src-tauri` with dedicated crates for:
- `moonsnap-core`
- `moonsnap-domain`
- `moonsnap-media`
- `moonsnap-render`
- Platform/runtime crates already separated:
- `scap-direct3d`
- `scap-targets`
- `camera-windows`
- App-side compatibility shims preserve existing module paths while code moves to crates.

## Progress Snapshot (2026-02-28)

- Phase 1 foundations completed:
- Explicit crate roots + smoke tests + per-crate README for `moonsnap-core`, `moonsnap-domain`, `moonsnap-media`, `moonsnap-render`.
- Wildcard crate-root exports tightened in `moonsnap-core` and `moonsnap-media`.
- Phase 2 started:
- New `moonsnap-capture` crate added and wired into workspace/app dependencies.
- New `moonsnap-export` crate added and wired into workspace/app dependencies.
- Moved timing/state modules from app shell to `moonsnap-capture`:
  - `timestamp`
  - `master_clock`
  - `state`
- Moved recorder support modules from app shell to `moonsnap-capture`:
  - `recorder/buffer`
  - `recorder/helpers`
  - `d3d_capture`
  - `recorder/capture_source`
- Moved audio/runtime modules from app shell to `moonsnap-capture`:
  - `audio` (legacy cpal capture helpers)
  - `audio_wasapi`
  - `audio_sync`
  - `audio_multitrack`
  - runtime monitor/display helpers from `video_recording/types.rs`
- Moved GIF engine modules from app shell to `moonsnap-capture`:
  - `gif_encoder`
  - `ffmpeg_gif_encoder`
- Moved additional runtime modules from app shell to `moonsnap-capture`:
  - `fragmentation` (manifest + atomic persistence helpers)
  - `desktop_icons`
- Moved recorder orchestration module (Tauri-free core):
  - `recorder/gif` moved to `moonsnap-capture::recorder_gif` with callback-based state emission
- Moved shared video-capture planning helpers:
  - `recorder/video` mode-to-source planning extracted to `moonsnap-capture::recorder_video_capture`
  - app `recorder/video.rs` now uses crate APIs for plan creation + source setup + dimension resolution
- Moved shared cursor region resolution helpers:
  - `recorder/video` cursor-region mode handling extracted to `moonsnap-capture::recorder_cursor_region`
  - app now injects only lookup adapters (`get_window_rect`, `get_scap_display_bounds`)
- Moved shared audio artifact path planning:
  - quick-capture/editor WAV path decisions extracted to `moonsnap-capture::recorder_audio_paths`
- Moved shared loop command/pause control:
  - MP4 recorder command channel + pause/resume state logic extracted to `moonsnap-capture::recorder_loop_control`
  - app recorder loop now delegates stop/cancel/pause handling and active elapsed-time calculation to crate
- Moved shared first-frame synchronization:
  - stale-frame skip + first post-start frame selection extracted to `moonsnap-capture::recorder_first_frame`
  - app recorder now delegates initial timestamp alignment to crate helper
- Moved shared frame pacing helpers:
  - frame interval sleep computation extracted to `moonsnap-capture::recorder_pacing`
  - app recorder now delegates deterministic pacing math to crate helper
- Moved shared finalization planning helpers:
  - quick-capture vs editor finalization decisions extracted to `moonsnap-capture::recorder_finalization`
  - project artifact flag computation moved from app recorder into crate helper
- Moved shared progress emission helpers:
  - periodic `RecordingState::Recording` construction/cadence moved to `moonsnap-capture::recorder_progress`
  - app recorder now provides only callback emission wiring
- Moved shared output-path planning helpers:
  - editor/quick-capture screen+webcam path planning moved to `moonsnap-capture::recorder_output_paths`
- Moved shared cursor persistence callback helper:
  - cursor persistence gating+callback moved to `moonsnap-capture::recorder_cursor_persistence`
- Moved shared webcam feed probing helper:
  - webcam dimension polling/wait logic moved to `moonsnap-capture::recorder_webcam_feed`
  - callback-based feed start + probe flow moved behind `prepare_webcam_feed(...)`
- Moved shared webcam encoder lifecycle helpers:
  - conditional start + finalize/cancel flow moved to `moonsnap-capture::recorder_webcam_lifecycle`
  - app recorder now injects only encoder construction/finalize callbacks
- Moved shared video postprocess helper:
  - non-empty verification + optional audio mux + faststart flow moved to `moonsnap-capture::recorder_video_postprocess`
- Moved shared MP4 capture loop orchestration:
  - command/pause control, max-duration gating, pacing sleep, first-frame callback, and periodic recording-state emission moved to `moonsnap-capture::recorder_video_loop::run_video_capture_loop`
  - app `recorder/video.rs` now provides only capture-source acquisition, encoder write callback, and event emission adapters
- Moved shared MP4 finalization orchestration:
  - post-recording cursor persistence gating + encoder finish + mux/faststart + project-file creation flow moved to `moonsnap-capture::recorder_video_finalize::finalize_video_capture`
  - app `recorder/video.rs` now wires runtime adapters and handles only cancel-vs-finalized return behavior
- Moved shared capture-thread lifecycle orchestration:
  - post-capture cancel/success/error result handling centralized in `moonsnap-capture::recorder_capture_lifecycle::finalize_capture_thread_result`
  - panic payload normalization + error propagation centralized in `moonsnap-capture::recorder_capture_lifecycle::handle_capture_thread_panic`
  - app `recorder/mod.rs` now injects controller/event callbacks instead of owning lifecycle branches inline
- Moved shared capture-thread panic boundary + lifecycle wrapper:
  - centralized catch-unwind + cancellation-resolution + callback dispatch in `moonsnap-capture::recorder_capture_lifecycle::run_capture_thread_with_lifecycle`
  - app `recorder/mod.rs` thread entry now delegates panic/result lifecycle boilerplate to crate helper and keeps only capture selection + app state/event adapters
- Moved shared capture-thread spawn + setup/teardown wrapper:
  - added `moonsnap-capture::recorder_capture_lifecycle::spawn_capture_thread_with_lifecycle`
  - centralized thread spawn wiring with before/after hooks (used for desktop icon hide/show around capture lifecycle)
  - app `recorder/mod.rs` now delegates thread scaffolding and keeps only capture-mode dispatch + app callback adapters
- Moved shared countdown orchestration:
  - start-countdown delay + per-second ticks + final cancel gate centralized in `moonsnap-capture::recorder_countdown::run_recording_countdown`
  - app `recorder/mod.rs` now wires command polling + countdown state/event callbacks through crate API
- Moved recorder command-state transition logic:
  - stop/cancel/pause/resume validation + command dispatch centralized in `moonsnap-capture::state::RecordingController::{request_stop, request_cancel, request_pause, request_resume}`
  - app `recorder/mod.rs` control handlers now delegate to crate controller APIs and keep only event emission wiring
- Reduced app-shell compatibility shims in recorder path:
  - `recorder/video.rs` now imports `moonsnap-capture` modules directly (`audio_multitrack`, `frame_buffer`, `recorder_helpers`, `state`, `timestamp`)
  - removed obsolete recorder shim files: `recorder/buffer.rs`, `recorder/capture_source.rs`, `recorder/helpers.rs`
  - `recorder/mod.rs`, `recorder/gif.rs`, and `webcam/segmented.rs` now import `moonsnap-capture` modules directly (`desktop_icons`, `state`, `fragmentation`)
  - removed obsolete top-level shim files:
    - `video_recording/audio.rs`
    - `video_recording/audio_multitrack.rs`
    - `video_recording/audio_sync.rs`
    - `video_recording/audio_wasapi.rs`
    - `video_recording/d3d_capture.rs`
    - `video_recording/desktop_icons.rs`
    - `video_recording/ffmpeg_gif_encoder.rs`
    - `video_recording/gif_encoder.rs`
    - `video_recording/master_clock.rs`
    - `video_recording/state.rs`
    - `video_recording/timestamp.rs`
    - `video_recording/types.rs`
    - `video_recording/video_export.rs`
    - `video_recording/fragmentation/mod.rs`
    - `video_recording/video_project/types.rs`
  - app startup desktop-icon safety hooks in `src/lib.rs` now call `moonsnap_capture::desktop_icons::*` directly
  - removed obsolete standalone capture-settings shim (`commands/capture_settings.rs`) and module registration from `commands/mod.rs`
  - normalized command-layer type imports to shared crates:
    - removed `commands/captions` type re-export surface; `commands/captions/mod.rs` now uses `moonsnap_domain::captions::*` internally and downstream modules import caption DTOs directly from `moonsnap_domain`
    - removed `commands/capture` type re-export surface; `commands/capture/mod.rs` + `commands/capture/fallback.rs` now use `moonsnap_domain::capture` directly and call sites import `ScreenRegionSelection` from domain crate
    - `commands/storage/operations.rs` + `commands/storage/tests.rs` now consume `moonsnap_domain::storage` directly (no `storage/types.rs` shim)
  - removed obsolete storage FFmpeg shim:
    - deleted `commands/storage/ffmpeg.rs`
    - app call sites now use `moonsnap_media::ffmpeg::{find_ffmpeg, find_ffprobe, create_hidden_command}` directly
    - removed `commands/storage::find_ffmpeg/find_ffprobe` re-export from `commands/storage/mod.rs`
  - collapsed thin rendering shim modules into direct `moonsnap-render` imports:
    - app imports in `rendering/compositor.rs`, `rendering/editor_instance.rs`, `rendering/exporter/mod.rs`, `preview/mod.rs`, `preview/native_surface.rs`, and caption parity/pixel tests now use `moonsnap_render::*` directly
    - deleted obsolete wrapper files:
      - `rendering/background.rs`
      - `rendering/caption_layer.rs`
      - `rendering/coord.rs`
      - `rendering/nv12_converter.rs`
      - `rendering/scene.rs`
      - `rendering/text.rs`
      - `rendering/text_layer.rs`
      - `rendering/types.rs`
      - `rendering/zoom.rs`
    - final `rendering/mod.rs` compatibility facade removed for shared crate types; downstream modules now import `moonsnap_render::*` directly where needed
  - removed exporter-level compatibility re-exports where not needed:
    - `rendering/editor_instance.rs` now imports webcam overlay helpers directly from `moonsnap_render::webcam_overlay`
    - `rendering/exporter/tests.rs` now imports `build_webcam_overlay` directly from `moonsnap_render::webcam_overlay`
    - removed re-exports from `rendering/exporter/mod.rs` for:
      - `moonsnap_export::frame_ops::draw_cursor_circle`
      - `moonsnap_render::webcam_overlay::{build_webcam_overlay, is_webcam_visible_at}`
    - removed re-export from `rendering/exporter/encoder_selection.rs` for `EncoderConfig`/`EncoderType` and switched to direct crate import
  - app shell shim count reduced further:
    - `rg "^pub use moonsnap_" apps/desktop/src-tauri/src` now reports no matches (0 remaining direct crate re-export wrappers)
  - removed core error shim module:
    - deleted `src/error.rs` (`pub use moonsnap_core::error::*`)
    - app now imports `MoonSnapResult` directly from `moonsnap_core::error` (e.g., `config/webcam.rs`)
    - removed `pub mod error;` from `src/lib.rs`
  - narrowed parity wrapper surface:
    - `rendering/parity.rs` now imports parity types internally instead of re-exporting `moonsnap_render::parity::*`
    - parity tests now consume `moonsnap_render::parity` directly for shared layout/math helpers
  - removed config-level webcam type re-export:
    - `config/webcam.rs` now imports webcam enums/types from `moonsnap_domain::webcam` privately
    - `commands/video_recording/mod.rs` now re-exports `WebcamShape`/`WebcamSize` directly from `moonsnap_domain::webcam` while keeping runtime config access (`get_webcam_settings`, `WEBCAM_CONFIG`) from app config module
  - removed webcam-module domain re-export surface:
    - `commands/video_recording/webcam/mod.rs` no longer re-exports `moonsnap_domain::webcam::{compute_webcam_rect, WebcamPosition, WebcamSettings, WebcamShape, WebcamSize}`
    - webcam internals now import domain webcam types/helpers directly in:
      - `webcam/composite.rs`
      - `webcam/gpu_preview.rs`
      - `webcam/preview_manager.rs`
  - narrowed video-project wrapper surface:
    - `commands/video_recording/video_project/mod.rs` no longer re-exports all domain project types
    - downstream consumers now import `moonsnap_domain::video_project::*` directly where needed
    - module continues to expose app-specific helpers (`apply_auto_zoom_to_project`, frame cache helpers, metadata loading + `VideoMetadata`)
  - narrowed top-level video-recording shim exports:
    - `commands/video_recording/mod.rs` switched crate-type imports (`recording`, `video_export`, `video_project`, webcam enums, capture runtime helpers, controller state) from `pub use` to internal `use`
    - preserved only app API re-exports that are still intentionally consumed (`CursorRecording`, editor state, project helper functions, webcam device listing)
    - `config/recording.rs` now imports `GifQualityPreset` directly from `moonsnap_capture::ffmpeg_gif_encoder`
- Started export extraction in `moonsnap-export`:
  - moved encoder quality/hardware selection primitives into `moonsnap-export::encoder_selection`
  - app exporter `encoder_selection.rs` now acts as runtime probe adapter
  - moved FFmpeg audio/filter/quality planning into `moonsnap-export::ffmpeg_plan`
  - added complete FFmpeg encoder-argument planning API (`build_encoder_args`) in `moonsnap-export::ffmpeg_plan`
  - app exporter `ffmpeg.rs` now acts as process-launch adapter for crate-built argument plans
  - moved caption source-time to timeline-time remapping into `moonsnap-export::caption_timeline`
  - moved export crop/composition dimension planning into `moonsnap-export::composition_plan`
  - moved export timeline/decode planning (durations, decode window, frame/time conversion, segment skip checks) into `moonsnap-export::timeline_plan`
  - moved NV12 fast-path compatibility + per-frame NV12/RGBA path decisions into `moonsnap-export::frame_path_plan`
  - added aggregated project-level export planning API (`moonsnap-export::export_plan`) and switched app exporter to consume it
  - moved decode stream input/window planning (screen/webcam path selection + decode range/frame window) into `moonsnap-export::decode_plan`
  - moved per-frame RGBA/NV12 crop normalization decision logic into `moonsnap-export::frame_path_plan`
  - moved per-frame base render branch + webcam overlay decision logic into `moonsnap-export::frame_path_plan` (`plan_frame_render`)
  - moved export cancellation token + render-stage progress mapping into `moonsnap-export::job_control`
  - app exporter now consumes crate cancel token and crate render progress mapping
  - moved FFmpeg stderr tail extraction helper into `moonsnap-export::job_control::tail_lines`
  - moved export-global cancel-token ownership into `moonsnap-export::job_control` (`export_cancel_token`, `request_cancel_export`, `reset_cancel_export`, `is_export_cancelled`)
  - moved generic decode/encode channel pipeline runtime into `moonsnap-export::pipeline`
  - app exporter `pipeline.rs` now acts as adapter around `StreamDecoder` and FFmpeg stdin
  - added callback-driven export loop-control runner `moonsnap-export::job_runner`
  - app exporter now delegates cancel/target stop checks, progress cadence callbacks, and drain gating to crate runner
  - moved generic embedded-asset temp-file staging into `moonsnap-export::temp_file`
  - app FFmpeg adapter now delegates typewriter-loop WAV staging to crate helper
  - moved FFmpeg audio-input request assembly (path presence + typewriter-window gating + staged loop path callback) into `moonsnap-export::ffmpeg_plan::prepare_audio_input_request`
  - added async callback-driven decode loop APIs `moonsnap-export::export_job::{run_export_loop, run_export_loop_with_context}`
  - app exporter now uses `moonsnap-export::export_job::run_export_loop_with_context` for decode-consume loop orchestration (with adapter-owned render context)
  - strengthened `run_export_loop_with_context` callback future bound to `Send` for Tauri command compatibility
  - moved child-process stderr capture + exit-status validation helpers into `moonsnap-export::process_control`
  - app exporter final FFmpeg wait/error handling now delegates to crate process-control helpers
  - moved frame-stage timing aggregation (rolling decode/gpu/cpu/readback/encode averages) into `moonsnap-export::timing`
  - app exporter now logs frame timing via crate `FrameTimingAccumulator`
  - moved reusable CPU RGBA frame operations into `moonsnap-export::frame_ops`:
    - `extract_crop_region`
    - `crop_decoded_frame`
    - `scale_frame_to_fill`
    - `blend_frames_alpha`
    - `draw_cursor_circle`
  - app exporter removed local `frame_ops.rs` and now uses crate APIs for these operations
  - moved per-frame CPU cursor overlay compositing orchestration into `moonsnap-export::cursor_overlay`:
    - generic callback-driven `composite_cursor_overlay_frame(...)` helper
    - app exporter now injects cursor shape/bitmap lookup adapters and fallback shape policy
    - app `apply_cpu_compositing(...)` reduced to adapter wiring + context mapping
  - moved staged export loop bookkeeping into `moonsnap-export::frame_pipeline_state`:
    - shared `PendingCpuWork`, `PendingReadback`, and `ExportLoopState`
    - shared readback queue rotation, oldest-readback promotion, and drain collection helpers
    - app exporter now consumes crate state container for triple-buffered readback lifecycle (including readback completion promotion and drain collection callbacks)
  - moved shared export finalization helpers into `moonsnap-export::job_finalize`:
    - centralized decode/encode task join/error flattening via `await_pipeline_tasks`
    - centralized best-effort cancel cleanup (`cancel_export_and_cleanup`) for FFmpeg termination + partial file removal
    - app exporter now delegates cancellation cleanup and pipeline warning collection to crate helpers
    - added cancellation-branch composition helper `finalize_cancelled_export` (task warnings + partial-output cleanup summary)
  - moved shared export drain orchestration into `moonsnap-export::job_finalize::drain_pipeline_if_needed`:
    - centralized post-loop drain gating + pending readback collection + callback-driven CPU-work dispatch
    - app exporter now delegates drain-phase control flow and supplies only GPU-readback + CPU-composite/encode adapters
  - moved FFmpeg finalize + output-size retrieval into `moonsnap-export::job_finalize::wait_for_encoder_and_output_size`:
    - centralized stderr capture + exit-status validation + output metadata size read
    - app exporter now maps structured finalize errors to logs/user-facing messages and preserves existing behavior
  - moved completed-export finalization composition into `moonsnap-export::job_finalize::finalize_completed_export`:
    - centralized pipeline warning collection + FFmpeg finalize sequencing into one callback-free helper
    - app exporter now consumes structured completion summary (warnings + file size) and handles only app-side logging/progress emission
  - moved base-frame render-mode composition into `moonsnap-export::frame_composition::build_frame_composition`:
    - centralized `FullscreenWebcam` / `BlendScreenAndWebcam` / `Normal` base-frame branching
    - centralized webcam-overlay construction + transition opacity scaling for blended modes
    - app exporter now delegates per-frame base render-mode assembly and keeps only NV12 conversion + GPU submit adapters
  - moved per-frame timeline/scene context planning into `moonsnap-export::frame_context`:
    - centralized source-time + timeline-time derivation and deleted-segment skip decision via `build_frame_timeline_context`
    - centralized zoom/scene/webcam visibility + transition opacity derivation via `build_frame_scene_context`
    - centralized exporter debug-cadence gates via `should_log_frame_debug` and `should_log_camera_transition_debug`
    - app exporter render loop now delegates these calculations and keeps only decode normalization + GPU/CPU pipeline adapters
  - moved per-frame decoded-screen normalization + fast-path planning into `moonsnap-export::frame_prepare`:
    - centralized RGBA crop normalization and even-dimension source coercion in `prepare_base_screen_frame`
    - centralized NV12 fast-path eligibility and GPU crop-rect planning in one request/response helper
    - app exporter now consumes crate-prepared frame/path decisions and keeps only NV12 converter invocation + compositor submission
  - moved per-frame overlay planning into `moonsnap-export::frame_overlays`:
    - centralized `RenderOptions` construction + frame-time derivation in `build_frame_overlay_plan`
    - centralized caption preparation gating and `prepare_captions(...)` invocation behind crate API
    - app exporter now delegates render-options/caption assembly and keeps only text-quad query + GPU submit adapters
  - moved runtime NVENC probe + encoder selection adapter into `moonsnap-export::encoder_selection`:
    - centralized FFmpeg NVENC probe in `is_nvenc_available(...)`
    - centralized runtime probe + fallback selection in `select_encoder_with_probe(...)`
    - app exporter removed `rendering/exporter/encoder_selection.rs`; FFmpeg adapter + `check_nvenc_available` command now call crate APIs directly
- Moved shared zoom point-transform math:
  - normalized zoom transform used by exporter cursor compositing + pre-rendered text compositing now centralized in `moonsnap-render::zoom::apply_zoom_to_normalized_point`
- Moved shared text-overlay quad contract:
  - `TextOverlayQuad` now owned by `moonsnap-render::types` (instead of app-local `rendering/text_overlay_layer.rs`)
  - app `prerendered_text`, `compositor`, and `rendering` facade now consume the shared crate type directly
- Moved pre-rendered text store/compositing module into shared render crate:
  - `PreRenderedTextStore`, `PreRenderedTextImage`, `LineMetric`, `TextCompositeInfo`, and CPU compositing helpers now live in `moonsnap-render::prerendered_text`
  - app command/runtime adapters now import those types directly from `moonsnap-render`
  - removed obsolete app-local module `src/rendering/prerendered_text.rs`
- Moved GPU text-overlay renderer module into shared render crate:
  - `TextOverlayLayer` now lives in `moonsnap-render::text_overlay_layer`
  - app compositor now uses crate `TextOverlayLayer` directly
  - removed obsolete app-local module `src/rendering/text_overlay_layer.rs`
- Moved CPU cursor image compositing primitives into `moonsnap-render`:
  - `DecodedCursorImage`
  - `VideoContentBounds`
  - `composite_cursor`
  - `composite_cursor_with_motion_blur`
  - app `rendering/cursor.rs` now keeps compatibility wrappers while delegating implementation to `moonsnap-render::cursor_composite`
- Moved shared per-frame cursor geometry planning:
  - crop remap + zoom transform + target-size calculation centralized in `moonsnap-render::cursor_plan::plan_cursor_geometry`
  - app exporter cursor compositing now consumes crate `CursorGeometryPlanRequest`/`CursorCropPlan` instead of inline math
  - cursor raster fallback decision order (shape SVG -> bitmap -> default arrow) centralized in `moonsnap-render::cursor_plan::plan_cursor_raster_source`
- Moved shared webcam overlay planning/visibility helpers:
  - `build_webcam_overlay` and `is_webcam_visible_at` centralized in `moonsnap-render::webcam_overlay`
  - app exporter now imports directly from `moonsnap-render::webcam_overlay`; obsolete `rendering/exporter/webcam.rs` shim removed
- Moved auto-zoom configuration type ownership into domain crate:
  - `AutoZoomConfig` now lives in `moonsnap-domain::video_project`
  - app `video_project/auto_zoom.rs` consumes the domain type via compatibility shim
  - fixes generated TS import parity (`AutoZoomConfig -> ./EasingFunction`)
- Fixed ts-rs generation target for moved crates:
  - `moonsnap-domain` and `moonsnap-render` now export to app canonical path `../../../../src/types/generated/` (from crate module locations)
  - eliminates stale duplicate generation under `src-tauri/crates/src/types/generated`
- Added ts-rs generation path guardrails:
  - `bun run check:ts-rs-paths` now validates app-shell + all `src-tauri/crates/*/src` `export_to` paths
  - detects/blocks generated output in forbidden dirs (`src-tauri/src/types/generated`, `src-tauri/crates/src/types/generated`, repo-root `src/types/generated`)
- Started Phase 5 reuse governance:
  - added crate semver/versioning policy doc (`crates/SEMVER_POLICY.md`)
  - added CI crate-contract gating for shared crates in `.github/workflows/ci.yml`
- App shell now uses compatibility shims for these modules.

Validation snapshot:

- `cargo test -p moonsnap-capture --lib` passes (121 tests).
- `cargo test -p moonsnap-export --lib` passes (95 tests).
- `cargo test -p moonsnap-render --lib` passes (80 tests).
- `cargo test -p moonsnap-domain --lib` passes (83 tests).
- `cargo check --workspace --lib` passes.
- `cargo test -p moonsnap --lib` passes (144 passed, 1 ignored).

## Target Architecture

- `moonsnap-core`
- Error/result/context primitives.
- No Tauri, no platform APIs.
- `moonsnap-domain`
- Shared DTOs and project models (`video_project`, `recording`, `capture`, `storage`, `captions`, `webcam`).
- Rust source of truth for TS type generation.
- `moonsnap-media`
- FFmpeg probing, binary discovery, media utility helpers.
- `moonsnap-render`
- Rendering math, composition types, text/caption and background processing utilities.
- `moonsnap-capture`
- Cross-app capture orchestration (screen/window/camera + audio timing/state machine).
- `moonsnap-export`
- Encoder-selection primitives extracted; ffmpeg graph/pipeline extraction in progress.
- `moonsnap` (app shell)
- Tauri commands, plugins, permissions, window lifecycle, IPC wiring only.

## Dependency Rules

- Allowed flow: `core -> domain/media -> render/capture/export -> app shell`.
- Domain and core crates must not depend on Tauri or windowing runtime APIs.
- Crates should avoid depending on `moonsnap` (no reverse dependency).
- Keep platform-specific dependencies behind feature flags where practical (`windows`, `ffmpeg`, `gpu`).

## Phased Plan

### Phase 1: Harden Existing Shared Crates

1. Define explicit public API surfaces for `moonsnap-core`, `moonsnap-domain`, `moonsnap-media`, `moonsnap-render`.
2. Reduce accidental exports by tightening `pub use` at crate roots.
3. Add crate-level smoke tests to guard public APIs and serde contracts.
4. Add docs for each crate (`README.md` + examples).

Exit criteria:

- `cargo check --workspace --lib` passes.
- `cargo test -p moonsnap-domain --lib` and `cargo test -p moonsnap-render --lib` pass.
- No Tauri imports in core/domain/media/render crates.

### Phase 2: Extract Capture Runtime to `moonsnap-capture`

1. Move reusable recording engine logic from `src/commands/video_recording` into a new crate.
2. Keep only command adapters and app state injection in Tauri handlers.
3. Define runtime traits for:
- Monitor/window target resolution.
- Camera provider.
- Audio source provider.
- Storage path strategy.
4. Keep Windows-specific backends in existing platform crates, wired through traits.

Exit criteria:

- Tauri command modules call crate APIs, no engine internals in `commands/`.
- Capture start/stop/pause/resume flows covered by integration tests.

### Phase 3: Extract Export Engine to `moonsnap-export`

1. Move reusable export orchestration from `src/rendering/exporter` and related command glue.
2. Keep ffmpeg command construction and stream graph logic in crate APIs.
3. Provide config-first APIs (`ExportRequest`, `CompositionConfig`, `ExportArtifacts`).
4. Keep app-specific UX state and progress event emission in Tauri layer.

Exit criteria:

- Export jobs executable via crate APIs from a non-Tauri harness.
- Existing export behavior parity validated on representative projects.

### Phase 4: Narrow `moonsnap` to Integration Layer

1. Remove remaining business logic from Tauri handlers.
2. Keep only:
- Command argument mapping.
- Permission checks/capabilities.
- Window/tray/event wiring.
- App lifecycle.
3. Replace direct module coupling with crate imports everywhere possible.

Exit criteria:

- `src/commands` contains orchestration code, not engine code.
- Most business logic lives under `crates/`.

### Phase 5: Reuse Readiness

1. Add semver strategy for internal crates.
2. Publish or mirror crates for cross-project use (private registry or git dependency).
3. Add migration template for new apps:
- Minimal app shell.
- Crate wiring checklist.
- Required features per platform.
4. Add CI matrix to run crate tests independently and as full workspace.

Exit criteria:

- A new sample app can compile by reusing crates with minimal custom code.
- Breaking changes in shared crates are detected by CI contract tests.

## Operational Guardrails

- Keep ts-rs exports consistent per source root:
- `src-tauri/src/**` uses `../../src/types/generated/`.
- `src-tauri/crates/*/src/**` uses `../../../../src/types/generated/`.
- Run `bun run check:ts-rs-paths` before `typecheck`/PR.
- Keep compatibility shims until all imports are migrated.
- Avoid large cross-crate moves without green `cargo check` at each step.
- Do not combine architecture extraction with behavior changes in the same PR.

## Recommended Next PR Sequence

1. PR 1: Harden APIs/docs/tests for current shared crates.
2. PR 2: Introduce `moonsnap-capture` and move recording orchestration.
3. PR 3: Expand `moonsnap-export` from encoder selection to exporter orchestration.
4. PR 4: Strip app shell down to adapters and remove obsolete shims.

## Immediate Next Cuts (Decided)

1. Continue capture runtime extraction in `recorder/mod.rs`:
- move remaining thread spawn/dispatch wiring (desktop-icon toggling + mode dispatch scaffolding) into callback-driven crate helpers where practical
- keep only Tauri runtime wiring and event emission in app shell
2. Close remaining export-runtime gap:
- continue reducing exporter-local orchestration in `src/rendering/exporter/mod.rs` (loop + drain + finalize branches) into `moonsnap-export` while preserving current lifetime-safe adapter boundaries
3. Phase 5 reuse readiness:
- finalize publish/reuse workflow (private registry or git dependency template) now that semver policy + crate CI contract gating are in place
