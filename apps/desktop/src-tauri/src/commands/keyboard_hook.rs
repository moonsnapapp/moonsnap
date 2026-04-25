//! Global shortcut registration and Windows override handling.
//!
//! Override mode now uses the local `moonsnap-hotkeys` crate, with a dedicated
//! manager thread modelled after Handy's `handy_keys` integration. The hotkey
//! manager is owned by one thread and all register/unregister operations are
//! routed to it over a channel.

use moonsnap_core::error::{MoonSnapError, MoonSnapResult};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs;
use std::str::FromStr;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use moonsnap_hotkeys::{Hotkey, HotkeyId, HotkeyManager, HotkeyState as HotkeyEventState};
use serde::Deserialize;
use tauri::AppHandle;

use crate::commands::{storage, window};

const DEFAULT_SHORTCUTS: [(&str, &str); 6] = [
    ("open_capture_toolbar", "Ctrl+Shift+Space"),
    ("new_capture", "Ctrl+PrintScreen"),
    ("fullscreen_capture", "Shift+PrintScreen"),
    ("all_monitors_capture", "Ctrl+Shift+PrintScreen"),
    ("record_video", "Ctrl+Alt+R"),
    ("record_gif", "Ctrl+Alt+G"),
];

const MANAGER_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SHORTCUT_DISPATCH_DEBOUNCE: Duration = Duration::from_millis(250);

struct OverrideBinding {
    shortcut: Hotkey,
    shortcut_string: String,
    registration: Option<HotkeyId>,
    suspended: bool,
}

enum ManagerCommand {
    Register {
        id: String,
        shortcut: String,
        response: Sender<Result<(), String>>,
    },
    Unregister {
        id: String,
        response: Sender<Result<(), String>>,
    },
    Suspend {
        id: String,
        response: Sender<Result<(), String>>,
    },
    Resume {
        id: String,
        response: Sender<Result<(), String>>,
    },
    IsRegistered {
        id: String,
        response: Sender<Result<bool, String>>,
    },
    CheckAvailable {
        shortcut: String,
        exclude_id: Option<String>,
        response: Sender<Result<bool, String>>,
    },
    Snapshot {
        #[allow(clippy::type_complexity)]
        response: Sender<Result<Vec<(String, String, bool)>, String>>,
    },
    Shutdown,
}

struct OverrideRuntime {
    command_sender: Mutex<Sender<ManagerCommand>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
    init_error: Arc<Mutex<Option<String>>>,
}

struct HotkeyState {
    app_handle: Option<AppHandle>,
    override_runtime: Option<OverrideRuntime>,
}

static HOTKEY_STATE: OnceLock<Arc<Mutex<HotkeyState>>> = OnceLock::new();
static LAST_SHORTCUT_DISPATCH: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();

#[derive(Debug, Default, Deserialize)]
struct PersistedShortcutConfig {
    #[serde(rename = "currentShortcut")]
    current_shortcut: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct PersistedShortcutSettings {
    #[serde(default)]
    shortcuts: HashMap<String, PersistedShortcutConfig>,
}

fn get_state() -> &'static Arc<Mutex<HotkeyState>> {
    HOTKEY_STATE.get_or_init(|| {
        Arc::new(Mutex::new(HotkeyState {
            app_handle: None,
            override_runtime: None,
        }))
    })
}

fn parse_hotkey(shortcut: &str) -> MoonSnapResult<Hotkey> {
    Hotkey::from_str(shortcut)
        .map_err(|error| format!("Invalid shortcut '{}': {}", shortcut, error).into())
}

fn should_skip_duplicate_dispatch(id: &str) -> bool {
    let state = LAST_SHORTCUT_DISPATCH.get_or_init(|| Mutex::new(None));
    let mut last_dispatch = state.lock();

    let now = Instant::now();
    if let Some((last_id, last_at)) = last_dispatch.as_ref() {
        if last_id == id && now.duration_since(*last_at) <= SHORTCUT_DISPATCH_DEBOUNCE {
            return true;
        }
    }

    *last_dispatch = Some((id.to_string(), now));
    false
}

fn load_persisted_shortcut_settings(app: &AppHandle) -> PersistedShortcutSettings {
    let settings_path = match storage::get_app_data_dir(app) {
        Ok(dir) => dir.join("settings.json"),
        Err(error) => {
            log::warn!(
                "Failed to resolve settings path for startup shortcuts: {}",
                error
            );
            return PersistedShortcutSettings::default();
        },
    };

    match fs::read_to_string(&settings_path) {
        Ok(content) => match serde_json::from_str::<PersistedShortcutSettings>(&content) {
            Ok(settings) => settings,
            Err(error) => {
                log::warn!(
                    "Failed to parse startup shortcut settings from {}: {}",
                    settings_path.display(),
                    error
                );
                PersistedShortcutSettings::default()
            },
        },
        Err(error) => {
            log::warn!(
                "Failed to read startup shortcut settings from {}: {}",
                settings_path.display(),
                error
            );
            PersistedShortcutSettings::default()
        },
    }
}

fn resolved_shortcuts(settings: &PersistedShortcutSettings) -> Vec<(String, String)> {
    DEFAULT_SHORTCUTS
        .iter()
        .map(|(id, default_shortcut)| {
            let shortcut = settings
                .shortcuts
                .get(*id)
                .and_then(|config| config.current_shortcut.as_ref())
                .filter(|shortcut| !shortcut.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| (*default_shortcut).to_string());

            ((*id).to_string(), shortcut)
        })
        .collect()
}

fn dispatch_global_shortcut_inner(app: &AppHandle, id: &str) -> MoonSnapResult<()> {
    if should_skip_duplicate_dispatch(id) {
        return Ok(());
    }

    match id {
        "open_capture_toolbar" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = window::show_startup_toolbar(app_handle, None, None, None).await
                {
                    log::error!("Failed to show capture toolbar from shortcut: {}", error);
                }
            });
            Ok(())
        },
        "new_capture" => window::trigger_capture(app, Some("screenshot")),
        "fullscreen_capture" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = window::capture::capture_fullscreen_to_editor(app_handle).await
                {
                    log::error!("Failed to capture fullscreen from shortcut: {}", error);
                }
            });
            Ok(())
        },
        "all_monitors_capture" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    window::capture::capture_all_monitors_to_editor(app_handle).await
                {
                    log::error!("Failed to capture all monitors from shortcut: {}", error);
                }
            });
            Ok(())
        },
        "record_video" => window::trigger_capture_with_options(app, Some("video"), true),
        "record_gif" => window::trigger_capture_with_options(app, Some("gif"), true),
        _ => Err(format!("Unknown shortcut action: {}", id).into()),
    }
}

fn do_register(
    manager: &HotkeyManager,
    hotkey_to_binding: &mut HashMap<HotkeyId, String>,
    bindings: &mut HashMap<String, OverrideBinding>,
    id: String,
    shortcut: String,
) -> MoonSnapResult<()> {
    let hotkey = parse_hotkey(&shortcut)?;

    if let Some(existing_id) = bindings.iter().find_map(|(existing_id, binding)| {
        if existing_id != &id && binding.shortcut == hotkey && !binding.suspended {
            Some(existing_id.clone())
        } else {
            None
        }
    }) {
        return Err(format!("Shortcut already registered by {}", existing_id).into());
    }

    if let Some(existing) = bindings.get_mut(&id) {
        if let Some(hotkey_id) = existing.registration.take() {
            let _ = manager.unregister(hotkey_id);
            hotkey_to_binding.remove(&hotkey_id);
        }
    }

    let registration = manager
        .register(hotkey)
        .map_err(|error| format!("Failed to register hotkey: {}", error))?;

    hotkey_to_binding.insert(registration, id.clone());
    bindings.insert(
        id,
        OverrideBinding {
            shortcut: hotkey,
            shortcut_string: shortcut,
            registration: Some(registration),
            suspended: false,
        },
    );

    Ok(())
}

fn do_unregister(
    manager: &HotkeyManager,
    hotkey_to_binding: &mut HashMap<HotkeyId, String>,
    bindings: &mut HashMap<String, OverrideBinding>,
    id: &str,
) -> MoonSnapResult<()> {
    if let Some(binding) = bindings.remove(id) {
        if let Some(hotkey_id) = binding.registration {
            manager
                .unregister(hotkey_id)
                .map_err(|error| format!("Failed to unregister hotkey: {}", error))?;
            hotkey_to_binding.remove(&hotkey_id);
        }
    }

    Ok(())
}

fn do_suspend(
    manager: &HotkeyManager,
    hotkey_to_binding: &mut HashMap<HotkeyId, String>,
    bindings: &mut HashMap<String, OverrideBinding>,
    id: &str,
) -> MoonSnapResult<()> {
    let Some(binding) = bindings.get_mut(id) else {
        return Ok(());
    };

    binding.suspended = true;
    if let Some(hotkey_id) = binding.registration.take() {
        manager
            .unregister(hotkey_id)
            .map_err(|error| format!("Failed to suspend hotkey: {}", error))?;
        hotkey_to_binding.remove(&hotkey_id);
    }

    Ok(())
}

fn do_resume(
    manager: &HotkeyManager,
    hotkey_to_binding: &mut HashMap<HotkeyId, String>,
    bindings: &mut HashMap<String, OverrideBinding>,
    id: &str,
) -> MoonSnapResult<()> {
    let Some(binding) = bindings.get_mut(id) else {
        return Ok(());
    };

    if !binding.suspended || binding.registration.is_some() {
        return Ok(());
    }

    let hotkey_id = manager
        .register(binding.shortcut)
        .map_err(|error| format!("Failed to resume hotkey: {}", error))?;

    binding.registration = Some(hotkey_id);
    binding.suspended = false;
    hotkey_to_binding.insert(hotkey_id, id.to_string());

    Ok(())
}

fn do_is_registered(bindings: &HashMap<String, OverrideBinding>, id: &str) -> bool {
    bindings
        .get(id)
        .is_some_and(|binding| binding.registration.is_some() && !binding.suspended)
}

fn do_check_available(
    bindings: &HashMap<String, OverrideBinding>,
    shortcut: &str,
    exclude_id: Option<&str>,
) -> MoonSnapResult<bool> {
    let hotkey = parse_hotkey(shortcut)?;
    Ok(!bindings.iter().any(|(id, binding)| {
        exclude_id.is_none_or(|exclude_id| exclude_id != id)
            && !binding.suspended
            && binding.shortcut == hotkey
    }))
}

fn manager_thread(
    command_receiver: Receiver<ManagerCommand>,
    app: AppHandle,
    init_error: Arc<Mutex<Option<String>>>,
) {
    let manager = match HotkeyManager::new_with_blocking() {
        Ok(manager) => manager,
        Err(error) => {
            let message = format!("Failed to start global keyboard hook: {error}");
            log::error!("{message}");
            *init_error.lock() = Some(message.clone());
            // Drain the command channel so callers get a clear error instead of
            // hanging on response_receiver.recv() forever.
            while let Ok(command) = command_receiver.recv() {
                respond_with_init_error(command, &message);
            }
            return;
        },
    };

    let mut hotkey_to_binding: HashMap<HotkeyId, String> = HashMap::new();
    let mut bindings: HashMap<String, OverrideBinding> = HashMap::new();

    loop {
        while let Some(event) = manager.try_recv() {
            if event.state != HotkeyEventState::Pressed {
                continue;
            }

            if let Some(binding_id) = hotkey_to_binding.get(&event.id).cloned() {
                if let Err(error) = dispatch_global_shortcut_inner(&app, &binding_id) {
                    log::error!(
                        "Failed to dispatch override shortcut {}: {}",
                        binding_id,
                        error
                    );
                }
            }
        }

        match command_receiver.recv_timeout(MANAGER_POLL_INTERVAL) {
            Ok(ManagerCommand::Register {
                id,
                shortcut,
                response,
            }) => {
                let _ = response.send(
                    do_register(
                        &manager,
                        &mut hotkey_to_binding,
                        &mut bindings,
                        id,
                        shortcut,
                    )
                    .map_err(|e| e.to_string()),
                );
            },
            Ok(ManagerCommand::Unregister { id, response }) => {
                let _ = response.send(
                    do_unregister(&manager, &mut hotkey_to_binding, &mut bindings, &id)
                        .map_err(|e| e.to_string()),
                );
            },
            Ok(ManagerCommand::Suspend { id, response }) => {
                let _ = response.send(
                    do_suspend(&manager, &mut hotkey_to_binding, &mut bindings, &id)
                        .map_err(|e| e.to_string()),
                );
            },
            Ok(ManagerCommand::Resume { id, response }) => {
                let _ = response.send(
                    do_resume(&manager, &mut hotkey_to_binding, &mut bindings, &id)
                        .map_err(|e| e.to_string()),
                );
            },
            Ok(ManagerCommand::IsRegistered { id, response }) => {
                let _ = response.send(Ok(do_is_registered(&bindings, &id)));
            },
            Ok(ManagerCommand::CheckAvailable {
                shortcut,
                exclude_id,
                response,
            }) => {
                let _ = response.send(
                    do_check_available(&bindings, &shortcut, exclude_id.as_deref())
                        .map_err(|e| e.to_string()),
                );
            },
            Ok(ManagerCommand::Snapshot { response }) => {
                let _ = response.send(Ok(bindings
                    .iter()
                    .map(|(id, binding)| {
                        (
                            id.clone(),
                            binding.shortcut_string.clone(),
                            binding.suspended,
                        )
                    })
                    .collect()));
            },
            Ok(ManagerCommand::Shutdown) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {},
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn respond_with_init_error(command: ManagerCommand, message: &str) {
    match command {
        ManagerCommand::Register { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::Unregister { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::Suspend { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::Resume { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::IsRegistered { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::CheckAvailable { response, .. } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::Snapshot { response } => {
            let _ = response.send(Err(message.to_string()));
        },
        ManagerCommand::Shutdown => {},
    }
}

fn shutdown_override_runtime(state: &mut HotkeyState) {
    if let Some(runtime) = state.override_runtime.take() {
        let sender = runtime.command_sender.lock();
        let _ = sender.send(ManagerCommand::Shutdown);

        let mut handle = runtime.thread_handle.lock();
        if let Some(handle) = handle.take() {
            let _ = handle.join();
        }
    }
}

fn ensure_override_runtime(app: &AppHandle) -> MoonSnapResult<()> {
    {
        let mut state = get_state().lock();
        state.app_handle = Some(app.clone());
        if state.override_runtime.is_some() {
            return Ok(());
        }
    }

    let (command_sender, command_receiver) = mpsc::channel::<ManagerCommand>();
    let init_error = Arc::new(Mutex::new(None));
    let thread_init_error = Arc::clone(&init_error);
    let app_handle = app.clone();
    let thread_handle = thread::spawn(move || {
        manager_thread(command_receiver, app_handle, thread_init_error);
    });

    let mut state = get_state().lock();
    if state.override_runtime.is_none() {
        state.override_runtime = Some(OverrideRuntime {
            command_sender: Mutex::new(command_sender),
            thread_handle: Mutex::new(Some(thread_handle)),
            init_error,
        });
    }

    Ok(())
}

fn with_runtime_sender<T>(
    app: Option<&AppHandle>,
    callback: impl FnOnce(&Sender<ManagerCommand>) -> MoonSnapResult<T>,
) -> MoonSnapResult<T> {
    if let Some(app) = app {
        ensure_override_runtime(app)?;
    }

    let state = get_state().lock();
    let runtime = state
        .override_runtime
        .as_ref()
        .ok_or_else(|| MoonSnapError::Other("Override runtime is not initialized".to_string()))?;

    if let Some(init_error) = runtime.init_error.lock().as_ref() {
        return Err(MoonSnapError::Other(init_error.clone()));
    }

    let sender = runtime.command_sender.lock();
    callback(&sender)
}

fn register_shortcut_with_hook_inner(
    app: AppHandle,
    id: String,
    shortcut: String,
) -> MoonSnapResult<()> {
    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(Some(&app), |sender| {
        sender
            .send(ManagerCommand::Register {
                id,
                shortcut,
                response: response_sender,
            })
            .map_err(|_| "Failed to send register command".into())
    })?;

    response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??;
    Ok(())
}

fn active_override_bindings() -> MoonSnapResult<Vec<(String, String, bool)>> {
    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(None, |sender| {
        sender
            .send(ManagerCommand::Snapshot {
                response: response_sender,
            })
            .map_err(|_| "Failed to request override snapshot".into())
    })?;

    Ok(response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??)
}

pub fn initialize_persisted_shortcuts(app: &AppHandle) -> MoonSnapResult<()> {
    let settings = load_persisted_shortcut_settings(app);
    let shortcuts = resolved_shortcuts(&settings);

    for (id, shortcut) in shortcuts {
        if let Err(error) =
            register_shortcut_with_hook_inner(app.clone(), id.clone(), shortcut.clone())
        {
            log::error!(
                "Failed to register shortcut {} ({}) on startup: {}",
                id,
                shortcut,
                error
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn register_shortcut_with_hook(
    app: AppHandle,
    id: String,
    shortcut: String,
) -> MoonSnapResult<()> {
    register_shortcut_with_hook_inner(app, id, shortcut)
}

#[tauri::command]
pub async fn dispatch_global_shortcut(app: AppHandle, id: String) -> MoonSnapResult<()> {
    dispatch_global_shortcut_inner(&app, &id)
}

#[tauri::command]
pub async fn unregister_shortcut_hook(id: String) -> MoonSnapResult<()> {
    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(None, |sender| {
        sender
            .send(ManagerCommand::Unregister {
                id,
                response: response_sender,
            })
            .map_err(|_| "Failed to send unregister command".into())
    })?;

    response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??;
    Ok(())
}

#[tauri::command]
pub async fn unregister_all_hooks() -> MoonSnapResult<()> {
    let mut state = get_state().lock();
    shutdown_override_runtime(&mut state);
    Ok(())
}

#[tauri::command]
pub async fn reinstall_hook() -> MoonSnapResult<()> {
    let app_handle = {
        let state = get_state().lock();
        state.app_handle.clone()
    };

    let Some(app_handle) = app_handle else {
        return Ok(());
    };

    let bindings = active_override_bindings().unwrap_or_default();

    {
        let mut state = get_state().lock();
        shutdown_override_runtime(&mut state);
    }

    ensure_override_runtime(&app_handle)?;

    for (id, shortcut, suspended) in bindings {
        register_shortcut_with_hook_inner(app_handle.clone(), id.clone(), shortcut)?;
        if suspended {
            suspend_shortcut(id).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn suspend_shortcut(id: String) -> MoonSnapResult<()> {
    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(None, |sender| {
        sender
            .send(ManagerCommand::Suspend {
                id,
                response: response_sender,
            })
            .map_err(|_| "Failed to send suspend command".into())
    })?;

    response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??;
    Ok(())
}

#[tauri::command]
pub async fn resume_shortcut(id: String) -> MoonSnapResult<()> {
    let app_handle = {
        let state = get_state().lock();
        state.app_handle.clone()
    };

    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(app_handle.as_ref(), |sender| {
        sender
            .send(ManagerCommand::Resume {
                id,
                response: response_sender,
            })
            .map_err(|_| "Failed to send resume command".into())
    })?;

    response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??;
    Ok(())
}

#[tauri::command]
pub async fn is_shortcut_registered_hook(id: String) -> MoonSnapResult<bool> {
    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(None, |sender| {
        sender
            .send(ManagerCommand::IsRegistered {
                id,
                response: response_sender,
            })
            .map_err(|_| "Failed to send registration check command".into())
    })?;

    Ok(response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??)
}

#[tauri::command]
pub async fn check_shortcut_available(
    shortcut: String,
    exclude_id: Option<String>,
) -> MoonSnapResult<bool> {
    let (response_sender, response_receiver) = mpsc::channel();

    with_runtime_sender(None, |sender| {
        sender
            .send(ManagerCommand::CheckAvailable {
                shortcut,
                exclude_id,
                response: response_sender,
            })
            .map_err(|_| "Failed to send shortcut availability command".into())
    })?;

    Ok(response_receiver
        .recv()
        .map_err(|e| MoonSnapError::from(e.to_string()))??)
}
