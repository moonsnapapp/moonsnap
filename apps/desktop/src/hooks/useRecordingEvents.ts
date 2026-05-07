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
  const restoreToolbarOnIdleRef = useRef(false);

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
    let unlistenState: UnlistenFn | null = null;
    let unlistenFormat: UnlistenFn | null = null;
    let unlistenClosed: UnlistenFn | null = null;
    let unlistenReselecting: UnlistenFn | null = null;
    let unlistenCountdownTick: UnlistenFn | null = null;
    let unlistenCancelledFromControls: UnlistenFn | null = null;

    const currentWindow = getCurrentWebviewWindow();

    // Helper to close webcam preview - uses store directly to avoid stale closures
    const closeWebcamPreview = async () => {
      try {
        await useWebcamSettingsStore.getState().closePreview();
      } catch {
        // Ignore
      }
    };

    const setupListeners = async () => {
      // Recording state changes
      unlistenState = await listen<RecordingState>('recording-state-changed', (event) => {
        const state = event.payload;

        switch (state.status) {
          case 'countdown':
            // Backend countdown events are ignored for display purposes.
            // The countdown overlay window drives ticks via 'countdown-tick' events
            // to keep both the overlay and toolbar perfectly in sync.
            break;

          case 'recording':
            recordingLogger.debug('Received recording state, backend elapsedSecs:', state.elapsedSecs);
            if (!isRecordingActiveRef.current) {
              // First time entering recording - reset timer
              isRecordingActiveRef.current = true;
              timerBaseTimeRef.current = 0;
              timerStartedAtRef.current = null;
              setElapsedTime(0);
              recordingLogger.debug('Recording mode ACTIVATED, timer reset');
            }
            // Just set mode - timer effect handles the counting
            // Don't setElapsedTime here to avoid jumps (timer effect manages display)
            setMode('recording');
            break;

          case 'paused':
            // Just set mode - timer effect cleanup saves current time to base
            // Don't setElapsedTime here to avoid jumps
            setMode('paused');
            break;

          case 'processing':
            recordingLogger.debug('Received processing state - timer should stop now');
            setMode('processing');
            setProgress(state.progress);
            break;

          case 'completed': {
            recordingLogger.info('Recording COMPLETED. Backend duration:', state.durationSecs, 's, file:', state.outputPath);
            isRecordingActiveRef.current = false;
            timerBaseTimeRef.current = 0;
            timerStartedAtRef.current = null;
            const closeWindowOnComplete = closeWindowOnCompleteRef?.current ?? false;
            setMode('selection');
            setElapsedTime(0);
            setProgress(0);
            Promise.all([
              invoke('hide_recording_border').catch(
                createErrorHandler({ operation: 'hide recording border', silent: true })
              ),
              invoke('hide_countdown_window').catch(
                createErrorHandler({ operation: 'hide countdown window', silent: true })
              ),
              invoke('restore_main_window').catch(
                createErrorHandler({ operation: 'restore main window', silent: true })
              ),
              closeWebcamPreview().catch(
                createErrorHandler({ operation: 'close webcam preview', silent: true })
              ),
            ]).finally(() => {
              emit('reset-to-startup', null).catch(
                createErrorHandler({ operation: 'reset toolbar to startup', silent: true })
              ).finally(() => {
                if (closeWindowOnCompleteRef) {
                  closeWindowOnCompleteRef.current = false;
                }

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
              });
            });
            break;
          }
          case 'idle': {
            isRecordingActiveRef.current = false;
            timerBaseTimeRef.current = 0;
            timerStartedAtRef.current = null;
            const shouldRestoreToolbar = restoreToolbarOnIdleRef.current;
            restoreToolbarOnIdleRef.current = false;
            if (closeWindowOnCompleteRef) {
              closeWindowOnCompleteRef.current = false;
            }
            setMode('selection');
            setElapsedTime(0);
            setProgress(0);
            Promise.all([
              invoke('hide_recording_border').catch(
                createErrorHandler({ operation: 'hide recording border', silent: true })
              ),
              invoke('hide_countdown_window').catch(
                createErrorHandler({ operation: 'hide countdown window', silent: true })
              ),
              invoke('restore_main_window').catch(
                createErrorHandler({ operation: 'restore main window', silent: true })
              ),
              closeWebcamPreview().catch(
                createErrorHandler({ operation: 'close webcam preview', silent: true })
              ),
            ]).finally(() => {
              if (shouldRestoreToolbar) {
                currentWindow.show().catch(
                  createErrorHandler({ operation: 'show toolbar window', silent: true })
                );
                currentWindow.setFocus().catch(
                  createErrorHandler({ operation: 'focus toolbar window', silent: true })
                );
                return;
              }

              currentWindow.close().catch(
                createErrorHandler({ operation: 'close toolbar window', silent: true })
              );
            });
            break;
          }

          case 'error':
            isRecordingActiveRef.current = false;
            timerBaseTimeRef.current = 0;
            timerStartedAtRef.current = null;
            if (closeWindowOnCompleteRef) {
              closeWindowOnCompleteRef.current = false;
            }
            setErrorMessage(state.message);
            setMode('error');
            invoke('hide_recording_border').catch(
              createErrorHandler({ operation: 'hide recording border', silent: true })
            );
            invoke('hide_countdown_window').catch(
              createErrorHandler({ operation: 'hide countdown window', silent: true })
            );
            closeWebcamPreview().catch(
              createErrorHandler({ operation: 'close webcam preview', silent: true })
            );
            // Auto-recover after 3 seconds
            setTimeout(() => {
              setMode('selection');
              setElapsedTime(0);
              setProgress(0);
              setErrorMessage(undefined);
              invoke('restore_main_window').catch(
                createErrorHandler({ operation: 'restore main window', silent: true })
              ).finally(() => {
                currentWindow.close().catch(
                  createErrorHandler({ operation: 'close toolbar window', silent: true })
                );
              });
            }, 3000);
            break;
        }
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

      unlistenCancelledFromControls = await listen('recording-cancelled-from-controls', () => {
        restoreToolbarOnIdleRef.current = true;
      });
    };

    setupListeners();

    return () => {
      unlistenState?.();
      unlistenFormat?.();
      unlistenClosed?.();
      unlistenReselecting?.();
      unlistenCountdownTick?.();
      unlistenCancelledFromControls?.();
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
