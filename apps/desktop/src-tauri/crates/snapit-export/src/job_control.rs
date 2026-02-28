//! Export job control primitives (cancellation and progress mapping).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;

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

/// Global cancel token shared by app adapters using this crate.
static GLOBAL_EXPORT_CANCEL_TOKEN: OnceLock<ExportCancelToken> = OnceLock::new();

/// Get a process-global export cancel token instance.
pub fn export_cancel_token() -> &'static ExportCancelToken {
    GLOBAL_EXPORT_CANCEL_TOKEN.get_or_init(ExportCancelToken::new)
}

/// Request cancellation of the active export job.
pub fn request_cancel_export() {
    export_cancel_token().request_cancel();
}

/// Reset cancellation state before starting a new export job.
pub fn reset_cancel_export() {
    export_cancel_token().reset();
}

/// Check whether cancellation has been requested for the active export job.
pub fn is_export_cancelled() -> bool {
    export_cancel_token().is_cancelled()
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
    fn global_cancel_helpers_share_state() {
        reset_cancel_export();
        assert!(!is_export_cancelled());
        request_cancel_export();
        assert!(is_export_cancelled());
        reset_cancel_export();
        assert!(!is_export_cancelled());
    }
}
