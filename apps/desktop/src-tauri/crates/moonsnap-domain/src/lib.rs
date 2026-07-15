//! Shared domain models used by MoonSnap backend and frontend type generation.
//!
//! This crate re-exports types from focused sub-crates and owns
//! storage/export types used only by the main application crate.

// Re-export capture pipeline types
pub use moonsnap_capture_types::capture;
pub use moonsnap_capture_types::capture_settings;
pub use moonsnap_capture_types::recording;
pub use moonsnap_capture_types::webcam;

// Re-export editor pipeline types
pub use moonsnap_project_types::captions;
pub use moonsnap_project_types::video_project;

// Types owned by this crate (main-crate-only consumers)
pub mod storage;
pub mod video_export;
