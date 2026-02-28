//! Shared frame pacing helpers for recording loops.

use std::time::Duration;

/// Compute the thread sleep duration for frame pacing.
///
/// Returns `None` if no sleep is required (frame interval already elapsed).
/// Returns `Some(Duration::ZERO)` when caller should skip this tick but not sleep.
pub fn compute_frame_pacing_sleep(
    elapsed_since_frame: Duration,
    frame_duration: Duration,
    busy_wait_margin: Duration,
) -> Option<Duration> {
    if elapsed_since_frame >= frame_duration {
        return None;
    }

    let remaining = frame_duration - elapsed_since_frame;
    if remaining > busy_wait_margin {
        Some(remaining - busy_wait_margin)
    } else {
        Some(Duration::ZERO)
    }
}

#[cfg(test)]
mod tests {
    use super::compute_frame_pacing_sleep;
    use std::time::Duration;

    #[test]
    fn no_sleep_when_frame_interval_elapsed() {
        let sleep = compute_frame_pacing_sleep(
            Duration::from_millis(17),
            Duration::from_millis(16),
            Duration::from_micros(500),
        );
        assert_eq!(sleep, None);
    }

    #[test]
    fn sleeps_for_remaining_minus_margin() {
        let sleep = compute_frame_pacing_sleep(
            Duration::from_millis(5),
            Duration::from_millis(16),
            Duration::from_millis(1),
        );
        assert_eq!(sleep, Some(Duration::from_millis(10)));
    }

    #[test]
    fn zero_sleep_when_remaining_within_margin() {
        let sleep = compute_frame_pacing_sleep(
            Duration::from_millis(15),
            Duration::from_millis(16),
            Duration::from_millis(2),
        );
        assert_eq!(sleep, Some(Duration::ZERO));
    }
}
