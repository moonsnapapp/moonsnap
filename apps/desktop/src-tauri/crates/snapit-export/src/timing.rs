//! Frame timing aggregation helpers for export loops.

/// Averaged frame timing summary (milliseconds).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameTimingAverages {
    pub frame_count: u32,
    pub decode_ms: f64,
    pub gpu_ms: f64,
    pub cpu_ms: f64,
    pub readback_ms: f64,
    pub encode_ms: f64,
    pub total_ms: f64,
}

/// Rolling accumulator for export frame-stage timing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameTimingAccumulator {
    window_size: u32,
    decode_us: u64,
    gpu_us: u64,
    cpu_us: u64,
    readback_us: u64,
    encode_us: u64,
    frame_count: u32,
}

impl FrameTimingAccumulator {
    pub fn new(window_size: u32) -> Self {
        Self {
            window_size: window_size.max(1),
            decode_us: 0,
            gpu_us: 0,
            cpu_us: 0,
            readback_us: 0,
            encode_us: 0,
            frame_count: 0,
        }
    }

    pub fn add_decode_us(&mut self, micros: u64) {
        self.decode_us += micros;
    }

    pub fn add_gpu_us(&mut self, micros: u64) {
        self.gpu_us += micros;
    }

    pub fn add_cpu_us(&mut self, micros: u64) {
        self.cpu_us += micros;
    }

    pub fn add_readback_us(&mut self, micros: u64) {
        self.readback_us += micros;
    }

    pub fn add_encode_us(&mut self, micros: u64) {
        self.encode_us += micros;
    }

    /// Mark a completed output frame. Returns averaged summary when window is full.
    pub fn finish_frame(&mut self) -> Option<FrameTimingAverages> {
        self.frame_count += 1;
        if self.frame_count < self.window_size {
            return None;
        }

        let n = self.frame_count as f64;
        let decode_ms = self.decode_us as f64 / n / 1000.0;
        let gpu_ms = self.gpu_us as f64 / n / 1000.0;
        let cpu_ms = self.cpu_us as f64 / n / 1000.0;
        let readback_ms = self.readback_us as f64 / n / 1000.0;
        let encode_ms = self.encode_us as f64 / n / 1000.0;
        let total_ms =
            (self.decode_us + self.gpu_us + self.cpu_us + self.readback_us + self.encode_us) as f64
                / n
                / 1000.0;

        let summary = FrameTimingAverages {
            frame_count: self.frame_count,
            decode_ms,
            gpu_ms,
            cpu_ms,
            readback_ms,
            encode_ms,
            total_ms,
        };

        self.decode_us = 0;
        self.gpu_us = 0;
        self.cpu_us = 0;
        self.readback_us = 0;
        self.encode_us = 0;
        self.frame_count = 0;

        Some(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_accumulator_returns_summary_at_window_boundary() {
        let mut acc = FrameTimingAccumulator::new(2);

        acc.add_decode_us(2_000);
        acc.add_gpu_us(4_000);
        assert!(acc.finish_frame().is_none());

        acc.add_decode_us(6_000);
        acc.add_gpu_us(8_000);
        let summary = acc.finish_frame().unwrap();

        assert_eq!(summary.frame_count, 2);
        assert!((summary.decode_ms - 4.0).abs() < 0.0001);
        assert!((summary.gpu_ms - 6.0).abs() < 0.0001);
        assert!((summary.total_ms - 10.0).abs() < 0.0001);
    }

    #[test]
    fn timing_accumulator_resets_after_summary() {
        let mut acc = FrameTimingAccumulator::new(1);
        acc.add_decode_us(1_000);
        let first = acc.finish_frame().unwrap();
        assert!((first.decode_ms - 1.0).abs() < 0.0001);

        acc.add_decode_us(3_000);
        let second = acc.finish_frame().unwrap();
        assert!((second.decode_ms - 3.0).abs() < 0.0001);
    }
}
