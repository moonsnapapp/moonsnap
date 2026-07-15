import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { useSettingsStore } from '@/stores/settingsStore';
import { isEditableEventTarget, matchesShortcutEvent } from '@/utils/hotkeyManager';

export interface FocusedShortcutBinding {
  id: string;
  currentShortcut: string;
}

const NO_ADDITIONAL_SHORTCUTS: readonly FocusedShortcutBinding[] = [];

function shouldIgnoreFocusedShortcutEvent(event: KeyboardEvent): boolean {
  return event.repeat || isEditableEventTarget(event.target);
}

function findMatchedFocusedShortcut(
  event: KeyboardEvent,
  shortcuts: ReturnType<typeof useSettingsStore.getState>['settings']['shortcuts'],
  additionalShortcuts: readonly FocusedShortcutBinding[]
): FocusedShortcutBinding | undefined {
  return additionalShortcuts.find((shortcut) =>
    matchesShortcutEvent(event, shortcut.currentShortcut)
  ) ?? Object.values(shortcuts).find((shortcut) =>
    matchesShortcutEvent(event, shortcut.currentShortcut)
  );
}

function isPrintScreenShortcut(shortcut: FocusedShortcutBinding): boolean {
  return shortcut.currentShortcut.toLowerCase().includes('printscreen');
}

function shouldDispatchFocusedShortcut(
  event: KeyboardEvent,
  shortcut: FocusedShortcutBinding
): boolean {
  return event.type !== 'keyup' || isPrintScreenShortcut(shortcut);
}

function dispatchFocusedShortcut(event: KeyboardEvent, shortcut: FocusedShortcutBinding): void {
  event.preventDefault();
  void invoke('dispatch_global_shortcut', { id: shortcut.id });
}

export function useFocusedShortcutDispatch(
  additionalShortcuts: readonly FocusedShortcutBinding[] = NO_ADDITIONAL_SHORTCUTS
) {
  const shortcuts = useSettingsStore((s) => s.settings.shortcuts);
  const settingsInitialized = useSettingsStore((s) => s.isInitialized);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    if (!settingsInitialized) {
      void loadSettings();
    }
  }, [settingsInitialized, loadSettings]);

  useEffect(() => {
    const handleFocusedShortcut = (event: KeyboardEvent) => {
      if (shouldIgnoreFocusedShortcutEvent(event)) {
        return;
      }

      const matchedShortcut = findMatchedFocusedShortcut(event, shortcuts, additionalShortcuts);
      if (!matchedShortcut) {
        return;
      }

      // Chromium/WebView2 doesn't deliver `keydown` for PrintScreen — only `keyup`.
      // For PrintScreen-containing shortcuts we accept either event so the
      // webview stays a working fallback when the LL hook misses the press
      // (Windows often swallows WM_KEYDOWN for PrintScreen even at hook level).
      if (!shouldDispatchFocusedShortcut(event, matchedShortcut)) {
        return;
      }

      dispatchFocusedShortcut(event, matchedShortcut);
    };

    window.addEventListener('keydown', handleFocusedShortcut);
    window.addEventListener('keyup', handleFocusedShortcut);
    return () => {
      window.removeEventListener('keydown', handleFocusedShortcut);
      window.removeEventListener('keyup', handleFocusedShortcut);
    };
  }, [additionalShortcuts, shortcuts]);
}
