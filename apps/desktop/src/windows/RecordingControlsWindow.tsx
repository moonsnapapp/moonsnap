import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import {
  CaptureToolbar,
  type RecordingAudioConfig,
  type ToolbarMode,
} from '@/components/CaptureToolbar/CaptureToolbar';
import { useCaptureBlockedPulse } from '@/hooks/useCaptureBlockedPulse';
import { useFocusedShortcutDispatch } from '@/hooks/useFocusedShortcutDispatch';
import { useTheme } from '@/hooks/useTheme';
import type { RecordingFormat, RecordingState } from '@/types';
import { toolbarLogger } from '@/utils/logger';

declare global {
  interface Window {
    __MOONSNAP_RECORDING_AUDIO_CONFIG?: RecordingAudioConfig;
    __MOONSNAP_RECORDING_FORMAT?: RecordingFormat;
  }
}

function getInitialRecordingAudioConfig(): RecordingAudioConfig {
  return window.__MOONSNAP_RECORDING_AUDIO_CONFIG ?? {
    microphoneDeviceIndex: null,
    systemAudioEnabled: true,
  };
}

function getInitialRecordingFormat(): RecordingFormat {
  return window.__MOONSNAP_RECORDING_FORMAT ?? 'mp4';
}

const RecordingControlsWindow: React.FC = () => {
  useTheme();
  useFocusedShortcutDispatch();
  const isCaptureBlockedPulseActive = useCaptureBlockedPulse();

  const [mode, setMode] = useState<ToolbarMode>('starting');
  const [format, setFormat] = useState<RecordingFormat>(getInitialRecordingFormat);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState<number | undefined>();
  const [recordingAudioConfig] = useState<RecordingAudioConfig>(getInitialRecordingAudioConfig);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const timerBaseTimeRef = useRef(0);
  const timerStartedAtRef = useRef<number | null>(null);
  const isRecordingActiveRef = useRef(false);
  const isClosingRef = useRef(false);

  const closeCurrentWindow = useCallback(async () => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    await getCurrentWindow().close().catch((error) => {
      toolbarLogger.error('Failed to close recording controls window:', error);
    });
  }, []);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(() => {
      isClosingRef.current = true;
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resizeWindow = async () => {
      if (isClosingRef.current) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);

      if (
        width === 0 ||
        height === 0 ||
        (width === lastSizeRef.current.width && height === lastSizeRef.current.height)
      ) {
        return;
      }

      lastSizeRef.current = { width, height };

      try {
        const window = getCurrentWindow();
        await window.setSize(new LogicalSize(width, height));
      } catch (error) {
        toolbarLogger.error('Failed to resize recording controls window:', error);
      }
    };

    void resizeWindow();

    const observer = new ResizeObserver(() => {
      void resizeWindow();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (mode !== 'recording') {
      return;
    }

    timerStartedAtRef.current = Date.now();

    const interval = window.setInterval(() => {
      if (timerStartedAtRef.current === null) {
        return;
      }

      const currentSegment = (Date.now() - timerStartedAtRef.current) / 1000;
      setElapsedTime(timerBaseTimeRef.current + currentSegment);
    }, 100);

    return () => {
      clearInterval(interval);
      if (timerStartedAtRef.current !== null) {
        timerBaseTimeRef.current += (Date.now() - timerStartedAtRef.current) / 1000;
        timerStartedAtRef.current = null;
      }
    };
  }, [mode]);

  useEffect(() => {
    let unlistenState: UnlistenFn | null = null;
    let unlistenFormat: UnlistenFn | null = null;
    let unlistenCountdown: UnlistenFn | null = null;

    const setup = async () => {
      unlistenState = await listen<RecordingState>('recording-state-changed', (event) => {
        const state = event.payload;

        switch (state.status) {
          case 'countdown':
            setMode('starting');
            break;
          case 'recording':
            if (!isRecordingActiveRef.current) {
              isRecordingActiveRef.current = true;
              timerBaseTimeRef.current = 0;
              timerStartedAtRef.current = null;
              setElapsedTime(0);
            }
            setCountdownSeconds(undefined);
            setMode('recording');
            break;
          case 'paused':
            setMode('paused');
            break;
          case 'processing':
            isRecordingActiveRef.current = false;
            setMode('processing');
            break;
          case 'idle':
          case 'completed':
            isRecordingActiveRef.current = false;
            setCountdownSeconds(undefined);
            void closeCurrentWindow();
            break;
          case 'error':
            isRecordingActiveRef.current = false;
            setCountdownSeconds(undefined);
            setMode('error');
            window.setTimeout(() => {
              void closeCurrentWindow();
            }, 2500);
            break;
        }
      });

      unlistenFormat = await listen<RecordingFormat>('recording-format', (event) => {
        setFormat(event.payload);
      });

      unlistenCountdown = await listen<{ secondsRemaining: number }>('countdown-tick', (event) => {
        setMode('starting');
        setCountdownSeconds(event.payload.secondsRemaining);
      });
    };

    void setup();

    return () => {
      unlistenState?.();
      unlistenFormat?.();
      unlistenCountdown?.();
    };
  }, [closeCurrentWindow]);

  const handlePause = useCallback(async () => {
    await invoke('pause_recording').catch((error) => {
      toolbarLogger.error('Failed to pause recording from controls window:', error);
    });
  }, []);

  const handleResume = useCallback(async () => {
    await invoke('resume_recording').catch((error) => {
      toolbarLogger.error('Failed to resume recording from controls window:', error);
    });
  }, []);

  const handleStop = useCallback(async () => {
    await invoke('stop_recording').catch((error) => {
      toolbarLogger.error('Failed to stop recording from controls window:', error);
    });
  }, []);

  const handleCancel = useCallback(async () => {
    if (mode === 'processing' || mode === 'error') {
      return;
    }

    await emit('recording-cancelled-from-controls').catch((error) => {
      toolbarLogger.error('Failed to notify capture toolbar about recording cancel:', error);
    });

    await invoke('cancel_recording').catch((error) => {
      toolbarLogger.error('Failed to cancel recording from controls window:', error);
    });
  }, [mode]);

  const handleMouseDown = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Dragging is best-effort only.
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={`recording-controls-shell capture-blocked-feedback${isCaptureBlockedPulseActive ? ' capture-blocked-feedback--active' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <CaptureToolbar
        mode={mode}
        captureType={format === 'gif' ? 'gif' : 'video'}
        width={0}
        height={0}
        format={format}
        elapsedTime={elapsedTime}
        countdownSeconds={countdownSeconds}
        onCapture={() => {}}
        onCaptureTypeChange={() => {}}
        onRedo={() => {}}
        onCancel={handleCancel}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        minimalChrome="floating"
        showRecordingAudioIndicators={format !== 'gif'}
        recordingAudioConfig={recordingAudioConfig}
      />
    </div>
  );
};

export default RecordingControlsWindow;
