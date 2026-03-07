// Clippy allows for less critical warnings (style/pedantic issues)
#![allow(clippy::too_many_arguments)]
#![allow(clippy::wildcard_in_or_patterns)]
#![allow(clippy::clone_on_copy)]
#![allow(clippy::redundant_closure)]
#![allow(clippy::needless_borrows_for_generic_args)]
#![allow(clippy::collapsible_if)]
#![allow(clippy::manual_map)]
#![allow(clippy::wrong_self_convention)]
#![allow(clippy::enum_variant_names)]
#![allow(clippy::unnecessary_cast)]
#![allow(clippy::field_reassign_with_default)]
#![allow(clippy::derivable_impls)]
#![allow(clippy::unnecessary_sort_by)]
#![allow(clippy::single_match)]
#![allow(clippy::for_kv_map)]
#![allow(clippy::ptr_arg)]
#![allow(clippy::unnecessary_to_owned)]
#![allow(clippy::redundant_pattern_matching)]
#![allow(clippy::missing_const_for_thread_local)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::manual_strip)]
#![allow(clippy::manual_is_multiple_of)]
#![allow(clippy::useless_format)]
#![allow(clippy::manual_flatten)]
#![allow(clippy::manual_abs_diff)]
#![allow(clippy::nonminimal_bool)]

use tauri::{image::Image, Manager};

#[cfg(desktop)]
use tauri_plugin_autostart::MacosLauncher;

pub mod app;
mod commands;
pub mod config;
pub mod cursor;
pub mod license;
pub mod preview;
pub mod rendering;

// Re-export TrayState for external use
#[cfg(desktop)]
pub use app::TrayState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize env_logger for Rust log::info!/log::debug! output
    // Only in debug builds to avoid spamming production
    #[cfg(debug_assertions)]
    {
        // Filter out noisy GPU/graphics logs while keeping app logs at info level
        env_logger::Builder::from_env(
            env_logger::Env::default()
                .default_filter_or("info,wgpu_hal=warn,wgpu_core=warn,naga=warn"),
        )
        .format_timestamp_millis()
        .init();
    }

    // WebView2 GPU flags disabled - was causing capture artifacts
    // #[cfg(target_os = "windows")]
    // {
    //     std::env::set_var(
    //         "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    //         "--enable-gpu-rasterization --enable-zero-copy",
    //     );
    // }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // Called when a second instance tries to start
            // Show the startup toolbar (or bring it to front if already visible)
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    commands::window::toolbar::show_startup_toolbar(app_handle, None, None, None)
                        .await
                {
                    log::error!("Failed to show startup toolbar on second instance: {}", e);
                }
            });
            log::info!("Second instance blocked. Args: {:?}, CWD: {:?}", args, cwd);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ));
    }

    builder
        .on_window_event(|window, event| {
            app::events::handle_window_event(window, event);
        })
        .invoke_handler(commands::registry::tauri_command_handler!())
        .setup(|app| {
            // Initialize logging system first
            if let Err(e) = commands::logging::init_logging(app.handle()) {
                // Can't use log! here since logging initialization failed
                eprintln!("Failed to initialize logging: {}", e);
            }

            // Install panic hook to restore desktop icons on any future panic (fast, non-blocking)
            moonsnap_capture::desktop_icons::install_panic_hook();

            // Safety: Restore desktop icons in case previous session crashed while hiding them
            // Run in background thread to not block startup toolbar
            std::thread::spawn(|| {
                moonsnap_capture::desktop_icons::force_show_desktop_icons();
            });

            #[cfg(desktop)]
            {
                app::tray::init(app)?;
                // Note: Shortcuts are now registered dynamically via frontend
                // after settings are loaded. See commands::settings module.
            }

            // Initialize shared GPU renderer state (singleton pattern to avoid GPU conflicts)
            app.manage(rendering::RendererState::new());

            // Initialize GPU editor state for video editing
            app.manage(commands::video_recording::EditorState::new());

            // Initialize preview state for GPU-rendered preview streaming
            app.manage(commands::preview::PreviewState::new());

            // Serialize toolbar creation so shortcut repeats do not create duplicate windows.
            app.manage(commands::window::toolbar::CaptureToolbarWindowState::default());

            // Initialize pre-rendered text state for WYSIWYG text export
            app.manage(commands::text_prerender::PreRenderedTextState::new());

            // Initialize native caption preview state for zero-latency caption preview
            app.manage(commands::preview::NativeCaptionPreviewState::new());

            // Initialize license state
            let app_data_dir = app.path().app_data_dir().map_err(|e| {
                Box::<dyn std::error::Error>::from(format!("Failed to get app data dir: {}", e))
            })?;
            app.manage(commands::license::LicenseState::new(app_data_dir));

            // Spawn background license re-validation
            {
                let license_state: tauri::State<'_, commands::license::LicenseState> = app.state();
                let cache = license_state.cache.clone();
                let key = license_state.encryption_key;
                let path = license_state.cache_path.clone();
                tauri::async_runtime::spawn(async move {
                    commands::license::background_revalidation(cache, key, path).await;
                });
            }

            // Set window icon on library window (kept for when it's shown via tray)
            if let Some(window) = app.get_webview_window("library") {
                // Set the taskbar icon
                let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                    .expect("Failed to load window icon");
                let _ = window.set_icon(icon);

                // NOTE: DWM blur-behind was removed because it caused capture artifacts
                // when capturing the window (black/corrupted content). The transparent: true
                // from Tauri config is sufficient for visual transparency.
                // The WS_EX_LAYERED style may still cause some capture issues, but removing
                // the blur-behind trick significantly improves capture quality.

                // Explicitly hide - window-state plugin may have restored visibility
                // Library is shown via tray "Show Library" menu
                let _ = window.hide();
            }

            // Show floating startup toolbar on app launch
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    commands::window::toolbar::show_startup_toolbar(app_handle, None, None, None)
                        .await
                {
                    log::error!("Failed to show startup toolbar: {}", e);
                }
            });

            // Ensure ffmpeg is available for video thumbnails (downloads if needed)
            // This runs in background and doesn't block app startup
            std::thread::spawn(|| {
                if moonsnap_media::ffmpeg::find_ffmpeg().is_none() {
                    // Try to download ffmpeg if not found
                    let _ = ffmpeg_sidecar::download::auto_download();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Global shortcuts are now registered dynamically via commands::settings module
// This allows users to customize shortcuts through the settings UI
