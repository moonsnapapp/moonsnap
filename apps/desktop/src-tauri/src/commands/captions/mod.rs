//! Caption transcription and management commands.

pub mod audio;
use moonsnap_domain::captions::*;

use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

#[derive(Clone)]
struct CachedWhisperContext {
    model_path: String,
    context: Arc<whisper_rs::WhisperContext>,
}

lazy_static::lazy_static! {
    static ref WHISPER_CONTEXT: Arc<Mutex<Option<CachedWhisperContext>>> =
        Arc::new(Mutex::new(None));
}

const WHISPER_SAMPLE_RATE: u32 = 16000;
const MAX_SPACE_DELIMITED_WORDS_PER_SEGMENT: usize = 6;
const MAX_INLINE_WORDS_PER_SEGMENT: usize = 18;
const TRANSCRIPTION_CANCELLED_MESSAGE: &str = "Transcription cancelled.";

static TRANSCRIPTION_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug)]
struct TimedToken {
    raw_text: String,
    text: String,
    start: f32,
    end: f32,
}

#[derive(Clone, Debug)]
struct ProjectAudioSource {
    path: PathBuf,
    volume: f32,
}

#[derive(Clone, Debug)]
struct ProjectAudioConfig {
    system_volume: f32,
    microphone_volume: f32,
    system_muted: bool,
    microphone_muted: bool,
}

struct TranscriptionProgressCallbackState {
    app: AppHandle,
    progress_start: f64,
    progress_end: f64,
    progress_message: &'static str,
    last_emitted_progress: i32,
}

impl Default for ProjectAudioConfig {
    fn default() -> Self {
        Self {
            system_volume: 1.0,
            microphone_volume: 1.0,
            system_muted: false,
            microphone_muted: false,
        }
    }
}

fn reset_cancel_transcription() {
    TRANSCRIPTION_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
}

fn request_cancel_transcription() {
    TRANSCRIPTION_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

fn is_transcription_cancelled() -> bool {
    TRANSCRIPTION_CANCEL_REQUESTED.load(Ordering::SeqCst)
}

fn emit_transcription_progress(
    app: &AppHandle,
    stage: impl Into<String>,
    progress: f64,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "transcription-progress",
        TranscriptionProgress {
            stage: stage.into(),
            progress,
            message: message.into(),
        },
    );
}

fn emit_transcription_cancelled(app: &AppHandle, progress: f64) {
    emit_transcription_progress(app, "cancelled", progress, TRANSCRIPTION_CANCELLED_MESSAGE);
}

fn check_transcription_cancelled(app: &AppHandle, progress: f64) -> Result<(), String> {
    if is_transcription_cancelled() {
        emit_transcription_cancelled(app, progress);
        return Err(TRANSCRIPTION_CANCELLED_MESSAGE.to_string());
    }

    Ok(())
}

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

/// Request cancellation for the active transcription task.
#[tauri::command]
pub fn cancel_transcription() {
    request_cancel_transcription();
}

// ============================================================================
// Transcription
// ============================================================================

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Load or get cached Whisper context.
async fn get_whisper_context(model_path: &str) -> Result<Arc<WhisperContext>, String> {
    let mut ctx_guard = WHISPER_CONTEXT.lock().await;

    if let Some(ref cached) = *ctx_guard {
        if cached.model_path == model_path {
            return Ok(cached.context.clone());
        }
    }

    log::info!("Loading Whisper model: {}", model_path);

    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load model: {}", e))?;

    let ctx_arc = Arc::new(ctx);
    *ctx_guard = Some(CachedWhisperContext {
        model_path: model_path.to_string(),
        context: ctx_arc.clone(),
    });

    Ok(ctx_arc)
}

/// Check if a token is a special Whisper token that should be filtered.
fn is_special_token(text: &str) -> bool {
    let trimmed = text.trim();
    let is_musical_symbol = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|ch| matches!(ch, '♪' | '♫' | '♬' | '♩' | '♭' | '♯'));
    trimmed.is_empty()
        || is_musical_symbol
        || trimmed.contains('[')
        || trimmed.contains(']')
        || trimmed.contains("_TT_")
        || trimmed.contains("_BEG_")
        || trimmed.contains("<|")
}

fn is_cjk_char(ch: char) -> bool {
    matches!(
        ch,
        '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{3040}'..='\u{30FF}'
            | '\u{AC00}'..='\u{D7AF}'
    )
}

fn text_contains_inline_script(text: &str) -> bool {
    text.chars().any(is_cjk_char)
}

fn language_uses_inline_word_joining(language: &str) -> bool {
    matches!(
        language.trim().to_ascii_lowercase().as_str(),
        "zh" | "zh-cn" | "zh-tw" | "zh-hans" | "zh-hant" | "ja" | "ko"
    )
}

fn token_uses_inline_spacing(text: &str) -> bool {
    text.chars().any(is_cjk_char)
}

fn is_inline_punctuation(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|ch| !ch.is_ascii_alphanumeric() && !is_cjk_char(ch))
}

fn should_insert_space_between(left: &str, right: &str) -> bool {
    let left_char = left.chars().last();
    let right_char = right.chars().next();

    matches!(
        (left_char, right_char),
        (Some(l), Some(r)) if l.is_ascii_alphanumeric() && r.is_ascii_alphanumeric()
    )
}

fn join_caption_words(words: &[CaptionWord], inline_joining: bool) -> String {
    if !inline_joining {
        return words
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
    }

    let mut text = String::new();
    for word in words {
        if word.text.is_empty() {
            continue;
        }
        if !text.is_empty() && should_insert_space_between(&text, &word.text) {
            text.push(' ');
        }
        text.push_str(&word.text);
    }
    text
}

fn build_space_delimited_words(tokens: &[TimedToken]) -> Vec<CaptionWord> {
    let mut words = Vec::new();
    let mut current_word = String::new();
    let mut word_start: Option<f32> = None;
    let mut word_end = 0.0;

    for token in tokens {
        if token.raw_text.starts_with(' ') || token.raw_text.starts_with('\n') {
            if !current_word.trim().is_empty() {
                if let Some(start) = word_start {
                    words.push(CaptionWord {
                        text: current_word.trim().to_string(),
                        start,
                        end: word_end,
                    });
                }
            }

            current_word = token.text.clone();
            word_start = Some(token.start);
        } else {
            if word_start.is_none() {
                word_start = Some(token.start);
            }
            current_word.push_str(&token.text);
        }

        word_end = token.end;
    }

    if !current_word.trim().is_empty() {
        if let Some(start) = word_start {
            words.push(CaptionWord {
                text: current_word.trim().to_string(),
                start,
                end: word_end,
            });
        }
    }

    words
}

fn build_inline_words(tokens: &[TimedToken]) -> Vec<CaptionWord> {
    let mut words: Vec<CaptionWord> = Vec::new();

    for token in tokens {
        if token.text.is_empty() {
            continue;
        }

        if is_inline_punctuation(&token.text) {
            if let Some(previous_word) = words.last_mut() {
                previous_word.text.push_str(&token.text);
                previous_word.end = token.end;
            } else {
                words.push(CaptionWord {
                    text: token.text.clone(),
                    start: token.start,
                    end: token.end,
                });
            }
            continue;
        }

        words.push(CaptionWord {
            text: token.text.clone(),
            start: token.start,
            end: token.end,
        });
    }

    words
}

unsafe extern "C" fn transcription_abort_callback(user_data: *mut std::ffi::c_void) -> bool {
    let _ = user_data;
    TRANSCRIPTION_CANCEL_REQUESTED.load(Ordering::SeqCst)
}

unsafe extern "C" fn transcription_progress_callback(
    _ctx: *mut whisper_rs::WhisperSysContext,
    _state: *mut whisper_rs::WhisperSysState,
    progress: std::ffi::c_int,
    user_data: *mut std::ffi::c_void,
) {
    if user_data.is_null() {
        return;
    }

    let callback_state = unsafe { &mut *(user_data as *mut TranscriptionProgressCallbackState) };
    if progress == callback_state.last_emitted_progress {
        return;
    }

    callback_state.last_emitted_progress = progress;
    let normalized_progress = callback_state.progress_start
        + ((callback_state.progress_end - callback_state.progress_start) * f64::from(progress)
            / 100.0);
    emit_transcription_progress(
        &callback_state.app,
        "transcribing",
        normalized_progress,
        callback_state.progress_message,
    );
}

/// Process audio with Whisper and return caption segments.
fn process_with_whisper(
    samples: &[f32],
    context: Arc<WhisperContext>,
    language: &str,
    app: AppHandle,
    progress_start: f64,
    progress_end: f64,
    progress_message: &'static str,
) -> Result<Vec<CaptionSegment>, String> {
    log::info!(
        "Processing {} samples ({:.1}s)",
        samples.len(),
        samples.len() as f32 / WHISPER_SAMPLE_RATE as f32
    );

    let detect_language = language.trim().eq_ignore_ascii_case("auto");
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_token_timestamps(true);
    params.set_split_on_word(true);
    params.set_suppress_non_speech_tokens(true);
    params.set_detect_language(detect_language);
    params.set_language(if detect_language {
        None
    } else {
        Some(language.trim())
    });
    params.set_max_len(i32::MAX);
    let mut progress_callback_state = Box::new(TranscriptionProgressCallbackState {
        app: app.clone(),
        progress_start,
        progress_end,
        progress_message,
        last_emitted_progress: -1,
    });
    unsafe {
        params.set_progress_callback(Some(transcription_progress_callback));
        params.set_progress_callback_user_data(
            (&mut *progress_callback_state as *mut TranscriptionProgressCallbackState).cast(),
        );
        params.set_abort_callback(Some(transcription_abort_callback));
    }

    let mut state = context
        .create_state()
        .map_err(|e| format!("Failed to create state: {}", e))?;

    if let Err(error) = state.full(params, samples) {
        if is_transcription_cancelled() {
            return Err(TRANSCRIPTION_CANCELLED_MESSAGE.to_string());
        }

        return Err(format!("Transcription failed: {}", error));
    }

    check_transcription_cancelled(&app, progress_end)?;

    if let Ok(lang_id) = state.full_lang_id_from_state() {
        if let Some(lang) = whisper_rs::get_lang_str(lang_id) {
            log::info!("Whisper detected transcription language: {}", lang);
        }
    }

    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Failed to get segments: {}", e))?;

    log::info!("Found {} raw segments", num_segments);

    let mut segments = Vec::new();

    for i in 0..num_segments {
        if is_transcription_cancelled() {
            return Err(TRANSCRIPTION_CANCELLED_MESSAGE.to_string());
        }

        let segment_text = state
            .full_get_segment_text(i)
            .map_err(|e| format!("Failed to get text: {}", e))?;
        let start_t = state.full_get_segment_t0(i).unwrap_or(0) as f32 / 100.0;
        let end_t = state.full_get_segment_t1(i).unwrap_or(0) as f32 / 100.0;

        let num_tokens = state.full_n_tokens(i).unwrap_or(0);
        let mut tokens = Vec::new();

        for t in 0..num_tokens {
            let token_text = state.full_get_token_text(i, t).unwrap_or_default();

            if is_special_token(&token_text) {
                continue;
            }

            if let Ok(data) = state.full_get_token_data(i, t) {
                let t0 = data.t0 as f32 / 100.0;
                let t1 = data.t1 as f32 / 100.0;
                let cleaned = token_text.replace('\n', " ").trim().to_string();
                if cleaned.is_empty() {
                    continue;
                }

                tokens.push(TimedToken {
                    raw_text: token_text,
                    text: cleaned,
                    start: t0,
                    end: t1,
                });
            }
        }

        let inline_joining = language_uses_inline_word_joining(language)
            || text_contains_inline_script(&segment_text)
            || tokens
                .iter()
                .any(|token| token_uses_inline_spacing(&token.text));

        let words = if inline_joining {
            build_inline_words(&tokens)
        } else {
            build_space_delimited_words(&tokens)
        };

        if words.is_empty() {
            continue;
        }

        let max_words = if inline_joining {
            MAX_INLINE_WORDS_PER_SEGMENT
        } else {
            MAX_SPACE_DELIMITED_WORDS_PER_SEGMENT
        };

        for (chunk_idx, chunk) in words.chunks(max_words).enumerate() {
            let chunk_text = join_caption_words(chunk, inline_joining);
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

fn resolve_project_audio_path(parent: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        parent.join(path)
    }
}

fn read_project_audio_config(project: &serde_json::Value) -> ProjectAudioConfig {
    let Some(audio) = project.get("audio") else {
        return ProjectAudioConfig::default();
    };

    ProjectAudioConfig {
        system_volume: audio
            .get("systemVolume")
            .or_else(|| audio.get("system_volume"))
            .and_then(|value| value.as_f64())
            .unwrap_or(1.0) as f32,
        microphone_volume: audio
            .get("microphoneVolume")
            .or_else(|| audio.get("microphone_volume"))
            .and_then(|value| value.as_f64())
            .unwrap_or(1.0) as f32,
        system_muted: audio
            .get("systemMuted")
            .or_else(|| audio.get("system_muted"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        microphone_muted: audio
            .get("microphoneMuted")
            .or_else(|| audio.get("microphone_muted"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    }
}

fn push_project_audio_source(
    sources: &mut Vec<ProjectAudioSource>,
    label: &'static str,
    path: PathBuf,
    volume: f32,
) {
    if volume <= 0.0 || !path.exists() || sources.iter().any(|source| source.path == path) {
        return;
    }

    log::info!("Using {} audio for transcription: {:?}", label, path);
    sources.push(ProjectAudioSource { path, volume });
}

fn find_project_audio_sources(video_path: &Path) -> Vec<ProjectAudioSource> {
    let Some(parent) = video_path.parent() else {
        return Vec::new();
    };

    let mut microphone_sources = Vec::new();
    let mut system_sources = Vec::new();
    let mut config = ProjectAudioConfig::default();
    let mut legacy_audio_file: Option<PathBuf> = None;

    let project_json = parent.join("project.json");
    if project_json.exists() {
        if let Ok(content) = std::fs::read_to_string(&project_json) {
            if let Ok(project) = serde_json::from_str::<serde_json::Value>(&content) {
                config = read_project_audio_config(&project);

                if !config.system_muted {
                    if let Some(system) = project
                        .get("sources")
                        .and_then(|sources| {
                            sources
                                .get("systemAudio")
                                .or_else(|| sources.get("system_audio"))
                        })
                        .and_then(|value| value.as_str())
                    {
                        push_project_audio_source(
                            &mut system_sources,
                            "system",
                            resolve_project_audio_path(parent, system),
                            config.system_volume,
                        );
                    }
                }

                if !config.microphone_muted {
                    if let Some(mic) = project
                        .get("sources")
                        .and_then(|sources| {
                            sources
                                .get("microphoneAudio")
                                .or_else(|| sources.get("microphone_audio"))
                        })
                        .and_then(|value| value.as_str())
                    {
                        push_project_audio_source(
                            &mut microphone_sources,
                            "microphone",
                            resolve_project_audio_path(parent, mic),
                            config.microphone_volume,
                        );
                    }
                }

                legacy_audio_file = project
                    .get("sources")
                    .and_then(|sources| {
                        sources
                            .get("audioFile")
                            .or_else(|| sources.get("audio_file"))
                    })
                    .and_then(|value| value.as_str())
                    .map(|value| resolve_project_audio_path(parent, value));
            }
        }
    }

    if !config.system_muted {
        push_project_audio_source(
            &mut system_sources,
            "system",
            parent.join("system.wav"),
            config.system_volume,
        );
    }

    if !config.microphone_muted {
        push_project_audio_source(
            &mut microphone_sources,
            "microphone",
            parent.join("microphone.wav"),
            config.microphone_volume,
        );
    }

    if !microphone_sources.is_empty() {
        log::info!(
            "Preferring microphone audio for transcription over system audio to improve speech recognition"
        );
        return microphone_sources;
    }

    if !system_sources.is_empty() {
        return system_sources;
    }

    let mut sources = Vec::new();
    if let Some(audio_file) = legacy_audio_file {
        push_project_audio_source(&mut sources, "audio", audio_file, 1.0);
    }

    sources
}

fn prepare_project_audio_for_whisper(
    sources: &[ProjectAudioSource],
    temp_dir: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let mut prepared_sources = Vec::new();

    for (index, source) in sources.iter().enumerate() {
        let prepared_path = temp_dir.join(format!("prepared-source-{}.wav", index));
        audio::convert_to_whisper_format(&source.path, &prepared_path)?;
        prepared_sources.push((prepared_path, source.volume));
    }

    audio::mix_prepared_audio_for_whisper(&prepared_sources, output_path)
}

fn prepare_project_audio_range_for_whisper(
    sources: &[ProjectAudioSource],
    temp_dir: &Path,
    output_path: &Path,
    start_secs: f32,
    end_secs: f32,
) -> Result<(), String> {
    let mut prepared_sources = Vec::new();

    for (index, source) in sources.iter().enumerate() {
        let prepared_path = temp_dir.join(format!("prepared-range-source-{}.wav", index));
        audio::convert_range_to_whisper_format(&source.path, &prepared_path, start_secs, end_secs)?;
        prepared_sources.push((prepared_path, source.volume));
    }

    audio::mix_prepared_audio_for_whisper(&prepared_sources, output_path)
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
    reset_cancel_transcription();

    // Check model exists
    let model_info = check_whisper_model(app.clone(), model_name.clone()).await?;
    let model_path = model_info.path.ok_or("Model not downloaded")?;

    let video_path_pb = PathBuf::from(&video_path);

    // Create temp directory here so it stays alive until we're done with the audio file
    let temp_dir = tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let temp_audio = temp_dir.path().join("audio.wav");

    let project_audio_sources = find_project_audio_sources(&video_path_pb);

    // First, look for separate audio files (MoonSnap stores audio separately)
    if !project_audio_sources.is_empty() {
        emit_transcription_progress(&app, "loading_audio", 10.0, "Loading project audio...");

        // Always convert to 16kHz mono WAV for Whisper
        // Even WAV files might be at different sample rates (e.g., 48kHz)
        emit_transcription_progress(
            &app,
            "converting_audio",
            20.0,
            "Preparing audio for transcription...",
        );

        let project_audio_sources_clone = project_audio_sources.clone();
        let temp_dir_path = temp_dir.path().to_path_buf();
        let temp_audio_clone = temp_audio.clone();

        tokio::task::spawn_blocking(move || {
            prepare_project_audio_for_whisper(
                &project_audio_sources_clone,
                &temp_dir_path,
                &temp_audio_clone,
            )
        })
        .await
        .map_err(|e| format!("Task error: {}", e))??;
        check_transcription_cancelled(&app, 20.0)?;
    } else {
        // No separate audio - try extracting from video
        emit_transcription_progress(
            &app,
            "extracting_audio",
            0.0,
            "Extracting audio from video...",
        );

        let video_path_clone = video_path.clone();
        let temp_audio_clone = temp_audio.clone();

        tokio::task::spawn_blocking(move || {
            audio::extract_audio_for_whisper(
                std::path::Path::new(&video_path_clone),
                &temp_audio_clone,
            )
        })
        .await
        .map_err(|e| format!("Task error: {}", e))??;
        check_transcription_cancelled(&app, 45.0)?;
    }

    // temp_dir is still in scope here, so the audio file still exists
    let audio_path = temp_audio;

    // Emit progress: transcribing
    emit_transcription_progress(&app, "transcribing", 50.0, "Transcribing audio...");

    // Load audio samples
    let samples =
        audio::load_wav_as_f32(&audio_path).map_err(|e| format!("Failed to load audio: {}", e))?;
    check_transcription_cancelled(&app, 50.0)?;

    // Load Whisper and transcribe
    let context = get_whisper_context(&model_path).await?;
    let app_for_whisper = app.clone();

    let segments = tokio::task::spawn_blocking(move || {
        process_with_whisper(
            &samples,
            context,
            &language,
            app_for_whisper,
            50.0,
            95.0,
            "Transcribing audio...",
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Emit progress: complete
    emit_transcription_progress(&app, "complete", 100.0, "Transcription complete");

    Ok(CaptionData {
        segments,
        settings: CaptionSettings::default(),
    })
}

/// Re-transcribe a single caption segment time range.
#[tauri::command]
pub async fn transcribe_caption_segment(
    app: AppHandle,
    video_path: String,
    model_name: String,
    language: String,
    segment_start: f32,
    segment_end: f32,
) -> Result<CaptionSegment, String> {
    if !segment_start.is_finite() || !segment_end.is_finite() || segment_end <= segment_start {
        return Err("Invalid segment range".to_string());
    }
    reset_cancel_transcription();

    const PRE_CONTEXT_SECS: f32 = 0.75;
    const POST_CONTEXT_SECS: f32 = 0.75;
    let window_start = (segment_start - PRE_CONTEXT_SECS).max(0.0);
    let window_end = segment_end + POST_CONTEXT_SECS;

    log::info!(
        "Re-transcribing segment [{:.3}, {:.3}] (window [{:.3}, {:.3}]) for {} with model {}",
        segment_start,
        segment_end,
        window_start,
        window_end,
        video_path,
        model_name
    );

    // Check model exists
    let model_info = check_whisper_model(app.clone(), model_name.clone()).await?;
    let model_path = model_info.path.ok_or("Model not downloaded")?;

    let video_path_pb = PathBuf::from(&video_path);
    let temp_dir = tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let temp_audio = temp_dir.path().join("segment.wav");

    emit_transcription_progress(
        &app,
        "extracting_audio",
        20.0,
        "Extracting segment audio...",
    );

    let project_audio_sources = find_project_audio_sources(&video_path_pb);
    let temp_dir_path = temp_dir.path().to_path_buf();
    let temp_audio_clone = temp_audio.clone();
    tokio::task::spawn_blocking(move || {
        if project_audio_sources.is_empty() {
            audio::convert_range_to_whisper_format(
                &video_path_pb,
                &temp_audio_clone,
                window_start,
                window_end,
            )
        } else {
            prepare_project_audio_range_for_whisper(
                &project_audio_sources,
                &temp_dir_path,
                &temp_audio_clone,
                window_start,
                window_end,
            )
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;
    check_transcription_cancelled(&app, 40.0)?;

    emit_transcription_progress(&app, "transcribing", 60.0, "Transcribing segment...");

    let samples =
        audio::load_wav_as_f32(&temp_audio).map_err(|e| format!("Failed to load audio: {}", e))?;
    check_transcription_cancelled(&app, 60.0)?;
    let context = get_whisper_context(&model_path).await?;
    let language_clone = language.clone();
    let app_for_whisper = app.clone();
    let segment_groups = tokio::task::spawn_blocking(move || {
        process_with_whisper(
            &samples,
            context,
            &language_clone,
            app_for_whisper,
            60.0,
            95.0,
            "Transcribing segment...",
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    let mut words: Vec<CaptionWord> = segment_groups
        .into_iter()
        .flat_map(|segment| segment.words.into_iter())
        .collect();

    words.sort_by(|left, right| left.start.total_cmp(&right.start));
    for word in &mut words {
        word.start += window_start;
        word.end += window_start;
    }

    words.retain(|word| {
        let midpoint = (word.start + word.end) * 0.5;
        midpoint >= segment_start && midpoint <= segment_end
    });
    for word in &mut words {
        if word.start < segment_start {
            word.start = segment_start;
        }
        if word.end > segment_end {
            word.end = segment_end;
        }
    }
    words.retain(|word| word.end > word.start);

    if words.is_empty() {
        return Err("No speech detected in this segment.".to_string());
    }

    let inline_joining = language_uses_inline_word_joining(&language)
        || words
            .iter()
            .any(|word| text_contains_inline_script(&word.text));
    let text = join_caption_words(&words, inline_joining);

    emit_transcription_progress(&app, "complete", 100.0, "Segment transcription complete");

    Ok(CaptionSegment {
        id: format!(
            "segment-regen-{}-{}",
            (segment_start * 1000.0).round() as i64,
            (segment_end * 1000.0).round() as i64
        ),
        start: segment_start,
        end: segment_end,
        text,
        words,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_caption_words_skips_spaces_for_cjk() {
        let words = vec![
            CaptionWord {
                text: "中".to_string(),
                start: 0.0,
                end: 0.1,
            },
            CaptionWord {
                text: "文".to_string(),
                start: 0.1,
                end: 0.2,
            },
            CaptionWord {
                text: "字幕".to_string(),
                start: 0.2,
                end: 0.4,
            },
        ];

        assert_eq!(join_caption_words(&words, true), "中文字幕");
    }

    #[test]
    fn join_caption_words_keeps_spaces_between_ascii_words() {
        let words = vec![
            CaptionWord {
                text: "OpenAI".to_string(),
                start: 0.0,
                end: 0.2,
            },
            CaptionWord {
                text: "captions".to_string(),
                start: 0.2,
                end: 0.4,
            },
            CaptionWord {
                text: "中文".to_string(),
                start: 0.4,
                end: 0.6,
            },
        ];

        assert_eq!(join_caption_words(&words, true), "OpenAI captions中文");
    }

    #[test]
    fn find_project_audio_sources_prefers_microphone_when_available() {
        let temp_dir = tempfile::tempdir().unwrap();
        let video_path = temp_dir.path().join("screen.mp4");
        let system_path = temp_dir.path().join("sys-track.wav");
        let mic_path = temp_dir.path().join("mic-track.wav");

        std::fs::write(&video_path, b"").unwrap();
        std::fs::write(&system_path, b"").unwrap();
        std::fs::write(&mic_path, b"").unwrap();
        std::fs::write(
            temp_dir.path().join("project.json"),
            serde_json::json!({
                "sources": {
                    "systemAudio": "sys-track.wav",
                    "microphoneAudio": "mic-track.wav",
                },
                "audio": {
                    "systemVolume": 0.8,
                    "microphoneVolume": 0.5,
                    "systemMuted": false,
                    "microphoneMuted": false,
                }
            })
            .to_string(),
        )
        .unwrap();

        let sources = find_project_audio_sources(&video_path);

        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].path, mic_path);
        assert!((sources[0].volume - 0.5).abs() < f32::EPSILON);
        assert!(system_path.exists());
    }

    #[test]
    fn cancel_transcription_flag_roundtrips() {
        reset_cancel_transcription();
        assert!(!is_transcription_cancelled());

        request_cancel_transcription();
        assert!(is_transcription_cancelled());

        reset_cancel_transcription();
        assert!(!is_transcription_cancelled());
    }
}

// ============================================================================
// Caption Persistence
// ============================================================================

/// Get the captions file path for a video project.
fn get_captions_path(video_path: &str) -> PathBuf {
    let video_path = PathBuf::from(video_path);
    let parent = video_path.parent().unwrap_or(&video_path);
    let stem = video_path.file_stem().unwrap_or_default();
    parent.join(format!("{}-captions.json", stem.to_string_lossy()))
}

/// Save caption data to a JSON file.
#[tauri::command]
pub async fn save_caption_data(video_path: String, data: CaptionData) -> Result<(), String> {
    let captions_path = get_captions_path(&video_path);

    log::info!("Saving captions to: {:?}", captions_path);

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize captions: {}", e))?;

    tokio::fs::write(&captions_path, json)
        .await
        .map_err(|e| format!("Failed to write captions file: {}", e))?;

    Ok(())
}

/// Load caption data from a JSON file.
#[tauri::command]
pub async fn load_caption_data(video_path: String) -> Result<Option<CaptionData>, String> {
    let captions_path = get_captions_path(&video_path);

    if !captions_path.exists() {
        return Ok(None);
    }

    log::info!("Loading captions from: {:?}", captions_path);

    let json = tokio::fs::read_to_string(&captions_path)
        .await
        .map_err(|e| format!("Failed to read captions file: {}", e))?;

    let data: CaptionData =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse captions: {}", e))?;

    Ok(Some(data))
}
