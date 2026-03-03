//! Shared helper for selecting the first frame captured after recording start.

/// Result of first-frame synchronization scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FirstFrameSyncResult {
    /// Number of stale frames skipped (captured before recording start).
    pub stale_frames_skipped: usize,
    /// Offset of the first accepted frame from recording start, in milliseconds.
    pub first_frame_offset_ms: Option<i64>,
}

/// Wait until a frame timestamp at/after `start_system_time_100ns` is observed.
///
/// The caller provides `next_frame_timestamp_100ns` so this helper can be reused with
/// different capture backends. The callback should return the next frame timestamp in
/// 100ns units since UNIX epoch, or `None` on timeout/end-of-stream.
pub fn wait_for_first_frame_after_start<F>(
    mut next_frame_timestamp_100ns: F,
    start_system_time_100ns: i64,
    max_stale_frames: usize,
) -> FirstFrameSyncResult
where
    F: FnMut() -> Option<i64>,
{
    let mut stale_frames_skipped = 0usize;

    loop {
        match next_frame_timestamp_100ns() {
            Some(frame_ts) => {
                if frame_ts > 0 && frame_ts >= start_system_time_100ns {
                    let offset_ms = (frame_ts - start_system_time_100ns) / 10_000;
                    log::debug!(
                        "[RECORDING] Skipped {} stale frames, first valid frame captured {}ms after start",
                        stale_frames_skipped,
                        offset_ms
                    );
                    return FirstFrameSyncResult {
                        stale_frames_skipped,
                        first_frame_offset_ms: Some(offset_ms),
                    };
                }

                stale_frames_skipped += 1;
                if stale_frames_skipped > max_stale_frames {
                    log::warn!(
                        "[RECORDING] Skipped {} stale frames, proceeding anyway",
                        stale_frames_skipped
                    );
                    return FirstFrameSyncResult {
                        stale_frames_skipped,
                        first_frame_offset_ms: None,
                    };
                }
            },
            None => {
                return FirstFrameSyncResult {
                    stale_frames_skipped,
                    first_frame_offset_ms: None,
                };
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{wait_for_first_frame_after_start, FirstFrameSyncResult};

    #[test]
    fn accepts_first_fresh_frame() {
        let start = 1_000_000i64;
        let mut frames = vec![Some(start + 20_000)].into_iter();
        let result = wait_for_first_frame_after_start(|| frames.next().flatten(), start, 10);

        assert_eq!(
            result,
            FirstFrameSyncResult {
                stale_frames_skipped: 0,
                first_frame_offset_ms: Some(2),
            }
        );
    }

    #[test]
    fn skips_stale_then_accepts_fresh() {
        let start = 1_000_000i64;
        let mut frames = vec![Some(start - 10_000), Some(start + 30_000)].into_iter();
        let result = wait_for_first_frame_after_start(|| frames.next().flatten(), start, 10);

        assert_eq!(
            result,
            FirstFrameSyncResult {
                stale_frames_skipped: 1,
                first_frame_offset_ms: Some(3),
            }
        );
    }

    #[test]
    fn stops_after_stale_limit() {
        let start = 1_000_000i64;
        let mut frames = vec![Some(start - 1), Some(start - 2), Some(start - 3)].into_iter();
        let result = wait_for_first_frame_after_start(|| frames.next().flatten(), start, 2);

        assert_eq!(
            result,
            FirstFrameSyncResult {
                stale_frames_skipped: 3,
                first_frame_offset_ms: None,
            }
        );
    }

    #[test]
    fn returns_none_offset_on_timeout() {
        let start = 1_000_000i64;
        let mut frames = vec![None].into_iter();
        let result = wait_for_first_frame_after_start(|| frames.next().flatten(), start, 10);

        assert_eq!(
            result,
            FirstFrameSyncResult {
                stale_frames_skipped: 0,
                first_frame_offset_ms: None,
            }
        );
    }
}
