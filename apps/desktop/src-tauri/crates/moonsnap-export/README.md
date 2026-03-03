# moonsnap-export

Reusable export orchestration primitives.

## Scope

- Encoder selection primitives (`encoder_selection`)
- FFmpeg audio/filter/quality and full encoder-arg planning primitives (`ffmpeg_plan`)
- Caption source->timeline remapping primitives (`caption_timeline`)
- Export crop/composition dimension planning primitives (`composition_plan`)
- Export timeline/decode planning primitives (`timeline_plan`)
- NV12/RGBA render path planning primitives (`frame_path_plan`)
- RGBA/NV12 crop normalization planning (`frame_path_plan`)
- Per-frame base render/overlay branch planning (`frame_path_plan`)
- Reusable RGBA frame pixel operations (`frame_ops`)
- Per-frame CPU cursor overlay compositing helper (`cursor_overlay`)
- Shared loop/readback queue state for staged export pipelines (`frame_pipeline_state`)
- Aggregated project-level export planning (`export_plan`)
- Decode stream input/window planning (`decode_plan`)
- Export job cancellation + render progress mapping primitives (`job_control`)
- Export loop-control/progress callback runner (`job_runner`)
- Async callback-driven decode loop API (`export_job`)
- Generic decode/encode pipeline runtime primitives (`pipeline`)
- Temp-file staging helpers for embedded export assets (`temp_file`)
- Child-process stderr/exit handling helpers (`process_control`)
- Frame-stage timing aggregation helpers (`timing`)
- Hardware preference + quality mapping helpers for export encoding

## Notes

This crate is intentionally Tauri-free and runtime-agnostic. App/runtime-specific
probing (for example FFmpeg process invocation) should be injected from adapters.
