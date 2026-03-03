# moonsnap-capture

Reusable capture timing primitives for recording pipelines.

## Scope

- High-precision timestamp conversion and synchronization utilities
- Lock-free master clock for A/V timestamp coordination
- Recording controller/state primitives (`RecorderCommand`, `RecordingProgress`, controller singleton)
- Recorder support utilities (`FrameBufferPool`, FFmpeg/video helper functions)
- D3D capture primitives and unified capture-source abstraction
- Audio capture and synchronization primitives (`audio`, `audio_wasapi`, `audio_sync`, `audio_multitrack`)
- Runtime monitor/display helpers (`recording_runtime`)
- GIF recording/encoding primitives (`gif_encoder`, `ffmpeg_gif_encoder`)
- GIF recorder orchestration (`recorder_gif`) with callback-driven state reporting
- Video capture planning helpers (`recorder_video_capture`)
- Cursor region resolution helpers (`recorder_cursor_region`)
- Audio artifact path planning helpers (`recorder_audio_paths`)
- Recording loop command/pause control helpers (`recorder_loop_control`)
- First-frame synchronization helper (`recorder_first_frame`)
- Frame pacing helpers (`recorder_pacing`)
- Finalization planning helpers (`recorder_finalization`)
- Progress emission helpers with callback boundary (`recorder_progress`)
- Video output artifact path planning (`recorder_output_paths`)
- Cursor persistence callback helper (`recorder_cursor_persistence`)
- Webcam feed probing helper (`recorder_webcam_feed`)
- Webcam encoder lifecycle helpers (`recorder_webcam_lifecycle`)
- Video postprocess helper (`recorder_video_postprocess`)
- Fragmentation/recovery helpers (`fragmentation`)
- Desktop icon visibility controls for recording sessions (`desktop_icons`)

## Usage

```rust
use moonsnap_capture::{master_clock::MasterClock, timestamp::Timestamps};

let clock = MasterClock::start_now();
let ts = Timestamps::now();
let _elapsed = clock.elapsed_us();
let _cursor_ms = ts.instant().elapsed().as_millis();
```
