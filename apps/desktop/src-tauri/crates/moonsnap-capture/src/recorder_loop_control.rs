//! Shared recording-loop command and pause control helpers.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, RecvTimeoutError, TryRecvError};

use crate::state::{RecorderCommand, RecordingProgress};

/// Per-loop control flow after command processing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopControl {
    /// Continue with normal frame processing.
    Continue,
    /// Skip frame processing for this iteration.
    SkipFrame,
    /// Terminate the recording loop.
    Stop,
}

/// Pause tracking state shared across recording loop iterations.
#[derive(Debug, Clone)]
pub struct PauseState {
    paused: bool,
    pause_time: Duration,
    pause_start: Option<Instant>,
}

impl PauseState {
    /// Create a fresh pause state.
    pub fn new() -> Self {
        Self {
            paused: false,
            pause_time: Duration::ZERO,
            pause_start: None,
        }
    }

    /// Returns true if recording is currently paused.
    pub fn is_paused(&self) -> bool {
        self.paused
    }

    /// Elapsed active recording time excluding paused durations.
    pub fn active_elapsed(&self, start_time: Instant) -> Duration {
        start_time.elapsed().saturating_sub(self.pause_time)
    }

    /// Total paused duration including an in-progress pause window.
    pub fn total_pause_duration(&self) -> Duration {
        if let Some(ps) = self.pause_start {
            self.pause_time + ps.elapsed()
        } else {
            self.pause_time
        }
    }

    fn pause(&mut self, progress: &RecordingProgress, is_paused: &AtomicBool) {
        if !self.paused {
            self.paused = true;
            self.pause_start = Some(Instant::now());
            progress.set_paused(true);
            is_paused.store(true, Ordering::SeqCst);
        }
    }

    fn resume(&mut self, progress: &RecordingProgress, is_paused: &AtomicBool) {
        if self.paused {
            if let Some(ps) = self.pause_start.take() {
                self.pause_time += ps.elapsed();
            }
            self.paused = false;
            progress.set_paused(false);
            is_paused.store(false, Ordering::SeqCst);
        }
    }

    fn apply_command(
        &mut self,
        command: RecorderCommand,
        progress: &RecordingProgress,
        should_stop: &AtomicBool,
        is_paused: &AtomicBool,
    ) -> Option<LoopControl> {
        match command {
            RecorderCommand::Stop => {
                should_stop.store(true, Ordering::SeqCst);
                Some(LoopControl::Stop)
            },
            RecorderCommand::Cancel => {
                should_stop.store(true, Ordering::SeqCst);
                progress.mark_cancelled();
                Some(LoopControl::Stop)
            },
            RecorderCommand::Pause => {
                self.pause(progress, is_paused);
                None
            },
            RecorderCommand::Resume => {
                self.resume(progress, is_paused);
                None
            },
        }
    }
}

impl Default for PauseState {
    fn default() -> Self {
        Self::new()
    }
}

/// Process command channel updates and pause waiting for one recording-loop tick.
///
/// Semantics intentionally match the historical in-loop logic used by the app shell:
/// - `try_recv` one command first
/// - if paused after that, block up to `pause_wait` for a resume/stop/cancel command
pub fn handle_loop_control(
    command_rx: &Receiver<RecorderCommand>,
    pause_state: &mut PauseState,
    progress: &RecordingProgress,
    should_stop: &AtomicBool,
    is_paused: &AtomicBool,
    pause_wait: Duration,
) -> LoopControl {
    match command_rx.try_recv() {
        Ok(command) => {
            if let Some(control) =
                pause_state.apply_command(command, progress, should_stop, is_paused)
            {
                return control;
            }
        },
        Err(TryRecvError::Empty) => {},
        Err(TryRecvError::Disconnected) => {
            should_stop.store(true, Ordering::SeqCst);
            return LoopControl::Stop;
        },
    }

    if pause_state.is_paused() {
        match command_rx.recv_timeout(pause_wait) {
            Ok(command) => {
                if let Some(control) =
                    pause_state.apply_command(command, progress, should_stop, is_paused)
                {
                    return control;
                }
            },
            Err(RecvTimeoutError::Timeout) => {},
            Err(RecvTimeoutError::Disconnected) => {
                should_stop.store(true, Ordering::SeqCst);
                return LoopControl::Stop;
            },
        }
        LoopControl::SkipFrame
    } else {
        LoopControl::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::{handle_loop_control, LoopControl, PauseState};
    use crate::state::{RecorderCommand, RecordingProgress};
    use crossbeam_channel::unbounded;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    #[test]
    fn stop_command_stops_loop() {
        let (tx, rx) = unbounded();
        let _ = tx.send(RecorderCommand::Stop);
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);
        let mut pause_state = PauseState::new();

        let control = handle_loop_control(
            &rx,
            &mut pause_state,
            &progress,
            &should_stop,
            &is_paused,
            Duration::from_millis(0),
        );

        assert_eq!(control, LoopControl::Stop);
        assert!(should_stop.load(Ordering::SeqCst));
    }

    #[test]
    fn cancel_command_marks_cancelled_and_stops_loop() {
        let (tx, rx) = unbounded();
        let _ = tx.send(RecorderCommand::Cancel);
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);
        let mut pause_state = PauseState::new();

        let control = handle_loop_control(
            &rx,
            &mut pause_state,
            &progress,
            &should_stop,
            &is_paused,
            Duration::from_millis(0),
        );

        assert_eq!(control, LoopControl::Stop);
        assert!(progress.was_cancelled());
        assert!(should_stop.load(Ordering::SeqCst));
    }

    #[test]
    fn pause_then_resume_via_channel_skips_single_tick() {
        let (tx, rx) = unbounded();
        let _ = tx.send(RecorderCommand::Pause);
        let _ = tx.send(RecorderCommand::Resume);
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);
        let mut pause_state = PauseState::new();

        let control = handle_loop_control(
            &rx,
            &mut pause_state,
            &progress,
            &should_stop,
            &is_paused,
            Duration::from_millis(0),
        );

        assert_eq!(control, LoopControl::SkipFrame);
        assert!(!pause_state.is_paused());
        assert!(!is_paused.load(Ordering::SeqCst));
    }

    #[test]
    fn paused_timeout_skips_frame() {
        let (_tx, rx) = unbounded();
        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);
        let mut pause_state = PauseState::new();
        pause_state.pause(&progress, &is_paused);

        let control = handle_loop_control(
            &rx,
            &mut pause_state,
            &progress,
            &should_stop,
            &is_paused,
            Duration::from_millis(0),
        );

        assert_eq!(control, LoopControl::SkipFrame);
        assert!(pause_state.is_paused());
    }

    #[test]
    fn disconnected_channel_stops_loop() {
        let (tx, rx) = unbounded::<RecorderCommand>();
        drop(tx);

        let progress = RecordingProgress::new();
        let should_stop = AtomicBool::new(false);
        let is_paused = AtomicBool::new(false);
        let mut pause_state = PauseState::new();

        let control = handle_loop_control(
            &rx,
            &mut pause_state,
            &progress,
            &should_stop,
            &is_paused,
            Duration::from_millis(0),
        );

        assert_eq!(control, LoopControl::Stop);
        assert!(should_stop.load(Ordering::SeqCst));
    }

    #[test]
    fn active_elapsed_excludes_paused_time() {
        let progress = RecordingProgress::new();
        let is_paused = AtomicBool::new(false);
        let mut pause_state = PauseState::new();
        let start = Instant::now();

        pause_state.pause(&progress, &is_paused);
        std::thread::sleep(Duration::from_millis(2));
        pause_state.resume(&progress, &is_paused);

        let elapsed = pause_state.active_elapsed(start);
        assert!(elapsed <= start.elapsed());
    }
}
