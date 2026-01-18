//! Audio extraction from video files for Whisper transcription.
//!
//! Uses the bundled ffmpeg binary to extract and resample audio to 16kHz mono PCM.

use std::path::Path;
use std::process::Stdio;

use crate::commands::storage::ffmpeg::{create_hidden_command, find_ffmpeg};

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
    for i in 0..data.len().saturating_sub(8) {
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
