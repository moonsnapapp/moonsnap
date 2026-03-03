//! Shared MP4 recording loop orchestration.
//!
//! Keeps command handling, pacing, max-duration gating, first-frame callback,
//! and progress emission in one reusable place while leaving frame source and
//! encoding details in adapter callbacks.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crossbeam_channel::Receiver;
use moonsnap_domain::recording::RecordingState;

use crate::recorder_loop_control::{handle_loop_control, LoopControl, PauseState};
use crate::recorder_pacing::compute_frame_pacing_sleep;
use crate::recorder_progress::maybe_emit_recording_progress;
use crate::state::{RecorderCommand, RecordingProgress};

/// Raw frame payload returned by caller-provided frame acquisition callback.
#[derive(Debug, Clone)]
pub struct VideoLoopFrame {
    pub data: Vec<u8>,
    pub hardware_timestamp_100ns: i64,
}

/// Config for reusable MP4 capture loop orchestration.
pub struct VideoCaptureLoopConfig<'a> {
    pub command_rx: &'a Receiver<RecorderCommand>,
    pub progress: &'a RecordingProgress,
    pub should_stop: &'a AtomicBool,
    pub is_paused: &'a AtomicBool,
    pub started_at: &'a str,
    pub start_time: Instant,
    pub max_duration: Option<Duration>,
    pub frame_duration: Duration,
    pub frame_timeout_ms: u64,
    pub control_poll_timeout: Duration,
    pub pacing_margin: Duration,
    pub progress_every_frames: u64,
}

/// Summary emitted after loop exit.
#[derive(Debug, Clone, Copy)]
pub struct VideoCaptureLoopResult {
    pub frame_count: u64,
    pub total_pause_duration: Duration,
}

/// Run reusable MP4 capture loop orchestration.
pub fn run_video_capture_loop<AcquireFrame, OnFirstFrame, OnFrame, EmitState>(
    cfg: VideoCaptureLoopConfig<'_>,
    mut acquire_frame: AcquireFrame,
    mut on_first_frame: OnFirstFrame,
    mut on_frame: OnFrame,
    mut emit_state: EmitState,
) -> Result<VideoCaptureLoopResult, String>
where
    AcquireFrame: FnMut(u64) -> Option<VideoLoopFrame>,
    OnFirstFrame: FnMut(u64, i64),
    OnFrame: FnMut(VideoLoopFrame, Duration) -> Result<(), String>,
    EmitState: FnMut(RecordingState),
{
    let mut frame_count: u64 = 0;
    let mut pause_state = PauseState::new();
    let mut last_frame_time = cfg.start_time;
    let mut first_frame_captured = false;

    loop {
        match handle_loop_control(
            cfg.command_rx,
            &mut pause_state,
            cfg.progress,
            cfg.should_stop,
            cfg.is_paused,
            cfg.control_poll_timeout,
        ) {
            LoopControl::Stop => break,
            LoopControl::SkipFrame => continue,
            LoopControl::Continue => {},
        }

        let actual_elapsed = pause_state.active_elapsed(cfg.start_time);
        if let Some(max_dur) = cfg.max_duration {
            if actual_elapsed >= max_dur {
                cfg.should_stop.store(true, Ordering::SeqCst);
                break;
            }
        }

        let elapsed_since_frame = last_frame_time.elapsed();
        if let Some(sleep_for) =
            compute_frame_pacing_sleep(elapsed_since_frame, cfg.frame_duration, cfg.pacing_margin)
        {
            if !sleep_for.is_zero() {
                std::thread::sleep(sleep_for);
            }
            continue;
        }

        let Some(frame) = acquire_frame(cfg.frame_timeout_ms) else {
            continue;
        };

        if !first_frame_captured {
            first_frame_captured = true;
            let first_frame_offset_ms = actual_elapsed.as_millis() as u64;
            on_first_frame(first_frame_offset_ms, frame.hardware_timestamp_100ns);
        }

        last_frame_time = Instant::now();
        on_frame(frame, actual_elapsed)?;

        frame_count += 1;
        cfg.progress.increment_frame();

        let _ = maybe_emit_recording_progress(
            frame_count,
            cfg.progress_every_frames,
            cfg.started_at,
            actual_elapsed.as_secs_f64(),
            &mut emit_state,
        );
    }

    Ok(VideoCaptureLoopResult {
        frame_count,
        total_pause_duration: pause_state.total_pause_duration(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossbeam_channel::bounded;

    #[test]
    fn loop_processes_frames_and_stops_on_command() {
        let (tx, rx) = bounded(4);
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);
        let start_time = Instant::now();

        let mut first_calls = 0u32;
        let mut seen_frames = 0u64;

        let result = run_video_capture_loop(
            VideoCaptureLoopConfig {
                command_rx: &rx,
                progress: &progress,
                should_stop: &should_stop,
                is_paused: &is_paused,
                started_at: "2026-01-01T00:00:00Z",
                start_time,
                max_duration: None,
                frame_duration: Duration::ZERO,
                frame_timeout_ms: 0,
                control_poll_timeout: Duration::from_millis(1),
                pacing_margin: Duration::ZERO,
                progress_every_frames: 1,
            },
            |_| {
                Some(VideoLoopFrame {
                    data: vec![1, 2, 3, 4],
                    hardware_timestamp_100ns: 1234,
                })
            },
            |_, _| {
                first_calls += 1;
            },
            |_, _| {
                seen_frames += 1;
                if seen_frames == 2 {
                    tx.send(RecorderCommand::Stop).expect("send stop command");
                }
                Ok(())
            },
            |_| {},
        )
        .expect("loop result");

        assert_eq!(result.frame_count, 2);
        assert_eq!(progress.get_frame_count(), 2);
        assert_eq!(first_calls, 1);
    }

    #[test]
    fn loop_stops_on_max_duration_and_sets_stop_flag() {
        let (_tx, rx) = bounded::<RecorderCommand>(1);
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);

        let result = run_video_capture_loop(
            VideoCaptureLoopConfig {
                command_rx: &rx,
                progress: &progress,
                should_stop: &should_stop,
                is_paused: &is_paused,
                started_at: "2026-01-01T00:00:00Z",
                start_time: Instant::now(),
                max_duration: Some(Duration::ZERO),
                frame_duration: Duration::ZERO,
                frame_timeout_ms: 0,
                control_poll_timeout: Duration::from_millis(1),
                pacing_margin: Duration::ZERO,
                progress_every_frames: 1,
            },
            |_| {
                Some(VideoLoopFrame {
                    data: vec![1],
                    hardware_timestamp_100ns: 1,
                })
            },
            |_, _| {},
            |_, _| Ok(()),
            |_| {},
        )
        .expect("loop result");

        assert_eq!(result.frame_count, 0);
        assert!(should_stop.load(Ordering::SeqCst));
        assert_eq!(progress.get_frame_count(), 0);
    }

    #[test]
    fn loop_propagates_frame_callback_error() {
        let (_tx, rx) = bounded::<RecorderCommand>(1);
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);

        let err = run_video_capture_loop(
            VideoCaptureLoopConfig {
                command_rx: &rx,
                progress: &progress,
                should_stop: &should_stop,
                is_paused: &is_paused,
                started_at: "2026-01-01T00:00:00Z",
                start_time: Instant::now(),
                max_duration: None,
                frame_duration: Duration::ZERO,
                frame_timeout_ms: 0,
                control_poll_timeout: Duration::from_millis(1),
                pacing_margin: Duration::ZERO,
                progress_every_frames: 1,
            },
            |_| {
                Some(VideoLoopFrame {
                    data: vec![1],
                    hardware_timestamp_100ns: 1,
                })
            },
            |_, _| {},
            |_, _| Err("frame callback failed".to_string()),
            |_| {},
        )
        .expect_err("expected frame callback error");

        assert!(err.contains("frame callback failed"));
    }
}
