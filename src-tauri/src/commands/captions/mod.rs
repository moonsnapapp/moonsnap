//! Caption transcription and management commands.

pub mod audio;
pub mod types;

pub use types::*;

use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

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
        "large" | "large-v3" => {
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"
        },
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
pub async fn download_whisper_model(app: AppHandle, model_name: String) -> Result<String, String> {
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

    let total_size = response
        .content_length()
        .unwrap_or(get_model_size(&model_name));
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

        let _ = app.emit(
            "whisper-download-progress",
            DownloadProgress {
                progress,
                message: format!("Downloading {}: {:.1}%", model_name, progress),
            },
        );
    }

    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| format!("Flush error: {}", e))?;

    log::info!("Model downloaded to: {:?}", model_path);
    Ok(model_path.to_string_lossy().to_string())
}

/// Delete a downloaded Whisper model.
#[tauri::command]
pub async fn delete_whisper_model(app: AppHandle, model_name: String) -> Result<(), String> {
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

// ============================================================================
// Transcription
// ============================================================================

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
    samples: &[f32],
    context: Arc<WhisperContext>,
    language: &str,
) -> Result<Vec<CaptionSegment>, String> {
    log::info!(
        "Processing {} samples ({:.1}s)",
        samples.len(),
        samples.len() as f32 / WHISPER_SAMPLE_RATE as f32
    );

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_token_timestamps(true);
    params.set_language(Some(if language == "auto" { "auto" } else { language }));
    params.set_max_len(i32::MAX);

    let mut state = context
        .create_state()
        .map_err(|e| format!("Failed to create state: {}", e))?;

    state
        .full(params, samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Failed to get segments: {}", e))?;

    log::info!("Found {} raw segments", num_segments);

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
            let chunk_text = chunk
                .iter()
                .map(|w| w.text.clone())
                .collect::<Vec<_>>()
                .join(" ");
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
    let _ = app.emit(
        "transcription-progress",
        TranscriptionProgress {
            stage: "extracting_audio".to_string(),
            progress: 0.0,
            message: "Extracting audio...".to_string(),
        },
    );

    // Extract audio to temp file
    let temp_dir = tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let audio_path = temp_dir.path().join("audio.wav");

    let video_path_clone = video_path.clone();
    let audio_path_clone = audio_path.clone();

    tokio::task::spawn_blocking(move || {
        audio::extract_audio_for_whisper(std::path::Path::new(&video_path_clone), &audio_path_clone)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Emit progress: transcribing
    let _ = app.emit(
        "transcription-progress",
        TranscriptionProgress {
            stage: "transcribing".to_string(),
            progress: 50.0,
            message: "Transcribing audio...".to_string(),
        },
    );

    // Load audio samples
    let samples =
        audio::load_wav_as_f32(&audio_path).map_err(|e| format!("Failed to load audio: {}", e))?;

    // Load Whisper and transcribe
    let context = get_whisper_context(&model_path).await?;

    let segments =
        tokio::task::spawn_blocking(move || process_with_whisper(&samples, context, &language))
            .await
            .map_err(|e| format!("Task error: {}", e))??;

    // Emit progress: complete
    let _ = app.emit(
        "transcription-progress",
        TranscriptionProgress {
            stage: "complete".to_string(),
            progress: 100.0,
            message: "Transcription complete".to_string(),
        },
    );

    Ok(CaptionData {
        segments,
        settings: CaptionSettings::default(),
    })
}
