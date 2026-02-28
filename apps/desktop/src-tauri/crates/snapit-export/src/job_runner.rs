//! Export job loop runner state machine.
//!
//! This module centralizes loop-control and progress-callback decisions while
//! leaving app/runtime-specific frame processing in adapter layers.

use crate::job_control::{render_progress, RenderProgress};

/// Loop-control decision for each render-iteration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopControl {
    Continue,
    StopCancelled,
    StopTargetReached,
}

/// Configuration for export job loop runner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportJobRunnerConfig {
    /// Total output frames expected for the job.
    pub total_output_frames: u32,
    /// Emit progress callback every N sent frames.
    pub progress_every_sent_frames: u32,
}

/// Reusable state machine for export render-loop orchestration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportJobRunner {
    cfg: ExportJobRunnerConfig,
}

impl ExportJobRunner {
    pub fn new(cfg: ExportJobRunnerConfig) -> Self {
        Self { cfg }
    }

    /// Determine loop behavior for current frame counters and cancel flag.
    pub fn loop_control(&self, output_frame_count: u32, is_cancelled: bool) -> LoopControl {
        if is_cancelled {
            return LoopControl::StopCancelled;
        }
        if output_frame_count >= self.cfg.total_output_frames {
            return LoopControl::StopTargetReached;
        }
        LoopControl::Continue
    }

    /// Emit render progress through callback when cadence threshold is reached.
    pub fn on_frame_sent<Emit>(&self, sent_count: u32, mut emit: Emit)
    where
        Emit: FnMut(RenderProgress),
    {
        if self.cfg.progress_every_sent_frames == 0 {
            return;
        }
        if !sent_count.is_multiple_of(self.cfg.progress_every_sent_frames) {
            return;
        }
        emit(render_progress(sent_count, self.cfg.total_output_frames));
    }

    /// Whether pending pipeline work should be drained after loop exits.
    pub fn should_drain_after_loop(&self, was_cancelled: bool) -> bool {
        !was_cancelled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runner(total: u32, every: u32) -> ExportJobRunner {
        ExportJobRunner::new(ExportJobRunnerConfig {
            total_output_frames: total,
            progress_every_sent_frames: every,
        })
    }

    #[test]
    fn loop_control_prioritizes_cancel_then_target_then_continue() {
        let r = runner(100, 10);
        assert_eq!(r.loop_control(0, true), LoopControl::StopCancelled);
        assert_eq!(r.loop_control(100, false), LoopControl::StopTargetReached);
        assert_eq!(r.loop_control(50, false), LoopControl::Continue);
    }

    #[test]
    fn frame_sent_emits_progress_on_configured_cadence() {
        let r = runner(100, 10);
        let mut emitted = Vec::new();
        r.on_frame_sent(9, |p| emitted.push(p));
        r.on_frame_sent(10, |p| emitted.push(p));
        r.on_frame_sent(20, |p| emitted.push(p));

        assert_eq!(emitted.len(), 2);
        assert_eq!(emitted[0].percent, 10);
        assert_eq!(emitted[1].percent, 20);
    }

    #[test]
    fn drain_only_when_not_cancelled() {
        let r = runner(100, 10);
        assert!(r.should_drain_after_loop(false));
        assert!(!r.should_drain_after_loop(true));
    }
}
