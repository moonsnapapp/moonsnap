//! Shared frame timeline/scene context planning for export loops.

use moonsnap_project_types::video_project::TimelineState;
use moonsnap_render::scene::{InterpolatedScene, SceneInterpolator};
use moonsnap_render::zoom::ZoomInterpolator;
use moonsnap_render::ZoomState;

use crate::timeline_plan::{should_skip_source_frame, timeline_time_ms_for_output_frame};

/// Timeline-derived context for one decoded/output frame pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameTimelineContext {
    pub source_time_ms: u64,
    pub relative_time_ms: u64,
    pub should_skip: bool,
}

/// Scene/zoom/webcam context for one output frame.
#[derive(Debug, Clone, Copy)]
pub struct FrameSceneContext {
    pub zoom_state: ZoomState,
    pub interpolated_scene: InterpolatedScene,
    pub webcam_visible: bool,
    pub camera_only_opacity: f64,
    pub regular_camera_opacity: f64,
    pub in_camera_only_transition: bool,
}

/// Build timeline times for one iteration and whether this decoded source frame is skipped.
pub fn build_frame_timeline_context(
    source_time_ms: u64,
    output_frame_count: u32,
    fps: u32,
    timeline: &TimelineState,
    has_segments: bool,
) -> FrameTimelineContext {
    let relative_time_ms = timeline_time_ms_for_output_frame(output_frame_count, fps);
    let desired_source_time_ms = timeline
        .timeline_to_source(relative_time_ms)
        .unwrap_or(source_time_ms);
    let frame_tolerance_ms = 500u64 / fps.max(1) as u64;
    let should_skip = should_skip_source_frame(timeline, has_segments, source_time_ms)
        || (has_segments
            && source_time_ms.saturating_add(frame_tolerance_ms) < desired_source_time_ms);

    FrameTimelineContext {
        source_time_ms,
        relative_time_ms,
        should_skip,
    }
}

/// Build per-frame scene/zoom visibility context.
pub fn build_frame_scene_context<GetCursorPos, WebcamVisibleAt>(
    relative_time_ms: u64,
    source_time_ms: u64,
    zoom_interpolator: &ZoomInterpolator,
    scene_interpolator: &SceneInterpolator,
    mut cursor_pos_at_source_time: GetCursorPos,
    mut webcam_visible_at: WebcamVisibleAt,
) -> FrameSceneContext
where
    GetCursorPos: FnMut(u64) -> Option<(f64, f64)>,
    WebcamVisibleAt: FnMut(u64) -> bool,
{
    let cursor_pos_for_zoom = cursor_pos_at_source_time(source_time_ms);
    let zoom_state =
        zoom_interpolator.get_zoom_at_with_cursor(relative_time_ms, cursor_pos_for_zoom);
    let interpolated_scene = scene_interpolator.get_scene_at(relative_time_ms);
    let webcam_visible = webcam_visible_at(relative_time_ms);
    let camera_only_opacity = interpolated_scene.camera_only_transition_opacity();
    let regular_camera_opacity = interpolated_scene.regular_camera_transition_opacity();
    let in_camera_only_transition = interpolated_scene.is_transitioning_camera_only();

    FrameSceneContext {
        zoom_state,
        interpolated_scene,
        webcam_visible,
        camera_only_opacity,
        regular_camera_opacity,
        in_camera_only_transition,
    }
}

/// Match existing exporter debug cadence for early frames and boundary windows.
pub fn should_log_frame_debug(output_frame_count: u32, relative_time_ms: u64) -> bool {
    output_frame_count < 3 || (6000..=6200).contains(&relative_time_ms)
}

/// Match existing exporter debug cadence for camera-only transitions.
pub fn should_log_camera_transition_debug(
    output_frame_count: u32,
    in_camera_only_transition: bool,
) -> bool {
    in_camera_only_transition && output_frame_count.is_multiple_of(10)
}

#[cfg(test)]
mod tests {
    use super::*;
    use moonsnap_project_types::video_project::{
        SceneSegment, TimelineState, TrimSegment, ZoomConfig,
    };

    #[test]
    fn frame_timeline_context_computes_source_relative_and_skip() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 0,
            out_point: 10_000,
            speed: 1.0,
            segments: vec![TrimSegment {
                id: "keep".to_string(),
                source_start_ms: 2_000,
                source_end_ms: 3_000,
                speed: 1.0,
            }],
        };

        let outside = build_frame_timeline_context(1_000, 10, 10, &timeline, true);
        assert_eq!(outside.source_time_ms, 1_000);
        assert_eq!(outside.relative_time_ms, 1_000);
        assert!(outside.should_skip);

        let inside = build_frame_timeline_context(2_500, 5, 10, &timeline, true);
        assert_eq!(inside.source_time_ms, 2_500);
        assert_eq!(inside.relative_time_ms, 500);
        assert!(!inside.should_skip);

        let ignore_segments = build_frame_timeline_context(1_000, 10, 10, &timeline, false);
        assert!(!ignore_segments.should_skip);
    }

    #[test]
    fn frame_timeline_context_skips_until_speed_sample_reaches_desired_source_time() {
        let timeline = TimelineState {
            duration_ms: 10_000,
            in_point: 0,
            out_point: 10_000,
            speed: 1.0,
            segments: vec![TrimSegment {
                id: "fast".to_string(),
                source_start_ms: 0,
                source_end_ms: 2_000,
                speed: 2.0,
            }],
        };

        let too_early = build_frame_timeline_context(400, 5, 10, &timeline, true);
        assert!(too_early.should_skip);

        let sampled = build_frame_timeline_context(1_000, 5, 10, &timeline, true);
        assert!(!sampled.should_skip);
        assert_eq!(sampled.relative_time_ms, 500);
    }

    #[test]
    fn frame_scene_context_uses_callbacks_and_interpolators() {
        let zoom_interpolator = ZoomInterpolator::new(&ZoomConfig::default());
        let scene_interpolator = SceneInterpolator::new(Vec::<SceneSegment>::new());

        let mut cursor_called_with = None;
        let mut webcam_called_with = None;
        let result = build_frame_scene_context(
            1_234,
            5_678,
            &zoom_interpolator,
            &scene_interpolator,
            |source_time_ms| {
                cursor_called_with = Some(source_time_ms);
                Some((0.2, 0.4))
            },
            |timeline_time_ms| {
                webcam_called_with = Some(timeline_time_ms);
                false
            },
        );

        assert_eq!(cursor_called_with, Some(5_678));
        assert_eq!(webcam_called_with, Some(1_234));
        let identity_zoom = ZoomState::identity();
        assert!((result.zoom_state.scale - identity_zoom.scale).abs() < f32::EPSILON);
        assert!((result.zoom_state.center_x - identity_zoom.center_x).abs() < f32::EPSILON);
        assert!((result.zoom_state.center_y - identity_zoom.center_y).abs() < f32::EPSILON);
        assert!(!result.webcam_visible);
        assert!(!result.in_camera_only_transition);
        assert!((result.camera_only_opacity - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn debug_helpers_match_exporter_behavior() {
        assert!(should_log_frame_debug(0, 100));
        assert!(should_log_frame_debug(42, 6_100));
        assert!(!should_log_frame_debug(42, 5_100));

        assert!(should_log_camera_transition_debug(20, true));
        assert!(!should_log_camera_transition_debug(21, true));
        assert!(!should_log_camera_transition_debug(20, false));
    }
}
