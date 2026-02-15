//! Audio extraction from video files for Whisper transcription.
//!
//! Uses the bundled ffmpeg binary to extract and resample audio to 16kHz mono PCM.

use std::path::Path;
use std::process::Stdio;

use crate::commands::storage::ffmpeg::{create_hidden_command, find_ffmpeg, find_ffprobe};

/// Check if a video file contains an audio stream.
///
/// # Arguments
/// * `video_path` - Path to the video file
///
/// # Returns
/// * `Ok(true)` if the video has at least one audio stream
/// * `Ok(false)` if no audio stream is found
/// * `Err(String)` if probing failed
pub fn video_has_audio(video_path: &Path) -> Result<bool, String> {
    // Try ffprobe first, fall back to ffmpeg if not available
    if let Some(ffprobe_path) = find_ffprobe() {
        let output = create_hidden_command(&ffprobe_path)
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                &video_path.to_string_lossy(),
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        return Ok(stdout.trim().contains("audio"));
    }

    // Fallback: use ffmpeg -i and check for audio stream in output
    let ffmpeg_path = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    let output = create_hidden_command(&ffmpeg_path)
        .args(["-i", &video_path.to_string_lossy()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    // ffmpeg writes stream info to stderr
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(stderr.contains("Audio:") || stderr.contains("Stream #") && stderr.contains("audio"))
}

/// Extract audio from a video file and convert to 16kHz mono WAV for Whisper.
///
/// # Arguments
/// * `video_path` - Path to the input video file
/// * `output_path` - Path for the output WAV file
///
/// # Returns
/// * `Ok(())` if successful
/// * `Err(String)` with error message if failed
pub fn extract_audio_for_whisper(video_path: &Path, output_path: &Path) -> Result<(), String> {
    log::info!("Extracting audio from: {:?}", video_path);

    // Check if video has audio stream first
    let has_audio = video_has_audio(video_path)?;
    if !has_audio {
        return Err(
            "This video does not contain an audio track. Transcription requires audio.".to_string(),
        );
    }

    let ffmpeg_path = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;

    // Use ffmpeg to extract and convert audio to 16kHz mono PCM s16le WAV
    // -y: overwrite output
    // -i: input file
    // -vn: no video
    // -acodec pcm_s16le: 16-bit signed little-endian PCM
    // -ar 16000: 16kHz sample rate (Whisper requirement)
    // -ac 1: mono (single channel)
    let output = create_hidden_command(&ffmpeg_path)
        .args([
            "-y",
            "-i",
            &video_path.to_string_lossy(),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            &output_path.to_string_lossy(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Audio extraction failed: {}", stderr));
    }

    log::info!("Audio extracted to: {:?}", output_path);
    Ok(())
}

/// Convert any audio file to 16kHz mono WAV for Whisper.
///
/// Unlike `extract_audio_for_whisper`, this function doesn't check for audio streams
/// in video files - it directly converts the input audio file.
///
/// # Arguments
/// * `input_path` - Path to the input audio file (WAV, MP3, AAC, etc.)
/// * `output_path` - Path for the output WAV file
///
/// # Returns
/// * `Ok(())` if successful
/// * `Err(String)` with error message if failed
pub fn convert_to_whisper_format(input_path: &Path, output_path: &Path) -> Result<(), String> {
    log::info!("Converting audio to Whisper format: {:?}", input_path);

    let ffmpeg_path = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;

    // Use ffmpeg to convert audio to 16kHz mono PCM s16le WAV
    // -y: overwrite output
    // -i: input file
    // -acodec pcm_s16le: 16-bit signed little-endian PCM
    // -ar 16000: 16kHz sample rate (Whisper requirement)
    // -ac 1: mono (single channel)
    let output = create_hidden_command(&ffmpeg_path)
        .args([
            "-y",
            "-i",
            &input_path.to_string_lossy(),
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            &output_path.to_string_lossy(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Audio conversion failed: {}", stderr));
    }

    log::info!("Audio converted to: {:?}", output_path);
    Ok(())
}

/// Convert a bounded time range from an input media file to 16kHz mono WAV.
///
/// Works for both audio and video inputs (ffmpeg picks the audio stream).
///
/// # Arguments
/// * `input_path` - Source audio/video file
/// * `output_path` - Output WAV path
/// * `start_secs` - Start time in seconds (inclusive)
/// * `end_secs` - End time in seconds (exclusive)
pub fn convert_range_to_whisper_format(
    input_path: &Path,
    output_path: &Path,
    start_secs: f32,
    end_secs: f32,
) -> Result<(), String> {
    if !start_secs.is_finite() || !end_secs.is_finite() || end_secs <= start_secs {
        return Err("Invalid segment range".to_string());
    }

    log::info!(
        "Converting segment [{:.3}, {:.3}] to Whisper format from {:?}",
        start_secs,
        end_secs,
        input_path
    );

    let ffmpeg_path = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    let start_arg = format!("{:.3}", start_secs.max(0.0));
    let end_arg = format!("{:.3}", end_secs.max(start_secs + 0.001));

    let output = create_hidden_command(&ffmpeg_path)
        .args([
            "-y",
            "-ss",
            &start_arg,
            "-to",
            &end_arg,
            "-i",
            &input_path.to_string_lossy(),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            &output_path.to_string_lossy(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Segment audio conversion failed: {}", stderr));
    }

    log::info!("Segment audio converted to: {:?}", output_path);
    Ok(())
}

/// Load WAV audio file as f32 samples for Whisper.
///
/// Reads a 16kHz mono PCM s16le WAV file and converts to normalized f32 samples.
///
/// # Arguments
/// * `wav_path` - Path to the WAV file
///
/// # Returns
/// * `Ok(Vec<f32>)` - Normalized audio samples (-1.0 to 1.0)
/// * `Err(String)` if loading failed
pub fn load_wav_as_f32(wav_path: &Path) -> Result<Vec<f32>, String> {
    let audio_data =
        std::fs::read(wav_path).map_err(|e| format!("Failed to read audio file: {}", e))?;

    // Skip WAV header (44 bytes for standard PCM WAV)
    // The header contains format info, but since we know it's 16-bit mono PCM from ffmpeg,
    // we can skip directly to the data
    let data_offset = find_wav_data_offset(&audio_data).unwrap_or(44);

    let pcm_data = &audio_data[data_offset..];

    // Convert i16 samples to f32 normalized samples
    let samples: Vec<f32> = pcm_data
        .chunks(2)
        .filter_map(|chunk| {
            if chunk.len() == 2 {
                let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                Some(sample as f32 / 32768.0)
            } else {
                None
            }
        })
        .collect();

    log::info!(
        "Loaded {} audio samples ({:.1}s at 16kHz)",
        samples.len(),
        samples.len() as f32 / 16000.0
    );

    Ok(samples)
}

/// Find the data chunk offset in a WAV file.
fn find_wav_data_offset(data: &[u8]) -> Option<usize> {
    // Look for "data" marker in WAV file
    // Need at least 8 bytes after position i (4 for "data" + 4 for size)
    // so search up to len - 7 to include position where "data" starts at last valid spot
    for i in 0..data.len().saturating_sub(7) {
        if &data[i..i + 4] == b"data" {
            // Skip "data" (4) + size (4) = 8 bytes after marker
            return Some(i + 8);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_wav_data_offset() {
        // Minimal WAV header with "data" marker
        let fake_wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\x3e\x00\x00\x00\x7d\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00";
        let offset = find_wav_data_offset(fake_wav);
        assert!(offset.is_some());
        assert!(offset.unwrap() > 4);
    }
}
