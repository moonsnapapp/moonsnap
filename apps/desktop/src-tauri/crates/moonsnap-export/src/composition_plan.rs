//! Export dimension planning helpers.

use moonsnap_domain::video_project::{CompositionConfig, CompositionMode, CropConfig};

/// Planned dimensions for export decode/composition/output stages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportDimensions {
    pub crop_enabled: bool,
    pub padding: u32,
    pub video_width: u32,
    pub video_height: u32,
    pub composition_width: u32,
    pub composition_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub use_manual_composition: bool,
}

fn make_even(value: u32) -> u32 {
    (value / 2) * 2
}

fn auto_composition_dims(video_width: u32, video_height: u32, padding: u32) -> (u32, u32) {
    (
        make_even(video_width + padding * 2),
        make_even(video_height + padding * 2),
    )
}

/// Plan crop and composition dimensions for export.
pub fn plan_export_dimensions(
    original_width: u32,
    original_height: u32,
    crop: &CropConfig,
    composition: &CompositionConfig,
    background_enabled: bool,
    background_padding: f32,
) -> ExportDimensions {
    let padding = if background_enabled {
        background_padding as u32
    } else {
        0
    };

    let crop_enabled = crop.enabled && crop.width > 0 && crop.height > 0;
    let (video_width, video_height) = if crop_enabled {
        (make_even(crop.width), make_even(crop.height))
    } else {
        (make_even(original_width), make_even(original_height))
    };

    let use_manual_composition = matches!(composition.mode, CompositionMode::Manual);
    let (composition_width, composition_height) = match composition.mode {
        CompositionMode::Auto => auto_composition_dims(video_width, video_height, padding),
        CompositionMode::Manual => {
            if let (Some(fixed_w), Some(fixed_h)) = (composition.width, composition.height) {
                (make_even(fixed_w), make_even(fixed_h))
            } else if let Some(target_ratio) = composition.aspect_ratio {
                let video_ratio = video_width as f32 / video_height as f32;
                let (comp_w, comp_h) = if target_ratio > video_ratio {
                    let h = video_height + padding * 2;
                    let w = (h as f32 * target_ratio) as u32;
                    (w, h)
                } else {
                    let w = video_width + padding * 2;
                    let h = (w as f32 / target_ratio) as u32;
                    (w, h)
                };
                (make_even(comp_w), make_even(comp_h))
            } else {
                auto_composition_dims(video_width, video_height, padding)
            }
        },
    };

    ExportDimensions {
        crop_enabled,
        padding,
        video_width,
        video_height,
        composition_width,
        composition_height,
        output_width: composition_width,
        output_height: composition_height,
        use_manual_composition,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop(enabled: bool, width: u32, height: u32) -> CropConfig {
        CropConfig {
            enabled,
            x: 0,
            y: 0,
            width,
            height,
            lock_aspect_ratio: false,
            aspect_ratio: None,
        }
    }

    #[test]
    fn plans_auto_mode_with_crop_and_padding() {
        let dims = plan_export_dimensions(
            1921,
            1081,
            &crop(true, 1001, 501),
            &CompositionConfig::default(),
            true,
            10.0,
        );

        assert!(dims.crop_enabled);
        assert_eq!(dims.padding, 10);
        assert_eq!(dims.video_width, 1000);
        assert_eq!(dims.video_height, 500);
        assert_eq!(dims.composition_width, 1020);
        assert_eq!(dims.composition_height, 520);
        assert!(!dims.use_manual_composition);
    }

    #[test]
    fn plans_manual_fixed_dimensions() {
        let composition = CompositionConfig {
            mode: CompositionMode::Manual,
            aspect_ratio: None,
            aspect_preset: None,
            width: Some(1919),
            height: Some(1079),
        };
        let dims = plan_export_dimensions(1920, 1080, &crop(false, 0, 0), &composition, false, 0.0);

        assert_eq!(dims.composition_width, 1918);
        assert_eq!(dims.composition_height, 1078);
        assert!(dims.use_manual_composition);
    }

    #[test]
    fn plans_manual_aspect_ratio_from_video() {
        let composition = CompositionConfig {
            mode: CompositionMode::Manual,
            aspect_ratio: Some(1.0),
            aspect_preset: Some("1:1".to_string()),
            width: None,
            height: None,
        };
        let dims = plan_export_dimensions(1920, 1080, &crop(false, 0, 0), &composition, true, 16.0);

        assert_eq!(dims.video_width, 1920);
        assert_eq!(dims.video_height, 1080);
        assert_eq!(dims.composition_width, 1952);
        assert_eq!(dims.composition_height, 1952);
        assert!(dims.use_manual_composition);
    }

    #[test]
    fn manual_mode_without_ratio_falls_back_to_auto_dims() {
        let composition = CompositionConfig {
            mode: CompositionMode::Manual,
            aspect_ratio: None,
            aspect_preset: None,
            width: None,
            height: None,
        };
        let dims = plan_export_dimensions(1280, 720, &crop(false, 0, 0), &composition, true, 5.0);

        assert_eq!(dims.composition_width, 1290);
        assert_eq!(dims.composition_height, 730);
        assert!(dims.use_manual_composition);
    }
}
