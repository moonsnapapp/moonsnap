/**
 * CaptureToolbarWindow - Unified toolbar for screen capture.
 *
 * Architecture:
 * - Frontend creates window via App.tsx listener
 * - Frontend measures content, calculates position (with multi-monitor support)
 * - Frontend calls Rust to set bounds and show window
 *
 * Hooks handle the complexity:
 * - useToolbarPositioning: Window sizing and multi-monitor placement
 * - useRecordingEvents: Recording state machine
 * - useSelectionEvents: Selection bounds updates
 * - useWebcamCoordination: Webcam preview lifecycle
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { availableMonitors, type Monitor } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { CaptureToolbar } from '../components/CaptureToolbar/CaptureToolbar';
import type { CaptureSource } from '../components/CaptureToolbar/SourceSelector';
import {
  MAX_SAVED_AREA_SELECTIONS,
  useCaptureSettingsStore,
  type AreaSelectionBounds,
  type CaptureSourceMode,
  type AfterRecordingAction,
  type SavedAreaSelection,
  isSameAreaSelection,
  normalizeAreaSelection,
} from '../stores/captureSettingsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFocusedShortcutDispatch } from '../hooks/useFocusedShortcutDispatch';
import { useTheme } from '../hooks/useTheme';
import { useRecordingEvents } from '../hooks/useRecordingEvents';
import { repositionToolbar, useSelectionEvents, type SelectionBounds } from '../hooks/useSelectionEvents';
import { useWebcamCoordination } from '../hooks/useWebcamCoordination';
import { useToolbarPositioning } from '../hooks/useToolbarPositioning';
import type { CaptureType } from '../types';
import { toolbarLogger } from '../utils/logger';
import {
  isAutoStartRecordingSession,
  shouldSuppressToolbarUntilRecording,
} from './captureToolbarFlow';
import {
  getSelectionMonitor,
  getSnappedRecordingHudAnchor,
  type RecordingHudAnchor,
} from './recordingHudAnchor';
import { startRecordingCaptureFlow } from './recordingStartFlow';

interface StartupToolbarContext {
  captureType?: CaptureType;
  sourceMode?: CaptureSourceMode;
  autoStartAreaSelection?: boolean;
}

interface RecordingModeSelectedPayload {
  x: number;
  y: number;
  action: AfterRecordingAction;
  remember: boolean;
  owner?: string;
}

interface RecordingModeChooserBackPayload {
  x: number;
  y: number;
  owner?: string;
}

const MIN_REUSABLE_AREA_SIZE = 20;

function getCurrentAreaSelection(selection: SelectionBounds): AreaSelectionBounds | null {
  if (selection.sourceType !== 'area') {
    return null;
  }

  return normalizeAreaSelection({
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  });
}

function clampAreaSelectionToVisibleDesktop(
  selection: AreaSelectionBounds,
  monitors: Monitor[]
): AreaSelectionBounds | null {
  const normalizedSelection = normalizeAreaSelection(selection);
  if (!normalizedSelection) {
    return null;
  }

  if (monitors.length === 0) {
    return normalizedSelection;
  }

  const minX = Math.min(...monitors.map((monitor) => monitor.position.x));
  const minY = Math.min(...monitors.map((monitor) => monitor.position.y));
  const maxX = Math.max(...monitors.map((monitor) => monitor.position.x + monitor.size.width));
  const maxY = Math.max(...monitors.map((monitor) => monitor.position.y + monitor.size.height));
  const desktopWidth = maxX - minX;
  const desktopHeight = maxY - minY;

  if (desktopWidth < MIN_REUSABLE_AREA_SIZE || desktopHeight < MIN_REUSABLE_AREA_SIZE) {
    return null;
  }

  const width = Math.min(normalizedSelection.width, desktopWidth);
  const height = Math.min(normalizedSelection.height, desktopHeight);
  if (width < MIN_REUSABLE_AREA_SIZE || height < MIN_REUSABLE_AREA_SIZE) {
    return null;
  }

  return {
    x: Math.min(Math.max(normalizedSelection.x, minX), maxX - width),
    y: Math.min(Math.max(normalizedSelection.y, minY), maxY - height),
    width,
    height,
  };
}

const CaptureToolbarWindow: React.FC = () => {
  useTheme();
  useFocusedShortcutDispatch();

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const {
    activeMode: captureType,
    sourceMode: captureSource,
    isInitialized,
    loadSettings,
    setActiveMode: setCaptureType,
    setSourceMode: setCaptureSource,
    promptRecordingMode,
    lastAreaSelection,
    savedAreaSelections,
    setLastAreaSelection,
    saveAreaSelection,
    deleteAreaSelection,
  } = useCaptureSettingsStore();
  useEffect(() => {
    if (!isInitialized) {
      loadSettings();
    }
  }, [isInitialized, loadSettings]);

  useEffect(() => {
    const unlisten = listen('capture-settings-changed', () => {
      void loadSettings();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [loadSettings]);

  useEffect(() => {
    invoke('prewarm_capture').catch((e) => {
      toolbarLogger.warn('Failed to pre-warm capture:', e);
    });
  }, []);

  const { closeWebcamPreview, openWebcamPreviewIfEnabled } = useWebcamCoordination();

  const closeWindowOnCompleteRef = useRef(false);

  const {
    mode,
    setMode,
    format,
    elapsedTime,
    progress,
    errorMessage,
    countdownSeconds,
    recordingInitiatedRef,
  } = useRecordingEvents({ closeWindowOnCompleteRef });

  const [isModeChooserVisible, setIsModeChooserVisible] = useState(false);
  const [isRecordingControlsPending, setIsRecordingControlsPending] = useState(false);
  const [isRecordingHudActive, setIsRecordingHudActive] = useState(false);
  const [isRestoringToolbarFromChooser, setIsRestoringToolbarFromChooser] = useState(false);
  const [isStartupContextReady, setIsStartupContextReady] = useState(false);
  const skipModePromptRef = useRef(false);
  const handleCaptureRef = useRef<() => void>(() => {});
  const recordingStartupInProgressRef = useRef(false);
  const chooserSelectionHandledRef = useRef(false);
  const chooserRestorePositionRef = useRef<RecordingModeChooserBackPayload | null>(null);
  const chooserAnchorPositionRef = useRef<{ x: number; y: number } | null>(null);

  const pendingStartupContextRef = useRef<StartupToolbarContext | null>(null);
  const shouldAutoStartAreaSelectionRef = useRef(false);
  const autoStartRecordingTriggeredRef = useRef(false);

  const {
    selectionBounds,
    selectionBoundsRef,
    selectionConfirmed,
    autoStartRecording,
    clearSelectionAutoStartRecording,
  } = useSelectionEvents();

  const currentAreaSelection = useMemo(
    () => (selectionConfirmed ? getCurrentAreaSelection(selectionBounds) : null),
    [selectionBounds, selectionConfirmed]
  );
  const isCurrentAreaSaved = useMemo(
    () =>
      currentAreaSelection !== null &&
      savedAreaSelections.some((savedArea) => isSameAreaSelection(savedArea, currentAreaSelection)),
    [currentAreaSelection, savedAreaSelections]
  );
  const isAreaSaveDisabled = useMemo(
    () => !isCurrentAreaSaved && savedAreaSelections.length >= MAX_SAVED_AREA_SELECTIONS,
    [isCurrentAreaSaved, savedAreaSelections.length]
  );

  useEffect(() => {
    invoke('capture_toolbar_ready').catch((e) => {
      toolbarLogger.warn('Failed to notify capture toolbar readiness:', e);
    });
  }, []);

  const showToolbarInRecording = useCaptureSettingsStore(
    (s) => s.showToolbarInRecording
  );
  const snapToolbarToSelection = useCaptureSettingsStore(
    (s) => s.snapToolbarToSelection
  );

  useEffect(() => {
    invoke('set_toolbar_recording_visibility', {
      show: showToolbarInRecording,
    }).catch((e) => {
      toolbarLogger.warn('Failed to set toolbar recording visibility:', e);
    });
  }, [showToolbarInRecording]);

  const suppressToolbarUntilRecording = shouldSuppressToolbarUntilRecording({
    autoStartRecording,
    selectionAutoStartRecording:
      selectionConfirmed ? selectionBounds.autoStartRecording : false,
    mode,
  });

  const suppressPrimaryToolbarDuringRecording = Boolean(
    selectionConfirmed &&
    (
      isRecordingHudActive ||
      mode === 'starting' ||
      mode === 'recording' ||
      mode === 'paused' ||
      mode === 'processing'
    )
  );

  const shouldHidePrimaryToolbarChrome =
    suppressToolbarUntilRecording ||
    isModeChooserVisible ||
    isRecordingControlsPending ||
    isRecordingHudActive;

  useToolbarPositioning({
    containerRef,
    contentRef,
    selectionConfirmed,
    mode,
    windowReadyToShow: selectionConfirmed || isStartupContextReady,
    suppressWindowShow:
      suppressToolbarUntilRecording ||
      suppressPrimaryToolbarDuringRecording ||
      isModeChooserVisible ||
      isRecordingControlsPending ||
      isRestoringToolbarFromChooser,
  });

  useEffect(() => {
    if (captureType === 'video') {
      openWebcamPreviewIfEnabled();
    } else {
      closeWebcamPreview();
    }
  }, [captureType, openWebcamPreviewIfEnabled, closeWebcamPreview]);

  useEffect(() => {
    if (!autoStartRecording) {
      autoStartRecordingTriggeredRef.current = false;
    }
  }, [autoStartRecording]);

  useEffect(() => {
    closeWindowOnCompleteRef.current = isAutoStartRecordingSession(
      selectionConfirmed ? selectionBounds.autoStartRecording : false
    );
  }, [selectionBounds.autoStartRecording, selectionConfirmed]);

  useEffect(() => {
    const handleBlur = () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  const escHandledRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode === 'selection' && !e.repeat) {
        e.preventDefault();

        if (escHandledRef.current) return;

        await closeWebcamPreview();

        if (selectionConfirmed) {
          escHandledRef.current = true;
          try {
            await invoke('capture_overlay_cancel');
          } catch {
            // Overlay may already be closed.
          }
          await emit('reset-to-startup', null);
          setTimeout(() => {
            escHandledRef.current = false;
          }, 200);
        } else {
          const currentWindow = getCurrentWebviewWindow();
          await currentWindow.close();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectionConfirmed, closeWebcamPreview]);

  const showRecordingControlsWindow = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    const {
      showToolbarInRecording: showToolbarInCapture,
      settings,
    } = useCaptureSettingsStore.getState();
    const recordingMicrophoneDeviceIndex =
      captureType === 'video' ? settings.video.microphoneDeviceIndex : null;
    const recordingSystemAudioEnabled =
      captureType === 'video' ? settings.video.captureSystemAudio : false;
    const recordingFormat = captureType === 'gif' ? 'gif' : 'mp4';
    const [position, size] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
    ]);
    let hudAnchor: RecordingHudAnchor = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };

    if (snapToolbarToSelection && selectionConfirmed) {
      const monitors = await availableMonitors().catch(() => []);
      const selectionMonitor =
        monitors.length > 0
          ? getSelectionMonitor(monitors, selectionBoundsRef.current) ?? monitors[0]
          : undefined;
      hudAnchor = getSnappedRecordingHudAnchor(selectionBoundsRef.current, selectionMonitor);
    }

    await invoke('show_recording_controls', {
      x: hudAnchor.x,
      y: hudAnchor.y,
      width: hudAnchor.width,
      height: hudAnchor.height,
      includeInCapture: showToolbarInCapture,
      microphoneDeviceIndex: recordingMicrophoneDeviceIndex ?? null,
      systemAudioEnabled: recordingSystemAudioEnabled,
      recordingFormat,
    });
    await currentWindow.hide();
  }, [captureType, selectionBoundsRef, selectionConfirmed, snapToolbarToSelection]);

  const handleCapture = useCallback(async () => {
    try {
      if (!selectionConfirmed) {
        const currentWindow = getCurrentWebviewWindow();

        if (captureSource === 'display') {
          await currentWindow.hide();

          if (captureType === 'screenshot') {
            const result = await invoke<{ file_path: string; width: number; height: number }>('capture_fullscreen_fast');
            await invoke('open_editor_fast', {
              filePath: result.file_path,
              width: result.width,
              height: result.height,
            });
            await currentWindow.close();
          } else {
            const ctStr = captureType === 'gif' ? 'gif' : 'video';
            await invoke('show_overlay', { captureType: ctStr });
          }
        } else {
          const ctStr = captureType === 'screenshot' ? 'screenshot' : captureType === 'gif' ? 'gif' : 'video';
          await currentWindow.hide();
          await invoke('show_overlay', { captureType: ctStr });
        }
        return;
      }

      if (captureType === 'screenshot') {
        await invoke('capture_overlay_confirm', { action: 'screenshot' });
      } else {
        const currentWindow = getCurrentWebviewWindow();

        if (captureType === 'video' && !skipModePromptRef.current && promptRecordingMode) {
          chooserSelectionHandledRef.current = false;
          if (snapToolbarToSelection) {
            try {
              await repositionToolbar(selectionBoundsRef.current);
            } catch (error) {
              toolbarLogger.warn('Failed to reposition toolbar before showing recording mode chooser:', error);
            }
          }

          const position = await currentWindow.outerPosition();
          const selection = selectionBoundsRef.current;
          chooserAnchorPositionRef.current = {
            x: position.x,
            y: position.y,
          };

          setIsModeChooserVisible(true);
          await currentWindow.hide().catch(() => {});

          try {
            await invoke('show_recording_mode_chooser', {
              x: selection.x,
              y: selection.y,
              width: selection.width,
              height: selection.height,
              owner: 'capture-toolbar',
              allowDrag: selection.sourceType === 'area',
            });
          } catch (error) {
            setIsModeChooserVisible(false);
            await currentWindow.show().catch(() => {});
            throw error;
          }

          return;
        }

        if (recordingStartupInProgressRef.current) {
          return;
        }

        recordingStartupInProgressRef.current = true;
        setIsModeChooserVisible(false);
        setIsRecordingHudActive(true);
        setIsRecordingControlsPending(true);

        recordingInitiatedRef.current = true;
        const [position, size] = await Promise.all([
          currentWindow.outerPosition(),
          currentWindow.outerSize(),
        ]);
        let hudAnchor: RecordingHudAnchor = {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
        };

        if (snapToolbarToSelection) {
          const monitors = await availableMonitors().catch(() => []);
          const selectionMonitor =
            monitors.length > 0
              ? getSelectionMonitor(monitors, selectionBoundsRef.current) ?? monitors[0]
              : undefined;
          hudAnchor = getSnappedRecordingHudAnchor(selectionBoundsRef.current, selectionMonitor);
        }

        await startRecordingCaptureFlow({
          captureType,
          selection: selectionBoundsRef.current,
          hudAnchor,
          onBeforeOverlayConfirm: async () => {
            await currentWindow.hide().catch(() => {});
          },
        });

        setIsRecordingControlsPending(false);
      }
    } catch (e) {
      toolbarLogger.error('Failed to capture:', e);
      recordingInitiatedRef.current = false;
      recordingStartupInProgressRef.current = false;
      chooserSelectionHandledRef.current = false;
      chooserRestorePositionRef.current = null;
      chooserAnchorPositionRef.current = null;
      skipModePromptRef.current = false;
      setIsModeChooserVisible(false);
      setIsRecordingControlsPending(false);
      setIsRecordingHudActive(false);
      setIsRestoringToolbarFromChooser(false);
      invoke('close_recording_controls').catch(() => {});
      clearSelectionAutoStartRecording();
      setMode('selection');
    }
  }, [captureType, captureSource, clearSelectionAutoStartRecording, promptRecordingMode, selectionConfirmed, selectionBoundsRef, recordingInitiatedRef, setMode, snapToolbarToSelection]);

  useEffect(() => {
    handleCaptureRef.current = () => {
      void handleCapture();
    };
  }, [handleCapture]);

  const handleRedo = useCallback(async () => {
    try {
      try {
        await invoke('capture_overlay_cancel');
      } catch {
        // Overlay may already be closed.
      }
      await emit('reset-to-startup', null);
    } catch (e) {
      toolbarLogger.error('Failed to go back:', e);
    }
  }, []);

  const handleCancel = useCallback(async () => {
    try {
      await closeWebcamPreview();

      if (mode !== 'selection') {
        await invoke('cancel_recording');
      } else if (selectionConfirmed) {
        try {
          await invoke('capture_overlay_cancel');
        } catch {
          // Overlay may already be closed.
        }
        await emit('reset-to-startup', null);
      } else {
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.close();
      }
    } catch (e) {
      toolbarLogger.error('Failed to cancel:', e);
    }
  }, [mode, selectionConfirmed, closeWebcamPreview]);

  const handlePause = useCallback(async () => {
    try {
      await invoke('pause_recording');
    } catch (e) {
      toolbarLogger.error('Failed to pause:', e);
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await invoke('resume_recording');
    } catch (e) {
      toolbarLogger.error('Failed to resume:', e);
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      await invoke('stop_recording');
    } catch (e) {
      toolbarLogger.error('Failed to stop:', e);
    }
  }, []);

  const handleDimensionChange = useCallback(async (width: number, height: number) => {
    try {
      await invoke('capture_overlay_set_dimensions', { width, height });
    } catch (e) {
      toolbarLogger.error('Failed to set dimensions:', e);
    }
  }, []);

  const handleCaptureSourceChange = useCallback(async (source: CaptureSource) => {
    setCaptureSource(source);

    if (!selectionConfirmed) {
      const currentWindow = getCurrentWebviewWindow();

      try {
        if (source === 'display') {
          await currentWindow.hide();

          if (captureType === 'screenshot') {
            const result = await invoke<{ file_path: string; width: number; height: number }>('capture_fullscreen_fast');
            await invoke('open_editor_fast', {
              filePath: result.file_path,
              width: result.width,
              height: result.height,
            });
            await currentWindow.close();
          } else {
            const ctStr = captureType === 'gif' ? 'gif' : 'video';
            await invoke('show_overlay', { captureType: ctStr });
          }
        } else {
          const ctStr = captureType === 'screenshot' ? 'screenshot' : captureType === 'gif' ? 'gif' : 'video';
          await currentWindow.hide();
          await invoke('show_overlay', { captureType: ctStr });
        }
      } catch (e) {
        toolbarLogger.error('Failed to trigger capture:', e);
        await currentWindow.show();
      }
    }
  }, [selectionConfirmed, captureType, setCaptureSource]);

  const reuseAreaSelection = useCallback(async (selection: AreaSelectionBounds) => {
    const currentWindow = getCurrentWebviewWindow();

    try {
      const monitors = await availableMonitors().catch(() => []);
      const reusableSelection = clampAreaSelectionToVisibleDesktop(selection, monitors);
      if (!reusableSelection) {
        toolbarLogger.warn('Skipping reusable area because it no longer fits the current desktop');
        return;
      }

      setLastAreaSelection(reusableSelection);
      await currentWindow.hide();

      if (captureType === 'screenshot') {
        const result = await invoke<{ file_path: string; width: number; height: number }>(
          'capture_screen_region_fast',
          { selection: reusableSelection }
        );
        await invoke('open_editor_fast', {
          filePath: result.file_path,
          width: result.width,
          height: result.height,
        });
        await currentWindow.close();
        return;
      }

      const ctStr = captureType === 'gif' ? 'gif' : 'video';
      await invoke('show_capture_overlay', {
        captureType: ctStr,
        sourceMode: 'area',
        preselectArea: reusableSelection,
      });
    } catch (error) {
      toolbarLogger.error('Failed to reuse saved area:', error);
      await currentWindow.show().catch(() => {});
    }
  }, [captureType, setLastAreaSelection]);

  const handleSelectLastArea = useCallback(() => {
    if (!lastAreaSelection) {
      return;
    }

    void reuseAreaSelection(lastAreaSelection);
  }, [lastAreaSelection, reuseAreaSelection]);

  const handleSelectSavedArea = useCallback((selection: SavedAreaSelection) => {
    void reuseAreaSelection(selection);
  }, [reuseAreaSelection]);

  const handleDeleteSavedArea = useCallback((id: string) => {
    deleteAreaSelection(id);
  }, [deleteAreaSelection]);

  const handleSaveCurrentArea = useCallback(() => {
    if (!currentAreaSelection || isAreaSaveDisabled) {
      return;
    }

    saveAreaSelection(currentAreaSelection);
  }, [currentAreaSelection, isAreaSaveDisabled, saveAreaSelection]);

  const handleOpenSettings = useCallback(() => {
    useSettingsStore.getState().openSettingsModal();
  }, []);

  const handleCaptureComplete = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.close();
  }, []);

  const handleModeChange = useCallback((newMode: typeof captureType) => {
    if (mode === 'selection') {
      setCaptureType(newMode);
    }
  }, [mode, setCaptureType]);

  const applyStartupToolbarContext = useCallback((context: StartupToolbarContext) => {
    if (mode !== 'selection') return;

    if (context.captureType) {
      setCaptureType(context.captureType);
    }

    if (context.sourceMode) {
      setCaptureSource(context.sourceMode);
    }

    shouldAutoStartAreaSelectionRef.current = Boolean(
      context.autoStartAreaSelection && context.sourceMode === 'area'
    );
  }, [mode, setCaptureSource, setCaptureType]);

  useEffect(() => {
    const unlisten = listen<StartupToolbarContext>('startup-toolbar-context', (event) => {
      setIsStartupContextReady(true);

      if (!isInitialized) {
        pendingStartupContextRef.current = event.payload;
        return;
      }

      applyStartupToolbarContext(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [applyStartupToolbarContext, isInitialized]);

  useEffect(() => {
    if (!isInitialized || !pendingStartupContextRef.current) {
      return;
    }

    setIsStartupContextReady(true);
    applyStartupToolbarContext(pendingStartupContextRef.current);
    pendingStartupContextRef.current = null;
  }, [applyStartupToolbarContext, isInitialized]);

  useEffect(() => {
    if (
      !shouldAutoStartAreaSelectionRef.current ||
      !isInitialized ||
      mode !== 'selection' ||
      selectionConfirmed ||
      captureSource !== 'area' ||
      (captureType !== 'video' && captureType !== 'gif')
    ) {
      return;
    }

    shouldAutoStartAreaSelectionRef.current = false;
    void handleCaptureSourceChange('area');
  }, [
    captureSource,
    captureType,
    handleCaptureSourceChange,
    isInitialized,
    mode,
    selectionConfirmed,
  ]);

  useEffect(() => {
    const unlistenSelected = listen<RecordingModeSelectedPayload>('recording-mode-selected', (event) => {
      if (event.payload.owner !== 'capture-toolbar') {
        return;
      }

      if (chooserSelectionHandledRef.current) {
        return;
      }

      chooserSelectionHandledRef.current = true;
      chooserAnchorPositionRef.current = null;
      const store = useCaptureSettingsStore.getState();
      store.setAfterRecordingAction(event.payload.action);
      if (event.payload.remember) {
        store.setPromptRecordingMode(false);
      }

      void (async () => {
        skipModePromptRef.current = true;
        window.setTimeout(() => {
          handleCaptureRef.current();
        }, 50);
      })();
    });

    const unlistenBack = listen<RecordingModeChooserBackPayload>('recording-mode-chooser-back', (event) => {
      if (event.payload.owner !== 'capture-toolbar') {
        return;
      }

      chooserSelectionHandledRef.current = false;
      recordingStartupInProgressRef.current = false;
      chooserRestorePositionRef.current = null;
      chooserAnchorPositionRef.current = null;
      setIsModeChooserVisible(false);
      setIsRecordingControlsPending(false);
      setIsRecordingHudActive(false);
      setIsRestoringToolbarFromChooser(false);
      skipModePromptRef.current = false;
      clearSelectionAutoStartRecording();
      invoke('capture_overlay_cancel').catch((error) => {
        toolbarLogger.error('Failed to cancel selection from recording mode chooser back:', error);
      });
    });

    return () => {
      unlistenSelected.then((fn) => fn()).catch(() => {});
      unlistenBack.then((fn) => fn()).catch(() => {});
    };
  }, [clearSelectionAutoStartRecording]);

  useEffect(() => {
    if (
      !autoStartRecording ||
      autoStartRecordingTriggeredRef.current ||
      !selectionConfirmed ||
      mode !== 'selection' ||
      captureType === 'screenshot' ||
      (selectionBounds.captureType != null && selectionBounds.captureType !== captureType)
    ) {
      return;
    }

    autoStartRecordingTriggeredRef.current = true;
    void handleCapture();
  }, [
    autoStartRecording,
    captureType,
    handleCapture,
    mode,
    selectionBounds.captureType,
    selectionConfirmed,
  ]);

  useEffect(() => {
    if (
      autoStartRecording &&
      (mode === 'recording' || mode === 'paused' || mode === 'error')
    ) {
      clearSelectionAutoStartRecording();
    }
  }, [autoStartRecording, clearSelectionAutoStartRecording, mode]);

  useEffect(() => {
    if (mode === 'selection') {
      chooserSelectionHandledRef.current = false;
      recordingStartupInProgressRef.current = false;
      chooserAnchorPositionRef.current = null;
      skipModePromptRef.current = false;
      setIsRecordingControlsPending(false);
      setIsRecordingHudActive(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!isRestoringToolbarFromChooser) {
      return;
    }

    const restorePosition = chooserRestorePositionRef.current;
    chooserRestorePositionRef.current = null;

    if (!restorePosition) {
      setIsRestoringToolbarFromChooser(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await invoke('set_capture_toolbar_position', {
          x: restorePosition.x,
          y: restorePosition.y,
        });
      } catch (error) {
        toolbarLogger.warn('Failed to restore capture toolbar position from mode chooser:', error);
      }

      if (cancelled) {
        return;
      }

      setIsRestoringToolbarFromChooser(false);

      window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        invoke('bring_capture_toolbar_to_front', { focus: true }).catch((error) => {
          toolbarLogger.error('Failed to restore capture toolbar after mode chooser:', error);
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [isRestoringToolbarFromChooser]);

  useEffect(() => {
    if (
      !selectionConfirmed ||
      (mode !== 'recording' && mode !== 'paused' && mode !== 'processing')
    ) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        await showRecordingControlsWindow();
      } catch (e) {
        toolbarLogger.error('Failed to swap to recording controls window:', e);
      }
    }, 80);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [mode, selectionConfirmed, showRecordingControlsWindow]);

  useEffect(() => {
    if (mode === 'starting' || mode === 'recording' || mode === 'paused' || mode === 'processing') {
      return;
    }

    invoke('close_recording_controls').catch((e) => {
      toolbarLogger.error('Failed to close recording controls window after recording:', e);
    });
  }, [mode]);

  const handleOpenLibrary = useCallback(async () => {
    try {
      await invoke('show_library_window');
    } catch (e) {
      toolbarLogger.error('Failed to open library:', e);
    }
  }, []);

  const handleCloseToolbar = useCallback(async () => {
    try {
      await invoke('capture_overlay_cancel');
    } catch {
      // Overlay may not be running.
    }

    await closeWebcamPreview();
    await getCurrentWebviewWindow().close();
  }, [closeWebcamPreview]);

  const handleMinimizeToolbar = useCallback(async () => {
    try {
      await getCurrentWebviewWindow().minimize();
    } catch (e) {
      toolbarLogger.error('Failed to minimize capture toolbar:', e);
    }
  }, []);

  const handleToolbarMouseDown = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button, input, textarea, select, [role="button"], [data-no-window-drag], [contenteditable="true"]'
      )
    ) {
      return;
    }

    try {
      await getCurrentWebviewWindow().startDragging();
    } catch {
      // Dragging is best-effort only.
    }
  }, []);

  return (
    <div ref={containerRef} className="app-container">
      <div
        aria-hidden={shouldHidePrimaryToolbarChrome}
        style={
          shouldHidePrimaryToolbarChrome
            ? { visibility: 'hidden', pointerEvents: 'none' }
            : undefined
        }
      >
        <div className="toolbar-container">
          <div
            className="toolbar-animated-wrapper capture-toolbar-shell"
            onMouseDown={handleToolbarMouseDown}
          >
            <div ref={contentRef} className="toolbar-content-measure">
              <CaptureToolbar
                mode={mode}
                captureType={captureType}
                captureSource={captureSource}
                width={selectionBounds.width}
                height={selectionBounds.height}
                sourceType={selectionBounds.sourceType}
                sourceTitle={selectionBounds.sourceTitle}
                monitorName={selectionBounds.monitorName}
                monitorIndex={selectionBounds.monitorIndex}
                selectionConfirmed={selectionConfirmed}
                onCapture={handleCapture}
                onCaptureTypeChange={handleModeChange}
                onCaptureSourceChange={handleCaptureSourceChange}
                onSelectLastArea={handleSelectLastArea}
                onSelectSavedArea={handleSelectSavedArea}
                onDeleteSavedArea={handleDeleteSavedArea}
                onCaptureComplete={handleCaptureComplete}
                onRedo={handleRedo}
                onCancel={handleCancel}
                format={format}
                elapsedTime={elapsedTime}
                progress={progress}
                errorMessage={errorMessage}
                onPause={handlePause}
                onResume={handleResume}
                onStop={handleStop}
                countdownSeconds={countdownSeconds}
                onDimensionChange={handleDimensionChange}
                onSaveAreaSelection={handleSaveCurrentArea}
                lastAreaSelection={lastAreaSelection}
                savedAreaSelections={savedAreaSelections}
                isCurrentAreaSaved={isCurrentAreaSaved}
                isAreaSaveDisabled={isAreaSaveDisabled}
                onOpenSettings={handleOpenSettings}
                onOpenLibrary={handleOpenLibrary}
                onMinimizeToolbar={handleMinimizeToolbar}
                onCloseToolbar={handleCloseToolbar}
                minimalChrome="floating"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaptureToolbarWindow;
