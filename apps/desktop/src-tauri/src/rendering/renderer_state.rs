//! Global renderer state management.
//!
//! Provides a singleton shared renderer to avoid GPU resource conflicts
//! when multiple components (EditorInstance, PreviewRenderer, Export) need GPU access.

use std::sync::Arc;
use tokio::sync::RwLock;

use super::Renderer;

/// Global renderer state holding the shared GPU renderer.
///
/// This ensures only one wgpu Device/Queue is created, avoiding GPU conflicts
/// that can cause crashes (STATUS_ACCESS_VIOLATION) when multiple components
/// try to initialize their own GPU instances.
pub struct RendererState {
    /// The shared renderer instance.
    renderer: RwLock<Option<Arc<Renderer>>>,
}

impl RendererState {
    /// Create a new renderer state.
    pub fn new() -> Self {
        Self {
            renderer: RwLock::new(None),
        }
    }

    /// Get or create the shared renderer.
    ///
    /// This lazily initializes the GPU renderer on first access,
    /// then returns the same instance for all subsequent calls.
    pub async fn get_renderer(&self) -> Result<Arc<Renderer>, String> {
        // Fast path: check if already initialized and healthy
        {
            let renderer = self.renderer.read().await;
            if let Some(r) = renderer.as_ref() {
                if !r.is_lost() {
                    return Ok(Arc::clone(r));
                }
                log::warn!("[RendererState] GPU device lost, will re-initialize");
            }
        }

        // Slow path: need to initialize (or re-initialize after device loss)
        let mut renderer = self.renderer.write().await;

        // Double-check after acquiring write lock
        if let Some(r) = renderer.as_ref() {
            if !r.is_lost() {
                return Ok(Arc::clone(r));
            }
            // Drop the lost renderer
            log::info!("[RendererState] Dropping lost GPU renderer");
            *renderer = None;
        }

        // Initialize the renderer
        log::info!("[RendererState] Initializing shared GPU renderer...");
        let new_renderer = Renderer::new()
            .await
            .map_err(|e| format!("Failed to initialize GPU renderer: {}", e))?;

        let arc_renderer = Arc::new(new_renderer);
        *renderer = Some(Arc::clone(&arc_renderer));

        log::info!("[RendererState] Shared GPU renderer initialized successfully");
        Ok(arc_renderer)
    }

    /// Check if the renderer is initialized.
    pub async fn is_initialized(&self) -> bool {
        self.renderer.read().await.is_some()
    }

    /// Shutdown the renderer (release GPU resources).
    ///
    /// This should typically only be called on app exit.
    pub async fn shutdown(&self) {
        let mut renderer = self.renderer.write().await;
        if renderer.take().is_some() {
            log::info!("[RendererState] GPU renderer shut down");
        }
    }
}

impl Default for RendererState {
    fn default() -> Self {
        Self::new()
    }
}
