#![doc = include_str!("../README.md")]

pub mod caption_timeline;
pub mod composition_plan;
pub mod cursor_overlay;
pub mod decode_plan;
pub mod encoder_selection;
pub mod export_job;
pub mod export_plan;
pub mod ffmpeg_plan;
pub mod frame_composition;
pub mod frame_context;
pub mod frame_ops;
pub mod frame_overlays;
pub mod frame_path_plan;
pub mod frame_pipeline_state;
pub mod frame_prepare;
pub mod job_control;
pub mod job_finalize;
pub mod job_runner;
pub mod pipeline;
pub mod process_control;
pub mod temp_file;
pub mod timeline_plan;
pub mod timing;

#[cfg(test)]
mod tests {
    use super::encoder_selection::{select_encoder, EncoderType};

    #[test]
    fn root_exports_smoke_test() {
        let cfg = select_encoder(75, true, true, 20);
        assert_eq!(cfg.encoder_type, EncoderType::Nvenc);
    }
}
