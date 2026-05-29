//! GIF editing commands.
//!
//! Reads a source GIF and re-encodes it with edits (trim, speed, scale, reverse)
//! using bundled FFmpeg. Mirrors the quality presets used by the GIF recorder.

use image::{AnimationDecoder, DynamicImage};
use moonsnap_error::error::MoonSnapResult;
use moonsnap_media::ffmpeg::{create_hidden_command, find_ffmpeg, find_ffprobe};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{command, AppHandle, Emitter};
use ts_rs::TS;

/// Event name for streaming size estimates while ffmpeg is running.
pub const ESTIMATE_PROGRESS_EVENT: &str = "gif-estimate-progress";

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifEstimateProgress {
    /// Bytes written to the GIF file so far.
    #[ts(type = "number")]
    pub total_size: u64,
    /// Frames written so far (matches ffmpeg's `frame=` line).
    pub frame: u32,
    /// True when the encoder reported `progress=end`.
    pub done: bool,
}

/// Maximum thumbnail height (px) used in the frame strip.
const FRAME_THUMB_HEIGHT: u32 = 96;
/// Hard cap on extracted frames returned to the UI to avoid runaway memory
/// on very long GIFs. Beyond this we sub-sample.
const MAX_FRAMES: usize = 600;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifInfo {
    pub width: u32,
    pub height: u32,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub frame_count: u32,
    pub fps: f64,
    #[ts(type = "number")]
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifFrameInfo {
    pub index: u32,
    /// Start time of this frame in the source GIF (ms).
    #[ts(type = "number")]
    pub time_ms: u64,
    /// Duration this frame is displayed (ms).
    pub delay_ms: u32,
    /// Absolute path to the rendered thumbnail PNG on disk.
    pub thumbnail_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifCrop {
    /// Crop rectangle origin in source pixel coordinates.
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifFrameSpec {
    /// Index of the frame in the source GIF (0-based).
    pub source_index: u32,
    /// Delay (display duration) for this output frame, in milliseconds.
    pub delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifFrameEncodeOptions {
    pub frames: Vec<GifFrameSpec>,
    pub scale_pct: u32,
    /// Optional crop rectangle in source pixel coordinates. Applied before
    /// scale/rotate/flip.
    pub crop: Option<GifCrop>,
    /// Optional explicit output dimensions. When both are set they override
    /// `scale_pct`.
    pub output_width: Option<u32>,
    pub output_height: Option<u32>,
    /// Rotation in degrees clockwise: 0, 90, 180 or 270.
    pub rotation_degrees: u32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub loop_forever: bool,
    pub quality: String,
    /// Optional 0..=100 quality value. When set, overrides the `quality`
    /// preset string with a continuous palette-colors + dither mapping.
    pub quality_value: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct GifEditOptions {
    /// Start of trim window in milliseconds (0 = no trim from start).
    #[ts(type = "number")]
    pub trim_start_ms: u64,
    /// End of trim window in milliseconds (must be > trim_start_ms).
    #[ts(type = "number")]
    pub trim_end_ms: u64,
    /// Playback speed multiplier (e.g. 1.0 = original, 2.0 = 2x faster, 0.5 = half speed).
    pub speed: f64,
    /// Output scale as a percent of the original (25..=200).
    pub scale_pct: u32,
    /// Reverse playback.
    pub reverse: bool,
    /// Loop forever (true) or play once (false).
    pub loop_forever: bool,
    /// Optional output FPS override. None = keep source.
    pub fps: Option<u32>,
    /// Optional crop rectangle in source pixel coordinates. Applied before
    /// scale/rotate/flip.
    pub crop: Option<GifCrop>,
    /// Optional explicit output dimensions. When both are set they override
    /// `scale_pct`.
    pub output_width: Option<u32>,
    pub output_height: Option<u32>,
    /// Rotation in degrees clockwise: 0, 90, 180 or 270.
    pub rotation_degrees: u32,
    pub flip_h: bool,
    pub flip_v: bool,
    /// Quality preset: "fast" | "balanced" | "high".
    pub quality: String,
    /// Optional 0..=100 quality value. When set, overrides the `quality`
    /// preset string with a continuous palette-colors + dither mapping.
    pub quality_value: Option<u32>,
}

/// Probe a GIF file and return its dimensions, duration, frame count, fps and size.
#[command]
pub async fn get_gif_info(path: String) -> MoonSnapResult<GifInfo> {
    tokio::task::spawn_blocking(move || {
        let path_buf = std::path::PathBuf::from(&path);
        probe_gif(&path_buf)
    })
    .await
    .map_err(|e| format!("GIF probe task panicked: {}", e))?
    .map_err(|e| e.into())
}

/// Decode a GIF into per-frame thumbnails on disk and return their metadata.
/// Frames are written to a per-source temp folder so repeated calls can reuse
/// previously decoded thumbnails.
#[command]
pub async fn extract_gif_frames(path: String) -> MoonSnapResult<Vec<GifFrameInfo>> {
    tokio::task::spawn_blocking(move || {
        let path_buf = std::path::PathBuf::from(&path);
        extract_gif_frames_blocking(&path_buf)
    })
    .await
    .map_err(|e| format!("GIF frame extraction task panicked: {}", e))?
    .map_err(|e| e.into())
}

/// Encode the manifest to a temp file and return the resulting file size in
/// bytes, then delete the temp file. Used by the export preview dialog to
/// show a "Preview size" estimate. The encode is identical to
/// `encode_gif_from_frames` so the number reflects what the user would
/// actually get on disk.
///
/// Streams progress to the frontend via the `gif-estimate-progress` event so
/// the UI can update the displayed size as the encoder writes bytes.
#[command]
pub async fn estimate_gif_size_from_frames(
    app: AppHandle,
    input_path: String,
    options: GifFrameEncodeOptions,
) -> MoonSnapResult<u64> {
    tokio::task::spawn_blocking(move || {
        let input = std::path::PathBuf::from(&input_path);
        let temp = std::env::temp_dir()
            .join("moonsnap-gif-estimate")
            .join(format!("{}.gif", uuid::Uuid::new_v4()));
        if let Some(parent) = temp.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create estimate dir: {}", e))?;
        }
        encode_from_manifest_with_progress(&input, &temp, &options, Some(&app))?;
        let size = fs::metadata(&temp).map(|m| m.len()).unwrap_or(0);
        let _ = fs::remove_file(&temp);
        let _ = app.emit(
            ESTIMATE_PROGRESS_EVENT,
            GifEstimateProgress {
                total_size: size,
                frame: options.frames.len() as u32,
                done: true,
            },
        );
        Ok(size)
    })
    .await
    .map_err(|e| format!("GIF estimate task panicked: {}", e))?
    .map_err(|e: String| e.into())
}

/// Re-encode `input_path` into `output_path` from an explicit frame manifest.
/// Used when the user has deleted, duplicated or re-timed individual frames —
/// FFmpeg's simple `-ss/-t/setpts` chain can't express those edits.
#[command]
pub async fn encode_gif_from_frames(
    input_path: String,
    output_path: String,
    options: GifFrameEncodeOptions,
) -> MoonSnapResult<()> {
    tokio::task::spawn_blocking(move || {
        let input = std::path::PathBuf::from(&input_path);
        let output = std::path::PathBuf::from(&output_path);
        encode_from_manifest(&input, &output, &options)
    })
    .await
    .map_err(|e| format!("GIF frame encode task panicked: {}", e))?
    .map_err(|e| e.into())
}

/// Re-encode `input_path` into `output_path` applying the given edits.
#[command]
pub async fn process_gif(
    input_path: String,
    output_path: String,
    options: GifEditOptions,
) -> MoonSnapResult<()> {
    tokio::task::spawn_blocking(move || {
        let input = std::path::PathBuf::from(&input_path);
        let output = std::path::PathBuf::from(&output_path);
        run_ffmpeg_gif_edit(&input, &output, &options)
    })
    .await
    .map_err(|e| format!("GIF process task panicked: {}", e))?
    .map_err(|e| e.into())
}

fn probe_gif(path: &Path) -> Result<GifInfo, String> {
    let file_size_bytes = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read GIF metadata: {}", e))?
        .len();

    let ffprobe_path = find_ffprobe().ok_or_else(|| "ffprobe not found".to_string())?;

    let output = create_hidden_command(&ffprobe_path)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_frames",
            "-show_entries",
            "stream=width,height,nb_read_frames,r_frame_rate,duration",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    let stream = json["streams"]
        .as_array()
        .and_then(|s| s.first())
        .ok_or_else(|| "No video stream in GIF".to_string())?;

    let width = stream["width"].as_u64().unwrap_or(0) as u32;
    let height = stream["height"].as_u64().unwrap_or(0) as u32;

    let frame_count = stream["nb_read_frames"]
        .as_str()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    let fps = stream["r_frame_rate"]
        .as_str()
        .and_then(parse_rational)
        .unwrap_or(0.0);

    // Prefer format-level duration; fall back to stream duration.
    let duration_secs = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            stream["duration"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
        })
        // Last resort: derive from frame_count / fps.
        .or_else(|| {
            if fps > 0.0 && frame_count > 0 {
                Some(frame_count as f64 / fps)
            } else {
                None
            }
        })
        .unwrap_or(0.0);
    let duration_ms = (duration_secs * 1000.0).round() as u64;

    Ok(GifInfo {
        width,
        height,
        duration_ms,
        frame_count,
        fps,
        file_size_bytes,
    })
}

fn parse_rational(s: &str) -> Option<f64> {
    if let Some((num, den)) = s.split_once('/') {
        let n: f64 = num.parse().ok()?;
        let d: f64 = den.parse().ok()?;
        if d > 0.0 {
            return Some(n / d);
        }
    }
    s.parse::<f64>().ok()
}

fn quality_clauses(quality: &str, quality_value: Option<u32>) -> (u32, String) {
    if let Some(v) = quality_value {
        return numeric_quality_clauses(v);
    }
    match quality {
        "fast" => (128, "dither=none".to_string()),
        "high" => (256, "dither=floyd_steinberg".to_string()),
        // "balanced" or any other value
        _ => (256, "dither=bayer:bayer_scale=5".to_string()),
    }
}

/// Map a 0..=100 quality value to FFmpeg palettegen `max_colors` and
/// paletteuse dither mode. Low values lean on a smaller palette with no
/// dithering for smaller files; high values use full 256 colors with
/// error-diffusion dithering for the best visual quality.
fn numeric_quality_clauses(value: u32) -> (u32, String) {
    let v = value.min(100) as f32;
    // 64 colors at q=0, 256 at q=100, rounded to a multiple of 2.
    let max_colors = (64.0 + (v / 100.0) * 192.0).round() as u32;
    let max_colors = max_colors.clamp(16, 256);
    let dither = if v < 30.0 {
        "dither=none".to_string()
    } else if v < 70.0 {
        // Smaller bayer_scale = denser dithering. Scale 5..2 as quality rises.
        let scale = 5 - ((v as u32 - 30) / 10);
        let scale = scale.clamp(0, 5);
        format!("dither=bayer:bayer_scale={}", scale)
    } else {
        "dither=floyd_steinberg".to_string()
    };
    (max_colors, dither)
}

/// Build the comma-separated filter clauses that crop, resize, rotate and
/// flip the stream. The result is empty when no transform is requested.
/// Order is: crop → scale → rotate → flip.
fn build_transform_clauses(
    crop: Option<&GifCrop>,
    scale_pct: u32,
    output_width: Option<u32>,
    output_height: Option<u32>,
    rotation_degrees: u32,
    flip_h: bool,
    flip_v: bool,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(c) = crop {
        if c.width > 0 && c.height > 0 {
            parts.push(format!("crop={}:{}:{}:{}", c.width, c.height, c.x, c.y));
        }
    }

    match (output_width, output_height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => {
            // Force even dimensions for GIF/MP4 friendly output.
            parts.push(format!(
                "scale={}:{}:flags=lanczos",
                (w / 2) * 2,
                (h / 2) * 2,
            ));
        },
        _ => {
            if scale_pct != 100 {
                parts.push(format!(
                    "scale=trunc(iw*{}/200)*2:trunc(ih*{}/200)*2:flags=lanczos",
                    scale_pct, scale_pct,
                ));
            }
        },
    }

    match rotation_degrees % 360 {
        90 => parts.push("transpose=1".into()),
        180 => parts.push("transpose=1,transpose=1".into()),
        270 => parts.push("transpose=2".into()),
        _ => {},
    }

    if flip_h {
        parts.push("hflip".into());
    }
    if flip_v {
        parts.push("vflip".into());
    }

    parts.join(",")
}

fn run_ffmpeg_gif_edit(
    input: &Path,
    output: &Path,
    options: &GifEditOptions,
) -> Result<(), String> {
    if options.trim_end_ms <= options.trim_start_ms {
        return Err("Invalid trim range".to_string());
    }
    if options.speed <= 0.0 {
        return Err("Invalid speed".to_string());
    }
    if options.scale_pct == 0 {
        return Err("Invalid scale".to_string());
    }

    let ffmpeg_path = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    let start_secs = options.trim_start_ms as f64 / 1000.0;
    let duration_secs = (options.trim_end_ms - options.trim_start_ms) as f64 / 1000.0;

    let (max_colors, dither) = quality_clauses(&options.quality, options.quality_value);

    // Build the filter chain. setpts adjusts speed; reverse, scale, fps are optional.
    let mut chain = format!("setpts=PTS/{}", options.speed);
    if options.reverse {
        chain.push_str(",reverse");
    }
    let transform = build_transform_clauses(
        options.crop.as_ref(),
        options.scale_pct,
        options.output_width,
        options.output_height,
        options.rotation_degrees,
        options.flip_h,
        options.flip_v,
    );
    if !transform.is_empty() {
        chain.push(',');
        chain.push_str(&transform);
    }
    if let Some(fps) = options.fps {
        chain.push_str(&format!(",fps={}", fps));
    }

    let filter = format!(
        "[0:v]{chain},split[a][b];[a]palettegen=max_colors={max_colors}:stats_mode=full[p];[b][p]paletteuse={dither}:diff_mode=rectangle",
    );

    let loop_value = if options.loop_forever { "0" } else { "-1" };

    let mut cmd = create_hidden_command(&ffmpeg_path);
    cmd.arg("-y")
        .arg("-ss")
        .arg(format!("{:.3}", start_secs))
        .arg("-t")
        .arg(format!("{:.3}", duration_secs))
        .arg("-i")
        .arg(input)
        .arg("-filter_complex")
        .arg(&filter)
        .arg("-loop")
        .arg(loop_value)
        .arg(output);

    let result = cmd
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(())
}

fn encode_from_manifest(
    input: &Path,
    output: &Path,
    options: &GifFrameEncodeOptions,
) -> Result<(), String> {
    encode_from_manifest_with_progress(input, output, options, None)
}

fn encode_from_manifest_with_progress(
    input: &Path,
    output: &Path,
    options: &GifFrameEncodeOptions,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    if options.frames.is_empty() {
        return Err("No frames to encode".to_string());
    }
    if options.scale_pct == 0 {
        return Err("Invalid scale".to_string());
    }

    let ffmpeg_path = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    let file = fs::File::open(input).map_err(|e| format!("Failed to open GIF: {}", e))?;
    let decoder = image::codecs::gif::GifDecoder::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Failed to decode GIF: {}", e))?;
    let source_frames = decoder
        .into_frames()
        .collect_frames()
        .map_err(|e| format!("Failed to read GIF frames: {}", e))?;

    if source_frames.is_empty() {
        return Err("Source GIF has no frames".to_string());
    }

    let work_dir = std::env::temp_dir()
        .join("moonsnap-gif-export")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create export work dir: {}", e))?;

    let mut unique_paths: std::collections::HashMap<u32, PathBuf> =
        std::collections::HashMap::new();
    let mut concat_lines: Vec<String> = Vec::with_capacity(options.frames.len() * 2 + 1);

    for spec in &options.frames {
        let source_idx = spec.source_index as usize;
        if source_idx >= source_frames.len() {
            continue;
        }

        let path = if let Some(existing) = unique_paths.get(&spec.source_index) {
            existing.clone()
        } else {
            let p = work_dir.join(format!("frame_{:05}.png", spec.source_index));
            let img = DynamicImage::ImageRgba8(source_frames[source_idx].buffer().clone());
            img.save(&p)
                .map_err(|e| format!("Failed to write source frame: {}", e))?;
            unique_paths.insert(spec.source_index, p.clone());
            p
        };

        let duration_secs = (spec.delay_ms.max(1) as f64) / 1000.0;
        concat_lines.push(format!(
            "file '{}'",
            path.to_string_lossy().replace('\\', "/"),
        ));
        concat_lines.push(format!("duration {:.4}", duration_secs));
    }

    // Concat demuxer requires the last file repeated without duration to flush.
    if let Some(last_spec) = options.frames.last() {
        if let Some(p) = unique_paths.get(&last_spec.source_index) {
            concat_lines.push(format!("file '{}'", p.to_string_lossy().replace('\\', "/"),));
        }
    }

    let list_path = work_dir.join("list.txt");
    fs::write(&list_path, concat_lines.join("\n"))
        .map_err(|e| format!("Failed to write concat list: {}", e))?;

    let (max_colors, dither) = quality_clauses(&options.quality, options.quality_value);

    let mut filter = String::new();
    let transform = build_transform_clauses(
        options.crop.as_ref(),
        options.scale_pct,
        options.output_width,
        options.output_height,
        options.rotation_degrees,
        options.flip_h,
        options.flip_v,
    );
    if !transform.is_empty() {
        filter.push_str(&transform);
        filter.push(',');
    }
    filter.push_str(&format!(
        "split[a][b];[a]palettegen=max_colors={max_colors}:stats_mode=full[p];[b][p]paletteuse={dither}:diff_mode=rectangle",
    ));

    let loop_value = if options.loop_forever { "0" } else { "-1" };

    // When a progress handle is provided, spawn ffmpeg with -progress pipe:1
    // and stream `total_size=` / `frame=` updates back to the UI as the
    // encoder writes. Otherwise just block on .output() like before.
    let mut cmd = create_hidden_command(&ffmpeg_path);
    cmd.arg("-y")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&list_path)
        .arg("-filter_complex")
        .arg(&filter)
        .arg("-loop")
        .arg(loop_value);

    if app.is_some() {
        cmd.arg("-progress").arg("pipe:1").arg("-nostats");
    }

    cmd.arg(output);

    let run_result: Result<(), String> = if let Some(app) = app {
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut current_frame: u32 = 0;
            for line in reader.lines().map_while(Result::ok) {
                let line = line.trim();
                if let Some(val) = line.strip_prefix("total_size=") {
                    if let Ok(n) = val.parse::<u64>() {
                        let _ = app.emit(
                            ESTIMATE_PROGRESS_EVENT,
                            GifEstimateProgress {
                                total_size: n,
                                frame: current_frame,
                                done: false,
                            },
                        );
                    }
                } else if let Some(val) = line.strip_prefix("frame=") {
                    if let Ok(n) = val.parse::<u32>() {
                        current_frame = n;
                    }
                } else if line == "progress=end" {
                    break;
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("ffmpeg wait failed: {}", e))?;
        if !status.success() {
            // stderr was kept piped; drain what's available for diagnostics.
            let mut stderr_buf = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                use std::io::Read;
                let _ = stderr.read_to_string(&mut stderr_buf);
            }
            return Err(format!("ffmpeg failed: {}", stderr_buf));
        }
        Ok(())
    } else {
        let result = cmd
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!("ffmpeg failed: {}", stderr));
        }
        Ok(())
    };

    let _ = fs::remove_dir_all(&work_dir);
    run_result
}

fn frame_cache_dir(source: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(source).map_err(|e| format!("Failed to stat GIF: {}", e))?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let mut hasher = Sha256::new();
    hasher.update(source.to_string_lossy().as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update(metadata.len().to_le_bytes());
    let digest = hasher.finalize();
    let hex: String = digest
        .iter()
        .take(8)
        .map(|b| format!("{:02x}", b))
        .collect();

    let dir = std::env::temp_dir().join("moonsnap-gif-frames").join(hex);
    Ok(dir)
}

fn extract_gif_frames_blocking(source: &Path) -> Result<Vec<GifFrameInfo>, String> {
    let cache_dir = frame_cache_dir(source)?;

    let file = fs::File::open(source).map_err(|e| format!("Failed to open GIF: {}", e))?;
    let decoder = image::codecs::gif::GifDecoder::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Failed to decode GIF: {}", e))?;

    // Decode all frames into memory (image crate doesn't expose lazy iteration
    // with deterministic indices). Each frame already composits with prior
    // frames, so we can save them independently.
    let frames = decoder
        .into_frames()
        .collect_frames()
        .map_err(|e| format!("Failed to read GIF frames: {}", e))?;

    if frames.is_empty() {
        return Ok(Vec::new());
    }

    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create frame cache dir: {}", e))?;

    let total = frames.len();
    let stride = total.div_ceil(MAX_FRAMES);
    let stride = stride.max(1);

    let mut out: Vec<GifFrameInfo> = Vec::with_capacity(total.min(MAX_FRAMES));
    let mut accumulated_ms: u64 = 0;

    for (i, frame) in frames.iter().enumerate() {
        let (num, den) = frame.delay().numer_denom_ms();
        let delay_ms = if den == 0 { 0 } else { num / den };

        if i % stride == 0 {
            let thumb_path = cache_dir.join(format!("f_{:05}.png", i));
            if !thumb_path.exists() {
                let image = DynamicImage::ImageRgba8(frame.buffer().clone());
                let thumb = image.thumbnail(u32::MAX, FRAME_THUMB_HEIGHT);
                thumb
                    .save(&thumb_path)
                    .map_err(|e| format!("Failed to write frame thumbnail: {}", e))?;
            }

            out.push(GifFrameInfo {
                index: i as u32,
                time_ms: accumulated_ms,
                delay_ms,
                thumbnail_path: thumb_path.to_string_lossy().to_string(),
            });
        }

        accumulated_ms = accumulated_ms.saturating_add(delay_ms as u64);
    }

    Ok(out)
}
