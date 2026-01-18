//! GPU-based text rendering layer using glyphon.
//!
//! Renders text overlays onto video frames using GPU-accelerated text rasterization.
//! Supports optional background rectangles and text shadows.
//! Based on Cap's text rendering implementation.

use glyphon::cosmic_text::Align;
use glyphon::{
    Attrs, Buffer, Cache, Color, Family, FontSystem, Metrics, Resolution, Shaping, Style,
    SwashCache, TextArea, TextAtlas, TextBounds, TextRenderer, Viewport, Weight,
};
use log::warn;
use wgpu::{Device, Queue};

use crate::rendering::text::{PreparedText, WordColor};

/// Simple shader for rendering colored rectangles (for text backgrounds).
const RECT_SHADER: &str = r#"
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.position, 0.0, 1.0);
    output.color = input.color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
"#;

/// Vertex for colored rectangles.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct RectVertex {
    position: [f32; 2],
    color: [f32; 4],
}

/// Background rectangle data for rendering.
struct BackgroundRect {
    bounds: [f32; 4], // left, top, right, bottom in pixels
    color: [f32; 4],  // RGBA
}

/// GPU text rendering layer.
pub struct TextLayer {
    font_system: FontSystem,
    swash_cache: SwashCache,
    text_atlas: TextAtlas,
    text_renderer: TextRenderer,
    viewport: Viewport,
    buffers: Vec<Buffer>,
    // Rectangle rendering for backgrounds
    rect_pipeline: wgpu::RenderPipeline,
    rect_vertex_buffer: wgpu::Buffer,
    background_rects: Vec<BackgroundRect>,
}

impl TextLayer {
    /// Maximum number of background rectangles we can render per frame.
    const MAX_RECTS: usize = 64;

    /// Create a new text layer.
    pub fn new(device: &Device, queue: &Queue) -> Self {
        let font_system = FontSystem::new();
        let swash_cache = SwashCache::new();
        let cache = Cache::new(device);
        let viewport = Viewport::new(device, &cache);
        let mut text_atlas =
            TextAtlas::new(device, queue, &cache, wgpu::TextureFormat::Rgba8UnormSrgb);
        let text_renderer = TextRenderer::new(
            &mut text_atlas,
            device,
            wgpu::MultisampleState::default(),
            None,
        );

        // Create rectangle shader and pipeline
        let rect_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Rectangle Shader"),
            source: wgpu::ShaderSource::Wgsl(RECT_SHADER.into()),
        });

        let rect_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Rectangle Pipeline Layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let rect_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Rectangle Pipeline"),
            layout: Some(&rect_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &rect_shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<RectVertex>() as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            offset: 0,
                            shader_location: 0,
                            format: wgpu::VertexFormat::Float32x2,
                        },
                        wgpu::VertexAttribute {
                            offset: 8,
                            shader_location: 1,
                            format: wgpu::VertexFormat::Float32x4,
                        },
                    ],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &rect_shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Create vertex buffer (6 vertices per rect: 2 triangles)
        let rect_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Rectangle Vertex Buffer"),
            size: (Self::MAX_RECTS * 6 * std::mem::size_of::<RectVertex>()) as wgpu::BufferAddress,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            font_system,
            swash_cache,
            text_atlas,
            text_renderer,
            viewport,
            buffers: Vec::new(),
            rect_pipeline,
            rect_vertex_buffer,
            background_rects: Vec::new(),
        }
    }

    /// Build rich text spans from word colors.
    fn build_rich_text_spans<'a>(
        content: &'a str,
        word_colors: &[WordColor],
        base_attrs: Attrs<'a>,
    ) -> Vec<(&'a str, Attrs<'a>)> {
        let mut spans = Vec::with_capacity(word_colors.len() * 2);
        let mut last_end = 0;

        for wc in word_colors {
            // Add space/gap before this word if any
            if wc.start > last_end && last_end < content.len() {
                let gap = &content[last_end..wc.start.min(content.len())];
                if !gap.is_empty() {
                    spans.push((gap, base_attrs.clone()));
                }
            }

            // Add the word with its color
            if wc.start < content.len() && wc.end <= content.len() {
                let word_text = &content[wc.start..wc.end];
                let word_color = Color::rgba(
                    (wc.color[0].clamp(0.0, 1.0) * 255.0) as u8,
                    (wc.color[1].clamp(0.0, 1.0) * 255.0) as u8,
                    (wc.color[2].clamp(0.0, 1.0) * 255.0) as u8,
                    (wc.color[3].clamp(0.0, 1.0) * 255.0) as u8,
                );
                spans.push((word_text, base_attrs.clone().color(word_color)));
            }

            last_end = wc.end;
        }

        // Add any remaining text after the last word
        if last_end < content.len() {
            spans.push((&content[last_end..], base_attrs));
        }

        spans
    }

    /// Measure the actual rendered size of text in a buffer.
    fn measure_text_size(&self, buffer: &Buffer) -> (f32, f32) {
        let mut max_width: f32 = 0.0;
        let mut total_height: f32 = 0.0;

        for run in buffer.layout_runs() {
            // Track the rightmost glyph position
            let line_width = run
                .glyphs
                .iter()
                .fold(0.0_f32, |acc, glyph| acc.max(glyph.x + glyph.w));
            max_width = max_width.max(line_width);
            total_height = total_height.max(run.line_y + run.line_height);
        }

        (max_width, total_height)
    }

    /// Prepare text for rendering.
    ///
    /// This must be called before `render()` to set up the text buffers and atlas.
    pub fn prepare(
        &mut self,
        device: &Device,
        queue: &Queue,
        output_size: (u32, u32),
        texts: &[PreparedText],
    ) {
        self.buffers.clear();
        self.buffers.reserve(texts.len());
        self.background_rects.clear();
        let mut text_area_data = Vec::with_capacity(texts.len());

        for text in texts {
            let alpha = text.color[3].clamp(0.0, 1.0) * text.opacity.clamp(0.0, 1.0);
            let color = Color::rgba(
                (text.color[0].clamp(0.0, 1.0) * 255.0) as u8,
                (text.color[1].clamp(0.0, 1.0) * 255.0) as u8,
                (text.color[2].clamp(0.0, 1.0) * 255.0) as u8,
                (alpha * 255.0) as u8,
            );

            let width = (text.bounds[2] - text.bounds[0]).max(1.0);
            let height = (text.bounds[3] - text.bounds[1]).max(1.0);

            let metrics = Metrics::new(text.font_size, text.font_size * 1.2);
            let mut buffer = Buffer::new(&mut self.font_system, metrics);
            buffer.set_size(&mut self.font_system, Some(width), Some(height));
            buffer.set_wrap(&mut self.font_system, glyphon::Wrap::Word);

            let family = match text.font_family.trim() {
                "" => Family::SansSerif,
                name => match name.to_ascii_lowercase().as_str() {
                    "sans" | "sans-serif" | "system sans" | "system sans-serif" => {
                        Family::SansSerif
                    },
                    "serif" | "system serif" => Family::Serif,
                    "mono" | "monospace" | "system mono" | "system monospace" => Family::Monospace,
                    _ => Family::Name(name),
                },
            };
            let weight = Weight(text.font_weight.round().clamp(100.0, 900.0) as u16);
            let base_attrs = Attrs::new()
                .family(family)
                .color(color)
                .weight(weight)
                .style(if text.italic {
                    Style::Italic
                } else {
                    Style::Normal
                });

            // Use rich text if word colors are provided, otherwise use simple text
            if let Some(ref word_colors) = text.word_colors {
                // Build rich text spans with per-word coloring
                let spans =
                    Self::build_rich_text_spans(&text.content, word_colors, base_attrs.clone());
                buffer.set_rich_text(
                    &mut self.font_system,
                    spans,
                    &base_attrs,
                    Shaping::Advanced,
                    Some(Align::Center),
                );
            } else {
                buffer.set_text(
                    &mut self.font_system,
                    &text.content,
                    &base_attrs,
                    Shaping::Advanced,
                );
            }

            for line in buffer.lines.iter_mut() {
                line.set_align(Some(Align::Center));
            }

            buffer.shape_until_scroll(&mut self.font_system, false);

            // Measure actual text width after shaping for background
            if let Some(bg_color) = text.background_color {
                let (text_width, text_height) = self.measure_text_size(&buffer);
                if text_width > 0.0 {
                    // Center the background around the text
                    let center_x = text.bounds[0] + width / 2.0;
                    let center_y = text.bounds[1] + height / 2.0;
                    let padding_h = 16.0;
                    let padding_v = 8.0;

                    self.background_rects.push(BackgroundRect {
                        bounds: [
                            (center_x - text_width / 2.0 - padding_h).max(0.0),
                            (center_y - text_height / 2.0 - padding_v).max(0.0),
                            (center_x + text_width / 2.0 + padding_h).min(output_size.0 as f32),
                            (center_y + text_height / 2.0 + padding_v).min(output_size.1 as f32),
                        ],
                        color: bg_color,
                    });
                }
            }

            let bounds = TextBounds {
                left: text.bounds[0].floor() as i32,
                top: text.bounds[1].floor() as i32,
                right: (text.bounds[0] + width).ceil() as i32,
                bottom: (text.bounds[1] + height).ceil() as i32,
            };

            self.buffers.push(buffer);
            text_area_data.push((bounds, text.bounds[0], text.bounds[1], color));
        }

        // Prepare background rectangles
        self.prepare_rects(queue, output_size);

        let text_areas = self
            .buffers
            .iter()
            .zip(text_area_data)
            .map(|(buffer, (bounds, left, top, color))| TextArea {
                buffer,
                left,
                top,
                scale: 1.0,
                bounds,
                default_color: color,
                custom_glyphs: &[],
            })
            .collect::<Vec<_>>();

        self.viewport.update(
            queue,
            Resolution {
                width: output_size.0,
                height: output_size.1,
            },
        );

        if let Err(error) = self.text_renderer.prepare(
            device,
            queue,
            &mut self.font_system,
            &mut self.text_atlas,
            &self.viewport,
            text_areas,
            &mut self.swash_cache,
        ) {
            warn!("Failed to prepare text: {error:?}");
        }
    }

    /// Prepare background rectangle vertex data.
    fn prepare_rects(&mut self, queue: &Queue, output_size: (u32, u32)) {
        if self.background_rects.is_empty() {
            return;
        }

        let w = output_size.0 as f32;
        let h = output_size.1 as f32;

        let mut vertices = Vec::with_capacity(self.background_rects.len() * 6);

        for rect in &self.background_rects {
            // Convert pixel coordinates to normalized device coordinates (-1 to 1)
            let left = (rect.bounds[0] / w) * 2.0 - 1.0;
            let top = 1.0 - (rect.bounds[1] / h) * 2.0; // Flip Y
            let right = (rect.bounds[2] / w) * 2.0 - 1.0;
            let bottom = 1.0 - (rect.bounds[3] / h) * 2.0; // Flip Y

            let color = rect.color;

            // Two triangles forming a quad
            // Triangle 1: top-left, top-right, bottom-left
            vertices.push(RectVertex {
                position: [left, top],
                color,
            });
            vertices.push(RectVertex {
                position: [right, top],
                color,
            });
            vertices.push(RectVertex {
                position: [left, bottom],
                color,
            });

            // Triangle 2: top-right, bottom-right, bottom-left
            vertices.push(RectVertex {
                position: [right, top],
                color,
            });
            vertices.push(RectVertex {
                position: [right, bottom],
                color,
            });
            vertices.push(RectVertex {
                position: [left, bottom],
                color,
            });
        }

        queue.write_buffer(&self.rect_vertex_buffer, 0, bytemuck::cast_slice(&vertices));
    }

    /// Render background rectangles to the given render pass.
    pub fn render_backgrounds<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        if self.background_rects.is_empty() {
            return;
        }

        pass.set_pipeline(&self.rect_pipeline);
        pass.set_vertex_buffer(0, self.rect_vertex_buffer.slice(..));
        pass.draw(0..(self.background_rects.len() * 6) as u32, 0..1);
    }

    /// Render text to the given render pass.
    pub fn render<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        if let Err(error) = self
            .text_renderer
            .render(&self.text_atlas, &self.viewport, pass)
        {
            warn!("Failed to render text: {error:?}");
        }
    }

    /// Check if there are any texts to render.
    pub fn has_texts(&self) -> bool {
        !self.buffers.is_empty()
    }

    /// Check if there are any background rectangles to render.
    pub fn has_backgrounds(&self) -> bool {
        !self.background_rects.is_empty()
    }
}
