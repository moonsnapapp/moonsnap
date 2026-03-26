import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_SAVED_AREA_SELECTIONS,
  useCaptureSettingsStore,
} from './captureSettingsStore';

const DEFAULT_STORE_SETTINGS = {
  screenshot: {
    format: 'png' as const,
    jpgQuality: 85,
    includeCursor: true,
  },
  video: {
    format: 'mp4' as const,
    quality: 80,
    fps: 30,
    maxDurationSecs: null,
    includeCursor: true,
    captureSystemAudio: true,
    systemAudioDeviceId: null,
    microphoneDeviceIndex: null,
    captureWebcam: false,
    countdownSecs: 3,
    hideDesktopIcons: false,
    quickCapture: false,
  },
  gif: {
    qualityPreset: 'balanced' as const,
    fps: 15,
    maxDurationSecs: 30,
    includeCursor: true,
    countdownSecs: 3,
  },
};

describe('captureSettingsStore reusable areas', () => {
  beforeEach(() => {
    useCaptureSettingsStore.setState({
      settings: structuredClone(DEFAULT_STORE_SETTINGS),
      isLoading: false,
      isInitialized: true,
      activeMode: 'video',
      sourceMode: 'area',
      copyToClipboardAfterCapture: true,
      showPreviewAfterCapture: true,
      afterRecordingAction: 'preview',
      promptRecordingMode: true,
      snapToolbarToSelection: true,
      showToolbarInRecording: false,
      lastAreaSelection: null,
      savedAreaSelections: [],
    });
  });

  it('normalizes the last area selection before saving it', () => {
    useCaptureSettingsStore.getState().setLastAreaSelection({
      x: 10.4,
      y: 20.6,
      width: 400.2,
      height: 220.8,
    });

    expect(useCaptureSettingsStore.getState().lastAreaSelection).toEqual({
      x: 10,
      y: 21,
      width: 400,
      height: 221,
    });
  });

  it('ignores reusable areas smaller than the minimum size', () => {
    useCaptureSettingsStore.getState().setLastAreaSelection({
      x: 0,
      y: 0,
      width: 12,
      height: 18,
    });

    expect(useCaptureSettingsStore.getState().lastAreaSelection).toBeNull();
  });

  it('saves a new area preset and mirrors it to the last area', () => {
    const savedArea = useCaptureSettingsStore.getState().saveAreaSelection({
      x: 32,
      y: 48,
      width: 1280,
      height: 720,
    });

    expect(savedArea).toMatchObject({
      name: 'Area 1',
      x: 32,
      y: 48,
      width: 1280,
      height: 720,
    });
    expect(useCaptureSettingsStore.getState().lastAreaSelection).toEqual({
      x: 32,
      y: 48,
      width: 1280,
      height: 720,
    });
    expect(useCaptureSettingsStore.getState().savedAreaSelections).toHaveLength(1);
  });

  it('reuses the existing preset when saving the same area twice', () => {
    const firstArea = useCaptureSettingsStore.getState().saveAreaSelection({
      x: 50,
      y: 60,
      width: 900,
      height: 600,
    });
    const secondArea = useCaptureSettingsStore.getState().saveAreaSelection({
      x: 50,
      y: 60,
      width: 900,
      height: 600,
    });

    expect(secondArea?.id).toBe(firstArea?.id);
    expect(useCaptureSettingsStore.getState().savedAreaSelections).toHaveLength(1);
  });

  it('deletes saved area presets without clearing the last area', () => {
    const savedArea = useCaptureSettingsStore.getState().saveAreaSelection({
      x: 120,
      y: 140,
      width: 1024,
      height: 576,
    });

    useCaptureSettingsStore.getState().deleteAreaSelection(savedArea!.id);

    expect(useCaptureSettingsStore.getState().savedAreaSelections).toEqual([]);
    expect(useCaptureSettingsStore.getState().lastAreaSelection).toEqual({
      x: 120,
      y: 140,
      width: 1024,
      height: 576,
    });
  });

  it('limits named saved areas to three entries', () => {
    for (let index = 0; index < MAX_SAVED_AREA_SELECTIONS; index += 1) {
      useCaptureSettingsStore.getState().saveAreaSelection({
        x: index * 10,
        y: index * 20,
        width: 800,
        height: 450,
      });
    }

    const overflowArea = useCaptureSettingsStore.getState().saveAreaSelection({
      x: 999,
      y: 888,
      width: 1280,
      height: 720,
    });

    expect(overflowArea).toBeNull();
    expect(useCaptureSettingsStore.getState().savedAreaSelections).toHaveLength(
      MAX_SAVED_AREA_SELECTIONS
    );
    expect(useCaptureSettingsStore.getState().savedAreaSelections).not.toContainEqual(
      expect.objectContaining({ x: 999, y: 888 })
    );
  });
});
