//! ACTUAL pixel rendering test for caption parity.
//!
//! This test renders captions using glyphon and outputs actual pixel data
//! that can be compared against CSS rendering.

#[cfg(test)]
mod tests {
    use crate::commands::captions::{CaptionSegment, CaptionSettings, CaptionWord};
    use crate::rendering::caption_layer::prepare_captions;
    use crate::rendering::renderer::Renderer;
    use crate::rendering::text_layer::TextLayer;
    use image::{ImageBuffer, Rgba};
    use std::path::PathBuf;

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

    /// Render caption to PNG file for visual comparison.
    /// Run with: cargo test render_caption_to_png -- --nocapture --ignored
    #[tokio::test]
    #[ignore] // Run manually: cargo test render_caption_to_png -- --ignored --nocapture
    async fn render_caption_to_png() {
        let segment = make_test_segment();
        let settings = make_test_settings();

        // Test at multiple resolutions
        let resolutions = vec![
            (1920, 1080, "1080p"),
            (1280, 720, "720p"),
            (960, 540, "540p"), // Typical preview size
        ];

        // Initialize renderer
        let renderer = Renderer::new().await.expect("Failed to create renderer");
        let device = renderer.device();
        let queue = renderer.queue();

        for (width, height, name) in resolutions {
            println!("\n=== Rendering {} ({}x{}) ===", name, width, height);

            // Prepare caption
            let prepared = prepare_captions(
                &[segment.clone()],
                &settings,
                0.25, // Time when "Hello" is highlighted
                width as f32,
                height as f32,
            );

            if prepared.is_empty() {
                println!("No caption prepared!");
                continue;
            }

            let text = &prepared[0];
            println!("Font size: {}px", text.font_size);
            println!("Bounds: {:?}", text.bounds);
            println!("Position: ({}, {})", text.bounds[0], text.bounds[1]);

            // Create text layer
            let mut text_layer = TextLayer::new(device, queue);

            // Create output texture
            let output_texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("caption_test_output"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });

            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

            // Clear to transparent
            {
                let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("clear"),
                });
                {
                    let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("clear_pass"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &output_view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: None,
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    });
                }
                queue.submit(std::iter::once(encoder.finish()));
            }

            // Prepare text
            text_layer.prepare(device, queue, (width, height), &prepared);

            // Render backgrounds
            if text_layer.has_backgrounds() {
                let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("bg_encoder"),
                });
                {
                    let mut bg_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("bg_pass"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &output_view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: None,
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    });
                    text_layer.render_backgrounds(&mut bg_pass);
                }
                queue.submit(std::iter::once(encoder.finish()));
            }

            // Render text
            if text_layer.has_texts() {
                let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("text_encoder"),
                });
                {
                    let mut text_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("text_pass"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &output_view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Load,
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        depth_stencil_attachment: None,
                        timestamp_writes: None,
                        occlusion_query_set: None,
                    });
                    text_layer.render(&mut text_pass);
                }
                queue.submit(std::iter::once(encoder.finish()));
            }

            // Read pixels back
            let pixels = renderer.read_texture(&output_texture, width, height).await;

            // Save to PNG
            let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
                ImageBuffer::from_raw(width, height, pixels.clone())
                    .expect("Failed to create image buffer");

            let output_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test_output");
            std::fs::create_dir_all(&output_dir).ok();

            let output_path = output_dir.join(format!("caption_export_{}.png", name));
            img.save(&output_path).expect("Failed to save PNG");

            println!("Saved: {}", output_path.display());

            // Print key measurements for CSS comparison
            let scale = height as f32 / 1080.0;
            println!("\n--- VALUES FOR CSS COMPARISON ---");
            println!("Scale factor: {}", scale);
            println!(
                "Font size: {}px (settings.size * scale = {} * {} = {})",
                text.font_size,
                settings.size,
                scale,
                settings.size as f32 * scale
            );
            println!(
                "Padding from edge: {}px (40 * scale = {})",
                text.bounds[0],
                40.0 * scale
            );
            println!("Y position (top of text area): {}px", text.bounds[1]);
            println!("Bottom gap: {}px", height as f32 - text.bounds[3]);
        }

        println!("\n=== INSTRUCTIONS ===");
        println!("1. Open the app and take screenshots of caption preview");
        println!("2. Compare with test_output/caption_export_*.png");
        println!("3. Verify: text position, size, background, word highlighting");
    }

    /// Quick sanity check that rendering produces non-empty output
    #[tokio::test]
    async fn test_caption_renders_pixels() {
        let segment = make_test_segment();
        let settings = make_test_settings();

        let renderer = Renderer::new().await.expect("Failed to create renderer");
        let device = renderer.device();
        let queue = renderer.queue();

        let width = 800u32;
        let height = 600u32;

        let prepared = prepare_captions(&[segment], &settings, 0.25, width as f32, height as f32);

        assert!(!prepared.is_empty(), "Should prepare caption");

        let mut text_layer = TextLayer::new(device, queue);

        let output_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("test"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Clear
        {
            let mut encoder =
                device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            {
                let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
            }
            queue.submit(std::iter::once(encoder.finish()));
        }

        // Prepare and render
        text_layer.prepare(device, queue, (width, height), &prepared);

        if text_layer.has_backgrounds() {
            let mut encoder =
                device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                text_layer.render_backgrounds(&mut pass);
            }
            queue.submit(std::iter::once(encoder.finish()));
        }

        if text_layer.has_texts() {
            let mut encoder =
                device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                text_layer.render(&mut pass);
            }
            queue.submit(std::iter::once(encoder.finish()));
        }

        // Read back
        let pixels = renderer.read_texture(&output_texture, width, height).await;

        // Check that SOME pixels are non-transparent (text was rendered)
        let non_transparent_count = pixels.chunks(4).filter(|rgba| rgba[3] > 0).count();

        println!(
            "Non-transparent pixels: {} / {}",
            non_transparent_count,
            width * height
        );
        assert!(
            non_transparent_count > 100,
            "Should render visible text pixels, got {}",
            non_transparent_count
        );
    }
}
