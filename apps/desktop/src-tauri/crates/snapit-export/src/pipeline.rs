//! Generic pipeline parallelism primitives for export jobs.
//!
//! Provides blocking/async tasks for decode and encode stages using bounded channels.

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Buffer size for decode and encode channels.
/// 8 frames provides good overlap and absorbs decode timing jitter.
pub const PIPELINE_BUFFER_SIZE: usize = 8;

/// Bundle of decoded frames for a single frame index.
#[derive(Debug, Clone)]
pub struct DecodedFrameBundle<TFrame> {
    /// Frame index (0-indexed from start of export).
    pub frame_idx: u32,
    /// Decoded screen frame.
    pub screen_frame: TFrame,
    /// Decoded webcam frame (if webcam enabled).
    pub webcam_frame: Option<TFrame>,
}

/// Spawn a decode task that pre-fetches frames into a bounded channel.
///
/// `read_screen` and `read_webcam` are adapter closures around concrete decoders.
pub fn spawn_decode_task<TFrame, ScreenRead, WebcamRead>(
    mut read_screen: ScreenRead,
    mut read_webcam: WebcamRead,
    total_frames: u32,
) -> (
    mpsc::Receiver<DecodedFrameBundle<TFrame>>,
    JoinHandle<Result<(), String>>,
)
where
    TFrame: Clone + Send + 'static,
    ScreenRead: FnMut() -> Result<Option<TFrame>, String> + Send + 'static,
    WebcamRead: FnMut() -> Result<Option<TFrame>, String> + Send + 'static,
{
    let (tx, rx) = mpsc::channel(PIPELINE_BUFFER_SIZE);

    let handle = tokio::task::spawn_blocking(move || {
        let mut frame_idx = 0u32;
        let mut last_webcam_frame: Option<TFrame> = None;

        loop {
            let screen_frame = match read_screen() {
                Ok(Some(frame)) => frame,
                Ok(None) => break,
                Err(e) => {
                    log::error!("[PIPELINE] Decode error: {}", e);
                    return Err(e);
                },
            };

            if let Ok(Some(frame)) = read_webcam() {
                last_webcam_frame = Some(frame);
            }
            let webcam_frame = last_webcam_frame.clone();

            let bundle = DecodedFrameBundle {
                frame_idx,
                screen_frame,
                webcam_frame,
            };

            if tx.blocking_send(bundle).is_err() {
                log::debug!("[PIPELINE] Decode channel closed");
                break;
            }

            frame_idx += 1;
            if frame_idx >= total_frames {
                break;
            }
        }

        log::debug!("[PIPELINE] Decode task complete: {} frames", frame_idx);
        Ok(())
    });

    (rx, handle)
}

/// Spawn an encode task that writes rendered frames through `write_frame`.
pub fn spawn_encode_task<WriteFrame>(
    mut write_frame: WriteFrame,
) -> (mpsc::Sender<Vec<u8>>, JoinHandle<Result<(), String>>)
where
    WriteFrame: FnMut(&[u8]) -> Result<(), String> + Send + 'static,
{
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(PIPELINE_BUFFER_SIZE);

    let handle = tokio::task::spawn_blocking(move || {
        let mut frame_count = 0u32;

        while let Some(rgba_data) = rx.blocking_recv() {
            if let Err(e) = write_frame(&rgba_data) {
                log::error!("[PIPELINE] Encode write error: {}", e);
                return Err(e);
            }
            frame_count += 1;
        }

        log::debug!("[PIPELINE] Encode task complete: {} frames", frame_count);
        Ok(())
    });

    (tx, handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_task_streams_frames_and_reuses_last_webcam_frame() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut screen = vec![1u32, 2u32, 3u32].into_iter();
            let mut webcam = vec![10u32].into_iter();

            let (mut rx, handle) =
                spawn_decode_task(move || Ok(screen.next()), move || Ok(webcam.next()), 3);

            let mut seen = Vec::new();
            while let Some(bundle) = rx.recv().await {
                seen.push((bundle.frame_idx, bundle.screen_frame, bundle.webcam_frame));
            }

            assert_eq!(
                seen,
                vec![(0, 1, Some(10)), (1, 2, Some(10)), (2, 3, Some(10)),]
            );
            assert!(handle.await.unwrap().is_ok());
        });
    }

    #[test]
    fn encode_task_writes_all_frames_in_order() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            use std::sync::{Arc, Mutex};
            let written = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
            let written_clone = written.clone();

            let (tx, handle) = spawn_encode_task(move |frame| {
                written_clone.lock().unwrap().push(frame.to_vec());
                Ok(())
            });

            tx.send(vec![1, 2, 3]).await.unwrap();
            tx.send(vec![4, 5]).await.unwrap();
            drop(tx);

            assert!(handle.await.unwrap().is_ok());
            assert_eq!(
                written.lock().unwrap().clone(),
                vec![vec![1, 2, 3], vec![4, 5]]
            );
        });
    }
}
