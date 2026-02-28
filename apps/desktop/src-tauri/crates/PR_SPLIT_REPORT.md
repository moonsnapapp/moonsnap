# PR Split Report

Generated: 2026-02-28T13:49:24.683Z

Summary: PR1: 46 | PR2: 39 | PR3: 10 | PR4: 16 | UNASSIGNED: 0

## PR1
- ` M` apps/desktop/src-tauri/Cargo.lock
- ` M` apps/desktop/src-tauri/Cargo.toml
- ` M` apps/desktop/src-tauri/src/app/tray.rs
- ` M` apps/desktop/src-tauri/src/commands/AGENTS.md
- ` M` apps/desktop/src-tauri/src/commands/captions/audio.rs
- ` M` apps/desktop/src-tauri/src/commands/captions/mod.rs
- ` D` apps/desktop/src-tauri/src/commands/captions/types.rs
- ` M` apps/desktop/src-tauri/src/commands/capture/fallback.rs
- ` M` apps/desktop/src-tauri/src/commands/capture/mod.rs
- ` D` apps/desktop/src-tauri/src/commands/capture/types.rs
- ` D` apps/desktop/src-tauri/src/commands/capture_settings.rs
- ` M` apps/desktop/src-tauri/src/commands/mod.rs
- ` M` apps/desktop/src-tauri/src/commands/preview.rs
- ` D` apps/desktop/src-tauri/src/commands/storage/ffmpeg.rs
- ` M` apps/desktop/src-tauri/src/commands/storage/mod.rs
- ` M` apps/desktop/src-tauri/src/commands/storage/operations.rs
- ` M` apps/desktop/src-tauri/src/commands/storage/tests.rs
- ` D` apps/desktop/src-tauri/src/commands/storage/types.rs
- ` M` apps/desktop/src-tauri/src/commands/text_prerender.rs
- ` M` apps/desktop/src-tauri/src/commands/window/capture.rs
- ` D` apps/desktop/src-tauri/src/error.rs
- ` M` apps/desktop/src-tauri/src/preview/mod.rs
- ` M` apps/desktop/src-tauri/src/preview/native_surface.rs
- ` D` apps/desktop/src-tauri/src/rendering/background.rs
- ` D` apps/desktop/src-tauri/src/rendering/caption_layer.rs
- ` M` apps/desktop/src-tauri/src/rendering/caption_parity_test.rs
- ` M` apps/desktop/src-tauri/src/rendering/caption_pixel_test.rs
- ` M` apps/desktop/src-tauri/src/rendering/compositor.rs
- ` D` apps/desktop/src-tauri/src/rendering/coord.rs
- ` M` apps/desktop/src-tauri/src/rendering/decoder.rs
- ` M` apps/desktop/src-tauri/src/rendering/editor_instance.rs
- ` M` apps/desktop/src-tauri/src/rendering/mod.rs
- ` D` apps/desktop/src-tauri/src/rendering/nv12_converter.rs
- ` M` apps/desktop/src-tauri/src/rendering/parity.rs
- ` D` apps/desktop/src-tauri/src/rendering/scene.rs
- ` M` apps/desktop/src-tauri/src/rendering/stream_decoder.rs
- ` D` apps/desktop/src-tauri/src/rendering/text.rs
- ` D` apps/desktop/src-tauri/src/rendering/text_layer.rs
- ` D` apps/desktop/src-tauri/src/rendering/text_overlay_layer.rs
- ` D` apps/desktop/src-tauri/src/rendering/types.rs
- ` D` apps/desktop/src-tauri/src/rendering/zoom.rs
- `??` apps/desktop/src-tauri/crates/README.md
- `??` apps/desktop/src-tauri/crates/snapit-core/
- `??` apps/desktop/src-tauri/crates/snapit-domain/
- `??` apps/desktop/src-tauri/crates/snapit-media/
- `??` apps/desktop/src-tauri/crates/snapit-render/

## PR2
- ` D` apps/desktop/src-tauri/src/commands/video_recording/audio.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/audio_multitrack.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/audio_sync.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/audio_wasapi.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/d3d_capture.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/desktop_icons.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/ffmpeg_gif_encoder.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/fragmentation/manifest.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/fragmentation/mod.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/gif_encoder.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/gpu_editor.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/master_clock.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/mod.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/recorder/buffer.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/recorder/capture_source.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/recorder/gif.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/recorder/helpers.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/recorder/mod.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/recorder/video.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/state.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/timestamp.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/types.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/video_export.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/video_project/auto_zoom.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/video_project/frames.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/video_project/metadata.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/video_project/mod.rs
- ` D` apps/desktop/src-tauri/src/commands/video_recording/video_project/types.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/channel_encoder.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/composite.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/encoder.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/gpu_preview.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/mod.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/preview_manager.rs
- ` M` apps/desktop/src-tauri/src/commands/video_recording/webcam/segmented.rs
- ` M` apps/desktop/src-tauri/src/config/recording.rs
- ` M` apps/desktop/src-tauri/src/config/webcam.rs
- ` M` apps/desktop/src-tauri/src/lib.rs
- `??` apps/desktop/src-tauri/crates/snapit-capture/

## PR3
- ` M` apps/desktop/src-tauri/src/rendering/cursor.rs
- ` D` apps/desktop/src-tauri/src/rendering/exporter/encoder_selection.rs
- ` M` apps/desktop/src-tauri/src/rendering/exporter/ffmpeg.rs
- ` D` apps/desktop/src-tauri/src/rendering/exporter/frame_ops.rs
- ` M` apps/desktop/src-tauri/src/rendering/exporter/mod.rs
- ` M` apps/desktop/src-tauri/src/rendering/exporter/pipeline.rs
- ` M` apps/desktop/src-tauri/src/rendering/exporter/tests.rs
- ` D` apps/desktop/src-tauri/src/rendering/exporter/webcam.rs
- ` D` apps/desktop/src-tauri/src/rendering/prerendered_text.rs
- `??` apps/desktop/src-tauri/crates/snapit-export/

## PR4
- ` M` .github/workflows/ci.yml
- ` M` AGENTS.md
- ` M` apps/desktop/package.json
- ` M` apps/desktop/src-tauri/.gitignore
- ` M` apps/desktop/src/types/generated/CursorConfig.ts
- ` M` apps/desktop/src/types/generated/GifQualityPreset.ts
- ` M` apps/desktop/src/types/generated/TextAnimation.ts
- ` M` apps/desktop/src/types/generated/TextSegment.ts
- ` M` apps/desktop/src/types/generated/WebcamSettings.ts
- ` M` apps/desktop/src/types/generated/XY.ts
- `??` apps/desktop/scripts/check-ts-rs-paths.cjs
- `??` apps/desktop/scripts/report-pr-split.cjs
- `??` apps/desktop/src-tauri/crates/LIB_EXTRACTION_PLAN.md
- `??` apps/desktop/src-tauri/crates/PR_SPLIT_PLAN.md
- `??` apps/desktop/src-tauri/crates/PR_SPLIT_REPORT.md
- `??` apps/desktop/src-tauri/crates/SEMVER_POLICY.md

## UNASSIGNED
- (none)

## Suggested Staging Commands

### PR1
```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/crates/README.md apps/desktop/src-tauri/crates/snapit-core apps/desktop/src-tauri/crates/snapit-domain apps/desktop/src-tauri/crates/snapit-media apps/desktop/src-tauri/crates/snapit-render apps/desktop/src-tauri/src/error.rs apps/desktop/src-tauri/src/app/tray.rs apps/desktop/src-tauri/src/commands/AGENTS.md apps/desktop/src-tauri/src/commands/captions/mod.rs apps/desktop/src-tauri/src/commands/captions/audio.rs apps/desktop/src-tauri/src/commands/capture/mod.rs apps/desktop/src-tauri/src/commands/capture/fallback.rs apps/desktop/src-tauri/src/commands/text_prerender.rs apps/desktop/src-tauri/src/commands/preview.rs apps/desktop/src-tauri/src/commands/window/capture.rs apps/desktop/src-tauri/src/commands/captions/types.rs apps/desktop/src-tauri/src/commands/capture/types.rs apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src-tauri/src/commands/capture_settings.rs apps/desktop/src-tauri/src/commands/storage/ffmpeg.rs apps/desktop/src-tauri/src/commands/storage/mod.rs apps/desktop/src-tauri/src/commands/storage/operations.rs apps/desktop/src-tauri/src/commands/storage/tests.rs apps/desktop/src-tauri/src/commands/storage/types.rs apps/desktop/src-tauri/src/rendering/background.rs apps/desktop/src-tauri/src/rendering/caption_layer.rs apps/desktop/src-tauri/src/rendering/caption_parity_test.rs apps/desktop/src-tauri/src/rendering/caption_pixel_test.rs apps/desktop/src-tauri/src/rendering/compositor.rs apps/desktop/src-tauri/src/rendering/coord.rs apps/desktop/src-tauri/src/rendering/decoder.rs apps/desktop/src-tauri/src/rendering/editor_instance.rs apps/desktop/src-tauri/src/rendering/mod.rs apps/desktop/src-tauri/src/rendering/nv12_converter.rs apps/desktop/src-tauri/src/rendering/parity.rs apps/desktop/src-tauri/src/rendering/scene.rs apps/desktop/src-tauri/src/rendering/stream_decoder.rs apps/desktop/src-tauri/src/rendering/text_overlay_layer.rs apps/desktop/src-tauri/src/rendering/text.rs apps/desktop/src-tauri/src/rendering/text_layer.rs apps/desktop/src-tauri/src/rendering/types.rs apps/desktop/src-tauri/src/rendering/zoom.rs apps/desktop/src-tauri/src/preview/mod.rs apps/desktop/src-tauri/src/preview/native_surface.rs
```

### PR2
```bash
git add apps/desktop/src-tauri/crates/snapit-capture apps/desktop/src-tauri/src/commands/video_recording apps/desktop/src-tauri/src/config/recording.rs apps/desktop/src-tauri/src/config/webcam.rs apps/desktop/src-tauri/src/lib.rs
```

### PR3
```bash
git add apps/desktop/src-tauri/crates/snapit-export apps/desktop/src-tauri/src/rendering/exporter apps/desktop/src-tauri/src/rendering/cursor.rs apps/desktop/src-tauri/src/rendering/prerendered_text.rs
```

### PR4
```bash
git add AGENTS.md .github/workflows/ci.yml apps/desktop/package.json apps/desktop/src-tauri/.gitignore apps/desktop/scripts/check-ts-rs-paths.cjs apps/desktop/scripts/report-pr-split.cjs apps/desktop/src-tauri/crates/LIB_EXTRACTION_PLAN.md apps/desktop/src-tauri/crates/SEMVER_POLICY.md apps/desktop/src-tauri/crates/PR_SPLIT_PLAN.md apps/desktop/src-tauri/crates/PR_SPLIT_REPORT.md apps/desktop/src/types/generated
```

