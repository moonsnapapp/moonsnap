//! Webcam capture and compositing for video recording.
//!
//! Architecture (inspired by Cap):
//! - CameraFeed owns the camera hardware and broadcasts frames
//! - Multiple subscribers can register to receive frames:
//!   - Preview: converts to JPEG for browser display
//!   - Recording: encodes to H.264 for file output
//! - Frames are broadcast via non-blocking try_send (slow consumers drop frames)
//! - Same frames with same timestamps ensure perfect A/V sync

// Allow unused helpers - keeping for potential future use
#![allow(dead_code)]

mod capture;
mod channel_encoder;
mod device;
mod drift;
mod encoder;
mod feed;
mod gpu_preview;
mod native_frame;
mod preview;
mod preview_manager;
mod segmented;

// Legacy capture API (deprecated - use feed/preview instead)
pub use capture::{
    is_capture_running, start_capture_service, start_capture_with_receiver, stop_capture_service,
};

// New broadcast-based architecture
pub use feed::{global_feed_dimensions, start_global_feed, stop_global_feed};
// GPU-accelerated preview (Cap-style direct rendering)
pub use gpu_preview::{
    is_gpu_preview_running, start_gpu_preview, stop_gpu_preview, update_gpu_preview_state,
    GpuPreviewState,
};
pub use native_frame::NativeCameraFrame;
// composite_webcam no longer used - webcam composited via GPU in editor
pub use device::{get_webcam_devices, WebcamDevice};
pub use encoder::{FeedWebcamEncoder, WebcamEncoderPipe};
pub use segmented::{SegmentedRecordingResult, SegmentedWebcamMuxer};

// Centralized camera preview manager (Cap-style)
pub use preview_manager::{
    hide_camera_preview, is_camera_preview_showing, on_preview_window_close,
    show_camera_preview_async, update_preview_settings,
};

use moonsnap_core::error::{MoonSnapError, MoonSnapResult};
use std::time::Instant;

/// Webcam frame data ready for compositing.
///
/// **DEPRECATED**: Used by CPU-based webcam compositing, now replaced by GPU rendering.
#[allow(dead_code)]
#[derive(Clone)]
pub struct WebcamFrame {
    /// BGRA pixel data.
    pub bgra_data: Vec<u8>,
    /// Frame width in pixels.
    pub width: u32,
    /// Frame height in pixels.
    pub height: u32,
    /// Unique frame ID (increments with each new frame from camera).
    /// Used by encoder to detect new frames and avoid duplicates.
    pub frame_id: u64,
    /// Wall-clock time when this frame was captured.
    /// Used by encoder to calculate PTS for correct playback timing.
    pub captured_at: Instant,
}

impl Default for WebcamFrame {
    fn default() -> Self {
        Self {
            bgra_data: Vec::new(),
            width: 0,
            height: 0,
            frame_id: 0,
            captured_at: Instant::now(),
        }
    }
}

// === PREVIEW SERVICE FUNCTIONS ===
// Using new broadcast-based architecture (Cap-style)

/// Stop the webcam preview service.
pub fn stop_preview_service() {
    preview::stop_preview();
}

/// Start the webcam preview service.
pub fn start_preview_service(device_index: usize) -> MoonSnapResult<()> {
    preview::start_preview(device_index)
}

/// Check if the webcam preview is running.
pub fn is_preview_active() -> bool {
    preview::is_preview_running()
}

/// Get the latest webcam frame as base64 JPEG for browser preview.
/// Returns None if no frame available.
pub fn get_preview_frame_jpeg(_quality: u8) -> Option<String> {
    preview::get_preview_jpeg()
}

/// Get preview frame dimensions.
pub fn get_preview_dimensions() -> Option<(u32, u32)> {
    preview::get_preview_dimensions()
}

// === CHANNEL-BASED RECORDING INTEGRATION ===
// These functions provide a high-level API for using the new channel-based
// webcam recording system with drift tracking and optional segmentation.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread::JoinHandle;

/// Handle for segmented webcam recording.
pub struct SegmentedRecordingHandle {
    thread: Option<JoinHandle<SegmentedRecordingResult>>,
    stop_signal: Arc<AtomicBool>,
    /// Output directory for segments.
    pub output_dir: PathBuf,
}

impl SegmentedRecordingHandle {
    /// Check if recording is still running.
    pub fn is_running(&self) -> bool {
        self.thread
            .as_ref()
            .map(|t| !t.is_finished())
            .unwrap_or(false)
    }

    /// Signal stop and wait for completion.
    pub fn finish(mut self) -> MoonSnapResult<SegmentedRecordingResult> {
        use std::sync::atomic::Ordering;
        self.stop_signal.store(true, Ordering::SeqCst);

        self.thread
            .take()
            .ok_or_else(|| MoonSnapError::Other("Recorder thread already finished".to_string()))?
            .join()
            .map_err(|_| MoonSnapError::Other("Recorder thread panicked".to_string()))
    }

    /// Cancel recording and clean up.
    pub fn cancel(mut self) {
        use std::sync::atomic::Ordering;
        self.stop_signal.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        // Optionally clean up segments
        let _ = std::fs::remove_dir_all(&self.output_dir);
    }

    /// Get the manifest path.
    pub fn manifest_path(&self) -> PathBuf {
        self.output_dir.join("manifest.json")
    }
}

/// Start segmented webcam recording for crash recovery.
///
/// Records webcam to multiple short segments (~3 seconds each) with a manifest
/// file that enables recovery of completed segments if recording is interrupted.
///
/// # Arguments
/// * `device_index` - Webcam device index
/// * `output_dir` - Directory for segments and manifest
/// * `buffer_size` - Frame buffer size (default 30)
///
/// # Returns
/// A handle to control and finish the recording.
pub fn start_segmented_webcam_recording(
    device_index: usize,
    output_dir: PathBuf,
    buffer_size: Option<usize>,
) -> MoonSnapResult<SegmentedRecordingHandle> {
    let buf_size = buffer_size.unwrap_or(30);
    let recording_start = Instant::now();

    // Start capture service with channel
    let receiver = start_capture_with_receiver(device_index, buf_size)?;

    // Create segmented muxer
    let muxer = SegmentedWebcamMuxer::new(output_dir.clone(), receiver, recording_start);
    let stop_signal = muxer.stop_signal();

    // Spawn muxer thread
    let thread = std::thread::Builder::new()
        .name("webcam-segmented".to_string())
        .spawn(move || muxer.run())
        .map_err(|e| format!("Failed to spawn segmented recorder: {}", e))?;

    Ok(SegmentedRecordingHandle {
        thread: Some(thread),
        stop_signal,
        output_dir,
    })
}
