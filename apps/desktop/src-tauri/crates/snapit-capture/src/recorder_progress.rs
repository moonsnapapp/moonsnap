//! Shared helpers for recording progress emission.

use snapit_domain::recording::RecordingState;

/// Emit a periodic `Recording` state using a caller-provided callback.
///
/// Returns `true` if emission happened for this frame.
pub fn maybe_emit_recording_progress<F>(
    frame_count: u64,
    cadence_frames: u64,
    started_at: &str,
    elapsed_secs: f64,
    mut emit: F,
) -> bool
where
    F: FnMut(RecordingState),
{
    if cadence_frames == 0 || frame_count == 0 || frame_count % cadence_frames != 0 {
        return false;
    }

    emit(RecordingState::Recording {
        started_at: started_at.to_string(),
        elapsed_secs,
        frame_count,
    });
    true
}

#[cfg(test)]
mod tests {
    use super::maybe_emit_recording_progress;
    use snapit_domain::recording::RecordingState;

    #[test]
    fn emits_on_cadence() {
        let mut emitted: Option<RecordingState> = None;
        let did_emit = maybe_emit_recording_progress(30, 30, "ts", 1.25, |state| {
            emitted = Some(state);
        });

        assert!(did_emit);
        match emitted {
            Some(RecordingState::Recording {
                started_at,
                elapsed_secs,
                frame_count,
            }) => {
                assert_eq!(started_at, "ts");
                assert_eq!(elapsed_secs, 1.25);
                assert_eq!(frame_count, 30);
            },
            _ => panic!("expected RecordingState::Recording emission"),
        }
    }

    #[test]
    fn does_not_emit_off_cadence() {
        let mut called = false;
        let did_emit = maybe_emit_recording_progress(29, 30, "ts", 1.0, |_| {
            called = true;
        });

        assert!(!did_emit);
        assert!(!called);
    }

    #[test]
    fn does_not_emit_with_zero_cadence() {
        let mut called = false;
        let did_emit = maybe_emit_recording_progress(30, 0, "ts", 1.0, |_| {
            called = true;
        });

        assert!(!did_emit);
        assert!(!called);
    }
}
