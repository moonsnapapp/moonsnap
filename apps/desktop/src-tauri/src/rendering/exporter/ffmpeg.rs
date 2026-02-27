//! FFmpeg encoder setup and helpers.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};

use tauri::{AppHandle, Emitter};

use crate::commands::video_recording::video_export::{ExportProgress, ExportStage};
use crate::commands::video_recording::video_project::{ExportFormat, TextAnimation, VideoProject};

use super::encoder_selection::{select_encoder, EncoderType};

const TYPEWRITER_LOOP_AUDIO_BYTES: &[u8] =
    include_bytes!("../../../../public/sounds/fast_typing_loop_001.wav");
const TYPEWRITER_LOOP_AUDIO_FILE_NAME: &str = "snapit_fast_typing_loop_001.wav";

/// Audio input info for building ffmpeg filter.
struct AudioInput {
    input_index: usize,
    volume: f32,
    source: AudioInputSource,
}

/// How a given audio input should be aligned in the export timeline.
enum AudioInputSource {
    /// Source-timeline audio (system/mic) that must follow kept trim segments.
    SourceTrack,
    /// Timeline-space windows (already in edited timeline coordinates).
    TimelineWindows(Vec<AudioSegment>),
}

/// Segment info for audio trimming (in seconds for FFmpeg).
#[derive(Clone, Copy)]
struct AudioSegment {
    start_sec: f64,
    end_sec: f64,
}

fn ensure_typewriter_loop_sound_file() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(TYPEWRITER_LOOP_AUDIO_FILE_NAME);
    fs::write(&path, TYPEWRITER_LOOP_AUDIO_BYTES).map_err(|e| {
        format!(
            "Failed to stage typewriter loop audio at {}: {}",
            path.display(),
            e
        )
    })?;
    Ok(path)
}

fn calculate_typewriter_typing_window_secs(
    segment_start_sec: f64,
    segment_end_sec: f64,
    fade_duration_sec: f64,
) -> f64 {
    let segment_duration = (segment_end_sec - segment_start_sec).max(0.0);
    let fade_duration = fade_duration_sec.max(0.0);
    let has_fade_out_window = fade_duration > 0.0 && segment_duration > fade_duration * 2.0;
    let outro_duration = if has_fade_out_window {
        fade_duration
    } else {
        0.0
    };
    (segment_duration - outro_duration).max(0.0)
}

fn calculate_effective_typewriter_chars_per_second(
    requested_chars_per_second: f32,
    total_chars: usize,
    typing_window_secs: f64,
) -> f64 {
    let requested = requested_chars_per_second.clamp(1.0, 60.0) as f64;
    if total_chars == 0 || typing_window_secs <= 0.0 {
        return requested;
    }

    let minimum_required = total_chars as f64 / typing_window_secs;
    requested.max(minimum_required)
}

fn calculate_typewriter_sound_end_sec(
    segment_start_sec: f64,
    segment_end_sec: f64,
    fade_duration_sec: f64,
    requested_chars_per_second: f32,
    total_chars: usize,
) -> f64 {
    if total_chars == 0 {
        return segment_start_sec;
    }

    let typing_window_secs = calculate_typewriter_typing_window_secs(
        segment_start_sec,
        segment_end_sec,
        fade_duration_sec,
    );
    let chars_per_second = calculate_effective_typewriter_chars_per_second(
        requested_chars_per_second,
        total_chars,
        typing_window_secs,
    );
    if chars_per_second <= 0.0 {
        return segment_end_sec;
    }

    let reveal_duration_sec = total_chars as f64 / chars_per_second;
    let capped_reveal_duration_sec = if typing_window_secs > 0.0 {
        reveal_duration_sec.min(typing_window_secs)
    } else {
        reveal_duration_sec
    };

    (segment_start_sec + capped_reveal_duration_sec).min(segment_end_sec)
}

fn collect_typewriter_sound_segments(project: &VideoProject) -> Vec<AudioSegment> {
    let mut segments: Vec<AudioSegment> = project
        .text
        .segments
        .iter()
        .filter(|segment| {
            segment.enabled
                && segment.animation == TextAnimation::TypeWriter
                && segment.typewriter_sound_enabled
        })
        .filter_map(|segment| {
            let start_sec = segment.start.max(0.0);
            let total_chars = segment.content.chars().count();
            let end_sec = calculate_typewriter_sound_end_sec(
                start_sec,
                segment.end.max(start_sec),
                segment.fade_duration,
                segment.typewriter_chars_per_second,
                total_chars,
            );
            if end_sec <= start_sec {
                return None;
            }
            Some(AudioSegment { start_sec, end_sec })
        })
        .collect();

    segments.sort_by(|a, b| {
        a.start_sec
            .partial_cmp(&b.start_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    segments
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
                source: AudioInputSource::SourceTrack,
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
                source: AudioInputSource::SourceTrack,
            });
            next_input_index += 1;
        }
    }

    // Add typewriter effect loop audio on segments that opt-in.
    if !project.audio.system_muted && project.audio.system_volume > 0.0 {
        let typewriter_sound_segments = collect_typewriter_sound_segments(project);
        if !typewriter_sound_segments.is_empty() {
            let staged_path = ensure_typewriter_loop_sound_file()?;
            args.extend([
                "-stream_loop".to_string(),
                "-1".to_string(),
                "-i".to_string(),
                staged_path.to_string_lossy().to_string(),
            ]);
            audio_inputs.push(AudioInput {
                input_index: next_input_index,
                volume: project.audio.system_volume,
                source: AudioInputSource::TimelineWindows(typewriter_sound_segments),
            });
            next_input_index += 1;
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

            if let Some(ref filter) = audio_filter {
                args.extend(["-filter_complex".to_string(), filter.clone()]);
                args.extend(["-map".to_string(), "0:v".to_string()]);
                args.extend(["-map".to_string(), "[aout]".to_string()]);
                args.extend([
                    "-c:a".to_string(),
                    "aac".to_string(),
                    "-b:a".to_string(),
                    "192k".to_string(),
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
            if let Some(ref filter) = audio_filter {
                args.extend(["-filter_complex".to_string(), filter.clone()]);
                args.extend(["-map".to_string(), "0:v".to_string()]);
                args.extend(["-map".to_string(), "[aout]".to_string()]);
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
/// Source tracks are trimmed to kept segments; timeline tracks use absolute windows.
/// Returns None when no usable audio graph can be built.
fn build_audio_filter(
    audio_inputs: &[AudioInput],
    source_segments: &[AudioSegment],
) -> Option<String> {
    if audio_inputs.is_empty() {
        return None;
    }

    let mut filter_parts: Vec<String> = Vec::new();
    let mut final_labels: Vec<String> = Vec::new();

    for (input_idx, input) in audio_inputs.iter().enumerate() {
        let base_label = format!("a{}_base", input_idx);
        let mut has_base_stream = false;

        match &input.source {
            AudioInputSource::SourceTrack => {
                if source_segments.is_empty() {
                    continue;
                }

                let mut segment_labels: Vec<String> = Vec::new();
                for (seg_idx, segment) in source_segments.iter().enumerate() {
                    let label = format!("a{}s{}", input_idx, seg_idx);
                    filter_parts.push(format!(
                        "[{}:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS[{}]",
                        input.input_index, segment.start_sec, segment.end_sec, label
                    ));
                    segment_labels.push(format!("[{}]", label));
                }

                if segment_labels.len() > 1 {
                    filter_parts.push(format!(
                        "{}concat=n={}:v=0:a=1[{}]",
                        segment_labels.join(""),
                        segment_labels.len(),
                        base_label
                    ));
                } else if let Some(single_label) = segment_labels.first() {
                    let inner_label = &single_label[1..single_label.len() - 1];
                    filter_parts.push(format!("[{}]anull[{}]", inner_label, base_label));
                }
                has_base_stream = true;
            },
            AudioInputSource::TimelineWindows(windows) => {
                // Filter to valid windows (positive duration).
                let valid_windows: Vec<(usize, &AudioSegment)> = windows
                    .iter()
                    .enumerate()
                    .filter(|(_, w)| (w.end_sec - w.start_sec) > 0.0)
                    .collect();

                if valid_windows.is_empty() {
                    continue;
                }

                if valid_windows.len() == 1 {
                    // Single window: use adelay (simple, no sync issues).
                    let (window_idx, window) = valid_windows[0];
                    let duration_sec = window.end_sec - window.start_sec;
                    let delay_ms = (window.start_sec.max(0.0) * 1000.0).round() as u64;
                    let label = format!("a{}w{}", input_idx, window_idx);
                    filter_parts.push(format!(
                        "[{}:a]atrim=start=0:end={:.3},asetpts=PTS-STARTPTS,adelay={}:all=1[{}]",
                        input.input_index, duration_sec, delay_ms, label
                    ));
                    filter_parts.push(format!("[{}]anull[{}]", label, base_label));
                } else {
                    // Multiple non-overlapping windows: use concat with silence
                    // gaps instead of amix. amix processes all inputs in parallel
                    // which creates synchronization overhead in FFmpeg's filter
                    // graph; concat processes them sequentially.
                    // Silence gaps use the same audio source (muted) to guarantee
                    // format compatibility for concat.
                    let mut concat_labels: Vec<String> = Vec::new();
                    let mut prev_end = 0.0_f64;

                    for (window_idx, window) in &valid_windows {
                        let duration_sec = window.end_sec - window.start_sec;

                        // Silence gap before this window (same source, muted).
                        let gap = window.start_sec - prev_end;
                        if gap > 0.001 {
                            let gap_label = format!("a{}g{}", input_idx, window_idx);
                            filter_parts.push(format!(
                                "[{}:a]atrim=start=0:end={:.3},volume=0,asetpts=PTS-STARTPTS[{}]",
                                input.input_index, gap, gap_label
                            ));
                            concat_labels.push(format!("[{}]", gap_label));
                        }

                        let label = format!("a{}w{}", input_idx, window_idx);
                        filter_parts.push(format!(
                            "[{}:a]atrim=start=0:end={:.3},asetpts=PTS-STARTPTS[{}]",
                            input.input_index, duration_sec, label
                        ));
                        concat_labels.push(format!("[{}]", label));

                        prev_end = window.end_sec;
                    }

                    filter_parts.push(format!(
                        "{}concat=n={}:v=0:a=1[{}]",
                        concat_labels.join(""),
                        concat_labels.len(),
                        base_label
                    ));
                }
                has_base_stream = true;
            },
        }

        if !has_base_stream {
            continue;
        }

        let vol_label = format!("a{}_vol", input_idx);
        filter_parts.push(format!(
            "[{}]volume={:.2}[{}]",
            base_label, input.volume, vol_label
        ));
        final_labels.push(format!("[{}]", vol_label));
    }

    if final_labels.is_empty() {
        return None;
    }

    // Mix all audio tracks if multiple, otherwise just rename to aout_raw.
    // normalize=0: each track already has its own volume control applied,
    // so we don't want amix to divide by N (which halves volume with 2 tracks).
    if final_labels.len() > 1 {
        filter_parts.push(format!(
            "{}amix=inputs={}:duration=longest:normalize=0[aout_raw]",
            final_labels.join(""),
            final_labels.len()
        ));
    } else {
        // Single track - rename to aout_raw
        let single_label = &final_labels[0];
        let inner_label = &single_label[1..single_label.len() - 1];
        filter_parts.push(format!("[{}]anull[aout_raw]", inner_label));
    }

    // Pad with silence so sparse SFX tracks don't truncate the video when using -shortest.
    // Must specify whole_dur so apad doesn't produce infinite audio.
    let total_dur: f64 = source_segments
        .iter()
        .map(|s| s.end_sec - s.start_sec)
        .sum();
    filter_parts.push(format!("[aout_raw]apad=whole_dur={:.3}[aout]", total_dur));

    log::info!(
        "[EXPORT] Audio filter with {} track(s): {}",
        final_labels.len(),
        filter_parts.join(";")
    );

    Some(filter_parts.join(";"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_source_audio_filter() {
        let inputs = vec![AudioInput {
            input_index: 1,
            volume: 0.8,
            source: AudioInputSource::SourceTrack,
        }];
        let segments = vec![AudioSegment {
            start_sec: 1.0,
            end_sec: 3.0,
        }];

        let filter = build_audio_filter(&inputs, &segments).expect("filter should be built");
        assert!(filter.contains("[1:a]atrim=start=1.000:end=3.000"));
        assert!(filter.contains("volume=0.80"));
        assert!(filter.contains("apad=whole_dur=2.000[aout]"));
    }

    #[test]
    fn builds_timeline_window_audio_filter() {
        let inputs = vec![AudioInput {
            input_index: 2,
            volume: 1.0,
            source: AudioInputSource::TimelineWindows(vec![
                AudioSegment {
                    start_sec: 0.5,
                    end_sec: 1.5,
                },
                AudioSegment {
                    start_sec: 2.0,
                    end_sec: 2.4,
                },
            ]),
        }];
        let segments = vec![AudioSegment {
            start_sec: 0.0,
            end_sec: 3.0,
        }];

        let filter = build_audio_filter(&inputs, &segments).expect("filter should be built");
        // Multiple windows use concat with silence gaps (no amix/adelay).
        // Gap before first window (0.5s silence, muted from same source)
        assert!(filter.contains("atrim=start=0:end=0.500,volume=0"));
        // First window (1.0s audio)
        assert!(filter.contains("atrim=start=0:end=1.000,asetpts=PTS-STARTPTS[a0w0]"));
        // Gap between windows (0.5s silence)
        assert!(filter.contains("atrim=start=0:end=0.500,volume=0,asetpts=PTS-STARTPTS[a0g1]"));
        // Second window (0.4s audio)
        assert!(filter.contains("atrim=start=0:end=0.400,asetpts=PTS-STARTPTS[a0w1]"));
        // Concatenated (4 segments: gap + w0 + gap + w1)
        assert!(filter.contains("concat=n=4:v=0:a=1"));
        assert!(filter.contains("apad=whole_dur=3.000[aout]"));
    }

    #[test]
    fn builds_single_timeline_window_audio_filter() {
        let inputs = vec![AudioInput {
            input_index: 2,
            volume: 1.0,
            source: AudioInputSource::TimelineWindows(vec![AudioSegment {
                start_sec: 0.5,
                end_sec: 1.5,
            }]),
        }];
        let segments = vec![AudioSegment {
            start_sec: 0.0,
            end_sec: 3.0,
        }];

        let filter = build_audio_filter(&inputs, &segments).expect("filter should be built");
        // Single window uses adelay (simpler, no concat needed).
        assert!(filter.contains("atrim=start=0:end=1.000"));
        assert!(filter.contains("adelay=500:all=1"));
        assert!(!filter.contains("concat"));
        assert!(filter.contains("apad=whole_dur=3.000[aout]"));
    }
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
