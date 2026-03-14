//! High-level export planning from project config.

use moonsnap_project_types::video_project::VideoProject;

use crate::composition_plan::{plan_export_dimensions, ExportDimensions};
use crate::decode_plan::{plan_stream_decode, StreamDecodePlan};
use crate::frame_path_plan::can_use_nv12_fast_path;
use crate::timeline_plan::{plan_export_timeline, ExportTimelinePlan};

/// Aggregated export plan derived from a project.
#[derive(Debug, Clone, PartialEq)]
pub struct VideoExportPlan {
    pub output_fps: u32,
    pub timeline: ExportTimelinePlan,
    pub dimensions: ExportDimensions,
    pub use_nv12_decode: bool,
    pub force_even_source_crop: bool,
    pub decode: StreamDecodePlan,
}

pub fn resolve_export_fps(project: &VideoProject) -> u32 {
    project.sources.fps.max(1)
}

/// Build the reusable planning view for export orchestration.
pub fn plan_video_export(project: &VideoProject) -> VideoExportPlan {
    let original_width = project.sources.original_width;
    let original_height = project.sources.original_height;
    let output_fps = resolve_export_fps(project);

    let timeline = plan_export_timeline(&project.timeline, output_fps);
    let dimensions = plan_export_dimensions(
        original_width,
        original_height,
        &project.export.crop,
        &project.export.composition,
        project.export.background.enabled,
        project.export.background.padding,
    );

    let use_nv12_decode = can_use_nv12_fast_path(
        original_width,
        original_height,
        dimensions.crop_enabled,
        project.export.crop.x,
        project.export.crop.y,
        project.export.crop.width,
        project.export.crop.height,
    );
    let force_even_source_crop = !dimensions.crop_enabled
        && (original_width != dimensions.video_width || original_height != dimensions.video_height);
    let decode = plan_stream_decode(project, &timeline, use_nv12_decode);

    VideoExportPlan {
        output_fps,
        timeline,
        dimensions,
        use_nv12_decode,
        force_even_source_crop,
        decode,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use moonsnap_project_types::video_project::VideoProject;

    #[test]
    fn builds_export_plan_for_default_project() {
        let project = VideoProject::new("screen.mp4", 1920, 1080, 10_000, 30);
        let plan = plan_video_export(&project);

        assert_eq!(plan.output_fps, 30);
        assert_eq!(plan.timeline.total_output_frames, 300);
        assert_eq!(plan.timeline.total_decode_frames, 300);
        assert_eq!(plan.dimensions.video_width, 1920);
        assert_eq!(plan.dimensions.video_height, 1080);
        assert!(plan.use_nv12_decode);
        assert!(!plan.force_even_source_crop);
        assert_eq!(plan.decode.screen_video_path, "screen.mp4");
        assert_eq!(plan.decode.decode_start_ms, plan.timeline.decode_start_ms);
        assert_eq!(
            plan.decode.total_decode_frames,
            plan.timeline.total_decode_frames
        );
    }

    #[test]
    fn marks_even_crop_requirement_for_odd_no_crop_sources() {
        let project = VideoProject::new("screen.mp4", 1919, 1079, 2_000, 30);
        let plan = plan_video_export(&project);

        assert_eq!(plan.dimensions.video_width, 1918);
        assert_eq!(plan.dimensions.video_height, 1078);
        assert!(plan.force_even_source_crop);
        assert!(!plan.dimensions.crop_enabled);
        assert!(!plan.use_nv12_decode);
    }

    #[test]
    fn caps_requested_export_fps_to_source_fps() {
        let mut project = VideoProject::new("screen.mp4", 1920, 1080, 1_000, 30);
        project.export.fps = 60;

        let plan = plan_video_export(&project);

        assert_eq!(plan.output_fps, 30);
        assert_eq!(plan.timeline.total_output_frames, 30);
        assert_eq!(plan.timeline.total_decode_frames, 30);
    }
}
