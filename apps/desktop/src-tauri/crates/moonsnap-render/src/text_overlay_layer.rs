//! GPU text overlay renderer for export.
//!
//! Renders pre-rendered text images as textured quads on the GPU, supporting
//! per-fragment typewriter reveal clipping via `discard`. This replaces the
//! CPU alpha-blending loop that previously ran after GPU readback.

use std::collections::HashMap;
use std::sync::Arc;

use wgpu::{Device, Queue};

use crate::prerendered_text::PreRenderedTextStore;
use crate::types::TextOverlayQuad;

/// WGSL shader for text overlay quads with typewriter reveal.
///
/// Renders a textured quad positioned in NDC space. The typewriter effect is
/// implemented as per-fragment UV-space clipping: fragments outside the revealed
/// region are discarded. This avoids the 2-rect split needed by the CPU path.
const TEXT_OVERLAY_SHADER: &str = r#"
struct Uniforms {
    // NDC position of the quad: (min_x, min_y, max_x, max_y)
    quad_rect: vec4<f32>,
    // opacity, typewriter_active (0 or 1), full_reveal_v, 0
    params: vec4<f32>,
    // last_line_v_top, last_line_v_bottom, last_line_u_left, last_line_u_right
    typewriter: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var text_texture: texture_2d<f32>;
@group(0) @binding(2) var text_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    // 6 vertices = 2 triangles for a quad
    // Triangle 1: 0,1,2  Triangle 2: 2,1,3
    // Corners: 0=TL, 1=TR, 2=BL, 3=BR
    let corner = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), // TL
        vec2<f32>(1.0, 0.0), // TR
        vec2<f32>(0.0, 1.0), // BL
        vec2<f32>(0.0, 1.0), // BL
        vec2<f32>(1.0, 0.0), // TR
        vec2<f32>(1.0, 1.0), // BR
    );

    let c = corner[vi];
    let min_xy = uniforms.quad_rect.xy;
    let max_xy = uniforms.quad_rect.zw;
    let ndc = mix(min_xy, max_xy, c);

    var out: VertexOutput;
    out.position = vec4<f32>(ndc, 0.0, 1.0);
    // UV y flipped: NDC y increases upward, but texture v increases downward.
    // c.y=0 maps to quad_min.y (NDC bottom) but should sample texture bottom (v=1).
    out.uv = vec2<f32>(c.x, 1.0 - c.y);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    let opacity = uniforms.params.x;
    let typewriter_active = uniforms.params.y;
    let full_reveal_v = uniforms.params.z;

    // Typewriter clipping
    if (typewriter_active > 0.5) {
        let last_v_top = uniforms.typewriter.x;
        let last_v_bottom = uniforms.typewriter.y;
        let last_u_left = uniforms.typewriter.z;
        let last_u_right = uniforms.typewriter.w;

        // Above fully-revealed region: always visible
        // In the last (partial) line: clip to revealed width
        // Below the last line: discard
        if (uv.y > last_v_bottom) {
            discard;
        }
        if (uv.y >= last_v_top && uv.y < last_v_bottom) {
            // On the partial line â€” clip horizontally
            if (uv.x < last_u_left || uv.x > last_u_right) {
                discard;
            }
        }
        // uv.y < full_reveal_v: fully revealed, no clip
        // uv.y >= full_reveal_v && uv.y < last_v_top: also part of fully revealed lines
    }

    let color = textureSample(text_texture, text_sampler, uv);

    // Pre-multiplied alpha output: multiply RGB by opacity, preserve alpha structure
    let alpha = color.a * opacity;
    if (alpha < 0.004) {
        discard;
    }
    return vec4<f32>(color.rgb * opacity, alpha);
}
"#;

/// GPU text overlay renderer.
///
/// Holds the render pipeline and uploaded textures for all text segments.
/// Textures are uploaded once at export start; per-frame work is just
/// uniform writes + draw calls.
pub struct TextOverlayLayer {
    device: Arc<Device>,
    queue: Arc<Queue>,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    /// GPU textures keyed by segment index.
    textures: HashMap<usize, (wgpu::Texture, wgpu::TextureView)>,
}

impl TextOverlayLayer {
    pub fn new(device: &Arc<Device>, queue: &Arc<Queue>) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Text Overlay Shader"),
            source: wgpu::ShaderSource::Wgsl(TEXT_OVERLAY_SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Text Overlay Bind Group Layout"),
            entries: &[
                // Uniforms
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Texture
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Sampler
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Text Overlay Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Text Overlay Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Uniform buffer sized for 3x vec4<f32> = 48 bytes
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Text Overlay Uniforms"),
            size: 48,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Text Overlay Sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        Self {
            device: Arc::clone(device),
            queue: Arc::clone(queue),
            pipeline,
            bind_group_layout,
            uniform_buffer,
            sampler,
            textures: HashMap::new(),
        }
    }

    /// Upload all pre-rendered text images as GPU textures.
    /// Called once at export start.
    pub fn upload_textures(&mut self, store: &PreRenderedTextStore) {
        self.textures.clear();

        for (idx, image) in store.images() {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(&format!("Text Overlay Tex {}", idx)),
                size: wgpu::Extent3d {
                    width: image.width,
                    height: image.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });

            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &image.rgba_data,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(image.width * 4),
                    rows_per_image: Some(image.height),
                },
                wgpu::Extent3d {
                    width: image.width,
                    height: image.height,
                    depth_or_array_layers: 1,
                },
            );

            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            self.textures.insert(*idx, (texture, view));
        }

        log::info!(
            "[TextOverlayLayer] Uploaded {} texture(s) to GPU",
            self.textures.len()
        );
    }

    /// Render text overlay quads onto the output texture.
    ///
    /// Each quad gets its own render pass with `LoadOp::Load` to preserve
    /// existing content (video + captions).
    pub fn render_overlays(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        output_view: &wgpu::TextureView,
        quads: &[TextOverlayQuad],
    ) {
        for quad in quads {
            let Some((_tex, tex_view)) = self.textures.get(&quad.texture_index) else {
                log::warn!(
                    "[TextOverlayLayer] No texture for segment {}",
                    quad.texture_index
                );
                continue;
            };

            // Write uniforms
            let uniforms = [
                // quad_rect: min_x, min_y, max_x, max_y
                quad.quad_min[0],
                quad.quad_min[1],
                quad.quad_max[0],
                quad.quad_max[1],
                // params: opacity, typewriter_active, full_reveal_v, 0
                quad.opacity,
                if quad.typewriter_active { 1.0 } else { 0.0 },
                quad.full_reveal_v,
                0.0,
                // typewriter: last_v_top, last_v_bottom, last_u_left, last_u_right
                quad.last_line_v_top,
                quad.last_line_v_bottom,
                quad.last_line_u_left,
                quad.last_line_u_right,
            ];
            self.queue
                .write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&uniforms));

            let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Text Overlay Bind Group"),
                layout: &self.bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: self.uniform_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(tex_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            });

            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Text Overlay Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: output_view,
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

            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..6, 0..1);
        }
    }

    /// Returns true if any textures have been uploaded.
    pub fn has_textures(&self) -> bool {
        !self.textures.is_empty()
    }
}
