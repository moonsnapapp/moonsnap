//! Core video recording implementation.
//!
//! Uses Windows Graphics Capture (WGC) for frame capture
//! and VideoEncoder for hardware-accelerated MP4 encoding.

// Allow unused internal helpers - may be useful for future features
#![allow(dead_code)]

mod gif;
mod video;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use snapit_capture::desktop_icons::{hide_desktop_icons, show_desktop_icons};
use snapit_capture::state::{RecorderCommand, RecordingProgress, RECORDING_CONTROLLER};
use tauri::AppHandle;

use super::{emit_state_change, RecordingFormat, RecordingSettings, RecordingState};

// Note: validate_video_file is used internally by the module, not re-exported

// ============================================================================
// Public API
// ============================================================================

/// Start a new recording.
pub async fn start_recording(
    app: AppHandle,
    settings: RecordingSettings,
    output_path: PathBuf,
) -> Result<(), String> {
    log::debug!(
        "[RECORDING] Starting: format={:?}, countdown={}",
        settings.format,
        settings.countdown_secs
    );

    let (progress, command_rx) = {
        let mut controller = RECORDING_CONTROLLER.lock().map_err(|e| e.to_string())?;
        controller.start(settings.clone(), output_path.clone())?
    };

    // Note: Webcam and screen capture are pre-warmed when toolbar appears.
    // See prewarm_capture() in mod.rs

    // Handle countdown
    if settings.countdown_secs > 0 {
        let app_clone = app.clone();
        let settings_clone = settings.clone();
        let output_path_clone = output_path.clone();
        let progress_clone = Arc::clone(&progress);
        let command_rx_clone = command_rx.clone();

        // Use tauri's async runtime instead of tokio::spawn to ensure the task
        // persists across async boundaries
        tauri::async_runtime::spawn(async move {
            let cancelled = snapit_capture::recorder_countdown::run_recording_countdown(
                settings_clone.countdown_secs,
                Duration::from_millis(150),
                || {
                    matches!(
                        command_rx_clone.try_recv(),
                        Ok(RecorderCommand::Stop) | Ok(RecorderCommand::Cancel)
                    )
                },
                |seconds_remaining| {
                    if let Ok(mut controller) = RECORDING_CONTROLLER.lock() {
                        controller.update_countdown(seconds_remaining);
                    }

                    emit_state_change(&app_clone, &RecordingState::Countdown { seconds_remaining });
                },
                |delay| tokio::time::sleep(delay),
            )
            .await;

            if cancelled {
                if let Ok(mut controller) = RECORDING_CONTROLLER.lock() {
                    controller.reset();
                }
                emit_state_change(&app_clone, &RecordingState::Idle);
                return;
            }

            // Start actual recording
            if let Ok(mut controller) = RECORDING_CONTROLLER.lock() {
                controller.start_actual_recording();
            }

            // Emit recording state IMMEDIATELY for instant UI feedback (optimistic UI)
            // Border shows right away, init happens in background
            let started_at = chrono::Local::now().to_rfc3339();
            emit_state_change(
                &app_clone,
                &RecordingState::Recording {
                    started_at: started_at.clone(),
                    elapsed_secs: 0.0,
                    frame_count: 0,
                },
            );

            // Start capture in background thread
            start_capture_thread(
                app_clone,
                settings_clone,
                output_path_clone,
                progress_clone,
                command_rx_clone,
                started_at,
            );
        });
    } else {
        // No countdown, start immediately
        // Emit recording state IMMEDIATELY for instant UI feedback
        let started_at = chrono::Local::now().to_rfc3339();
        emit_state_change(
            &app,
            &RecordingState::Recording {
                started_at: started_at.clone(),
                elapsed_secs: 0.0,
                frame_count: 0,
            },
        );

        start_capture_thread(app, settings, output_path, progress, command_rx, started_at);
    }

    Ok(())
}

/// Start the capture thread based on recording mode and format.
fn start_capture_thread(
    app: AppHandle,
    settings: RecordingSettings,
    output_path: PathBuf,
    progress: Arc<RecordingProgress>,
    command_rx: Receiver<RecorderCommand>,
    started_at: String,
) {
    let app_for_capture = app.clone();
    let app_for_cancelled = app.clone();
    let app_for_completed = app.clone();
    let app_for_error = app.clone();
    let output_path_clone = output_path.clone();

    let _handle = snapit_capture::recorder_capture_lifecycle::spawn_capture_thread_with_lifecycle(
        output_path_clone,
        || {
            // Hide desktop icons if enabled (restored in `after_capture`).
            hide_desktop_icons();
        },
        move || {
            // Window mode is now handled natively by WGC in run_video_capture/run_gif_capture.
            match settings.format {
                RecordingFormat::Mp4 => video::run_video_capture(
                    &app_for_capture,
                    &settings,
                    &output_path,
                    progress.clone(),
                    command_rx,
                    &started_at,
                ),
                RecordingFormat::Gif => gif::run_gif_capture(
                    &app_for_capture,
                    &settings,
                    &output_path,
                    progress.clone(),
                    command_rx,
                    &started_at,
                ),
            }
        },
        || {
            RECORDING_CONTROLLER
                .lock()
                .map(|c| {
                    c.active
                        .as_ref()
                        .map(|a| a.progress.was_cancelled())
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        },
        |video_file_path| snapit_capture::recorder_helpers::validate_video_file(video_file_path),
        move || {
            if let Ok(mut controller) = RECORDING_CONTROLLER.lock() {
                controller.reset();
            }
            emit_state_change(&app_for_cancelled, &RecordingState::Idle);
        },
        move |resolved_output_path, recording_duration, file_size| {
            if let Ok(mut controller) = RECORDING_CONTROLLER.lock() {
                controller.complete(resolved_output_path.clone(), recording_duration, file_size);
            }

            emit_state_change(
                &app_for_completed,
                &RecordingState::Completed {
                    output_path: resolved_output_path,
                    duration_secs: recording_duration,
                    file_size_bytes: file_size,
                },
            );
        },
        move |error_message| {
            log::error!("[RECORDING] Failed: {}", error_message);
            if let Ok(mut controller) = RECORDING_CONTROLLER.lock() {
                controller.set_error(error_message.clone());
            }
            emit_state_change(
                &app_for_error,
                &RecordingState::Error {
                    message: error_message,
                },
            );
        },
        || {
            // Always restore desktop icons when recording ends (success, error, or panic).
            show_desktop_icons();
        },
    );
}

// ============================================================================
// Recording Control Commands
// ============================================================================

/// Stop the current recording.
///
/// This sends the stop command and returns immediately.
/// The UI immediately transitions to "Processing" state (optimistic update).
/// The actual completion is signaled via the 'recording-state-changed' event
/// when the state becomes Completed or Error.
pub async fn stop_recording(app: AppHandle) -> Result<(), String> {
    let controller = RECORDING_CONTROLLER.lock().map_err(|e| e.to_string())?;
    controller.request_stop()?;

    // Immediately emit Processing state so UI feels responsive
    // Timer stops, user sees "Saving..." or similar
    emit_state_change(&app, &RecordingState::Processing { progress: 0.0 });

    Ok(())
}

/// Cancel the current recording.
pub async fn cancel_recording(_app: AppHandle) -> Result<(), String> {
    let controller = RECORDING_CONTROLLER.lock().map_err(|e| e.to_string())?;
    controller.request_cancel()?;
    Ok(())
}

/// Pause the current recording.
pub async fn pause_recording(app: AppHandle) -> Result<(), String> {
    let mut controller = RECORDING_CONTROLLER.lock().map_err(|e| e.to_string())?;
    controller.request_pause()?;
    emit_state_change(&app, &controller.state);

    Ok(())
}

/// Resume a paused recording.
pub async fn resume_recording(app: AppHandle) -> Result<(), String> {
    let mut controller = RECORDING_CONTROLLER.lock().map_err(|e| e.to_string())?;
    controller.request_resume()?;
    emit_state_change(&app, &controller.state);

    Ok(())
}
