//! FFmpeg argument planning helpers for export pipelines.

use snapit_domain::video_project::{ExportFormat, TextAnimation, VideoProject};

use crate::encoder_selection::{EncoderConfig, EncoderType};

/// Audio input info for building ffmpeg filter.
#[derive(Debug, Clone)]
pub struct AudioInput {
    pub input_index: usize,
    pub volume: f32,
    pub source: AudioInputSource,
}

/// How a given audio input should be aligned in the export timeline.
#[derive(Debug, Clone)]
pub enum AudioInputSource {
    /// Source-timeline audio (system/mic) that must follow kept trim segments.
    SourceTrack,
    /// Timeline-space windows (already in edited timeline coordinates).
    TimelineWindows(Vec<AudioSegment>),
}

/// Segment info for audio trimming (in seconds for FFmpeg).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioSegment {
    pub start_sec: f64,
    pub end_sec: f64,
}

/// Inputs used to build ffmpeg audio `-i` args and filter-graph sources.
#[derive(Debug, Clone, Default)]
pub struct AudioInputBuildRequest {
    pub start_input_index: usize,
    pub system_audio_path: Option<String>,
    pub microphone_audio_path: Option<String>,
    pub typewriter_loop_audio_path: Option<String>,
    pub typewriter_windows: Vec<AudioSegment>,
    pub system_muted: bool,
    pub microphone_muted: bool,
    pub system_volume: f32,
    pub microphone_volume: f32,
}

/// Build audio-input request from project settings.
///
/// `stage_typewriter_loop_audio` is called only when typewriter sound windows
/// exist and system audio is eligible for export.
pub fn prepare_audio_input_request<F>(
    project: &VideoProject,
    start_input_index: usize,
    mut stage_typewriter_loop_audio: F,
) -> Result<AudioInputBuildRequest, String>
where
    F: FnMut() -> Result<String, String>,
{
    let system_audio_path = project
        .sources
        .system_audio
        .as_ref()
        .filter(|p| std::path::Path::new(p).exists())
        .cloned();
    let microphone_audio_path = project
        .sources
        .microphone_audio
        .as_ref()
        .filter(|p| std::path::Path::new(p).exists())
        .cloned();

    let typewriter_windows = if !project.audio.system_muted && project.audio.system_volume > 0.0 {
        collect_typewriter_sound_segments(project)
    } else {
        Vec::new()
    };
    let typewriter_loop_audio_path = if typewriter_windows.is_empty() {
        None
    } else {
        Some(stage_typewriter_loop_audio()?)
    };

    Ok(AudioInputBuildRequest {
        start_input_index,
        system_audio_path,
        microphone_audio_path,
        typewriter_loop_audio_path,
        typewriter_windows,
        system_muted: project.audio.system_muted,
        microphone_muted: project.audio.microphone_muted,
        system_volume: project.audio.system_volume,
        microphone_volume: project.audio.microphone_volume,
    })
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

/// Collect timeline-space segments where typewriter loop sound should be active.
pub fn collect_typewriter_sound_segments(project: &VideoProject) -> Vec<AudioSegment> {
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

/// Build source-audio segments from project timeline cuts.
pub fn collect_source_audio_segments(project: &VideoProject) -> Vec<AudioSegment> {
    if project.timeline.segments.is_empty() {
        vec![AudioSegment {
            start_sec: project.timeline.in_point as f64 / 1000.0,
            end_sec: project.timeline.out_point as f64 / 1000.0,
        }]
    } else {
        project
            .timeline
            .segments
            .iter()
            .map(|s| AudioSegment {
                start_sec: s.source_start_ms as f64 / 1000.0,
                end_sec: s.source_end_ms as f64 / 1000.0,
            })
            .collect()
    }
}

/// Build audio filter graph for mixing multiple audio tracks with volume control.
/// Source tracks are trimmed to kept segments; timeline tracks use absolute windows.
/// Returns None when no usable audio graph can be built.
pub fn build_audio_filter(
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
            },
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

/// Convert quality percentage to CRF value.
pub fn quality_to_crf(quality: u32) -> u8 {
    (35 - ((quality as f32 / 100.0) * 20.0) as u8).clamp(15, 35)
}

/// Build ffmpeg `-i` args and corresponding audio input descriptors.
pub fn build_audio_input_args(request: &AudioInputBuildRequest) -> (Vec<String>, Vec<AudioInput>) {
    let mut args = Vec::new();
    let mut audio_inputs: Vec<AudioInput> = Vec::new();
    let mut next_input_index = request.start_input_index;

    // Add system audio if available and not muted.
    if let Some(ref audio_path) = request.system_audio_path {
        if !request.system_muted {
            args.extend(["-i".to_string(), audio_path.clone()]);
            audio_inputs.push(AudioInput {
                input_index: next_input_index,
                volume: request.system_volume,
                source: AudioInputSource::SourceTrack,
            });
            next_input_index += 1;
        }
    }

    // Add microphone audio if available and not muted.
    if let Some(ref mic_path) = request.microphone_audio_path {
        if !request.microphone_muted {
            args.extend(["-i".to_string(), mic_path.clone()]);
            audio_inputs.push(AudioInput {
                input_index: next_input_index,
                volume: request.microphone_volume,
                source: AudioInputSource::SourceTrack,
            });
            next_input_index += 1;
        }
    }

    // Add typewriter loop audio as timeline windows.
    if !request.system_muted
        && request.system_volume > 0.0
        && !request.typewriter_windows.is_empty()
        && request.typewriter_loop_audio_path.is_some()
    {
        let path = request
            .typewriter_loop_audio_path
            .clone()
            .unwrap_or_default();
        args.extend([
            "-stream_loop".to_string(),
            "-1".to_string(),
            "-i".to_string(),
            path,
        ]);
        audio_inputs.push(AudioInput {
            input_index: next_input_index,
            volume: request.system_volume,
            source: AudioInputSource::TimelineWindows(request.typewriter_windows.clone()),
        });
    }

    (args, audio_inputs)
}

/// Request payload for building complete FFmpeg encoder args.
#[derive(Debug, Clone)]
pub struct EncoderArgsBuildRequest {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub output_path: String,
    pub format: ExportFormat,
    pub quality: u32,
    pub mp4_encoder_config: Option<EncoderConfig>,
    pub audio_input_request: AudioInputBuildRequest,
    pub source_audio_segments: Vec<AudioSegment>,
}

/// Build complete FFmpeg args for export encode.
pub fn build_encoder_args(request: &EncoderArgsBuildRequest) -> Result<Vec<String>, String> {
    let mut args = vec![
        "-y".to_string(),
        // Raw RGBA input from stdin.
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-s".to_string(),
        format!("{}x{}", request.width, request.height),
        "-r".to_string(),
        request.fps.to_string(),
        "-i".to_string(),
        "-".to_string(),
    ];

    let (audio_input_args, audio_inputs) = build_audio_input_args(&request.audio_input_request);
    args.extend(audio_input_args);

    let audio_filter = build_audio_filter(&audio_inputs, &request.source_audio_segments);

    match request.format {
        ExportFormat::Mp4 => {
            let encoder = request
                .mp4_encoder_config
                .as_ref()
                .ok_or_else(|| "Missing MP4 encoder config".to_string())?;
            args.extend(build_mp4_video_args(encoder, request.fps));
            if let Some(ref filter) = audio_filter {
                args.extend(build_filtered_audio_output_args(filter, "aac", "192k"));
            }
        },
        ExportFormat::Webm => {
            args.extend(build_webm_video_args(request.quality, request.fps));
            if let Some(ref filter) = audio_filter {
                args.extend(build_filtered_audio_output_args(filter, "libopus", "128k"));
            }
        },
        ExportFormat::Gif => {
            args.extend(build_gif_video_args(request.fps));
        },
    }

    args.push(request.output_path.clone());
    Ok(args)
}

/// Build MP4 video-only ffmpeg args for selected encoder.
pub fn build_mp4_video_args(encoder_config: &EncoderConfig, fps: u32) -> Vec<String> {
    let mut args = vec![
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
    ];

    // Encoder-specific optimizations.
    if encoder_config.encoder_type == EncoderType::Nvenc {
        // NVENC: add b-frames and lookahead for better quality.
        args.extend([
            "-bf".to_string(),
            "2".to_string(),
            "-rc-lookahead".to_string(),
            "20".to_string(),
        ]);
    } else {
        // x264: enable multi-threaded encoding for better CPU utilization.
        args.extend([
            "-threads".to_string(),
            "0".to_string(), // Auto-detect CPU cores
            "-x264-params".to_string(),
            "threads=auto:lookahead_threads=auto".to_string(),
        ]);
    }

    args
}

/// Build WebM video-only ffmpeg args.
pub fn build_webm_video_args(quality: u32, fps: u32) -> Vec<String> {
    let crf = quality_to_crf(quality);
    vec![
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
    ]
}

/// Build GIF video filter args.
pub fn build_gif_video_args(fps: u32) -> Vec<String> {
    vec![
        "-vf".to_string(),
        format!(
            "fps={},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            fps.min(15)
        ),
    ]
}

/// Build args for mapping filtered audio output track.
pub fn build_filtered_audio_output_args(
    filter: &str,
    audio_codec: &str,
    audio_bitrate: &str,
) -> Vec<String> {
    vec![
        "-filter_complex".to_string(),
        filter.to_string(),
        "-map".to_string(),
        "0:v".to_string(),
        "-map".to_string(),
        "[aout]".to_string(),
        "-c:a".to_string(),
        audio_codec.to_string(),
        "-b:a".to_string(),
        audio_bitrate.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_to_crf_range() {
        assert_eq!(quality_to_crf(100), 15);
        assert_eq!(quality_to_crf(0), 35);
    }

    #[test]
    fn builds_mp4_args_for_nvenc() {
        let cfg = EncoderConfig {
            encoder_type: EncoderType::Nvenc,
            codec: "h264_nvenc".to_string(),
            preset: "p4".to_string(),
            quality_param: "-cq".to_string(),
            quality_value: 23,
        };
        let args = build_mp4_video_args(&cfg, 30);
        assert!(args.contains(&"h264_nvenc".to_string()));
        assert!(args.contains(&"-rc-lookahead".to_string()));
        assert!(!args.contains(&"-x264-params".to_string()));
    }

    #[test]
    fn builds_webm_args() {
        let args = build_webm_video_args(80, 60);
        assert!(args.contains(&"libvpx-vp9".to_string()));
        assert!(args.contains(&"60".to_string()));
    }

    #[test]
    fn builds_gif_args_with_fps_cap() {
        let args = build_gif_video_args(60);
        assert!(args.iter().any(|a| a.contains("fps=15")));
    }

    #[test]
    fn builds_filtered_audio_output_args() {
        let args = build_filtered_audio_output_args("foo", "aac", "192k");
        assert!(args.contains(&"foo".to_string()));
        assert!(args.contains(&"aac".to_string()));
        assert!(args.contains(&"192k".to_string()));
    }

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
        assert!(filter.contains("atrim=start=0:end=0.500,volume=0"));
        assert!(filter.contains("atrim=start=0:end=1.000,asetpts=PTS-STARTPTS[a0w0]"));
        assert!(filter.contains("atrim=start=0:end=0.500,volume=0,asetpts=PTS-STARTPTS[a0g1]"));
        assert!(filter.contains("atrim=start=0:end=0.400,asetpts=PTS-STARTPTS[a0w1]"));
        assert!(filter.contains("concat=n=4:v=0:a=1"));
        assert!(filter.contains("apad=whole_dur=3.000[aout]"));
    }

    #[test]
    fn builds_audio_input_args_for_existing_tracks() {
        let req = AudioInputBuildRequest {
            start_input_index: 1,
            system_audio_path: Some("system.wav".to_string()),
            microphone_audio_path: Some("mic.wav".to_string()),
            typewriter_loop_audio_path: None,
            typewriter_windows: Vec::new(),
            system_muted: false,
            microphone_muted: false,
            system_volume: 0.8,
            microphone_volume: 0.5,
        };

        let (args, inputs) = build_audio_input_args(&req);
        assert!(args.contains(&"system.wav".to_string()));
        assert!(args.contains(&"mic.wav".to_string()));
        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0].input_index, 1);
        assert_eq!(inputs[1].input_index, 2);
    }

    #[test]
    fn builds_audio_input_args_with_typewriter_track() {
        let req = AudioInputBuildRequest {
            start_input_index: 1,
            system_audio_path: None,
            microphone_audio_path: None,
            typewriter_loop_audio_path: Some("typewriter.wav".to_string()),
            typewriter_windows: vec![AudioSegment {
                start_sec: 0.5,
                end_sec: 1.5,
            }],
            system_muted: false,
            microphone_muted: false,
            system_volume: 1.0,
            microphone_volume: 1.0,
        };

        let (args, inputs) = build_audio_input_args(&req);
        assert!(args.contains(&"-stream_loop".to_string()));
        assert!(args.contains(&"typewriter.wav".to_string()));
        assert_eq!(inputs.len(), 1);
        match &inputs[0].source {
            AudioInputSource::TimelineWindows(w) => assert_eq!(w.len(), 1),
            _ => panic!("expected timeline windows source"),
        }
    }

    #[test]
    fn build_encoder_args_requires_mp4_encoder_config() {
        let req = EncoderArgsBuildRequest {
            width: 1920,
            height: 1080,
            fps: 30,
            output_path: "out.mp4".to_string(),
            format: ExportFormat::Mp4,
            quality: 80,
            mp4_encoder_config: None,
            audio_input_request: AudioInputBuildRequest::default(),
            source_audio_segments: Vec::new(),
        };

        assert!(build_encoder_args(&req).is_err());
    }

    #[test]
    fn build_encoder_args_webm_with_audio_filter_mapping() {
        let req = EncoderArgsBuildRequest {
            width: 1280,
            height: 720,
            fps: 30,
            output_path: "out.webm".to_string(),
            format: ExportFormat::Webm,
            quality: 70,
            mp4_encoder_config: None,
            audio_input_request: AudioInputBuildRequest {
                start_input_index: 1,
                system_audio_path: Some("system.wav".to_string()),
                microphone_audio_path: None,
                typewriter_loop_audio_path: None,
                typewriter_windows: Vec::new(),
                system_muted: false,
                microphone_muted: false,
                system_volume: 1.0,
                microphone_volume: 1.0,
            },
            source_audio_segments: vec![AudioSegment {
                start_sec: 0.0,
                end_sec: 1.0,
            }],
        };

        let args = build_encoder_args(&req).expect("should build args");
        assert!(args.contains(&"-filter_complex".to_string()));
        assert!(args.contains(&"[aout]".to_string()));
        assert!(args.contains(&"libopus".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("out.webm"));
    }
}
