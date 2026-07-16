import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ToolbarMode } from '../../components/CaptureToolbar/CaptureToolbar';
import type { AreaSelectionBounds } from '../../stores/captureSettingsStore';
import type { SelectionBounds } from '../../hooks/useSelectionEvents';
import type { CaptureType } from '../../types';
import { useToolbarPositioning } from '../../hooks/useToolbarPositioning';
import { toolbarLogger } from '../../utils/logger';
import { isAutoStartRecordingSession } from '../captureToolbarFlow';
import { getSelectionAutoStartRecording, shouldSuppressWindowShow } from './toolbarPolicy';

export function useCaptureToolbarSetup(
  isInitialized: boolean,
  loadSettings: () => Promise<void>,
) {
  useEffect(() => {
    if (!isInitialized) void loadSettings();
  }, [isInitialized, loadSettings]);
  useEffect(() => {
    const unlisten = listen('capture-settings-changed', () => void loadSettings());
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, [loadSettings]);
  useEffect(() => {
    invoke('prewarm_capture').catch((error) => toolbarLogger.warn('Failed to pre-warm capture:', error));
  }, []);
}

export function useCaptureToolbarStateSync({
  currentAreaSelection,
  setLastAreaSelection,
  showToolbarInRecording,
}: {
  currentAreaSelection: AreaSelectionBounds | null;
  setLastAreaSelection: (selection: AreaSelectionBounds) => void;
  showToolbarInRecording: boolean;
}) {
  useEffect(() => {
    if (currentAreaSelection) setLastAreaSelection(currentAreaSelection);
  }, [currentAreaSelection, setLastAreaSelection]);
  useEffect(() => {
    invoke('capture_toolbar_ready').catch((error) =>
      toolbarLogger.warn('Failed to notify capture toolbar readiness:', error));
  }, []);
  useEffect(() => {
    invoke('set_toolbar_recording_visibility', { show: showToolbarInRecording }).catch((error) =>
      toolbarLogger.warn('Failed to set toolbar recording visibility:', error));
  }, [showToolbarInRecording]);
}

interface WindowLifecycleOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  selectionConfirmed: boolean;
  mode: ToolbarMode;
  isStartupContextReady: boolean;
  suppressToolbarUntilRecording: boolean;
  isNativeSelectionHudActive: boolean;
  suppressPrimaryToolbarDuringRecording: boolean;
  isModeChooserVisible: boolean;
  isRecordingControlsPending: boolean;
  isRestoringToolbarFromChooser: boolean;
  captureType: CaptureType;
  openWebcamPreviewIfEnabled: () => void;
  closeWebcamPreview: () => void;
  autoStartRecording: boolean;
  autoStartRecordingTriggeredRef: MutableRefObject<boolean>;
  closeWindowOnCompleteRef: MutableRefObject<boolean>;
  selectionBounds: SelectionBounds;
}

export function useCaptureToolbarWindowLifecycle(options: WindowLifecycleOptions) {
  const {
    containerRef, contentRef, selectionConfirmed, mode, isStartupContextReady,
    suppressToolbarUntilRecording, isNativeSelectionHudActive,
    suppressPrimaryToolbarDuringRecording, isModeChooserVisible,
    isRecordingControlsPending, isRestoringToolbarFromChooser, captureType,
    openWebcamPreviewIfEnabled, closeWebcamPreview, autoStartRecording,
    autoStartRecordingTriggeredRef, closeWindowOnCompleteRef, selectionBounds,
  } = options;
  const bringStartupToolbarToFront = useCallback(async () => {
    try {
      await invoke('bring_startup_toolbar_to_front', { focus: true });
    } catch (error) {
      toolbarLogger.warn('Failed to bring startup toolbar to front:', error);
      const currentWindow = getCurrentWebviewWindow();
      await currentWindow.show().catch((showError) =>
        toolbarLogger.warn('Failed to show startup toolbar fallback:', showError));
      await currentWindow.setFocus().catch(() => {});
    }
  }, []);
  const hasSizedToContentRef = useRef(false);
  const pendingFrontBringRef = useRef(false);
  const handleContentSized = useCallback(() => {
    hasSizedToContentRef.current = true;
    if (pendingFrontBringRef.current) {
      pendingFrontBringRef.current = false;
      void bringStartupToolbarToFront();
    }
  }, [bringStartupToolbarToFront]);
  const requestStartupFrontBring = useCallback(() => {
    if (hasSizedToContentRef.current) {
      void bringStartupToolbarToFront();
      return;
    }
    pendingFrontBringRef.current = true;
    window.setTimeout(() => {
      if (!pendingFrontBringRef.current) return;
      pendingFrontBringRef.current = false;
      void bringStartupToolbarToFront();
    }, 600);
  }, [bringStartupToolbarToFront]);

  useToolbarPositioning({
    containerRef, contentRef, selectionConfirmed, mode,
    windowReadyToShow: Boolean(selectionConfirmed || isStartupContextReady),
    suppressWindowShow: shouldSuppressWindowShow({
      suppressToolbarUntilRecording, isNativeSelectionHudActive,
      suppressPrimaryToolbarDuringRecording, isModeChooserVisible,
      isRecordingControlsPending, isRestoringToolbarFromChooser,
    }),
    onContentSized: handleContentSized,
  });
  useEffect(() => {
    if (captureType === 'video') openWebcamPreviewIfEnabled();
    else closeWebcamPreview();
  }, [captureType, openWebcamPreviewIfEnabled, closeWebcamPreview]);
  useEffect(() => {
    if (!autoStartRecording) autoStartRecordingTriggeredRef.current = false;
  }, [autoStartRecording, autoStartRecordingTriggeredRef]);
  useEffect(() => {
    closeWindowOnCompleteRef.current = isAutoStartRecordingSession(
      getSelectionAutoStartRecording(selectionConfirmed, selectionBounds));
  }, [closeWindowOnCompleteRef, selectionBounds, selectionConfirmed]);
  useEffect(() => {
    const handleBlur = () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);
  return { requestStartupFrontBring, bringStartupToolbarToFront };
}
