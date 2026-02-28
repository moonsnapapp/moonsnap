//! Shared state container for double/triple-buffered export frame pipelines.

use std::future::Future;
use std::time::Instant;

use snapit_render::ZoomState;

use crate::timing::FrameTimingAccumulator;

/// Per-frame state for deferred CPU compositing (double-buffer pipeline).
#[derive(Debug)]
pub struct PendingCpuWork {
    pub rgba_data: Vec<u8>,
    pub camera_only_opacity: f64,
    pub source_time_ms: u64,
    pub zoom_state: ZoomState,
    pub output_frame_idx: u32,
}

/// Metadata for a frame whose GPU readback is still in-flight.
#[derive(Debug, Clone, Copy)]
pub struct PendingReadback {
    pub staging_buf_idx: usize,
    pub camera_only_opacity: f64,
    pub source_time_ms: u64,
    pub zoom_state: ZoomState,
    pub output_frame_idx: u32,
}

/// Mutable loop state for callback-driven export iteration.
#[derive(Debug)]
pub struct ExportLoopState {
    pub output_frame_count: u32,
    pub pending_cpu: Option<PendingCpuWork>,
    pub pending_readback_old: Option<PendingReadback>,
    pub pending_readback_new: Option<PendingReadback>,
    pub buf_idx: usize,
    pub t_decode_start: Instant,
    pub timing: FrameTimingAccumulator,
    staging_ring_len: usize,
}

impl ExportLoopState {
    /// Create loop state for a staging ring of fixed size.
    pub fn new(staging_ring_len: usize, timing_window_frames: usize) -> Self {
        let timing_window_frames = timing_window_frames.min(u32::MAX as usize) as u32;
        Self {
            output_frame_count: 0,
            pending_cpu: None,
            pending_readback_old: None,
            pending_readback_new: None,
            buf_idx: 0,
            t_decode_start: Instant::now(),
            timing: FrameTimingAccumulator::new(timing_window_frames),
            staging_ring_len: staging_ring_len.max(1),
        }
    }

    /// Queue readback metadata for a frame that was just submitted.
    pub fn enqueue_submitted_readback(
        &mut self,
        camera_only_opacity: f64,
        source_time_ms: u64,
        zoom_state: ZoomState,
    ) {
        self.pending_readback_old = self.pending_readback_new.take();
        self.pending_readback_new = Some(PendingReadback {
            staging_buf_idx: self.buf_idx,
            camera_only_opacity,
            source_time_ms,
            zoom_state,
            output_frame_idx: self.output_frame_count,
        });
        self.buf_idx = (self.buf_idx + 1) % self.staging_ring_len;
    }

    /// Take both in-flight readback slots (old then new) for drain processing.
    pub fn take_pending_readbacks_for_drain(&mut self) -> [Option<PendingReadback>; 2] {
        [
            self.pending_readback_old.take(),
            self.pending_readback_new.take(),
        ]
    }

    /// Promote the oldest queued readback into pending CPU work.
    ///
    /// Returns `true` when a readback existed and was promoted.
    pub async fn promote_oldest_readback_to_pending_cpu<F, Fut>(
        &mut self,
        mut complete_readback: F,
    ) -> bool
    where
        F: FnMut(usize) -> Fut,
        Fut: Future<Output = Vec<u8>>,
    {
        let Some(oldest_rb) = self.pending_readback_old.take() else {
            return false;
        };

        let rgba_data = complete_readback(oldest_rb.staging_buf_idx).await;
        self.pending_cpu = Some(PendingCpuWork {
            rgba_data,
            camera_only_opacity: oldest_rb.camera_only_opacity,
            source_time_ms: oldest_rb.source_time_ms,
            zoom_state: oldest_rb.zoom_state,
            output_frame_idx: oldest_rb.output_frame_idx,
        });
        true
    }

    /// Collect all pending CPU work for the drain phase.
    ///
    /// Includes existing `pending_cpu` plus both queued readback slots.
    pub async fn collect_drain_cpu_work<F, Fut>(
        &mut self,
        mut complete_readback: F,
    ) -> Vec<PendingCpuWork>
    where
        F: FnMut(usize) -> Fut,
        Fut: Future<Output = Vec<u8>>,
    {
        let mut out = Vec::new();

        if let Some(cpu_work) = self.pending_cpu.take() {
            out.push(cpu_work);
        }

        for rb in self
            .take_pending_readbacks_for_drain()
            .into_iter()
            .flatten()
        {
            let rgba_data = complete_readback(rb.staging_buf_idx).await;
            out.push(PendingCpuWork {
                rgba_data,
                camera_only_opacity: rb.camera_only_opacity,
                source_time_ms: rb.source_time_ms,
                zoom_state: rb.zoom_state,
                output_frame_idx: rb.output_frame_idx,
            });
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::runtime::Runtime;

    #[test]
    fn enqueue_rotates_readback_slots() {
        let mut state = ExportLoopState::new(3, 30);

        state.enqueue_submitted_readback(0.1, 100, ZoomState::identity());
        assert!(state.pending_readback_old.is_none());
        assert!(state.pending_readback_new.is_some());
        assert_eq!(state.buf_idx, 1);

        state.output_frame_count = 1;
        state.enqueue_submitted_readback(0.2, 200, ZoomState::identity());
        assert!(state.pending_readback_old.is_some());
        assert!(state.pending_readback_new.is_some());
        assert_eq!(state.buf_idx, 2);
    }

    #[test]
    fn drain_take_clears_slots() {
        let mut state = ExportLoopState::new(2, 30);
        state.enqueue_submitted_readback(0.1, 100, ZoomState::identity());
        state.output_frame_count = 1;
        state.enqueue_submitted_readback(0.2, 200, ZoomState::identity());

        let slots = state.take_pending_readbacks_for_drain();
        assert!(slots[0].is_some());
        assert!(slots[1].is_some());
        assert!(state.pending_readback_old.is_none());
        assert!(state.pending_readback_new.is_none());
    }

    #[test]
    fn promote_oldest_readback_to_pending_cpu() {
        let runtime = Runtime::new().expect("tokio runtime");
        runtime.block_on(async {
            let mut state = ExportLoopState::new(3, 30);
            state.enqueue_submitted_readback(0.1, 100, ZoomState::identity());
            state.output_frame_count = 1;
            state.enqueue_submitted_readback(0.2, 200, ZoomState::identity());

            let promoted = state
                .promote_oldest_readback_to_pending_cpu(
                    |idx| async move { vec![idx as u8, 9, 9, 9] },
                )
                .await;

            assert!(promoted);
            let cpu = state.pending_cpu.take().expect("pending cpu work");
            assert_eq!(cpu.rgba_data[0], 0);
            assert!((cpu.camera_only_opacity - 0.1).abs() < f64::EPSILON);
            assert_eq!(cpu.source_time_ms, 100);
            assert_eq!(cpu.output_frame_idx, 0);
            assert!(state.pending_readback_old.is_none());
            assert!(state.pending_readback_new.is_some());
        });
    }

    #[test]
    fn collect_drain_cpu_work_includes_pending_and_readbacks() {
        let runtime = Runtime::new().expect("tokio runtime");
        runtime.block_on(async {
            let mut state = ExportLoopState::new(3, 30);
            state.pending_cpu = Some(PendingCpuWork {
                rgba_data: vec![42],
                camera_only_opacity: 0.0,
                source_time_ms: 0,
                zoom_state: ZoomState::identity(),
                output_frame_idx: 7,
            });
            state.enqueue_submitted_readback(0.1, 100, ZoomState::identity());
            state.output_frame_count = 1;
            state.enqueue_submitted_readback(0.2, 200, ZoomState::identity());

            let drained = state
                .collect_drain_cpu_work(|idx| async move { vec![idx as u8] })
                .await;

            assert_eq!(drained.len(), 3);
            assert_eq!(drained[0].rgba_data, vec![42]);
            assert_eq!(drained[1].rgba_data, vec![0]);
            assert_eq!(drained[2].rgba_data, vec![1]);
            assert!(state.pending_cpu.is_none());
            assert!(state.pending_readback_old.is_none());
            assert!(state.pending_readback_new.is_none());
        });
    }
}
