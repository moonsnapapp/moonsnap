//! Video (MP4) capture implementation.
//!
//! Uses Scap for frame capture (with SystemTime-based timestamps)
//! and VideoEncoder for hardware-accelerated MP4 encoding.

use moonsnap_core::error::MoonSnapResult;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use super::super::project_file::{create_video_project_file, CreateVideoProjectRequest};
use crossbeam_channel::Receiver;
use moonsnap_capture::audio_multitrack::MultiTrackAudioRecorder;
use moonsnap_capture::frame_buffer::FrameBufferPool;
use moonsnap_capture::recorder_helpers::{
    get_window_rect, make_video_faststart, mux_audio_to_video,
};
use moonsnap_capture::state::{RecorderCommand, RecordingProgress};
use moonsnap_capture::timestamp::Timestamps;
use tauri::AppHandle;
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
    VideoSettingsSubType,
};

use super::super::cursor::{save_cursor_recording, CursorEventCapture};
use super::super::webcam::{
    global_feed_dimensions, start_global_feed, stop_capture_service, stop_global_feed,
    FeedWebcamEncoder,
};
use super::super::{
    emit_state_change, get_scap_display_bounds, get_webcam_settings, RecordingSettings,
};

/// Run video (MP4) capture using Windows Graphics Capture (WGC).
///
/// For MP4, `output_path` is a project folder containing:
///   - screen.mp4 (main recording)
///   - webcam.mp4 (optional)
///   - cursor.json (optional)
///   - project.json (video project metadata, created after recording)
///
/// Returns the actual recording duration in seconds.
pub fn run_video_capture(
    app: &AppHandle,
    settings: &RecordingSettings,
    output_path: &std::path::Path,
    progress: Arc<RecordingProgress>,
    command_rx: Receiver<RecorderCommand>,
    started_at: &str,
) -> MoonSnapResult<f64> {
    log::debug!(
        "[CAPTURE] Starting video capture, mode={:?}, quick_capture={}",
        settings.mode,
        settings.quick_capture
    );

    let finalization_plan =
        moonsnap_capture::recorder_finalization::build_finalization_plan(settings.quick_capture);
    let webcam_enabled_for_editor = if settings.quick_capture {
        false
    } else {
        get_webcam_settings().map(|s| s.enabled).unwrap_or(false)
    };
    let output_paths = moonsnap_capture::recorder_output_paths::plan_video_output_paths(
        output_path,
        settings.quick_capture,
        webcam_enabled_for_editor,
    );
    let screen_video_path = output_paths.screen_video_path;
    let webcam_output_path: Option<PathBuf> = output_paths.webcam_output_path;

    let capture_plan =
        moonsnap_capture::recorder_video_capture::CapturePlan::from_mode(&settings.mode);

    // Create capture source based on mode
    // All modes use Scap for consistent timestamp handling and native crop support.
    // - Window mode: Scap window capture
    // - Region mode: Scap with built-in crop_area
    // - Monitor mode: Scap full monitor capture
    //
    // For editor flow: capture WITHOUT cursor — cursor overlay handles it in the editor
    // with customization (size, style, visibility) and proper zoom tracking.
    // For quick capture: bake cursor into video if include_cursor is enabled,
    // since there's no editor to add it later.
    let bake_cursor = settings.quick_capture && settings.include_cursor;
    let (capture_source, first_frame) =
        moonsnap_capture::recorder_video_capture::create_capture_source(
            &capture_plan,
            settings.fps,
            bake_cursor,
        )?;

    let first_frame_dims = first_frame.as_ref().map(|(w, h, _)| (*w, *h));
    let (width, height) = moonsnap_capture::recorder_video_capture::resolve_capture_dimensions(
        &capture_plan,
        first_frame_dims,
        (capture_source.width(), capture_source.height()),
    );

    let bitrate = settings.calculate_bitrate(width, height);
    let max_duration = settings
        .max_duration_secs
        .map(|s| Duration::from_secs(s as u64));

    // Determine if we need audio
    let _capture_audio =
        settings.audio.capture_system_audio || settings.audio.microphone_device_index.is_some();

    // Create video encoder with audio enabled if needed
    // Use H.264 codec for better browser/WebView compatibility (HEVC requires paid extension)
    let video_settings = VideoSettingsBuilder::new(width, height)
        .sub_type(VideoSettingsSubType::H264)
        .bitrate(bitrate)
        .frame_rate(settings.fps);

    // ALWAYS disable audio in VideoEncoder - windows-capture's MediaTranscoder
    // introduces audio jitter. Instead, we use MultiTrackAudioRecorder to capture
    // perfect WAV files, then mux with FFmpeg post-recording.
    let audio_settings = AudioSettingsBuilder::default().disabled(true);

    let mut encoder = VideoEncoder::new(
        video_settings,
        audio_settings,
        ContainerSettingsBuilder::default(),
        &screen_video_path,
    )
    .map_err(|e| format!("Failed to create encoder: {:?}", e))?;

    // === SHARED CONTROL FLAGS ===
    let should_stop = Arc::new(AtomicBool::new(false));
    let is_paused = Arc::new(AtomicBool::new(false));

    // NOTE: Cursor is now captured via CursorEventCapture (events + images)
    // and rendered by the video editor/exporter - not composited during recording.

    // === WEBCAM ENCODER SETUP (Feed-based) ===
    // Uses the camera feed subscription system for zero-copy frame sharing.
    let device_index = get_webcam_settings().map(|s| s.device_index).unwrap_or(0);
    let webcam_encoder: Option<FeedWebcamEncoder> =
        moonsnap_capture::recorder_webcam_lifecycle::maybe_start_webcam_encoder(
            webcam_output_path.as_deref(),
            device_index,
            |idx| {
                moonsnap_capture::recorder_webcam_feed::prepare_webcam_feed(
                    idx,
                    |inner_idx| start_global_feed(inner_idx).map_err(|e| e.to_string()),
                    global_feed_dimensions,
                    Duration::from_millis(200),
                    Duration::from_millis(10),
                    (1280, 720),
                )
            },
            |webcam_path, width, height| {
                FeedWebcamEncoder::with_pause_signal(
                    webcam_path,
                    width,
                    height,
                    Some(Arc::clone(&is_paused)),
                )
                .map_err(|e| e.to_string())
            },
        );

    // === MULTI-TRACK AUDIO RECORDING ===
    // Record system audio and microphone to separate WAV files for later mixing.
    // This enables independent volume control in the video editor.
    // Use shared flags so pause/resume affects multi-track audio too.
    let mut multitrack_audio =
        MultiTrackAudioRecorder::with_flags(Arc::clone(&should_stop), Arc::clone(&is_paused));

    // Audio files location depends on capture mode:
    // - Quick capture: output_path is a FILE (e.g., recording.mp4), so put audio as siblings
    // - Editor flow: output_path is a FOLDER, so put audio files inside
    let (system_audio_path, mic_audio_path) =
        moonsnap_capture::recorder_audio_paths::plan_audio_artifact_paths(
            output_path,
            settings.quick_capture,
            settings.audio.capture_system_audio,
            settings.audio.microphone_device_index.is_some(),
        );

    // Start multi-track audio recording
    if system_audio_path.is_some() || mic_audio_path.is_some() {
        log::debug!(
            "[AUDIO] Starting multi-track recording: system={:?}, mic={:?}",
            system_audio_path,
            mic_audio_path
        );
        if let Err(e) = multitrack_audio.start_with_device(
            system_audio_path.clone(),
            mic_audio_path.clone(),
            settings.audio.system_audio_device_id.clone(),
        ) {
            log::warn!("Failed to start multi-track audio: {}", e);
        }
    }

    // Pre-allocate frame buffers to avoid per-frame allocations
    let mut buffer_pool = FrameBufferPool::new(width, height);

    // Recording loop variables
    let frame_duration = Duration::from_secs_f64(1.0 / settings.fps as f64);

    // === START RECORDING ===
    // Recording state was already emitted before thread started (optimistic UI)
    log::debug!(
        "[RECORDING] Capture loop starting: {}x{} @ {}fps, webcam={}",
        width,
        height,
        settings.fps,
        webcam_encoder.is_some()
    );

    // Create shared start time using high-precision Timestamps.
    // This captures both Instant (for cursor) and PerformanceCounter (for precise sync).
    // The Timestamps struct ensures both use the exact same reference point.
    let timestamps = Timestamps::now();
    let start_time = timestamps.instant();

    // === CURSOR EVENT CAPTURE ===
    // Record cursor positions and clicks for auto-zoom in video editor.
    // Only used in editor flow (not quick capture) since cursor is baked into video for quick capture.
    // IMPORTANT: Start cursor capture with the SAME start_time as video to ensure
    // cursor timestamps are synchronized with video timestamps.
    // Pass the pause signal so cursor events are synchronized with video pause/resume.
    let mut cursor_event_capture =
        CursorEventCapture::with_pause_signal(Some(Arc::clone(&is_paused)));
    let cursor_data_path = if !settings.quick_capture {
        Some(output_path.join("cursor.json"))
    } else {
        None
    };

    // Get region for cursor capture (region mode, window mode, or monitor mode)
    // Cursor coordinates need to be normalized relative to the capture region,
    // so we need the region's screen-space bounds.
    let cursor_region = moonsnap_capture::recorder_cursor_region::resolve_cursor_region(
        &settings.mode,
        capture_plan.monitor_offset,
        get_window_rect,
        |monitor_index| {
            // CRITICAL: Use scap's display enumeration (same as video capture) to ensure
            // monitor_index refers to the same physical display for both video and cursor.
            get_scap_display_bounds(monitor_index)
        },
    );

    // Only start cursor capture for editor flow - use shared start_time for synchronization
    if !settings.quick_capture {
        if let Err(e) = cursor_event_capture.start_with_time(cursor_region, start_time) {
            log::warn!("Failed to start cursor event capture: {}", e);
        }
    }

    // Wait for a frame captured AFTER our start time.
    // Pre-buffered frames have timestamps before start_time, which would cause
    // cursor to appear ahead of video. We skip these stale frames.
    // Scap uses SystemTime (UNIX_EPOCH-based), stored in timestamps.system_time_100ns()
    let start_system_time = timestamps.system_time_100ns();
    let _first_frame_sync =
        moonsnap_capture::recorder_first_frame::wait_for_first_frame_after_start(
            || capture_source.get_frame(50).map(|f| f.timestamp_100ns),
            start_system_time,
            10,
        );

    let loop_result = moonsnap_capture::recorder_video_loop::run_video_capture_loop(
        moonsnap_capture::recorder_video_loop::VideoCaptureLoopConfig {
            command_rx: &command_rx,
            progress: progress.as_ref(),
            should_stop: should_stop.as_ref(),
            is_paused: is_paused.as_ref(),
            started_at,
            start_time,
            max_duration,
            frame_duration,
            frame_timeout_ms: 100,
            control_poll_timeout: Duration::from_millis(100),
            pacing_margin: Duration::from_micros(500),
            progress_every_frames: 30,
        },
        |timeout_ms| {
            capture_source.get_frame(timeout_ms).map(|f| {
                moonsnap_capture::recorder_video_loop::VideoLoopFrame {
                    data: f.data,
                    hardware_timestamp_100ns: f.timestamp_100ns,
                }
            })
        },
        |first_frame_offset_ms, frame_hw_timestamp| {
            cursor_event_capture.set_video_start_offset(first_frame_offset_ms);
            log::info!(
                "[RECORDING] First frame: offset={}ms (Instant-based, hw_ts={} for debug)",
                first_frame_offset_ms,
                frame_hw_timestamp
            );
        },
        |frame, actual_elapsed| {
            // Copy frame data to buffer
            let len = frame.data.len().min(buffer_pool.frame_size);
            buffer_pool.frame_buffer[..len].copy_from_slice(&frame.data[..len]);

            // Flip vertically using pooled buffer (both DXGI and WGC return top-down, encoder expects bottom-up)
            let flipped_data = buffer_pool.flip_vertical(width, height);

            // Get video timestamp using Instant-based timing (same as cursor)
            // This ensures video and cursor timestamps are in the same time domain.
            let video_timestamp = (actual_elapsed.as_micros() * 10) as i64;

            // Send video frame to encoder
            let _ = encoder.send_frame_buffer(flipped_data, video_timestamp);
            Ok(())
        },
        |state| emit_state_change(app, &state),
    )?;

    // Calculate recording stats
    let frame_count = loop_result.frame_count;
    let total_elapsed = start_time.elapsed();
    let final_pause_time = loop_result.total_pause_duration;
    let recording_duration = total_elapsed.saturating_sub(final_pause_time);
    let webcam_frames = webcam_encoder
        .as_ref()
        .map(|e| e.frames_written())
        .unwrap_or(0);
    log::debug!(
        "[RECORDING] Complete: {:.2}s, {} frames ({:.1} fps), webcam: {} frames",
        recording_duration.as_secs_f64(),
        frame_count,
        frame_count as f64 / recording_duration.as_secs_f64(),
        webcam_frames
    );

    // Check if recording was cancelled
    let was_cancelled = progress.was_cancelled();

    // Finish webcam encoder BEFORE stopping capture service
    // Pass the actual recording duration so webcam syncs perfectly with screen
    moonsnap_capture::recorder_webcam_lifecycle::finalize_webcam_encoder(
        webcam_encoder,
        webcam_output_path.as_deref(),
        was_cancelled,
        recording_duration.as_secs_f64(),
        |encoder| encoder.cancel(),
        |encoder, duration_secs| {
            encoder
                .finish_with_duration(duration_secs)
                .map_err(|e| e.to_string())
        },
        |path| {
            let _ = std::fs::remove_file(path);
        },
    );

    // Stop capture services (both old buffer and new feed system)
    stop_capture_service();
    stop_global_feed();
    let _ = multitrack_audio.stop();
    let cursor_recording = cursor_event_capture.stop();

    let finalize_outcome = moonsnap_capture::recorder_video_finalize::finalize_video_capture(
        moonsnap_capture::recorder_video_finalize::VideoFinalizeRequest {
            finalization_plan,
            was_cancelled,
            has_cursor_data_path: cursor_data_path.is_some(),
            cursor_event_count: cursor_recording.events.len(),
            has_webcam_output: webcam_output_path.is_some(),
            screen_video_path: screen_video_path.as_path(),
            system_audio_path: system_audio_path.as_deref(),
            microphone_audio_path: mic_audio_path.as_deref(),
        },
        || {
            if let Some(ref path) = cursor_data_path {
                save_cursor_recording(&cursor_recording, path).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        },
        || {
            encoder
                .finish()
                .map_err(|e| format!("Failed to finish encoding: {:?}", e))
        },
        mux_audio_to_video,
        make_video_faststart,
        |artifact_flags| {
            create_video_project_file(CreateVideoProjectRequest {
                project_folder: output_path,
                width,
                height,
                duration_ms: recording_duration.as_millis() as u64,
                fps: settings.fps,
                quick_capture: settings.quick_capture,
                has_webcam: artifact_flags.has_webcam,
                has_cursor_data: artifact_flags.has_cursor,
                has_system_audio: artifact_flags.has_system_audio,
                has_mic_audio: artifact_flags.has_microphone_audio,
            })
            .map_err(|e| e.to_string())
        },
    )?;

    // NOTE: Webcam sync is now handled in finish_with_duration() above.
    // The webcam encoder remuxes with correct FPS to match screen duration.
    if matches!(
        finalize_outcome,
        moonsnap_capture::recorder_video_finalize::VideoFinalizeOutcome::Cancelled
    ) {
        return Ok(recording_duration.as_secs_f64());
    }

    Ok(recording_duration.as_secs_f64())
}
