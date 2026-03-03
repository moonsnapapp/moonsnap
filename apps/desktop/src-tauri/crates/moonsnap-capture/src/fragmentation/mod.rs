//! Fragmentation support for crash-recoverable recordings.
//!
//! This module provides:
//! - `FragmentManifest` for tracking recording fragments
//! - Atomic file writing for crash safety
//! - Fragment file sync utilities

mod manifest;

pub use manifest::{atomic_write_json, sync_file, FragmentManifest};
