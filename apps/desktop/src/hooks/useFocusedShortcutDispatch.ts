import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { useSettingsStore } from '@/stores/settingsStore';
import { isEditableEventTarget, matchesShortcutEvent } from '@/utils/hotkeyManager';

export function useFocusedShortcutDispatch() {
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
      if (event.repeat || isEditableEventTarget(event.target)) {
        return;
      }

      const matchedShortcut = Object.values(shortcuts).find((shortcut) =>
        matchesShortcutEvent(event, shortcut.currentShortcut)
      );

      if (!matchedShortcut) {
        return;
      }

      // Chromium/WebView2 doesn't deliver `keydown` for PrintScreen — only `keyup`.
      // For PrintScreen-containing shortcuts we accept either event so the
      // webview stays a working fallback when the LL hook misses the press
      // (Windows often swallows WM_KEYDOWN for PrintScreen even at hook level).
      const isPrintScreenShortcut = matchedShortcut.currentShortcut
        .toLowerCase()
        .includes('printscreen');
      if (event.type === 'keyup' && !isPrintScreenShortcut) {
        return;
      }

      event.preventDefault();
      void invoke('dispatch_global_shortcut', { id: matchedShortcut.id });
    };

    window.addEventListener('keydown', handleFocusedShortcut);
    window.addEventListener('keyup', handleFocusedShortcut);
    return () => {
      window.removeEventListener('keydown', handleFocusedShortcut);
      window.removeEventListener('keyup', handleFocusedShortcut);
    };
  }, [shortcuts]);
}
