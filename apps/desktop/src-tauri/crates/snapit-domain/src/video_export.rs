//! Video export types used by the GPU-based export pipeline.

use serde::Serialize;
use ts_rs::TS;

use crate::video_project::ExportFormat;

// ============================================================================
// Export Types
// ============================================================================

/// Progress event sent during export.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ExportProgress {
    /// Current progress (0.0 - 1.0).
    pub progress: f32,
    /// Current stage of export.
    pub stage: ExportStage,
    /// Human-readable status message.
    pub message: String,
}

/// Stages of the export process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum ExportStage {
    /// Preparing export (building filter graph).
    Preparing,
    /// Encoding video.
    Encoding,
    /// Finalizing output file.
    Finalizing,
    /// Export complete.
    Complete,
    /// Export failed.
    Failed,
}

/// Result of a successful export.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct ExportResult {
    /// Path to the exported file.
    pub output_path: String,
    /// Duration in seconds.
    pub duration_secs: f64,
    /// File size in bytes.
    #[ts(type = "number")]
    pub file_size_bytes: u64,
    /// Output format.
    pub format: ExportFormat,
}
