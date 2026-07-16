//! Export job control primitives (cancellation and progress mapping).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};

/// Render stage progress baseline used by export pipeline.
pub const RENDER_PROGRESS_START: f32 = 0.08;
/// Render stage span reserved for frame processing progress.
pub const RENDER_PROGRESS_SPAN: f32 = 0.87;
/// Finalizing stage progress value.
pub const FINALIZING_PROGRESS: f32 = 0.95;

/// Calculated render-progress values for UI/status updates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderProgress {
    /// 0.0-1.0 frame progress ratio.
    pub ratio: f32,
    /// Absolute stage progress mapped into export lifecycle (0.0-1.0).
    pub stage_progress: f32,
    /// Rounded percentage for status text.
    pub percent: u32,
}

/// Calculate render-stage progress from encoded frame count.
pub fn render_progress(sent_frames: u32, total_frames: u32) -> RenderProgress {
    let ratio = if total_frames == 0 {
        0.0
    } else {
        (sent_frames as f32 / total_frames as f32).clamp(0.0, 1.0)
    };
    let stage_progress = RENDER_PROGRESS_START + ratio * RENDER_PROGRESS_SPAN;
    let percent = (ratio * 100.0).round() as u32;

    RenderProgress {
        ratio,
        stage_progress,
        percent,
    }
}

/// Return the last `line_count` lines from a multi-line string.
pub fn tail_lines(text: &str, line_count: usize) -> String {
    if line_count == 0 {
        return String::new();
    }
    text.lines()
        .rev()
        .take(line_count)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

/// Shareable cancel token for long-running export jobs.
#[derive(Debug, Clone)]
pub struct ExportCancelToken {
    flag: Arc<AtomicBool>,
}

impl ExportCancelToken {
    pub fn new() -> Self {
        Self {
            flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn request_cancel(&self) {
        self.flag.store(true, Ordering::Relaxed);
    }

    pub fn reset(&self) {
        self.flag.store(false, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

impl Default for ExportCancelToken {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
struct ActiveExportJob {
    id: String,
    cancel_requested: bool,
}

/// Identity-aware controller for the process-wide export slot.
#[derive(Debug, Default)]
pub struct ExportJobControl {
    active: Mutex<Option<ActiveExportJob>>,
}

impl ExportJobControl {
    /// Claim the single export slot for `job_id`.
    pub fn try_start(&self, job_id: &str) -> bool {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active.is_some() {
            return false;
        }
        *active = Some(ActiveExportJob {
            id: job_id.to_string(),
            cancel_requested: false,
        });
        true
    }

    /// Request cancellation only when `job_id` owns the export slot.
    pub fn request_cancel(&self, job_id: &str) -> bool {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(active) = active.as_mut() else {
            return false;
        };
        if active.id != job_id {
            return false;
        }
        active.cancel_requested = true;
        true
    }

    /// Check cancellation for the specified job without observing another job's state.
    pub fn is_cancelled(&self, job_id: &str) -> bool {
        let active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        active
            .as_ref()
            .is_some_and(|active| active.id == job_id && active.cancel_requested)
    }

    /// Release the export slot only when `job_id` still owns it.
    pub fn finish(&self, job_id: &str) -> bool {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if active.as_ref().is_some_and(|active| active.id == job_id) {
            *active = None;
            return true;
        }
        false
    }
}

static GLOBAL_EXPORT_JOB_CONTROL: OnceLock<ExportJobControl> = OnceLock::new();

fn export_job_control() -> &'static ExportJobControl {
    GLOBAL_EXPORT_JOB_CONTROL.get_or_init(ExportJobControl::default)
}

pub fn try_start_export(job_id: &str) -> bool {
    export_job_control().try_start(job_id)
}

pub fn request_cancel_export(job_id: &str) -> bool {
    export_job_control().request_cancel(job_id)
}

pub fn is_export_cancelled(job_id: &str) -> bool {
    export_job_control().is_cancelled(job_id)
}

pub fn finish_export(job_id: &str) -> bool {
    export_job_control().finish(job_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_progress_maps_ratio_into_stage_window() {
        let p0 = render_progress(0, 100);
        assert_eq!(p0.ratio, 0.0);
        assert!((p0.stage_progress - RENDER_PROGRESS_START).abs() < 0.0001);
        assert_eq!(p0.percent, 0);

        let p50 = render_progress(50, 100);
        assert!((p50.ratio - 0.5).abs() < 0.0001);
        assert!(
            (p50.stage_progress - (RENDER_PROGRESS_START + 0.5 * RENDER_PROGRESS_SPAN)).abs()
                < 0.0001
        );
        assert_eq!(p50.percent, 50);

        let p100 = render_progress(100, 100);
        assert!((p100.ratio - 1.0).abs() < 0.0001);
        assert!(
            (p100.stage_progress - (RENDER_PROGRESS_START + RENDER_PROGRESS_SPAN)).abs() < 0.0001
        );
        assert_eq!(p100.percent, 100);
    }

    #[test]
    fn render_progress_handles_zero_total_frames() {
        let p = render_progress(10, 0);
        assert_eq!(p.ratio, 0.0);
        assert!((p.stage_progress - RENDER_PROGRESS_START).abs() < 0.0001);
        assert_eq!(p.percent, 0);
    }

    #[test]
    fn cancel_token_can_be_requested_and_reset() {
        let token = ExportCancelToken::new();
        assert!(!token.is_cancelled());
        token.request_cancel();
        assert!(token.is_cancelled());
        token.reset();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn tail_lines_returns_requested_suffix() {
        let text = "a\nb\nc\nd";
        assert_eq!(tail_lines(text, 2), "c\nd");
        assert_eq!(tail_lines(text, 10), "a\nb\nc\nd");
        assert_eq!(tail_lines(text, 0), "");
    }

    #[test]
    fn cancel_export_targets_only_the_active_job() {
        let control = ExportJobControl::default();
        assert!(control.try_start("job-a"));
        assert!(!control.try_start("job-b"));
        assert!(!control.request_cancel("job-b"));
        assert!(!control.is_cancelled("job-a"));
        assert!(control.request_cancel("job-a"));
        assert!(control.is_cancelled("job-a"));
        assert!(!control.is_cancelled("job-b"));
        assert!(!control.finish("job-b"));
        assert!(control.finish("job-a"));
        assert!(control.try_start("job-b"));
        assert!(!control.is_cancelled("job-b"));
    }
}
