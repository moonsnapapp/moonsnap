/**
 * Settings Migration System
 *
 * Handles versioned migrations for app settings to gracefully handle
 * breaking changes without losing user preferences.
 *
 * To add a new migration:
 * 1. Increment SETTINGS_VERSION
 * 2. Add a migration function for the previous version
 * 3. The migration function receives settings of version N and returns version N+1
 */

import { DEFAULT_GENERAL_SETTINGS, DEFAULT_SHORTCUTS } from '../types';
import type { AppSettings, GeneralSettings, ShortcutConfig } from '../types';
import { settingsLogger } from './logger';

// Current settings schema version - increment when making breaking changes
export const SETTINGS_VERSION = 2;

// Type for raw settings from storage (may be any version)
interface RawSettings {
  _version?: number;
  shortcuts?: Record<string, Partial<ShortcutConfig>>;
  general?: Partial<GeneralSettings>;
  [key: string]: unknown;
}

// Migration function type: takes settings of version N, returns settings of version N+1
type Migration = (settings: RawSettings) => RawSettings;

// Migration registry: version -> function that migrates TO that version
const migrations: Record<number, Migration> = {
  // Version 0 -> 1: Initial migration (no changes, just add version tracking)
  1: (settings) => ({
    ...settings,
    _version: 1,
  }),

  // Version 1 -> 2: PrintScreen defaults shifted to add Ctrl prefix so Windows
  // is less likely to intercept the bare key (Snipping Tool). Only rewrite
  // shortcuts that still hold the previous default — leave user customizations.
  2: (settings) => {
    const shortcuts = { ...(settings.shortcuts ?? {}) };
    const remap: Record<string, { from: string; to: string }> = {
      new_capture: { from: 'PrintScreen', to: 'Ctrl+PrintScreen' },
      all_monitors_capture: { from: 'Ctrl+PrintScreen', to: 'Ctrl+Shift+PrintScreen' },
    };
    for (const [id, { from, to }] of Object.entries(remap)) {
      const current = shortcuts[id]?.currentShortcut;
      if (current === undefined || current === from) {
        shortcuts[id] = { ...shortcuts[id], currentShortcut: to };
      }
    }
    return { ...settings, shortcuts, _version: 2 };
  },
};

/**
 * Apply all necessary migrations to bring settings up to current version.
 *
 * @param rawSettings - Settings loaded from storage (any version)
 * @returns Migrated settings at current version
 */
export function migrateSettings(rawSettings: RawSettings | null): RawSettings {
  if (!rawSettings) {
    return { _version: SETTINGS_VERSION };
  }

  let settings = { ...rawSettings };
  let version = settings._version ?? 0;

  // Apply migrations sequentially until we reach current version
  while (version < SETTINGS_VERSION) {
    const nextVersion = version + 1;
    const migrate = migrations[nextVersion];

    if (!migrate) {
      settingsLogger.warn(`No migration found for version ${nextVersion}`);
      // Skip to next version and hope for the best
      version = nextVersion;
      continue;
    }

    settingsLogger.info(`Migrating settings from v${version} to v${nextVersion}`);
    settings = migrate(settings);
    version = settings._version ?? nextVersion;
  }

  return settings;
}

/**
 * Merge migrated settings with current defaults to ensure all fields exist.
 *
 * @param settings - Migrated settings
 * @returns Complete AppSettings with all fields
 */
export function mergeWithDefaults(settings: RawSettings): AppSettings {
  // Merge shortcuts with defaults
  const shortcuts: Record<string, ShortcutConfig> = { ...DEFAULT_SHORTCUTS };
  if (settings.shortcuts) {
    for (const [id, config] of Object.entries(settings.shortcuts)) {
      if (shortcuts[id] && config) {
        shortcuts[id] = {
          ...shortcuts[id],
          currentShortcut: config.currentShortcut ?? shortcuts[id].currentShortcut,
          useHook: config.useHook ?? shortcuts[id].useHook,
          status: 'pending', // Always reset status on load
        };
      }
    }
  }

  // Merge general settings with defaults
  const general: GeneralSettings = {
    ...DEFAULT_GENERAL_SETTINGS,
    ...settings.general,
  };

  return { shortcuts, general };
}

/**
 * Check if settings need migration.
 *
 * @param settings - Raw settings from storage
 * @returns true if settings version is older than current
 */
export function needsMigration(settings: RawSettings | null): boolean {
  if (!settings) return false;
  const version = settings._version ?? 0;
  return version < SETTINGS_VERSION;
}
