//! Export job finalization helpers shared by app adapters.

use std::future::Future;
use std::path::Path;
use std::process::Child;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::frame_pipeline_state::{ExportLoopState, PendingCpuWork};
use crate::process_control::{ensure_process_success, take_child_stderr, ProcessFailure};

/// Non-fatal pipeline task issue observed while finalizing export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineTaskWarning {
    /// Pipeline stage name (`decode` or `encode`).
    pub stage: &'static str,
    /// Human-readable issue details.
    pub message: String,
}

async fn await_pipeline_task(
    stage: &'static str,
    handle: JoinHandle<Result<(), String>>,
) -> Option<PipelineTaskWarning> {
    match handle.await {
        Ok(Ok(())) => None,
        Ok(Err(err)) => Some(PipelineTaskWarning {
            stage,
            message: err,
        }),
        Err(err) => Some(PipelineTaskWarning {
            stage,
            message: format!("join error: {}", err),
        }),
    }
}

/// Await decode/encode pipeline tasks and collect non-fatal warnings.
pub async fn await_pipeline_tasks(
    decode_handle: JoinHandle<Result<(), String>>,
    encode_handle: JoinHandle<Result<(), String>>,
) -> Vec<PipelineTaskWarning> {
    let mut warnings = Vec::new();
    if let Some(w) = await_pipeline_task("decode", decode_handle).await {
        warnings.push(w);
    }
    if let Some(w) = await_pipeline_task("encode", encode_handle).await {
        warnings.push(w);
    }
    warnings
}

/// Summary of cancellation finalization side-effects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancelledFinalizeSummary {
    /// Non-fatal warnings observed while joining decode/encode tasks.
    pub pipeline_warnings: Vec<PipelineTaskWarning>,
    /// Whether a partial output file was removed.
    pub removed_partial_output: bool,
}

/// Finalize a cancelled export by joining pipeline tasks and cleaning FFmpeg output.
pub async fn finalize_cancelled_export(
    decode_handle: JoinHandle<Result<(), String>>,
    encode_handle: JoinHandle<Result<(), String>>,
    ffmpeg: &mut Child,
    output_path: &Path,
) -> CancelledFinalizeSummary {
    let pipeline_warnings = await_pipeline_tasks(decode_handle, encode_handle).await;
    let removed_partial_output = cancel_export_and_cleanup(ffmpeg, output_path);

    CancelledFinalizeSummary {
        pipeline_warnings,
        removed_partial_output,
    }
}

/// Summary of successful export finalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedFinalizeSummary {
    /// Non-fatal warnings observed while joining decode/encode tasks.
    pub pipeline_warnings: Vec<PipelineTaskWarning>,
    /// Final output file size in bytes.
    pub file_size_bytes: u64,
}

/// Drain queued pipeline readbacks and process each pending CPU frame.
///
/// Returns the number of drained frames processed.
pub async fn drain_pipeline_if_needed<
    CompleteReadback,
    CompleteReadbackFuture,
    ProcessCpuWork,
    ProcessCpuWorkFuture,
>(
    loop_state: &mut ExportLoopState,
    should_drain: bool,
    mut complete_readback: CompleteReadback,
    mut process_cpu_work: ProcessCpuWork,
) -> usize
where
    CompleteReadback: FnMut(usize) -> CompleteReadbackFuture,
    CompleteReadbackFuture: Future<Output = Vec<u8>>,
    ProcessCpuWork: FnMut(PendingCpuWork) -> ProcessCpuWorkFuture,
    ProcessCpuWorkFuture: Future<Output = ()>,
{
    if !should_drain {
        return 0;
    }

    let drain_cpu_work = loop_state
        .collect_drain_cpu_work(&mut complete_readback)
        .await;
    let drained_count = drain_cpu_work.len();

    for cpu_work in drain_cpu_work {
        process_cpu_work(cpu_work).await;
    }

    drained_count
}

/// Best-effort cancellation cleanup: stop FFmpeg and remove partial output file.
///
/// Returns `true` when a partial output file was removed.
pub fn cancel_export_and_cleanup(ffmpeg: &mut Child, output_path: &Path) -> bool {
    let _ = ffmpeg.kill();
    let _ = ffmpeg.wait();

    if output_path.exists() {
        return std::fs::remove_file(output_path).is_ok();
    }

    false
}

/// Failure details while finalizing FFmpeg output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EncoderFinalizeError {
    Wait(String),
    EncodeFailure(ProcessFailure),
    Metadata(String),
}

/// Wait for FFmpeg completion and return final output file size.
pub fn wait_for_encoder_and_output_size(
    ffmpeg: &mut Child,
    output_path: &Path,
    stderr_tail_lines: usize,
) -> Result<u64, EncoderFinalizeError> {
    let stderr_output = take_child_stderr(ffmpeg);
    let status = ffmpeg
        .wait()
        .map_err(|e| EncoderFinalizeError::Wait(format!("FFmpeg wait failed: {}", e)))?;
    ensure_process_success(status, stderr_output.as_deref(), stderr_tail_lines)
        .map_err(EncoderFinalizeError::EncodeFailure)?;

    std::fs::metadata(output_path)
        .map(|m| m.len())
        .map_err(|e| EncoderFinalizeError::Metadata(format!("Failed to read output file: {}", e)))
}

/// Finalize a completed export: join pipeline tasks and wait for FFmpeg output.
pub async fn finalize_completed_export(
    decode_handle: JoinHandle<Result<(), String>>,
    encode_handle: JoinHandle<Result<(), String>>,
    ffmpeg: &mut Child,
    output_path: &Path,
    stderr_tail_lines: usize,
) -> Result<CompletedFinalizeSummary, EncoderFinalizeError> {
    let pipeline_warnings = await_pipeline_tasks(decode_handle, encode_handle).await;
    let file_size_bytes = wait_for_encoder_and_output_size(ffmpeg, output_path, stderr_tail_lines)?;
    Ok(CompletedFinalizeSummary {
        pipeline_warnings,
        file_size_bytes,
    })
}

/// Finalize a completed export after explicitly closing the decode receiver.
///
/// Export jobs can stop early once enough output frames are rendered, even when
/// the decode task still has skipped source-gap frames left to send. Dropping
/// the receiver first ensures a blocked decode task exits before we await it.
pub async fn finalize_completed_export_with_decode_shutdown<T>(
    decode_rx: mpsc::Receiver<T>,
    decode_handle: JoinHandle<Result<(), String>>,
    encode_handle: JoinHandle<Result<(), String>>,
    ffmpeg: &mut Child,
    output_path: &Path,
    stderr_tail_lines: usize,
) -> Result<CompletedFinalizeSummary, EncoderFinalizeError> {
    drop(decode_rx);
    finalize_completed_export(
        decode_handle,
        encode_handle,
        ffmpeg,
        output_path,
        stderr_tail_lines,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame_pipeline_state::PendingCpuWork;
    use moonsnap_render::ZoomState;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("moonsnap_export_job_finalize_{}_{}", name, nanos))
    }

    #[test]
    fn await_pipeline_tasks_collects_task_error() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let decode = tokio::spawn(async { Ok(()) });
            let encode = tokio::spawn(async { Err::<(), _>("encode failed".to_string()) });

            let warnings = await_pipeline_tasks(decode, encode).await;
            assert_eq!(warnings.len(), 1);
            assert_eq!(warnings[0].stage, "encode");
            assert_eq!(warnings[0].message, "encode failed");
        });
    }

    #[test]
    fn await_pipeline_tasks_collects_join_error() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let decode = tokio::spawn(async { panic!("decode panic") });
            let encode = tokio::spawn(async { Ok(()) });

            let warnings = await_pipeline_tasks(decode, encode).await;
            assert_eq!(warnings.len(), 1);
            assert_eq!(warnings[0].stage, "decode");
            assert!(warnings[0].message.contains("join error"));
        });
    }

    #[test]
    fn finalize_cancelled_export_returns_warning_and_cleanup_status() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let output_path = temp_path("cancelled_output.mp4");
            std::fs::write(&output_path, [1u8]).expect("write output file");

            let decode = tokio::spawn(async { Err::<(), _>("decode fail".to_string()) });
            let encode = tokio::spawn(async { Ok(()) });

            let mut child = Command::new("cmd")
                .args(["/C", "ping -n 2 127.0.0.1 >nul"])
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn long-running child");

            let summary = finalize_cancelled_export(decode, encode, &mut child, &output_path).await;
            assert_eq!(summary.pipeline_warnings.len(), 1);
            assert_eq!(summary.pipeline_warnings[0].stage, "decode");
            assert!(summary.removed_partial_output);
            assert!(!output_path.exists());
        });
    }

    #[test]
    fn drain_pipeline_if_needed_processes_pending_and_readbacks() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
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

            let seen = Arc::new(Mutex::new(Vec::<u8>::new()));
            let seen_clone = Arc::clone(&seen);

            let drained = drain_pipeline_if_needed(
                &mut state,
                true,
                |idx| async move { vec![idx as u8] },
                move |cpu_work| {
                    let seen = Arc::clone(&seen_clone);
                    async move {
                        seen.lock().expect("seen lock").push(cpu_work.rgba_data[0]);
                    }
                },
            )
            .await;

            assert_eq!(drained, 3);
            assert_eq!(*seen.lock().expect("seen lock"), vec![42, 0, 1]);
        });
    }

    #[test]
    fn drain_pipeline_if_needed_skips_when_disabled() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut state = ExportLoopState::new(3, 30);
            state.pending_cpu = Some(PendingCpuWork {
                rgba_data: vec![9],
                camera_only_opacity: 0.0,
                source_time_ms: 0,
                zoom_state: ZoomState::identity(),
                output_frame_idx: 0,
            });

            let drained = drain_pipeline_if_needed(
                &mut state,
                false,
                |_idx| async move { vec![0] },
                |_cpu_work| async move {},
            )
            .await;

            assert_eq!(drained, 0);
            assert!(state.pending_cpu.is_some());
        });
    }

    #[test]
    fn wait_for_encoder_and_output_size_returns_size_on_success() {
        let output_path = temp_path("success.mp4");
        std::fs::write(&output_path, [1u8, 2, 3, 4]).expect("write output file");

        let mut child = Command::new("cmd")
            .args(["/C", "exit", "0"])
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn success child");

        let size = wait_for_encoder_and_output_size(&mut child, &output_path, 20)
            .expect("finalize should succeed");
        assert_eq!(size, 4);

        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn wait_for_encoder_and_output_size_reports_encode_failure() {
        let output_path = temp_path("failure.mp4");

        let mut child = Command::new("cmd")
            .args(["/C", "(echo bad 1>&2) & exit /b 7"])
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn failing child");

        let err = wait_for_encoder_and_output_size(&mut child, &output_path, 20)
            .expect_err("finalize should fail");

        match err {
            EncoderFinalizeError::EncodeFailure(failure) => {
                assert_eq!(failure.status_code, Some(7));
                assert!(failure
                    .stderr_tail
                    .as_deref()
                    .is_some_and(|s| s.contains("bad")));
            },
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[test]
    fn finalize_completed_export_returns_warnings_and_size() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let output_path = temp_path("completed_output.mp4");
            std::fs::write(&output_path, [1u8, 2, 3]).expect("write output file");

            let decode = tokio::spawn(async { Err::<(), _>("decode warning".to_string()) });
            let encode = tokio::spawn(async { Ok(()) });

            let mut child = Command::new("cmd")
                .args(["/C", "exit", "0"])
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn success child");

            let summary = finalize_completed_export(decode, encode, &mut child, &output_path, 20)
                .await
                .expect("finalize completed");

            assert_eq!(summary.pipeline_warnings.len(), 1);
            assert_eq!(summary.pipeline_warnings[0].stage, "decode");
            assert_eq!(summary.file_size_bytes, 3);

            let _ = std::fs::remove_file(output_path);
        });
    }

    #[test]
    fn finalize_completed_export_propagates_encoder_failure() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let output_path = temp_path("completed_failure.mp4");

            let decode = tokio::spawn(async { Ok(()) });
            let encode = tokio::spawn(async { Ok(()) });

            let mut child = Command::new("cmd")
                .args(["/C", "exit", "9"])
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn failing child");

            let err = finalize_completed_export(decode, encode, &mut child, &output_path, 20)
                .await
                .expect_err("finalize should fail");
            match err {
                EncoderFinalizeError::EncodeFailure(failure) => {
                    assert_eq!(failure.status_code, Some(9));
                },
                other => panic!("unexpected error: {:?}", other),
            }
        });
    }

    #[test]
    fn finalize_completed_export_with_decode_shutdown_closes_blocked_decode_sender() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let output_path = temp_path("completed_shutdown.mp4");
            std::fs::write(&output_path, [1u8, 2, 3]).expect("write output file");

            let (decode_tx, decode_rx) = mpsc::channel::<u8>(1);
            let decode = tokio::spawn(async move {
                if decode_tx.send(1).await.is_err() {
                    return Ok(());
                }
                if decode_tx.send(2).await.is_err() {
                    return Ok(());
                }
                Ok(())
            });
            let encode = tokio::spawn(async { Ok(()) });

            let mut child = Command::new("cmd")
                .args(["/C", "exit", "0"])
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn success child");

            let summary = tokio::time::timeout(
                std::time::Duration::from_millis(250),
                finalize_completed_export_with_decode_shutdown(
                    decode_rx,
                    decode,
                    encode,
                    &mut child,
                    &output_path,
                    20,
                ),
            )
            .await
            .expect("finalization should not hang")
            .expect("finalize should succeed");

            assert!(summary.pipeline_warnings.is_empty());
            assert_eq!(summary.file_size_bytes, 3);

            let _ = std::fs::remove_file(output_path);
        });
    }
}
