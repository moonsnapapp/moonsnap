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

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, once } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Toaster } from 'sonner';
import { Titlebar } from '../components/Titlebar/Titlebar';
import { CaptureToolbar } from '../components/CaptureToolbar/CaptureToolbar';
import type { CaptureSource } from '../components/CaptureToolbar/SourceSelector';
import {
  useCaptureSettingsStore,
  type CaptureSourceMode,
  type AfterRecordingAction,
} from '../stores/captureSettingsStore';
import { useWebcamSettingsStore } from '../stores/webcamSettingsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTheme } from '../hooks/useTheme';
import { useRecordingEvents } from '../hooks/useRecordingEvents';
import { useSelectionEvents } from '../hooks/useSelectionEvents';
import { useWebcamCoordination } from '../hooks/useWebcamCoordination';
import { useToolbarPositioning } from '../hooks/useToolbarPositioning';
import type { CaptureType } from '../types';
import { toolbarLogger } from '../utils/logger';
import {
  isAutoStartRecordingSession,
  shouldSuppressToolbarUntilRecording,
} from './captureToolbarFlow';
import { RecordingModeChooser } from '../components/CaptureToolbar/RecordingModeChooser';

interface StartupToolbarContext {
  captureType?: CaptureType;
  sourceMode?: CaptureSourceMode;
  autoStartAreaSelection?: boolean;
}

const CaptureToolbarWindow: React.FC = () => {
  useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const {
    settings,
    activeMode: captureType,
    sourceMode: captureSource,
    isInitialized,
    loadSettings,
    setActiveMode: setCaptureType,
    setSourceMode: setCaptureSource,
    promptRecordingMode,
  } = useCaptureSettingsStore();

  const { settings: webcamSettings } = useWebcamSettingsStore();

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

  const [showModeChooser, setShowModeChooser] = useState(false);
  const skipModePromptRef = useRef(false);

  const pendingStartupContextRef = useRef<StartupToolbarContext | null>(null);
  const shouldAutoStartAreaSelectionRef = useRef(false);
  const autoStartRecordingTriggeredRef = useRef(false);

  const {
    selectionBounds,
    selectionBoundsRef,
    selectionConfirmed,
    autoStartRecording,
    setAutoStartRecording,
  } = useSelectionEvents();

  useEffect(() => {
    invoke('capture_toolbar_ready').catch((e) => {
      toolbarLogger.warn('Failed to notify capture toolbar readiness:', e);
    });
  }, []);

  const showToolbarInRecording = useCaptureSettingsStore(
    (s) => s.showToolbarInRecording
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
    selectionAutoStartRecording: selectionBounds.autoStartRecording,
    captureType,
    promptRecordingMode,
    mode,
  });

  const isRecordingHudMode =
    mode === 'starting' ||
    mode === 'recording' ||
    mode === 'paused' ||
    mode === 'processing' ||
    mode === 'error';

  const suppressPrimaryToolbarDuringRecording = Boolean(
    selectionConfirmed &&
    isRecordingHudMode
  );

  useEffect(() => {
    document.documentElement.classList.toggle('capture-toolbar-recording-window', isRecordingHudMode);
    document.body.classList.toggle('capture-toolbar-recording-window', isRecordingHudMode);

    return () => {
      document.documentElement.classList.remove('capture-toolbar-recording-window');
      document.body.classList.remove('capture-toolbar-recording-window');
    };
  }, [isRecordingHudMode]);

  useToolbarPositioning({
    containerRef,
    contentRef,
    selectionConfirmed,
    mode,
    suppressWindowShow: suppressToolbarUntilRecording || suppressPrimaryToolbarDuringRecording,
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

        // Dismiss mode chooser and return to toolbar
        if (showModeChooser) {
          setShowModeChooser(false);
          return;
        }

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
  }, [mode, selectionConfirmed, closeWebcamPreview, showModeChooser]);

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
        // Show mode chooser before video recording if enabled
        if (captureType === 'video' && !skipModePromptRef.current && promptRecordingMode) {
          setShowModeChooser(true);
          return;
        }
        skipModePromptRef.current = false;

        recordingInitiatedRef.current = true;
        setMode('starting');

        const systemAudioEnabled = captureType === 'video' ? settings.video.captureSystemAudio : false;
        const fps = captureType === 'video' ? settings.video.fps : settings.gif.fps;
        const quality = captureType === 'video' ? settings.video.quality : 80;
        const gifQualityPreset = settings.gif.qualityPreset;
        const afterRecordingAction = useCaptureSettingsStore.getState().afterRecordingAction;
        const quickCapture = captureType === 'video' ? afterRecordingAction === 'save' : true;
        const countdownSecs = quickCapture ? 0 : (captureType === 'video' ? settings.video.countdownSecs : settings.gif.countdownSecs);
        const includeCursor = captureType === 'video'
          ? (quickCapture ? settings.video.includeCursor : false)
          : settings.gif.includeCursor;
        const maxDurationSecs = captureType === 'video' ? settings.video.maxDurationSecs : settings.gif.maxDurationSecs;
        const microphoneDeviceIndex = settings.video.microphoneDeviceIndex;

        if (captureType === 'video') {
          await invoke('set_hide_desktop_icons', { enabled: settings.video.hideDesktopIcons });
          await invoke('set_webcam_enabled', { enabled: !quickCapture && webcamSettings.enabled });
        } else {
          await invoke('set_webcam_enabled', { enabled: false });
        }

        const overlayReadyPromise = new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, 500);
          import('@tauri-apps/api/event').then(({ listen }) => {
            listen('overlay-ready-for-recording', () => {
              clearTimeout(timeoutId);
              resolve();
            });
          });
        });

        await invoke('capture_overlay_confirm', { action: 'recording' });
        await overlayReadyPromise;

        const bounds = selectionBoundsRef.current;

        await invoke('show_recording_border', {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });

        const formatStr = captureType === 'gif' ? 'gif' : 'mp4';
        await emit('recording-format', formatStr);

        if (countdownSecs > 0) {
          const countdownReady = new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 2000);
            once('countdown-window-ready', () => {
              clearTimeout(timeout);
              resolve();
            });
          });

          await invoke('show_countdown_window', {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            countdownSecs,
          });

          await countdownReady;
        }

        const recordingMode = bounds.sourceType === 'display' && bounds.monitorIndex != null
          ? { type: 'monitor' as const, monitorIndex: bounds.monitorIndex }
          : bounds.windowId
            ? { type: 'window' as const, windowId: bounds.windowId }
            : { type: 'region' as const, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };

        const recordingSettings = {
          format: captureType === 'gif' ? 'gif' : 'mp4',
          mode: recordingMode,
          fps,
          maxDurationSecs: maxDurationSecs ?? null,
          includeCursor,
          audio: {
            captureSystemAudio: systemAudioEnabled,
            systemAudioDeviceId: captureType === 'video' ? (settings.video.systemAudioDeviceId ?? null) : null,
            microphoneDeviceIndex: microphoneDeviceIndex ?? null,
          },
          quality,
          gifQualityPreset,
          countdownSecs,
          quickCapture,
        };

        await invoke('start_recording', { settings: recordingSettings });
      }
    } catch (e) {
      toolbarLogger.error('Failed to capture:', e);
      recordingInitiatedRef.current = false;
      setAutoStartRecording(false);
      setMode('selection');
    }
  }, [captureType, captureSource, promptRecordingMode, selectionConfirmed, settings, webcamSettings.enabled, selectionBoundsRef, recordingInitiatedRef, setAutoStartRecording, setMode]);

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
    setAutoStartRecording,
  ]);

  useEffect(() => {
    if (
      autoStartRecording &&
      (mode === 'recording' || mode === 'paused' || mode === 'error')
    ) {
      setAutoStartRecording(false);
    }
  }, [autoStartRecording, mode, setAutoStartRecording]);

  useEffect(() => {
    if (
      !selectionConfirmed ||
      (mode !== 'starting' && mode !== 'recording' && mode !== 'paused' && mode !== 'processing')
    ) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const currentWindow = getCurrentWebviewWindow();
      const showToolbarInCapture = useCaptureSettingsStore.getState().showToolbarInRecording;
      try {
        const [position, size] = await Promise.all([
          currentWindow.outerPosition(),
          currentWindow.outerSize(),
        ]);

        await invoke('show_recording_controls', {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          includeInCapture: showToolbarInCapture,
        });
        await currentWindow.hide();
      } catch (e) {
        toolbarLogger.error('Failed to swap to recording controls window:', e);
      }
    }, 80);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [mode, selectionBounds, selectionConfirmed, showToolbarInRecording]);

  useEffect(() => {
    if (mode === 'starting' || mode === 'recording' || mode === 'paused' || mode === 'processing') {
      return;
    }

    invoke('close_recording_controls').catch((e) => {
      toolbarLogger.error('Failed to close recording controls window after recording:', e);
    });
  }, [mode]);

  const handleTitlebarClose = useCallback(async () => {
    try {
      await invoke('capture_overlay_cancel');
    } catch {
      // Overlay may not be running.
    }
    await closeWebcamPreview();
  }, [closeWebcamPreview]);

  const handleModeChooserSelect = useCallback((action: AfterRecordingAction, remember: boolean) => {
    const store = useCaptureSettingsStore.getState();
    store.setAfterRecordingAction(action);
    if (remember) {
      store.setPromptRecordingMode(false);
    }
    setShowModeChooser(false);
    // Skip the prompt check on the next handleCapture call
    skipModePromptRef.current = true;
    setTimeout(() => {
      void handleCapture();
    }, 50);
  }, [handleCapture]);

  const handleOpenLibrary = useCallback(async () => {
    try {
      await invoke('show_library_window');
    } catch (e) {
      toolbarLogger.error('Failed to open library:', e);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={`app-container ${isRecordingHudMode ? 'app-container--recording-hud' : ''}`}
    >
      {!isRecordingHudMode && (
        <Titlebar
          title="MoonSnap Capture"
          showMaximize={false}
          onClose={handleTitlebarClose}
          onOpenLibrary={handleOpenLibrary}
          onOpenSettings={handleOpenSettings}
        />
      )}
      <div ref={toolbarRef} className="toolbar-container">
        <div className="toolbar-animated-wrapper">
          <div ref={contentRef} className="toolbar-content-measure">
            {showModeChooser ? (
              <RecordingModeChooser onSelect={handleModeChooserSelect} onBack={() => setShowModeChooser(false)} />
            ) : (
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
                minimalChrome={isRecordingHudMode ? 'floating' : 'window'}
                countdownSeconds={countdownSeconds}
                onDimensionChange={handleDimensionChange}
                onOpenSettings={handleOpenSettings}
              />
            )}
          </div>
        </div>
      </div>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'rgba(0, 0, 0, 0.85)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
          },
        }}
      />
    </div>
  );
};

export default CaptureToolbarWindow;
