//! GPU-accelerated webcam preview using wgpu.
//!
//! Renders camera frames directly to the Tauri window surface,
//! bypassing JPEG encoding and IPC polling for smooth 30fps preview.
//!
//! Architecture (from Cap):
//! - wgpu surface attached to Tauri window
//! - Camera frames uploaded as GPU textures
//! - WGSL shader handles shape masking and mirroring
//! - Render loop runs in dedicated thread

use moonsnap_core::error::MoonSnapResult;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::{Mutex, RwLock};
use tauri::{LogicalSize, WebviewWindow};
use tokio::sync::broadcast;
use wgpu::CompositeAlphaMode;

mod frame_conversion;

use self::frame_conversion::{
    frame_to_rgba_downsampled, subsample_plane, subsample_yuyv, PREVIEW_MAX_TEXTURE_SIZE,
};
use super::feed::{start_global_feed, stop_global_feed, subscribe_global, Subscription};
use super::NativeCameraFrame;
use moonsnap_domain::webcam::{WebcamShape, WebcamSize};

/// Preview window size constants
pub const MIN_PREVIEW_SIZE: f32 = 120.0;
pub const MAX_PREVIEW_SIZE: f32 = 250.0;
pub const DEFAULT_PREVIEW_SIZE: f32 = 160.0;

/// GPU surface scale for anti-aliasing (higher = smoother edges)
/// Note: Must be 1 on Windows/Vulkan as surface size must match window size.
/// Shader-based AA via fwidth() handles edge smoothing.
const GPU_SURFACE_SCALE: u32 = 1;
const PREVIEW_FRAME_BUDGET_MS: f64 = 1000.0 / 30.0;
const PREVIEW_SLOW_RENDER_WARN_MS: f64 = PREVIEW_FRAME_BUDGET_MS * 0.75;
const PREVIEW_TIMING_WINDOW_FRAMES: u32 = 60;
const PREVIEW_STALL_WARN_TIMEOUTS: u32 = 10;

/// State for GPU preview configuration
#[derive(Debug, Clone)]
pub struct GpuPreviewState {
    pub size: f32,
    pub shape: WebcamShape,
    pub mirrored: bool,
}

impl Default for GpuPreviewState {
    fn default() -> Self {
        Self {
            size: DEFAULT_PREVIEW_SIZE,
            shape: WebcamShape::Squircle,
            mirrored: false,
        }
    }
}

impl GpuPreviewState {
    pub fn from_settings(size: WebcamSize, shape: WebcamShape, mirror: bool) -> Self {
        let size_px = match size {
            WebcamSize::Small => 160.0,
            WebcamSize::Large => 200.0,
        };
        Self {
            size: size_px,
            shape,
            mirrored: mirror,
        }
    }
}

/// Events to reconfigure the preview
#[derive(Clone, Debug)]
pub enum ReconfigureEvent {
    State(GpuPreviewState),
    WindowResized { width: u32, height: u32 },
    Shutdown,
}

/// GPU Preview Manager - handles lifecycle of GPU-rendered webcam preview
pub struct GpuPreviewManager {
    state: RwLock<GpuPreviewState>,
    preview: Mutex<Option<ActivePreview>>,
}

struct ActivePreview {
    reconfigure_tx: broadcast::Sender<ReconfigureEvent>,
    thread: Option<JoinHandle<()>>,
    stop_signal: Arc<AtomicBool>,
}

impl GpuPreviewManager {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(GpuPreviewState::default()),
            preview: Mutex::new(None),
        }
    }

    /// Get current preview state
    pub fn get_state(&self) -> GpuPreviewState {
        self.state.read().clone()
    }

    /// Update preview state
    pub fn set_state(&self, state: GpuPreviewState) {
        *self.state.write() = state.clone();

        // Notify active preview if running
        if let Some(ref preview) = *self.preview.lock() {
            let _ = preview.reconfigure_tx.send(ReconfigureEvent::State(state));
        }
    }

    /// Check if preview is active
    pub fn is_active(&self) -> bool {
        self.preview.lock().is_some()
    }

    /// Notify of window resize
    pub fn notify_resize(&self, width: u32, height: u32) {
        if let Some(ref preview) = *self.preview.lock() {
            let _ = preview
                .reconfigure_tx
                .send(ReconfigureEvent::WindowResized { width, height });
        }
    }

    /// Start GPU preview for window
    pub fn start(&self, window: WebviewWindow, device_index: usize) -> MoonSnapResult<()> {
        let mut guard = self.preview.lock();

        if guard.is_some() {
            log::info!("[GPU_PREVIEW] Already running");
            return Ok(());
        }

        // Start camera feed
        start_global_feed(device_index)?;

        // Subscribe to camera frames
        let subscription = subscribe_global("gpu-preview", 4)?;

        let state = self.get_state();
        let (reconfigure_tx, reconfigure_rx) = broadcast::channel(4);
        let stop_signal = Arc::new(AtomicBool::new(false));
        let stop_signal_clone = Arc::clone(&stop_signal);

        // Spawn render thread
        let thread = std::thread::Builder::new()
            .name("gpu-preview".to_string())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Failed to create tokio runtime");

                rt.block_on(async {
                    if let Err(e) = run_gpu_preview(
                        window,
                        state,
                        subscription,
                        reconfigure_rx,
                        stop_signal_clone,
                    )
                    .await
                    {
                        log::error!("[GPU_PREVIEW] Error: {}", e);
                    }
                });
            })
            .map_err(|e| format!("Failed to spawn GPU preview thread: {}", e))?;

        *guard = Some(ActivePreview {
            reconfigure_tx,
            thread: Some(thread),
            stop_signal,
        });

        log::info!("[GPU_PREVIEW] Started");
        Ok(())
    }

    /// Stop GPU preview
    pub fn stop(&self) {
        let mut guard = self.preview.lock();
        if let Some(mut preview) = guard.take() {
            // Signal shutdown
            let _ = preview.reconfigure_tx.send(ReconfigureEvent::Shutdown);
            preview.stop_signal.store(true, Ordering::SeqCst);

            // Wait for thread
            if let Some(thread) = preview.thread.take() {
                let _ = thread.join();
            }

            log::info!("[GPU_PREVIEW] Stopped");
        }

        // Stop camera feed
        stop_global_feed();
    }
}

impl Drop for GpuPreviewManager {
    fn drop(&mut self) {
        self.stop();
    }
}

// Global manager instance
static GPU_PREVIEW_MANAGER: std::sync::OnceLock<GpuPreviewManager> = std::sync::OnceLock::new();

pub fn get_manager() -> &'static GpuPreviewManager {
    GPU_PREVIEW_MANAGER.get_or_init(GpuPreviewManager::new)
}

/// Start GPU-accelerated webcam preview
pub fn start_gpu_preview(window: WebviewWindow, device_index: usize) -> MoonSnapResult<()> {
    get_manager().start(window, device_index)
}

/// Stop GPU preview
pub fn stop_gpu_preview() {
    get_manager().stop();
}

/// Update preview settings
pub fn update_gpu_preview_state(state: GpuPreviewState) {
    get_manager().set_state(state);
}

/// Check if GPU preview is running
pub fn is_gpu_preview_running() -> bool {
    get_manager().is_active()
}

// ============================================================================
// Renderer Implementation
// ============================================================================

/// Run the GPU preview render loop
async fn run_gpu_preview(
    window: WebviewWindow,
    initial_state: GpuPreviewState,
    subscription: Subscription,
    mut reconfigure_rx: broadcast::Receiver<ReconfigureEvent>,
    stop_signal: Arc<AtomicBool>,
) -> MoonSnapResult<()> {
    // Initialize wgpu
    let mut renderer = init_wgpu(window.clone(), &initial_state).await?;

    let mut state = initial_state;
    let mut received_first_frame = false;
    let start_time = std::time::Instant::now();
    let startup_timeout = Duration::from_secs(5);
    let mut render_window_frames: u32 = 0;
    let mut render_window_total_ms = 0.0_f64;
    let mut render_window_max_ms = 0.0_f64;
    let mut render_window_slow_frames: u32 = 0;
    let mut consecutive_timeouts: u32 = 0;
    let mut total_timeouts: u64 = 0;

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        let timeout_remaining = if received_first_frame {
            Duration::from_millis(100) // Normal timeout
        } else {
            startup_timeout.saturating_sub(start_time.elapsed())
        };

        if timeout_remaining.is_zero() && !received_first_frame {
            log::warn!("[GPU_PREVIEW] Timed out waiting for first frame");
            break;
        }

        // Check for reconfigure events (non-blocking)
        match reconfigure_rx.try_recv() {
            Ok(ReconfigureEvent::Shutdown) => break,
            Ok(ReconfigureEvent::State(new_state)) => {
                state = new_state;
                renderer.update_state_uniforms(&state);
                if let Ok((w, h)) = resize_window(&window, &state, renderer.aspect_ratio) {
                    renderer.reconfigure_surface(w, h);
                }
            },
            Ok(ReconfigureEvent::WindowResized { width, height }) => {
                renderer.reconfigure_surface(width, height);
            },
            Err(_) => {}, // No event, continue
        }

        // Try to get a frame
        match subscription.recv_timeout(timeout_remaining) {
            Some(frame) => {
                if !received_first_frame {
                    log::info!(
                        "[GPU_PREVIEW] Received first frame: {}x{}",
                        frame.width,
                        frame.height
                    );
                }
                received_first_frame = true;
                consecutive_timeouts = 0;

                // Update aspect ratio if changed
                let aspect = frame.width as f32 / frame.height as f32;
                if (aspect - renderer.aspect_ratio).abs() > 0.01 {
                    log::info!("[GPU_PREVIEW] Updating aspect ratio: {}", aspect);
                    renderer.aspect_ratio = aspect;
                    renderer.update_camera_uniforms(aspect);
                    if let Ok((w, h)) = resize_window(&window, &state, aspect) {
                        log::info!("[GPU_PREVIEW] Reconfiguring surface: {}x{}", w, h);
                        renderer.reconfigure_surface(w, h);
                    }
                }

                // Render frame
                log::trace!("[GPU_PREVIEW] Rendering frame");
                let t_render_start = std::time::Instant::now();
                if let Err(e) = renderer.render_frame(&frame) {
                    log::warn!("[GPU_PREVIEW] Render error: {}", e);
                }

                let render_ms = t_render_start.elapsed().as_secs_f64() * 1000.0;
                render_window_frames += 1;
                render_window_total_ms += render_ms;
                render_window_max_ms = render_window_max_ms.max(render_ms);

                if render_ms > PREVIEW_SLOW_RENDER_WARN_MS {
                    render_window_slow_frames += 1;
                    log::warn!(
                        "[PREVIEW_TIMING_SLOW] stage=render frame_ms={:.2} budget_ms={:.2} threshold_ms={:.2}",
                        render_ms,
                        PREVIEW_FRAME_BUDGET_MS,
                        PREVIEW_SLOW_RENDER_WARN_MS
                    );
                }

                if render_window_frames >= PREVIEW_TIMING_WINDOW_FRAMES {
                    let avg_render_ms = render_window_total_ms / render_window_frames as f64;
                    log::info!(
                        "[PREVIEW_TIMING] window_frames={} avg_render_ms={:.2} max_render_ms={:.2} slow_frames={} budget_ms={:.2}",
                        render_window_frames,
                        avg_render_ms,
                        render_window_max_ms,
                        render_window_slow_frames,
                        PREVIEW_FRAME_BUDGET_MS
                    );
                    render_window_frames = 0;
                    render_window_total_ms = 0.0;
                    render_window_max_ms = 0.0;
                    render_window_slow_frames = 0;
                }
            },
            None => {
                if received_first_frame {
                    consecutive_timeouts += 1;
                    total_timeouts += 1;

                    if consecutive_timeouts >= PREVIEW_STALL_WARN_TIMEOUTS
                        && (consecutive_timeouts == PREVIEW_STALL_WARN_TIMEOUTS
                            || consecutive_timeouts.is_multiple_of(50))
                    {
                        log::warn!(
                            "[PREVIEW_TIMING_SLOW] stage=frame_source_stall consecutive_timeouts={} timeout_ms={}",
                            consecutive_timeouts,
                            timeout_remaining.as_millis()
                        );
                    }
                }
            },
        }
    }

    if render_window_frames > 0 {
        let avg_render_ms = render_window_total_ms / render_window_frames as f64;
        log::info!(
            "[PREVIEW_TIMING] window_frames={} avg_render_ms={:.2} max_render_ms={:.2} slow_frames={} budget_ms={:.2} partial=true",
            render_window_frames,
            avg_render_ms,
            render_window_max_ms,
            render_window_slow_frames,
            PREVIEW_FRAME_BUDGET_MS
        );
    }
    if total_timeouts > 0 {
        log::info!("[PREVIEW_TIMING] frame_source_timeouts={}", total_timeouts);
    }

    log::info!("[GPU_PREVIEW] Render loop exiting");
    renderer.cleanup();
    Ok(())
}

/// Resize window based on state.
/// Returns physical dimensions for surface configuration.
fn resize_window(
    window: &WebviewWindow,
    state: &GpuPreviewState,
    _aspect: f32,
) -> Result<(u32, u32), String> {
    let logical_size = state.size.clamp(MIN_PREVIEW_SIZE, MAX_PREVIEW_SIZE);

    // Set window size (logical coordinates)
    window
        .set_size(LogicalSize::new(logical_size as f64, logical_size as f64))
        .map_err(|e| format!("Failed to resize window: {}", e))?;

    // Return physical dimensions for surface configuration
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let physical_size = (logical_size * scale_factor as f32) as u32;

    Ok((physical_size, physical_size))
}

// ============================================================================
// wgpu Renderer
// ============================================================================

struct Renderer {
    surface: wgpu::Surface<'static>,
    surface_config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    render_pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    bind_group_layout: wgpu::BindGroupLayout,
    state_uniform_buffer: wgpu::Buffer,
    window_uniform_buffer: wgpu::Buffer,
    camera_uniform_buffer: wgpu::Buffer,
    uniform_bind_group: wgpu::BindGroup,
    texture_cache: Option<CachedYuvTextures>,
    aspect_ratio: f32,
    current_yuv_format: YuvFormat,
    current_state: GpuPreviewState,
    /// Reusable RGBA buffer for MJPEG decoding only
    rgba_buffer: Vec<u8>,
}

/// Cached textures for GPU YUV conversion
struct CachedYuvTextures {
    /// Y plane texture (R8 for NV12) or packed YUYV/RGBA texture
    y_texture: wgpu::Texture,
    /// UV plane texture (RG8 for NV12) or dummy 1x1 texture for YUYV/RGBA
    /// Must be stored to keep texture alive while bind_group references its view
    uv_texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
    format: YuvFormat,
}

/// YUV format for GPU shader
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum YuvFormat {
    Nv12 = 0,
    Yuyv422 = 1,
    Rgba = 2, // For MJPEG/RGB formats - pass through as-is
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct StateUniforms {
    shape: f32,
    size: f32,
    mirrored: f32,
    yuv_format: f32, // 0 = NV12, 1 = YUYV422, 2 = RGBA (pass-through)
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct WindowUniforms {
    window_height: f32,
    window_width: f32,
    tex_width: f32,  // Texture width for YUYV decoding
    tex_height: f32, // Texture height
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct CameraUniforms {
    camera_aspect_ratio: f32,
    _padding: f32,
}

async fn init_wgpu(window: WebviewWindow, state: &GpuPreviewState) -> MoonSnapResult<Renderer> {
    let logical_size = state.size.clamp(MIN_PREVIEW_SIZE, MAX_PREVIEW_SIZE) as u32;

    // Get the scale factor to convert to physical pixels
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let physical_size = (logical_size as f64 * scale_factor) as u32;

    log::info!(
        "[GPU_PREVIEW] Initializing: logical={}x{}, scale={:.2}, physical={}x{}",
        logical_size,
        logical_size,
        scale_factor,
        physical_size,
        physical_size
    );

    // NOTE: SetWindowDisplayAffinity is called AFTER wgpu init to avoid interference

    // Create wgpu instance and surface on main thread (required for window handle)
    // Try Vulkan first with implicit layers disabled (Bandicam, OBS hooks cause crashes)
    // Fall back to DX12 if Vulkan fails
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread({
            let window = window.clone();
            move || {
                // Disable Vulkan implicit layers that cause crashes (Bandicam, OBS)
                // This env var tells the Vulkan loader to skip implicit layers
                std::env::set_var("VK_LOADER_LAYERS_DISABLE", "*");

                // Try Vulkan first (supports transparency)
                let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
                    backends: wgpu::Backends::VULKAN,
                    ..Default::default()
                });

                let surface = instance.create_surface(window.clone());
                let _ = tx.send((instance, surface));
            }
        })
        .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    let (instance, surface) = rx.await.map_err(|_| "Failed to receive wgpu instance")?;
    let surface = surface.map_err(|e| format!("Failed to create surface: {}", e))?;

    // Get adapter
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            force_fallback_adapter: false,
            compatible_surface: Some(&surface),
        })
        .await
        .map_err(|e| format!("Failed to find wgpu adapter: {}", e))?;

    // Create device and queue
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("webcam-preview"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_webgl2_defaults()
                .using_resolution(adapter.limits()),
            memory_hints: Default::default(),
            trace: wgpu::Trace::Off,
        })
        .await
        .map_err(|e| format!("Failed to create device: {}", e))?;

    // Load YUV shader for GPU-based color conversion
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("camera-yuv-shader"),
        source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Borrowed(include_str!(
            "camera_yuv.wgsl"
        ))),
    });

    // Create bind group layouts
    let uniform_bind_group_layout =
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniform-bind-group-layout"),
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
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

    // Texture bind group layout for YUV textures (Y plane, UV plane, sampler)
    let texture_bind_group_layout =
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("yuv-texture-bind-group-layout"),
            entries: &[
                // Y plane texture (R8 for NV12, RGBA8 for YUYV/RGB)
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // UV plane texture (RG8 for NV12, dummy for others)
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

    // Create uniform buffers
    let state_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("state-uniform-buffer"),
        size: std::mem::size_of::<StateUniforms>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let window_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("window-uniform-buffer"),
        size: std::mem::size_of::<WindowUniforms>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let camera_uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("camera-uniform-buffer"),
        size: std::mem::size_of::<CameraUniforms>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    // Create uniform bind group
    let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("uniform-bind-group"),
        layout: &uniform_bind_group_layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: state_uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: window_uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: camera_uniform_buffer.as_entire_binding(),
            },
        ],
    });

    // Create render pipeline
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("camera-pipeline-layout"),
        bind_group_layouts: &[&texture_bind_group_layout, &uniform_bind_group_layout],
        push_constant_ranges: &[],
    });

    let swapchain_format = wgpu::TextureFormat::Bgra8Unorm;
    let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("camera-render-pipeline"),
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
                format: swapchain_format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview: None,
        cache: None,
    });

    // Configure surface
    let surface_caps = surface.get_capabilities(&adapter);
    // Use first available alpha mode - prefer PreMultiplied for transparency, fall back to whatever is supported
    let alpha_mode = if surface_caps
        .alpha_modes
        .contains(&CompositeAlphaMode::PreMultiplied)
    {
        CompositeAlphaMode::PreMultiplied
    } else if surface_caps
        .alpha_modes
        .contains(&CompositeAlphaMode::PostMultiplied)
    {
        CompositeAlphaMode::PostMultiplied
    } else if surface_caps
        .alpha_modes
        .contains(&CompositeAlphaMode::Inherit)
    {
        CompositeAlphaMode::Inherit
    } else {
        // Use first available - Opaque won't give transparency but at least won't crash
        surface_caps
            .alpha_modes
            .first()
            .copied()
            .unwrap_or(CompositeAlphaMode::Opaque)
    };
    log::info!(
        "[GPU_PREVIEW] Using alpha mode: {:?}, supported: {:?}",
        alpha_mode,
        surface_caps.alpha_modes
    );

    let surface_config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format: swapchain_format,
        width: physical_size * GPU_SURFACE_SCALE,
        height: physical_size * GPU_SURFACE_SCALE,
        present_mode: wgpu::PresentMode::Fifo,
        alpha_mode,
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    };
    surface.configure(&device, &surface_config);

    // Create sampler
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });

    // Pre-allocate RGBA buffer for MJPEG decoding only (other formats use GPU conversion)
    let max_pixels = (PREVIEW_MAX_TEXTURE_SIZE * PREVIEW_MAX_TEXTURE_SIZE) as usize;
    let rgba_buffer = Vec::with_capacity(max_pixels * 4);

    let mut renderer = Renderer {
        surface,
        surface_config,
        device,
        queue,
        render_pipeline,
        sampler,
        bind_group_layout: texture_bind_group_layout,
        state_uniform_buffer,
        window_uniform_buffer,
        camera_uniform_buffer,
        uniform_bind_group,
        texture_cache: None,
        aspect_ratio: 1.0,
        current_yuv_format: YuvFormat::Nv12, // Default, will be updated on first frame
        current_state: state.clone(),
        rgba_buffer,
    };

    // Initialize uniforms
    renderer.update_state_uniforms(state);
    renderer.update_window_uniforms(physical_size, physical_size);
    renderer.update_camera_uniforms(1.0);

    log::info!(
        "[GPU_PREVIEW] wgpu initialized: {}x{} (physical)",
        physical_size,
        physical_size
    );

    // Exclude webcam preview from screen capture (called AFTER wgpu init to avoid interference)
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
        };

        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let result = SetWindowDisplayAffinity(HWND(hwnd.0), WDA_EXCLUDEFROMCAPTURE);
                if result.is_ok() {
                    log::info!("[GPU_PREVIEW] Window excluded from screen capture");
                } else {
                    log::warn!("[GPU_PREVIEW] Failed to exclude window from screen capture");
                }
            }
        }
    }

    // Small delay to ensure window is fully ready for rendering
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    log::info!("[GPU_PREVIEW] Ready for rendering");

    Ok(renderer)
}

impl Renderer {
    fn update_state_uniforms(&mut self, state: &GpuPreviewState) {
        let normalized_size =
            (state.size - MIN_PREVIEW_SIZE) / (MAX_PREVIEW_SIZE - MIN_PREVIEW_SIZE);
        let uniforms = StateUniforms {
            shape: match state.shape {
                WebcamShape::Circle => 0.0,
                WebcamShape::Squircle => 1.0,
            },
            size: normalized_size.clamp(0.0, 1.0),
            mirrored: if state.mirrored { 1.0 } else { 0.0 },
            yuv_format: self.current_yuv_format as u32 as f32,
        };
        self.queue.write_buffer(
            &self.state_uniform_buffer,
            0,
            bytemuck::cast_slice(&[uniforms]),
        );
        self.current_state = state.clone();
    }

    fn update_window_uniforms(&self, width: u32, height: u32) {
        // Get texture dimensions if cached, otherwise use window size
        let (tex_width, tex_height) = self
            .texture_cache
            .as_ref()
            .map(|t| (t.width as f32, t.height as f32))
            .unwrap_or((width as f32, height as f32));

        let uniforms = WindowUniforms {
            window_width: (width * GPU_SURFACE_SCALE) as f32,
            window_height: (height * GPU_SURFACE_SCALE) as f32,
            tex_width,
            tex_height,
        };
        self.queue.write_buffer(
            &self.window_uniform_buffer,
            0,
            bytemuck::cast_slice(&[uniforms]),
        );
    }

    fn update_camera_uniforms(&self, aspect_ratio: f32) {
        let uniforms = CameraUniforms {
            camera_aspect_ratio: aspect_ratio,
            _padding: 0.0,
        };
        self.queue.write_buffer(
            &self.camera_uniform_buffer,
            0,
            bytemuck::cast_slice(&[uniforms]),
        );
    }

    fn reconfigure_surface(&mut self, width: u32, height: u32) {
        self.surface_config.width = if width > 0 {
            width * GPU_SURFACE_SCALE
        } else {
            1
        };
        self.surface_config.height = if height > 0 {
            height * GPU_SURFACE_SCALE
        } else {
            1
        };
        self.surface.configure(&self.device, &self.surface_config);
        self.update_window_uniforms(width, height);
    }

    fn render_frame(&mut self, frame: &NativeCameraFrame) -> MoonSnapResult<()> {
        use moonsnap_camera_windows::PixelFormat;

        // For preview, downsample to max 320px to reduce upload bandwidth.
        // Full 1080p = 3MB+, 320px = ~150KB per frame (20x smaller!)
        const PREVIEW_MAX_DIM: u32 = 320;

        let src_width = frame.width;
        let src_height = frame.height;

        // Calculate downsampled dimensions (keep aspect ratio)
        let scale = if src_width > PREVIEW_MAX_DIM || src_height > PREVIEW_MAX_DIM {
            let scale_w = PREVIEW_MAX_DIM as f32 / src_width as f32;
            let scale_h = PREVIEW_MAX_DIM as f32 / src_height as f32;
            scale_w.min(scale_h)
        } else {
            1.0
        };

        let dst_width = ((src_width as f32 * scale) as u32).max(2) & !1; // Round to even
        let dst_height = ((src_height as f32 * scale) as u32).max(2) & !1;

        // Determine YUV format for this frame
        let yuv_format = match frame.pixel_format {
            PixelFormat::NV12 => YuvFormat::Nv12,
            PixelFormat::YUYV422 => YuvFormat::Yuyv422,
            PixelFormat::MJPEG | PixelFormat::RGB24 | PixelFormat::RGB32 | PixelFormat::ARGB => {
                YuvFormat::Rgba
            },
            _ => return Err(format!("Unsupported pixel format: {:?}", frame.pixel_format).into()),
        };

        // Check if we need new textures (size or format changed)
        let needs_new_texture = self
            .texture_cache
            .as_ref()
            .map(|t| t.width != dst_width || t.height != dst_height || t.format != yuv_format)
            .unwrap_or(true);

        if needs_new_texture || yuv_format != self.current_yuv_format {
            log::info!(
                "[GPU_PREVIEW] Creating YUV textures: {}x{} (from {}x{}) format={:?}",
                dst_width,
                dst_height,
                src_width,
                src_height,
                yuv_format
            );
            self.texture_cache = Some(self.create_yuv_textures(dst_width, dst_height, yuv_format));
            self.current_yuv_format = yuv_format;
            // Update state uniforms with new format
            let state = self.current_state.clone();
            self.update_state_uniforms(&state);
            // Update window uniforms with texture dimensions
            let (sw, sh) = (self.surface_config.width, self.surface_config.height);
            self.update_window_uniforms(sw / GPU_SURFACE_SCALE, sh / GPU_SURFACE_SCALE);
        }

        // Safe: needs_new_texture is true when cache is None, which triggers creation above
        let cached = self
            .texture_cache
            .as_ref()
            .expect("texture_cache created when needs_new_texture is true");

        // Upload frame data based on format (with downsampling)
        match yuv_format {
            YuvFormat::Nv12 => {
                let bytes = frame.bytes();
                let y_size = (src_width * src_height) as usize;

                // Downsample Y plane
                self.rgba_buffer.clear();
                subsample_plane(
                    &bytes[..y_size],
                    src_width as usize,
                    src_height as usize,
                    dst_width as usize,
                    dst_height as usize,
                    1, // 1 byte per pixel for Y
                    &mut self.rgba_buffer,
                );

                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &cached.y_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &self.rgba_buffer,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(dst_width),
                        rows_per_image: Some(dst_height),
                    },
                    wgpu::Extent3d {
                        width: dst_width,
                        height: dst_height,
                        depth_or_array_layers: 1,
                    },
                );

                // Downsample UV plane (NV12 always has a real UV texture)
                self.rgba_buffer.clear();
                subsample_plane(
                    &bytes[y_size..],
                    src_width as usize, // UV row stride = src_width (interleaved)
                    (src_height / 2) as usize,
                    dst_width as usize,
                    (dst_height / 2) as usize,
                    2, // 2 bytes per UV pair
                    &mut self.rgba_buffer,
                );

                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &cached.uv_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &self.rgba_buffer,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(dst_width),
                        rows_per_image: Some(dst_height / 2),
                    },
                    wgpu::Extent3d {
                        width: dst_width / 2,
                        height: dst_height / 2,
                        depth_or_array_layers: 1,
                    },
                );
            },
            YuvFormat::Yuyv422 => {
                // YUYV422: downsample by skipping pixel pairs
                let bytes = frame.bytes();
                self.rgba_buffer.clear();
                subsample_yuyv(
                    bytes,
                    src_width as usize,
                    src_height as usize,
                    dst_width as usize,
                    dst_height as usize,
                    &mut self.rgba_buffer,
                );

                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &cached.y_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &self.rgba_buffer,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(dst_width * 2),
                        rows_per_image: Some(dst_height),
                    },
                    wgpu::Extent3d {
                        width: dst_width / 2,
                        height: dst_height,
                        depth_or_array_layers: 1,
                    },
                );
            },
            YuvFormat::Rgba => {
                // MJPEG/RGB: decode and downsample
                self.rgba_buffer.clear();
                frame_to_rgba_downsampled(frame, dst_width, dst_height, &mut self.rgba_buffer)?;

                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &cached.y_texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &self.rgba_buffer,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(dst_width * 4),
                        rows_per_image: Some(dst_height),
                    },
                    wgpu::Extent3d {
                        width: dst_width,
                        height: dst_height,
                        depth_or_array_layers: 1,
                    },
                );
            },
        }

        // Get surface texture
        let surface_texture = match self.surface.get_current_texture() {
            Ok(tex) => tex,
            Err(wgpu::SurfaceError::Outdated) => {
                log::info!("[GPU_PREVIEW] Surface outdated, reconfiguring");
                self.surface.configure(&self.device, &self.surface_config);
                self.surface
                    .get_current_texture()
                    .map_err(|e| format!("Failed to get surface texture after reconfig: {:?}", e))?
            },
            Err(e) => return Err(format!("Failed to get surface texture: {:?}", e).into()),
        };

        let surface_view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        // Create command encoder and render pass
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("render-encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("camera-render-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &surface_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.0,
                            g: 0.0,
                            b: 0.0,
                            a: 0.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.render_pipeline);
            render_pass.set_bind_group(0, &cached.bind_group, &[]);
            render_pass.set_bind_group(1, &self.uniform_bind_group, &[]);
            render_pass.draw(0..6, 0..1);
        }

        self.queue.submit(Some(encoder.finish()));
        surface_texture.present();

        Ok(())
    }

    fn create_yuv_textures(&self, width: u32, height: u32, format: YuvFormat) -> CachedYuvTextures {
        let (y_texture, uv_texture) = match format {
            YuvFormat::Nv12 => {
                // NV12: Y plane (R8) + UV plane (RG8, half resolution)
                let y_tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("nv12-y-texture"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::R8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });

                let uv_tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("nv12-uv-texture"),
                    size: wgpu::Extent3d {
                        width: width / 2,
                        height: height / 2,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rg8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });

                (y_tex, uv_tex)
            },
            YuvFormat::Yuyv422 => {
                // YUYV422: packed as RGBA8 (Y0, U, Y1, V per texel = 2 pixels)
                let y_tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("yuyv-texture"),
                    size: wgpu::Extent3d {
                        width: width / 2,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                // Create dummy UV texture (not used by shader but must exist for bind group)
                let dummy_uv = self.create_dummy_uv_texture();
                (y_tex, dummy_uv)
            },
            YuvFormat::Rgba => {
                // RGBA: direct RGBA8 texture
                let y_tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("rgba-texture"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                // Create dummy UV texture (not used by shader but must exist for bind group)
                let dummy_uv = self.create_dummy_uv_texture();
                (y_tex, dummy_uv)
            },
        };

        let y_view = y_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let uv_view = uv_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("yuv-texture-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&y_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&uv_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        CachedYuvTextures {
            y_texture,
            uv_texture,
            bind_group,
            width,
            height,
            format,
        }
    }

    /// Create a 1x1 dummy UV texture for non-NV12 formats.
    /// This texture is not used by the shader but must exist for the bind group.
    fn create_dummy_uv_texture(&self) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("dummy-uv-texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rg8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    fn cleanup(&mut self) {
        self.texture_cache = None;
        self.device.destroy();
    }
}

// Frame conversion helpers live in gpu_preview/frame_conversion.rs.
