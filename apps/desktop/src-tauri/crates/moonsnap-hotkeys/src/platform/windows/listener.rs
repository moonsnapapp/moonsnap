//! Windows low-level keyboard hook implementation

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, MsgWaitForMultipleObjects, PeekMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, MSLLHOOKSTRUCT,
    PM_REMOVE, QS_ALLINPUT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_HOTKEY, WM_KEYDOWN, WM_LBUTTONDOWN,
    WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_SYSKEYDOWN, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

use crate::error::{Error, Result};
use crate::platform::state::BlockingHotkeys;
use crate::types::{Hotkey, Key, KeyEvent, Modifiers};

use super::keycode::{vk_to_key, vk_to_modifier};

const HOOK_LOOP_TIMEOUT_MS: u32 = 10;
const VK_SNAPSHOT: u32 = 0x2C;
const IDHOT_SNAPDESKTOP: i32 = -2;
const VK_LSHIFT: i32 = 0xA0;
const VK_RSHIFT: i32 = 0xA1;
const VK_LCONTROL: i32 = 0xA2;
const VK_RCONTROL: i32 = 0xA3;
const VK_LMENU: i32 = 0xA4;
const VK_RMENU: i32 = 0xA5;
const VK_LWIN: i32 = 0x5B;
const VK_RWIN: i32 = 0x5C;

/// Thread-local state for the keyboard hook callback.
///
/// Windows low-level hooks require a callback function with a specific signature,
/// so we use thread-local storage to access our state from within the callback.
struct HookContext {
    event_sender: Sender<KeyEvent>,
    current_modifiers: Modifiers,
    blocking_hotkeys: Option<BlockingHotkeys>,
    system_printscreen_registered: bool,
}

thread_local! {
    static HOOK_CONTEXT: std::cell::RefCell<Option<HookContext>> = const { std::cell::RefCell::new(None) };
}

/// Drain all pending thread messages and return `true` if WM_QUIT was received.
fn drain_thread_messages(msg: &mut MSG) -> bool {
    unsafe {
        while PeekMessageW(msg, None, 0, 0, PM_REMOVE).as_bool() {
            if msg.message == WM_QUIT {
                return true;
            }
            if msg.message == WM_HOTKEY && msg.wParam.0 as i32 == IDHOT_SNAPDESKTOP {
                HOOK_CONTEXT.with(|ctx_cell| {
                    if let Some(ctx) = ctx_cell.borrow().as_ref() {
                        emit_printscreen_hotkey(ctx);
                    }
                });
                continue;
            }
            let _ = TranslateMessage(msg);
            DispatchMessageW(msg);
        }
    }
    false
}

/// Wait for new input/messages or until timeout expires.
fn wait_for_message_or_timeout(timeout_ms: u32) {
    unsafe {
        let _ = MsgWaitForMultipleObjects(None, false, timeout_ms, QS_ALLINPUT);
    }
}

/// Internal listener state returned to KeyboardListener
pub(crate) struct WindowsListenerState {
    pub event_receiver: mpsc::Receiver<KeyEvent>,
    pub thread_handle: Option<JoinHandle<()>>,
    pub running: Arc<AtomicBool>,
    pub blocking_hotkeys: Option<BlockingHotkeys>,
}

/// Spawn a Windows low-level keyboard hook listener
pub(crate) fn spawn(blocking_hotkeys: Option<BlockingHotkeys>) -> Result<WindowsListenerState> {
    let (tx, rx) = mpsc::channel();
    let (init_tx, init_rx) = mpsc::channel::<Result<()>>();
    let running = Arc::new(AtomicBool::new(true));
    let thread_running = Arc::clone(&running);
    let thread_blocking = blocking_hotkeys.clone();

    let handle = thread::spawn(move || {
        // Initialize thread-local hook context
        HOOK_CONTEXT.with(|ctx| {
            *ctx.borrow_mut() = Some(HookContext {
                event_sender: tx,
                current_modifiers: Modifiers::empty(),
                blocking_hotkeys: thread_blocking,
                system_printscreen_registered: false,
            });
        });

        // Install the low-level keyboard hook
        let kb_hook =
            unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), None, 0) };

        let kb_hook = match kb_hook {
            Ok(h) => h,
            Err(e) => {
                let _ = init_tx.send(Err(Error::Platform(format!(
                    "Failed to install low-level keyboard hook: {e}"
                ))));
                return;
            },
        };

        // Install the low-level mouse hook
        let mouse_hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0) };

        let mouse_hook = match mouse_hook {
            Ok(h) => h,
            Err(e) => {
                unsafe {
                    let _ = UnhookWindowsHookEx(kb_hook);
                }
                let _ = init_tx.send(Err(Error::Platform(format!(
                    "Failed to install low-level mouse hook: {e}"
                ))));
                return;
            },
        };

        // Both hooks installed — let the caller proceed.
        let _ = init_tx.send(Ok(()));

        // Message loop - required for low-level hooks to function.
        // Keep the short timeout so shutdown polling behavior remains unchanged.
        let mut msg = MSG::default();
        unsafe {
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE);
        }
        loop {
            // Check if we should stop
            if !thread_running.load(Ordering::SeqCst) {
                break;
            }

            sync_printscreen_registration();

            // Process all pending messages
            if drain_thread_messages(&mut msg) {
                break;
            }

            // Wait for messages or timeout — unlike thread::sleep, this returns
            // immediately when a message arrives, so hook callbacks are never delayed.
            wait_for_message_or_timeout(HOOK_LOOP_TIMEOUT_MS);
        }

        // Clean up the hooks
        unsafe {
            let _ = UnhookWindowsHookEx(kb_hook);
            let _ = UnhookWindowsHookEx(mouse_hook);
        }

        HOOK_CONTEXT.with(|ctx_cell| {
            if let Some(ctx) = ctx_cell.borrow_mut().as_mut() {
                if ctx.system_printscreen_registered {
                    unsafe {
                        let _ = UnregisterHotKey(None, IDHOT_SNAPDESKTOP);
                    }
                    ctx.system_printscreen_registered = false;
                }
            }
        });

        // Clear thread-local state
        HOOK_CONTEXT.with(|ctx| {
            *ctx.borrow_mut() = None;
        });
    });

    // Wait for the listener thread to confirm hook installation. If install
    // fails, surface it synchronously so callers don't end up with a runtime
    // that silently swallows every shortcut.
    match init_rx.recv() {
        Ok(Ok(())) => Ok(WindowsListenerState {
            event_receiver: rx,
            thread_handle: Some(handle),
            running,
            blocking_hotkeys,
        }),
        Ok(Err(error)) => {
            running.store(false, Ordering::SeqCst);
            let _ = handle.join();
            Err(error)
        },
        Err(_) => {
            running.store(false, Ordering::SeqCst);
            let _ = handle.join();
            Err(Error::Platform(
                "Listener thread exited before reporting hook install status".into(),
            ))
        },
    }
}

/// Low-level keyboard hook callback
///
/// This function is called by Windows for every keyboard event system-wide.
/// It must return quickly to avoid input lag.
unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // If code < 0, we must pass to next hook without processing
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let mut should_block = false;

    // Process the keyboard event
    HOOK_CONTEXT.with(|ctx_cell| {
        let mut ctx_ref = ctx_cell.borrow_mut();
        if let Some(ctx) = ctx_ref.as_mut() {
            // Extract key information from KBDLLHOOKSTRUCT
            let kb_struct = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let vk_code = kb_struct.vkCode as u16;
            let is_extended = (kb_struct.flags.0 & LLKHF_EXTENDED.0) != 0;

            let is_key_down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            let actual_modifiers = query_modifier_state();

            // Check if this is a modifier key
            if let Some(modifier) = vk_to_modifier(vk_code) {
                let prev_modifiers = ctx.current_modifiers;
                ctx.current_modifiers = actual_modifiers;

                // Only emit event if modifiers actually changed
                if ctx.current_modifiers != prev_modifiers {
                    // Check if modifier-only combo should be blocked
                    should_block =
                        should_block_hotkey(&ctx.blocking_hotkeys, ctx.current_modifiers, None);

                    let _ = ctx.event_sender.send(KeyEvent {
                        modifiers: ctx.current_modifiers,
                        key: None,
                        is_key_down,
                        changed_modifier: Some(modifier),
                    });
                }
            } else if let Some(key) = vk_to_key(vk_code, is_extended) {
                if should_defer_printscreen_to_system_hotkey(ctx, key) {
                    return;
                }

                ctx.current_modifiers = actual_modifiers;

                // Regular key event
                should_block =
                    should_block_hotkey(&ctx.blocking_hotkeys, ctx.current_modifiers, Some(key));

                // Windows can swallow WM_KEYDOWN for PrintScreen even at the
                // LL hook level (only WM_KEYUP makes it through). To make
                // modified PrintScreen shortcuts (e.g. Ctrl+PrintScreen) fire
                // reliably, emit a synthetic press+release on every event we
                // see and skip the real one. The manager's pressed_hotkeys
                // dedup absorbs the duplicate when both events do come through.
                if key == Key::PrintScreen {
                    let press = KeyEvent {
                        modifiers: ctx.current_modifiers,
                        key: Some(key),
                        is_key_down: true,
                        changed_modifier: None,
                    };
                    let release = KeyEvent {
                        is_key_down: false,
                        ..press
                    };
                    let _ = ctx.event_sender.send(press);
                    let _ = ctx.event_sender.send(release);
                } else {
                    let _ = ctx.event_sender.send(KeyEvent {
                        modifiers: ctx.current_modifiers,
                        key: Some(key),
                        is_key_down,
                        changed_modifier: None,
                    });
                }
            }
        }
    });

    if should_block {
        // Return non-zero to block the event from propagating
        LRESULT(1)
    } else {
        // Pass to next hook in chain
        CallNextHookEx(None, code, wparam, lparam)
    }
}

/// Low-level mouse hook callback
///
/// This function is called by Windows for every mouse event system-wide.
unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // If code < 0, we must pass to next hook without processing
    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    // Process the mouse event
    HOOK_CONTEXT.with(|ctx_cell| {
        let mut ctx_ref = ctx_cell.borrow_mut();
        if let Some(ctx) = ctx_ref.as_mut() {
            ctx.current_modifiers = query_modifier_state();
            let mouse_struct = &*(lparam.0 as *const MSLLHOOKSTRUCT);

            // Only report left/right clicks when modifiers are held (to avoid noise)
            let has_modifiers = !ctx.current_modifiers.is_empty();

            let (key, is_down) = match wparam.0 as u32 {
                WM_LBUTTONDOWN if has_modifiers => (Some(Key::MouseLeft), true),
                WM_LBUTTONUP if has_modifiers => (Some(Key::MouseLeft), false),
                WM_RBUTTONDOWN if has_modifiers => (Some(Key::MouseRight), true),
                WM_RBUTTONUP if has_modifiers => (Some(Key::MouseRight), false),
                // Middle and X buttons always reported
                WM_MBUTTONDOWN => (Some(Key::MouseMiddle), true),
                WM_MBUTTONUP => (Some(Key::MouseMiddle), false),
                WM_XBUTTONDOWN => {
                    // High word of mouseData contains which X button (1 or 2)
                    let xbutton = (mouse_struct.mouseData >> 16) & 0xFFFF;
                    let key = if xbutton == 1 {
                        Some(Key::MouseX1)
                    } else if xbutton == 2 {
                        Some(Key::MouseX2)
                    } else {
                        None
                    };
                    (key, true)
                },
                WM_XBUTTONUP => {
                    let xbutton = (mouse_struct.mouseData >> 16) & 0xFFFF;
                    let key = if xbutton == 1 {
                        Some(Key::MouseX1)
                    } else if xbutton == 2 {
                        Some(Key::MouseX2)
                    } else {
                        None
                    };
                    (key, false)
                },
                _ => (None, false),
            };

            if let Some(key) = key {
                let _ = ctx.event_sender.send(KeyEvent {
                    modifiers: ctx.current_modifiers,
                    key: Some(key),
                    is_key_down: is_down,
                    changed_modifier: None,
                });
            }
        }
    });

    // Always pass mouse events through (no blocking for mouse)
    CallNextHookEx(None, code, wparam, lparam)
}

/// Check if a hotkey combination should be blocked
fn should_block_hotkey(
    blocking_hotkeys: &Option<BlockingHotkeys>,
    modifiers: Modifiers,
    key: Option<Key>,
) -> bool {
    if let Some(ref hotkeys) = blocking_hotkeys {
        if let Ok(set) = hotkeys.lock() {
            return set
                .iter()
                .any(|h| h.modifiers.matches(modifiers) && h.key == key);
        }
    }
    false
}

fn printscreen_hotkey() -> Hotkey {
    Hotkey {
        modifiers: Modifiers::empty(),
        key: Some(Key::PrintScreen),
    }
}

fn should_register_printscreen(blocking_hotkeys: &Option<BlockingHotkeys>) -> bool {
    blocking_hotkeys
        .as_ref()
        .and_then(|hotkeys| hotkeys.lock().ok())
        .is_some_and(|hotkeys| hotkeys.contains(&printscreen_hotkey()))
}

fn sync_printscreen_registration() {
    HOOK_CONTEXT.with(|ctx_cell| {
        let mut ctx_ref = ctx_cell.borrow_mut();
        let Some(ctx) = ctx_ref.as_mut() else {
            return;
        };

        let should_register = should_register_printscreen(&ctx.blocking_hotkeys);
        if should_register == ctx.system_printscreen_registered {
            return;
        }

        if should_register {
            match unsafe {
                RegisterHotKey(None, IDHOT_SNAPDESKTOP, HOT_KEY_MODIFIERS(0), VK_SNAPSHOT)
            } {
                Ok(_) => {
                    ctx.system_printscreen_registered = true;
                },
                Err(error) => {
                    eprintln!("Failed to register PrintScreen hotkey: {:?}", error);
                },
            }
        } else {
            if let Err(error) = unsafe { UnregisterHotKey(None, IDHOT_SNAPDESKTOP) } {
                eprintln!("Failed to unregister PrintScreen hotkey: {:?}", error);
            }
            ctx.system_printscreen_registered = false;
        }
    });
}

fn should_defer_printscreen_to_system_hotkey(ctx: &HookContext, key: Key) -> bool {
    key == Key::PrintScreen && ctx.current_modifiers.is_empty() && ctx.system_printscreen_registered
}

fn emit_printscreen_hotkey(ctx: &HookContext) {
    let key_down = KeyEvent {
        modifiers: Modifiers::empty(),
        key: Some(Key::PrintScreen),
        is_key_down: true,
        changed_modifier: None,
    };
    let key_up = KeyEvent {
        is_key_down: false,
        ..key_down
    };

    let _ = ctx.event_sender.send(key_down);
    let _ = ctx.event_sender.send(key_up);
}

fn query_modifier_state() -> Modifiers {
    let mut modifiers = Modifiers::empty();

    if is_key_pressed(VK_LSHIFT) {
        modifiers |= Modifiers::SHIFT_LEFT;
    }
    if is_key_pressed(VK_RSHIFT) {
        modifiers |= Modifiers::SHIFT_RIGHT;
    }
    if is_key_pressed(VK_LCONTROL) {
        modifiers |= Modifiers::CTRL_LEFT;
    }
    if is_key_pressed(VK_RCONTROL) {
        modifiers |= Modifiers::CTRL_RIGHT;
    }
    if is_key_pressed(VK_LMENU) {
        modifiers |= Modifiers::OPT_LEFT;
    }
    if is_key_pressed(VK_RMENU) {
        modifiers |= Modifiers::OPT_RIGHT;
    }
    if is_key_pressed(VK_LWIN) {
        modifiers |= Modifiers::CMD_LEFT;
    }
    if is_key_pressed(VK_RWIN) {
        modifiers |= Modifiers::CMD_RIGHT;
    }

    modifiers
}

fn is_key_pressed(virtual_key: i32) -> bool {
    unsafe { (GetAsyncKeyState(virtual_key) as u16 & 0x8000) != 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use windows::Win32::UI::WindowsAndMessaging::PostQuitMessage;

    fn clear_message_queue() {
        let mut msg = MSG::default();
        unsafe { while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {} }
    }

    #[test]
    fn wait_times_out_when_no_messages() {
        clear_message_queue();
        let start = Instant::now();
        wait_for_message_or_timeout(20);
        let elapsed = start.elapsed();
        assert!(
            elapsed >= Duration::from_millis(8),
            "expected wait to block close to timeout, elapsed={elapsed:?}"
        );
        clear_message_queue();
    }

    #[test]
    fn wait_returns_immediately_when_message_is_pending() {
        clear_message_queue();
        unsafe {
            PostQuitMessage(0);
        }
        let start = Instant::now();
        wait_for_message_or_timeout(200);
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_millis(100),
            "expected pending message to wake wait early, elapsed={elapsed:?}"
        );
        clear_message_queue();
    }

    #[test]
    fn drain_messages_stops_on_wm_quit() {
        clear_message_queue();
        unsafe {
            PostQuitMessage(0);
        }
        let mut msg = MSG::default();
        assert!(drain_thread_messages(&mut msg));
        clear_message_queue();
    }

    #[test]
    fn printscreen_registration_detects_bare_hotkey_only() {
        let bare_printscreen = Arc::new(std::sync::Mutex::new(std::collections::HashSet::from([
            Hotkey::new(Modifiers::empty(), Key::PrintScreen).unwrap(),
        ])));
        assert!(should_register_printscreen(&Some(bare_printscreen)));

        let modified_printscreen =
            Arc::new(std::sync::Mutex::new(std::collections::HashSet::from([
                Hotkey::new(Modifiers::SHIFT, Key::PrintScreen).unwrap(),
            ])));
        assert!(!should_register_printscreen(&Some(modified_printscreen)));
        assert!(!should_register_printscreen(&None));
    }

    #[test]
    fn bare_printscreen_events_defer_to_system_registration() {
        let (event_sender, _event_receiver) = mpsc::channel();
        let ctx = HookContext {
            event_sender,
            current_modifiers: Modifiers::empty(),
            blocking_hotkeys: None,
            system_printscreen_registered: true,
        };

        assert!(should_defer_printscreen_to_system_hotkey(
            &ctx,
            Key::PrintScreen
        ));
        assert!(!should_defer_printscreen_to_system_hotkey(&ctx, Key::F1));

        let ctx = HookContext {
            current_modifiers: Modifiers::SHIFT,
            ..ctx
        };
        assert!(!should_defer_printscreen_to_system_hotkey(
            &ctx,
            Key::PrintScreen
        ));
    }
}
