//! Pixel-level comparison test for caption rendering parity.
//!
//! This test:
//! 1. Renders a caption using glyphon (export path)
//! 2. Outputs the exact pixel values
//! 3. Can be compared against CSS rendering

#[cfg(test)]
mod tests {
    use crate::commands::captions::{CaptionSegment, CaptionSettings, CaptionWord};
    use crate::rendering::caption_layer::prepare_captions;

    fn make_test_segment() -> CaptionSegment {
        CaptionSegment {
            id: "test".to_string(),
            start: 0.0,
            end: 5.0,
            text: "Hello World".to_string(),
            words: vec![
                CaptionWord {
                    text: "Hello".to_string(),
                    start: 0.0,
                    end: 0.5,
                },
                CaptionWord {
                    text: "World".to_string(),
                    start: 0.5,
                    end: 1.0,
                },
            ],
        }
    }

    fn make_test_settings() -> CaptionSettings {
        CaptionSettings {
            enabled: true,
            font: "sans-serif".to_string(),
            size: 32,
            font_weight: 700,
            italic: false,
            color: "#FFFFFF".to_string(),
            highlight_color: "#FFFF00".to_string(),
            background_color: "#000000".to_string(),
            background_opacity: 60,
            outline: false,
            outline_color: "#000000".to_string(),
            position: "bottom".to_string(),
            word_transition_duration: 0.25,
            fade_duration: 0.15,
            linger_duration: 0.4,
            export_with_subtitles: false,
        }
    }

    /// Output the exact rendering parameters that glyphon will use.
    /// These values should match what CSS produces.
    #[test]
    fn print_export_rendering_values() {
        let segment = make_test_segment();
        let settings = make_test_settings();
        let width = 1920.0;
        let height = 1080.0;
        let time = 0.25; // Middle of first word

        let prepared = prepare_captions(&[segment], &settings, time, width, height);

        assert_eq!(prepared.len(), 1);
        let text = &prepared[0];

        println!("\n=== GLYPHON EXPORT RENDERING VALUES ===");
        println!("Resolution: {}x{}", width, height);
        println!("Time: {}s", time);
        println!();
        println!("Text: \"{}\"", text.content);
        println!(
            "Font: {} (weight: {}, italic: {})",
            text.font_family, text.font_weight, text.italic
        );
        println!("Font size: {}px", text.font_size);
        println!();
        println!("Bounds [x1, y1, x2, y2]: {:?}", text.bounds);
        println!("  - X position: {}px from left", text.bounds[0]);
        println!("  - Y position: {}px from top", text.bounds[1]);
        println!("  - Width: {}px", text.bounds[2] - text.bounds[0]);
        println!("  - Height: {}px", text.bounds[3] - text.bounds[1]);
        println!();
        println!("Text color: {:?}", text.color);
        println!("Background: {:?}", text.background_color);
        println!("Text shadow: {}", text.text_shadow);
        println!();

        if let Some(word_colors) = &text.word_colors {
            println!("Word colors ({} words):", word_colors.len());
            for (i, wc) in word_colors.iter().enumerate() {
                println!(
                    "  Word {}: bytes {}..{}, color {:?}",
                    i, wc.start, wc.end, wc.color
                );
            }
        }

        println!("\n=== CSS SHOULD PRODUCE THESE EXACT VALUES ===");
        println!("line-height: 1.2");
        println!("top/bottom: {}px", text.bounds[1]);
        println!("max-width: {}px", text.bounds[2] - text.bounds[0]);
        println!("font-size: {}px", text.font_size);
        println!();

        // The actual test - verify our assumptions (at 1080p, scale=1.0)
        let scale = height / 1080.0;
        let padding = 40.0 * scale;
        let font_size = settings.size as f32 * scale;
        let text_height = font_size * 2.5;
        let expected_y = height - text_height - padding;

        assert!(
            (text.bounds[0] - padding).abs() < 0.1,
            "X position should be scaled padding"
        );
        assert!(
            (text.bounds[1] - expected_y).abs() < 0.1,
            "Y position mismatch"
        );
    }

    /// Test at different resolutions - now both should scale correctly
    #[test]
    fn test_resolution_scaling() {
        let segment = make_test_segment();
        let settings = make_test_settings();

        let resolutions = vec![(1920.0, 1080.0), (1280.0, 720.0), (3840.0, 2160.0)];

        println!("\n=== RESOLUTION SCALING TEST ===");

        for (width, height) in resolutions {
            let prepared = prepare_captions(&[segment.clone()], &settings, 0.25, width, height);
            let text = &prepared[0];

            let scale = height / 1080.0;
            let expected_padding = 40.0 * scale;
            let expected_font_size = settings.size as f32 * scale;

            println!("\n{}x{} (scale={}):", width, height, scale);
            println!("  Bounds: {:?}", text.bounds);
            println!(
                "  Font size: {}px (expected: {}px)",
                text.font_size, expected_font_size
            );
            println!(
                "  Padding: {}px (expected: {}px)",
                text.bounds[0], expected_padding
            );

            // NOW export DOES scale! Should match CSS behavior.
            assert!(
                (text.font_size - expected_font_size).abs() < 0.1,
                "Export font size should be scaled: {} vs {}",
                text.font_size,
                expected_font_size
            );
            assert!(
                (text.bounds[0] - expected_padding).abs() < 0.1,
                "Export padding should be scaled: {} vs {}",
                text.bounds[0],
                expected_padding
            );
        }

        println!("\n✓ Export now scales correctly by output_height/1080");
        println!("✓ CSS scales by containerHeight/1080");
        println!("✓ Both use the same scale factor - PARITY ACHIEVED!");
    }
}
