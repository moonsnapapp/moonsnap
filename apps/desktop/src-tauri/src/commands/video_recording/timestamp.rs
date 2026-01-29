//! High-precision timestamps for cursor-video synchronization.
//!
//! This module provides platform-specific high-precision timestamps that are
//! independent of application-level timing variations (debug vs release builds,
//! thread scheduling, etc.).
//!
//! On Windows, we use QueryPerformanceCounter which provides timestamps from
//! the same clock source as Windows Graphics Capture's SystemRelativeTime.
//! This ensures cursor events and video frames can be perfectly aligned.

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
        // SAFETY: QueryPerformanceFrequency succeeds on all Windows XP+ systems
        unsafe { QueryPerformanceFrequency(&mut freq).unwrap() };
        freq
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
        unsafe { QueryPerformanceCounter(&mut value).unwrap() };
        Self(value)
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

    // ========================================================================
    // PerformanceCounterTimestamp basic tests
    // ========================================================================

    #[test]
    fn test_timestamps_now() {
        let ts = Timestamps::now();
        std::thread::sleep(Duration::from_millis(10));
        let elapsed = ts.instant().elapsed();
        assert!(elapsed >= Duration::from_millis(10));
    }

    #[test]
    fn test_performance_counter_duration() {
        let start = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(50));
        let end = PerformanceCounterTimestamp::now();

        let duration = end.duration_since(start);
        // Allow some tolerance for sleep inaccuracy
        assert!(duration >= Duration::from_millis(40));
        assert!(duration <= Duration::from_millis(100));
    }

    #[test]
    fn test_duration_zero_when_earlier() {
        let later = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(10));
        let earlier = PerformanceCounterTimestamp::now();

        // Note: 'earlier' is actually later in time due to sleep order
        // So later.duration_since(earlier) should be zero
        let duration = later.duration_since(earlier);
        assert_eq!(duration, Duration::ZERO);
    }

    // ========================================================================
    // PerformanceCounterTimestamp arithmetic tests
    // ========================================================================

    #[test]
    fn test_performance_counter_new_and_raw() {
        let ts = PerformanceCounterTimestamp::new(12345);
        assert_eq!(ts.raw(), 12345);

        let ts_zero = PerformanceCounterTimestamp::new(0);
        assert_eq!(ts_zero.raw(), 0);

        let ts_negative = PerformanceCounterTimestamp::new(-100);
        assert_eq!(ts_negative.raw(), -100);
    }

    #[test]
    fn test_performance_counter_add_duration() {
        let start = PerformanceCounterTimestamp::now();
        let added = start + Duration::from_secs(1);

        // Adding 1 second should increase the raw value
        assert!(added.raw() > start.raw());

        // The difference should be approximately 1 second
        let duration = added.duration_since(start);
        assert!(duration >= Duration::from_millis(990));
        assert!(duration <= Duration::from_millis(1010));
    }

    #[test]
    fn test_performance_counter_sub_duration() {
        let end = PerformanceCounterTimestamp::now();
        let subtracted = end - Duration::from_secs(1);

        // Subtracting 1 second should decrease the raw value
        assert!(subtracted.raw() < end.raw());

        // The difference should be approximately 1 second
        let duration = end.duration_since(subtracted);
        assert!(duration >= Duration::from_millis(990));
        assert!(duration <= Duration::from_millis(1010));
    }

    #[test]
    fn test_performance_counter_add_zero_duration() {
        let ts = PerformanceCounterTimestamp::now();
        let added = ts + Duration::ZERO;

        // Adding zero should give the same raw value
        assert_eq!(ts.raw(), added.raw());
    }

    #[test]
    fn test_performance_counter_sub_zero_duration() {
        let ts = PerformanceCounterTimestamp::now();
        let subtracted = ts - Duration::ZERO;

        // Subtracting zero should give the same raw value
        assert_eq!(ts.raw(), subtracted.raw());
    }

    // ========================================================================
    // PerformanceCounterTimestamp duration calculation tests
    // ========================================================================

    #[test]
    fn test_checked_duration_since_returns_some() {
        let start = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(10));
        let end = PerformanceCounterTimestamp::now();

        let duration = end.checked_duration_since(start);
        assert!(duration.is_some());
        assert!(duration.unwrap() >= Duration::from_millis(5));
    }

    #[test]
    fn test_checked_duration_since_returns_none_when_earlier() {
        let later = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(10));
        let earlier = PerformanceCounterTimestamp::now();

        // Later is actually earlier in time, so should return None
        let duration = later.checked_duration_since(earlier);
        assert!(duration.is_none());
    }

    #[test]
    fn test_checked_duration_since_same_timestamp() {
        let ts = PerformanceCounterTimestamp::now();
        let duration = ts.checked_duration_since(ts);

        // Same timestamp should return Some(Duration::ZERO)
        assert!(duration.is_some());
        assert_eq!(duration.unwrap(), Duration::ZERO);
    }

    #[test]
    fn test_signed_duration_since_secs_positive() {
        let start = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(50));
        let end = PerformanceCounterTimestamp::now();

        let secs = end.signed_duration_since_secs(start);
        assert!(secs > 0.0);
        assert!(secs >= 0.04); // At least 40ms
        assert!(secs <= 0.15); // At most 150ms
    }

    #[test]
    fn test_signed_duration_since_secs_negative() {
        let start = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(50));
        let end = PerformanceCounterTimestamp::now();

        // Reversed order should give negative
        let secs = start.signed_duration_since_secs(end);
        assert!(secs < 0.0);
        assert!(secs <= -0.04);
        assert!(secs >= -0.15);
    }

    #[test]
    fn test_millis_since() {
        let start = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(50));
        let end = PerformanceCounterTimestamp::now();

        let millis = end.millis_since(start);
        assert!(millis >= 40);
        assert!(millis <= 100);
    }

    #[test]
    fn test_millis_since_zero_when_earlier() {
        let later = PerformanceCounterTimestamp::now();
        std::thread::sleep(Duration::from_millis(10));
        let earlier = PerformanceCounterTimestamp::now();

        // Should return 0 when the "start" is actually later
        let millis = later.millis_since(earlier);
        assert_eq!(millis, 0);
    }

    // ========================================================================
    // Timestamps struct tests
    // ========================================================================

    #[test]
    fn test_timestamps_accessors() {
        let ts = Timestamps::now();

        // All accessors should return valid values
        let _instant = ts.instant();
        let _pc = ts.performance_counter();
        let system_time = ts.system_time_100ns();

        // System time should be positive (after Unix epoch)
        assert!(system_time > 0);
    }

    #[test]
    fn test_timestamps_scap_frame_time_to_ms_zero_elapsed() {
        let ts = Timestamps::now();

        // Frame time at exactly the start time should be 0ms
        let ms = ts.scap_frame_time_to_ms(ts.system_time_100ns());
        assert_eq!(ms, 0);
    }

    #[test]
    fn test_timestamps_scap_frame_time_to_ms_positive_elapsed() {
        let ts = Timestamps::now();

        // Frame 1 second after start
        let frame_time = ts.system_time_100ns() + 10_000_000; // 1 second in 100ns units
        let ms = ts.scap_frame_time_to_ms(frame_time);

        assert!(ms >= 990);
        assert!(ms <= 1010);
    }

    #[test]
    fn test_timestamps_scap_frame_time_to_ms_before_start() {
        let ts = Timestamps::now();

        // Frame time before recording started should return 0
        let frame_time = ts.system_time_100ns() - 10_000_000;
        let ms = ts.scap_frame_time_to_ms(frame_time);

        assert_eq!(ms, 0);
    }

    #[test]
    fn test_timestamps_instant_to_perf_counter() {
        let ts = Timestamps::now();
        let start_instant = ts.instant();

        std::thread::sleep(Duration::from_millis(50));

        let later_instant = Instant::now();
        let converted_pc = ts.instant_to_perf_counter(later_instant);

        // The converted timestamp should be after the start performance counter
        let elapsed = converted_pc.duration_since(ts.performance_counter());
        assert!(elapsed >= Duration::from_millis(40));
        assert!(elapsed <= Duration::from_millis(100));

        // Also verify it matches the instant's elapsed time
        let instant_elapsed = later_instant.duration_since(start_instant);
        let diff = if elapsed > instant_elapsed {
            elapsed - instant_elapsed
        } else {
            instant_elapsed - elapsed
        };
        // Should be within 10ms tolerance
        assert!(diff < Duration::from_millis(10));
    }

    #[test]
    fn test_timestamps_frame_time_to_ms_alias() {
        let ts = Timestamps::now();
        let frame_time = ts.system_time_100ns() + 5_000_000; // 0.5 seconds

        // frame_time_to_ms should be an alias for scap_frame_time_to_ms
        let scap_ms = ts.scap_frame_time_to_ms(frame_time);
        let alias_ms = ts.frame_time_to_ms(frame_time);

        assert_eq!(scap_ms, alias_ms);
    }

    // ========================================================================
    // Edge cases and overflow tests
    // ========================================================================

    #[test]
    fn test_performance_counter_large_duration() {
        let start = PerformanceCounterTimestamp::new(0);
        let end = start + Duration::from_secs(3600); // 1 hour

        let duration = end.duration_since(start);
        assert!(duration >= Duration::from_secs(3595));
        assert!(duration <= Duration::from_secs(3605));
    }

    #[test]
    fn test_scap_frame_time_large_elapsed() {
        let ts = Timestamps::now();

        // Frame 1 hour after start
        let one_hour_100ns = 10_000_000i64 * 3600; // 1 hour in 100ns units
        let frame_time = ts.system_time_100ns() + one_hour_100ns;
        let ms = ts.scap_frame_time_to_ms(frame_time);

        // Should be approximately 3,600,000 ms (1 hour)
        assert!(ms >= 3_599_000);
        assert!(ms <= 3_601_000);
    }
}
