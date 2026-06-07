/**
 * useRecordingEvents - Listens for recording state changes from Rust backend.
 *
 * Manages the recording lifecycle: idle → countdown → recording → paused → processing → completed/error
 * Emits callbacks for state transitions so the toolbar can respond appropriately.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { RecordingState, RecordingFormat } from '../types';
import type { ToolbarMode } from '../components/CaptureToolbar/CaptureToolbar';
import { createErrorHandler } from '../utils/errorReporting';
import { useWebcamSettingsStore } from '../stores/webcamSettingsStore';
import { recordingLogger } from '../utils/logger';

interface UseRecordingEventsReturn {
  /** Current toolbar mode based on recording state */
  mode: ToolbarMode;
  /** Set mode manually (e.g., when starting recording) */
  setMode: (mode: ToolbarMode) => void;
  /** Recording format (mp4/gif) */
  format: RecordingFormat;
  /** Elapsed recording time in seconds */
  elapsedTime: number;
  /** Processing progress (0-1) */
  progress: number;
  /** Error message if in error state */
  errorMessage: string | undefined;
  /** Countdown seconds remaining */
  countdownSeconds: number | undefined;
  /** Ref to current mode (for use in closures) */
  modeRef: React.MutableRefObject<ToolbarMode>;
  /** Whether recording has been initiated (for cleanup logic) */
  recordingInitiatedRef: React.MutableRefObject<boolean>;
  /** Whether recording is currently active */
  isRecordingActiveRef: React.MutableRefObject<boolean>;
}

interface UseRecordingEventsOptions {
  closeWindowOnCompleteRef?: React.MutableRefObject<boolean>;
}

function unlistenRecordingEvents(listeners: Array<UnlistenFn | null>) {
  listeners.forEach((unlisten) => unlisten?.());
}

export function useRecordingEvents(
  options: UseRecordingEventsOptions = {}
): UseRecordingEventsReturn {
  const [mode, setModeState] = useState<ToolbarMode>('selection');
  const [format, setFormat] = useState<RecordingFormat>('mp4');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [countdownSeconds, setCountdownSeconds] = useState<number | undefined>();

  // Refs for synchronous access in event handlers
  const modeRef = useRef<ToolbarMode>('selection');
  const recordingInitiatedRef = useRef(false);
  const isRecordingActiveRef = useRef(false);

  // Timer refs for smooth pause/resume (no jumps)
  // - timerBaseTime: accumulated elapsed time when timer was last paused/started
  // - timerStartedAt: timestamp when current timer segment started (null if paused)
  const timerBaseTimeRef = useRef(0);
  const timerStartedAtRef = useRef<number | null>(null);
  const closeWindowOnCompleteRef = options.closeWindowOnCompleteRef;

  // Wrapper to update both state and ref
  const setMode = useCallback((newMode: ToolbarMode) => {
    modeRef.current = newMode;
    setModeState(newMode);
  }, []);

  // Timer for elapsed time during recording
  // Pure local timer - no backend sync needed, just counts up smoothly
  useEffect(() => {
    // Only run timer when actively recording (not paused)
    if (mode !== 'recording') return;

    // Start timer from current base time
    timerStartedAtRef.current = Date.now();

    const interval = setInterval(() => {
      // Double-check we're still recording (race condition prevention)
      // modeRef is updated synchronously, so this catches cases where
      // the interval fires between mode state change and effect cleanup
      if (modeRef.current !== 'recording') return;

      if (timerStartedAtRef.current !== null) {
        const currentSegment = (Date.now() - timerStartedAtRef.current) / 1000;
        setElapsedTime(timerBaseTimeRef.current + currentSegment);
      }
    }, 100);

    return () => {
      clearInterval(interval);
      // Save current elapsed time as base for next segment (pause/resume)
      if (timerStartedAtRef.current !== null) {
        timerBaseTimeRef.current += (Date.now() - timerStartedAtRef.current) / 1000;
        timerStartedAtRef.current = null;
      }
    };
  }, [mode]);

  // Listen for recording state changes.
  // The close-on-complete ref is stable for the window lifetime, so keeping it
  // in the dependency list does not churn listeners during normal recording.
  useEffect(() => {
    let cancelled = false;
    let unlistenState: UnlistenFn | null = null;
    let unlistenFormat: UnlistenFn | null = null;
    let unlistenClosed: UnlistenFn | null = null;
    let unlistenReselecting: UnlistenFn | null = null;
    let unlistenCountdownTick: UnlistenFn | null = null;
    let errorRecoveryTimeout: ReturnType<typeof setTimeout> | null = null;

    const unlistenAll = () => {
      unlistenRecordingEvents([
        unlistenState,
        unlistenFormat,
        unlistenClosed,
        unlistenReselecting,
        unlistenCountdownTick,
      ]);
    };

    const currentWindow = getCurrentWebviewWindow();

    // Helper to close webcam preview - uses store directly to avoid stale closures
    const closeWebcamPreview = async () => {
      try {
        await useWebcamSettingsStore.getState().closePreview();
      } catch {
        // Ignore
      }
    };

    const resetRecordingRuntime = () => {
      isRecordingActiveRef.current = false;
      timerBaseTimeRef.current = 0;
      timerStartedAtRef.current = null;
    };

    const clearCloseWindowOnComplete = () => {
      if (closeWindowOnCompleteRef) {
        closeWindowOnCompleteRef.current = false;
      }
    };

    const hideRecordingSurfaces = () => Promise.all([
      invoke('hide_recording_border').catch(
        createErrorHandler({ operation: 'hide recording border', silent: true })
      ),
      invoke('hide_countdown_window').catch(
        createErrorHandler({ operation: 'hide countdown window', silent: true })
      ),
      closeWebcamPreview().catch(
        createErrorHandler({ operation: 'close webcam preview', silent: true })
      ),
    ]);

    const restoreMainWindow = () => invoke('restore_main_window').catch(
      createErrorHandler({ operation: 'restore main window', silent: true })
    );

    const resetToolbarState = () => {
      setMode('selection');
      setElapsedTime(0);
      setProgress(0);
    };

    const showOrCloseToolbarAfterCompletion = (closeWindowOnComplete: boolean) => {
      clearCloseWindowOnComplete();

      if (closeWindowOnComplete) {
        currentWindow.close().catch(
          createErrorHandler({ operation: 'close toolbar window', silent: true })
        );
        return;
      }

      currentWindow.show().catch(
        createErrorHandler({ operation: 'show toolbar window', silent: true })
      );
      currentWindow.setFocus().catch(
        createErrorHandler({ operation: 'focus toolbar window', silent: true })
      );
    };

    const handleRecordingCompleted = (state: Extract<RecordingState, { status: 'completed' }>) => {
      recordingLogger.info('Recording COMPLETED. Backend duration:', state.durationSecs, 's, file:', state.outputPath);
      resetRecordingRuntime();
      const closeWindowOnComplete = closeWindowOnCompleteRef?.current ?? false;
      resetToolbarState();
      Promise.all([
        hideRecordingSurfaces(),
        restoreMainWindow(),
      ]).finally(() => {
        emit('reset-to-startup', null).catch(
          createErrorHandler({ operation: 'reset toolbar to startup', silent: true })
        ).finally(() => {
          showOrCloseToolbarAfterCompletion(closeWindowOnComplete);
        });
      });
    };

    const handleRecordingIdle = () => {
      resetRecordingRuntime();
      clearCloseWindowOnComplete();
      resetToolbarState();
      Promise.all([
        hideRecordingSurfaces(),
        restoreMainWindow(),
      ]).finally(() => {
        currentWindow.close().catch(
          createErrorHandler({ operation: 'close toolbar window', silent: true })
        );
      });
    };

    const handleRecordingError = (state: Extract<RecordingState, { status: 'error' }>) => {
      resetRecordingRuntime();
      clearCloseWindowOnComplete();
      setErrorMessage(state.message);
      setMode('error');
      hideRecordingSurfaces();
      errorRecoveryTimeout = setTimeout(() => {
        errorRecoveryTimeout = null;
        resetToolbarState();
        setErrorMessage(undefined);
        restoreMainWindow().finally(() => {
          currentWindow.close().catch(
            createErrorHandler({ operation: 'close toolbar window', silent: true })
          );
        });
      }, 3000);
    };

    const handleRecordingStarted = (state: Extract<RecordingState, { status: 'recording' }>) => {
      recordingLogger.debug('Received recording state, backend elapsedSecs:', state.elapsedSecs);
      if (!isRecordingActiveRef.current) {
        isRecordingActiveRef.current = true;
        timerBaseTimeRef.current = 0;
        timerStartedAtRef.current = null;
        setElapsedTime(0);
        recordingLogger.debug('Recording mode ACTIVATED, timer reset');
      }
      setMode('recording');
    };

    const handleRecordingProcessing = (
      state: Extract<RecordingState, { status: 'processing' }>
    ) => {
      recordingLogger.debug('Received processing state - timer should stop now');
      setMode('processing');
      setProgress(state.progress);
    };

    const ignoreRecordingState = () => undefined;

    const recordingStateHandlers = {
      countdown: ignoreRecordingState,
      starting: ignoreRecordingState,
      recording: handleRecordingStarted,
      paused: () => setMode('paused'),
      processing: handleRecordingProcessing,
      completed: handleRecordingCompleted,
      idle: handleRecordingIdle,
      error: handleRecordingError,
    } satisfies {
      [Status in RecordingState['status']]: (
        state: Extract<RecordingState, { status: Status }>
      ) => void;
    };

    const handleRecordingStateChanged = (state: RecordingState) => {
      recordingStateHandlers[state.status](state as never);
    };

    const setupListeners = async () => {
      // Recording state changes
      unlistenState = await listen<RecordingState>('recording-state-changed', (event) => {
        handleRecordingStateChanged(event.payload);
      });

      // Countdown ticks from the self-driven countdown overlay window
      unlistenCountdownTick = await listen<{ secondsRemaining: number }>('countdown-tick', (event) => {
        setMode('starting');
        setCountdownSeconds(event.payload.secondsRemaining);
      });

      // Recording format
      unlistenFormat = await listen<RecordingFormat>('recording-format', (event) => {
        setFormat(event.payload);
      });

      // Overlay closed (not during recording) - just clean up webcam, don't close toolbar
      unlistenClosed = await listen('capture-overlay-closed', async () => {
        await closeWebcamPreview();
        // Don't close toolbar - user may want to select a different source
      });

      // Reselecting - just close webcam preview, keep toolbar open
      unlistenReselecting = await listen('capture-overlay-reselecting', async () => {
        // Close webcam preview window during selection (enabled setting preserved in Rust)
        try {
          await closeWebcamPreview();
        } catch {
          // Ignore
        }
        // Don't close toolbar - keep it open for the new selection
      });

      // If the effect was cleaned up while listeners were still registering,
      // tear down anything that finished resolving after unmount.
      if (cancelled) {
        unlistenAll();
      }
    };

    setupListeners().catch(
      createErrorHandler({ operation: 'set up recording event listeners' })
    );

    return () => {
      cancelled = true;
      if (errorRecoveryTimeout) {
        clearTimeout(errorRecoveryTimeout);
        errorRecoveryTimeout = null;
      }
      unlistenAll();
    };
  }, [closeWindowOnCompleteRef, setMode]);

  return {
    mode,
    setMode,
    format,
    elapsedTime,
    progress,
    errorMessage,
    countdownSeconds,
    modeRef,
    recordingInitiatedRef,
    isRecordingActiveRef,
  };
}
