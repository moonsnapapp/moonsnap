//! Process exit/stderr helpers for export runtimes.

use std::io::Read;
use std::process::{Child, ExitStatus};

use crate::job_control::tail_lines;

/// Extract UTF-8 stderr text from a child process, if available.
pub fn take_child_stderr(child: &mut Child) -> Option<String> {
    let mut stderr = child.stderr.take()?;
    let mut buf = Vec::new();
    stderr.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// Failure details for non-success process exits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessFailure {
    pub status_code: Option<i32>,
    pub stderr_tail: Option<String>,
}

/// Convert process status + stderr into a success/failure decision.
pub fn ensure_process_success(
    status: ExitStatus,
    stderr: Option<&str>,
    stderr_tail_lines: usize,
) -> Result<(), ProcessFailure> {
    if status.success() {
        return Ok(());
    }
    let stderr_tail = stderr
        .map(|s| tail_lines(s, stderr_tail_lines))
        .filter(|s| !s.is_empty());
    Err(ProcessFailure {
        status_code: status.code(),
        stderr_tail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_process_success_returns_ok_for_success_status() {
        let status = std::process::Command::new("cmd")
            .args(["/C", "exit", "0"])
            .status()
            .unwrap();
        assert!(ensure_process_success(status, None, 20).is_ok());
    }

    #[test]
    fn ensure_process_success_returns_tail_for_failure_status() {
        let status = std::process::Command::new("cmd")
            .args(["/C", "exit", "7"])
            .status()
            .unwrap();
        let failure =
            ensure_process_success(status, Some("a\nb\nc\nd"), 2).expect_err("should fail");
        assert_eq!(failure.status_code, Some(7));
        assert_eq!(failure.stderr_tail.as_deref(), Some("c\nd"));
    }
}
