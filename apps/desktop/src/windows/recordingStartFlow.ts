import { invoke } from '@tauri-apps/api/core';
import { emit, once } from '@tauri-apps/api/event';

import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { useWebcamSettingsStore } from '@/stores/webcamSettingsStore';
import { DEFAULT_SYSTEM_AUDIO_SCOPE } from '@/constants/recording';
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

function waitForEventOrTimeout(eventName: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(resolve, timeoutMs);
    once(eventName, () => {
      clearTimeout(timeoutId);
      resolve();
    }).catch(() => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

function isVideoCapture(captureType: Extract<CaptureType, 'video' | 'gif'>): boolean {
  return captureType === 'video';
}

function getRecordingFormat(captureType: Extract<CaptureType, 'video' | 'gif'>): 'gif' | 'mp4' {
  return captureType === 'gif' ? 'gif' : 'mp4';
}

function getQuickCapture(
  captureType: Extract<CaptureType, 'video' | 'gif'>,
  afterRecordingAction: string
): boolean {
  return captureType === 'video' ? afterRecordingAction === 'save' : true;
}

function getCountdownSecs(
  isVideo: boolean,
  quickCapture: boolean,
  settings: ReturnType<typeof useCaptureSettingsStore.getState>['settings']
): number {
  if (quickCapture) {
    return 0;
  }

  return isVideo ? settings.video.countdownSecs : settings.gif.countdownSecs;
}

function getIncludeCursor(
  isVideo: boolean,
  quickCapture: boolean,
  settings: ReturnType<typeof useCaptureSettingsStore.getState>['settings']
): boolean {
  return isVideo
    ? (quickCapture ? settings.video.includeCursor : false)
    : settings.gif.includeCursor;
}

function getMaxDurationSecs(
  isVideo: boolean,
  settings: ReturnType<typeof useCaptureSettingsStore.getState>['settings']
): number | null {
  return isVideo
    ? settings.video.maxDurationSecs
    : (settings.gif.maxDurationSecs === 0 ? null : settings.gif.maxDurationSecs);
}

function getRecordingAudioSettings(
  isVideo: boolean,
  settings: ReturnType<typeof useCaptureSettingsStore.getState>['settings'],
  microphoneDeviceIndex: number | null,
  systemAudioEnabled: boolean
) {
  return {
    captureSystemAudio: systemAudioEnabled,
    systemAudioDeviceId: isVideo ? (settings.video.systemAudioDeviceId ?? null) : null,
    systemAudioScope: isVideo ? settings.video.systemAudioScope : DEFAULT_SYSTEM_AUDIO_SCOPE,
    allowFallbackToAllSystemAudio: isVideo
      ? settings.video.allowFallbackToAllSystemAudio
      : false,
    microphoneDeviceIndex: microphoneDeviceIndex ?? null,
  };
}

function getRecordingFlowSettings(
  captureType: Extract<CaptureType, 'video' | 'gif'>,
  selection: SelectionBounds
) {
  const captureSettingsStore = useCaptureSettingsStore.getState();
  const webcamSettings = useWebcamSettingsStore.getState().settings;
  const { settings, afterRecordingAction, showToolbarInRecording } = captureSettingsStore;
  const quickCapture = getQuickCapture(captureType, afterRecordingAction);
  const format = getRecordingFormat(captureType);
  const isVideo = isVideoCapture(captureType);
  const systemAudioEnabled = isVideo ? settings.video.captureSystemAudio : false;
  const microphoneDeviceIndex = isVideo ? settings.video.microphoneDeviceIndex : null;
  const fps = isVideo ? settings.video.fps : settings.gif.fps;
  const quality = isVideo ? settings.video.quality : 80;
  const countdownSecs = getCountdownSecs(isVideo, quickCapture, settings);
  const includeCursor = getIncludeCursor(isVideo, quickCapture, settings);
  const maxDurationSecs = getMaxDurationSecs(isVideo, settings);

  return {
    settings,
    webcamSettings,
    showToolbarInRecording,
    quickCapture,
    format,
    systemAudioEnabled,
    fps,
    quality,
    gifQualityPreset: settings.gif.qualityPreset,
    countdownSecs,
    includeCursor,
    maxDurationSecs,
    microphoneDeviceIndex,
    startRecordingSettings: {
      format,
      mode: getRecordingMode(selection),
      fps,
      maxDurationSecs,
      includeCursor,
      audio: getRecordingAudioSettings(
        isVideo,
        settings,
        microphoneDeviceIndex,
        systemAudioEnabled
      ),
      quality,
      gifQualityPreset: settings.gif.qualityPreset,
      countdownSecs,
      quickCapture,
    },
  };
}

async function prepareRecordingIfNeeded(
  prepareRecording: boolean,
  quickCapture: boolean,
  format: 'gif' | 'mp4'
) {
  if (!prepareRecording || quickCapture) {
    return;
  }

  await invoke('prepare_recording', { format }).catch((error) => {
    toolbarLogger.warn('Failed to prepare recording for quick flow:', error);
  });
}

async function applyPreRecordingWindowState({
  captureType,
  quickCapture,
  webcamEnabled,
  hideDesktopIcons,
}: {
  captureType: Extract<CaptureType, 'video' | 'gif'>;
  quickCapture: boolean;
  webcamEnabled: boolean;
  hideDesktopIcons: boolean;
}) {
  if (captureType === 'video') {
    await invoke('set_hide_desktop_icons', { enabled: hideDesktopIcons });
    await invoke('set_webcam_enabled', { enabled: !quickCapture && webcamEnabled });
    return;
  }

  await invoke('set_webcam_enabled', { enabled: false });
}

async function showRecordingHud({
  hudAnchor,
  showToolbarInRecording,
  microphoneDeviceIndex,
  systemAudioEnabled,
  format,
}: {
  hudAnchor: RecordingHudAnchor;
  showToolbarInRecording: boolean;
  microphoneDeviceIndex: number | null;
  systemAudioEnabled: boolean;
  format: 'gif' | 'mp4';
}) {
  await invoke('show_recording_controls', {
    x: hudAnchor.x,
    y: hudAnchor.y,
    width: hudAnchor.width,
    height: hudAnchor.height,
    includeInCapture: showToolbarInRecording,
    centerOnSelection: hudAnchor.centerOnSelection ?? false,
    microphoneDeviceIndex: microphoneDeviceIndex ?? null,
    systemAudioEnabled,
    recordingFormat: format,
  });
}

async function showRecordingBorder(selection: SelectionBounds) {
  await invoke('show_recording_border', {
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  });
}

async function showCountdownIfNeeded(selection: SelectionBounds, countdownSecs: number) {
  if (countdownSecs <= 0) {
    return;
  }

  const countdownReady = waitForEventOrTimeout('countdown-window-ready', 2000);
  await invoke('show_countdown_window', {
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
    countdownSecs,
  });
  await countdownReady;
}

export async function startRecordingCaptureFlow({
  captureType,
  selection,
  hudAnchor,
  prepareRecording = false,
  onBeforeOverlayConfirm,
}: StartRecordingCaptureFlowOptions): Promise<void> {
  const flowSettings = getRecordingFlowSettings(captureType, selection);

  await prepareRecordingIfNeeded(
    prepareRecording,
    flowSettings.quickCapture,
    flowSettings.format
  );
  await onBeforeOverlayConfirm?.();

  await applyPreRecordingWindowState({
    captureType,
    quickCapture: flowSettings.quickCapture,
    webcamEnabled: flowSettings.webcamSettings.enabled,
    hideDesktopIcons: flowSettings.settings.video.hideDesktopIcons,
  });

  const overlayReadyPromise = waitForEventOrTimeout('overlay-ready-for-recording', 500);
  await invoke('capture_overlay_confirm', { action: 'recording' });
  await overlayReadyPromise;

  await showRecordingHud({
    hudAnchor,
    showToolbarInRecording: flowSettings.showToolbarInRecording,
    microphoneDeviceIndex: flowSettings.microphoneDeviceIndex,
    systemAudioEnabled: flowSettings.systemAudioEnabled,
    format: flowSettings.format,
  });

  await showRecordingBorder(selection);
  await emit('recording-format', flowSettings.format);
  await showCountdownIfNeeded(selection, flowSettings.countdownSecs);

  await invoke('start_recording', {
    settings: flowSettings.startRecordingSettings,
  });
}
