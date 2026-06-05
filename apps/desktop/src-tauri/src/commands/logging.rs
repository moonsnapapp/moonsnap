//! Unified logging system for MoonSnap.
//!
//! Provides persistent file logging for both frontend and backend,
//! with automatic log rotation and cleanup.

use chrono::Local;
use moonsnap_error::error::MoonSnapResult;
use parking_lot::Mutex;
use serde::Serialize;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

/// Maximum log file size before rotation (5MB)
const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024;

/// Maximum number of log files to keep
const MAX_LOG_FILES: usize = 5;

lazy_static::lazy_static! {
    /// Global log file handle
    static ref LOG_FILE: Mutex<Option<File>> = Mutex::new(None);
    /// Log directory path
    static ref LOG_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
}

/// Log levels matching frontend
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsManifest {
    generated_at: String,
    app_version: String,
    os: String,
    arch: String,
    debug_build: bool,
    bundle_dir: String,
    log_dir: String,
    app_data_dir: Option<String>,
    app_config_dir: Option<String>,
    app_cache_dir: Option<String>,
    current_exe: Option<String>,
    recent_log_lines: usize,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogLevel::Debug => write!(f, "DEBUG"),
            LogLevel::Info => write!(f, "INFO"),
            LogLevel::Warn => write!(f, "WARN"),
            LogLevel::Error => write!(f, "ERROR"),
        }
    }
}

/// Initialize the logging system
pub fn init_logging(app: &AppHandle) -> MoonSnapResult<()> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    // Create log directory if it doesn't exist
    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log directory: {}", e))?;

    // Store log directory for later use
    {
        let mut dir = LOG_DIR.lock();
        *dir = Some(log_dir.clone());
    }

    // Open or create today's log file
    let log_file_path = get_current_log_path(&log_dir);
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    {
        let mut log_file = LOG_FILE.lock();
        *log_file = Some(file);
    }

    // Log startup
    log_internal(LogLevel::Info, "MoonSnap", "Logging system initialized");
    log_internal(
        LogLevel::Info,
        "MoonSnap",
        &format!("Log directory: {:?}", log_dir),
    );

    // Cleanup old log files
    cleanup_old_logs(&log_dir);

    Ok(())
}

/// Get the path for the current log file (one per day)
fn get_current_log_path(log_dir: &Path) -> PathBuf {
    let date = Local::now().format("%Y-%m-%d");
    log_dir.join(format!("moonsnap_{}.log", date))
}

/// Clean up old log files, keeping only the most recent MAX_LOG_FILES
fn cleanup_old_logs(log_dir: &Path) {
    if let Ok(entries) = fs::read_dir(log_dir) {
        let mut log_files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "log")
                    .unwrap_or(false)
            })
            .collect();

        // Sort by modification time (newest first)
        log_files.sort_by(|a, b| {
            let a_time = a.metadata().and_then(|m| m.modified()).ok();
            let b_time = b.metadata().and_then(|m| m.modified()).ok();
            b_time.cmp(&a_time)
        });

        // Remove old files beyond MAX_LOG_FILES
        for file in log_files.into_iter().skip(MAX_LOG_FILES) {
            let _ = fs::remove_file(file.path());
        }
    }
}

/// Check if log rotation is needed and rotate if necessary
fn check_rotation() {
    // Use safe locking - if lock is poisoned, skip rotation rather than panic
    let log_dir = {
        let dir = LOG_DIR.lock();
        match dir.as_ref() {
            Some(d) => d.clone(),
            None => return,
        }
    };

    let current_path = get_current_log_path(&log_dir);

    // Check file size
    if let Ok(metadata) = fs::metadata(&current_path) {
        if metadata.len() > MAX_LOG_SIZE {
            // Rotate: rename current file with timestamp
            let timestamp = Local::now().format("%Y-%m-%d_%H%M%S");
            let rotated_path = log_dir.join(format!("moonsnap_{}.log", timestamp));
            let _ = fs::rename(&current_path, &rotated_path);

            // Open new log file
            if let Ok(file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&current_path)
            {
                // Safe locking - skip update if mutex is poisoned
                let mut log_file = LOG_FILE.lock();
                *log_file = Some(file);
            }

            cleanup_old_logs(&log_dir);
        }
    }
}

/// Internal logging function
pub fn log_internal(level: LogLevel, source: &str, message: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_line = format!("[{}] [{}] [{}] {}\n", timestamp, level, source, message);

    // Write to file
    {
        let mut log_file = LOG_FILE.lock();
        if let Some(ref mut file) = *log_file {
            let _ = file.write_all(log_line.as_bytes());
            let _ = file.flush();
        }
    }

    // Also print to console in debug builds
    #[cfg(debug_assertions)]
    {
        match level {
            LogLevel::Error => eprintln!("{}", log_line.trim()),
            _ => println!("{}", log_line.trim()),
        }
    }

    // Check if rotation is needed
    check_rotation();
}

/// Log from Rust code
#[macro_export]
macro_rules! app_log {
    ($level:expr, $source:expr, $($arg:tt)*) => {
        $crate::commands::logging::log_internal($level, $source, &format!($($arg)*))
    };
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Write a log message from the frontend
#[command]
pub fn write_log(level: String, source: String, message: String) {
    let log_level = match level.to_lowercase().as_str() {
        "debug" => LogLevel::Debug,
        "info" => LogLevel::Info,
        "warn" | "warning" => LogLevel::Warn,
        "error" => LogLevel::Error,
        _ => LogLevel::Info,
    };

    // Keep persistent logs focused on operational signals.
    if log_level == LogLevel::Debug {
        return;
    }

    log_internal(log_level, &source, &message);
}

/// Write multiple log messages from the frontend (batch)
#[command]
pub fn write_logs(logs: Vec<(String, String, String)>) {
    for (level, source, message) in logs {
        write_log(level, source, message);
    }
}

/// Get the log directory path
#[command]
pub fn get_log_dir(app: AppHandle) -> MoonSnapResult<String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    Ok(log_dir.to_string_lossy().into_owned())
}

/// Open the log directory in file explorer
#[command]
pub async fn open_log_dir(app: AppHandle) -> MoonSnapResult<()> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}

/// Create a diagnostics folder with app metadata and copied logs.
#[command]
pub fn create_diagnostics_bundle(app: AppHandle) -> MoonSnapResult<String> {
    let generated_at = Local::now();
    let stamp = generated_at.format("%Y-%m-%d_%H%M%S").to_string();

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;
    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log directory: {}", e))?;

    let diagnostics_root = log_dir.join("diagnostics");
    let bundle_dir = diagnostics_root.join(format!("moonsnap-diagnostics-{}", stamp));
    let copied_logs_dir = bundle_dir.join("logs");
    fs::create_dir_all(&copied_logs_dir)
        .map_err(|e| format!("Failed to create diagnostics directory: {}", e))?;

    let recent_logs = get_recent_logs(app.clone(), Some(500))?;
    fs::write(bundle_dir.join("recent.log"), &recent_logs)
        .map_err(|e| format!("Failed to write recent logs: {}", e))?;

    copy_log_files(&log_dir, &copied_logs_dir)?;

    let manifest = DiagnosticsManifest {
        generated_at: generated_at.to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        debug_build: cfg!(debug_assertions),
        bundle_dir: bundle_dir.to_string_lossy().into_owned(),
        log_dir: log_dir.to_string_lossy().into_owned(),
        app_data_dir: app
            .path()
            .app_data_dir()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        app_config_dir: app
            .path()
            .app_config_dir()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        app_cache_dir: app
            .path()
            .app_cache_dir()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        current_exe: env::current_exe()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        recent_log_lines: recent_logs.lines().count(),
    };

    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize diagnostics manifest: {}", e))?;
    fs::write(bundle_dir.join("manifest.json"), manifest_json)
        .map_err(|e| format!("Failed to write diagnostics manifest: {}", e))?;

    log_internal(
        LogLevel::Info,
        "Diagnostics",
        &format!(
            "Created diagnostics bundle path={} recentLogLines={}",
            bundle_dir.display(),
            manifest.recent_log_lines
        ),
    );

    Ok(bundle_dir.to_string_lossy().into_owned())
}

fn copy_log_files(log_dir: &Path, target_dir: &Path) -> MoonSnapResult<()> {
    let entries = fs::read_dir(log_dir).map_err(|e| format!("Failed to read log directory: {}", e))?;

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let is_log = path.extension().map(|ext| ext == "log").unwrap_or(false);
        if !is_log {
            continue;
        }

        let Some(file_name) = path.file_name() else {
            continue;
        };

        fs::copy(&path, target_dir.join(file_name))
            .map_err(|e| format!("Failed to copy log file {}: {}", path.display(), e))?;
    }

    Ok(())
}

/// Get recent logs (last N lines) for debugging
#[command]
pub fn get_recent_logs(app: AppHandle, lines: Option<usize>) -> MoonSnapResult<String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let log_path = get_current_log_path(&log_dir);

    if !log_path.exists() {
        return Ok(String::new());
    }

    let content =
        fs::read_to_string(&log_path).map_err(|e| format!("Failed to read log file: {}", e))?;

    let max_lines = lines.unwrap_or(100);
    let recent: Vec<&str> = content.lines().rev().take(max_lines).collect();

    Ok(recent.into_iter().rev().collect::<Vec<_>>().join("\n"))
}
