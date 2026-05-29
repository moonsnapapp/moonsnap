//! Frame compositor using wgpu shaders.
//!
//! Composites video frames with zoom, webcam overlay (with circle/squircle mask and shadow).
//! Also supports background rendering (solid colors, gradients, images).
//! Shadow and squircle implementation based on Cap's rendering.

// Allow unused fields - kept for potential future use
#![allow(dead_code)]

use std::sync::Arc;
use wgpu::{Device, Queue};

use super::renderer::Renderer;
use moonsnap_render::background::{Background, BackgroundLayer};
use moonsnap_render::cursor_overlay_layer::{CursorOverlayLayer, CursorOverlayPrimitive};
use moonsnap_render::parity::calculate_composition_bounds;
use moonsnap_render::prerendered_text::PreRenderedTextStore;
use moonsnap_render::text::PreparedText;
use moonsnap_render::text_layer::TextLayer;
use moonsnap_render::text_overlay_layer::TextOverlayLayer;
use moonsnap_render::types::{
    BackgroundStyle, BackgroundType, CornerStyle, DecodedFrame, RenderOptions, TextOverlayQuad,
    WebcamShape,
};

/// WGSL shader for video compositing with zoom, padding, rounding, shadow, border, and webcam overlay.
/// Supports circle, squircle (superellipse), and rounded rectangle shapes with drop shadow.
const COMPOSITOR_SHADER: &str = include_str!("shaders/compositor.wgsl");

/// Extended uniforms including webcam and frame styling parameters.
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct ExtendedUniforms {
    pub video_size: [f32; 4],
    pub output_size: [f32; 4],
    pub zoom: [f32; 4],
    pub time_flags: [f32; 4],
    pub webcam_rect: [f32; 4],
    pub webcam_params: [f32; 4], // shape, shadow_strength, mirror, corner_radius
    pub webcam_shadow: [f32; 4], // shadow_size, shadow_opacity, shadow_blur, 0
    pub webcam_tex_size: [f32; 4],
    // Video frame styling
    pub frame_bounds: [f32; 4],     // x, y, width, height in pixels
    pub frame_rounding: [f32; 4],   // rounding_px, rounding_type, 0, 0
    pub frame_shadow: [f32; 4],     // enabled, size, opacity, blur
    pub frame_border: [f32; 4],     // enabled, width, opacity, 0
    pub border_color: [f32; 4],     // r, g, b, a
    pub zoom_motion_blur: [f32; 4], // directional_px, dir_x, dir_y, radial_px
}

/// Compositor for GPU-accelerated frame rendering.
pub struct Compositor {
    device: Arc<Device>,
    queue: Arc<Queue>,
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    uniform_buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    // Placeholder texture for when webcam is not used
    placeholder_texture: wgpu::Texture,
    placeholder_view: wgpu::TextureView,
    // Background layer for rendering backgrounds
    background_layer: BackgroundLayer,
    // Text layer for GPU text rendering (captions)
    text_layer: TextLayer,
    // Pre-rendered text overlay layer for export
    text_overlay_layer: TextOverlayLayer,
    // Pre-rendered annotation overlay layer for export
    annotation_overlay_layer: TextOverlayLayer,
    // GPU cursor overlay layer for export
    cursor_overlay_layer: CursorOverlayLayer,
}

impl Compositor {
    /// Create a new compositor.
    pub fn new(renderer: &Renderer) -> Self {
        let device = Arc::clone(renderer.device());
        let queue = Arc::clone(renderer.queue());

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Compositor Shader"),
            source: wgpu::ShaderSource::Wgsl(COMPOSITOR_SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Compositor Bind Group Layout"),
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
                // Video texture
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
                // Video sampler
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                // Webcam texture
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Webcam sampler
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Compositor Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Compositor Pipeline"),
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
                    format: renderer.format(),
                    // Use alpha blending so background shows through transparent areas
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
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

        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Compositor Uniforms"),
            size: std::mem::size_of::<ExtendedUniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Video Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        // Create 1x1 placeholder texture for when webcam is not used
        let placeholder_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Placeholder Texture"),
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
        let placeholder_view =
            placeholder_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Initialize background layer
        let background_layer = BackgroundLayer::new(&device);

        // Initialize text layer
        let text_layer = TextLayer::new(&device, &queue);
        let text_overlay_layer = TextOverlayLayer::new(&device, &queue);
        let annotation_overlay_layer = TextOverlayLayer::new(&device, &queue);
        let cursor_overlay_layer = CursorOverlayLayer::new(&device, &queue);

        Self {
            device,
            queue,
            pipeline,
            bind_group_layout,
            uniform_buffer,
            sampler,
            placeholder_texture,
            placeholder_view,
            background_layer,
            text_layer,
            text_overlay_layer,
            annotation_overlay_layer,
            cursor_overlay_layer,
        }
    }

    /// Convert BackgroundStyle to Background for rendering.
    fn background_from_style(style: &BackgroundStyle) -> Background {
        match &style.background_type {
            BackgroundType::None => Background::None,
            BackgroundType::Solid(color) => Background::Color(*color),
            BackgroundType::Gradient { start, end, angle } => Background::Gradient {
                start: *start,
                end: *end,
                angle: *angle,
            },
            BackgroundType::Wallpaper(path) => Background::Wallpaper { path: path.clone() },
            BackgroundType::Image(path) => Background::Image { path: path.clone() },
        }
    }

    /// Composite a frame with the given options.
    /// Now supports background rendering (solid colors, gradients).
    pub async fn composite(
        &mut self,
        renderer: &Renderer,
        frame: &DecodedFrame,
        options: &RenderOptions,
        time_ms: f32,
    ) -> wgpu::Texture {
        // Prepare background if needed
        let background = Self::background_from_style(&options.background);

        // Log background setup on first frame (time_ms near 0)
        if (0.0..100.0).contains(&time_ms) {
            match &background {
                Background::None => log::info!("[COMPOSITOR] Background: None"),
                Background::Color(c) => log::info!("[COMPOSITOR] Background: Color {:?}", c),
                Background::Gradient { start, end, angle } => {
                    log::info!(
                        "[COMPOSITOR] Background: Gradient start={:?} end={:?} angle={}",
                        start,
                        end,
                        angle
                    );
                },
                Background::Wallpaper { path } => {
                    log::info!("[COMPOSITOR] Background: Wallpaper {}", path)
                },
                Background::Image { path } => log::info!("[COMPOSITOR] Background: Image {}", path),
            }
        }

        if let Err(e) = self
            .background_layer
            .prepare(
                &self.device,
                &self.queue,
                options.output_width,
                options.output_height,
                background,
            )
            .await
        {
            log::warn!("Failed to prepare background: {}", e);
        }
        // Create video texture
        let video_texture = renderer.create_texture_from_rgba(
            &frame.data,
            frame.width,
            frame.height,
            "Video Frame",
        );
        let video_view = video_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Create webcam texture if present
        let webcam_texture_storage: Option<wgpu::Texture>;
        let (webcam_rect, webcam_params, webcam_shadow, webcam_tex_size) =
            if let Some(ref webcam) = options.webcam {
                webcam_texture_storage = Some(renderer.create_texture_from_rgba(
                    &webcam.frame.data,
                    webcam.frame.width,
                    webcam.frame.height,
                    "Webcam Frame",
                ));

                // Shape: 1=Circle, 2=Squircle, 3=RoundedRect
                let shape = match webcam.shape {
                    WebcamShape::Circle => 1.0,
                    WebcamShape::Squircle => 2.0,
                    WebcamShape::Rectangle => 3.0, // Rectangle uses RoundedRect with radius=0
                    WebcamShape::RoundedRect { .. } => 3.0,
                };
                let radius = match webcam.shape {
                    WebcamShape::RoundedRect { radius } => radius as f32,
                    _ => 0.0,
                };

                // Calculate webcam texture aspect ratio for proper cropping
                let webcam_aspect = webcam.frame.width as f32 / webcam.frame.height as f32;

                // Calculate webcam overlay dimensions
                let output_aspect = options.output_width as f32 / options.output_height as f32;
                let (webcam_width_norm, webcam_height_norm) = if webcam.use_source_aspect {
                    // Source shape: preserve native webcam aspect ratio
                    // Like Cap: base size is the smaller dimension
                    if webcam_aspect >= 1.0 {
                        // Landscape webcam: width = size * aspect, height = size (in pixels)
                        (webcam.size * webcam_aspect, webcam.size * output_aspect)
                    } else {
                        // Portrait webcam: width = size, height = size / aspect (in pixels)
                        (webcam.size, webcam.size * output_aspect / webcam_aspect)
                    }
                } else {
                    // Square/Circle/Rectangle: force 1:1 in PIXELS (not normalized coords)
                    (webcam.size, webcam.size * output_aspect)
                };

                (
                    [webcam.x, webcam.y, webcam_width_norm, webcam_height_norm],
                    [
                        shape,
                        webcam.shadow, // shadow_strength
                        if webcam.mirror { 1.0 } else { 0.0 },
                        radius,
                    ],
                    [
                        webcam.shadow_size,
                        webcam.shadow_opacity,
                        webcam.shadow_blur,
                        0.0,
                    ],
                    [
                        webcam.frame.width as f32,
                        webcam.frame.height as f32,
                        webcam_aspect,
                        0.0,
                    ],
                )
            } else {
                webcam_texture_storage = None;
                (
                    [0.0, 0.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 0.0], // shape=0 means no webcam
                    [0.0, 0.0, 0.0, 0.0], // no shadow
                    [1.0, 1.0, 1.0, 0.0], // Default 1:1 aspect
                )
            };

        let webcam_view = webcam_texture_storage
            .as_ref()
            .map(|t| t.create_view(&wgpu::TextureViewDescriptor::default()))
            .unwrap_or_else(|| {
                self.placeholder_texture
                    .create_view(&wgpu::TextureViewDescriptor::default())
            });

        // Create output texture
        let output_texture =
            renderer.create_output_texture(options.output_width, options.output_height);
        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Calculate frame bounds using parity system
        let out_w = options.output_width as f32;
        let out_h = options.output_height as f32;

        let bounds = calculate_composition_bounds(
            frame.width as f32,
            frame.height as f32,
            options.background.padding,
            if options.use_manual_composition {
                Some((out_w, out_h))
            } else {
                None
            },
        );

        let frame_x = bounds.frame_x;
        let frame_y = bounds.frame_y;
        let frame_w = bounds.frame_width;
        let frame_h = bounds.frame_height;

        // Rounding type: 0 = rounded, 1 = squircle
        let rounding_type = match options.background.rounding_type {
            CornerStyle::Rounded => 0.0,
            CornerStyle::Squircle => 1.0,
        };

        // Frame styling uniforms
        let frame_bounds = [frame_x, frame_y, frame_w, frame_h];
        let frame_rounding = [options.background.rounding, rounding_type, 0.0, 0.0];
        // Single shadow value (0-100) - shader derives blur/opacity from it
        let frame_shadow = [
            if options.background.shadow.enabled {
                options.background.shadow.shadow
            } else {
                0.0
            },
            0.0, // unused
            0.0, // unused
            0.0, // unused
        ];
        let frame_border = [
            if options.background.border.enabled {
                1.0
            } else {
                0.0
            },
            options.background.border.width,
            0.0, // unused - border opacity comes from border_color.w
            0.0,
        ];
        let border_color = options.background.border.color;

        // Update uniforms
        let uniforms = ExtendedUniforms {
            video_size: [frame.width as f32, frame.height as f32, 0.0, 0.0],
            output_size: [out_w, out_h, 0.0, 0.0],
            zoom: [
                options.zoom.scale,
                options.zoom.center_x,
                options.zoom.center_y,
                0.0,
            ],
            time_flags: [time_ms, 0.0, 0.0, 0.0],
            webcam_rect,
            webcam_params,
            webcam_shadow,
            webcam_tex_size,
            frame_bounds,
            frame_rounding,
            frame_shadow,
            frame_border,
            border_color,
            zoom_motion_blur: [
                options.zoom_motion_blur.directional_px,
                options.zoom_motion_blur.direction_x,
                options.zoom_motion_blur.direction_y,
                options.zoom_motion_blur.radial_px,
            ],
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&[uniforms]));

        // Create bind group
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Compositor Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&video_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&webcam_view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        // Render
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Compositor Encoder"),
            });

        // First pass: Render background (if any)
        if self.background_layer.has_background() {
            let mut bg_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Background Pass"),
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
            self.background_layer.render(&mut bg_pass);
        }

        // Second pass: Render video and webcam overlay
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Compositor Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        // If we have a background, load it; otherwise clear to black
                        load: if self.background_layer.has_background() {
                            wgpu::LoadOp::Load
                        } else {
                            wgpu::LoadOp::Clear(wgpu::Color::BLACK)
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.pipeline);
            render_pass.set_bind_group(0, &bind_group, &[]);
            render_pass.draw(0..3, 0..1);
        }

        self.queue.submit(Some(encoder.finish()));

        output_texture
    }

    /// Composite a frame with text overlays.
    ///
    /// This is the main entry point for rendering with text support.
    /// Text background and text content passes share a single command encoder
    /// to reduce per-frame GPU driver overhead.
    pub async fn composite_with_text(
        &mut self,
        renderer: &Renderer,
        frame: &DecodedFrame,
        options: &RenderOptions,
        time_ms: f32,
        texts: &[PreparedText],
    ) -> wgpu::Texture {
        // First, do the regular composite (background, video, webcam)
        let output_texture = self.composite(renderer, frame, options, time_ms).await;

        // If there are texts to render, add them on top
        if !texts.is_empty() {
            // Prepare text for rendering
            self.text_layer.prepare(
                &self.device,
                &self.queue,
                (options.output_width, options.output_height),
                texts,
            );

            let has_bg = self.text_layer.has_backgrounds();
            let has_text = self.text_layer.has_texts();

            if has_bg || has_text {
                let output_view =
                    output_texture.create_view(&wgpu::TextureViewDescriptor::default());

                // Single encoder for both text background and text content passes
                let mut encoder =
                    self.device
                        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                            label: Some("Text Encoder"),
                        });

                if has_bg {
                    let mut bg_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Text Background Pass"),
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
                    self.text_layer.render_backgrounds(&mut bg_pass);
                }

                if has_text {
                    let mut text_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Text Pass"),
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
                    self.text_layer.render(&mut text_pass);
                }

                // Single submit for all text passes
                self.queue.submit(Some(encoder.finish()));
            }
        }

        output_texture
    }

    /// Composite a frame into a pre-allocated output texture.
    ///
    /// Like `composite()`, but avoids per-frame texture allocation.
    /// The caller pre-allocates `video_texture` (TEXTURE_BINDING | COPY_DST)
    /// and `output_texture` (RENDER_ATTACHMENT | COPY_SRC | TEXTURE_BINDING).
    ///
    /// If `frame` is `Some`, video frame data is written into the existing video texture.
    /// If `frame` is `None`, the video texture is assumed to be pre-populated
    /// (e.g. by the NV12 converter), and video dimensions are read from the texture size.
    pub async fn composite_into(
        &mut self,
        renderer: &Renderer,
        video_texture: &wgpu::Texture,
        frame: Option<&DecodedFrame>,
        output_texture: &wgpu::Texture,
        options: &RenderOptions,
        time_ms: f32,
    ) {
        // Prepare background if needed
        let background = Self::background_from_style(&options.background);

        if (0.0..100.0).contains(&time_ms) {
            match &background {
                Background::None => log::info!("[COMPOSITOR] Background: None"),
                Background::Color(c) => log::info!("[COMPOSITOR] Background: Color {:?}", c),
                Background::Gradient { start, end, angle } => {
                    log::info!(
                        "[COMPOSITOR] Background: Gradient start={:?} end={:?} angle={}",
                        start,
                        end,
                        angle
                    );
                },
                Background::Wallpaper { path } => {
                    log::info!("[COMPOSITOR] Background: Wallpaper {}", path)
                },
                Background::Image { path } => log::info!("[COMPOSITOR] Background: Image {}", path),
            }
        }

        if let Err(e) = self
            .background_layer
            .prepare(
                &self.device,
                &self.queue,
                options.output_width,
                options.output_height,
                background,
            )
            .await
        {
            log::warn!("Failed to prepare background: {}", e);
        }

        // Upload video frame data if provided; otherwise texture is pre-populated
        let (video_w, video_h) = if let Some(frame) = frame {
            renderer.update_texture_data(video_texture, &frame.data, frame.width, frame.height);
            (frame.width as f32, frame.height as f32)
        } else {
            let tex_size = video_texture.size();
            (tex_size.width as f32, tex_size.height as f32)
        };
        let video_view = video_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Create webcam texture if present (webcam dimensions may vary, keep per-frame)
        let webcam_texture_storage: Option<wgpu::Texture>;
        let (webcam_rect, webcam_params, webcam_shadow, webcam_tex_size) =
            if let Some(ref webcam) = options.webcam {
                webcam_texture_storage = Some(renderer.create_texture_from_rgba(
                    &webcam.frame.data,
                    webcam.frame.width,
                    webcam.frame.height,
                    "Webcam Frame",
                ));

                let shape = match webcam.shape {
                    WebcamShape::Circle => 1.0,
                    WebcamShape::Squircle => 2.0,
                    WebcamShape::Rectangle => 3.0,
                    WebcamShape::RoundedRect { .. } => 3.0,
                };
                let radius = match webcam.shape {
                    WebcamShape::RoundedRect { radius } => radius as f32,
                    _ => 0.0,
                };

                let webcam_aspect = webcam.frame.width as f32 / webcam.frame.height as f32;
                let output_aspect = options.output_width as f32 / options.output_height as f32;
                let (webcam_width_norm, webcam_height_norm) = if webcam.use_source_aspect {
                    if webcam_aspect >= 1.0 {
                        (webcam.size * webcam_aspect, webcam.size * output_aspect)
                    } else {
                        (webcam.size, webcam.size * output_aspect / webcam_aspect)
                    }
                } else {
                    (webcam.size, webcam.size * output_aspect)
                };

                (
                    [webcam.x, webcam.y, webcam_width_norm, webcam_height_norm],
                    [
                        shape,
                        webcam.shadow,
                        if webcam.mirror { 1.0 } else { 0.0 },
                        radius,
                    ],
                    [
                        webcam.shadow_size,
                        webcam.shadow_opacity,
                        webcam.shadow_blur,
                        0.0,
                    ],
                    [
                        webcam.frame.width as f32,
                        webcam.frame.height as f32,
                        webcam_aspect,
                        0.0,
                    ],
                )
            } else {
                webcam_texture_storage = None;
                (
                    [0.0, 0.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 0.0],
                    [1.0, 1.0, 1.0, 0.0],
                )
            };

        let webcam_view = webcam_texture_storage
            .as_ref()
            .map(|t| t.create_view(&wgpu::TextureViewDescriptor::default()))
            .unwrap_or_else(|| {
                self.placeholder_texture
                    .create_view(&wgpu::TextureViewDescriptor::default())
            });

        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Calculate frame bounds using video dimensions (from frame or texture)
        let out_w = options.output_width as f32;
        let out_h = options.output_height as f32;
        let bounds = calculate_composition_bounds(
            video_w,
            video_h,
            options.background.padding,
            if options.use_manual_composition {
                Some((out_w, out_h))
            } else {
                None
            },
        );

        let rounding_type = match options.background.rounding_type {
            CornerStyle::Rounded => 0.0,
            CornerStyle::Squircle => 1.0,
        };

        let uniforms = ExtendedUniforms {
            video_size: [video_w, video_h, 0.0, 0.0],
            output_size: [out_w, out_h, 0.0, 0.0],
            zoom: [
                options.zoom.scale,
                options.zoom.center_x,
                options.zoom.center_y,
                0.0,
            ],
            time_flags: [time_ms, 0.0, 0.0, 0.0],
            webcam_rect,
            webcam_params,
            webcam_shadow,
            webcam_tex_size,
            frame_bounds: [
                bounds.frame_x,
                bounds.frame_y,
                bounds.frame_width,
                bounds.frame_height,
            ],
            frame_rounding: [options.background.rounding, rounding_type, 0.0, 0.0],
            frame_shadow: [
                if options.background.shadow.enabled {
                    options.background.shadow.shadow
                } else {
                    0.0
                },
                0.0,
                0.0,
                0.0,
            ],
            frame_border: [
                if options.background.border.enabled {
                    1.0
                } else {
                    0.0
                },
                options.background.border.width,
                0.0,
                0.0,
            ],
            border_color: options.background.border.color,
            zoom_motion_blur: [
                options.zoom_motion_blur.directional_px,
                options.zoom_motion_blur.direction_x,
                options.zoom_motion_blur.direction_y,
                options.zoom_motion_blur.radial_px,
            ],
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::cast_slice(&[uniforms]));

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Compositor Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&video_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&webcam_view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Compositor Encoder"),
            });

        if self.background_layer.has_background() {
            let mut bg_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Background Pass"),
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
            self.background_layer.render(&mut bg_pass);
        }

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Compositor Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if self.background_layer.has_background() {
                            wgpu::LoadOp::Load
                        } else {
                            wgpu::LoadOp::Clear(wgpu::Color::BLACK)
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.pipeline);
            render_pass.set_bind_group(0, &bind_group, &[]);
            render_pass.draw(0..3, 0..1);
        }

        self.queue.submit(Some(encoder.finish()));
    }

    /// Composite a frame with text overlays into a pre-allocated output texture.
    ///
    /// Export-optimized variant that reuses video and output textures across frames.
    /// If `frame` is `None`, the video texture is assumed to be pre-populated
    /// (e.g. by the NV12 converter).
    pub async fn composite_with_text_into(
        &mut self,
        renderer: &Renderer,
        video_texture: &wgpu::Texture,
        frame: Option<&DecodedFrame>,
        output_texture: &wgpu::Texture,
        options: &RenderOptions,
        time_ms: f32,
        texts: &[PreparedText],
    ) {
        self.composite_into(
            renderer,
            video_texture,
            frame,
            output_texture,
            options,
            time_ms,
        )
        .await;

        if !texts.is_empty() {
            self.text_layer.prepare(
                &self.device,
                &self.queue,
                (options.output_width, options.output_height),
                texts,
            );

            let has_bg = self.text_layer.has_backgrounds();
            let has_text = self.text_layer.has_texts();

            if has_bg || has_text {
                let output_view =
                    output_texture.create_view(&wgpu::TextureViewDescriptor::default());

                let mut encoder =
                    self.device
                        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                            label: Some("Text Encoder"),
                        });

                if has_bg {
                    let mut bg_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Text Background Pass"),
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
                    self.text_layer.render_backgrounds(&mut bg_pass);
                }

                if has_text {
                    let mut text_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("Text Pass"),
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
                    self.text_layer.render(&mut text_pass);
                }

                self.queue.submit(Some(encoder.finish()));
            }
        }
    }

    /// Upload pre-rendered text images to GPU textures for export.
    /// Called once at export start.
    pub fn upload_text_overlays(&mut self, store: &PreRenderedTextStore) {
        self.text_overlay_layer.upload_textures(store);
    }

    /// Upload pre-rendered annotation images to GPU textures for export.
    /// Called once at export start.
    pub fn upload_annotation_overlays(&mut self, store: &PreRenderedTextStore) {
        self.annotation_overlay_layer.upload_textures(store);
    }

    /// Render pre-rendered text overlay quads onto the output texture.
    /// Called per-frame during export, after the main composite pass.
    pub fn render_text_overlays(&self, output_texture: &wgpu::Texture, quads: &[TextOverlayQuad]) {
        if quads.is_empty() || !self.text_overlay_layer.has_textures() {
            return;
        }

        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Text Overlay Encoder"),
            });

        self.text_overlay_layer
            .render_overlays(&mut encoder, &output_view, quads);

        self.queue.submit(Some(encoder.finish()));
    }

    /// Render pre-rendered annotation overlay quads onto the output texture.
    pub fn render_annotation_overlays(
        &self,
        output_texture: &wgpu::Texture,
        quads: &[TextOverlayQuad],
    ) {
        if quads.is_empty() || !self.annotation_overlay_layer.has_textures() {
            return;
        }

        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Annotation Overlay Encoder"),
            });

        self.annotation_overlay_layer
            .render_overlays(&mut encoder, &output_view, quads);

        self.queue.submit(Some(encoder.finish()));
    }

    /// Render the cursor overlay on top of the current output texture.
    pub fn render_cursor_overlay(
        &self,
        output_texture: &wgpu::Texture,
        overlay: &CursorOverlayPrimitive,
    ) {
        if overlay.opacity <= 0.0 {
            return;
        }

        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Cursor Overlay Encoder"),
            });

        self.cursor_overlay_layer
            .render_overlay(&mut encoder, &output_view, overlay);

        self.queue.submit(Some(encoder.finish()));
    }

    /// Render only text overlays on a transparent background.
    ///
    /// This is used during playback when HTML video handles the video frame
    /// but we need accurate text rendering via GPU.
    pub fn composite_text_only(
        &mut self,
        output_width: u32,
        output_height: u32,
        texts: &[PreparedText],
    ) -> wgpu::Texture {
        // Create transparent output texture
        // Must use Rgba8UnormSrgb to match glyphon pipeline format
        let output_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Text Only Output"),
            size: wgpu::Extent3d {
                width: output_width,
                height: output_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });

        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Always clear to transparent (even if no texts, so old text is cleared from canvas)
        {
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Clear Text Encoder"),
                });
            let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Clear Text Pass"),
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
            self.queue.submit(std::iter::once(encoder.finish()));
        }

        if texts.is_empty() {
            // Return cleared transparent texture
            return output_texture;
        }

        // Prepare text for rendering
        self.text_layer.prepare(
            &self.device,
            &self.queue,
            (output_width, output_height),
            texts,
        );

        // Render backgrounds first (if any)
        if self.text_layer.has_backgrounds() {
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Text Background Encoder"),
                });

            {
                let mut bg_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Text Background Pass"),
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

                self.text_layer.render_backgrounds(&mut bg_pass);
            }

            self.queue.submit(Some(encoder.finish()));
        }

        // Render text on top
        if self.text_layer.has_texts() {
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Text Only Encoder"),
                });

            {
                let mut text_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Text Only Pass"),
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

                self.text_layer.render(&mut text_pass);
            }

            self.queue.submit(Some(encoder.finish()));
        }

        output_texture
    }
}
