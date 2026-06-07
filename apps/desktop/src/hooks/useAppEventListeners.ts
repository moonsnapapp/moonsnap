/**
 * Consolidated event listeners for App.tsx
 *
 * Groups multiple Tauri event listeners into a single hook to:
 * - Reduce the number of useEffect hooks in App.tsx
 * - Ensure consistent cleanup patterns
 * - Centralize event handling logic
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useSettingsStore, type SettingsSection } from '../stores/settingsStore';
import { useCaptureSettingsStore } from '../stores/captureSettingsStore';
import type { CaptureType } from '../types';
import { libraryLogger } from '../utils/logger';

interface ThumbnailReadyEvent {
  captureId: string;
  thumbnailPath: string;
}

interface RecordingCompleteData {
  outputPath: string;
  durationSecs: number;
  fileSizeBytes: number;
}

interface CreateCaptureToolbarEvent {
  x: number;
  y: number;
  width: number;
  height: number;
  captureType?: CaptureType;
  autoStartRecording?: boolean;
  sourceType?: 'area' | 'window' | 'display';
  windowId?: number | null;
  sourceTitle?: string | null;
  monitorIndex?: number | null;
  monitorName?: string | null;
  nativeControls?: boolean;
}

interface AppEventCallbacks {
  /** Called when a recording completes - should refresh the library */
  onRecordingComplete: (data: RecordingCompleteData) => void;
  /** Called when a thumbnail is generated for a capture */
  onThumbnailReady: (captureId: string, thumbnailPath: string) => void;
  /** Called when a fast capture completes (file path) */
  onCaptureCompleteFast: (data: {
    file_path: string;
    width: number;
    height: number;
  }) => Promise<void>;
  /** Called when a capture is deleted from editor window - refresh library */
  onCaptureDeleted: () => void;
}

function getCaptureSourceMode(sourceType: CreateCaptureToolbarEvent['sourceType']) {
  return sourceType ?? 'area';
}

async function ensureCaptureSettingsLoaded() {
  const captureSettingsStore = useCaptureSettingsStore.getState();
  if (!captureSettingsStore.isInitialized) {
    await captureSettingsStore.loadSettings();
  }
}

function shouldCenterExistingToolbar({
  autoStartRecording,
  sourceType,
}: CreateCaptureToolbarEvent) {
  return (
    !autoStartRecording &&
    (sourceType === 'display' || sourceType === 'window')
  );
}

async function centerToolbarOnSelection(
  existing: WebviewWindow,
  { x, y, width, height }: CreateCaptureToolbarEvent
) {
  const outerSize = await existing.outerSize();
  const toolbarX = Math.floor(x + width / 2 - outerSize.width / 2);
  const toolbarY = Math.floor(y + (height - outerSize.height) / 2);
  await invoke('set_capture_toolbar_position', { x: toolbarX, y: toolbarY });
}

async function showExistingToolbarIfNeeded(
  existing: WebviewWindow,
  { autoStartRecording, nativeControls }: CreateCaptureToolbarEvent
) {
  if (autoStartRecording || nativeControls) return;

  await existing.show();
  await existing.setFocus();
}

async function updateExistingCaptureToolbar(
  existing: WebviewWindow,
  payload: CreateCaptureToolbarEvent
) {
  await existing.hide();

  if (shouldCenterExistingToolbar(payload)) {
    await centerToolbarOnSelection(existing, payload);
  }

  await existing.emit('confirm-selection', {
    ...payload,
    sourceMode: getCaptureSourceMode(payload.sourceType),
  });
  await showExistingToolbarIfNeeded(existing, payload);
}

async function createCaptureToolbar(payload: CreateCaptureToolbarEvent) {
  await invoke('show_capture_toolbar', {
    ...payload,
    sourceMode: getCaptureSourceMode(payload.sourceType),
    snapToolbarToSelection: false,
  });
}

async function handleCreateCaptureToolbar(payload: CreateCaptureToolbarEvent) {
  await ensureCaptureSettingsLoaded();

  const existing = await WebviewWindow.getByLabel('capture-toolbar');
  if (existing) {
    await updateExistingCaptureToolbar(existing, payload);
    return;
  }

  await createCaptureToolbar(payload);
}

/**
 * Hook that sets up all Tauri event listeners for the main App.
 *
 * Consolidates these listeners:
 * - recording-state-changed: Refresh library on recording complete
 * - thumbnail-ready: Update specific capture's thumbnail when generated
 * - open-settings: Open settings modal from tray
 * - create-capture-toolbar: Create selection toolbar window
 * - capture-complete-fast: Handle screenshot capture (raw RGBA file path)
 * - capture-deleted: Refresh library when capture is deleted from editor
 */
export function useAppEventListeners(callbacks: AppEventCallbacks) {
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    // Recording state changes - refresh library when complete
    unlisteners.push(
      listen<{ status: string; outputPath?: string; durationSecs?: number; fileSizeBytes?: number }>('recording-state-changed', (event) => {
        if (event.payload.status === 'completed') {
          libraryLogger.info('Recording completed, refreshing library...');
          // Small delay to ensure file is fully written
          const t1 = setTimeout(() => {
            callbacks.onRecordingComplete({
              outputPath: event.payload.outputPath ?? '',
              durationSecs: event.payload.durationSecs ?? 0,
              fileSizeBytes: event.payload.fileSizeBytes ?? 0,
            });
          }, 500);
          timeoutIds.push(t1);
        }
      })
    );

    // Thumbnail ready - update specific capture's thumbnail
    unlisteners.push(
      listen<ThumbnailReadyEvent>('thumbnail-ready', (event) => {
        const { captureId, thumbnailPath } = event.payload;
        libraryLogger.info(`Thumbnail ready for ${captureId}`);
        callbacks.onThumbnailReady(captureId, thumbnailPath);
      })
    );

    // Open settings from tray menu, capture toolbar, or other windows.
    const validTabs: ReadonlySet<SettingsSection> = new Set([
      'general',
      'shortcuts',
      'recordings',
      'screenshots',
      'feedback',
      'changelog',
    ]);
    unlisteners.push(
      listen<{ tab?: string }>('open-settings', (event) => {
        const requested = event.payload?.tab;
        const tab = requested && validTabs.has(requested as SettingsSection)
          ? (requested as SettingsSection)
          : undefined;
        useSettingsStore.getState().openSettingsModal(tab);
      })
    );

    // Reload capture settings when changed from another window (e.g. settings)
    unlisteners.push(
      listen('capture-settings-changed', () => {
        import('../stores/captureSettingsStore').then(({ useCaptureSettingsStore }) => {
          useCaptureSettingsStore.getState().loadSettings();
        });
      })
    );

    // Update capture toolbar bounds from D2D overlay
    // If toolbar exists, confirm selection and update; if not, let Rust create it
    unlisteners.push(
      listen<CreateCaptureToolbarEvent>(
        'create-capture-toolbar',
        async (event) => {
          await handleCreateCaptureToolbar(event.payload);
        }
      )
    );

    // Fast capture complete (file path) - show mini preview
    unlisteners.push(
      listen<{ file_path: string; width: number; height: number }>(
        'capture-complete-fast',
        async (event) => {
          try {
            await callbacks.onCaptureCompleteFast(event.payload);
          } catch {
            // Silently fail - the capture is already displayed
          }
        }
      )
    );

    unlisteners.push(
      listen<{
        x: number;
        y: number;
        width: number;
        height: number;
        captureType?: CaptureType;
        sourceType?: 'area';
      }>('area-selection-confirmed', (event) => {
        if (event.payload.captureType !== 'screenshot') {
          return;
        }

        useCaptureSettingsStore.getState().setLastAreaSelection({
          x: event.payload.x,
          y: event.payload.y,
          width: event.payload.width,
          height: event.payload.height,
        });
      })
    );

    // Capture deleted from editor window - refresh library
    unlisteners.push(
      listen<{ projectId: string }>('capture-deleted', () => {
        libraryLogger.info('Capture deleted from editor, refreshing library...');
        callbacks.onCaptureDeleted();
      })
    );

    // Cleanup function
    return () => {
      timeoutIds.forEach(clearTimeout);
      unlisteners.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, [callbacks]);
}
