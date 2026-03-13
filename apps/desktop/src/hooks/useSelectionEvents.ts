/**
 * useSelectionEvents - Listens for selection updates from the capture overlay.
 *
 * Handles:
 * - selection-updated: Region bounds changed (resize/move)
 * - confirm-selection: User confirmed selection (from preselection flow)
 */

import { useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { type Monitor, availableMonitors } from '@tauri-apps/api/window';
import type { CaptureType } from '@/types';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { toolbarLogger } from '@/utils/logger';

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  captureType?: CaptureType;
  autoStartRecording?: boolean;
  sourceMode?: 'display' | 'window' | 'area';
  sourceType?: 'area' | 'window' | 'display';
  windowId?: number | null;
  sourceTitle?: string | null;
  monitorName?: string | null;
  monitorIndex?: number | null;
}

const DEFAULT_BOUNDS: SelectionBounds = { x: 0, y: 0, width: 0, height: 0 };

interface UseSelectionEventsReturn {
  selectionBounds: SelectionBounds;
  selectionBoundsRef: React.MutableRefObject<SelectionBounds>;
  selectionConfirmed: boolean;
  setSelectionConfirmed: (confirmed: boolean) => void;
  autoStartRecording: boolean;
  setAutoStartRecording: (enabled: boolean) => void;
}

const MARGIN = 8;

export async function repositionToolbar(selection: SelectionBounds): Promise<void> {
  const currentWindow = getCurrentWebviewWindow();
  const outerSize = await currentWindow.outerSize();
  const toolbarWidth = outerSize.width;
  const toolbarHeight = outerSize.height;

  const monitors = await availableMonitors();
  const selectionCenterX = selection.x + selection.width / 2;
  const selectionCenterY = selection.y + selection.height / 2;

  const currentMonitor = monitors.find((m: Monitor) => {
    const pos = m.position;
    const size = m.size;
    return (
      selectionCenterX >= pos.x &&
      selectionCenterX < pos.x + size.width &&
      selectionCenterY >= pos.y &&
      selectionCenterY < pos.y + size.height
    );
  });

  const centeredX = Math.floor(selectionCenterX - toolbarWidth / 2);
  const belowY = selection.y + selection.height + MARGIN;
  const aboveY = selection.y - toolbarHeight - MARGIN;

  const fitsInMonitor = (x: number, y: number, monitor: Monitor): boolean => {
    const pos = monitor.position;
    const size = monitor.size;
    return (
      x >= pos.x + MARGIN &&
      x + toolbarWidth <= pos.x + size.width - MARGIN &&
      y >= pos.y + MARGIN &&
      y + toolbarHeight <= pos.y + size.height - MARGIN
    );
  };

  const clampToMonitor = (x: number, y: number, monitor: Monitor): { x: number; y: number } => {
    const pos = monitor.position;
    const size = monitor.size;
    return {
      x: Math.max(pos.x + MARGIN, Math.min(x, pos.x + size.width - MARGIN - toolbarWidth)),
      y: Math.max(pos.y + MARGIN, Math.min(y, pos.y + size.height - MARGIN - toolbarHeight)),
    };
  };

  let finalPos = { x: centeredX, y: belowY };

  if (currentMonitor) {
    if (fitsInMonitor(centeredX, belowY, currentMonitor)) {
      finalPos = { x: centeredX, y: belowY };
    } else if (fitsInMonitor(centeredX, aboveY, currentMonitor)) {
      finalPos = { x: centeredX, y: aboveY };
    } else {
      finalPos = clampToMonitor(centeredX, belowY, currentMonitor);
    }
  } else if (monitors.length > 0) {
    finalPos = clampToMonitor(centeredX, belowY, monitors[0]);
  }

  await invoke('set_capture_toolbar_position', {
    x: finalPos.x,
    y: finalPos.y,
  });
}

export function useSelectionEvents(): UseSelectionEventsReturn {
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds>(DEFAULT_BOUNDS);
  const selectionBoundsRef = useRef<SelectionBounds>(DEFAULT_BOUNDS);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [autoStartRecording, setAutoStartRecording] = useState(false);

  useEffect(() => {
    let unlistenSelection: UnlistenFn | null = null;

    const setup = async () => {
      unlistenSelection = await listen<SelectionBounds>('selection-updated', (event) => {
        const bounds = event.payload;
        setSelectionBounds(bounds);
        selectionBoundsRef.current = bounds;
      });
    };

    void setup();

    return () => {
      unlistenSelection?.();
    };
  }, []);

  useEffect(() => {
    let unlistenConfirm: UnlistenFn | null = null;
    let unlistenReset: UnlistenFn | null = null;

    const setup = async () => {
      unlistenConfirm = await listen<SelectionBounds>('confirm-selection', async (event) => {
        const bounds = event.payload;
        setSelectionBounds(bounds);
        selectionBoundsRef.current = bounds;

        const captureSettingsStore = useCaptureSettingsStore.getState();

        if (bounds.captureType && captureSettingsStore.activeMode !== bounds.captureType) {
          captureSettingsStore.setActiveMode(bounds.captureType);
        }

        if (bounds.sourceMode && captureSettingsStore.sourceMode !== bounds.sourceMode) {
          captureSettingsStore.setSourceMode(bounds.sourceMode);
        }

        const effectiveMode = bounds.captureType ?? captureSettingsStore.activeMode;
        if (effectiveMode !== 'screenshot') {
          const format = effectiveMode === 'gif' ? 'gif' : 'mp4';
          const preparePromise = invoke('prepare_recording', { format }).catch((e) => {
            toolbarLogger.warn('Failed to prepare recording:', e);
          });

          if (bounds.autoStartRecording) {
            await preparePromise;
          }
        }

        // With snapping disabled, preserve current toolbar window position.
        // With snapping enabled, placement is handled by existing create/show paths.

        setSelectionConfirmed(true);

        // Keep the auto-start latch false until preparation completes.
        // CaptureToolbarWindow watches this flag and immediately calls handleCapture()
        // for tray quick-record sessions; flipping it earlier regresses back to the
        // manual selection toolbar because recording starts before setup is ready.
        setAutoStartRecording(Boolean(bounds.autoStartRecording));
      });

      unlistenReset = await listen('reset-to-startup', () => {
        setSelectionConfirmed(false);
        setAutoStartRecording(false);
        setSelectionBounds(DEFAULT_BOUNDS);
        selectionBoundsRef.current = DEFAULT_BOUNDS;
      });
    };

    void setup();

    return () => {
      unlistenConfirm?.();
      unlistenReset?.();
    };
  }, []);

  return {
    selectionBounds,
    selectionBoundsRef,
    selectionConfirmed,
    setSelectionConfirmed,
    autoStartRecording,
    setAutoStartRecording,
  };
}
