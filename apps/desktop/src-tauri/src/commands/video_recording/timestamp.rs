//! High-precision timestamps for cursor-video synchronization.
//!
//! This module provides platform-specific high-precision timestamps that are
//! independent of application-level timing variations (debug vs release builds,
//! thread scheduling, etc.).
//!
//! On Windows, we use QueryPerformanceCounter which provides timestamps from
//! the same clock source as Windows Graphics Capture's SystemRelativeTime.
//! This ensures cursor events and video frames can be perfectly aligned.

// Timestamp utilities kept for advanced timing features
#![allow(dead_code)]

use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

/// Cached performance counter frequency (ticks per second).
/// On Windows, this is typically 10MHz but can vary by hardware.
#[cfg(target_os = "windows")]
static PERF_FREQ: OnceLock<i64> = OnceLock::new();

/// Get the performance counter frequency, cached for efficiency.
#[cfg(target_os = "windows")]
#[inline]
fn perf_freq() -> i64 {
    *PERF_FREQ.get_or_init(|| {
        let mut freq: i64 = 0;
        // QueryPerformanceFrequency should succeed on all Windows XP+ systems,
        // but we handle the error case gracefully with a standard 10MHz fallback
        match unsafe { QueryPerformanceFrequency(&mut freq) } {
            Ok(_) => freq,
            Err(e) => {
                log::error!(
                    "QueryPerformanceFrequency failed: {:?}, using 10MHz default",
                    e
                );
                10_000_000 // Standard 10MHz fallback
            },
        }
    })
}

/// High-precision timestamp from Windows Performance Counter.
///
/// This timestamp type is compatible with Windows Graphics Capture's
/// `SystemRelativeTime`, which also uses the performance counter.
/// This allows perfect synchronization between video frame timestamps
/// (from WGC) and cursor event timestamps.
#[derive(Clone, Copy, Debug)]
pub struct PerformanceCounterTimestamp(i64);

impl PerformanceCounterTimestamp {
    /// Create a timestamp from a raw performance counter value.
    ///
    /// Use this to wrap timestamps from WGC's `SystemRelativeTime`.
    /// Note: WGC returns time in 100-nanosecond units, not raw QPC ticks.
    pub fn new(value: i64) -> Self {
        Self(value)
    }

    /// Create a timestamp from WGC's SystemRelativeTime (100-nanosecond units).
    ///
    /// WGC returns timestamps in 100ns units, which we convert to QPC ticks
    /// for consistent duration calculations.
    #[cfg(target_os = "windows")]
    pub fn from_wgc_time(time_100ns: i64) -> Self {
        // Convert 100ns units to QPC ticks
        // time_100ns / 10_000_000 = seconds
        // seconds * freq = QPC ticks
        let freq = perf_freq();
        let ticks = (time_100ns as i128 * freq as i128 / 10_000_000) as i64;
        Self(ticks)
    }

    /// Get the current performance counter value.
    #[cfg(target_os = "windows")]
    pub fn now() -> Self {
        let mut value: i64 = 0;
        match unsafe { QueryPerformanceCounter(&mut value) } {
            Ok(_) => Self(value),
            Err(e) => {
                log::warn!("QueryPerformanceCounter failed: {:?}, using fallback", e);
                // Fallback to system time in 100ns units (same scale as QPC typically uses)
                let nanos = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                Self((nanos / 100) as i64)
            },
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn now() -> Self {
        // Fallback: use nanoseconds since some epoch
        Self(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as i64,
        )
    }

    /// Get the raw counter value.
    pub fn raw(&self) -> i64 {
        self.0
    }

    /// Calculate the duration since another timestamp.
    ///
    /// Returns Duration::ZERO if `other` is later than `self`.
    #[cfg(target_os = "windows")]
    pub fn duration_since(&self, other: Self) -> Duration {
        let freq = perf_freq() as i128;
        debug_assert!(freq > 0);

        let diff = self.0 as i128 - other.0 as i128;

        if diff <= 0 {
            Duration::ZERO
        } else {
            let diff = diff as u128;
            let freq = freq as u128;

            let secs = diff / freq;
            let nanos = ((diff % freq) * 1_000_000_000u128) / freq;

            Duration::new(secs as u64, nanos as u32)
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn duration_since(&self, other: Self) -> Duration {
        let diff = self.0 - other.0;
        if diff <= 0 {
            Duration::ZERO
        } else {
            Duration::from_nanos(diff as u64)
        }
    }

    /// Calculate duration, returning None if `other` is later than `self`.
    #[cfg(target_os = "windows")]
    pub fn checked_duration_since(&self, other: Self) -> Option<Duration> {
        let freq = perf_freq() as i128;
        debug_assert!(freq > 0);

        let diff = self.0 as i128 - other.0 as i128;

        if diff < 0 {
            None
        } else {
            let diff = diff as u128;
            let freq = freq as u128;

            let secs = diff / freq;
            let nanos = ((diff % freq) * 1_000_000_000u128) / freq;

            Some(Duration::new(secs as u64, nanos as u32))
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn checked_duration_since(&self, other: Self) -> Option<Duration> {
        let diff = self.0 - other.0;
        if diff < 0 {
            None
        } else {
            Some(Duration::from_nanos(diff as u64))
        }
    }

    /// Calculate signed duration in seconds (can be negative).
    #[cfg(target_os = "windows")]
    pub fn signed_duration_since_secs(&self, other: Self) -> f64 {
        let freq = perf_freq() as f64;
        let diff = self.0 as f64 - other.0 as f64;
        diff / freq
    }

    #[cfg(not(target_os = "windows"))]
    pub fn signed_duration_since_secs(&self, other: Self) -> f64 {
        let diff = self.0 as f64 - other.0 as f64;
        diff / 1_000_000_000.0
    }

    /// Convert to milliseconds since another timestamp.
    pub fn millis_since(&self, other: Self) -> u64 {
        self.duration_since(other).as_millis() as u64
    }
}

impl std::ops::Add<Duration> for PerformanceCounterTimestamp {
    type Output = Self;

    #[cfg(target_os = "windows")]
    fn add(self, rhs: Duration) -> Self::Output {
        let freq = perf_freq();
        Self(self.0 + (rhs.as_secs_f64() * freq as f64) as i64)
    }

    #[cfg(not(target_os = "windows"))]
    fn add(self, rhs: Duration) -> Self::Output {
        Self(self.0 + rhs.as_nanos() as i64)
    }
}

impl std::ops::Sub<Duration> for PerformanceCounterTimestamp {
    type Output = Self;

    #[cfg(target_os = "windows")]
    fn sub(self, rhs: Duration) -> Self::Output {
        let freq = perf_freq();
        Self(self.0 - (rhs.as_secs_f64() * freq as f64) as i64)
    }

    #[cfg(not(target_os = "windows"))]
    fn sub(self, rhs: Duration) -> Self::Output {
        Self(self.0 - rhs.as_nanos() as i64)
    }
}

/// Combined timestamps for synchronization.
///
/// Captures:
/// - `Instant` (for Rust-level elapsed time, used by cursor events)
/// - `PerformanceCounterTimestamp` (for WGC alignment)
/// - `SystemTime` (for Scap alignment, which uses wall-clock timestamps)
///
/// All are captured at the same moment, allowing conversion between time domains.
#[derive(Clone, Copy, Debug)]
pub struct Timestamps {
    instant: Instant,
    performance_counter: PerformanceCounterTimestamp,
    /// SystemTime in 100ns units since UNIX_EPOCH (for Scap frame timestamps)
    system_time_100ns: i64,
}

impl Timestamps {
    /// Create timestamps for the current moment.
    ///
    /// All timestamps are captured as close together as possible.
    pub fn now() -> Self {
        let system_time_100ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| (d.as_nanos() / 100) as i64)
            .unwrap_or(0);

        Self {
            instant: Instant::now(),
            performance_counter: PerformanceCounterTimestamp::now(),
            system_time_100ns,
        }
    }

    /// Get the Instant component (for cursor event timing).
    pub fn instant(&self) -> Instant {
        self.instant
    }

    /// Get the PerformanceCounter component (for WGC video frame timing).
    pub fn performance_counter(&self) -> PerformanceCounterTimestamp {
        self.performance_counter
    }

    /// Get the SystemTime component in 100ns units (for Scap frame timing).
    pub fn system_time_100ns(&self) -> i64 {
        self.system_time_100ns
    }

    /// Convert a Scap frame timestamp to milliseconds since recording start.
    ///
    /// Scap timestamps are SystemTime in 100ns units since UNIX_EPOCH.
    /// This computes elapsed time since recording started.
    pub fn scap_frame_time_to_ms(&self, frame_time_100ns: i64) -> u64 {
        let elapsed_100ns = frame_time_100ns.saturating_sub(self.system_time_100ns);
        if elapsed_100ns <= 0 {
            0
        } else {
            (elapsed_100ns / 10_000) as u64 // 100ns to ms
        }
    }

    /// Convert a WGC frame timestamp to milliseconds since recording start.
    ///
    /// WGC timestamps are QPC-based (100ns units since system boot).
    #[cfg(target_os = "windows")]
    pub fn wgc_frame_time_to_ms(&self, frame_time_100ns: i64) -> u64 {
        let frame_ts = PerformanceCounterTimestamp::from_wgc_time(frame_time_100ns);
        frame_ts.millis_since(self.performance_counter)
    }

    /// Convert cursor event time (Instant elapsed) to video time.
    pub fn instant_to_perf_counter(&self, when: Instant) -> PerformanceCounterTimestamp {
        let elapsed = when.duration_since(self.instant);
        self.performance_counter + elapsed
    }

    /// Alias for backwards compatibility - calls scap_frame_time_to_ms
    pub fn frame_time_to_ms(&self, frame_time_100ns: i64) -> u64 {
        self.scap_frame_time_to_ms(frame_time_100ns)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ========================================================================
    // Core behavior tests - these catch real A/V sync bugs
    // ========================================================================

    #[test]
    fn test_duration_zero_when_earlier() {
        // Critical: negative durations must return zero to prevent video glitches
        let later = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(10));
        let earlier = PerformanceCounterTimestamp::now();

        let duration = later.duration_since(earlier);
        assert_eq!(duration, Duration::ZERO);
    }

    #[test]
    fn test_checked_duration_since_returns_none_when_earlier() {
        // Critical: checked version must return None for negative durations
        let later = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(10));
        let earlier = PerformanceCounterTimestamp::now();

        assert!(later.checked_duration_since(earlier).is_none());
    }

    #[test]
    fn test_signed_duration_allows_negative() {
        // Critical: signed duration needed for drift calculations
        let start = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(50));
        let end = PerformanceCounterTimestamp::now();

        let forward = end.signed_duration_since_secs(start);
        let backward = start.signed_duration_since_secs(end);

        assert!(forward > 0.0);
        assert!(backward < 0.0);
        assert!((forward + backward).abs() < 0.001); // Should sum to ~0
    }

    #[test]
    fn test_timestamps_scap_frame_time_before_start_returns_zero() {
        // Critical: frames before recording start must return 0, not negative
        let ts = Timestamps::now();
        let frame_time = ts.system_time_100ns() - 10_000_000; // 1 second before
        assert_eq!(ts.scap_frame_time_to_ms(frame_time), 0);
    }

    #[test]
    fn test_instant_to_perf_counter_preserves_elapsed() {
        // Critical: cursor-video sync depends on accurate time domain conversion
        let ts = Timestamps::now();
        let start_instant = ts.instant();

        std::thread::sleep(Duration::from_millis(50));

        let later_instant = Instant::now();
        let converted_pc = ts.instant_to_perf_counter(later_instant);

        let pc_elapsed = converted_pc.duration_since(ts.performance_counter());
        let instant_elapsed = later_instant.duration_since(start_instant);

        // Elapsed times should match within 10ms tolerance
        let diff = if pc_elapsed > instant_elapsed {
            pc_elapsed - instant_elapsed
        } else {
            instant_elapsed - pc_elapsed
        };
        assert!(diff < Duration::from_millis(10));
    }

    // ========================================================================
    // Property-based tests - find edge cases automatically
    // ========================================================================

    proptest! {
        #[test]
        fn prop_duration_always_non_negative(
            raw1 in any::<i64>(),
            raw2 in any::<i64>()
        ) {
            let ts1 = PerformanceCounterTimestamp::new(raw1);
            let ts2 = PerformanceCounterTimestamp::new(raw2);

            // duration_since must never panic and must return >= 0
            let d1 = ts1.duration_since(ts2);
            let d2 = ts2.duration_since(ts1);

            // At least one must be zero (the one going "backwards")
            assert!(d1 == Duration::ZERO || d2 == Duration::ZERO);
        }

        #[test]
        fn prop_add_sub_roundtrip(secs in 0u64..3600, nanos in 0u32..1_000_000_000) {
            let ts = PerformanceCounterTimestamp::now();
            let duration = Duration::new(secs, nanos);

            let added = ts + duration;
            let back = added - duration;

            // Should round-trip within 1ms tolerance (floating point in conversion)
            let diff = ts.duration_since(back);
            prop_assert!(diff < Duration::from_millis(1));
        }

        #[test]
        fn prop_scap_frame_time_monotonic(
            offset1_ms in 0i64..3_600_000,
            offset2_ms in 0i64..3_600_000
        ) {
            let ts = Timestamps::now();
            let frame1 = ts.system_time_100ns() + offset1_ms * 10_000;
            let frame2 = ts.system_time_100ns() + offset2_ms * 10_000;

            let ms1 = ts.scap_frame_time_to_ms(frame1);
            let ms2 = ts.scap_frame_time_to_ms(frame2);

            // Larger frame time should give larger ms (monotonic)
            if offset1_ms <= offset2_ms {
                prop_assert!(ms1 <= ms2);
            } else {
                prop_assert!(ms1 >= ms2);
            }
        }

        #[test]
        fn prop_millis_since_matches_duration(delta_ms in 0u64..10_000) {
            let start = PerformanceCounterTimestamp::new(0);
            let end = start + Duration::from_millis(delta_ms);

            let millis = end.millis_since(start);
            let duration_ms = end.duration_since(start).as_millis() as u64;

            prop_assert_eq!(millis, duration_ms);
        }
    }

    // ========================================================================
    // Long duration tests - ensure no overflow for real recordings
    // ========================================================================

    #[test]
    fn test_one_hour_recording_no_overflow() {
        let start = PerformanceCounterTimestamp::new(0);
        let end = start + Duration::from_secs(3600);

        let duration = end.duration_since(start);
        assert!(duration >= Duration::from_secs(3595));
        assert!(duration <= Duration::from_secs(3605));
    }

    #[test]
    fn test_scap_frame_time_one_hour() {
        let ts = Timestamps::now();
        let one_hour_100ns = 10_000_000i64 * 3600;
        let frame_time = ts.system_time_100ns() + one_hour_100ns;
        let ms = ts.scap_frame_time_to_ms(frame_time);

        assert!(ms >= 3_599_000 && ms <= 3_601_000);
    }
}
