//! Pipeline parallelism for video export.
//!
//! Provides blocking/async tasks for decoding and encoding that run concurrently
//! with the main render loop via bounded channels.

use std::io::Write;
use std::process::ChildStdin;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::rendering::stream_decoder::StreamDecoder;
use moonsnap_export::pipeline as shared_pipeline;
use moonsnap_render::types::DecodedFrame;

/// Bundle of decoded frames for a single frame index.
pub type DecodedFrameBundle = shared_pipeline::DecodedFrameBundle<DecodedFrame>;

/// Spawns a decode task that pre-fetches frames into a bounded channel.
///
/// Runs on a dedicated blocking thread via `spawn_blocking` since the
/// decoder now uses synchronous I/O. The tight read loop avoids async overhead.
///
/// Returns the receiver and task handle for cleanup.
pub fn spawn_decode_task(
    mut screen_decoder: StreamDecoder,
    mut webcam_decoder: Option<StreamDecoder>,
    total_frames: u32,
) -> (
    mpsc::Receiver<DecodedFrameBundle>,
    JoinHandle<Result<(), String>>,
) {
    shared_pipeline::spawn_decode_task(
        move || screen_decoder.next_frame(),
        move || {
            if let Some(ref mut decoder) = webcam_decoder {
                decoder.next_frame()
            } else {
                Ok(None)
            }
        },
        total_frames,
    )
}

/// Spawns an encode task that writes rendered frames to FFmpeg.
///
/// The task reads RGBA frames from the channel and writes them to FFmpeg's
/// stdin. Uses `spawn_blocking` since the entire loop is blocking I/O
/// (`stdin.write_all`), which would otherwise stall the tokio runtime.
///
/// Returns the sender and task handle for cleanup.
pub fn spawn_encode_task(
    mut stdin: ChildStdin,
) -> (mpsc::Sender<Vec<u8>>, JoinHandle<Result<(), String>>) {
    shared_pipeline::spawn_encode_task(move |rgba_data| {
        stdin
            .write_all(rgba_data)
            .map_err(|e| format!("FFmpeg write failed: {}", e))
    })
}
