//! GIF capture implementation.
//!
//! Uses D3D capture for fast async capture at 30+ FPS.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crossbeam_channel::Receiver;

use crate::gif_encoder::GifRecorder;
use crate::recorder_loop_control::{handle_loop_control, LoopControl, PauseState};
use crate::state::{RecorderCommand, RecordingProgress};
use moonsnap_capture_types::recording::{RecordingSettings, RecordingState};

/// Run GIF capture.
///
/// Returns the actual recording duration in seconds.
pub fn run_gif_capture<E>(
    settings: &RecordingSettings,
    output_path: &PathBuf,
    progress: Arc<RecordingProgress>,
    command_rx: Receiver<RecorderCommand>,
    started_at: &str,
    emit_state: E,
) -> Result<f64, String>
where
    E: Fn(RecordingState),
{
    log::debug!("[GIF] Starting capture, mode={:?}", settings.mode);

    let capture_plan = crate::recorder_video_capture::CapturePlan::from_mode(&settings.mode)?;
    let (mut capture, first_frame) = crate::recorder_video_capture::create_capture_source(
        &capture_plan,
        settings.fps,
        settings.include_cursor,
    )?;
    let first_frame_dims = first_frame.as_ref().map(|(w, h, _)| (*w, *h));
    let (width, height) = crate::recorder_video_capture::resolve_capture_dimensions(
        &capture_plan,
        first_frame_dims,
        (capture.width(), capture.height()),
    );

    let max_duration = settings
        .max_duration_secs
        .map(|s| Duration::from_secs(s as u64));
    let max_frames = settings.fps as usize * settings.max_duration_secs.unwrap_or(30) as usize;

    let recorder = Arc::new(Mutex::new(GifRecorder::new(
        width,
        height,
        settings.fps,
        settings.gif_quality_preset,
        max_frames,
    )));

    let frame_duration = Duration::from_secs_f64(1.0 / settings.fps as f64);
    let frame_timeout_ms = (frame_duration.as_millis() as u64).max(50);

    let start_time = Instant::now();
    let mut last_frame_time = start_time;
    let should_stop = std::sync::atomic::AtomicBool::new(false);
    let is_paused = std::sync::atomic::AtomicBool::new(false);
    let mut pause_state = PauseState::new();

    loop {
        match handle_loop_control(
            &command_rx,
            &mut pause_state,
            progress.as_ref(),
            &should_stop,
            &is_paused,
            Duration::from_millis(frame_timeout_ms),
        ) {
            LoopControl::Stop => break,
            LoopControl::SkipFrame => continue,
            LoopControl::Continue => {},
        }

        let elapsed = pause_state.active_elapsed(start_time);
        if let Some(max_dur) = max_duration {
            if elapsed >= max_dur {
                break;
            }
        }

        let now = Instant::now();
        let time_since_last = now.duration_since(last_frame_time);
        if time_since_last < frame_duration {
            let sleep_time = frame_duration - time_since_last;
            std::thread::sleep(sleep_time);
        }

        let frame = match capture.get_frame(frame_timeout_ms) {
            Some(f) => f,
            None => continue,
        };

        last_frame_time = Instant::now();

        let final_data = frame.data;
        let timestamp = elapsed.as_secs_f64();
        if let Ok(mut rec) = recorder.lock() {
            rec.add_frame(final_data, width, height, timestamp);
        }

        progress.increment_frame();

        let frame_count = progress.get_frame_count();
        if frame_count.is_multiple_of(30) {
            emit_state(RecordingState::Recording {
                started_at: started_at.to_string(),
                elapsed_secs: elapsed.as_secs_f64(),
                frame_count,
            });
        }
    }

    capture.stop();

    let recording_duration = pause_state.active_elapsed(start_time).as_secs_f64();

    if progress.was_cancelled() {
        return Ok(recording_duration);
    }

    emit_state(RecordingState::Processing { progress: 0.0 });

    let total_duration = pause_state.active_elapsed(start_time);
    let recorder_guard = recorder.lock().map_err(|_| "Failed to lock recorder")?;
    let frame_count = recorder_guard.frame_count();

    log::debug!(
        "[GIF] Capture complete: {} frames in {:.2}s ({:.1} fps)",
        frame_count,
        total_duration.as_secs_f64(),
        frame_count as f64 / total_duration.as_secs_f64()
    );

    if frame_count == 0 {
        return Err("No frames captured".to_string());
    }

    recorder_guard
        .encode_to_file(output_path, |encoding_progress| {
            emit_state(RecordingState::Processing {
                progress: encoding_progress,
            });
        })
        .map_err(|e| format!("Failed to encode GIF: {}", e))?;

    Ok(recording_duration)
}
