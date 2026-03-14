import { invoke } from '@tauri-apps/api/core';
import { emit, once } from '@tauri-apps/api/event';

import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { useWebcamSettingsStore } from '@/stores/webcamSettingsStore';
import type { SelectionBounds } from '@/hooks/useSelectionEvents';
import type { CaptureType } from '@/types';
import { toolbarLogger } from '@/utils/logger';

interface RecordingHudAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  centerOnSelection?: boolean;
}

interface StartRecordingCaptureFlowOptions {
  captureType: Extract<CaptureType, 'video' | 'gif'>;
  selection: SelectionBounds;
  hudAnchor: RecordingHudAnchor;
  prepareRecording?: boolean;
  onBeforeOverlayConfirm?: () => Promise<void> | void;
}

function getRecordingMode(selection: SelectionBounds) {
  if (selection.sourceType === 'display' && selection.monitorIndex != null) {
    return { type: 'monitor' as const, monitorIndex: selection.monitorIndex };
  }

  if (selection.windowId) {
    return { type: 'window' as const, windowId: selection.windowId };
  }

  return {
    type: 'region' as const,
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  };
}

export async function startRecordingCaptureFlow({
  captureType,
  selection,
  hudAnchor,
  prepareRecording = false,
  onBeforeOverlayConfirm,
}: StartRecordingCaptureFlowOptions): Promise<void> {
  const captureSettingsStore = useCaptureSettingsStore.getState();
  const webcamSettings = useWebcamSettingsStore.getState().settings;
  const { settings, afterRecordingAction, showToolbarInRecording } = captureSettingsStore;

  const quickCapture = captureType === 'video' ? afterRecordingAction === 'save' : true;
  const format = captureType === 'gif' ? 'gif' : 'mp4';

  if (prepareRecording && !quickCapture) {
    await invoke('prepare_recording', { format }).catch((error) => {
      toolbarLogger.warn('Failed to prepare recording for quick flow:', error);
    });
  }

  await onBeforeOverlayConfirm?.();

  const systemAudioEnabled = captureType === 'video' ? settings.video.captureSystemAudio : false;
  const fps = captureType === 'video' ? settings.video.fps : settings.gif.fps;
  const quality = captureType === 'video' ? settings.video.quality : 80;
  const gifQualityPreset = settings.gif.qualityPreset;
  const countdownSecs = quickCapture
    ? 0
    : (captureType === 'video' ? settings.video.countdownSecs : settings.gif.countdownSecs);
  const includeCursor = captureType === 'video'
    ? (quickCapture ? settings.video.includeCursor : false)
    : settings.gif.includeCursor;
  const maxDurationSecs =
    captureType === 'video' ? settings.video.maxDurationSecs : settings.gif.maxDurationSecs;
  const microphoneDeviceIndex = settings.video.microphoneDeviceIndex;

  if (captureType === 'video') {
    await invoke('set_hide_desktop_icons', { enabled: settings.video.hideDesktopIcons });
    await invoke('set_webcam_enabled', { enabled: !quickCapture && webcamSettings.enabled });
  } else {
    await invoke('set_webcam_enabled', { enabled: false });
  }

  const overlayReadyPromise = new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(resolve, 500);
    once('overlay-ready-for-recording', () => {
      clearTimeout(timeoutId);
      resolve();
    }).catch(() => {
      clearTimeout(timeoutId);
      resolve();
    });
  });

  await invoke('capture_overlay_confirm', { action: 'recording' });
  await overlayReadyPromise;

  await invoke('show_recording_controls', {
    x: hudAnchor.x,
    y: hudAnchor.y,
    width: hudAnchor.width,
    height: hudAnchor.height,
    includeInCapture: showToolbarInRecording,
    centerOnSelection: hudAnchor.centerOnSelection ?? false,
    microphoneDeviceIndex: microphoneDeviceIndex ?? null,
    systemAudioEnabled: systemAudioEnabled,
  });

  await invoke('show_recording_border', {
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  });

  await emit('recording-format', format);

  if (countdownSecs > 0) {
    const countdownReady = new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(resolve, 2000);
      once('countdown-window-ready', () => {
        clearTimeout(timeoutId);
        resolve();
      }).catch(() => {
        clearTimeout(timeoutId);
        resolve();
      });
    });

    await invoke('show_countdown_window', {
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height,
      countdownSecs,
    });

    await countdownReady;
  }

  await invoke('start_recording', {
    settings: {
      format,
      mode: getRecordingMode(selection),
      fps,
      maxDurationSecs: maxDurationSecs ?? null,
      includeCursor,
      audio: {
        captureSystemAudio: systemAudioEnabled,
        systemAudioDeviceId: captureType === 'video'
          ? (settings.video.systemAudioDeviceId ?? null)
          : null,
        microphoneDeviceIndex: microphoneDeviceIndex ?? null,
      },
      quality,
      gifQualityPreset,
      countdownSecs,
      quickCapture,
    },
  });
}
