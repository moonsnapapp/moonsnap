//! wgpu renderer setup and management.
//!
//! Handles GPU device/queue initialization and shader compilation.

use std::sync::Arc;
use wgpu::{Device, Queue, TextureFormat};

/// GPU renderer managing wgpu resources.
pub struct Renderer {
    /// wgpu device.
    device: Arc<Device>,
    /// wgpu queue.
    queue: Arc<Queue>,
    /// Output texture format.
    format: TextureFormat,
}

impl Renderer {
    /// Create a new renderer with GPU initialization.
    pub async fn new() -> Result<Self, String> {
        // Create wgpu instance
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        // Request adapter (prefer high-performance GPU)
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| format!("Failed to find GPU adapter: {}", e))?;

        log::info!("Using GPU adapter: {:?}", adapter.get_info().name);

        // Request device and queue
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("MoonSnap Video Renderer"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|e| format!("Failed to create GPU device: {}", e))?;

        Ok(Self {
            device: Arc::new(device),
            queue: Arc::new(queue),
            format: TextureFormat::Rgba8UnormSrgb,
        })
    }

    /// Get the wgpu device.
    pub fn device(&self) -> &Arc<Device> {
        &self.device
    }

    /// Get the wgpu queue.
    pub fn queue(&self) -> &Arc<Queue> {
        &self.queue
    }

    /// Get the output texture format.
    pub fn format(&self) -> TextureFormat {
        self.format
    }

    /// Create a texture from RGBA data.
    pub fn create_texture_from_rgba(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        label: &str,
    ) -> wgpu::Texture {
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            // Use sRGB format - GPU will convert sRGB→linear on read for correct blending
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
            data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            size,
        );

        texture
    }

    /// Create an output texture for rendering.
    pub fn create_output_texture(&self, width: u32, height: u32) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Output Texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    /// Create a reusable staging buffer for GPU readback.
    ///
    /// Call once before the export loop. Pass to `read_texture_into()` each frame
    /// to avoid per-frame buffer allocation.
    pub fn create_staging_buffer(&self, width: u32, height: u32) -> wgpu::Buffer {
        let bytes_per_row = 4 * width;
        let padded_bytes_per_row = (bytes_per_row + 255) & !255;
        let buffer_size = (padded_bytes_per_row * height) as u64;

        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Reusable Staging Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        })
    }

    /// Read texture data back to CPU using a pre-allocated staging buffer.
    ///
    /// The staging buffer is unmapped after reading, ready for the next frame.
    pub async fn read_texture_into(
        &self,
        texture: &wgpu::Texture,
        staging_buffer: &wgpu::Buffer,
        width: u32,
        height: u32,
    ) -> Vec<u8> {
        let bytes_per_row = 4 * width;
        let padded_bytes_per_row = (bytes_per_row + 255) & !255;

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Texture Read Encoder"),
            });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: staging_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        let buffer_slice = staging_buffer.slice(..);
        let (tx, rx) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        let _ = self.device.poll(wgpu::PollType::Wait);
        let _ = rx.await;

        let data = buffer_slice.get_mapped_range();

        let result = if padded_bytes_per_row != bytes_per_row {
            let mut result = Vec::with_capacity((bytes_per_row * height) as usize);
            for row in 0..height {
                let start = (row * padded_bytes_per_row) as usize;
                let end = start + bytes_per_row as usize;
                result.extend_from_slice(&data[start..end]);
            }
            result
        } else {
            data.to_vec()
        };

        // Drop mapped range view before unmapping (required by wgpu)
        drop(data);
        staging_buffer.unmap();

        result
    }

    /// Submit a texture-to-buffer copy command (non-blocking).
    ///
    /// The staging buffer must be unmapped. Call `complete_readback()` later
    /// to wait for the GPU and read the data. This split allows CPU work to
    /// overlap with GPU execution.
    pub fn submit_readback(
        &self,
        texture: &wgpu::Texture,
        staging_buffer: &wgpu::Buffer,
        width: u32,
        height: u32,
    ) {
        let padded_bytes_per_row = (4 * width + 255) & !255;

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Readback Copy Encoder"),
            });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: staging_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));
    }

    /// Wait for a previously submitted readback and read the pixel data.
    ///
    /// Pairs with `submit_readback()`. The staging buffer is unmapped after
    /// reading, ready for the next `submit_readback()` call.
    ///
    /// Uses non-blocking poll first: `device.poll(Wait)` blocks until ALL
    /// in-flight submissions complete, including newer work unrelated to this
    /// buffer. With triple-buffered staging the target buffer's fence is
    /// already signaled, so `poll(Poll)` resolves it instantly.
    pub async fn complete_readback(
        &self,
        staging_buffer: &wgpu::Buffer,
        width: u32,
        height: u32,
    ) -> Vec<u8> {
        let bytes_per_row = 4 * width;
        let padded_bytes_per_row = (bytes_per_row + 255) & !255;

        let buffer_slice = staging_buffer.slice(..);
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        // Non-blocking poll: process already-completed fences without waiting
        // for newer in-flight submissions. Falls back to blocking if needed.
        let _ = self.device.poll(wgpu::PollType::Poll);
        match rx.try_recv() {
            Ok(_) => {},
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                // Buffer not ready yet (pipeline not fully primed) — block
                let _ = self.device.poll(wgpu::PollType::Wait);
                let _ = rx.await;
            },
            Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                let _ = self.device.poll(wgpu::PollType::Wait);
            },
        }

        let data = buffer_slice.get_mapped_range();

        let result = if padded_bytes_per_row != bytes_per_row {
            let mut result = Vec::with_capacity((bytes_per_row * height) as usize);
            for row in 0..height {
                let start = (row * padded_bytes_per_row) as usize;
                let end = start + bytes_per_row as usize;
                result.extend_from_slice(&data[start..end]);
            }
            result
        } else {
            data.to_vec()
        };

        drop(data);
        staging_buffer.unmap();

        result
    }

    /// Read texture data back to CPU (allocates a new buffer each call).
    ///
    /// Prefer `read_texture_into()` with a pre-allocated staging buffer for
    /// repeated reads at the same dimensions (e.g. export loops).
    pub async fn read_texture(&self, texture: &wgpu::Texture, width: u32, height: u32) -> Vec<u8> {
        let staging = self.create_staging_buffer(width, height);
        self.read_texture_into(texture, &staging, width, height)
            .await
    }

    /// Update an existing texture with new RGBA data (avoids re-allocation).
    ///
    /// The texture must have been created with the same dimensions and
    /// `COPY_DST` usage. Dimensions are constant during export, so this
    /// is a simple `queue.write_texture` on the existing allocation.
    pub fn update_texture_data(
        &self,
        texture: &wgpu::Texture,
        data: &[u8],
        width: u32,
        height: u32,
    ) {
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
    }

    /// Compile a shader module.
    pub fn create_shader(&self, source: &str, label: &str) -> wgpu::ShaderModule {
        self.device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            })
    }
}
