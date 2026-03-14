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

      event.preventDefault();
      void invoke('dispatch_global_shortcut', { id: matchedShortcut.id });
    };

    window.addEventListener('keydown', handleFocusedShortcut);
    return () => window.removeEventListener('keydown', handleFocusedShortcut);
  }, [shortcuts]);
}
