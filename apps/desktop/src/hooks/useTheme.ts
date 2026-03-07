import { useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settingsStore';
import { settingsLogger } from '@/utils/logger';
import type { Theme } from '@/types';

function prefersDarkMode() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyResolvedTheme(isDark: boolean) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // Disable ALL transitions during theme switch for instant change
  root.style.setProperty('--theme-transition', 'none');
  root.classList.add('no-transitions');

  // Toggle both dark and light classes
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);

  // Re-enable transitions after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-transitions');
      root.style.removeProperty('--theme-transition');
    });
  });
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return prefersDarkMode() ? 'dark' : 'light';
  }

  return theme;
}

export function applyThemeToDocument(theme: Theme) {
  applyResolvedTheme(resolveTheme(theme) === 'dark');
}

export async function initializeThemeFromSettings() {
  const settingsStore = useSettingsStore.getState();
  if (!settingsStore.isInitialized) {
    await settingsStore.loadSettings();
  }

  applyThemeToDocument(useSettingsStore.getState().settings.general.theme);
}

/**
 * Hook for managing app theme (light/dark/system)
 *
 * - Applies theme class to document root
 * - Listens for OS preference changes when theme is 'system'
 * - Persists to settings store
 * - Syncs theme across all windows via Tauri events
 */
export function useTheme() {
  const theme = useSettingsStore((s) => s.settings.general.theme);
  const isInitialized = useSettingsStore((s) => s.isInitialized);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateGeneralSettings = useSettingsStore((s) => s.updateGeneralSettings);
  const isExternalUpdate = useRef(false);

  // Fresh standalone windows start with default settings; load persisted settings
  // so theme resolution does not fall back to the OS preference forever.
  useEffect(() => {
    if (isInitialized || isLoading) return;

    loadSettings().catch((error) => {
      settingsLogger.error('Failed to load settings for theme initialization:', error);
    });
  }, [isInitialized, isLoading, loadSettings]);

  // Apply theme class to document root
  useLayoutEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Listen for system theme changes when theme is 'system'
  useEffect(() => {
    if (
      theme !== 'system'
      || typeof window === 'undefined'
      || typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      applyResolvedTheme(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  // Listen for theme changes from other windows
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ theme: Theme }>('theme-changed', (event) => {
      // Update local state without emitting again
      isExternalUpdate.current = true;
      updateGeneralSettings({ theme: event.payload.theme });
      isExternalUpdate.current = false;
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [updateGeneralSettings]);

  const setTheme = useCallback((newTheme: Theme) => {
    updateGeneralSettings({ theme: newTheme });
    saveSettings().catch((error) => {
      settingsLogger.error('Failed to persist theme change:', error);
    });

    // Emit event to sync other windows (unless this is from an external update)
    if (!isExternalUpdate.current) {
      emit('theme-changed', { theme: newTheme }).catch((e) => settingsLogger.error('Failed to emit theme-changed:', e));
    }
  }, [saveSettings, updateGeneralSettings]);

  // Toggle between light and dark (skips system)
  const toggleTheme = useCallback(() => {
    const isDark = resolveTheme(theme) === 'dark';
    setTheme(isDark ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Get the resolved theme (light or dark, never 'system')
  const resolvedTheme = resolveTheme(theme);

  return { 
    theme,           // The setting value: 'light' | 'dark' | 'system'
    resolvedTheme,   // The actual applied theme: 'light' | 'dark'
    setTheme, 
    toggleTheme 
  };
}
