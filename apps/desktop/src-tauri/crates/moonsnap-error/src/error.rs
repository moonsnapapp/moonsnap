//! Central error types for MoonSnap.
//!
//! This module provides typed errors for better error handling across the codebase.
//! All errors implement `Serialize` for Tauri IPC compatibility.

use serde::Serialize;
use thiserror::Error;

/// Main error type for MoonSnap operations.
#[derive(Error, Debug)]
pub enum MoonSnapError {
    /// Screen capture failed
    #[error("Capture failed: {0}")]
    CaptureError(String),

    /// Storage operation failed
    #[error("Storage error: {0}")]
    StorageError(#[from] std::io::Error),

    /// Image encoding/decoding failed
    #[error("Encoding error: {0}")]
    EncodingError(String),

    /// FFmpeg binary not found
    #[error("FFmpeg not found. Please ensure FFmpeg is installed or bundled.")]
    FfmpegNotFound,

    /// Video/GIF recording failed (generic)
    #[error("Recording error: {0}")]
    RecordingError(String),

    /// DXGI Desktop Duplication API failed
    #[error("DXGI capture error: {0}")]
    DxgiError(String),

    /// Windows Graphics Capture failed
    #[error("WGC capture error: {0}")]
    WgcError(String),

    /// Audio capture (WASAPI/cpal) failed
    #[error("Audio capture error: {0}")]
    AudioCaptureError(String),

    /// Video/GIF encoder failed
    #[error("Encoder error: {0}")]
    EncoderError(String),

    /// Monitor not found by index
    #[error("Monitor not found at index {index}")]
    MonitorNotFound { index: usize },

    /// Window not found by ID
    #[error("Window not found with ID {id}")]
    WindowNotFound { id: u32 },

    /// Window management error
    #[error("Window error: {0}")]
    WindowError(String),

    /// JSON serialization/deserialization failed
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    /// Image processing error
    #[error("Image error: {0}")]
    ImageError(String),

    /// Lock poisoned (mutex/rwlock)
    #[error("Lock poisoned: {context}")]
    LockPoisoned { context: String },

    /// GPU rendering error (wgpu)
    #[error("GPU error: {0}")]
    GpuError(String),

    /// GPU device lost (recoverable - requires re-initialization)
    #[error("GPU device lost: {0}")]
    GpuDeviceLost(String),

    /// Video editor error
    #[error("Video editor error: {0}")]
    VideoEditorError(String),

    /// Export/render pipeline error
    #[error("Export error: {0}")]
    ExportError(String),

    /// Generic error with message
    #[error("{0}")]
    Other(String),
}

/// Implement Serialize for Tauri IPC compatibility.
/// Tauri requires errors to be serializable to send to the frontend.
impl Serialize for MoonSnapError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Serialize as the error message string
        serializer.serialize_str(&self.to_string())
    }
}

impl From<image::ImageError> for MoonSnapError {
    fn from(err: image::ImageError) -> Self {
        MoonSnapError::ImageError(err.to_string())
    }
}

impl From<String> for MoonSnapError {
    fn from(msg: String) -> Self {
        MoonSnapError::Other(msg)
    }
}

impl From<&str> for MoonSnapError {
    fn from(msg: &str) -> Self {
        MoonSnapError::Other(msg.to_string())
    }
}

/// Helper trait for converting mutex lock errors to MoonSnapError.
pub trait LockResultExt<T> {
    /// Convert a poisoned lock error to MoonSnapError with context.
    fn map_lock_err(self, context: &str) -> Result<T, MoonSnapError>;
}

impl<T> LockResultExt<T> for Result<T, std::sync::PoisonError<T>> {
    fn map_lock_err(self, context: &str) -> Result<T, MoonSnapError> {
        self.map_err(|_| MoonSnapError::LockPoisoned {
            context: context.to_string(),
        })
    }
}

/// Extension trait for adding context to Results.
///
/// Similar to anyhow's `Context` trait, this allows chaining context
/// information onto errors for better debugging.
///
/// # Example
/// ```ignore
/// use crate::error::{ResultExt, MoonSnapResult};
///
/// fn load_config() -> MoonSnapResult<Config> {
///     std::fs::read_to_string("config.json")
///         .context("failed to read config file")?;
///     // ...
/// }
/// ```
pub trait ResultExt<T> {
    /// Add context to an error, converting it to MoonSnapError::Other.
    fn context(self, msg: &str) -> MoonSnapResult<T>;

    /// Add context lazily (only evaluated on error).
    fn with_context<F: FnOnce() -> String>(self, f: F) -> MoonSnapResult<T>;
}

impl<T, E: std::fmt::Display> ResultExt<T> for Result<T, E> {
    fn context(self, msg: &str) -> MoonSnapResult<T> {
        self.map_err(|e| MoonSnapError::Other(format!("{}: {}", msg, e)))
    }

    fn with_context<F: FnOnce() -> String>(self, f: F) -> MoonSnapResult<T> {
        self.map_err(|e| MoonSnapError::Other(format!("{}: {}", f(), e)))
    }
}

/// Extension trait for adding context to Option types.
pub trait OptionExt<T> {
    /// Convert None to MoonSnapError::Other with the given message.
    fn context(self, msg: &str) -> MoonSnapResult<T>;

    /// Convert None to MoonSnapError::Other with a lazily evaluated message.
    fn with_context<F: FnOnce() -> String>(self, f: F) -> MoonSnapResult<T>;
}

impl<T> OptionExt<T> for Option<T> {
    fn context(self, msg: &str) -> MoonSnapResult<T> {
        self.ok_or_else(|| MoonSnapError::Other(msg.to_string()))
    }

    fn with_context<F: FnOnce() -> String>(self, f: F) -> MoonSnapResult<T> {
        self.ok_or_else(|| MoonSnapError::Other(f()))
    }
}

/// Type alias for Results using MoonSnapError.
pub type MoonSnapResult<T> = Result<T, MoonSnapError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = MoonSnapError::CaptureError("test".to_string());
        assert_eq!(err.to_string(), "Capture failed: test");
    }

    #[test]
    fn test_error_serialization() {
        let err = MoonSnapError::FfmpegNotFound;
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("FFmpeg not found"));
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err: MoonSnapError = io_err.into();
        assert!(matches!(err, MoonSnapError::StorageError(_)));
    }

    #[test]
    fn test_from_string() {
        let err: MoonSnapError = "test error".into();
        assert!(matches!(err, MoonSnapError::Other(_)));
    }

    #[test]
    fn test_video_recording_errors() {
        let dxgi = MoonSnapError::DxgiError("desktop duplication failed".to_string());
        assert!(dxgi.to_string().contains("DXGI"));

        let wgc = MoonSnapError::WgcError("capture item creation failed".to_string());
        assert!(wgc.to_string().contains("WGC"));

        let audio = MoonSnapError::AudioCaptureError("no input device".to_string());
        assert!(audio.to_string().contains("Audio"));

        let encoder = MoonSnapError::EncoderError("frame encoding failed".to_string());
        assert!(encoder.to_string().contains("Encoder"));
    }

    #[test]
    fn test_lock_poisoning_recovery() {
        use std::sync::Mutex;

        let mutex = Mutex::new(42);

        // Poison the mutex by panicking while holding the lock
        let _ = std::panic::catch_unwind(|| {
            let _guard = mutex.lock().unwrap();
            panic!("intentional panic to poison mutex");
        });

        // Verify the mutex is poisoned
        assert!(mutex.lock().is_err());

        // Verify LockResultExt properly converts the error
        let result = mutex.lock().map_lock_err("test_mutex");
        assert!(matches!(result, Err(MoonSnapError::LockPoisoned { .. })));

        // Verify the context is preserved
        if let Err(MoonSnapError::LockPoisoned { context }) = result {
            assert_eq!(context, "test_mutex");
        }
    }

    #[test]
    fn test_gpu_and_editor_errors() {
        let gpu = MoonSnapError::GpuError("shader compilation failed".to_string());
        assert!(gpu.to_string().contains("GPU error"));

        let gpu_lost = MoonSnapError::GpuDeviceLost("device removed".to_string());
        assert!(gpu_lost.to_string().contains("GPU device lost"));

        let editor = MoonSnapError::VideoEditorError("invalid timeline".to_string());
        assert!(editor.to_string().contains("Video editor error"));

        let export = MoonSnapError::ExportError("encoding failed".to_string());
        assert!(export.to_string().contains("Export error"));
    }

    #[test]
    fn test_result_ext_context() {
        let result: Result<(), &str> = Err("original error");
        let with_context = result.context("operation failed");

        assert!(matches!(with_context, Err(MoonSnapError::Other(_))));
        let msg = with_context.unwrap_err().to_string();
        assert!(msg.contains("operation failed"));
        assert!(msg.contains("original error"));
    }

    #[test]
    fn test_result_ext_with_context() {
        let result: Result<(), &str> = Err("inner");
        let with_context = result.with_context(|| format!("ctx-{}", 42));

        let msg = with_context.unwrap_err().to_string();
        assert!(msg.contains("ctx-42"));
        assert!(msg.contains("inner"));
    }

    #[test]
    fn test_result_ext_ok_passthrough() {
        let result: Result<i32, &str> = Ok(42);
        let with_context = result.context("should not appear");

        assert_eq!(with_context.unwrap(), 42);
    }

    #[test]
    fn test_option_ext_context() {
        let opt: Option<i32> = None;
        let result = opt.context("value was missing");

        assert!(matches!(result, Err(MoonSnapError::Other(_))));
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("value was missing"));
    }

    #[test]
    fn test_option_ext_some_passthrough() {
        let opt: Option<i32> = Some(42);
        let result = opt.context("should not appear");

        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn test_option_ext_with_context() {
        let opt: Option<i32> = None;
        let result = opt.with_context(|| format!("missing value at index {}", 5));

        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("missing value at index 5"));
    }
}
