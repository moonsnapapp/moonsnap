import { create } from 'zustand';
import { emit } from '@tauri-apps/api/event';
import { LazyStore } from '@tauri-apps/plugin-store';
import type {
  CaptureSettings,
  ScreenshotSettings,
  ScreenshotFormat,
  VideoSettings,
  GifSettings,
} from '../types/generated';
import type { CaptureType } from '../types';
import {
  normalizeGifSettings,
  normalizeGifSettingsUpdates,
  normalizeVideoSettings,
  normalizeVideoSettingsUpdates,
} from '@/constants/recording';

/** Source mode for capture selection */
export type CaptureSourceMode = 'display' | 'window' | 'area';

/** What to do after a recording completes */
export type AfterRecordingAction = 'preview' | 'editor' | 'save';
import { createErrorHandler } from '../utils/errorReporting';
import { settingsLogger } from '../utils/logger';

const CAPTURE_SETTINGS_STORE_PATH = 'capture-settings.json';

// Create a lazy store instance (initialized on first access)
let storeInstance: LazyStore | null = null;

async function getStore(): Promise<LazyStore> {
  if (!storeInstance) {
    storeInstance = new LazyStore(CAPTURE_SETTINGS_STORE_PATH);
  }
  return storeInstance;
}

// Default settings
const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
  format: 'png' as ScreenshotFormat,
  jpgQuality: 85,
  includeCursor: true,
};

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  format: 'mp4',
  quality: 80,
  fps: 30,
  maxDurationSecs: null,
  includeCursor: true,
  captureSystemAudio: true,
  systemAudioDeviceId: null,
  microphoneDeviceIndex: null,
  captureWebcam: false, // Placeholder - always false for now
  countdownSecs: 3,
  hideDesktopIcons: false,
  quickCapture: false, // Default to editor flow
};

const DEFAULT_GIF_SETTINGS: GifSettings = {
  qualityPreset: 'balanced',
  fps: 15,
  maxDurationSecs: 30,
  includeCursor: true,
  countdownSecs: 3,
};

const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  screenshot: DEFAULT_SCREENSHOT_SETTINGS,
  video: DEFAULT_VIDEO_SETTINGS,
  gif: DEFAULT_GIF_SETTINGS,
};

export interface AreaSelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedAreaSelection extends AreaSelectionBounds {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const MIN_REUSABLE_AREA_SIZE = 20;
export const MAX_SAVED_AREA_SELECTIONS = 3;

export function normalizeAreaSelection(
  selection: AreaSelectionBounds | null | undefined
): AreaSelectionBounds | null {
  if (!selection) {
    return null;
  }

  const x = Math.round(selection.x);
  const y = Math.round(selection.y);
  const width = Math.round(selection.width);
  const height = Math.round(selection.height);

  if (width < MIN_REUSABLE_AREA_SIZE || height < MIN_REUSABLE_AREA_SIZE) {
    return null;
  }

  return { x, y, width, height };
}

export function isSameAreaSelection(
  left: AreaSelectionBounds | null | undefined,
  right: AreaSelectionBounds | null | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height
  );
}

function createSavedAreaName(savedAreas: SavedAreaSelection[]): string {
  const maxIndex = savedAreas.reduce((currentMax, savedArea) => {
    const match = /^Area\s+(\d+)$/i.exec(savedArea.name.trim());
    if (!match) {
      return currentMax;
    }

    return Math.max(currentMax, Number.parseInt(match[1], 10));
  }, 0);

  return `Area ${maxIndex + 1}`;
}

function createSavedAreaId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `area-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSavedAreaSelections(
  savedAreas: SavedAreaSelection[] | null | undefined
): SavedAreaSelection[] {
  if (!savedAreas || savedAreas.length === 0) {
    return [];
  }

  const normalizedSavedAreas: SavedAreaSelection[] = [];

  for (const savedArea of savedAreas) {
    const normalizedBounds = normalizeAreaSelection(savedArea);
    if (!normalizedBounds) {
      continue;
    }

    const createdAt = savedArea.createdAt || new Date().toISOString();
    normalizedSavedAreas.push({
      ...normalizedBounds,
      id: savedArea.id || createSavedAreaId(),
      name: savedArea.name?.trim() || createSavedAreaName(normalizedSavedAreas),
      createdAt,
      updatedAt: savedArea.updatedAt || createdAt,
    });
  }

  return normalizedSavedAreas.slice(0, MAX_SAVED_AREA_SELECTIONS);
}

interface CaptureSettingsState {
  // Settings data
  settings: CaptureSettings;
  isLoading: boolean;
  isInitialized: boolean;

  // Current active mode
  activeMode: CaptureType;

  // Current source mode (display/window/region)
  sourceMode: CaptureSourceMode;

  // Copy to clipboard after screenshot capture
  copyToClipboardAfterCapture: boolean;

  // Show floating preview panel after screenshot capture
  showPreviewAfterCapture: boolean;

  // What to do after a recording completes
  afterRecordingAction: AfterRecordingAction;

  // Whether to show the recording mode chooser before each video recording
  promptRecordingMode: boolean;

  // Whether to snap the toolbar to the selection area
  snapToolbarToSelection: boolean;

  // Whether to show the toolbar in screen recordings
  showToolbarInRecording: boolean;

  // Reusable area selections for region capture
  lastAreaSelection: AreaSelectionBounds | null;
  savedAreaSelections: SavedAreaSelection[];

  // Actions - Settings management
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  
  // Actions - Source mode
  setSourceMode: (mode: CaptureSourceMode) => void;

  // Actions - Clipboard
  setCopyToClipboardAfterCapture: (value: boolean) => void;

  // Actions - Preview
  setShowPreviewAfterCapture: (value: boolean) => void;

  // Actions - After recording
  setAfterRecordingAction: (action: AfterRecordingAction) => void;
  setPromptRecordingMode: (value: boolean) => void;
  setSnapToolbarToSelection: (value: boolean) => void;
  setShowToolbarInRecording: (value: boolean) => void;
  setLastAreaSelection: (selection: AreaSelectionBounds | null) => void;
  saveAreaSelection: (
    selection: AreaSelectionBounds,
    name?: string
  ) => SavedAreaSelection | null;
  deleteAreaSelection: (id: string) => void;

  // Actions - Mode
  setActiveMode: (mode: CaptureType) => void;

  // Actions - Screenshot settings
  updateScreenshotSettings: (settings: Partial<ScreenshotSettings>) => void;
  resetScreenshotSettings: () => void;

  // Actions - Video settings
  updateVideoSettings: (settings: Partial<VideoSettings>) => void;
  resetVideoSettings: () => void;

  // Actions - GIF settings
  updateGifSettings: (settings: Partial<GifSettings>) => void;
  resetGifSettings: () => void;

  // Actions - Reset all
  resetAllSettings: () => void;
}

export const useCaptureSettingsStore = create<CaptureSettingsState>((set, get) => ({
  settings: { ...DEFAULT_CAPTURE_SETTINGS },
  isLoading: false,
  isInitialized: false,
  activeMode: 'video',
  sourceMode: 'area',
  copyToClipboardAfterCapture: true,
  showPreviewAfterCapture: true,
  afterRecordingAction: 'preview',
  promptRecordingMode: true,
  snapToolbarToSelection: false,
  showToolbarInRecording: false,
  lastAreaSelection: null,
  savedAreaSelections: [],

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const store = await getStore();

      const savedSettings = await store.get<CaptureSettings>('captureSettings');
      const savedActiveMode = await store.get<CaptureType>('activeMode');
      const savedSourceMode = await store.get<CaptureSourceMode>('sourceMode');
      const savedCopyToClipboard = await store.get<boolean>('copyToClipboardAfterCapture');
      const savedShowPreview = await store.get<boolean>('showPreviewAfterCapture');
      const savedAfterRecording = await store.get<AfterRecordingAction>('afterRecordingAction');
      const savedPromptRecordingMode = await store.get<boolean>('promptRecordingMode');
      const savedSnapToolbar = await store.get<boolean>('snapToolbarToSelection');
      const savedShowToolbarInRecording = await store.get<boolean>('showToolbarInRecording');
      const savedLastAreaSelection = await store.get<AreaSelectionBounds>('lastAreaSelection');
      const savedAreaSelections = await store.get<SavedAreaSelection[]>('savedAreaSelections');

      // Merge with defaults (in case new settings were added)
      const settings: CaptureSettings = {
        screenshot: {
          ...DEFAULT_SCREENSHOT_SETTINGS,
          ...savedSettings?.screenshot,
        },
        video: normalizeVideoSettings({
          ...DEFAULT_VIDEO_SETTINGS,
          ...savedSettings?.video,
          // Always ensure webcam is false for now (placeholder)
          captureWebcam: false,
        }),
        gif: normalizeGifSettings({
          ...DEFAULT_GIF_SETTINGS,
          ...savedSettings?.gif,
        }),
      };

      set({
        settings,
        activeMode: savedActiveMode || 'video',
        sourceMode: savedSourceMode || 'area',
        copyToClipboardAfterCapture: savedCopyToClipboard ?? true,
        showPreviewAfterCapture: savedShowPreview ?? true,
        afterRecordingAction: savedAfterRecording ?? 'preview',
        promptRecordingMode: savedPromptRecordingMode ?? true,
        snapToolbarToSelection: savedSnapToolbar ?? false,
        showToolbarInRecording: savedShowToolbarInRecording ?? false,
        lastAreaSelection: normalizeAreaSelection(savedLastAreaSelection),
        savedAreaSelections: normalizeSavedAreaSelections(savedAreaSelections),
        isLoading: false,
        isInitialized: true,
      });
    } catch {
      // Use defaults on error
      set({
        settings: { ...DEFAULT_CAPTURE_SETTINGS },
        activeMode: 'video',
        sourceMode: 'area',
        copyToClipboardAfterCapture: true,
        showPreviewAfterCapture: true,
        afterRecordingAction: 'preview',
        promptRecordingMode: true,
        snapToolbarToSelection: false,
        showToolbarInRecording: false,
        lastAreaSelection: null,
        savedAreaSelections: [],
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  saveSettings: async () => {
    const {
      settings,
      activeMode,
      sourceMode,
      copyToClipboardAfterCapture,
      showPreviewAfterCapture,
      afterRecordingAction,
      promptRecordingMode,
      snapToolbarToSelection,
      showToolbarInRecording,
      lastAreaSelection,
      savedAreaSelections,
    } = get();
    try {
      const store = await getStore();
      await store.set('captureSettings', settings);
      await store.set('activeMode', activeMode);
      await store.set('sourceMode', sourceMode);
      await store.set('copyToClipboardAfterCapture', copyToClipboardAfterCapture);
      await store.set('showPreviewAfterCapture', showPreviewAfterCapture);
      await store.set('afterRecordingAction', afterRecordingAction);
      await store.set('promptRecordingMode', promptRecordingMode);
      await store.set('snapToolbarToSelection', snapToolbarToSelection);
      await store.set('showToolbarInRecording', showToolbarInRecording);
      await store.set('lastAreaSelection', lastAreaSelection);
      await store.set('savedAreaSelections', savedAreaSelections);
      await store.save();
      // Notify other windows to reload capture settings
      await emit('capture-settings-changed');
    } catch (error) {
      settingsLogger.error('Failed to save capture settings:', error);
      throw error;
    }
  },

  setActiveMode: (mode) => {
    set({ activeMode: mode });
    // Auto-save when mode changes
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setSourceMode: (mode) => {
    set({ sourceMode: mode });
    // Auto-save when source mode changes
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setCopyToClipboardAfterCapture: (value) => {
    set({ copyToClipboardAfterCapture: value });
    // Auto-save when clipboard setting changes
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setShowPreviewAfterCapture: (value) => {
    set({ showPreviewAfterCapture: value });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setAfterRecordingAction: (action) => {
    set({ afterRecordingAction: action });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setPromptRecordingMode: (value) => {
    set({ promptRecordingMode: value });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setSnapToolbarToSelection: (value) => {
    set({ snapToolbarToSelection: value });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setShowToolbarInRecording: (value) => {
    set({ showToolbarInRecording: value });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  setLastAreaSelection: (selection) => {
    set({ lastAreaSelection: normalizeAreaSelection(selection) });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  saveAreaSelection: (selection, name) => {
    const normalizedSelection = normalizeAreaSelection(selection);
    if (!normalizedSelection) {
      return null;
    }

    let savedAreaSelection: SavedAreaSelection | null = null;

    set((state) => {
      const now = new Date().toISOString();
      const existingSelection = state.savedAreaSelections.find((savedArea) =>
        isSameAreaSelection(savedArea, normalizedSelection)
      );

      if (existingSelection) {
        savedAreaSelection = {
          ...existingSelection,
          updatedAt: now,
        };

        return {
          lastAreaSelection: normalizedSelection,
          savedAreaSelections: [
            savedAreaSelection,
            ...state.savedAreaSelections.filter((savedArea) => savedArea.id !== existingSelection.id),
          ],
        };
      }

      savedAreaSelection = {
        ...normalizedSelection,
        id: createSavedAreaId(),
        name: name?.trim() || createSavedAreaName(state.savedAreaSelections),
        createdAt: now,
        updatedAt: now,
      };

      const savedAreaSelections =
        state.savedAreaSelections.length >= MAX_SAVED_AREA_SELECTIONS
          ? state.savedAreaSelections
              .slice(0, MAX_SAVED_AREA_SELECTIONS - 1)
          : state.savedAreaSelections;

      return {
        lastAreaSelection: normalizedSelection,
        savedAreaSelections: [savedAreaSelection, ...savedAreaSelections],
      };
    });

    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );

    return savedAreaSelection;
  },

  deleteAreaSelection: (id) => {
    set((state) => ({
      savedAreaSelections: state.savedAreaSelections.filter((savedArea) => savedArea.id !== id),
    }));
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  updateScreenshotSettings: (updates) => {
    set((state) => ({
      settings: {
        ...state.settings,
        screenshot: {
          ...state.settings.screenshot,
          ...updates,
        },
      },
    }));
    // Auto-save on change
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  resetScreenshotSettings: () => {
    set((state) => ({
      settings: {
        ...state.settings,
        screenshot: { ...DEFAULT_SCREENSHOT_SETTINGS },
      },
    }));
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  updateVideoSettings: (updates) => {
    const normalizedUpdates = normalizeVideoSettingsUpdates(updates);

    set((state) => ({
      settings: {
        ...state.settings,
        video: {
          ...state.settings.video,
          ...normalizedUpdates,
          // Always ensure webcam is false for now (placeholder)
          captureWebcam: false,
        },
      },
    }));
    // Auto-save on change
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  resetVideoSettings: () => {
    set((state) => ({
      settings: {
        ...state.settings,
        video: { ...DEFAULT_VIDEO_SETTINGS },
      },
    }));
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  updateGifSettings: (updates) => {
    const validated = normalizeGifSettingsUpdates(updates);

    set((state) => ({
      settings: {
        ...state.settings,
        gif: {
          ...state.settings.gif,
          ...validated,
        },
      },
    }));
    // Auto-save on change
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  resetGifSettings: () => {
    set((state) => ({
      settings: {
        ...state.settings,
        gif: { ...DEFAULT_GIF_SETTINGS },
      },
    }));
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },

  resetAllSettings: () => {
    set({
      settings: { ...DEFAULT_CAPTURE_SETTINGS },
      activeMode: 'video',
      sourceMode: 'area',
      copyToClipboardAfterCapture: true,
      showPreviewAfterCapture: true,
      afterRecordingAction: 'preview',
      promptRecordingMode: true,
      snapToolbarToSelection: false,
      showToolbarInRecording: false,
    });
    get().saveSettings().catch(
      createErrorHandler({ operation: 'save capture settings', silent: true })
    );
  },
}));

// Selector for current mode's settings
export const useCurrentModeSettings = () => {
  const activeMode = useCaptureSettingsStore((state) => state.activeMode);
  const settings = useCaptureSettingsStore((state) => state.settings);

  switch (activeMode) {
    case 'screenshot':
      return { mode: activeMode, settings: settings.screenshot };
    case 'video':
      return { mode: activeMode, settings: settings.video };
    case 'gif':
      return { mode: activeMode, settings: settings.gif };
    default:
      return { mode: activeMode, settings: settings.video };
  }
};

// Selector for screenshot settings
export const useScreenshotSettings = () => {
  return useCaptureSettingsStore((state) => state.settings.screenshot);
};

// Selector for video settings
export const useVideoSettings = () => {
  return useCaptureSettingsStore((state) => state.settings.video);
};

// Selector for GIF settings
export const useGifSettings = () => {
  return useCaptureSettingsStore((state) => state.settings.gif);
};

// Selector for source mode
export const useSourceMode = () => {
  return useCaptureSettingsStore((state) => state.sourceMode);
};

// Selector for copy to clipboard setting
export const useCopyToClipboardAfterCapture = () => {
  return useCaptureSettingsStore((state) => state.copyToClipboardAfterCapture);
};
