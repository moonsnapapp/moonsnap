# snapit-domain

Shared domain models used by SnapIt backend and frontend type generation.

## Scope

- Capture DTOs (`capture`, `capture_settings`)
- Recording DTOs and validation (`recording`)
- Video editor project models (`video_project`, `video_export`)
- Caption and storage models (`captions`, `storage`)
- Webcam domain models (`webcam`)

## Usage

```rust
use snapit_domain::recording::RecordingSettings;

let mut settings = RecordingSettings::default();
settings.validate();
```

## Notes

- Rust is the source of truth for TS generation via `ts-rs`.
- Keep `#[ts(export_to = "../../../../src/types/generated/")]` consistent across modules.


