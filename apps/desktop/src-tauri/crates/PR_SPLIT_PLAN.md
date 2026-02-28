# Refactor PR Split Plan

This plan slices the current extraction work into mergeable PRs with clear blast radius and validation gates.

## PR 1: Shared Crate Scaffolding + Adapter Shims

Goal: introduce workspace crates and keep app behavior unchanged via thin re-export shims.

Include:
- Workspace wiring:
  - `Cargo.toml`
  - `Cargo.lock`
  - `crates/README.md`
- New crate skeletons + initial modules/tests/docs:
  - `crates/snapit-core/**`
  - `crates/snapit-domain/**`
  - `crates/snapit-media/**`
  - `crates/snapit-render/**`
  - `crates/snapit-capture/**`
  - `crates/snapit-export/**`
- App-side shim modules that are now simple `pub use ...` wrappers.

Exclude:
- Large orchestration rewrites in app runtime loops.

Validation:
- `cargo test -p snapit-core --lib`
- `cargo test -p snapit-domain --lib`
- `cargo test -p snapit-media --lib`
- `cargo test -p snapit-render --lib`
- `cargo check -p snapit --lib`

## PR 2: Capture Runtime Extraction

Goal: move reusable recording engine logic into `snapit-capture`; keep Tauri layer as adapters/callback wiring.

Include:
- `src/commands/video_recording/**` updates that delegate to `snapit-capture`.
- Related `snapit-capture` module additions:
  - loop control, pacing, first-frame sync, finalization, cursor persistence, webcam lifecycle/feed, postprocess helpers.

Exclude:
- Export pipeline major changes.

Validation:
- `cargo test -p snapit-capture --lib`
- `cargo test -p snapit --lib`
- `cargo check -p snapit --lib`

## PR 3: Export Runtime Extraction (Stable Adapter Form)

Goal: centralize export planning/runtime helpers in `snapit-export` while keeping exporter frame loop local for lifetime safety.

Include:
- `snapit-export` modules:
  - `encoder_selection`, `ffmpeg_plan`, `caption_timeline`, `composition_plan`, `timeline_plan`,
    `frame_path_plan`, `export_plan`, `job_control`, `pipeline`, `job_runner`,
    `temp_file`, `export_job`, `process_control`, `timing`.
- App exporter adapters:
  - `src/rendering/exporter/{encoder_selection,ffmpeg,pipeline,mod,webcam}.rs`

Explicit decision:
- Adopt `run_export_loop_with_context` in app exporter loop with adapter-owned render context to keep lifetime boundaries explicit while reducing local orchestration.

Validation:
- `cargo test -p snapit-export --lib`
- `cargo test -p snapit --lib`
- `cargo check -p snapit --lib`

## PR 4: TS Type Generation + Reuse Guard Rails

Goal: ensure moved crates still generate TS types only to app canonical output, and add reuse governance guard rails for shared crates.

Include:
- `#[ts(export_to = "...")]` path normalization in moved crates.
- Canonical generated updates in `apps/desktop/src/types/generated/*`.
- Guard script:
  - `apps/desktop/scripts/check-ts-rs-paths.cjs`
  - `apps/desktop/package.json` script entry.
- Shared-crate governance docs:
  - `apps/desktop/src-tauri/crates/SEMVER_POLICY.md`
- CI crate-contract gating:
  - `.github/workflows/ci.yml` matrix job for `snapit-{core,domain,media,render,capture,export}`.
- Cleanup/removal of accidental generated outputs under:
  - `src-tauri/src/types/generated`
  - `src-tauri/crates/src/types/generated`

Validation:
- `bun run check:ts-rs-paths`
- `bun run typecheck`
- `bun run test:run`
- `cargo test -p snapit-core --lib`
- `cargo test -p snapit-media --lib`
- `cargo test -p snapit-capture --lib`
- `cargo test -p snapit-export --lib`
- `cargo test -p snapit-domain --lib`
- `cargo test -p snapit-render --lib`
- `cargo test -p snapit --lib`

## Rollout Notes

- Keep PRs behavior-focused and avoid mixing extraction with feature changes.
- If a PR needs schema regeneration, include generated TS files in the same PR.
- Run the listed gate commands before opening each PR.
