import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import { LAYOUT } from '@/constants/layout';
import type { SelectionBounds } from '@/hooks/useSelectionEvents';
import {
  useCaptureSettingsStore,
  type AfterRecordingAction,
} from '@/stores/captureSettingsStore';
import { useWebcamSettingsStore } from '@/stores/webcamSettingsStore';
import type { CaptureType, RecordingState } from '@/types';
import { logger } from '@/utils/logger';
import {
  getSelectionMonitor,
  getSnappedRecordingHudAnchor,
  type RecordingHudAnchor,
} from '@/windows/recordingHudAnchor';
import { startRecordingCaptureFlow } from '@/windows/recordingStartFlow';

const QUICK_RECORDING_OWNER = 'quick-recording';

interface QuickRecordingSelectionPayload extends SelectionBounds {
  captureType?: CaptureType;
}

interface QuickRecordingModeSelectedPayload {
  x: number;
  y: number;
  action: AfterRecordingAction;
  remember: boolean;
  owner?: string;
}

interface QuickRecordingModeChooserBackPayload {
  owner?: string;
}

function getQuickRecordingCaptureType(
  selection: QuickRecordingSelectionPayload
): Extract<CaptureType, 'video' | 'gif'> {
  return selection.captureType === 'gif' ? 'gif' : 'video';
}

async function resolveQuickRecordingHudAnchor(
  selection: QuickRecordingSelectionPayload
): Promise<RecordingHudAnchor> {
  const monitors = await availableMonitors();
  const selectionMonitor = getSelectionMonitor(monitors, selection);
  const { snapToolbarToSelection } = useCaptureSettingsStore.getState();

  if (snapToolbarToSelection) {
    return getSnappedRecordingHudAnchor(selection, selectionMonitor ?? monitors[0]);
  }

  const existingToolbar = await WebviewWindow.getByLabel('capture-toolbar');
  if (existingToolbar) {
    const [position, size] = await Promise.all([
      existingToolbar.outerPosition(),
      existingToolbar.outerSize(),
    ]);

    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  }

  const monitor = selectionMonitor ?? monitors[0];

  if (!monitor) {
    return {
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height,
      centerOnSelection: true,
    };
  }

  const minX = monitor.position.x + LAYOUT.FLOATING_WINDOW_EDGE_MARGIN;
  const maxX =
    monitor.position.x +
    monitor.size.width -
    LAYOUT.RECORDING_HUD_WIDTH -
    LAYOUT.FLOATING_WINDOW_EDGE_MARGIN;
  const centeredX =
    monitor.position.x + Math.floor((monitor.size.width - LAYOUT.RECORDING_HUD_WIDTH) / 2);
  const x = maxX >= minX ? Math.min(Math.max(centeredX, minX), maxX) : monitor.position.x;

  const minY = monitor.position.y + LAYOUT.FLOATING_WINDOW_EDGE_MARGIN;
  const maxY =
    monitor.position.y +
    monitor.size.height -
    LAYOUT.RECORDING_HUD_HEIGHT -
    LAYOUT.FLOATING_WINDOW_EDGE_MARGIN;
  const preferredY =
    monitor.position.y +
    monitor.size.height -
    LAYOUT.RECORDING_HUD_HEIGHT -
    LAYOUT.FLOATING_WINDOW_BOTTOM_OFFSET;
  const y = maxY >= minY ? Math.min(Math.max(preferredY, minY), maxY) : monitor.position.y;

  return {
    x,
    y,
    width: LAYOUT.RECORDING_HUD_WIDTH,
    height: LAYOUT.RECORDING_HUD_HEIGHT,
  };
}

export function useQuickRecordingFlow() {
  const pendingSelectionRef = useRef<QuickRecordingSelectionPayload | null>(null);
  const quickSessionActiveRef = useRef(false);
  const recordingStartupInProgressRef = useRef(false);
  const chooserSelectionHandledRef = useRef(false);

  const resetQuickFlowState = useCallback(() => {
    pendingSelectionRef.current = null;
    quickSessionActiveRef.current = false;
    recordingStartupInProgressRef.current = false;
    chooserSelectionHandledRef.current = false;
  }, []);

  const cleanupQuickRecordingUi = useCallback(async () => {
    await Promise.all([
      invoke('close_recording_controls').catch(() => {}),
      invoke('hide_recording_border').catch(() => {}),
      invoke('hide_countdown_window').catch(() => {}),
      invoke('close_recording_mode_chooser').catch(() => {}),
      invoke('restore_main_window').catch(() => {}),
      useWebcamSettingsStore.getState().closePreview().catch(() => {}),
    ]);
  }, []);

  const startQuickRecording = useCallback(
    async (
      selection: QuickRecordingSelectionPayload,
      hudAnchor: RecordingHudAnchor
    ) => {
      if (recordingStartupInProgressRef.current) {
        return;
      }

      recordingStartupInProgressRef.current = true;
      quickSessionActiveRef.current = true;

      try {
        await startRecordingCaptureFlow({
          captureType: getQuickRecordingCaptureType(selection),
          selection,
          hudAnchor,
          prepareRecording: true,
          onBeforeOverlayConfirm: async () => {
            await invoke('close_capture_toolbar').catch(() => {});
          },
        });
        recordingStartupInProgressRef.current = false;
      } catch (error) {
        logger.error('Failed to start quick recording flow:', error);
        resetQuickFlowState();
        await cleanupQuickRecordingUi();
        await invoke('capture_overlay_cancel').catch(() => {});
      }
    },
    [cleanupQuickRecordingUi, resetQuickFlowState]
  );

  useEffect(() => {
    const unlistenQuickSelection = listen<QuickRecordingSelectionPayload>(
      'quick-recording-selection-ready',
      (event) => {
        void (async () => {
          const selection = event.payload;
          const captureSettingsStore = useCaptureSettingsStore.getState();

          if (!captureSettingsStore.isInitialized) {
            await captureSettingsStore.loadSettings();
          }

          if (
            selection.captureType &&
            captureSettingsStore.activeMode !== selection.captureType
          ) {
            captureSettingsStore.setActiveMode(selection.captureType);
          }

          if (
            selection.sourceMode &&
            captureSettingsStore.sourceMode !== selection.sourceMode
          ) {
            captureSettingsStore.setSourceMode(selection.sourceMode);
          }

          pendingSelectionRef.current = selection;
          quickSessionActiveRef.current = false;
          recordingStartupInProgressRef.current = false;
          chooserSelectionHandledRef.current = false;

          await invoke('close_capture_toolbar').catch(() => {});

          if (
            getQuickRecordingCaptureType(selection) === 'video' &&
            captureSettingsStore.promptRecordingMode
          ) {
            await invoke('show_recording_mode_chooser', {
              x: selection.x,
              y: selection.y,
              width: selection.width,
              height: selection.height,
              owner: QUICK_RECORDING_OWNER,
              allowDrag: selection.sourceType === 'area',
            });
            return;
          }

          const hudAnchor = await resolveQuickRecordingHudAnchor(selection);
          await startQuickRecording(selection, hudAnchor);
        })();
      }
    );

    const unlistenSelectionUpdated = listen<SelectionBounds>('selection-updated', (event) => {
      if (recordingStartupInProgressRef.current || quickSessionActiveRef.current) {
        return;
      }

      const pendingSelection = pendingSelectionRef.current;
      if (!pendingSelection) {
        return;
      }

      const { x, y, width, height } = event.payload;
      if (width <= 0 || height <= 0) {
        return;
      }

      pendingSelectionRef.current = {
        ...pendingSelection,
        x,
        y,
        width,
        height,
      };
    });

    const unlistenSelected = listen<QuickRecordingModeSelectedPayload>(
      'recording-mode-selected',
      (event) => {
        if (event.payload.owner !== QUICK_RECORDING_OWNER) {
          return;
        }

        if (chooserSelectionHandledRef.current) {
          return;
        }

        const selection = pendingSelectionRef.current;
        if (!selection) {
          return;
        }

        chooserSelectionHandledRef.current = true;

        void (async () => {
          const captureSettingsStore = useCaptureSettingsStore.getState();
          captureSettingsStore.setAfterRecordingAction(event.payload.action);
          if (event.payload.remember) {
            captureSettingsStore.setPromptRecordingMode(false);
          }

          const hudAnchor = await resolveQuickRecordingHudAnchor(selection);
          await startQuickRecording(selection, hudAnchor);
        })();
      }
    );

    const unlistenBack = listen<QuickRecordingModeChooserBackPayload>(
      'recording-mode-chooser-back',
      (event) => {
        if (event.payload.owner !== QUICK_RECORDING_OWNER) {
          return;
        }

        resetQuickFlowState();
        invoke('capture_overlay_cancel_to_startup').catch((error) => {
          logger.error('Failed to cancel quick recording overlay from chooser back:', error);
        });
      }
    );

    const unlistenRecordingState = listen<RecordingState>(
      'recording-state-changed',
      (event) => {
        if (!quickSessionActiveRef.current) {
          return;
        }

        if (
          event.payload.status !== 'idle' &&
          event.payload.status !== 'completed' &&
          event.payload.status !== 'error'
        ) {
          return;
        }

        quickSessionActiveRef.current = false;
        recordingStartupInProgressRef.current = false;
        chooserSelectionHandledRef.current = false;
        pendingSelectionRef.current = null;

        void cleanupQuickRecordingUi();
      }
    );

    return () => {
      unlistenQuickSelection.then((fn) => fn()).catch(() => {});
      unlistenSelectionUpdated.then((fn) => fn()).catch(() => {});
      unlistenSelected.then((fn) => fn()).catch(() => {});
      unlistenBack.then((fn) => fn()).catch(() => {});
      unlistenRecordingState.then((fn) => fn()).catch(() => {});
    };
  }, [cleanupQuickRecordingUi, resetQuickFlowState, startQuickRecording]);
}
