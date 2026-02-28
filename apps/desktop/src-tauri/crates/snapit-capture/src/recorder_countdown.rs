//! Shared countdown orchestration helpers for recording start.

use std::future::Future;
use std::time::Duration;

/// Run countdown ticks and return whether start was cancelled.
///
/// The countdown performs:
/// 1. Initial delay (for UI listener readiness).
/// 2. Per-second tick callbacks from `countdown_secs` down to `1`.
/// 3. A final cancel check before the caller starts recording.
pub async fn run_recording_countdown<FShouldCancel, FOnTick, FSleep, FSleepFuture>(
    countdown_secs: u32,
    initial_delay: Duration,
    mut should_cancel: FShouldCancel,
    mut on_tick: FOnTick,
    mut sleep: FSleep,
) -> bool
where
    FShouldCancel: FnMut() -> bool,
    FOnTick: FnMut(u32),
    FSleep: FnMut(Duration) -> FSleepFuture,
    FSleepFuture: Future<Output = ()>,
{
    if initial_delay > Duration::ZERO {
        sleep(initial_delay).await;
    }

    for seconds_remaining in (1..=countdown_secs).rev() {
        if should_cancel() {
            return true;
        }

        on_tick(seconds_remaining);
        sleep(Duration::from_secs(1)).await;
    }

    should_cancel()
}

#[cfg(test)]
mod tests {
    use super::run_recording_countdown;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
    use std::time::Duration;

    fn dummy_raw_waker() -> RawWaker {
        fn no_op(_: *const ()) {}
        fn clone(_: *const ()) -> RawWaker {
            dummy_raw_waker()
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, no_op, no_op, no_op);
        RawWaker::new(std::ptr::null(), &VTABLE)
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        let waker = unsafe { Waker::from_raw(dummy_raw_waker()) };
        let mut context = Context::from_waker(&waker);
        let mut future = Box::pin(future);

        loop {
            match Pin::new(&mut future).poll(&mut context) {
                Poll::Ready(output) => return output,
                Poll::Pending => std::thread::yield_now(),
            }
        }
    }

    #[test]
    fn runs_full_countdown_without_cancellation() {
        let ticks = Arc::new(Mutex::new(Vec::<u32>::new()));
        let sleeps = Arc::new(Mutex::new(Vec::<Duration>::new()));

        let cancelled = block_on(run_recording_countdown(
            3,
            Duration::from_millis(150),
            || false,
            {
                let ticks = Arc::clone(&ticks);
                move |seconds| {
                    ticks.lock().expect("ticks lock").push(seconds);
                }
            },
            {
                let sleeps = Arc::clone(&sleeps);
                move |delay| {
                    sleeps.lock().expect("sleeps lock").push(delay);
                    std::future::ready(())
                }
            },
        ));

        assert!(!cancelled);
        assert_eq!(*ticks.lock().expect("ticks lock"), vec![3, 2, 1]);
        assert_eq!(
            *sleeps.lock().expect("sleeps lock"),
            vec![
                Duration::from_millis(150),
                Duration::from_secs(1),
                Duration::from_secs(1),
                Duration::from_secs(1),
            ]
        );
    }

    #[test]
    fn cancels_before_first_tick_after_initial_delay() {
        let ticks = Arc::new(Mutex::new(Vec::<u32>::new()));
        let sleeps = Arc::new(Mutex::new(Vec::<Duration>::new()));
        let mut checks = 0_u32;

        let cancelled = block_on(run_recording_countdown(
            3,
            Duration::from_millis(150),
            move || {
                checks += 1;
                checks == 1
            },
            {
                let ticks = Arc::clone(&ticks);
                move |seconds| {
                    ticks.lock().expect("ticks lock").push(seconds);
                }
            },
            {
                let sleeps = Arc::clone(&sleeps);
                move |delay| {
                    sleeps.lock().expect("sleeps lock").push(delay);
                    std::future::ready(())
                }
            },
        ));

        assert!(cancelled);
        assert!(ticks.lock().expect("ticks lock").is_empty());
        assert_eq!(
            *sleeps.lock().expect("sleeps lock"),
            vec![Duration::from_millis(150)]
        );
    }

    #[test]
    fn cancels_after_one_tick() {
        let ticks = Arc::new(Mutex::new(Vec::<u32>::new()));
        let sleeps = Arc::new(Mutex::new(Vec::<Duration>::new()));
        let mut checks = 0_u32;

        let cancelled = block_on(run_recording_countdown(
            3,
            Duration::from_millis(150),
            move || {
                checks += 1;
                checks >= 2
            },
            {
                let ticks = Arc::clone(&ticks);
                move |seconds| {
                    ticks.lock().expect("ticks lock").push(seconds);
                }
            },
            {
                let sleeps = Arc::clone(&sleeps);
                move |delay| {
                    sleeps.lock().expect("sleeps lock").push(delay);
                    std::future::ready(())
                }
            },
        ));

        assert!(cancelled);
        assert_eq!(*ticks.lock().expect("ticks lock"), vec![3]);
        assert_eq!(
            *sleeps.lock().expect("sleeps lock"),
            vec![Duration::from_millis(150), Duration::from_secs(1)]
        );
    }

    #[test]
    fn final_cancel_check_triggers_after_last_tick() {
        let ticks = Arc::new(Mutex::new(Vec::<u32>::new()));
        let sleeps = Arc::new(Mutex::new(Vec::<Duration>::new()));
        let mut checks = 0_u32;

        let cancelled = block_on(run_recording_countdown(
            1,
            Duration::from_millis(150),
            move || {
                checks += 1;
                checks >= 2
            },
            {
                let ticks = Arc::clone(&ticks);
                move |seconds| {
                    ticks.lock().expect("ticks lock").push(seconds);
                }
            },
            {
                let sleeps = Arc::clone(&sleeps);
                move |delay| {
                    sleeps.lock().expect("sleeps lock").push(delay);
                    std::future::ready(())
                }
            },
        ));

        assert!(cancelled);
        assert_eq!(*ticks.lock().expect("ticks lock"), vec![1]);
        assert_eq!(
            *sleeps.lock().expect("sleeps lock"),
            vec![Duration::from_millis(150), Duration::from_secs(1)]
        );
    }
}
