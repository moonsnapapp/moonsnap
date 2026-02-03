//! FFmpeg encoder setup and helpers.

use std::path::Path;
use std::process::{Child, Stdio};

use tauri::{AppHandle, Emitter};

use crate::commands::video_recording::video_export::{ExportProgress, ExportStage};
use crate::commands::video_recording::video_project::{ExportFormat, VideoProject};

use super::encoder_selection::{select_encoder, EncoderType};

/// Audio input info for building ffmpeg filter.
struct AudioInput {
    input_index: usize,
    volume: f32,
}

/// Segment info for audio trimming (in seconds for FFmpeg).
struct AudioSegment {
    start_sec: f64,
    end_sec: f64,
}

/// Start FFmpeg process for encoding raw RGBA input.
pub fn start_ffmpeg_encoder(
    project: &VideoProject,
    output_path: &Path,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<Child, String> {
    let ffmpeg_path = crate::commands::storage::find_ffmpeg().ok_or("FFmpeg not found")?;

    let mut args = vec![
        "-y".to_string(),
        // Raw RGBA input from stdin
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-s".to_string(),
        format!("{}x{}", width, height),
        "-r".to_string(),
        fps.to_string(),
        "-i".to_string(),
        "-".to_string(),
    ];

    // Track audio inputs for filter graph
    // Input 0 is always video (stdin)
    let mut audio_inputs: Vec<AudioInput> = Vec::new();
    let mut next_input_index = 1;

    // Add system audio if available and not muted
    if let Some(ref audio_path) = project.sources.system_audio {
        if Path::new(audio_path).exists() && !project.audio.system_muted {
            args.extend(["-i".to_string(), audio_path.clone()]);
            audio_inputs.push(AudioInput {
                input_index: next_input_index,
                volume: project.audio.system_volume,
            });
            next_input_index += 1;
        }
    }

    // Add microphone audio if available and not muted
    if let Some(ref mic_path) = project.sources.microphone_audio {
        if Path::new(mic_path).exists() && !project.audio.microphone_muted {
            args.extend(["-i".to_string(), mic_path.clone()]);
            audio_inputs.push(AudioInput {
                input_index: next_input_index,
                volume: project.audio.microphone_volume,
            });
            // next_input_index += 1; // Uncomment when adding more audio sources
        }
    }

    // Build audio filter graph if we have audio inputs
    // Convert segments to audio segments (ms -> seconds) for FFmpeg
    // If no segments, use in_point/out_point as a single segment
    let audio_segments: Vec<AudioSegment> = if project.timeline.segments.is_empty() {
        // No cuts - use in_point/out_point (single segment)
        vec![AudioSegment {
            start_sec: project.timeline.in_point as f64 / 1000.0,
            end_sec: project.timeline.out_point as f64 / 1000.0,
        }]
    } else {
        // Use the trim segments
        project
            .timeline
            .segments
            .iter()
            .map(|s| AudioSegment {
                start_sec: s.source_start_ms as f64 / 1000.0,
                end_sec: s.source_end_ms as f64 / 1000.0,
            })
            .collect()
    };
    let audio_filter = build_audio_filter(&audio_inputs, &audio_segments);

    // Output encoding based on format
    match project.export.format {
        ExportFormat::Mp4 => {
            // Select encoder (NVENC if available and preferred, otherwise x264)
            let prefer_hardware = project.export.prefer_hardware_encoding.unwrap_or(false);
            let encoder_config =
                select_encoder(&ffmpeg_path, project.export.quality, prefer_hardware);

            args.extend([
                "-c:v".to_string(),
                encoder_config.codec.clone(),
                encoder_config.quality_param.clone(),
                encoder_config.quality_value.to_string(),
                "-preset".to_string(),
                encoder_config.preset.clone(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                // Keyframe every 1 second for precise seeking
                "-g".to_string(),
                fps.to_string(),
                // Move moov atom to start for fast playback start
                "-movflags".to_string(),
                "+faststart".to_string(),
            ]);

            // Encoder-specific optimizations
            if encoder_config.encoder_type == EncoderType::Nvenc {
                // NVENC: add b-frames and lookahead for better quality
                args.extend([
                    "-bf".to_string(),
                    "2".to_string(),
                    "-rc-lookahead".to_string(),
                    "20".to_string(),
                ]);
            } else {
                // x264: enable multi-threaded encoding for better CPU utilization
                args.extend([
                    "-threads".to_string(),
                    "0".to_string(), // Auto-detect CPU cores
                    "-x264-params".to_string(),
                    "threads=auto:lookahead_threads=auto".to_string(),
                ]);
            }

            log::info!(
                "[EXPORT] Encoder: {} (preset: {}, {}: {})",
                encoder_config.codec,
                encoder_config.preset,
                encoder_config.quality_param,
                encoder_config.quality_value
            );

            if !audio_inputs.is_empty() {
                if let Some(ref filter) = audio_filter {
                    args.extend(["-filter_complex".to_string(), filter.clone()]);
                    args.extend(["-map".to_string(), "0:v".to_string()]);
                    args.extend(["-map".to_string(), "[aout]".to_string()]);
                }
                args.extend([
                    "-c:a".to_string(),
                    "aac".to_string(),
                    "-b:a".to_string(),
                    "192k".to_string(),
                    "-shortest".to_string(),
                ]);
            }
        },
        ExportFormat::Webm => {
            let crf = quality_to_crf(project.export.quality);
            args.extend([
                "-c:v".to_string(),
                "libvpx-vp9".to_string(),
                "-crf".to_string(),
                crf.to_string(),
                "-b:v".to_string(),
                "0".to_string(),
                "-deadline".to_string(),
                "realtime".to_string(),
                "-cpu-used".to_string(),
                "4".to_string(),
                // Keyframe every 1 second for precise seeking
                "-g".to_string(),
                fps.to_string(),
            ]);
            if !audio_inputs.is_empty() {
                if let Some(ref filter) = audio_filter {
                    args.extend(["-filter_complex".to_string(), filter.clone()]);
                    args.extend(["-map".to_string(), "0:v".to_string()]);
                    args.extend(["-map".to_string(), "[aout]".to_string()]);
                }
                args.extend([
                    "-c:a".to_string(),
                    "libopus".to_string(),
                    "-b:a".to_string(),
                    "128k".to_string(),
                ]);
            }
        },
        ExportFormat::Gif => {
            args.extend([
                "-vf".to_string(),
                format!(
                    "fps={},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                    fps.min(15)
                ),
            ]);
        },
    }

    args.push(output_path.to_string_lossy().to_string());

    log::info!("[EXPORT] FFmpeg encoder: ffmpeg {}", args.join(" "));

    crate::commands::storage::ffmpeg::create_hidden_command(&ffmpeg_path)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start FFmpeg: {}", e))
}

/// Build audio filter graph for mixing multiple audio tracks with volume control.
/// Trims audio to match the kept segments and concatenates them.
/// Returns None if no audio inputs, otherwise returns the filter string.
fn build_audio_filter(audio_inputs: &[AudioInput], segments: &[AudioSegment]) -> Option<String> {
    if audio_inputs.is_empty() || segments.is_empty() {
        return None;
    }

    // Build segment-aware filter that trims and concatenates audio portions
    let mut filter_parts: Vec<String> = Vec::new();
    let mut final_labels: Vec<String> = Vec::new();

    for (input_idx, input) in audio_inputs.iter().enumerate() {
        let mut segment_labels: Vec<String> = Vec::new();

        // Create atrim filter for each segment
        for (seg_idx, segment) in segments.iter().enumerate() {
            let label = format!("a{}s{}", input_idx, seg_idx);
            // atrim extracts the segment, asetpts resets timestamps to start from 0
            filter_parts.push(format!(
                "[{}:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[{}]",
                input.input_index, segment.start_sec, segment.end_sec, label
            ));
            segment_labels.push(format!("[{}]", label));
        }

        // Concatenate all segments for this audio track
        let concat_label = format!("a{}_concat", input_idx);
        if segment_labels.len() > 1 {
            filter_parts.push(format!(
                "{}concat=n={}:v=0:a=1[{}]",
                segment_labels.join(""),
                segment_labels.len(),
                concat_label
            ));
        } else {
            // Only one segment - just rename the label
            let single_label = &segment_labels[0];
            // Extract label name without brackets
            let inner_label = &single_label[1..single_label.len() - 1];
            filter_parts.push(format!("[{}]anull[{}]", inner_label, concat_label));
        }

        // Apply volume to the concatenated audio
        let vol_label = format!("a{}_vol", input_idx);
        filter_parts.push(format!(
            "[{}]volume={:.2}[{}]",
            concat_label, input.volume, vol_label
        ));
        final_labels.push(format!("[{}]", vol_label));
    }

    // Mix all audio tracks if multiple, otherwise just rename to aout
    if final_labels.len() > 1 {
        filter_parts.push(format!(
            "{}amix=inputs={}:duration=longest[aout]",
            final_labels.join(""),
            final_labels.len()
        ));
    } else {
        // Single track - rename to aout
        let single_label = &final_labels[0];
        let inner_label = &single_label[1..single_label.len() - 1];
        filter_parts.push(format!("[{}]anull[aout]", inner_label));
    }

    log::info!(
        "[EXPORT] Audio filter with {} segment(s): {}",
        segments.len(),
        filter_parts.join(";")
    );

    Some(filter_parts.join(";"))
}

/// Convert quality percentage to CRF value.
pub fn quality_to_crf(quality: u32) -> u8 {
    (35 - ((quality as f32 / 100.0) * 20.0) as u8).clamp(15, 35)
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
