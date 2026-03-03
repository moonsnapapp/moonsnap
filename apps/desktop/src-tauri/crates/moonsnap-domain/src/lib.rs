#![doc = include_str!("../README.md")]

pub mod captions;
pub mod capture;
pub mod capture_settings;
pub mod recording;
pub mod storage;
pub mod video_export;
pub mod video_project;
pub mod webcam;

#[cfg(test)]
mod tests {
    use super::{captions, capture_settings, recording, video_project, webcam};

    #[test]
    fn default_values_smoke_test() {
        let capture = capture_settings::CaptureSettings::default();
        assert_eq!(capture.video.fps, 30);
        assert_eq!(capture.gif.max_duration_secs, 30);

        let mut recording_settings = recording::RecordingSettings::default();
        recording_settings.validate();
        assert!((10..=60).contains(&recording_settings.fps));

        let composition = video_project::CompositionConfig::default();
        assert_eq!(composition.mode, video_project::CompositionMode::Auto);
        assert_eq!(
            video_project::SceneMode::CameraOnly.to_string(),
            "CameraOnly"
        );
    }

    #[test]
    fn serde_and_geometry_smoke_test() {
        let captions_data = captions::CaptionData::default();
        let json = serde_json::to_string(&captions_data).expect("caption data should serialize");
        let parsed: captions::CaptionData =
            serde_json::from_str(&json).expect("caption data should deserialize");
        assert_eq!(parsed.segments.len(), 0);

        let webcam_settings = webcam::WebcamSettings::default();
        let (x, y, size) = webcam::compute_webcam_rect(1920, 1080, &webcam_settings);
        assert!(x >= 0);
        assert!(y >= 0);
        assert!(size > 0);
    }
}
