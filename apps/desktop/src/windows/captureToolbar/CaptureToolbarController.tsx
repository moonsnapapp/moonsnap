import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { CaptureSource } from '../../components/CaptureToolbar/SourceSelector';
import {
  useCaptureSettingsStore,
} from '../../stores/captureSettingsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFocusedShortcutDispatch } from '../../hooks/useFocusedShortcutDispatch';
import { useTheme } from '../../hooks/useTheme';
import { useRecordingEvents } from '../../hooks/useRecordingEvents';
import { repositionToolbar, useSelectionEvents } from '../../hooks/useSelectionEvents';
import { useWebcamCoordination } from '../../hooks/useWebcamCoordination';
import { toolbarLogger } from '../../utils/logger';
import { shouldSuppressToolbarUntilRecording } from '../captureToolbarFlow';
import {
  getSelectionMonitor,
  getSnappedRecordingHudAnchor,
  type RecordingHudAnchor,
} from '../recordingHudAnchor';
import { startRecordingCaptureFlow } from '../recordingStartFlow';

import {
  getConfirmedAreaSelection,
  isCaptureToolbarOwner, isNativeSelectionHudVisible,
  isPrimaryToolbarSuppressedDuringRecording, isSavedAreaSelection,
  shouldHideToolbarChrome,
  getCaptureRoute,
  getOverlayCaptureType, getSelectionAutoStartRecording, STARTUP_RESTORE_STATE_FLUSH_MS,
  type CaptureRoute, type NativeSelectionHudCapturePayload,
  type RecordingModeChooserBackPayload, type StartupToolbarContext,
} from './toolbarPolicy';
import {
  cancelOverlayAndRestoreStartup,
  captureFullscreenToEditor, consumeKeyboardEvent,
  getRecordingControlsHudAnchor, getRecordingControlsSettings,
  isStartupEscapeKey, shouldRestoreStartupFromCancel,
  showRecordingControls,
  startUnconfirmedSourceCapture,
} from './toolbarOperations';
import { useCaptureToolbarEventSubscriptions } from './useCaptureToolbarEventSubscriptions';
import { CaptureToolbarShell } from './CaptureToolbarShell';
import { useSavedAreaActions } from './useSavedAreaActions';
import {
  useCaptureToolbarSetup,
  useCaptureToolbarStateSync,
  useCaptureToolbarWindowLifecycle,
} from './useCaptureToolbarLifecycle';

export const CaptureToolbarController: React.FC = () => {
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
  useCaptureToolbarSetup(isInitialized, loadSettings);

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
  const suppressStartupRestoreRef = useRef(false);
  const handleCaptureRef = useRef<() => void>(() => {});
  const recordingStartupInProgressRef = useRef(false);
  const chooserSelectionHandledRef = useRef(false);
  const chooserRestorePositionRef = useRef<RecordingModeChooserBackPayload | null>(null);
  const chooserAnchorPositionRef = useRef<{ x: number; y: number } | null>(null);

  const pendingStartupContextRef = useRef<StartupToolbarContext | null>(null);
  const shouldAutoStartAreaSelectionRef = useRef(false);
  const autoStartRecordingTriggeredRef = useRef(false);
  const areaSelectionFlowActiveRef = useRef(false);

  const {
    selectionBounds,
    selectionBoundsRef,
    selectionConfirmed,
    autoStartRecording,
    clearSelectionAutoStartRecording,
    resetSelectionToStartup,
  } = useSelectionEvents();

  const currentAreaSelection = useMemo(
    () => getConfirmedAreaSelection(selectionConfirmed, selectionBounds),
    [selectionBounds, selectionConfirmed]
  );
  const isNativeSelectionHudActive = isNativeSelectionHudVisible({
    selectionConfirmed,
    selectionBounds,
    mode,
  });
  const isCurrentAreaSaved = useMemo(
    () => isSavedAreaSelection(currentAreaSelection, savedAreaSelections),
    [currentAreaSelection, savedAreaSelections]
  );
  const isAreaSaveDisabled = false;

  // Keep lastAreaSelection in sync when dimensions change after confirmation
  // (e.g., preset selection, manual dimension input)
  const showToolbarInRecording = useCaptureSettingsStore(
    (s) => s.showToolbarInRecording
  );
  const snapToolbarToSelection = useCaptureSettingsStore(
    (s) => s.snapToolbarToSelection
  );

  useCaptureToolbarStateSync({ currentAreaSelection, setLastAreaSelection, showToolbarInRecording });

  const suppressToolbarUntilRecording = shouldSuppressToolbarUntilRecording({
    autoStartRecording,
    selectionAutoStartRecording: getSelectionAutoStartRecording(
      selectionConfirmed,
      selectionBounds
    ),
    mode,
  });

  const suppressPrimaryToolbarDuringRecording = isPrimaryToolbarSuppressedDuringRecording({
    selectionConfirmed,
    isRecordingHudActive,
    mode,
  });

  const shouldHidePrimaryToolbarChrome = shouldHideToolbarChrome({
    suppressToolbarUntilRecording,
    isNativeSelectionHudActive,
    isModeChooserVisible,
    isRecordingControlsPending,
    isRecordingHudActive,
  });

  const { requestStartupFrontBring, bringStartupToolbarToFront } = useCaptureToolbarWindowLifecycle({
    containerRef, contentRef, selectionConfirmed, mode, isStartupContextReady,
    suppressToolbarUntilRecording, isNativeSelectionHudActive,
    suppressPrimaryToolbarDuringRecording, isModeChooserVisible,
    isRecordingControlsPending, isRestoringToolbarFromChooser, captureType,
    openWebcamPreviewIfEnabled, closeWebcamPreview, autoStartRecording,
    autoStartRecordingTriggeredRef, closeWindowOnCompleteRef, selectionBounds,
  });

  const escHandledRef = useRef(false);

  const suppressStartupEscapeBriefly = useCallback(() => {
    escHandledRef.current = true;
    window.setTimeout(() => {
      escHandledRef.current = false;
    }, 500);
  }, []);


  const restoreStartupToolbarWindow = useCallback(async () => {
    suppressStartupEscapeBriefly();

    areaSelectionFlowActiveRef.current = false;
    chooserSelectionHandledRef.current = false;
    recordingStartupInProgressRef.current = false;
    chooserRestorePositionRef.current = null;
    chooserAnchorPositionRef.current = null;
    skipModePromptRef.current = false;
    recordingInitiatedRef.current = false;
    closeWindowOnCompleteRef.current = false;

    setIsModeChooserVisible(false);
    setIsRecordingControlsPending(false);
    setIsRecordingHudActive(false);
    setIsRestoringToolbarFromChooser(false);
    setIsStartupContextReady(true);
    setMode('selection');
    resetSelectionToStartup();
    clearSelectionAutoStartRecording();
    await new Promise((resolve) => window.setTimeout(resolve, STARTUP_RESTORE_STATE_FLUSH_MS));
    await bringStartupToolbarToFront();
  }, [
    bringStartupToolbarToFront,
    clearSelectionAutoStartRecording,
    recordingInitiatedRef,
    resetSelectionToStartup,
    setMode,
    suppressStartupEscapeBriefly,
  ]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!isStartupEscapeKey(e, mode)) {
        return;
      }

      consumeKeyboardEvent(e);

      if (escHandledRef.current) return;

      await closeWebcamPreview();

      if (!shouldRestoreStartupFromCancel({
        mode,
        selectionConfirmed,
        areaSelectionFlowActive: areaSelectionFlowActiveRef.current,
      })) {
        return;
      }

      escHandledRef.current = true;
      await cancelOverlayAndRestoreStartup(restoreStartupToolbarWindow);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectionConfirmed, closeWebcamPreview, restoreStartupToolbarWindow]);

  const showRecordingControlsWindow = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    const {
      showToolbarInRecording: showToolbarInCapture,
      settings,
    } = useCaptureSettingsStore.getState();
    const hudAnchor = await getRecordingControlsHudAnchor({
      currentWindow,
      snapToolbarToSelection,
      selectionConfirmed,
      selectionBounds: selectionBoundsRef.current,
    });
    await showRecordingControls({
      hudAnchor,
      includeInCapture: showToolbarInCapture,
      ...getRecordingControlsSettings(captureType, settings),
    });
    await currentWindow.hide();
  }, [captureType, selectionBoundsRef, selectionConfirmed, snapToolbarToSelection]);

  const startUnconfirmedCaptureFlow = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    areaSelectionFlowActiveRef.current = captureSource === 'area';
    await currentWindow.hide();

    if (captureSource === 'display' && captureType === 'screenshot') {
      await captureFullscreenToEditor(currentWindow);
      return;
    }

    await invoke('show_overlay', { captureType: getOverlayCaptureType(captureType) });
  }, [captureSource, captureType]);

  const showRecordingModeChooser = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
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
  }, [selectionBoundsRef, snapToolbarToSelection]);

  const getRecordingHudAnchor = useCallback(async (
    currentWindow: ReturnType<typeof getCurrentWebviewWindow>
  ): Promise<RecordingHudAnchor> => {
    const [position, size] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
    ]);

    if (!snapToolbarToSelection) {
      return {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };
    }

    const monitors = await availableMonitors().catch(() => []);
    const selectionMonitor =
      monitors.length > 0
        ? getSelectionMonitor(monitors, selectionBoundsRef.current) ?? monitors[0]
        : undefined;

    return getSnappedRecordingHudAnchor(selectionBoundsRef.current, selectionMonitor);
  }, [selectionBoundsRef, snapToolbarToSelection]);

  const startConfirmedRecordingFlow = useCallback(async () => {
    if (captureType === 'screenshot') {
      return;
    }

    if (recordingStartupInProgressRef.current) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    recordingStartupInProgressRef.current = true;
    setIsModeChooserVisible(false);
    setIsRecordingHudActive(true);
    setIsRecordingControlsPending(true);

    recordingInitiatedRef.current = true;
    const hudAnchor = await getRecordingHudAnchor(currentWindow);

    await startRecordingCaptureFlow({
      captureType,
      selection: selectionBoundsRef.current,
      hudAnchor,
      onBeforeOverlayConfirm: async () => {
        await currentWindow.hide().catch(() => {});
      },
    });

    setIsRecordingControlsPending(false);
  }, [captureType, getRecordingHudAnchor, recordingInitiatedRef, selectionBoundsRef]);

  const resetFailedCaptureState = useCallback(() => {
    areaSelectionFlowActiveRef.current = false;
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
  }, [clearSelectionAutoStartRecording, recordingInitiatedRef, setMode]);

  const handleCapture = useCallback(async () => {
    try {
      const route = getCaptureRoute({
        selectionConfirmed,
        captureType,
        skipModePrompt: skipModePromptRef.current,
        promptRecordingMode,
      });
      const routeActions: Record<CaptureRoute, () => Promise<void>> = {
        unconfirmed: startUnconfirmedCaptureFlow,
        screenshot: () => invoke('capture_overlay_confirm', { action: 'screenshot' }),
        modeChooser: showRecordingModeChooser,
        recording: startConfirmedRecordingFlow,
      };

      await routeActions[route]();
    } catch (e) {
      toolbarLogger.error('Failed to capture:', e);
      resetFailedCaptureState();
    }
  }, [
    captureType,
    promptRecordingMode,
    resetFailedCaptureState,
    selectionConfirmed,
    showRecordingModeChooser,
    startConfirmedRecordingFlow,
    startUnconfirmedCaptureFlow,
  ]);

  useEffect(() => {
    handleCaptureRef.current = () => {
      void handleCapture();
    };
  }, [handleCapture]);

  useEffect(() => {
    const unlisten = listen<NativeSelectionHudCapturePayload>(
      'native-selection-hud-capture',
      (event) => {
        if (!isCaptureToolbarOwner(event.payload.owner)) {
          return;
        }

        window.setTimeout(() => {
          handleCaptureRef.current();
        }, 30);
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Wrapper for the trivial "invoke one command, log on failure" handlers.
  // Keeps the simple recording/window commands consistent; multi-step handlers
  // (redo, cancel, capture) keep their own bespoke logic below.
  const runToolbarCommand = useCallback(
    async (command: string, failureMessage: string, args?: Record<string, unknown>): Promise<void> => {
      try {
        await invoke(command, args);
      } catch (e) {
        toolbarLogger.error(failureMessage, e);
      }
    },
    []
  );

  const handleRedo = useCallback(async () => {
    try {
      await cancelOverlayAndRestoreStartup(restoreStartupToolbarWindow);
    } catch (e) {
      toolbarLogger.error('Failed to go back:', e);
    }
  }, [restoreStartupToolbarWindow]);

  const handleCancel = useCallback(async () => {
    try {
      await closeWebcamPreview();

      if (mode !== 'selection') {
        await invoke('cancel_recording');
      } else if (shouldRestoreStartupFromCancel({
        mode,
        selectionConfirmed,
        areaSelectionFlowActive: areaSelectionFlowActiveRef.current,
      })) {
        await cancelOverlayAndRestoreStartup(restoreStartupToolbarWindow);
      } else {
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.close();
      }
    } catch (e) {
      toolbarLogger.error('Failed to cancel:', e);
    }
  }, [mode, selectionConfirmed, closeWebcamPreview, restoreStartupToolbarWindow]);

  const handlePause = useCallback(
    () => runToolbarCommand('pause_recording', 'Failed to pause:'),
    [runToolbarCommand]
  );

  const handleResume = useCallback(
    () => runToolbarCommand('resume_recording', 'Failed to resume:'),
    [runToolbarCommand]
  );

  const handleStop = useCallback(
    () => runToolbarCommand('stop_recording', 'Failed to stop:'),
    [runToolbarCommand]
  );

  const handleDimensionChange = useCallback(
    (width: number, height: number) =>
      runToolbarCommand('capture_overlay_set_dimensions', 'Failed to set dimensions:', { width, height }),
    [runToolbarCommand]
  );

  const handleCaptureSourceChange = useCallback(async (source: CaptureSource) => {
    setCaptureSource(source);

    if (!selectionConfirmed) {
      const currentWindow = getCurrentWebviewWindow();

      try {
        areaSelectionFlowActiveRef.current = source === 'area';
        await startUnconfirmedSourceCapture({ source, captureType, currentWindow });
      } catch (e) {
        toolbarLogger.error('Failed to trigger capture:', e);
        areaSelectionFlowActiveRef.current = false;
        await currentWindow.show();
      }
    }
  }, [selectionConfirmed, captureType, setCaptureSource]);

  const { handleSelectLastArea, handleSelectSavedArea, handleDeleteSavedArea, handleSaveCurrentArea } =
    useSavedAreaActions({ captureType, lastAreaSelection, currentAreaSelection,
      isCurrentAreaSaved, isNativeSelectionHudActive, savedAreaSelections,
      setLastAreaSelection, saveAreaSelection, deleteAreaSelection, areaSelectionFlowActiveRef });

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
    areaSelectionFlowActiveRef.current = false;
    setMode('selection');
    resetSelectionToStartup();
    setIsModeChooserVisible(false);
    setIsRecordingControlsPending(false);
    setIsRecordingHudActive(false);
    setIsRestoringToolbarFromChooser(false);

    if (context.captureType) {
      setCaptureType(context.captureType);
    }

    if (context.sourceMode) {
      setCaptureSource(context.sourceMode);
    }

    shouldAutoStartAreaSelectionRef.current = Boolean(
      context.autoStartAreaSelection && context.sourceMode === 'area'
    );
  }, [resetSelectionToStartup, setCaptureSource, setCaptureType, setMode]);

  const bringStartupToolbarToFrontAfterContext = useCallback(
    (context: StartupToolbarContext) => {
      if (context.autoStartAreaSelection) {
        return;
      }

      // Wait for the toolbar to size itself to content before revealing it,
      // instead of a fixed delay that races slow (dev-mode) layout.
      requestStartupFrontBring();
    },
    [requestStartupFrontBring]
  );

  useCaptureToolbarEventSubscriptions({
    currentAreaSelection, isNativeSelectionHudActive, lastAreaSelection,
    savedAreaSelections, handleSaveCurrentArea, areaSelectionFlowActiveRef,
    deleteAreaSelection, suppressStartupRestoreRef, restoreStartupToolbarWindow,
    chooserSelectionHandledRef, recordingStartupInProgressRef,
    chooserRestorePositionRef, chooserAnchorPositionRef, skipModePromptRef,
    setIsModeChooserVisible, setIsRecordingControlsPending, setIsRecordingHudActive,
    setIsRestoringToolbarFromChooser, recordingInitiatedRef, closeWindowOnCompleteRef,
    setIsStartupContextReady, setMode, resetSelectionToStartup,
    clearSelectionAutoStartRecording, applyStartupToolbarContext,
    bringStartupToolbarToFrontAfterContext, isInitialized, pendingStartupContextRef,
    shouldAutoStartAreaSelectionRef, mode, selectionConfirmed, captureSource,
    captureType, handleCaptureSourceChange, handleCaptureRef, autoStartRecording,
    autoStartRecordingTriggeredRef, selectionBounds, handleCapture,
    isRestoringToolbarFromChooser, showRecordingControlsWindow,
  });


  const handleOpenLibrary = useCallback(
    () => runToolbarCommand('show_library_window', 'Failed to open library:'),
    [runToolbarCommand]
  );

  const handleCloseToolbar = useCallback(async () => {
    suppressStartupRestoreRef.current = true;
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

  return (
    <CaptureToolbarShell
      containerRef={containerRef}
      contentRef={contentRef}
      hidden={shouldHidePrimaryToolbarChrome}
      toolbarProps={{
        mode,
        captureType,
        captureSource,
        width: selectionBounds.width,
        height: selectionBounds.height,
        sourceType: selectionBounds.sourceType,
        sourceTitle: selectionBounds.sourceTitle,
        monitorName: selectionBounds.monitorName,
        monitorIndex: selectionBounds.monitorIndex,
        selectionConfirmed,
        onCapture: handleCapture,
        onCaptureTypeChange: handleModeChange,
        onCaptureSourceChange: handleCaptureSourceChange,
        onSelectLastArea: handleSelectLastArea,
        onSelectSavedArea: handleSelectSavedArea,
        onDeleteSavedArea: handleDeleteSavedArea,
        onCaptureComplete: handleCaptureComplete,
        onRedo: handleRedo,
        onCancel: handleCancel,
        format,
        elapsedTime,
        progress,
        errorMessage,
        onPause: handlePause,
        onResume: handleResume,
        onStop: handleStop,
        countdownSeconds,
        onDimensionChange: handleDimensionChange,
        onSaveAreaSelection: handleSaveCurrentArea,
        lastAreaSelection,
        savedAreaSelections,
        isCurrentAreaSaved,
        isAreaSaveDisabled,
        onOpenSettings: handleOpenSettings,
        onOpenLibrary: handleOpenLibrary,
        onMinimizeToolbar: handleMinimizeToolbar,
        onCloseToolbar: handleCloseToolbar,
        minimalChrome: 'floating',
      }}
    />
  );
};
