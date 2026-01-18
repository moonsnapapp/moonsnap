# Caption & Transcription Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic transcription and captions to SnapIt video editor using whisper-rs with GPU rendering for WYSIWYG preview/export.

**Architecture:** Port Cap's whisper-rs implementation, add caption types to VideoProject, extend the wgpu compositor with a caption layer, and create React UI components for transcription controls and caption editing.

**Tech Stack:** Rust (whisper-rs, ffmpeg-next, wgpu, glyphon), TypeScript/React (Zustand store, Tauri IPC)

---

## Phase 1: Dependencies and Caption Types

### Task 1.1: Add whisper-rs dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add whisper-rs to dependencies**

Add after line 130 (after `font-kit`):

```toml
# Whisper speech-to-text for caption transcription
whisper-rs = "0.11"

# Temporary directory for audio extraction
tempfile = "3"

# HTTP client for model downloads
reqwest = { version = "0.12", features = ["stream"] }
futures-util = "0.3"
```

**Step 2: Verify it compiles**

Run: `cd E:/snapit/src-tauri && cargo check`
Expected: Successful compilation (whisper-rs may take a while to build on first run)

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add whisper-rs for caption transcription"
```

---

### Task 1.2: Create caption types module

**Files:**
- Create: `src-tauri/src/commands/captions/types.rs`
- Create: `src-tauri/src/commands/captions/mod.rs`

**Step 1: Create the types file**

Create `src-tauri/src/commands/captions/types.rs`:

```rust
//! Caption data types with ts-rs bindings.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single word with timing information.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionWord {
    /// The word text.
    pub text: String,
    /// Start time in seconds.
    pub start: f32,
    /// End time in seconds.
    pub end: f32,
}

/// A caption segment containing multiple words.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionSegment {
    /// Unique segment identifier.
    pub id: String,
    /// Start time in seconds.
    pub start: f32,
    /// End time in seconds.
    pub end: f32,
    /// Full text of the segment.
    pub text: String,
    /// Individual words with timing.
    pub words: Vec<CaptionWord>,
}

/// Caption styling and display settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionSettings {
    /// Whether captions are enabled.
    pub enabled: bool,

    // Typography
    /// Font family name.
    pub font: String,
    /// Font size in pixels.
    pub size: u32,
    /// Font weight (400 = normal, 700 = bold).
    pub font_weight: u32,
    /// Italic style.
    pub italic: bool,

    // Colors (hex format)
    /// Text color for inactive words.
    pub color: String,
    /// Text color for active/highlighted word.
    pub highlight_color: String,
    /// Background color.
    pub background_color: String,
    /// Background opacity (0-100).
    pub background_opacity: u32,
    /// Enable text outline.
    pub outline: bool,
    /// Outline color.
    pub outline_color: String,

    // Position
    /// Position: "top" or "bottom".
    pub position: String,

    // Animation timing (seconds)
    /// Duration of word highlight transition.
    pub word_transition_duration: f32,
    /// Duration of segment fade in/out.
    pub fade_duration: f32,
    /// How long segment stays after last word.
    pub linger_duration: f32,

    // Export
    /// Whether to burn captions into exported video.
    pub export_with_subtitles: bool,
}

impl Default for CaptionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            font: "System Sans-Serif".to_string(),
            size: 32,
            font_weight: 700,
            italic: false,
            color: "#A0A0A0".to_string(),
            highlight_color: "#FFFFFF".to_string(),
            background_color: "#000000".to_string(),
            background_opacity: 60,
            outline: false,
            outline_color: "#000000".to_string(),
            position: "bottom".to_string(),
            word_transition_duration: 0.25,
            fade_duration: 0.15,
            linger_duration: 0.4,
            export_with_subtitles: false,
        }
    }
}

/// Complete caption data for a video.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct CaptionData {
    /// Caption segments with word-level timing.
    pub segments: Vec<CaptionSegment>,
    /// Caption display settings.
    pub settings: CaptionSettings,
}

impl Default for CaptionData {
    fn default() -> Self {
        Self {
            segments: Vec::new(),
            settings: CaptionSettings::default(),
        }
    }
}

/// Whisper model information.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct WhisperModelInfo {
    /// Model name (tiny, base, small, medium, large-v3).
    pub name: String,
    /// Approximate file size in bytes.
    pub size_bytes: u64,
    /// Whether the model is downloaded.
    pub downloaded: bool,
    /// Local file path if downloaded.
    pub path: Option<String>,
}

/// Download progress event.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct DownloadProgress {
    /// Progress percentage (0-100).
    pub progress: f64,
    /// Status message.
    pub message: String,
}

/// Transcription progress event.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/types/generated/")]
pub struct TranscriptionProgress {
    /// Current stage: "extracting_audio", "transcribing", "complete".
    pub stage: String,
    /// Progress percentage (0-100).
    pub progress: f64,
    /// Status message.
    pub message: String,
}
```

**Step 2: Create the mod.rs file**

Create `src-tauri/src/commands/captions/mod.rs`:

```rust
//! Caption transcription and management commands.
//!
//! Provides Whisper-based speech-to-text transcription and caption CRUD operations.

pub mod types;

pub use types::*;
```

**Step 3: Register the module**

Modify `src-tauri/src/commands/mod.rs` to add:

```rust
pub mod captions;
```

**Step 4: Generate TypeScript types**

Run: `cd E:/snapit/src-tauri && cargo test --lib`
Expected: Types generated to `src/types/generated/`

**Step 5: Commit**

```bash
git add src-tauri/src/commands/captions/
git add src-tauri/src/commands/mod.rs
git add src/types/generated/
git commit -m "feat(captions): add caption data types with ts-rs bindings"
```

---

### Task 1.3: Add CaptionConfig to VideoProject

**Files:**
- Modify: `src-tauri/src/commands/video_recording/video_project/types.rs`

**Step 1: Add caption field to VideoProject**

In `types.rs`, add the import at the top:

```rust
use crate::commands::captions::CaptionSettings;
```

Add to the `VideoProject` struct (after `mask` field):

```rust
    /// Caption/transcription configuration.
    #[serde(default)]
    pub captions: CaptionSettings,
```

**Step 2: Generate TypeScript types**

Run: `cd E:/snapit/src-tauri && cargo test --lib`

**Step 3: Update frontend types**

The generated `VideoProject.ts` should now include `captions: CaptionSettings`.

**Step 4: Commit**

```bash
git add src-tauri/src/commands/video_recording/video_project/types.rs
git add src/types/generated/
git commit -m "feat(captions): add caption settings to VideoProject"
```

---

## Phase 2: Whisper Transcription Backend

### Task 2.1: Implement model management commands

**Files:**
- Modify: `src-tauri/src/commands/captions/mod.rs`

**Step 1: Add model management code**

Replace the content of `mod.rs` with:

```rust
//! Caption transcription and management commands.

pub mod types;

pub use types::*;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use futures_util::StreamExt;

lazy_static::lazy_static! {
    static ref WHISPER_CONTEXT: Arc<Mutex<Option<Arc<whisper_rs::WhisperContext>>>> =
        Arc::new(Mutex::new(None));
}

const WHISPER_SAMPLE_RATE: u32 = 16000;

/// Get the models directory path.
fn get_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to get app data directory")?;
    Ok(app_dir.join("whisper-models"))
}

/// Get model URL from Hugging Face.
fn get_model_url(model_name: &str) -> &'static str {
    match model_name {
        "tiny" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        "base" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "small" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "medium" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        "large" | "large-v3" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        _ => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    }
}

/// Get expected model size in bytes.
fn get_model_size(model_name: &str) -> u64 {
    match model_name {
        "tiny" => 75_000_000,
        "base" => 142_000_000,
        "small" => 466_000_000,
        "medium" => 1_500_000_000,
        "large" | "large-v3" => 3_000_000_000,
        _ => 75_000_000,
    }
}

/// Check if a Whisper model exists locally.
#[tauri::command]
pub async fn check_whisper_model(
    app: AppHandle,
    model_name: String,
) -> Result<WhisperModelInfo, String> {
    let models_dir = get_models_dir(&app)?;
    let model_file = format!("ggml-{}.bin", model_name);
    let model_path = models_dir.join(&model_file);

    let downloaded = model_path.exists();

    Ok(WhisperModelInfo {
        name: model_name.clone(),
        size_bytes: get_model_size(&model_name),
        downloaded,
        path: if downloaded {
            Some(model_path.to_string_lossy().to_string())
        } else {
            None
        },
    })
}

/// List all available Whisper models with their status.
#[tauri::command]
pub async fn list_whisper_models(app: AppHandle) -> Result<Vec<WhisperModelInfo>, String> {
    let models = vec!["tiny", "base", "small", "medium", "large-v3"];
    let mut result = Vec::new();

    for name in models {
        let info = check_whisper_model(app.clone(), name.to_string()).await?;
        result.push(info);
    }

    Ok(result)
}

/// Download a Whisper model from Hugging Face.
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    model_name: String,
) -> Result<String, String> {
    let models_dir = get_models_dir(&app)?;
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let model_file = format!("ggml-{}.bin", model_name);
    let model_path = models_dir.join(&model_file);

    if model_path.exists() {
        return Ok(model_path.to_string_lossy().to_string());
    }

    let url = get_model_url(&model_name);
    log::info!("Downloading Whisper model from: {}", url);

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(get_model_size(&model_name));
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(&model_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download error: {}", e))?;

        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;
        let progress = (downloaded as f64 / total_size as f64) * 100.0;

        let _ = app.emit("whisper-download-progress", DownloadProgress {
            progress,
            message: format!("Downloading {}: {:.1}%", model_name, progress),
        });
    }

    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| format!("Flush error: {}", e))?;

    log::info!("Model downloaded to: {:?}", model_path);
    Ok(model_path.to_string_lossy().to_string())
}

/// Delete a downloaded Whisper model.
#[tauri::command]
pub async fn delete_whisper_model(
    app: AppHandle,
    model_name: String,
) -> Result<(), String> {
    let models_dir = get_models_dir(&app)?;
    let model_file = format!("ggml-{}.bin", model_name);
    let model_path = models_dir.join(&model_file);

    if model_path.exists() {
        tokio::fs::remove_file(&model_path)
            .await
            .map_err(|e| format!("Failed to delete model: {}", e))?;

        // Clear cached context if it was using this model
        let mut ctx = WHISPER_CONTEXT.lock().await;
        *ctx = None;
    }

    Ok(())
}
```

**Step 2: Verify it compiles**

Run: `cd E:/snapit/src-tauri && cargo check`

**Step 3: Commit**

```bash
git add src-tauri/src/commands/captions/mod.rs
git commit -m "feat(captions): add whisper model management commands"
```

---

### Task 2.2: Implement audio extraction

**Files:**
- Create: `src-tauri/src/commands/captions/audio.rs`
- Modify: `src-tauri/src/commands/captions/mod.rs`

**Step 1: Create audio extraction module**

Create `src-tauri/src/commands/captions/audio.rs`:

```rust
//! Audio extraction from video files for Whisper transcription.

use std::path::Path;
use ffmpeg::ChannelLayout;
use ffmpeg::codec as avcodec;
use ffmpeg::format as avformat;
use ffmpeg::software::resampling;

const WHISPER_SAMPLE_RATE: u32 = 16000;

/// Extract audio from a video file and resample to 16kHz mono for Whisper.
pub fn extract_audio_for_whisper(video_path: &Path, output_path: &Path) -> Result<(), String> {
    log::info!("Extracting audio from: {:?}", video_path);

    ffmpeg::init().map_err(|e| format!("FFmpeg init failed: {}", e))?;

    let mut input = avformat::input(&video_path)
        .map_err(|e| format!("Failed to open video: {}", e))?;

    let stream = input
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .ok_or("No audio stream found")?;

    let stream_index = stream.index();
    let codec_params = stream.parameters();

    let decoder_ctx = avcodec::Context::from_parameters(codec_params.clone())
        .map_err(|e| format!("Failed to create decoder context: {}", e))?;

    let mut decoder = decoder_ctx
        .decoder()
        .audio()
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    let decoder_format = decoder.format();
    let decoder_channel_layout = decoder.channel_layout();
    let decoder_rate = decoder.rate();

    log::info!(
        "Input: {}Hz, {:?}, {:?}",
        decoder_rate,
        decoder_format,
        decoder_channel_layout
    );

    // Output: 16kHz mono PCM for Whisper
    let output_channel_layout = ChannelLayout::MONO;
    let output_format = avformat::Sample::I16(avformat::sample::Type::Packed);

    let mut output = avformat::output(&output_path)
        .map_err(|e| format!("Failed to create output: {}", e))?;

    let codec = avcodec::encoder::find_by_name("pcm_s16le")
        .ok_or("PCM encoder not found")?;

    let mut encoder_ctx = avcodec::Context::new()
        .encoder()
        .audio()
        .map_err(|e| format!("Failed to create encoder: {}", e))?;

    encoder_ctx.set_rate(WHISPER_SAMPLE_RATE as i32);
    encoder_ctx.set_channel_layout(output_channel_layout);
    encoder_ctx.set_format(output_format);

    let mut encoder = encoder_ctx
        .open_as(codec)
        .map_err(|e| format!("Failed to open encoder: {}", e))?;

    {
        let mut output_stream = output
            .add_stream(codec)
            .map_err(|e| format!("Failed to add stream: {}", e))?;
        output_stream.set_parameters(&encoder);
    }

    output
        .write_header()
        .map_err(|e| format!("Failed to write header: {}", e))?;

    let mut resampler = resampling::Context::get(
        decoder_format,
        decoder_channel_layout,
        decoder_rate,
        output_format,
        output_channel_layout,
        WHISPER_SAMPLE_RATE,
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let frame_size = encoder.frame_size() as usize;
    let frame_size = if frame_size == 0 { 1024 } else { frame_size };

    let mut decoded_frame = ffmpeg::frame::Audio::empty();
    let mut resampled_frame = ffmpeg::frame::Audio::new(
        output_format,
        frame_size,
        output_channel_layout,
    );

    // Collect packets first to avoid borrow issues
    let mut packets = Vec::new();
    for (stream, packet) in input.packets() {
        if stream.index() == stream_index {
            if let Some(data) = packet.data() {
                let mut cloned = ffmpeg::Packet::copy(data);
                if let Some(pts) = packet.pts() {
                    cloned.set_pts(Some(pts));
                }
                if let Some(dts) = packet.dts() {
                    cloned.set_dts(Some(dts));
                }
                packets.push(cloned);
            }
        }
    }

    for packet in packets {
        if let Err(e) = decoder.send_packet(&packet) {
            log::warn!("Failed to send packet: {}", e);
            continue;
        }

        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            if let Err(e) = resampler.run(&decoded_frame, &mut resampled_frame) {
                log::warn!("Resample error: {}", e);
                continue;
            }

            if let Err(e) = encoder.send_frame(&resampled_frame) {
                log::warn!("Encode error: {}", e);
                continue;
            }

            loop {
                let mut pkt = ffmpeg::Packet::empty();
                match encoder.receive_packet(&mut pkt) {
                    Ok(_) => {
                        pkt.set_stream(0);
                        let _ = pkt.write_interleaved(&mut output);
                    }
                    Err(_) => break,
                }
            }
        }
    }

    // Flush
    let _ = decoder.send_eof();
    while decoder.receive_frame(&mut decoded_frame).is_ok() {
        let _ = resampler.run(&decoded_frame, &mut resampled_frame);
        let _ = encoder.send_frame(&resampled_frame);

        loop {
            let mut pkt = ffmpeg::Packet::empty();
            if encoder.receive_packet(&mut pkt).is_err() {
                break;
            }
            pkt.set_stream(0);
            let _ = pkt.write_interleaved(&mut output);
        }
    }

    output
        .write_trailer()
        .map_err(|e| format!("Failed to write trailer: {}", e))?;

    log::info!("Audio extracted to: {:?}", output_path);
    Ok(())
}
```

**Step 2: Add module to mod.rs**

Add to `src-tauri/src/commands/captions/mod.rs` after `pub mod types;`:

```rust
pub mod audio;
```

**Step 3: Verify it compiles**

Run: `cd E:/snapit/src-tauri && cargo check`

**Step 4: Commit**

```bash
git add src-tauri/src/commands/captions/audio.rs
git add src-tauri/src/commands/captions/mod.rs
git commit -m "feat(captions): add audio extraction for whisper"
```

---

### Task 2.3: Implement transcription command

**Files:**
- Modify: `src-tauri/src/commands/captions/mod.rs`

**Step 1: Add transcription function**

Add to the end of `mod.rs`:

```rust
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Load or get cached Whisper context.
async fn get_whisper_context(model_path: &str) -> Result<Arc<WhisperContext>, String> {
    let mut ctx_guard = WHISPER_CONTEXT.lock().await;

    if let Some(ref ctx) = *ctx_guard {
        return Ok(ctx.clone());
    }

    log::info!("Loading Whisper model: {}", model_path);

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load model: {}", e))?;

    let ctx_arc = Arc::new(ctx);
    *ctx_guard = Some(ctx_arc.clone());

    Ok(ctx_arc)
}

/// Check if a token is a special Whisper token that should be filtered.
fn is_special_token(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.is_empty()
        || trimmed.contains('[')
        || trimmed.contains(']')
        || trimmed.contains("_TT_")
        || trimmed.contains("_BEG_")
        || trimmed.contains("<|")
}

/// Process audio with Whisper and return caption segments.
fn process_with_whisper(
    audio_path: &std::path::Path,
    context: Arc<WhisperContext>,
    language: &str,
) -> Result<Vec<CaptionSegment>, String> {
    log::info!("Processing audio: {:?}", audio_path);

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_token_timestamps(true);
    params.set_language(Some(if language == "auto" { "auto" } else { language }));
    params.set_max_len(i32::MAX);

    // Read audio file (16-bit PCM)
    let audio_data = std::fs::read(audio_path)
        .map_err(|e| format!("Failed to read audio: {}", e))?;

    // Convert to f32 samples
    let mut samples = Vec::with_capacity(audio_data.len() / 2);
    for chunk in audio_data.chunks(2) {
        if chunk.len() == 2 {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0;
            samples.push(sample);
        }
    }

    log::info!("Audio: {} samples, {:.1}s", samples.len(), samples.len() as f32 / WHISPER_SAMPLE_RATE as f32);

    let mut state = context
        .create_state()
        .map_err(|e| format!("Failed to create state: {}", e))?;

    state
        .full(params, &samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Failed to get segments: {}", e))?;

    log::info!("Found {} segments", num_segments);

    let mut segments = Vec::new();

    for i in 0..num_segments {
        let segment_text = state
            .full_get_segment_text(i)
            .map_err(|e| format!("Failed to get text: {}", e))?;

        let start_t = state.full_get_segment_t0(i).unwrap_or(0) as f32 / 100.0;
        let end_t = state.full_get_segment_t1(i).unwrap_or(0) as f32 / 100.0;

        // Extract words with timing
        let num_tokens = state.full_n_tokens(i).unwrap_or(0);
        let mut words = Vec::new();
        let mut current_word = String::new();
        let mut word_start: Option<f32> = None;
        let mut word_end = start_t;

        for t in 0..num_tokens {
            let token_text = state.full_get_token_text(i, t).unwrap_or_default();

            if is_special_token(&token_text) {
                continue;
            }

            if let Ok(data) = state.full_get_token_data(i, t) {
                let t0 = data.t0 as f32 / 100.0;
                let t1 = data.t1 as f32 / 100.0;

                if token_text.starts_with(' ') || token_text.starts_with('\n') {
                    // Save previous word
                    if !current_word.trim().is_empty() {
                        if let Some(ws) = word_start {
                            words.push(CaptionWord {
                                text: current_word.trim().to_string(),
                                start: ws,
                                end: word_end,
                            });
                        }
                    }
                    current_word = token_text.trim().to_string();
                    word_start = Some(t0);
                } else {
                    if word_start.is_none() {
                        word_start = Some(t0);
                    }
                    current_word.push_str(&token_text);
                }
                word_end = t1;
            }
        }

        // Save final word
        if !current_word.trim().is_empty() {
            if let Some(ws) = word_start {
                words.push(CaptionWord {
                    text: current_word.trim().to_string(),
                    start: ws,
                    end: word_end,
                });
            }
        }

        if words.is_empty() {
            continue;
        }

        // Split into chunks of max 6 words per segment
        const MAX_WORDS: usize = 6;
        for (chunk_idx, chunk) in words.chunks(MAX_WORDS).enumerate() {
            let chunk_text = chunk.iter().map(|w| w.text.clone()).collect::<Vec<_>>().join(" ");
            let chunk_start = chunk.first().map(|w| w.start).unwrap_or(start_t);
            let chunk_end = chunk.last().map(|w| w.end).unwrap_or(end_t);

            segments.push(CaptionSegment {
                id: format!("segment-{}-{}", i, chunk_idx),
                start: chunk_start,
                end: chunk_end,
                text: chunk_text,
                words: chunk.to_vec(),
            });
        }
    }

    log::info!("Transcription complete: {} segments", segments.len());
    Ok(segments)
}

/// Transcribe audio from a video file.
#[tauri::command]
pub async fn transcribe_video(
    app: AppHandle,
    video_path: String,
    model_name: String,
    language: String,
) -> Result<CaptionData, String> {
    log::info!("Transcribing: {} with model: {}", video_path, model_name);

    // Check model exists
    let model_info = check_whisper_model(app.clone(), model_name.clone()).await?;
    let model_path = model_info.path.ok_or("Model not downloaded")?;

    // Emit progress: extracting audio
    let _ = app.emit("transcription-progress", TranscriptionProgress {
        stage: "extracting_audio".to_string(),
        progress: 0.0,
        message: "Extracting audio...".to_string(),
    });

    // Extract audio to temp file
    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let audio_path = temp_dir.path().join("audio.wav");

    let video_path_clone = video_path.clone();
    let audio_path_clone = audio_path.clone();

    tokio::task::spawn_blocking(move || {
        audio::extract_audio_for_whisper(
            std::path::Path::new(&video_path_clone),
            &audio_path_clone,
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Emit progress: transcribing
    let _ = app.emit("transcription-progress", TranscriptionProgress {
        stage: "transcribing".to_string(),
        progress: 50.0,
        message: "Transcribing audio...".to_string(),
    });

    // Load Whisper and transcribe
    let context = get_whisper_context(&model_path).await?;

    let segments = tokio::task::spawn_blocking(move || {
        process_with_whisper(&audio_path, context, &language)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Emit progress: complete
    let _ = app.emit("transcription-progress", TranscriptionProgress {
        stage: "complete".to_string(),
        progress: 100.0,
        message: "Transcription complete".to_string(),
    });

    Ok(CaptionData {
        segments,
        settings: CaptionSettings::default(),
    })
}
```

**Step 2: Verify it compiles**

Run: `cd E:/snapit/src-tauri && cargo check`

**Step 3: Commit**

```bash
git add src-tauri/src/commands/captions/mod.rs
git commit -m "feat(captions): add transcription command with whisper"
```

---

### Task 2.4: Register caption commands in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add caption commands to invoke_handler**

Find the `invoke_handler` section and add the caption commands after the logging commands (around line 312):

```rust
            // Caption/transcription commands
            commands::captions::check_whisper_model,
            commands::captions::list_whisper_models,
            commands::captions::download_whisper_model,
            commands::captions::delete_whisper_model,
            commands::captions::transcribe_video,
```

**Step 2: Verify it compiles**

Run: `cd E:/snapit/src-tauri && cargo build`

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(captions): register caption commands in tauri"
```

---

## Phase 3: Caption Storage

### Task 3.1: Add save/load caption commands

**Files:**
- Modify: `src-tauri/src/commands/captions/mod.rs`

**Step 1: Add storage commands**

Add these functions to `mod.rs`:

```rust
use std::path::Path;

/// Get the captions file path for a project.
fn get_captions_path(project_dir: &Path) -> PathBuf {
    project_dir.join("captions").join("captions.json")
}

/// Save captions for a video project.
#[tauri::command]
pub async fn save_captions(
    project_path: String,
    captions: CaptionData,
) -> Result<(), String> {
    let project_dir = Path::new(&project_path).parent()
        .ok_or("Invalid project path")?;

    let captions_dir = project_dir.join("captions");
    std::fs::create_dir_all(&captions_dir)
        .map_err(|e| format!("Failed to create captions dir: {}", e))?;

    let captions_path = get_captions_path(project_dir);

    let json = serde_json::to_string_pretty(&captions)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    std::fs::write(&captions_path, json)
        .map_err(|e| format!("Failed to write: {}", e))?;

    log::info!("Saved captions to: {:?}", captions_path);
    Ok(())
}

/// Load captions for a video project.
#[tauri::command]
pub async fn load_captions(
    project_path: String,
) -> Result<Option<CaptionData>, String> {
    let project_dir = Path::new(&project_path).parent()
        .ok_or("Invalid project path")?;

    let captions_path = get_captions_path(project_dir);

    if !captions_path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(&captions_path)
        .map_err(|e| format!("Failed to read: {}", e))?;

    let captions: CaptionData = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse: {}", e))?;

    log::info!("Loaded captions from: {:?}", captions_path);
    Ok(Some(captions))
}

/// Export captions as SRT file.
#[tauri::command]
pub async fn export_captions_srt(
    project_path: String,
    output_path: String,
) -> Result<(), String> {
    let captions = load_captions(project_path).await?
        .ok_or("No captions found")?;

    let mut srt = String::new();

    for (i, segment) in captions.segments.iter().enumerate() {
        let start = format_srt_time(segment.start as f64);
        let end = format_srt_time(segment.end as f64);

        srt.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            start,
            end,
            segment.text.trim()
        ));
    }

    std::fs::write(&output_path, srt)
        .map_err(|e| format!("Failed to write SRT: {}", e))?;

    log::info!("Exported SRT to: {}", output_path);
    Ok(())
}

/// Export captions as VTT file.
#[tauri::command]
pub async fn export_captions_vtt(
    project_path: String,
    output_path: String,
) -> Result<(), String> {
    let captions = load_captions(project_path).await?
        .ok_or("No captions found")?;

    let mut vtt = String::from("WEBVTT\n\n");

    for segment in &captions.segments {
        let start = format_vtt_time(segment.start as f64);
        let end = format_vtt_time(segment.end as f64);

        vtt.push_str(&format!(
            "{} --> {}\n{}\n\n",
            start,
            end,
            segment.text.trim()
        ));
    }

    std::fs::write(&output_path, vtt)
        .map_err(|e| format!("Failed to write VTT: {}", e))?;

    log::info!("Exported VTT to: {}", output_path);
    Ok(())
}

fn format_srt_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as i32;
    let minutes = ((seconds % 3600.0) / 60.0) as i32;
    let secs = (seconds % 60.0) as i32;
    let millis = ((seconds % 1.0) * 1000.0) as i32;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

fn format_vtt_time(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as i32;
    let minutes = ((seconds % 3600.0) / 60.0) as i32;
    let secs = (seconds % 60.0) as i32;
    let millis = ((seconds % 1.0) * 1000.0) as i32;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, millis)
}
```

**Step 2: Register commands in lib.rs**

Add to invoke_handler:

```rust
            commands::captions::save_captions,
            commands::captions::load_captions,
            commands::captions::export_captions_srt,
            commands::captions::export_captions_vtt,
```

**Step 3: Verify and commit**

Run: `cd E:/snapit/src-tauri && cargo check`

```bash
git add src-tauri/src/commands/captions/mod.rs
git add src-tauri/src/lib.rs
git commit -m "feat(captions): add save/load and SRT/VTT export commands"
```

---

## Phase 4: Frontend Caption Store

### Task 4.1: Create caption store slice

**Files:**
- Create: `src/stores/videoEditor/captionSlice.ts`

**Step 1: Create the slice**

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator } from './types';
import type {
  CaptionData,
  CaptionSegment,
  CaptionSettings,
  WhisperModelInfo,
} from '../../types';
import { videoEditorLogger } from '../../utils/logger';

/**
 * Caption state and actions for video transcription
 */
export interface CaptionSlice {
  // Caption data
  captions: CaptionData | null;
  selectedSegmentId: string | null;

  // Model state
  availableModels: WhisperModelInfo[];
  selectedModel: string;
  isDownloadingModel: boolean;
  downloadProgress: number;

  // Transcription state
  isTranscribing: boolean;
  transcriptionProgress: number;
  transcriptionStage: string;

  // Actions
  loadCaptions: (projectPath: string) => Promise<void>;
  saveCaptions: (projectPath: string) => Promise<void>;
  setCaptions: (captions: CaptionData | null) => void;

  // Transcription actions
  transcribe: (videoPath: string, language?: string) => Promise<void>;
  cancelTranscription: () => void;

  // Model actions
  loadModels: () => Promise<void>;
  downloadModel: (modelName: string) => Promise<void>;
  deleteModel: (modelName: string) => Promise<void>;
  setSelectedModel: (modelName: string) => void;

  // Segment actions
  selectSegment: (segmentId: string | null) => void;
  updateSegment: (segmentId: string, updates: Partial<CaptionSegment>) => void;
  deleteSegment: (segmentId: string) => void;
  splitSegment: (segmentId: string, splitTime: number) => void;
  mergeSegments: (segmentId1: string, segmentId2: string) => void;

  // Settings actions
  updateCaptionSettings: (updates: Partial<CaptionSettings>) => void;
}

export const createCaptionSlice: SliceCreator<CaptionSlice> = (set, get) => ({
  // Initial state
  captions: null,
  selectedSegmentId: null,
  availableModels: [],
  selectedModel: 'base',
  isDownloadingModel: false,
  downloadProgress: 0,
  isTranscribing: false,
  transcriptionProgress: 0,
  transcriptionStage: '',

  // Load captions from disk
  loadCaptions: async (projectPath: string) => {
    try {
      const captions = await invoke<CaptionData | null>('load_captions', {
        projectPath,
      });
      set({ captions });
      videoEditorLogger.info('Loaded captions:', captions?.segments.length ?? 0, 'segments');
    } catch (error) {
      videoEditorLogger.error('Failed to load captions:', error);
    }
  },

  // Save captions to disk
  saveCaptions: async (projectPath: string) => {
    const { captions } = get();
    if (!captions) return;

    try {
      await invoke('save_captions', { projectPath, captions });
      videoEditorLogger.info('Saved captions');
    } catch (error) {
      videoEditorLogger.error('Failed to save captions:', error);
    }
  },

  setCaptions: (captions) => set({ captions }),

  // Transcribe video
  transcribe: async (videoPath: string, language = 'auto') => {
    const { selectedModel } = get();

    set({
      isTranscribing: true,
      transcriptionProgress: 0,
      transcriptionStage: 'starting',
    });

    try {
      const captions = await invoke<CaptionData>('transcribe_video', {
        videoPath,
        modelName: selectedModel,
        language,
      });

      set({
        captions,
        isTranscribing: false,
        transcriptionProgress: 100,
        transcriptionStage: 'complete',
      });

      videoEditorLogger.info('Transcription complete:', captions.segments.length, 'segments');
    } catch (error) {
      videoEditorLogger.error('Transcription failed:', error);
      set({
        isTranscribing: false,
        transcriptionStage: 'error',
      });
      throw error;
    }
  },

  cancelTranscription: () => {
    // TODO: Implement cancellation
    set({ isTranscribing: false });
  },

  // Load available models
  loadModels: async () => {
    try {
      const models = await invoke<WhisperModelInfo[]>('list_whisper_models');
      set({ availableModels: models });
    } catch (error) {
      videoEditorLogger.error('Failed to load models:', error);
    }
  },

  // Download a model
  downloadModel: async (modelName: string) => {
    set({ isDownloadingModel: true, downloadProgress: 0 });

    try {
      await invoke('download_whisper_model', { modelName });
      await get().loadModels();
      set({ isDownloadingModel: false, downloadProgress: 100 });
    } catch (error) {
      videoEditorLogger.error('Failed to download model:', error);
      set({ isDownloadingModel: false });
      throw error;
    }
  },

  // Delete a model
  deleteModel: async (modelName: string) => {
    try {
      await invoke('delete_whisper_model', { modelName });
      await get().loadModels();
    } catch (error) {
      videoEditorLogger.error('Failed to delete model:', error);
      throw error;
    }
  },

  setSelectedModel: (modelName) => set({ selectedModel: modelName }),

  // Segment selection
  selectSegment: (segmentId) => set({ selectedSegmentId: segmentId }),

  // Update a segment
  updateSegment: (segmentId, updates) => {
    const { captions } = get();
    if (!captions) return;

    const segments = captions.segments.map((seg) =>
      seg.id === segmentId ? { ...seg, ...updates } : seg
    );

    set({
      captions: { ...captions, segments },
    });
  },

  // Delete a segment
  deleteSegment: (segmentId) => {
    const { captions, selectedSegmentId } = get();
    if (!captions) return;

    const segments = captions.segments.filter((seg) => seg.id !== segmentId);

    set({
      captions: { ...captions, segments },
      selectedSegmentId: selectedSegmentId === segmentId ? null : selectedSegmentId,
    });
  },

  // Split a segment at a given time
  splitSegment: (segmentId, splitTime) => {
    const { captions } = get();
    if (!captions) return;

    const segmentIndex = captions.segments.findIndex((s) => s.id === segmentId);
    if (segmentIndex === -1) return;

    const segment = captions.segments[segmentIndex];

    // Split words into two groups
    const wordsBeforeSplit = segment.words.filter((w) => w.end <= splitTime);
    const wordsAfterSplit = segment.words.filter((w) => w.start >= splitTime);

    if (wordsBeforeSplit.length === 0 || wordsAfterSplit.length === 0) return;

    const seg1: CaptionSegment = {
      id: `${segment.id}-a`,
      start: segment.start,
      end: wordsBeforeSplit[wordsBeforeSplit.length - 1].end,
      text: wordsBeforeSplit.map((w) => w.text).join(' '),
      words: wordsBeforeSplit,
    };

    const seg2: CaptionSegment = {
      id: `${segment.id}-b`,
      start: wordsAfterSplit[0].start,
      end: segment.end,
      text: wordsAfterSplit.map((w) => w.text).join(' '),
      words: wordsAfterSplit,
    };

    const newSegments = [...captions.segments];
    newSegments.splice(segmentIndex, 1, seg1, seg2);

    set({
      captions: { ...captions, segments: newSegments },
    });
  },

  // Merge two adjacent segments
  mergeSegments: (segmentId1, segmentId2) => {
    const { captions } = get();
    if (!captions) return;

    const seg1 = captions.segments.find((s) => s.id === segmentId1);
    const seg2 = captions.segments.find((s) => s.id === segmentId2);

    if (!seg1 || !seg2) return;

    const merged: CaptionSegment = {
      id: `${seg1.id}-merged`,
      start: Math.min(seg1.start, seg2.start),
      end: Math.max(seg1.end, seg2.end),
      text: `${seg1.text} ${seg2.text}`,
      words: [...seg1.words, ...seg2.words].sort((a, b) => a.start - b.start),
    };

    const segments = captions.segments.filter(
      (s) => s.id !== segmentId1 && s.id !== segmentId2
    );
    segments.push(merged);
    segments.sort((a, b) => a.start - b.start);

    set({
      captions: { ...captions, segments },
    });
  },

  // Update caption settings
  updateCaptionSettings: (updates) => {
    const { captions } = get();
    if (!captions) {
      set({
        captions: {
          segments: [],
          settings: { ...getDefaultSettings(), ...updates },
        },
      });
      return;
    }

    set({
      captions: {
        ...captions,
        settings: { ...captions.settings, ...updates },
      },
    });
  },
});

function getDefaultSettings(): CaptionSettings {
  return {
    enabled: false,
    font: 'System Sans-Serif',
    size: 32,
    fontWeight: 700,
    italic: false,
    color: '#A0A0A0',
    highlightColor: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 60,
    outline: false,
    outlineColor: '#000000',
    position: 'bottom',
    wordTransitionDuration: 0.25,
    fadeDuration: 0.15,
    lingerDuration: 0.4,
    exportWithSubtitles: false,
  };
}
```

**Step 2: Commit**

```bash
git add src/stores/videoEditor/captionSlice.ts
git commit -m "feat(captions): add caption store slice"
```

---

### Task 4.2: Integrate caption slice into video editor store

**Files:**
- Modify: `src/stores/videoEditor/index.ts`
- Modify: `src/stores/videoEditor/types.ts`

**Step 1: Update types.ts**

Add import and type:

```typescript
import type { CaptionSlice } from './captionSlice';

// Add to VideoEditorState type
export type VideoEditorState = PlaybackSlice &
  TimelineSlice &
  SegmentsSlice &
  ExportSlice &
  ProjectSlice &
  GPUEditorSlice &
  CaptionSlice;
```

**Step 2: Update index.ts**

Add import:

```typescript
import { createCaptionSlice } from './captionSlice';
```

Add to store creation:

```typescript
export const useVideoEditorStore = create<VideoEditorState>()(
  devtools(
    (...a) => ({
      ...createPlaybackSlice(...a),
      ...createTimelineSlice(...a),
      ...createSegmentsSlice(...a),
      ...createExportSlice(...a),
      ...createProjectSlice(...a),
      ...createGPUEditorSlice(...a),
      ...createCaptionSlice(...a),
    }),
    { name: 'VideoEditorStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
```

Add export:

```typescript
export type { CaptionSlice } from './captionSlice';
```

**Step 3: Commit**

```bash
git add src/stores/videoEditor/index.ts
git add src/stores/videoEditor/types.ts
git commit -m "feat(captions): integrate caption slice into video editor store"
```

---

## Phase 5: Frontend UI Components

### Task 5.1: Create CaptionPanel component

**Files:**
- Create: `src/components/video-editor/CaptionPanel.tsx`

**Step 1: Create the component**

```tsx
import { useEffect } from 'react';
import { useVideoEditorStore } from '@/stores/videoEditor';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Download, Trash2, Mic, Loader2 } from 'lucide-react';

export function CaptionPanel() {
  const {
    availableModels,
    selectedModel,
    isDownloadingModel,
    downloadProgress,
    isTranscribing,
    transcriptionProgress,
    transcriptionStage,
    captions,
    loadModels,
    downloadModel,
    deleteModel,
    setSelectedModel,
    transcribe,
    project,
  } = useVideoEditorStore();

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const currentModel = availableModels.find((m) => m.name === selectedModel);
  const canTranscribe = currentModel?.downloaded && !isTranscribing && !isDownloadingModel;

  const handleTranscribe = async () => {
    if (!project?.sources.screenVideo) return;
    try {
      await transcribe(project.sources.screenVideo);
    } catch (error) {
      console.error('Transcription failed:', error);
    }
  };

  const handleDownload = async () => {
    try {
      await downloadModel(selectedModel);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteModel(selectedModel);
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${bytes} B`;
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-medium text-sm">Captions</h3>

      {/* Model selection */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Whisper Model</label>
        <div className="flex gap-2">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{model.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatSize(model.sizeBytes)}
                    </span>
                    {model.downloaded && (
                      <span className="text-xs text-green-500">✓</span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentModel?.downloaded ? (
            <Button
              variant="outline"
              size="icon"
              onClick={handleDelete}
              disabled={isDownloadingModel || isTranscribing}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              onClick={handleDownload}
              disabled={isDownloadingModel || isTranscribing}
            >
              {isDownloadingModel ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>

        {isDownloadingModel && (
          <Progress value={downloadProgress} className="h-1" />
        )}
      </div>

      {/* Transcribe button */}
      <Button
        className="w-full"
        onClick={handleTranscribe}
        disabled={!canTranscribe}
      >
        {isTranscribing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {transcriptionStage === 'extracting_audio'
              ? 'Extracting audio...'
              : 'Transcribing...'}
          </>
        ) : (
          <>
            <Mic className="mr-2 h-4 w-4" />
            Transcribe
          </>
        )}
      </Button>

      {isTranscribing && (
        <Progress value={transcriptionProgress} className="h-1" />
      )}

      {/* Caption count */}
      {captions && captions.segments.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {captions.segments.length} caption segments
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/video-editor/CaptionPanel.tsx
git commit -m "feat(captions): add CaptionPanel component"
```

---

### Task 5.2: Create CaptionSettings component

**Files:**
- Create: `src/components/video-editor/CaptionSettings.tsx`

**Step 1: Create the component**

```tsx
import { useVideoEditorStore } from '@/stores/videoEditor';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

export function CaptionSettings() {
  const { captions, updateCaptionSettings } = useVideoEditorStore();
  const settings = captions?.settings;

  if (!settings) return null;

  return (
    <Collapsible defaultOpen className="border rounded-lg p-3">
      <CollapsibleTrigger className="flex items-center justify-between w-full">
        <span className="font-medium text-sm">Caption Style</span>
        <ChevronDown className="h-4 w-4" />
      </CollapsibleTrigger>

      <CollapsibleContent className="pt-4 space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <Label>Show captions</Label>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => updateCaptionSettings({ enabled })}
          />
        </div>

        {/* Font */}
        <div className="space-y-2">
          <Label className="text-xs">Font</Label>
          <Select
            value={settings.font}
            onValueChange={(font) => updateCaptionSettings({ font })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="System Sans-Serif">System Sans-Serif</SelectItem>
              <SelectItem value="Inter">Inter</SelectItem>
              <SelectItem value="Arial">Arial</SelectItem>
              <SelectItem value="Helvetica">Helvetica</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Size */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs">Size</Label>
            <span className="text-xs text-muted-foreground">{settings.size}px</span>
          </div>
          <Slider
            value={[settings.size]}
            onValueChange={([size]) => updateCaptionSettings({ size })}
            min={16}
            max={72}
            step={2}
          />
        </div>

        {/* Position */}
        <div className="space-y-2">
          <Label className="text-xs">Position</Label>
          <Select
            value={settings.position}
            onValueChange={(position) => updateCaptionSettings({ position })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom">Bottom</SelectItem>
              <SelectItem value="top">Top</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Text color */}
        <div className="space-y-2">
          <Label className="text-xs">Text Color</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={settings.color}
              onChange={(e) => updateCaptionSettings({ color: e.target.value })}
              className="w-12 h-8 p-1"
            />
            <Input
              value={settings.color}
              onChange={(e) => updateCaptionSettings({ color: e.target.value })}
              className="flex-1"
            />
          </div>
        </div>

        {/* Highlight color */}
        <div className="space-y-2">
          <Label className="text-xs">Highlight Color</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={settings.highlightColor}
              onChange={(e) => updateCaptionSettings({ highlightColor: e.target.value })}
              className="w-12 h-8 p-1"
            />
            <Input
              value={settings.highlightColor}
              onChange={(e) => updateCaptionSettings({ highlightColor: e.target.value })}
              className="flex-1"
            />
          </div>
        </div>

        {/* Background */}
        <div className="space-y-2">
          <Label className="text-xs">Background</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={settings.backgroundColor}
              onChange={(e) => updateCaptionSettings({ backgroundColor: e.target.value })}
              className="w-12 h-8 p-1"
            />
            <Slider
              value={[settings.backgroundOpacity]}
              onValueChange={([backgroundOpacity]) => updateCaptionSettings({ backgroundOpacity })}
              min={0}
              max={100}
              className="flex-1"
            />
            <span className="text-xs w-8">{settings.backgroundOpacity}%</span>
          </div>
        </div>

        {/* Transition duration */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs">Word Transition</Label>
            <span className="text-xs text-muted-foreground">{settings.wordTransitionDuration}s</span>
          </div>
          <Slider
            value={[settings.wordTransitionDuration * 100]}
            onValueChange={([v]) => updateCaptionSettings({ wordTransitionDuration: v / 100 })}
            min={0}
            max={100}
            step={5}
          />
        </div>

        {/* Export option */}
        <div className="flex items-center justify-between pt-2 border-t">
          <Label className="text-xs">Burn into export</Label>
          <Switch
            checked={settings.exportWithSubtitles}
            onCheckedChange={(exportWithSubtitles) =>
              updateCaptionSettings({ exportWithSubtitles })
            }
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/video-editor/CaptionSettings.tsx
git commit -m "feat(captions): add CaptionSettings component"
```

---

## Phase 6: GPU Caption Rendering

### Task 6.1: Create caption layer module

**Files:**
- Create: `src-tauri/src/rendering/caption_layer.rs`

**Step 1: Create the caption rendering layer**

```rust
//! GPU-based caption rendering layer.
//!
//! Renders captions with word-level highlighting using glyphon.

use glyphon::{
    Attrs, Buffer, Color, Family, FontSystem, Metrics, Shaping, Style, Weight,
};

use crate::commands::captions::{CaptionData, CaptionSegment, CaptionSettings};

/// Find the active caption segment for a given time.
pub fn find_active_segment(captions: &CaptionData, time_secs: f32) -> Option<&CaptionSegment> {
    let settings = &captions.settings;

    captions.segments.iter().find(|seg| {
        let visible_end = seg.end + settings.linger_duration;
        time_secs >= seg.start && time_secs <= visible_end
    })
}

/// Calculate word colors for a segment at a given time.
pub fn calculate_word_colors(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    time_secs: f32,
) -> Vec<[f32; 4]> {
    let base_color = parse_hex_color(&settings.color);
    let highlight_color = parse_hex_color(&settings.highlight_color);

    segment.words.iter().map(|word| {
        let transition_start = word.start - settings.word_transition_duration;
        let progress = if time_secs < transition_start {
            0.0
        } else if time_secs >= word.start {
            1.0
        } else {
            let t = (time_secs - transition_start) / settings.word_transition_duration;
            ease_out_cubic(t.clamp(0.0, 1.0))
        };

        lerp_color(base_color, highlight_color, progress)
    }).collect()
}

/// Calculate segment opacity (fade in/out).
pub fn calculate_segment_opacity(
    segment: &CaptionSegment,
    settings: &CaptionSettings,
    time_secs: f32,
) -> f32 {
    let fade_in_end = segment.start + settings.fade_duration;
    let fade_out_start = segment.end + settings.linger_duration - settings.fade_duration;
    let visible_end = segment.end + settings.linger_duration;

    if time_secs < segment.start {
        0.0
    } else if time_secs < fade_in_end {
        let t = (time_secs - segment.start) / settings.fade_duration;
        ease_out_cubic(t)
    } else if time_secs < fade_out_start {
        1.0
    } else if time_secs < visible_end {
        let t = (time_secs - fade_out_start) / settings.fade_duration;
        1.0 - ease_out_cubic(t)
    } else {
        0.0
    }
}

/// Calculate caption Y position based on settings.
pub fn calculate_caption_y(
    settings: &CaptionSettings,
    output_height: f32,
    text_height: f32,
) -> f32 {
    let margin = 40.0;

    match settings.position.as_str() {
        "top" => margin,
        _ => output_height - text_height - margin,
    }
}

fn parse_hex_color(hex: &str) -> [f32; 4] {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255) as f32 / 255.0;
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255) as f32 / 255.0;
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255) as f32 / 255.0;
        [r, g, b, 1.0]
    } else {
        [1.0, 1.0, 1.0, 1.0]
    }
}

fn lerp_color(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

fn ease_out_cubic(t: f32) -> f32 {
    1.0 - (1.0 - t).powi(3)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::captions::{CaptionWord, CaptionSettings};

    #[test]
    fn test_parse_hex_color() {
        let white = parse_hex_color("#FFFFFF");
        assert!((white[0] - 1.0).abs() < 0.01);
        assert!((white[1] - 1.0).abs() < 0.01);
        assert!((white[2] - 1.0).abs() < 0.01);

        let red = parse_hex_color("#FF0000");
        assert!((red[0] - 1.0).abs() < 0.01);
        assert!(red[1].abs() < 0.01);
        assert!(red[2].abs() < 0.01);
    }

    #[test]
    fn test_ease_out_cubic() {
        assert!((ease_out_cubic(0.0) - 0.0).abs() < 0.01);
        assert!((ease_out_cubic(1.0) - 1.0).abs() < 0.01);
        assert!(ease_out_cubic(0.5) > 0.5); // Easing should be faster at start
    }
}
```

**Step 2: Register module**

Add to `src-tauri/src/rendering/mod.rs`:

```rust
pub mod caption_layer;
pub use caption_layer::*;
```

**Step 3: Commit**

```bash
git add src-tauri/src/rendering/caption_layer.rs
git add src-tauri/src/rendering/mod.rs
git commit -m "feat(captions): add GPU caption layer with word highlighting"
```

---

## Remaining Tasks (Summary)

The following tasks complete the implementation but are less detailed since they follow established patterns:

### Task 6.2: Integrate caption layer into compositor
- Modify `src-tauri/src/rendering/compositor.rs` to call caption rendering
- Pass caption data to render pipeline

### Task 6.3: Add caption rendering to text_layer.rs
- Extend `TextLayer::prepare()` to handle caption text with per-word colors
- Add method to render caption background rectangle

### Task 7.1: Integrate CaptionPanel into video editor sidebar
- Add to video editor layout

### Task 7.2: Listen for progress events
- Add Tauri event listeners for download/transcription progress

### Task 7.3: Create CaptionTimeline component
- Show caption segments on timeline
- Allow drag to adjust timing

### Task 8.1: Add caption export options to export dialog
- Burn-in checkbox
- SRT/VTT format selection

### Task 8.2: Pass captions to export pipeline
- Modify `export_video` to include captions when burn-in enabled

---

## Testing Strategy

1. **Unit tests** for caption types and utilities (color parsing, time formatting)
2. **Integration test** for transcription pipeline (requires test audio file)
3. **Manual testing** for UI components and GPU rendering
4. **Export verification** to confirm burn-in and SRT/VTT output

---

## Notes

- Whisper model download may take several minutes for larger models
- First transcription will be slower due to model loading (subsequent calls use cached context)
- Word-level timestamps depend on Whisper model quality (larger = more accurate)
- Caption rendering performance should be monitored for long videos
