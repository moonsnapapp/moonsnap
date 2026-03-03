#![doc = include_str!("../README.md")]

pub mod audio;
pub mod audio_multitrack;
pub mod audio_sync;
pub mod audio_wasapi;
pub mod capture_source;
pub mod d3d_capture;
pub mod desktop_icons;
pub mod ffmpeg_gif_encoder;
pub mod fragmentation;
pub mod frame_buffer;
pub mod gif_encoder;
pub mod master_clock;
pub mod recorder_audio_paths;
pub mod recorder_capture_lifecycle;
pub mod recorder_countdown;
pub mod recorder_cursor_persistence;
pub mod recorder_cursor_region;
pub mod recorder_finalization;
pub mod recorder_first_frame;
pub mod recorder_gif;
pub mod recorder_helpers;
pub mod recorder_loop_control;
pub mod recorder_output_paths;
pub mod recorder_pacing;
pub mod recorder_progress;
pub mod recorder_video_capture;
pub mod recorder_video_finalize;
pub mod recorder_video_loop;
pub mod recorder_video_postprocess;
pub mod recorder_webcam_feed;
pub mod recorder_webcam_lifecycle;
pub mod recording_runtime;
pub mod state;
pub mod timestamp;

#[cfg(test)]
mod tests {
    use super::{
        audio, audio_multitrack::MultiTrackAudioRecorder, audio_sync, capture_source,
        frame_buffer::FrameBufferPool, master_clock::MasterClock, recorder_helpers,
        recording_runtime, state::RecordingProgress, timestamp::PerformanceCounterTimestamp,
    };

    #[test]
    fn root_exports_smoke_test() {
        let clock = MasterClock::new();
        assert_eq!(clock.audio_sample_count(), 0);

        let now = PerformanceCounterTimestamp::now();
        assert!(now.raw() > 0);

        let progress = RecordingProgress::new();
        assert_eq!(progress.get_frame_count(), 0);

        let mut buffers = FrameBufferPool::new(8, 8);
        assert_eq!(buffers.frame_size, 8 * 8 * 4);
        let flipped = buffers.flip_vertical(8, 8);
        assert_eq!(flipped.len(), 8 * 8 * 4);

        let mode = moonsnap_domain::recording::RecordingMode::AllMonitors;
        assert!(recorder_helpers::is_window_mode(&mode).is_none());

        let captured = capture_source::CapturedFrame {
            data: Vec::new(),
            width: 0,
            height: 0,
            timestamp_100ns: 0,
        };
        assert_eq!(captured.width, 0);

        let (_tx, _rx) = audio_sync::create_audio_channel();

        let recorder = MultiTrackAudioRecorder::new();
        let (_sys, _mic) = recorder.get_audio_paths();

        // Export-contract checks only: keep references to native helpers
        // without invoking them in CI/headless environments.
        let _display_bounds: fn(usize) -> Option<(i32, i32, u32, u32)> =
            recording_runtime::get_scap_display_bounds;
        let _list_input_devices: fn() -> Vec<String> = audio::list_input_devices;
    }
}
