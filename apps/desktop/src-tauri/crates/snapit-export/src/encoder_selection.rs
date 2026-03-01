//! Encoder selection and quality mapping helpers.

use std::path::Path;
use std::process::Stdio;

/// Encoder type for video export.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderType {
    /// NVIDIA NVENC hardware encoder (h264_nvenc).
    Nvenc,
    /// Software x264 encoder (libx264).
    X264,
}

/// Encoder configuration with codec-specific parameters.
#[derive(Debug, Clone)]
pub struct EncoderConfig {
    pub encoder_type: EncoderType,
    pub codec: String,
    pub preset: String,
    pub quality_param: String,
    pub quality_value: u8,
}

/// NVENC preset mapping (p1=fastest, p7=highest quality).
/// p4 is balanced speed/quality for most use cases.
pub fn nvenc_preset_from_quality(quality: u32) -> &'static str {
    match quality {
        0..=24 => "p1",   // Fastest, lowest quality
        25..=49 => "p3",  // Fast
        50..=74 => "p4",  // Balanced (default) - 50% quality maps here
        75..=89 => "p5",  // Quality
        90..=100 => "p7", // Maximum quality
        _ => "p4",
    }
}

/// Convert quality percentage to NVENC CQ value.
/// CQ range: 0 (highest quality) to 51 (lowest quality).
/// Quality 100% -> CQ ~15, Quality 50% -> CQ ~25, Quality 0% -> CQ ~40.
pub fn quality_to_cq(quality: u32) -> u8 {
    let cq = 40.0 - (quality as f32 / 100.0) * 25.0;
    (cq as u8).clamp(15, 40)
}

/// Select the best available encoder based on hardware and preferences.
///
/// `x264_crf` should come from the app-specific quality mapping used for libx264.
pub fn select_encoder(
    quality: u32,
    prefer_hardware: bool,
    nvenc_available: bool,
    x264_crf: u8,
) -> EncoderConfig {
    let use_nvenc = prefer_hardware && nvenc_available;

    if use_nvenc {
        log::info!("[ENCODER] Using NVENC hardware encoder");
        EncoderConfig {
            encoder_type: EncoderType::Nvenc,
            codec: "h264_nvenc".to_string(),
            preset: nvenc_preset_from_quality(quality).to_string(),
            quality_param: "-cq".to_string(),
            quality_value: quality_to_cq(quality),
        }
    } else {
        log::info!("[ENCODER] Using x264 software encoder");
        EncoderConfig {
            encoder_type: EncoderType::X264,
            codec: "libx264".to_string(),
            // "superfast" is ~2x faster than "fast" with minimal quality loss
            // For balanced quality/speed when hardware encoding unavailable
            preset: "superfast".to_string(),
            quality_param: "-crf".to_string(),
            quality_value: x264_crf,
        }
    }
}

/// Check if NVENC is available by testing an FFmpeg encode invocation.
pub fn is_nvenc_available(ffmpeg_path: &Path) -> bool {
    // NVENC requires a minimum frame size; 256x256 keeps probe reliable.
    let result = snapit_media::ffmpeg::create_hidden_command(ffmpeg_path)
        .args([
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=0.01:size=256x256:rate=1",
            "-c:v",
            "h264_nvenc",
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match result {
        Ok(status) => {
            let available = status.success();
            log::info!(
                "[ENCODER] NVENC availability check: {}",
                if available {
                    "available"
                } else {
                    "not available"
                }
            );
            available
        },
        Err(e) => {
            log::debug!("[ENCODER] NVENC check failed: {}", e);
            false
        },
    }
}

/// Select best encoder after probing runtime NVENC availability.
pub fn select_encoder_with_probe(
    ffmpeg_path: &Path,
    quality: u32,
    prefer_hardware: bool,
    x264_crf: u8,
) -> EncoderConfig {
    let nvenc_available = is_nvenc_available(ffmpeg_path);
    select_encoder(quality, prefer_hardware, nvenc_available, x264_crf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_to_cq_range() {
        assert_eq!(quality_to_cq(100), 15); // Best quality
        assert_eq!(quality_to_cq(0), 40); // Lowest quality
        let mid = quality_to_cq(50);
        assert!(mid > 15 && mid < 40);
    }

    #[test]
    fn nvenc_preset_selection() {
        assert_eq!(nvenc_preset_from_quality(100), "p7");
        assert_eq!(nvenc_preset_from_quality(50), "p4");
        assert_eq!(nvenc_preset_from_quality(0), "p1");
    }

    #[test]
    fn selects_nvenc_when_allowed_and_available() {
        let cfg = select_encoder(80, true, true, 23);
        assert_eq!(cfg.encoder_type, EncoderType::Nvenc);
        assert_eq!(cfg.codec, "h264_nvenc");
    }

    #[test]
    fn selects_x264_when_hardware_not_available() {
        let cfg = select_encoder(80, true, false, 23);
        assert_eq!(cfg.encoder_type, EncoderType::X264);
        assert_eq!(cfg.codec, "libx264");
        assert_eq!(cfg.quality_value, 23);
    }
}
