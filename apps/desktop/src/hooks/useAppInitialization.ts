/**
 * App Initialization Hook
 *
 * Consolidates startup effects from App.tsx:
 * - Load captures on mount
 * - Run startup cleanup (orphan files, missing thumbnails)
 * - Initialize settings and register global shortcuts
 * - Sync recording state on window focus
 *
 * Extracted to reduce App.tsx complexity while maintaining identical behavior.
 */

import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCaptureStore } from '../stores/captureStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLicenseStore } from '../stores/licenseStore';
import { useVideoRecordingStore } from '../stores/videoRecordingStore';
import { initializeShortcutRegistration } from '../utils/hotkeyManager';
import { createErrorHandler } from '../utils/errorReporting';
import { settingsLogger } from '../utils/logger';

/**
 * Hook that handles all app initialization effects.
 * Must be called once at the app root level.
 */
export function useAppInitialization() {
  const { loadCaptures, restoreEditorSession } = useCaptureStore();

  // Restore editor session and load captures on mount
  useEffect(() => {
    const init = async () => {
      // Try to restore editor session first (F5 refresh persistence)
      const restored = await restoreEditorSession();
      
      // Always load captures for library (in background if editor restored)
      if (!restored) {
        await loadCaptures();
      } else {
        // Load captures in background for when user returns to library
        loadCaptures();
      }
    };
    init();
  }, [loadCaptures, restoreEditorSession]);

  // Run startup cleanup (orphan temp files, missing thumbnails)
  useEffect(() => {
    invoke('startup_cleanup').catch(
      createErrorHandler({ operation: 'startup cleanup', silent: true })
    );
  }, []);

  // Initialize settings and register shortcuts (non-blocking)
  useEffect(() => {
    // Defer heavy initialization to after first paint for responsive UI
    const initSettings = async () => {
      try {
        const { loadSettings } = useSettingsStore.getState();
        await loadSettings();

        // Run backend sync, shortcut registration, and license check in parallel
        const updatedSettings = useSettingsStore.getState().settings;
        await Promise.allSettled([
          invoke('set_close_to_tray', { enabled: updatedSettings.general.minimizeToTray }),
          initializeShortcutRegistration(),
          useLicenseStore.getState().fetchStatus(),
        ]);
      } catch (error) {
        settingsLogger.error('Failed to initialize settings:', error);
      }
    };

    // Hidden startup windows can starve requestIdleCallback and delay shortcut
    // registration indefinitely. Run immediately when hidden; otherwise defer.
    if (document.visibilityState === 'hidden') {
      void initSettings();
      return;
    }

    if ('requestIdleCallback' in window) {
      (window as typeof window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => {
        void initSettings();
      });
    } else {
      setTimeout(() => {
        void initSettings();
      }, 0);
    }
  }, []);

  // Sync recording state with backend on window focus
  // This handles edge cases where frontend/backend state may drift
  useEffect(() => {
    const handleFocus = () => {
      useVideoRecordingStore.getState().refreshStatus();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);
}
