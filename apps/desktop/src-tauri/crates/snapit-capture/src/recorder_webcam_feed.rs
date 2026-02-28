//! Shared webcam-feed probing helpers.

use std::time::{Duration, Instant};

/// Start webcam feed and resolve dimensions with polling/fallback.
pub fn prepare_webcam_feed<FStart, FGetDims>(
    device_index: usize,
    mut start_feed: FStart,
    get_dimensions: FGetDims,
    wait_timeout: Duration,
    poll_interval: Duration,
    fallback: (u32, u32),
) -> (u32, u32)
where
    FStart: FnMut(usize) -> Result<(), String>,
    FGetDims: FnMut() -> Option<(u32, u32)>,
{
    if let Err(e) = start_feed(device_index) {
        log::warn!("[WEBCAM] Failed to start camera feed: {}", e);
    }

    wait_for_feed_dimensions(get_dimensions, wait_timeout, poll_interval, fallback)
}

/// Wait for webcam feed dimensions, with polling and fallback dimensions.
pub fn wait_for_feed_dimensions<F>(
    mut get_dimensions: F,
    wait_timeout: Duration,
    poll_interval: Duration,
    fallback: (u32, u32),
) -> (u32, u32)
where
    F: FnMut() -> Option<(u32, u32)>,
{
    let deadline = Instant::now() + wait_timeout;
    while Instant::now() < deadline {
        if let Some((w, h)) = get_dimensions() {
            if w > 0 && h > 0 {
                return (w, h);
            }
        }

        if !poll_interval.is_zero() {
            std::thread::sleep(poll_interval);
        }
    }

    get_dimensions().unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::{prepare_webcam_feed, wait_for_feed_dimensions};
    use std::cell::Cell;
    use std::time::Duration;

    #[test]
    fn returns_immediately_when_valid_dimensions_available() {
        let dims = wait_for_feed_dimensions(
            || Some((1920, 1080)),
            Duration::from_millis(10),
            Duration::from_millis(0),
            (1280, 720),
        );
        assert_eq!(dims, (1920, 1080));
    }

    #[test]
    fn falls_back_when_none_available() {
        let dims = wait_for_feed_dimensions(
            || None,
            Duration::from_millis(0),
            Duration::from_millis(0),
            (1280, 720),
        );
        assert_eq!(dims, (1280, 720));
    }

    #[test]
    fn ignores_zero_dimensions_and_uses_later_valid_value() {
        let calls = Cell::new(0usize);
        let dims = wait_for_feed_dimensions(
            || {
                let c = calls.get() + 1;
                calls.set(c);
                if c == 1 {
                    Some((0, 0))
                } else {
                    Some((640, 480))
                }
            },
            Duration::from_millis(1),
            Duration::from_millis(0),
            (1280, 720),
        );
        assert_eq!(dims, (640, 480));
    }

    #[test]
    fn prepare_webcam_feed_starts_and_returns_dimensions() {
        let started = Cell::new(false);
        let dims = prepare_webcam_feed(
            3,
            |idx| {
                started.set(true);
                assert_eq!(idx, 3);
                Ok(())
            },
            || Some((1024, 576)),
            Duration::from_millis(0),
            Duration::from_millis(0),
            (1280, 720),
        );

        assert!(started.get());
        assert_eq!(dims, (1024, 576));
    }

    #[test]
    fn prepare_webcam_feed_uses_fallback_after_start_error() {
        let dims = prepare_webcam_feed(
            0,
            |_idx| Err("start failed".to_string()),
            || None,
            Duration::from_millis(0),
            Duration::from_millis(0),
            (1280, 720),
        );
        assert_eq!(dims, (1280, 720));
    }
}
