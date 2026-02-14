//! GPU-based NV12 → RGBA conversion with optional crop.
//!
//! Uploads Y (R8Unorm) and UV (Rg8Unorm) planes to separate textures,
//! then runs a lightweight BT.709 limited-range YCbCr→RGB fragment shader.
//! The GPU does bilinear upscaling of the half-resolution UV plane for free.
//!
//! Crop is applied during conversion via viewport + UV offset, eliminating
//! the CPU `crop_decoded_frame` path for NV12 frames.

use std::sync::Arc;
use wgpu::{Device, Queue};

/// Crop rectangle in source video pixel coordinates.
#[derive(Debug, Clone, Copy)]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Uniform buffer layout for the NV12 conversion shader.
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Nv12Params {
    /// Source texture dimensions (width, height, 0, 0).
    source_size: [f32; 4],
    /// Crop offset in pixels (x, y, 0, 0). Zero when no crop.
    crop_offset: [f32; 4],
    /// Crop size in pixels (width, height, 0, 0). Equals source_size when no crop.
    crop_size: [f32; 4],
}

/// WGSL shader for NV12 → RGBA conversion (BT.709 limited range).
const NV12_SHADER: &str = r#"
struct Params {
    source_size: vec4<f32>,   // width, height, 0, 0
    crop_offset: vec4<f32>,   // x, y, 0, 0
    crop_size: vec4<f32>,     // width, height, 0, 0
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var y_texture: texture_2d<f32>;
@group(0) @binding(2) var uv_texture: texture_2d<f32>;
@group(0) @binding(3) var tex_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// Fullscreen triangle (covers clip space with a single triangle)
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0)
    );

    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    output.uv = uvs[vertex_index];
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Map fragment UV (0-1 within viewport) to source texture coordinates
    // accounting for crop offset
    let src_uv = (input.uv * params.crop_size.xy + params.crop_offset.xy) / params.source_size.xy;

    // Sample Y plane (R8Unorm → float in r channel)
    let y_sample = textureSample(y_texture, tex_sampler, src_uv).r;

    // Sample UV plane (Rg8Unorm → float in rg channels)
    // Hardware bilinear filtering handles the half-resolution upscale
    let uv_sample = textureSample(uv_texture, tex_sampler, src_uv);

    // BT.709 limited range YCbCr → RGB
    let y = (y_sample - 16.0 / 255.0) * (255.0 / 219.0);
    let cb = (uv_sample.r - 128.0 / 255.0) * (255.0 / 224.0);
    let cr = (uv_sample.g - 128.0 / 255.0) * (255.0 / 224.0);

    // BT.709 matrix
    let r = y + 1.5748 * cr;
    let g = y - 0.1873 * cb - 0.4681 * cr;
    let b = y + 1.8556 * cb;

    // Output sRGB values directly (target view is Rgba8Unorm, no linear→sRGB on write).
    // The compositor reads via the default Rgba8UnormSrgb view (sRGB→linear on read),
    // matching the existing RGBA upload path exactly.
    return vec4<f32>(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), 1.0);
}
"#;

/// GPU NV12 → RGBA converter.
///
/// Pre-allocates Y and UV textures at source resolution. Call `convert()`
/// each frame to upload NV12 data and render RGBA into the target texture.
pub struct Nv12Converter {
    device: Arc<Device>,
    queue: Arc<Queue>,
    y_texture: wgpu::Texture,
    uv_texture: wgpu::Texture,
    sampler: wgpu::Sampler,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    params_buffer: wgpu::Buffer,
    source_width: u32,
    source_height: u32,
}

impl Nv12Converter {
    /// Create a new NV12 converter for the given source dimensions.
    pub fn new(
        device: &Arc<Device>,
        queue: &Arc<Queue>,
        source_width: u32,
        source_height: u32,
    ) -> Self {
        let device = Arc::clone(device);
        let queue = Arc::clone(queue);

        // Y plane: full resolution, R8Unorm (1 byte per pixel)
        let y_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("NV12 Y Plane"),
            size: wgpu::Extent3d {
                width: source_width,
                height: source_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // UV plane: half resolution, Rg8Unorm (2 bytes per pixel pair)
        let uv_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("NV12 UV Plane"),
            size: wgpu::Extent3d {
                width: source_width / 2,
                height: source_height / 2,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rg8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Linear sampler for bilinear UV upscaling
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("NV12 Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("NV12 Converter Shader"),
            source: wgpu::ShaderSource::Wgsl(NV12_SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("NV12 Bind Group Layout"),
            entries: &[
                // Params uniform
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Y texture
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
                // UV texture
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
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
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("NV12 Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        // Target format is Rgba8Unorm (NOT Rgba8UnormSrgb) to avoid double-gamma.
        // The shader writes sRGB values directly; the compositor later reads via
        // the default Rgba8UnormSrgb view which applies sRGB→linear on read.
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("NV12 Converter Pipeline"),
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
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
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

        let params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("NV12 Params"),
            size: std::mem::size_of::<Nv12Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            device,
            queue,
            y_texture,
            uv_texture,
            sampler,
            pipeline,
            bind_group_layout,
            params_buffer,
            source_width,
            source_height,
        }
    }

    /// Convert NV12 data to RGBA, writing into `target_texture`.
    ///
    /// `nv12_data`: raw NV12 bytes (Y plane followed by interleaved UV plane).
    /// `target_texture`: must have been created with `RENDER_ATTACHMENT` usage
    ///   and `view_formats: &[Rgba8Unorm]` (base format Rgba8UnormSrgb).
    /// `crop`: optional crop rectangle in source pixel coordinates.
    ///   When Some, only the cropped region is rendered (viewport sized to crop).
    ///   When None, the full source is rendered.
    pub fn convert(
        &self,
        nv12_data: &[u8],
        target_texture: &wgpu::Texture,
        crop: Option<CropRect>,
    ) {
        let w = self.source_width;
        let h = self.source_height;
        let y_plane_size = (w * h) as usize;

        // Upload Y plane (R8Unorm: 1 byte per pixel, bytes_per_row = width)
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.y_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &nv12_data[..y_plane_size],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w),
                rows_per_image: Some(h),
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );

        // Upload UV plane (Rg8Unorm: 2 bytes per texel, width/2 texels per row)
        // bytes_per_row = width (because width/2 texels × 2 bytes each = width bytes)
        let uv_w = w / 2;
        let uv_h = h / 2;
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.uv_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &nv12_data[y_plane_size..],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w), // width/2 texels * 2 bytes = width
                rows_per_image: Some(uv_h),
            },
            wgpu::Extent3d {
                width: uv_w,
                height: uv_h,
                depth_or_array_layers: 1,
            },
        );

        // Compute crop parameters
        let (crop_x, crop_y, crop_w, crop_h) = match crop {
            Some(c) => (c.x as f32, c.y as f32, c.width as f32, c.height as f32),
            None => (0.0, 0.0, w as f32, h as f32),
        };

        let params = Nv12Params {
            source_size: [w as f32, h as f32, 0.0, 0.0],
            crop_offset: [crop_x, crop_y, 0.0, 0.0],
            crop_size: [crop_w, crop_h, 0.0, 0.0],
        };
        self.queue
            .write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));

        // Create Rgba8Unorm view of target texture (avoids double-gamma)
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(wgpu::TextureFormat::Rgba8Unorm),
            ..Default::default()
        });

        let y_view = self
            .y_texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let uv_view = self
            .uv_texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("NV12 Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.params_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&y_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&uv_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("NV12 Convert Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("NV12 Convert Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Set viewport to crop dimensions (renders only the cropped region)
            let target_size = target_texture.size();
            render_pass.set_viewport(
                0.0,
                0.0,
                target_size.width as f32,
                target_size.height as f32,
                0.0,
                1.0,
            );

            render_pass.set_pipeline(&self.pipeline);
            render_pass.set_bind_group(0, &bind_group, &[]);
            render_pass.draw(0..3, 0..1);
        }

        self.queue.submit(Some(encoder.finish()));
    }
}
