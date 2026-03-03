//! FFmpeg encoder setup and helpers.

use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};

use moonsnap_domain::video_export::{ExportProgress, ExportStage};
use moonsnap_export::encoder_selection::select_encoder_with_probe;
use moonsnap_export::ffmpeg_plan::{
    build_encoder_args, collect_source_audio_segments, prepare_audio_input_request,
    EncoderArgsBuildRequest,
};
use moonsnap_export::temp_file::stage_embedded_temp_file;
use tauri::{AppHandle, Emitter};

use moonsnap_domain::video_project::{ExportFormat, VideoProject};

const TYPEWRITER_LOOP_AUDIO_BYTES: &[u8] =
    include_bytes!("../../../../public/sounds/fast_typing_loop_001.wav");
const TYPEWRITER_LOOP_AUDIO_FILE_NAME: &str = "moonsnap_fast_typing_loop_001.wav";

fn ensure_typewriter_loop_sound_file() -> Result<PathBuf, String> {
    stage_embedded_temp_file(TYPEWRITER_LOOP_AUDIO_FILE_NAME, TYPEWRITER_LOOP_AUDIO_BYTES)
}

/// Start FFmpeg process for encoding raw RGBA input.
pub fn start_ffmpeg_encoder(
    project: &VideoProject,
    output_path: &Path,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<Child, String> {
    let ffmpeg_path = moonsnap_media::ffmpeg::find_ffmpeg().ok_or("FFmpeg not found")?;

    // Track audio inputs for filter graph. Input 0 is always video (stdin).
    let audio_input_request = prepare_audio_input_request(project, 1, || {
        Ok(ensure_typewriter_loop_sound_file()?
            .to_string_lossy()
            .to_string())
    })?;
    let mp4_encoder_config = if matches!(project.export.format, ExportFormat::Mp4) {
        let prefer_hardware = project.export.prefer_hardware_encoding.unwrap_or(false);
        let encoder_config = select_encoder_with_probe(
            &ffmpeg_path,
            project.export.quality,
            prefer_hardware,
            moonsnap_export::ffmpeg_plan::quality_to_crf(project.export.quality),
        );
        log::info!(
            "[EXPORT] Encoder: {} (preset: {}, {}: {})",
            encoder_config.codec,
            encoder_config.preset,
            encoder_config.quality_param,
            encoder_config.quality_value
        );
        Some(encoder_config)
    } else {
        None
    };

    let args = build_encoder_args(&EncoderArgsBuildRequest {
        width,
        height,
        fps,
        output_path: output_path.to_string_lossy().to_string(),
        format: project.export.format,
        quality: project.export.quality,
        mp4_encoder_config,
        audio_input_request,
        source_audio_segments: collect_source_audio_segments(project),
    })?;

    log::info!("[EXPORT] FFmpeg encoder: ffmpeg {}", args.join(" "));

    moonsnap_media::ffmpeg::create_hidden_command(&ffmpeg_path)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg: {}", e))
}

/// Emit export progress event to frontend.
pub fn emit_progress(app: &AppHandle, progress: f32, stage: ExportStage, message: &str) {
    let _ = app.emit(
        "export-progress",
        ExportProgress {
            progress,
            stage,
            message: message.to_string(),
        },
    );
}
