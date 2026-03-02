//! Shared capture-thread lifecycle handling.
//!
//! This module centralizes post-capture completion/error/cancel handling so
//! app shells only provide runtime callbacks (state storage, event emission).

use std::any::Any;
use std::path::Path;

/// Execute a closure when dropped.
///
/// Used to guarantee thread cleanup hooks run even if lifecycle callbacks panic.
struct RunOnDrop<F: FnOnce()> {
    f: Option<F>,
}

impl<F: FnOnce()> RunOnDrop<F> {
    fn new(f: F) -> Self {
        Self { f: Some(f) }
    }
}

impl<F: FnOnce()> Drop for RunOnDrop<F> {
    fn drop(&mut self) {
        if let Some(f) = self.f.take() {
            f();
        }
    }
}

/// Finalize capture-thread result handling using callback-driven adapters.
pub fn finalize_capture_thread_result<FValidateVideo, FOnCancelled, FOnCompleted, FOnError>(
    output_path: &Path,
    capture_result: Result<f64, String>,
    was_cancelled: bool,
    mut validate_video_file: FValidateVideo,
    mut on_cancelled: FOnCancelled,
    mut on_completed: FOnCompleted,
    mut on_error: FOnError,
) where
    FValidateVideo: FnMut(&Path) -> Result<(), String>,
    FOnCancelled: FnMut(),
    FOnCompleted: FnMut(String, f64, u64),
    FOnError: FnMut(String),
{
    if was_cancelled {
        let _ = std::fs::remove_file(output_path);
        on_cancelled();
        return;
    }

    match capture_result {
        Ok(recording_duration) => {
            // Determine the actual encoded video file:
            // - Quick capture: output path points to video file.
            // - Editor flow: output path points to folder with screen.mp4.
            let video_file_path = if output_path.is_dir() {
                output_path.join("screen.mp4")
            } else {
                output_path.to_path_buf()
            };

            if let Err(validation_error) = validate_video_file(video_file_path.as_path()) {
                if output_path.is_dir() {
                    let _ = std::fs::remove_dir_all(output_path);
                } else {
                    let _ = std::fs::remove_file(output_path);
                }
                on_error(format!("Recording failed: {}", validation_error));
                return;
            }

            let file_size = std::fs::metadata(&video_file_path)
                .map(|m| m.len())
                .unwrap_or(0);
            on_completed(
                output_path.to_string_lossy().to_string(),
                recording_duration,
                file_size,
            );
        },
        Err(error_message) => {
            let _ = std::fs::remove_file(output_path);
            on_error(error_message);
        },
    }
}

/// Convert panic payload to a user/log-friendly message.
pub fn panic_payload_message(panic_payload: &(dyn Any + Send)) -> String {
    if let Some(msg) = panic_payload.downcast_ref::<&str>() {
        return (*msg).to_string();
    }
    if let Some(msg) = panic_payload.downcast_ref::<String>() {
        return msg.clone();
    }
    "Unknown panic".to_string()
}

/// Handle a capture-thread panic using callback-driven error reporting.
pub fn handle_capture_thread_panic<FOnError>(
    panic_payload: &(dyn Any + Send),
    mut on_error: FOnError,
) where
    FOnError: FnMut(String),
{
    on_error(format!(
        "Capture thread panicked: {}",
        panic_payload_message(panic_payload)
    ));
}

/// Run capture logic behind panic/result lifecycle handling.
///
/// This centralizes common capture-thread flow:
/// - catch unwind around capture logic
/// - resolve cancellation state
/// - dispatch completion/error callbacks
pub fn run_capture_thread_with_lifecycle<
    FCapture,
    FWasCancelled,
    FValidateVideo,
    FOnCancelled,
    FOnCompleted,
    FOnError,
>(
    output_path: &Path,
    capture: FCapture,
    was_cancelled: FWasCancelled,
    validate_video_file: FValidateVideo,
    on_cancelled: FOnCancelled,
    on_completed: FOnCompleted,
    on_error: FOnError,
) where
    FCapture: FnOnce() -> Result<f64, String>,
    FWasCancelled: FnOnce() -> bool,
    FValidateVideo: FnMut(&Path) -> Result<(), String>,
    FOnCancelled: FnMut(),
    FOnCompleted: FnMut(String, f64, u64),
    FOnError: FnMut(String),
{
    let mut on_error = on_error;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(capture));

    match result {
        Ok(capture_result) => finalize_capture_thread_result(
            output_path,
            capture_result,
            was_cancelled(),
            validate_video_file,
            on_cancelled,
            on_completed,
            &mut on_error,
        ),
        Err(panic_payload) => handle_capture_thread_panic(&*panic_payload, on_error),
    }
}

pub struct CaptureThreadLifecycleConfig<
    FBeforeCapture,
    FCapture,
    FWasCancelled,
    FValidateVideo,
    FOnCancelled,
    FOnCompleted,
    FOnError,
    FAfterCapture,
> {
    pub output_path: std::path::PathBuf,
    pub before_capture: FBeforeCapture,
    pub capture: FCapture,
    pub was_cancelled: FWasCancelled,
    pub validate_video_file: FValidateVideo,
    pub on_cancelled: FOnCancelled,
    pub on_completed: FOnCompleted,
    pub on_error: FOnError,
    pub after_capture: FAfterCapture,
}

/// Spawn a capture thread with standardized panic/result lifecycle handling.
///
/// This wrapper moves thread-scoped setup/teardown hooks into `snapit-capture`
/// so app shells only inject runtime adapters.
pub fn spawn_capture_thread_with_lifecycle<
    FBeforeCapture,
    FCapture,
    FWasCancelled,
    FValidateVideo,
    FOnCancelled,
    FOnCompleted,
    FOnError,
    FAfterCapture,
>(
    config: CaptureThreadLifecycleConfig<
        FBeforeCapture,
        FCapture,
        FWasCancelled,
        FValidateVideo,
        FOnCancelled,
        FOnCompleted,
        FOnError,
        FAfterCapture,
    >,
) -> std::thread::JoinHandle<()>
where
    FBeforeCapture: FnOnce() + Send + 'static,
    FCapture: FnOnce() -> Result<f64, String> + Send + 'static,
    FWasCancelled: FnOnce() -> bool + Send + 'static,
    FValidateVideo: FnMut(&Path) -> Result<(), String> + Send + 'static,
    FOnCancelled: FnMut() + Send + 'static,
    FOnCompleted: FnMut(String, f64, u64) + Send + 'static,
    FOnError: FnMut(String) + Send + 'static,
    FAfterCapture: FnOnce() + Send + 'static,
{
    let CaptureThreadLifecycleConfig {
        output_path,
        before_capture,
        capture,
        was_cancelled,
        validate_video_file,
        on_cancelled,
        on_completed,
        on_error,
        after_capture,
    } = config;

    std::thread::spawn(move || {
        before_capture();
        let _cleanup = RunOnDrop::new(after_capture);
        run_capture_thread_with_lifecycle(
            output_path.as_path(),
            capture,
            was_cancelled,
            validate_video_file,
            on_cancelled,
            on_completed,
            on_error,
        );
    })
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_capture_thread_result, handle_capture_thread_panic,
        run_capture_thread_with_lifecycle, spawn_capture_thread_with_lifecycle,
        CaptureThreadLifecycleConfig,
    };
    use std::any::Any;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("snapit_capture_lifecycle_{}_{}", name, nanos))
    }

    fn validate_ok(_path: &Path) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn cancelled_flow_removes_file_and_calls_cancelled_callback() {
        let output_path = temp_path("cancelled.mp4");
        std::fs::write(&output_path, [1u8, 2]).expect("write temp file");

        let cancelled_calls = Arc::new(AtomicU64::new(0));
        let completed_calls = Arc::new(AtomicU64::new(0));
        let error_calls = Arc::new(AtomicU64::new(0));

        finalize_capture_thread_result(
            &output_path,
            Ok(1.2),
            true,
            |_| Ok(()),
            {
                let cancelled_calls = Arc::clone(&cancelled_calls);
                move || {
                    cancelled_calls.fetch_add(1, Ordering::Relaxed);
                }
            },
            {
                let completed_calls = Arc::clone(&completed_calls);
                move |_, _, _| {
                    completed_calls.fetch_add(1, Ordering::Relaxed);
                }
            },
            {
                let error_calls = Arc::clone(&error_calls);
                move |_| {
                    error_calls.fetch_add(1, Ordering::Relaxed);
                }
            },
        );

        assert!(!output_path.exists());
        assert_eq!(cancelled_calls.load(Ordering::Relaxed), 1);
        assert_eq!(completed_calls.load(Ordering::Relaxed), 0);
        assert_eq!(error_calls.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn success_flow_validates_and_calls_completed_callback() {
        let output_path = temp_path("success.mp4");
        std::fs::write(&output_path, [9u8, 8, 7]).expect("write temp video");

        let validate_calls = Arc::new(AtomicU64::new(0));
        let completed_payload = Arc::new(Mutex::new(None::<(String, f64, u64)>));

        finalize_capture_thread_result(
            &output_path,
            Ok(3.4),
            false,
            {
                let validate_calls = Arc::clone(&validate_calls);
                move |_| {
                    validate_calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            },
            || {},
            {
                let completed_payload = Arc::clone(&completed_payload);
                move |path, duration, size| {
                    *completed_payload.lock().expect("completed payload lock") =
                        Some((path, duration, size));
                }
            },
            |_| {},
        );

        let payload = completed_payload
            .lock()
            .expect("completed payload lock")
            .clone()
            .expect("completed payload value");

        let _ = std::fs::remove_file(&output_path);

        assert_eq!(validate_calls.load(Ordering::Relaxed), 1);
        assert_eq!(payload.0, output_path.to_string_lossy().to_string());
        assert_eq!(payload.1, 3.4);
        assert_eq!(payload.2, 3);
    }

    #[test]
    fn validation_failure_removes_project_dir_and_calls_error_callback() {
        let output_dir = temp_path("validation_fail_project");
        std::fs::create_dir_all(&output_dir).expect("create output dir");
        std::fs::write(output_dir.join("screen.mp4"), [1u8]).expect("write screen.mp4");

        let error_messages = Arc::new(Mutex::new(Vec::<String>::new()));

        finalize_capture_thread_result(
            &output_dir,
            Ok(2.0),
            false,
            |_video_path| Err("invalid moov".to_string()),
            || {},
            |_, _, _| {},
            {
                let error_messages = Arc::clone(&error_messages);
                move |message| {
                    error_messages
                        .lock()
                        .expect("error message lock")
                        .push(message);
                }
            },
        );

        let errors = error_messages.lock().expect("error message lock");
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("Recording failed: invalid moov"));
        assert!(!output_dir.exists());
    }

    #[test]
    fn capture_error_calls_error_callback() {
        let output_path = temp_path("capture_error.mp4");
        std::fs::write(&output_path, [5u8]).expect("write temp file");

        let error_messages = Arc::new(Mutex::new(Vec::<String>::new()));

        finalize_capture_thread_result(
            &output_path,
            Err("encoder failed".to_string()),
            false,
            |_| Ok(()),
            || {},
            |_, _, _| {},
            {
                let error_messages = Arc::clone(&error_messages);
                move |message| {
                    error_messages
                        .lock()
                        .expect("error message lock")
                        .push(message);
                }
            },
        );

        let errors = error_messages.lock().expect("error message lock");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0], "encoder failed");
        assert!(!output_path.exists());
    }

    #[test]
    fn panic_handler_formats_and_forwards_message() {
        let message = Arc::new(Mutex::new(None::<String>));
        let payload: Box<dyn Any + Send> = Box::new("panic text");

        handle_capture_thread_panic(&*payload, {
            let message = Arc::clone(&message);
            move |m| {
                *message.lock().expect("panic message lock") = Some(m);
            }
        });

        assert_eq!(
            message.lock().expect("panic message lock").as_deref(),
            Some("Capture thread panicked: panic text")
        );
    }

    #[test]
    fn panic_handler_handles_unknown_payload() {
        let message = Arc::new(Mutex::new(None::<String>));
        let payload: Box<dyn Any + Send> = Box::new(42_u32);

        handle_capture_thread_panic(&*payload, {
            let message = Arc::clone(&message);
            move |m| {
                *message.lock().expect("panic message lock") = Some(m);
            }
        });

        assert_eq!(
            message.lock().expect("panic message lock").as_deref(),
            Some("Capture thread panicked: Unknown panic")
        );
    }

    #[test]
    fn success_editor_flow_validates_screen_mp4_inside_folder() {
        let output_dir = temp_path("editor_flow_project");
        std::fs::create_dir_all(&output_dir).expect("create output dir");
        let screen_path = output_dir.join("screen.mp4");
        std::fs::write(&screen_path, [1u8, 2, 3, 4]).expect("write screen.mp4");

        let validated_path = Arc::new(Mutex::new(None::<String>));
        let completed_size = Arc::new(Mutex::new(None::<u64>));

        finalize_capture_thread_result(
            &output_dir,
            Ok(5.0),
            false,
            {
                let validated_path = Arc::clone(&validated_path);
                move |path| {
                    *validated_path.lock().expect("validated path lock") =
                        Some(path.to_string_lossy().to_string());
                    Ok(())
                }
            },
            || {},
            {
                let completed_size = Arc::clone(&completed_size);
                move |_path, _duration, size| {
                    *completed_size.lock().expect("completed size lock") = Some(size);
                }
            },
            |_| {},
        );

        let _ = std::fs::remove_dir_all(&output_dir);

        assert_eq!(
            validated_path
                .lock()
                .expect("validated path lock")
                .as_deref(),
            Some(screen_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            *completed_size.lock().expect("completed size lock"),
            Some(4)
        );
    }

    #[test]
    fn success_allows_missing_metadata_as_zero_size() {
        let output_path = temp_path("missing_metadata.mp4");
        // Intentionally do not create the file to ensure metadata fallback works.

        let completed_size = Arc::new(Mutex::new(None::<u64>));

        finalize_capture_thread_result(
            Path::new(&output_path),
            Ok(1.0),
            false,
            |_| Ok(()),
            || {},
            {
                let completed_size = Arc::clone(&completed_size);
                move |_path, _duration, size| {
                    *completed_size.lock().expect("completed size lock") = Some(size);
                }
            },
            |_| {},
        );

        assert_eq!(
            *completed_size.lock().expect("completed size lock"),
            Some(0)
        );
    }

    #[test]
    fn run_capture_thread_with_lifecycle_completes_successfully() {
        let output_path = temp_path("run_lifecycle_success.mp4");
        std::fs::write(&output_path, [1u8, 2, 3]).expect("write temp file");

        let completed = Arc::new(Mutex::new(None::<(String, f64, u64)>));
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));

        run_capture_thread_with_lifecycle(
            &output_path,
            || Ok(2.5),
            || false,
            |_| Ok(()),
            || {},
            {
                let completed = Arc::clone(&completed);
                move |path, duration, size| {
                    *completed.lock().expect("completed lock") = Some((path, duration, size));
                }
            },
            {
                let errors = Arc::clone(&errors);
                move |msg| {
                    errors.lock().expect("errors lock").push(msg);
                }
            },
        );

        let payload = completed
            .lock()
            .expect("completed lock")
            .clone()
            .expect("completed payload");
        assert_eq!(payload.0, output_path.to_string_lossy().to_string());
        assert_eq!(payload.1, 2.5);
        assert_eq!(payload.2, 3);
        assert!(errors.lock().expect("errors lock").is_empty());

        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn run_capture_thread_with_lifecycle_reports_capture_error() {
        let output_path = temp_path("run_lifecycle_panic.mp4");
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));

        run_capture_thread_with_lifecycle(
            &output_path,
            || -> Result<f64, String> { Err("boom".to_string()) },
            || false,
            |_| Ok(()),
            || {},
            |_, _, _| {},
            {
                let errors = Arc::clone(&errors);
                move |msg| {
                    errors.lock().expect("errors lock").push(msg);
                }
            },
        );

        let errors = errors.lock().expect("errors lock");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0], "boom");
    }

    #[test]
    fn spawn_capture_thread_runs_before_and_after_hooks() {
        let output_path = temp_path("spawn_lifecycle_success.mp4");
        std::fs::write(&output_path, [1u8, 2, 3]).expect("write temp file");

        let before_calls = Arc::new(AtomicU64::new(0));
        let after_calls = Arc::new(AtomicU64::new(0));
        let completed = Arc::new(AtomicU64::new(0));

        let handle = spawn_capture_thread_with_lifecycle(CaptureThreadLifecycleConfig {
            output_path: output_path.clone(),
            before_capture: {
                let before_calls = Arc::clone(&before_calls);
                move || {
                    before_calls.fetch_add(1, Ordering::Relaxed);
                }
            },
            capture: || Ok(1.0),
            was_cancelled: || false,
            validate_video_file: validate_ok,
            on_cancelled: || {},
            on_completed: {
                let completed = Arc::clone(&completed);
                move |_, _, _| {
                    completed.fetch_add(1, Ordering::Relaxed);
                }
            },
            on_error: |_| {},
            after_capture: {
                let after_calls = Arc::clone(&after_calls);
                move || {
                    after_calls.fetch_add(1, Ordering::Relaxed);
                }
            },
        });

        handle.join().expect("join capture thread");
        let _ = std::fs::remove_file(&output_path);

        assert_eq!(before_calls.load(Ordering::Relaxed), 1);
        assert_eq!(completed.load(Ordering::Relaxed), 1);
        assert_eq!(after_calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn spawn_capture_thread_runs_after_hook_on_capture_error() {
        let output_path = temp_path("spawn_lifecycle_error.mp4");
        let after_calls = Arc::new(AtomicU64::new(0));
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));

        let handle = spawn_capture_thread_with_lifecycle(CaptureThreadLifecycleConfig {
            output_path,
            before_capture: || {},
            capture: || -> Result<f64, String> { Err("thread error test".to_string()) },
            was_cancelled: || false,
            validate_video_file: validate_ok,
            on_cancelled: || {},
            on_completed: |_, _, _| {},
            on_error: {
                let errors = Arc::clone(&errors);
                move |msg| {
                    errors.lock().expect("errors lock").push(msg);
                }
            },
            after_capture: {
                let after_calls = Arc::clone(&after_calls);
                move || {
                    after_calls.fetch_add(1, Ordering::Relaxed);
                }
            },
        });

        handle.join().expect("join capture thread");

        assert_eq!(after_calls.load(Ordering::Relaxed), 1);
        let errors = errors.lock().expect("errors lock");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0], "thread error test");
    }
}
