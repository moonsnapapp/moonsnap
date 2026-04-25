import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { LazyStore } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type {
  AppSettings,
  ShortcutConfig,
  GeneralSettings,
  ShortcutStatus,
} from '../types';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUTS,
  DEFAULT_GENERAL_SETTINGS,
} from '../types';
import {
  SETTINGS_VERSION,
  migrateSettings,
  mergeWithDefaults,
  needsMigration,
} from '../utils/settingsMigrations';
import { createLogger } from '../utils/logger';

const settingsLogger = createLogger('Settings');

const SETTINGS_STORE_PATH = 'settings.json';

// Main library window label — only this window hosts the settings dialog.
const LIBRARY_WINDOW_LABEL = 'library';

export type SettingsSection =
  | 'general'
  | 'shortcuts'
  | 'recordings'
  | 'screenshots'
  | 'feedback'
  | 'changelog'
  | 'license';

// Create a lazy store instance (initialized on first access)
let storeInstance: LazyStore | null = null;
let loadSettingsPromise: Promise<void> | null = null;

async function getStore(): Promise<LazyStore> {
  if (!storeInstance) {
    storeInstance = new LazyStore(SETTINGS_STORE_PATH);
  }
  return storeInstance;
}

interface SettingsState {
  // Settings data
  settings: AppSettings;
  isLoading: boolean;
  isInitialized: boolean;

  // UI state
  settingsModalOpen: boolean;
  activeTab: SettingsSection;

  // Actions - Settings management
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;

  // Actions - Shortcuts
  updateShortcut: (id: string, shortcut: string) => void;
  updateShortcutStatus: (id: string, status: ShortcutStatus, message?: string) => void;
  setShortcutUseHook: (id: string, useHook: boolean) => void;
  resetShortcut: (id: string) => void;
  resetAllShortcuts: () => void;
  getShortcut: (id: string) => ShortcutConfig | undefined;

  // Actions - General settings
  updateGeneralSettings: (settings: Partial<GeneralSettings>) => void;
  resetGeneralSettings: () => void;

  // Actions - UI
  openSettingsModal: (tab?: SettingsSection) => void | Promise<void>;
  closeSettingsModal: () => void;
  setActiveTab: (tab: SettingsSection) => void;
}

/**
 * Main store for application settings including shortcuts and general preferences.
 * Persists to Tauri's LazyStore (settings.json) with automatic migration support.
 *
 * @example
 * ```tsx
 * const { settings, loadSettings, updateShortcut } = useSettingsStore();
 *
 * // Load on app start
 * useEffect(() => { loadSettings(); }, []);
 *
 * // Update a shortcut
 * updateShortcut('region_capture', 'Ctrl+Shift+A');
 * ```
 */
export const useSettingsStore = create<SettingsState>()(
  devtools(
    (set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  isLoading: false,
  isInitialized: false,
  settingsModalOpen: false,
  activeTab: 'general',

  loadSettings: async () => {
    if (loadSettingsPromise) {
      return loadSettingsPromise;
    }

    loadSettingsPromise = (async () => {
      set({ isLoading: true });
      try {
        const store = await getStore();

        // Load raw settings from storage
        const savedShortcuts = await store.get<Record<string, Partial<ShortcutConfig>>>('shortcuts');
        const savedGeneral = await store.get<Partial<GeneralSettings>>('general');
        const savedVersion = await store.get<number>('_version');

        // Build raw settings object for migration
        const rawSettings = {
          _version: savedVersion ?? 0,
          shortcuts: savedShortcuts ?? undefined,
          general: savedGeneral ?? undefined,
        };

        // Apply migrations if needed
        const migratedSettings = migrateSettings(rawSettings);

        // Merge with defaults to ensure all fields exist
        const settings = mergeWithDefaults(migratedSettings);

        // Save migrated settings if version changed
        if (needsMigration(rawSettings)) {
          settingsLogger.info('Settings migrated, saving new version');
          await store.set('_version', SETTINGS_VERSION);
          await store.set('shortcuts', migratedSettings.shortcuts);
          await store.set('general', migratedSettings.general);
          await store.save();
        }

        set({
          settings,
          isLoading: false,
          isInitialized: true,
        });
      } catch {
        // Use defaults on error
        set({
          settings: { ...DEFAULT_SETTINGS },
          isLoading: false,
          isInitialized: true,
        });
      } finally {
        loadSettingsPromise = null;
      }
    })();

    return loadSettingsPromise;
  },

  saveSettings: async () => {
    const { settings } = get();
    const store = await getStore();

    // Only save the user-configurable parts (not status)
    const shortcutsToSave: Record<string, Partial<ShortcutConfig>> = {};
    for (const [id, config] of Object.entries(settings.shortcuts)) {
      shortcutsToSave[id] = {
        currentShortcut: config.currentShortcut,
        useHook: config.useHook,
      };
    }

    // Save version, shortcuts, and general settings
    await store.set('_version', SETTINGS_VERSION);
    await store.set('shortcuts', shortcutsToSave);
    await store.set('general', settings.general);
    await store.save();
  },

  updateShortcut: (id, shortcut) => {
    set((state) => ({
      settings: {
        ...state.settings,
        shortcuts: {
          ...state.settings.shortcuts,
          [id]: {
            ...state.settings.shortcuts[id],
            currentShortcut: shortcut,
            status: 'pending', // Will be updated after registration attempt
          },
        },
      },
    }));
  },

  updateShortcutStatus: (id, status, message) => {
    set((state) => ({
      settings: {
        ...state.settings,
        shortcuts: {
          ...state.settings.shortcuts,
          [id]: {
            ...state.settings.shortcuts[id],
            status,
            // Only retain the message for non-success states.
            statusMessage: status === 'registered' ? undefined : message,
          },
        },
      },
    }));
  },

  setShortcutUseHook: (id, useHook) => {
    set((state) => ({
      settings: {
        ...state.settings,
        shortcuts: {
          ...state.settings.shortcuts,
          [id]: {
            ...state.settings.shortcuts[id],
            useHook,
            status: 'pending', // Will need re-registration
          },
        },
      },
    }));
  },

  resetShortcut: (id) => {
    const defaultConfig = DEFAULT_SHORTCUTS[id];
    if (!defaultConfig) return;

    set((state) => ({
      settings: {
        ...state.settings,
        shortcuts: {
          ...state.settings.shortcuts,
          [id]: {
            ...defaultConfig,
            status: 'pending',
          },
        },
      },
    }));
  },

  resetAllShortcuts: () => {
    const shortcuts: Record<string, ShortcutConfig> = {};
    for (const [id, config] of Object.entries(DEFAULT_SHORTCUTS)) {
      shortcuts[id] = { ...config, status: 'pending' };
    }
    set((state) => ({
      settings: {
        ...state.settings,
        shortcuts,
      },
    }));
  },

  getShortcut: (id) => {
    return get().settings.shortcuts[id];
  },

  updateGeneralSettings: (updates) => {
    set((state) => ({
      settings: {
        ...state.settings,
        general: {
          ...state.settings.general,
          ...updates,
        },
      },
    }));
    // Auto-persist to disk
    get().saveSettings().catch((e) => {
      settingsLogger.error('Failed to persist general settings:', e);
    });
  },

  resetGeneralSettings: () => {
    set((state) => ({
      settings: {
        ...state.settings,
        general: { ...DEFAULT_GENERAL_SETTINGS },
      },
    }));
  },

  openSettingsModal: async (tab = 'general') => {
    // Always update local state — harmless in non-library windows where the
    // dialog isn't rendered, and keeps the call's effect observable from any
    // window's store (and tests).
    set({ activeTab: tab, settingsModalOpen: true });

    // The dialog only renders in the library window. When called from other
    // webviews (e.g. capture toolbar), forward to the library so the dialog
    // actually appears.
    let windowLabel: string | null = null;
    try {
      windowLabel = getCurrentWebviewWindow().label;
    } catch {
      // Outside a Tauri webview (e.g. tests). Skip the forward.
    }

    if (windowLabel && windowLabel !== LIBRARY_WINDOW_LABEL) {
      try {
        await invoke('show_settings_window', { tab });
      } catch (e) {
        settingsLogger.error('Failed to request settings dialog:', e);
      }
    }
  },

  closeSettingsModal: () => {
    set({ settingsModalOpen: false });
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },
}),
    { name: 'SettingsStore', enabled: process.env.NODE_ENV === 'development' }
  )
);

/**
 * Selector for all shortcuts as an array.
 * Useful for rendering shortcuts list in settings UI.
 *
 * @returns Array of all ShortcutConfig objects
 */
export const useShortcutsList = () => {
  const shortcuts = useSettingsStore((state) => state.settings.shortcuts);
  return Object.values(shortcuts);
};

/**
 * Selector for a specific shortcut by ID.
 *
 * @param id - The shortcut identifier (e.g., 'region_capture', 'fullscreen_capture')
 * @returns The ShortcutConfig for the given ID, or undefined if not found
 */
export const useShortcut = (id: string) => {
  return useSettingsStore((state) => state.settings.shortcuts[id]);
};
