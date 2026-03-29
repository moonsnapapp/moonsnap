//! GPU cursor overlay renderer for export.
//!
//! Renders either a textured cursor quad or the circle cursor indicator on top
//! of the already-composited export frame. This avoids the per-frame CPU cursor
//! blending pass after GPU readback for the common non-motion-blur path.

use std::sync::Arc;

use wgpu::{Device, Queue};

/// Planned GPU cursor overlay for a single frame.
#[derive(Debug, Clone)]
pub struct CursorOverlayPrimitive {
    /// Quad rect in NDC space: min_x, min_y, max_x, max_y.
    pub quad_rect: [f32; 4],
    /// Final overlay opacity.
    pub opacity: f32,
    /// Whether to render the circle cursor indicator instead of sampling a texture.
    pub render_as_circle: bool,
    /// Cursor image RGBA bytes when `render_as_circle` is false.
    pub image: Option<Arc<[u8]>>,
    /// Cursor image width in pixels.
    pub image_width: u32,
    /// Cursor image height in pixels.
    pub image_height: u32,
}

const CURSOR_OVERLAY_SHADER: &str = r#"
struct Uniforms {
    quad_rect: vec4<f32>,
    params: vec4<f32>, // opacity, render_as_circle, 0, 0
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var cursor_texture: texture_2d<f32>;
@group(0) @binding(2) var cursor_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    let corner = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
    );

    let c = corner[vi];
    let min_xy = uniforms.quad_rect.xy;
    let max_xy = uniforms.quad_rect.zw;
    let ndc = mix(min_xy, max_xy, c);

    var out: VertexOutput;
    out.position = vec4<f32>(ndc, 0.0, 1.0);
    out.uv = vec2<f32>(c.x, 1.0 - c.y);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let opacity = uniforms.params.x;
    if (opacity <= 0.0) {
        discard;
    }

    if (uniforms.params.y > 0.5) {
        let centered = in.uv * 2.0 - vec2<f32>(1.0, 1.0);
        let dist = length(centered);
        let outer_radius = 1.0;
        let inner_radius = 10.0 / 12.0;
        let aa = max(fwidth(dist), 0.015);

        if (dist > outer_radius + aa) {
            discard;
        }

        let fill_alpha = (1.0 - smoothstep(inner_radius - aa, inner_radius + aa, dist)) * 0.5 * opacity;
        let border_band = smoothstep(inner_radius - aa, inner_radius + aa, dist)
            * (1.0 - smoothstep(outer_radius - aa, outer_radius + aa, dist));
        let border_alpha = border_band * 0.7 * opacity;
        let alpha = fill_alpha + border_alpha;

        if (alpha < 0.004) {
            discard;
        }

        let fill_rgb = vec3<f32>(1.0, 1.0, 1.0);
        let border_rgb = vec3<f32>(50.0 / 255.0, 50.0 / 255.0, 50.0 / 255.0);
        let rgb = (fill_rgb * fill_alpha + border_rgb * border_alpha) / alpha;
        return vec4<f32>(rgb, alpha);
    }

    let color = textureSample(cursor_texture, cursor_sampler, in.uv);
    let alpha = color.a * opacity;
    if (alpha < 0.004) {
        discard;
    }

    return vec4<f32>(color.rgb, alpha);
}
"#;

pub struct CursorOverlayLayer {
    device: Arc<Device>,
    queue: Arc<Queue>,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    placeholder_texture: wgpu::Texture,
}

impl CursorOverlayLayer {
    pub fn new(device: &Arc<Device>, queue: &Arc<Queue>) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Cursor Overlay Shader"),
            source: wgpu::ShaderSource::Wgsl(CURSOR_OVERLAY_SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Cursor Overlay Bind Group Layout"),
            entries: &[
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Cursor Overlay Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Cursor Overlay Pipeline"),
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

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Cursor Overlay Uniforms"),
            size: 32,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Cursor Overlay Sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let placeholder_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Cursor Overlay Placeholder Texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &placeholder_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[0u8, 0, 0, 0],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        Self {
            device: Arc::clone(device),
            queue: Arc::clone(queue),
            pipeline,
            bind_group_layout,
            uniform_buffer,
            sampler,
            placeholder_texture,
        }
    }

    pub fn render_overlay(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        output_view: &wgpu::TextureView,
        overlay: &CursorOverlayPrimitive,
    ) {
        if overlay.opacity <= 0.0 {
            return;
        }

        let cursor_texture_storage = if overlay.render_as_circle {
            None
        } else {
            overlay.image.as_ref().map(|image| {
                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Cursor Overlay Texture"),
                    size: wgpu::Extent3d {
                        width: overlay.image_width.max(1),
                        height: overlay.image_height.max(1),
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
                    image.as_ref(),
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(overlay.image_width.max(1) * 4),
                        rows_per_image: Some(overlay.image_height.max(1)),
                    },
                    wgpu::Extent3d {
                        width: overlay.image_width.max(1),
                        height: overlay.image_height.max(1),
                        depth_or_array_layers: 1,
                    },
                );

                texture
            })
        };

        let cursor_view = cursor_texture_storage
            .as_ref()
            .map(|texture| texture.create_view(&wgpu::TextureViewDescriptor::default()))
            .unwrap_or_else(|| {
                self.placeholder_texture
                    .create_view(&wgpu::TextureViewDescriptor::default())
            });

        let uniforms = [
            overlay.quad_rect[0],
            overlay.quad_rect[1],
            overlay.quad_rect[2],
            overlay.quad_rect[3],
            overlay.opacity,
            if overlay.render_as_circle { 1.0 } else { 0.0 },
            0.0,
            0.0,
        ];
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&uniforms));

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Cursor Overlay Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&cursor_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Cursor Overlay Pass"),
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
