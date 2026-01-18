# Caption & Transcription Feature Design

**Date:** 2025-01-18
**Status:** Approved
**Approach:** Port Cap's whisper-rs implementation to SnapIt

## Overview

Add automatic transcription and caption support to SnapIt's video editor using local Whisper inference. Captions are rendered via the GPU pipeline for WYSIWYG preview-to-export accuracy.

## Requirements

- **Transcription**: whisper-rs with on-demand model download from Hugging Face
- **Display**: Rust-side GPU rendering in editor preview (WYSIWYG)
- **Export**: Optional burn-in, always generate SRT/VTT
- **Styling**: Full customization (font, size, color, background, outline, position, active word highlight)
- **Animation**: Smooth word transitions (~0.25s configurable)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
├─────────────────────────────────────────────────────────────────┤
│  CaptionPanel          │  CaptionSettings     │  CaptionEditor  │
│  - Transcribe button   │  - Font/size/color   │  - Edit text    │
│  - Model selector      │  - Position/outline  │  - Adjust timing│
│  - Progress display    │  - Animation config  │  - Split/merge  │
└────────────┬───────────┴──────────┬──────────┴────────┬────────┘
             │                      │                   │
             ▼                      ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Tauri Commands (IPC)                       │
│  transcribe_audio, save_captions, load_captions,                │
│  download_whisper_model, check_model_exists                     │
└────────────┬───────────┬──────────┬───────────┬────────────────┘
             │           │          │           │
             ▼           ▼          ▼           ▼
┌────────────────┐ ┌───────────┐ ┌─────────┐ ┌──────────────────┐
│  captions.rs   │ │ models/   │ │ storage │ │ renderer.rs      │
│  - Whisper     │ │ (cached)  │ │ JSON    │ │ - GPU caption    │
│  - Audio       │ │ ggml-*.bin│ │ files   │ │   overlay        │
│    extraction  │ └───────────┘ └─────────┘ │ - Word highlight │
└────────────────┘                           └──────────────────┘
```

## Rust Backend

### Dependencies

Add to `Cargo.toml`:
```toml
whisper-rs = "0.11"
```

### Data Structures

```rust
#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
pub struct CaptionSegment {
    pub id: String,
    pub start: f32,      // seconds
    pub end: f32,
    pub text: String,
    pub words: Vec<CaptionWord>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
pub struct CaptionWord {
    pub text: String,
    pub start: f32,
    pub end: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
pub struct CaptionSettings {
    pub enabled: bool,

    // Typography
    pub font: String,
    pub size: u32,
    pub font_weight: u32,
    pub italic: bool,

    // Colors
    pub color: String,           // inactive words
    pub highlight_color: String, // active word
    pub background_color: String,
    pub background_opacity: u32,
    pub outline: bool,
    pub outline_color: String,

    // Position
    pub position: String,        // "top", "bottom"

    // Animation timing (seconds)
    pub word_transition_duration: f32,
    pub fade_duration: f32,
    pub linger_duration: f32,

    // Export
    pub export_with_subtitles: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
pub struct CaptionData {
    pub segments: Vec<CaptionSegment>,
    pub settings: Option<CaptionSettings>,
}
```

### Tauri Commands

| Command | Purpose |
|---------|---------|
| `transcribe_audio` | Extract audio from video, run Whisper, return segments |
| `download_whisper_model` | Download model from Hugging Face with progress events |
| `check_model_exists` | Check if model is cached locally |
| `delete_whisper_model` | Remove cached model to free space |
| `save_captions` | Persist captions JSON to project |
| `load_captions` | Load captions from project |
| `export_captions_srt` | Generate SRT file |
| `export_captions_vtt` | Generate VTT file |

### Audio Extraction Pipeline

1. Open video with ffmpeg-next
2. Decode audio stream
3. Resample to 16kHz mono (Whisper's required format)
4. Write to temp WAV file
5. Feed to Whisper

### Whisper Model Management

Models downloaded on-demand from Hugging Face and cached in app data directory:

| Model | Size | Use Case |
|-------|------|----------|
| tiny | ~75MB | Fast, lower accuracy |
| base | ~142MB | Balanced |
| small | ~466MB | Good accuracy |
| medium | ~1.5GB | High accuracy |
| large-v3 | ~3GB | Best accuracy |

Context cached in `lazy_static` mutex to avoid reloading for subsequent transcriptions.

## Storage

```
<project_dir>/
├── recording.mp4
├── project.json
├── captions/
│   └── captions.json      // segments + settings
```

## GPU Rendering

### Compositor Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                   Compositor Pipeline                    │
├─────────────────────────────────────────────────────────┤
│  1. Background (wallpaper/color)                        │
│  2. Video frame                                         │
│  3. Cursor overlay                                      │
│  4. Webcam overlay                                      │
│  5. Caption overlay  ◄── NEW                            │
│  6. UI elements (zoom regions, etc.)                    │
└─────────────────────────────────────────────────────────┘
```

### Caption Layer (`caption_layer.rs`)

Responsibilities:
1. Find active segment for current playback time
2. Calculate word highlighting with transition progress
3. Layout text block (position, wrapping)
4. Render with glyphon (per-word color interpolation)
5. Draw background rect with configurable opacity

### Word Highlight Interpolation

```rust
fn get_word_color(word: &CaptionWord, current_time: f32, settings: &CaptionSettings) -> Color {
    let transition_start = word.start - settings.word_transition_duration;
    let progress = ((current_time - transition_start) / settings.word_transition_duration)
        .clamp(0.0, 1.0);

    lerp_color(settings.color, settings.highlight_color, ease_out(progress))
}
```

Same code path for preview and export ensures WYSIWYG.

## Frontend Components

### CaptionPanel.tsx
Main caption controls in editor sidebar:
- Model selector dropdown
- Download button with progress bar
- Transcribe button
- Language selector (auto-detect default)

### CaptionSettings.tsx
Styling controls (collapsible panel):
- Font family, size, weight
- Text color, highlight color
- Background color and opacity
- Outline toggle and color
- Position (top/bottom)
- Transition duration

### CaptionTimeline.tsx
Timeline track showing segments:
- Visual blocks for each segment
- Drag handles to adjust timing
- Click to select/edit

### CaptionEditor.tsx
Edit selected segment:
- Inline text editing
- Split segment at cursor
- Merge adjacent segments
- Delete segment

### Store Integration

New `captionSlice.ts` integrated with `videoEditorStore`:
- Caption segments and settings state
- Actions for CRUD operations
- Sync to disk on changes

## Export Pipeline

### Export Options

```
☑ Include captions
  ○ Burn into video (hardcoded)
  ● Export as separate file
  ○ Both

Format: [SRT ▼]  (SRT, VTT, Both)
```

### Burn-in Rendering

When `export_with_subtitles: true`, caption layer included in export:

```rust
fn render_frame(&mut self, frame_time: f32) -> RgbaImage {
    let mut compositor = self.compositor.lock();

    compositor.render_background();
    compositor.render_video_frame(frame_time);
    compositor.render_cursor(frame_time);
    compositor.render_webcam(frame_time);

    if self.caption_settings.enabled && self.caption_settings.export_with_subtitles {
        compositor.render_captions(frame_time, &self.captions);
    }

    compositor.finalize()
}
```

### Subtitle File Formats

**SRT:**
```
1
00:00:01,200 --> 00:00:04,500
Hello, this is a demo of the caption feature.

2
00:00:05,000 --> 00:00:08,300
You can customize fonts, colors, and animations.
```

**VTT:**
```
WEBVTT

00:00:01.200 --> 00:00:04.500
Hello, this is a demo of the caption feature.

00:00:05.000 --> 00:00:08.300
You can customize fonts, colors, and animations.
```

Files saved alongside exported video (e.g., `MyRecording.mp4` + `MyRecording.srt`).

## Implementation Phases

### Phase 1: Core Transcription
- Add whisper-rs dependency
- Implement `captions.rs` with audio extraction and transcription
- Model download with progress events
- Basic Tauri commands

### Phase 2: Storage & Types
- Define data structures with ts-rs
- Implement save/load commands
- Project storage integration

### Phase 3: GPU Rendering
- Create `caption_layer.rs`
- Integrate into compositor pipeline
- Word-level highlighting with smooth transitions

### Phase 4: Frontend UI
- CaptionPanel component
- CaptionSettings component
- Store integration

### Phase 5: Timeline & Editing
- CaptionTimeline component
- CaptionEditor component
- Segment manipulation (split, merge, delete)

### Phase 6: Export
- Burn-in option in export dialog
- SRT/VTT file generation
- Export settings persistence

## Reference

Cap's implementation: `e:/cap/apps/desktop/src-tauri/src/captions.rs`
