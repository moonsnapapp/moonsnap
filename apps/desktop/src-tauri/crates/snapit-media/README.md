# snapit-media

Reusable media helpers (FFmpeg/ffprobe discovery and thumbnail utilities).

## Scope

- Locate working `ffmpeg` and `ffprobe` binaries
- Build hidden console commands on Windows
- Generate video/GIF/image thumbnails
- Probe basic metadata for migration flows

## Usage

```rust
use snapit_media::ffmpeg;

let ffmpeg = ffmpeg::find_ffmpeg();
```

## Non-goals

- UI progress/event delivery
- Tauri command handlers
- Export job orchestration
