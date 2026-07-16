import type React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { availableMonitors } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ToolbarMode } from '../../components/CaptureToolbar/CaptureToolbar';
import type { CaptureSource } from '../../components/CaptureToolbar/SourceSelector';
import {
  useCaptureSettingsStore,
  type AreaSelectionBounds,
} from '../../stores/captureSettingsStore';
import type { SelectionBounds } from '../../hooks/useSelectionEvents';
import type { CaptureType } from '../../types';
import { toolbarLogger } from '../../utils/logger';
import { getSelectionMonitor, getSnappedRecordingHudAnchor, type RecordingHudAnchor } from '../recordingHudAnchor';
import {
  getOverlayCaptureType,
  getSavedAreaFeedbackMessage,
  type RecordingModeChooserBackPayload,
  type RecordingModeSelectedPayload,
} from './toolbarPolicy';

type CaptureSettingsState = ReturnType<typeof useCaptureSettingsStore.getState>;
type CurrentWebviewWindow = ReturnType<typeof getCurrentWebviewWindow>;

export function showNativeSavedAreaFeedback(replacedOldest: boolean) {
  return invoke('capture_overlay_show_selection_hud_feedback', {
    message: getSavedAreaFeedbackMessage(replacedOldest),
  }).catch((error) => {
    toolbarLogger.warn('Failed to show native saved-area feedback:', error);
  });
}

export interface RecordingModeChooserStateControls {
  chooserSelectionHandledRef: React.MutableRefObject<boolean>;
  recordingStartupInProgressRef: React.MutableRefObject<boolean>;
  chooserRestorePositionRef: React.MutableRefObject<RecordingModeChooserBackPayload | null>;
  chooserAnchorPositionRef: React.MutableRefObject<{ x: number; y: number } | null>;
  skipModePromptRef: React.MutableRefObject<boolean>;
  setIsModeChooserVisible: (value: boolean) => void;
  setIsRecordingControlsPending: (value: boolean) => void;
  setIsRecordingHudActive: (value: boolean) => void;
  setIsRestoringToolbarFromChooser: (value: boolean) => void;
}

export function resetRecordingModeChooserState({
  chooserSelectionHandledRef,
  recordingStartupInProgressRef,
  chooserRestorePositionRef,
  chooserAnchorPositionRef,
  skipModePromptRef,
  setIsModeChooserVisible,
  setIsRecordingControlsPending,
  setIsRecordingHudActive,
  setIsRestoringToolbarFromChooser,
}: RecordingModeChooserStateControls) {
  chooserSelectionHandledRef.current = false;
  recordingStartupInProgressRef.current = false;
  chooserRestorePositionRef.current = null;
  chooserAnchorPositionRef.current = null;
  skipModePromptRef.current = false;
  setIsModeChooserVisible(false);
  setIsRecordingControlsPending(false);
  setIsRecordingHudActive(false);
  setIsRestoringToolbarFromChooser(false);
}

export function handleRecordingModeSelection({
  payload,
  chooserSelectionHandledRef,
  chooserAnchorPositionRef,
  skipModePromptRef,
  handleCaptureRef,
}: {
  payload: RecordingModeSelectedPayload;
  chooserSelectionHandledRef: React.MutableRefObject<boolean>;
  chooserAnchorPositionRef: React.MutableRefObject<{ x: number; y: number } | null>;
  skipModePromptRef: React.MutableRefObject<boolean>;
  handleCaptureRef: React.MutableRefObject<() => void>;
}) {
  if (chooserSelectionHandledRef.current) {
    return;
  }

  chooserSelectionHandledRef.current = true;
  chooserAnchorPositionRef.current = null;
  const store = useCaptureSettingsStore.getState();
  store.setAfterRecordingAction(payload.action);
  if (payload.remember) {
    store.setPromptRecordingMode(false);
  }

  skipModePromptRef.current = true;
  window.setTimeout(() => {
    handleCaptureRef.current();
  }, 50);
}

export async function cancelRecordingModeChooserToStartup(
  restoreStartupToolbarWindow: () => Promise<void>
) {
  try {
    await invoke('capture_overlay_cancel_to_startup');
  } catch (error) {
    toolbarLogger.error('Failed to cancel selection from recording mode chooser back:', error);
  }

  await emit('reset-to-startup', null).catch(() => {});
  await restoreStartupToolbarWindow();
}

export async function cancelOverlayAndRestoreStartup(
  restoreStartupToolbarWindow: () => Promise<void>
) {
  try {
    await invoke('capture_overlay_cancel_to_startup');
  } catch {
    // Overlay may already be closed.
  }

  await emit('reset-to-startup', null);
  await restoreStartupToolbarWindow();
}

export function shouldRestoreStartupFromCancel({
  mode,
  selectionConfirmed,
  areaSelectionFlowActive,
}: {
  mode: ToolbarMode;
  selectionConfirmed: boolean;
  areaSelectionFlowActive: boolean;
}) {
  return mode === 'selection' && (selectionConfirmed || areaSelectionFlowActive);
}

export function isStartupEscapeKey(event: KeyboardEvent, mode: ToolbarMode) {
  return event.key === 'Escape' && mode === 'selection' && !event.repeat;
}

export function consumeKeyboardEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export async function captureFullscreenToEditor(
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>
) {
  const result = await invoke<{ file_path: string; width: number; height: number }>(
    'capture_fullscreen_fast'
  );
  await invoke('open_editor_fast', {
    filePath: result.file_path,
    width: result.width,
    height: result.height,
  });
  await currentWindow.close();
}

export async function startUnconfirmedSourceCapture({
  source,
  captureType,
  currentWindow,
}: {
  source: CaptureSource;
  captureType: CaptureType;
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>;
}) {
  await currentWindow.hide();

  if (source === 'display' && captureType === 'screenshot') {
    await captureFullscreenToEditor(currentWindow);
    return;
  }

  await invoke('show_overlay', { captureType: getOverlayCaptureType(captureType) });
}

export async function captureAreaSelectionToEditor({
  selection,
  currentWindow,
}: {
  selection: AreaSelectionBounds;
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>;
}) {
  const result = await invoke<{ file_path: string; width: number; height: number }>(
    'capture_screen_region_fast',
    { selection }
  );
  await invoke('open_editor_fast', {
    filePath: result.file_path,
    width: result.width,
    height: result.height,
  });
  await currentWindow.close();
}

export async function showReusableAreaOverlay({
  selection,
  captureType,
}: {
  selection: AreaSelectionBounds;
  captureType: CaptureType;
}) {
  await invoke('show_capture_overlay', {
    captureType: getOverlayCaptureType(captureType),
    sourceMode: 'area',
    preselectArea: selection,
  });
}

export function getRecordingControlsSettings(
  captureType: CaptureType,
  settings: CaptureSettingsState['settings'],
): {
  microphoneDeviceIndex: number | null;
  systemAudioEnabled: boolean;
  recordingFormat: 'gif' | 'mp4';
} {
  return {
    microphoneDeviceIndex: captureType === 'video'
      ? settings.video.microphoneDeviceIndex
      : null,
    systemAudioEnabled: captureType === 'video'
      ? settings.video.captureSystemAudio
      : false,
    recordingFormat: captureType === 'gif' ? 'gif' : 'mp4',
  };
}

export async function getCurrentWindowHudAnchor(
  currentWindow: CurrentWebviewWindow
): Promise<RecordingHudAnchor> {
  const [position, size] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.outerSize(),
  ]);

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

export async function getSelectionHudAnchor(selectionBounds: SelectionBounds) {
  const monitors = await availableMonitors().catch(() => []);
  const selectionMonitor =
    monitors.length > 0
      ? getSelectionMonitor(monitors, selectionBounds) ?? monitors[0]
      : undefined;

  return getSnappedRecordingHudAnchor(selectionBounds, selectionMonitor);
}

export async function getRecordingControlsHudAnchor({
  currentWindow,
  snapToolbarToSelection,
  selectionConfirmed,
  selectionBounds,
}: {
  currentWindow: CurrentWebviewWindow;
  snapToolbarToSelection: boolean;
  selectionConfirmed: boolean;
  selectionBounds: SelectionBounds;
}) {
  if (snapToolbarToSelection && selectionConfirmed) {
    return getSelectionHudAnchor(selectionBounds);
  }

  return getCurrentWindowHudAnchor(currentWindow);
}

export async function showRecordingControls({
  hudAnchor,
  includeInCapture,
  microphoneDeviceIndex,
  systemAudioEnabled,
  recordingFormat,
}: {
  hudAnchor: RecordingHudAnchor;
  includeInCapture: boolean;
  microphoneDeviceIndex: number | null;
  systemAudioEnabled: boolean;
  recordingFormat: 'gif' | 'mp4';
}) {
  await invoke('show_recording_controls', {
    x: hudAnchor.x,
    y: hudAnchor.y,
    width: hudAnchor.width,
    height: hudAnchor.height,
    includeInCapture,
    microphoneDeviceIndex,
    systemAudioEnabled,
    recordingFormat,
  });
}
