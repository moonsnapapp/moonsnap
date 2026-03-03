//! Timeline/decode planning helpers for export pipelines.

use moonsnap_domain::video_project::TimelineState;

/// Planned timeline/decode metrics for an export run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExportTimelinePlan {
    pub effective_duration_ms: u64,
    pub duration_secs: f64,
    pub total_output_frames: u32,
    pub decode_start_ms: u64,
    pub decode_end_ms: u64,
    pub has_segments: bool,
    pub total_decode_frames: u32,
}

fn safe_fps(fps: u32) -> f64 {
    fps.max(1) as f64
}

/// Build timeline/decode plan from timeline state and target FPS.
pub fn plan_export_timeline(timeline: &TimelineState, fps: u32) -> ExportTimelinePlan {
    let fps = safe_fps(fps);
    let effective_duration_ms = timeline.effective_duration_ms();
    let duration_secs = effective_duration_ms as f64 / 1000.0;
    let total_output_frames = (duration_secs * fps).ceil() as u32;

    let (decode_start_ms, decode_end_ms) = timeline.decode_range();
    let has_segments = !timeline.segments.is_empty();
    let decode_duration_ms = decode_end_ms.saturating_sub(decode_start_ms);
    let total_decode_frames = ((decode_duration_ms as f64 / 1000.0) * fps).ceil() as u32;

    ExportTimelinePlan {
        effective_duration_ms,
        duration_secs,
        total_output_frames,
        decode_start_ms,
        decode_end_ms,
        has_segments,
        total_decode_frames,
    }
}

/// Convert decoded frame index to source timeline time.
pub fn source_time_ms_for_decoded_frame(
    decode_start_ms: u64,
    decoded_frame_idx: u32,
    fps: u32,
) -> u64 {
    let fps = safe_fps(fps);
    decode_start_ms + ((decoded_frame_idx as f64 / fps) * 1000.0) as u64
}

/// Convert encoded output frame index to edited timeline time.
pub fn timeline_time_ms_for_output_frame(output_frame_idx: u32, fps: u32) -> u64 {
    let fps = safe_fps(fps);
    ((output_frame_idx as f64 / fps) * 1000.0).round() as u64
}

/// Whether a decoded source frame should be skipped because it falls in a deleted region.
pub fn should_skip_source_frame(
    timeline: &TimelineState,
    has_segments: bool,
    source_time_ms: u64,
) -> bool {
    has_segments && timeline.source_to_timeline(source_time_ms).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use moonsnap_domain::video_project::TrimSegment;

    #[test]
    fn plans_without_segments() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 1_000,
            out_point: 5_000,
            speed: 1.0,
            segments: Vec::new(),
        };
        let plan = plan_export_timeline(&timeline, 30);

        assert_eq!(plan.effective_duration_ms, 4_000);
        assert!((plan.duration_secs - 4.0).abs() < f64::EPSILON);
        assert_eq!(plan.total_output_frames, 120);
        assert_eq!(plan.decode_start_ms, 1_000);
        assert_eq!(plan.decode_end_ms, 5_000);
        assert!(!plan.has_segments);
        assert_eq!(plan.total_decode_frames, 120);
    }

    #[test]
    fn plans_with_segments() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 0,
            out_point: 10_000,
            speed: 1.0,
            segments: vec![
                TrimSegment {
                    id: "s1".to_string(),
                    source_start_ms: 1_000,
                    source_end_ms: 2_500,
                },
                TrimSegment {
                    id: "s2".to_string(),
                    source_start_ms: 4_000,
                    source_end_ms: 6_000,
                },
            ],
        };
        let plan = plan_export_timeline(&timeline, 60);

        // Effective: 1.5s + 2.0s = 3.5s
        assert_eq!(plan.effective_duration_ms, 3_500);
        assert_eq!(plan.total_output_frames, 210);
        // Decode window spans first->last kept segment (5s)
        assert_eq!(plan.decode_start_ms, 1_000);
        assert_eq!(plan.decode_end_ms, 6_000);
        assert!(plan.has_segments);
        assert_eq!(plan.total_decode_frames, 300);
    }

    #[test]
    fn computes_frame_time_conversions() {
        assert_eq!(source_time_ms_for_decoded_frame(1_000, 0, 30), 1_000);
        assert_eq!(source_time_ms_for_decoded_frame(1_000, 30, 30), 2_000);
        assert_eq!(timeline_time_ms_for_output_frame(0, 30), 0);
        assert_eq!(timeline_time_ms_for_output_frame(45, 30), 1_500);
    }

    #[test]
    fn skips_only_deleted_ranges_when_segmented() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 0,
            out_point: 10_000,
            speed: 1.0,
            segments: vec![TrimSegment {
                id: "s1".to_string(),
                source_start_ms: 2_000,
                source_end_ms: 3_000,
            }],
        };

        assert!(should_skip_source_frame(&timeline, true, 1_500));
        assert!(!should_skip_source_frame(&timeline, true, 2_500));
        assert!(should_skip_source_frame(&timeline, true, 3_500));
        assert!(!should_skip_source_frame(&timeline, false, 1_500));
    }
}
