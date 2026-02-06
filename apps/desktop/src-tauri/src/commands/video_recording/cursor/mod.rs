//! Cursor event capture for video editor features:
//! - Auto-zoom generation from click locations
//! - Cursor smooth movement interpolation
//! - Click highlight animations

pub mod events;

pub use events::{
    load_cursor_recording, save_cursor_recording, CursorEventCapture, CursorEventType,
    CursorRecording,
};
