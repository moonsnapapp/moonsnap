import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ToolbarMode } from '../../components/CaptureToolbar/CaptureToolbar';
import type { CaptureSource } from '../../components/CaptureToolbar/SourceSelector';
import type {
  AreaSelectionBounds, CaptureSourceMode, SavedAreaSelection,
} from '../../stores/captureSettingsStore';
import type { SelectionBounds } from '../../hooks/useSelectionEvents';
import type { CaptureType } from '../../types';
import { toolbarLogger } from '../../utils/logger';
import {
  isCaptureToolbarOwner, shouldAutoStartConfirmedRecording,
  shouldClearSelectionAutoStartRecording, shouldCloseRecordingControlsForMode,
  shouldShowRecordingControlsForMode, shouldStartAreaSelectionFromContext,
  type NativeSelectionHudCapturePayload, type NativeSelectionHudDeleteSavedAreaPayload,
  type RecordingModeChooserBackPayload, type RecordingModeSelectedPayload,
  type StartupToolbarContext,
} from './toolbarPolicy';
import {
  cancelRecordingModeChooserToStartup, handleRecordingModeSelection,
  resetRecordingModeChooserState,
} from './toolbarOperations';

interface CaptureToolbarEventOptions {
  currentAreaSelection: AreaSelectionBounds | null;
  isNativeSelectionHudActive: boolean;
  lastAreaSelection: AreaSelectionBounds | null;
  savedAreaSelections: SavedAreaSelection[];
  handleSaveCurrentArea: () => void;
  areaSelectionFlowActiveRef: MutableRefObject<boolean>;
  deleteAreaSelection: (id: string) => void;
  suppressStartupRestoreRef: MutableRefObject<boolean>;
  restoreStartupToolbarWindow: () => Promise<void>;
  chooserSelectionHandledRef: MutableRefObject<boolean>;
  recordingStartupInProgressRef: MutableRefObject<boolean>;
  chooserRestorePositionRef: MutableRefObject<RecordingModeChooserBackPayload | null>;
  chooserAnchorPositionRef: MutableRefObject<{ x: number; y: number } | null>;
  skipModePromptRef: MutableRefObject<boolean>;
  setIsModeChooserVisible: Dispatch<SetStateAction<boolean>>;
  setIsRecordingControlsPending: Dispatch<SetStateAction<boolean>>;
  setIsRecordingHudActive: Dispatch<SetStateAction<boolean>>;
  setIsRestoringToolbarFromChooser: Dispatch<SetStateAction<boolean>>;
  recordingInitiatedRef: MutableRefObject<boolean>;
  closeWindowOnCompleteRef: MutableRefObject<boolean>;
  setIsStartupContextReady: Dispatch<SetStateAction<boolean>>;
  setMode: (mode: ToolbarMode) => void;
  resetSelectionToStartup: () => void;
  clearSelectionAutoStartRecording: () => void;
  applyStartupToolbarContext: (context: StartupToolbarContext) => void;
  bringStartupToolbarToFrontAfterContext: (context: StartupToolbarContext) => void;
  isInitialized: boolean;
  pendingStartupContextRef: MutableRefObject<StartupToolbarContext | null>;
  shouldAutoStartAreaSelectionRef: MutableRefObject<boolean>;
  mode: ToolbarMode;
  selectionConfirmed: boolean;
  captureSource: CaptureSourceMode;
  captureType: CaptureType;
  handleCaptureSourceChange: (source: CaptureSource) => Promise<void>;
  handleCaptureRef: MutableRefObject<() => void>;
  autoStartRecording: boolean;
  autoStartRecordingTriggeredRef: MutableRefObject<boolean>;
  selectionBounds: SelectionBounds;
  handleCapture: () => Promise<void>;
  isRestoringToolbarFromChooser: boolean;
  showRecordingControlsWindow: () => Promise<void>;
}

export function useCaptureToolbarEventSubscriptions(options: CaptureToolbarEventOptions) {
  const {
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
  } = options;
  useEffect(() => {
    if (!isNativeSelectionHudActive) {
      return;
    }

    void invoke('capture_overlay_set_saved_areas', {
      lastArea: lastAreaSelection,
      savedAreas: savedAreaSelections,
      canSaveCurrent: Boolean(currentAreaSelection),
    }).catch((error) => {
      toolbarLogger.warn('Failed to sync native saved-area menu state:', error);
    });
  }, [
    currentAreaSelection,
    isNativeSelectionHudActive,
    lastAreaSelection,
    savedAreaSelections,
  ]);

  useEffect(() => {
    const unlisten = listen<NativeSelectionHudCapturePayload>(
      'native-selection-hud-save-area',
      (event) => {
        if (!isCaptureToolbarOwner(event.payload.owner)) {
          return;
        }

        handleSaveCurrentArea();
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [handleSaveCurrentArea]);

  useEffect(() => {
    const unlistenConfirm = listen('confirm-selection', () => {
      areaSelectionFlowActiveRef.current = false;
    });

    const unlistenReset = listen('reset-to-startup', () => {
      areaSelectionFlowActiveRef.current = false;
    });

    return () => {
      unlistenConfirm.then((fn) => fn()).catch(() => {});
      unlistenReset.then((fn) => fn()).catch(() => {});
    };
  }, [areaSelectionFlowActiveRef]);

  useEffect(() => {
    const unlisten = listen<NativeSelectionHudDeleteSavedAreaPayload>(
      'native-selection-hud-delete-saved-area',
      (event) => {
        if (!isCaptureToolbarOwner(event.payload.owner)) {
          return;
        }

        deleteAreaSelection(event.payload.id);
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [deleteAreaSelection]);

  useEffect(() => {
    const unlisten = listen('capture-overlay-cancelled-to-startup', () => {
      if (suppressStartupRestoreRef.current) {
        return;
      }

      void restoreStartupToolbarWindow();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [restoreStartupToolbarWindow, suppressStartupRestoreRef]);

  useEffect(() => {
    const unlisten = listen('capture-overlay-reselecting', () => {
      resetRecordingModeChooserState({
        chooserSelectionHandledRef,
        recordingStartupInProgressRef,
        chooserRestorePositionRef,
        chooserAnchorPositionRef,
        skipModePromptRef,
        setIsModeChooserVisible,
        setIsRecordingControlsPending,
        setIsRecordingHudActive,
        setIsRestoringToolbarFromChooser,
      });
      recordingInitiatedRef.current = false;
      closeWindowOnCompleteRef.current = false;

      setIsStartupContextReady(false);
      setMode('selection');
      resetSelectionToStartup();
      clearSelectionAutoStartRecording();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [
    clearSelectionAutoStartRecording,
    chooserAnchorPositionRef,
    chooserRestorePositionRef,
    chooserSelectionHandledRef,
    closeWindowOnCompleteRef,
    recordingInitiatedRef,
    recordingStartupInProgressRef,
    resetSelectionToStartup,
    setIsModeChooserVisible,
    setIsRecordingControlsPending,
    setIsRecordingHudActive,
    setIsRestoringToolbarFromChooser,
    setIsStartupContextReady,
    setMode,
    skipModePromptRef,
  ]);

  useEffect(() => {
    const unlisten = listen<StartupToolbarContext>('startup-toolbar-context', (event) => {
      setIsStartupContextReady(true);

      if (!isInitialized) {
        pendingStartupContextRef.current = event.payload;
        return;
      }

      applyStartupToolbarContext(event.payload);
      bringStartupToolbarToFrontAfterContext(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [
    applyStartupToolbarContext,
    bringStartupToolbarToFrontAfterContext,
    isInitialized,
    pendingStartupContextRef,
    setIsStartupContextReady,
  ]);

  useEffect(() => {
    if (!isInitialized || !pendingStartupContextRef.current) {
      return;
    }

    setIsStartupContextReady(true);
    applyStartupToolbarContext(pendingStartupContextRef.current);
    bringStartupToolbarToFrontAfterContext(pendingStartupContextRef.current);
    pendingStartupContextRef.current = null;
  }, [
    applyStartupToolbarContext,
    bringStartupToolbarToFrontAfterContext,
    isInitialized,
    pendingStartupContextRef,
    setIsStartupContextReady,
  ]);

  useEffect(() => {
    if (!shouldStartAreaSelectionFromContext({
      shouldAutoStart: shouldAutoStartAreaSelectionRef.current,
      isInitialized,
      mode,
      selectionConfirmed,
      captureSource,
      captureType,
    })) {
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
    shouldAutoStartAreaSelectionRef,
  ]);

  useEffect(() => {
    const unlistenSelected = listen<RecordingModeSelectedPayload>('recording-mode-selected', (event) => {
      if (!isCaptureToolbarOwner(event.payload.owner)) {
        return;
      }

      handleRecordingModeSelection({
        payload: event.payload,
        chooserSelectionHandledRef,
        chooserAnchorPositionRef,
        skipModePromptRef,
        handleCaptureRef,
      });
    });

    const unlistenBack = listen<RecordingModeChooserBackPayload>('recording-mode-chooser-back', (event) => {
      if (!isCaptureToolbarOwner(event.payload.owner)) {
        return;
      }

      resetRecordingModeChooserState({
        chooserSelectionHandledRef,
        recordingStartupInProgressRef,
        chooserRestorePositionRef,
        chooserAnchorPositionRef,
        skipModePromptRef,
        setIsModeChooserVisible,
        setIsRecordingControlsPending,
        setIsRecordingHudActive,
        setIsRestoringToolbarFromChooser,
      });
      clearSelectionAutoStartRecording();
      void cancelRecordingModeChooserToStartup(restoreStartupToolbarWindow);
    });

    return () => {
      unlistenSelected.then((fn) => fn()).catch(() => {});
      unlistenBack.then((fn) => fn()).catch(() => {});
    };
  }, [
    chooserAnchorPositionRef,
    chooserRestorePositionRef,
    chooserSelectionHandledRef,
    clearSelectionAutoStartRecording,
    handleCaptureRef,
    recordingStartupInProgressRef,
    restoreStartupToolbarWindow,
    setIsModeChooserVisible,
    setIsRecordingControlsPending,
    setIsRecordingHudActive,
    setIsRestoringToolbarFromChooser,
    skipModePromptRef,
  ]);

  useEffect(() => {
    if (!shouldAutoStartConfirmedRecording({
      autoStartRecording,
      hasTriggered: autoStartRecordingTriggeredRef.current,
      selectionConfirmed,
      mode,
      captureType,
      selectionCaptureType: selectionBounds.captureType,
    })) {
      return;
    }

    autoStartRecordingTriggeredRef.current = true;
    void handleCapture();
  }, [
    autoStartRecording,
    autoStartRecordingTriggeredRef,
    captureType,
    handleCapture,
    mode,
    selectionBounds.captureType,
    selectionConfirmed,
  ]);

  useEffect(() => {
    if (shouldClearSelectionAutoStartRecording(autoStartRecording, mode)) {
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
  }, [
    chooserAnchorPositionRef,
    chooserSelectionHandledRef,
    mode,
    recordingStartupInProgressRef,
    setIsRecordingControlsPending,
    setIsRecordingHudActive,
    skipModePromptRef,
  ]);

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
  }, [
    chooserRestorePositionRef,
    isRestoringToolbarFromChooser,
    setIsRestoringToolbarFromChooser,
  ]);

  useEffect(() => {
    if (!shouldShowRecordingControlsForMode(selectionConfirmed, mode)) {
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
    if (!shouldCloseRecordingControlsForMode(mode)) {
      return;
    }

    invoke('close_recording_controls').catch((e) => {
      toolbarLogger.error('Failed to close recording controls window after recording:', e);
    });
  }, [mode]);
}
