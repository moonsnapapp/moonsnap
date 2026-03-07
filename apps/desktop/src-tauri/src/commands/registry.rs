//! Central Tauri command registry.
//!
//! Keeps command registration out of `lib.rs` so app bootstrap and lifecycle
//! logic remain readable.

macro_rules! tauri_command_handler {
    () => {
        tauri::generate_handler![
            // Capture commands (with transparency support)
            crate::commands::capture::get_monitors,
            crate::commands::capture::get_virtual_screen_bounds,
            crate::commands::capture::get_windows,
            crate::commands::capture::get_window_at_point,
            // Fast capture commands (skip PNG encoding for editor display)
            crate::commands::capture::capture_window_fast,
            crate::commands::capture::capture_region_fast,
            crate::commands::capture::capture_screen_region_fast,
            crate::commands::capture::capture_fullscreen_fast,
            crate::commands::capture::read_rgba_file,
            crate::commands::capture::cleanup_rgba_file,
            // Window commands - capture flow
            crate::commands::window::capture::show_overlay,
            crate::commands::window::capture::hide_overlay,
            crate::commands::window::capture::open_editor_fast,
            crate::commands::window::capture::restore_main_window,
            crate::commands::window::capture::show_library_window,
            // Window commands - recording
            crate::commands::window::recording::show_recording_border,
            crate::commands::window::recording::hide_recording_border,
            crate::commands::window::recording::show_countdown_window,
            crate::commands::window::recording::hide_countdown_window,
            // Window commands - toolbar
            crate::commands::window::toolbar::show_capture_toolbar,
            crate::commands::window::toolbar::update_capture_toolbar,
            crate::commands::window::toolbar::hide_capture_toolbar,
            crate::commands::window::toolbar::close_capture_toolbar,
            crate::commands::window::toolbar::bring_capture_toolbar_to_front,
            crate::commands::window::toolbar::resize_capture_toolbar,
            crate::commands::window::toolbar::set_capture_toolbar_bounds,
            crate::commands::window::toolbar::set_capture_toolbar_position,
            crate::commands::window::toolbar::set_capture_toolbar_ignore_cursor,
            crate::commands::window::toolbar::show_startup_toolbar,
            crate::commands::window::toolbar::hide_startup_toolbar,
            // Window commands - settings
            crate::commands::window::settings::show_settings_window,
            crate::commands::window::settings::close_settings_window,
            // Window commands - video editor
            crate::commands::window::video_editor::show_video_editor_window,
            crate::commands::window::video_editor::close_video_editor_window,
            crate::commands::window::video_editor::get_video_editor_project_path,
            // Window commands - image editor
            crate::commands::window::image_editor::show_image_editor_window,
            crate::commands::window::image_editor::close_image_editor_window,
            crate::commands::window::image_editor::get_image_editor_capture_path,
            // Window commands - screenshot preview
            crate::commands::window::screenshot_preview::show_screenshot_preview,
            crate::commands::window::screenshot_preview::close_screenshot_preview,
            // Window commands - recording preview
            crate::commands::window::recording_preview::show_recording_preview,
            crate::commands::window::recording_preview::close_recording_preview,
            // Image commands
            crate::commands::image::copy_image_to_clipboard,
            crate::commands::image::copy_rgba_to_clipboard,
            // Storage commands
            crate::commands::storage::operations::save_capture,
            crate::commands::storage::operations::save_capture_from_file,
            crate::commands::storage::operations::update_project_annotations,
            crate::commands::storage::operations::update_project_metadata,
            crate::commands::storage::operations::get_capture_list,
            crate::commands::storage::operations::get_project,
            crate::commands::storage::operations::get_project_image,
            crate::commands::storage::operations::get_saved_capture_by_temp_path,
            crate::commands::storage::operations::delete_project,
            crate::commands::storage::operations::delete_projects,
            crate::commands::storage::operations::export_project,
            crate::commands::storage::operations::get_storage_stats,
            crate::commands::storage::operations::get_library_folder,
            crate::commands::storage::operations::startup_cleanup,
            crate::commands::storage::operations::import_image_from_path,
            crate::commands::storage::operations::ensure_ffmpeg,
            // Settings commands
            crate::commands::settings::set_autostart,
            crate::commands::settings::is_autostart_enabled,
            crate::commands::settings::open_path_in_explorer,
            crate::commands::settings::reveal_file_in_explorer,
            crate::commands::settings::open_file_with_default_app,
            crate::commands::settings::save_copy_of_file,
            crate::commands::settings::get_default_save_dir,
            crate::commands::settings::update_tray_shortcut,
            // App config commands (from centralized config module)
            crate::config::app::set_close_to_tray,
            crate::config::app::get_app_config,
            crate::config::app::set_app_config,
            // Font commands
            crate::commands::fonts::get_system_fonts,
            crate::commands::fonts::get_font_data,
            crate::commands::fonts::get_font_weights,
            // Keyboard hook commands (Windows shortcut override)
            crate::commands::keyboard_hook::register_shortcut_with_hook,
            crate::commands::keyboard_hook::unregister_shortcut_hook,
            crate::commands::keyboard_hook::unregister_all_hooks,
            crate::commands::keyboard_hook::reinstall_hook,
            crate::commands::keyboard_hook::suspend_shortcut,
            crate::commands::keyboard_hook::resume_shortcut,
            crate::commands::keyboard_hook::is_shortcut_registered_hook,
            crate::commands::keyboard_hook::check_shortcut_available,
            // Video recording commands
            crate::commands::video_recording::start_recording,
            crate::commands::video_recording::stop_recording,
            crate::commands::video_recording::cancel_recording,
            crate::commands::video_recording::pause_recording,
            crate::commands::video_recording::resume_recording,
            crate::commands::video_recording::get_recording_status,
            // Recording config commands (from centralized config module)
            crate::config::recording::set_recording_countdown,
            crate::config::recording::set_recording_system_audio,
            crate::config::recording::set_recording_fps,
            crate::config::recording::set_recording_quality,
            crate::config::recording::set_gif_quality_preset,
            crate::config::recording::set_recording_include_cursor,
            crate::config::recording::set_recording_quick_capture,
            crate::config::recording::set_recording_max_duration,
            crate::config::recording::set_recording_microphone_device,
            crate::config::recording::set_hide_desktop_icons,
            crate::config::recording::reset_recording_config_cmd,
            crate::config::recording::set_recording_config,
            crate::config::recording::get_recording_config,
            // Webcam config commands (from centralized config module)
            crate::config::webcam::get_webcam_settings_cmd,
            crate::config::webcam::set_webcam_enabled,
            crate::config::webcam::set_webcam_device,
            crate::config::webcam::set_webcam_position,
            crate::config::webcam::set_webcam_size,
            crate::config::webcam::set_webcam_shape,
            crate::config::webcam::set_webcam_mirror,
            crate::config::webcam::set_webcam_config,
            crate::commands::video_recording::list_webcam_devices,
            crate::commands::video_recording::list_audio_input_devices,
            crate::commands::video_recording::list_audio_output_devices,
            crate::commands::video_recording::close_webcam_preview,
            crate::commands::video_recording::bring_webcam_preview_to_front,
            crate::commands::video_recording::move_webcam_to_anchor,
            crate::commands::video_recording::clamp_webcam_to_selection,
            crate::commands::video_recording::start_webcam_preview,
            crate::commands::video_recording::stop_webcam_preview,
            crate::commands::video_recording::is_webcam_preview_running,
            crate::commands::video_recording::prewarm_capture,
            crate::commands::video_recording::stop_prewarm,
            crate::commands::video_recording::prepare_recording,
            crate::commands::video_recording::get_webcam_preview_frame,
            crate::commands::video_recording::get_webcam_preview_dimensions,
            crate::commands::video_recording::exclude_webcam_from_capture,
            // Native webcam preview (Windows-only, GDI-based with circle mask)
            #[cfg(target_os = "windows")]
            crate::commands::video_recording::start_native_webcam_preview,
            #[cfg(target_os = "windows")]
            crate::commands::video_recording::stop_native_webcam_preview,
            #[cfg(target_os = "windows")]
            crate::commands::video_recording::is_native_webcam_preview_running,
            // MF webcam preview (Windows-only, low-latency async Media Foundation)
            #[cfg(target_os = "windows")]
            crate::commands::video_recording::start_mf_webcam_preview,
            #[cfg(target_os = "windows")]
            crate::commands::video_recording::stop_mf_webcam_preview,
            #[cfg(target_os = "windows")]
            crate::commands::video_recording::is_mf_webcam_preview_running,
            // GPU-accelerated webcam preview (Cap-style direct rendering)
            crate::commands::video_recording::start_gpu_webcam_preview,
            crate::commands::video_recording::stop_gpu_webcam_preview,
            crate::commands::video_recording::is_gpu_webcam_preview_running,
            crate::commands::video_recording::update_gpu_webcam_preview_settings,
            // Camera preview manager (Cap-style centralized lifecycle)
            crate::commands::video_recording::show_camera_preview,
            crate::commands::video_recording::hide_camera_preview,
            crate::commands::video_recording::close_webcam_from_preview,
            crate::commands::video_recording::is_camera_preview_showing,
            crate::commands::video_recording::notify_preview_window_closed,
            // Browser-based webcam recording (MediaRecorder chunks)
            crate::commands::video_recording::webcam_recording_start,
            crate::commands::video_recording::webcam_recording_chunk,
            crate::commands::video_recording::webcam_recording_stop,
            // Video editor commands
            crate::commands::video_recording::load_video_project,
            crate::commands::video_recording::save_video_project,
            crate::commands::video_recording::load_cursor_recording_cmd,
            crate::commands::video_recording::extract_frame,
            crate::commands::video_recording::clear_video_frame_cache,
            crate::commands::video_recording::extract_audio_waveform,
            crate::commands::video_recording::generate_auto_zoom,
            crate::commands::video_recording::export_video,
            crate::commands::video_recording::cancel_export,
            crate::commands::video_recording::check_nvenc_available,
            // GPU-accelerated video editor commands
            crate::commands::video_recording::gpu_editor::create_editor_instance,
            crate::commands::video_recording::gpu_editor::destroy_editor_instance,
            crate::commands::video_recording::gpu_editor::editor_play,
            crate::commands::video_recording::gpu_editor::editor_pause,
            crate::commands::video_recording::gpu_editor::editor_seek,
            crate::commands::video_recording::gpu_editor::editor_set_speed,
            crate::commands::video_recording::gpu_editor::editor_get_state,
            crate::commands::video_recording::gpu_editor::editor_render_frame,
            crate::commands::video_recording::gpu_editor::editor_get_timestamp,
            // GPU preview commands (WebSocket streaming)
            crate::commands::preview::init_preview,
            crate::commands::preview::set_preview_project,
            crate::commands::preview::render_preview_frame,
            crate::commands::preview::shutdown_preview,
            crate::commands::preview::get_preview_ws_port,
            // Caption preview commands (GPU-rendered via WebSocket)
            crate::commands::preview::render_caption_overlay,
            crate::commands::preview::set_caption_overlay_data,
            crate::commands::preview::render_caption_overlay_frame,
            // Native caption preview commands (zero-latency surface rendering)
            crate::commands::preview::init_native_caption_preview,
            crate::commands::preview::resize_native_caption_preview,
            crate::commands::preview::update_native_caption_preview,
            crate::commands::preview::scrub_native_caption_preview,
            crate::commands::preview::destroy_native_caption_preview,
            // Audio monitoring commands
            crate::commands::video_recording::start_audio_monitoring,
            crate::commands::video_recording::stop_audio_monitoring,
            crate::commands::video_recording::is_audio_monitoring,
            // Logging commands
            crate::commands::logging::write_log,
            crate::commands::logging::write_logs,
            crate::commands::logging::get_log_dir,
            crate::commands::logging::open_log_dir,
            crate::commands::logging::get_recent_logs,
            // Capture overlay for video/gif region selection (uses DirectComposition to avoid video blackout)
            crate::commands::capture_overlay::show_capture_overlay,
            crate::commands::capture_overlay::commands::capture_overlay_confirm,
            crate::commands::capture_overlay::commands::capture_overlay_cancel,
            crate::commands::capture_overlay::commands::capture_overlay_reselect,
            crate::commands::capture_overlay::commands::capture_overlay_set_dimensions,
            crate::commands::capture_overlay::commands::capture_overlay_highlight_monitor,
            crate::commands::capture_overlay::commands::capture_overlay_highlight_window,
            // Preview overlay for picker panels
            crate::commands::capture_overlay::start_highlight_preview,
            crate::commands::capture_overlay::stop_highlight_preview,
            crate::commands::capture_overlay::is_highlight_preview_active,
            // Pre-rendered text commands (WYSIWYG text export)
            crate::commands::text_prerender::register_prerendered_text,
            crate::commands::text_prerender::clear_prerendered_texts,
            // Caption/transcription commands
            crate::commands::captions::check_whisper_model,
            crate::commands::captions::list_whisper_models,
            crate::commands::captions::download_whisper_model,
            crate::commands::captions::delete_whisper_model,
            crate::commands::captions::transcribe_video,
            crate::commands::captions::transcribe_caption_segment,
            crate::commands::captions::save_caption_data,
            crate::commands::captions::load_caption_data,
            // License commands
            crate::commands::license::get_license_status,
            crate::commands::license::activate_license,
            crate::commands::license::deactivate_license,
            crate::commands::license::check_pro_feature,
            // Parity commands (preview/export CSS sync)
            crate::rendering::parity::get_parity_layout,
            crate::rendering::parity::get_composition_bounds,
            crate::rendering::parity::get_font_metrics,
        ]
    };
}

pub(crate) use tauri_command_handler;
