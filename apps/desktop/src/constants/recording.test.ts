import { describe, expect, it } from 'vitest';
import {
  normalizeGifSettings,
  normalizeGifSettingsUpdates,
  normalizeVideoSettings,
  normalizeVideoSettingsUpdates,
} from './recording';

describe('recording preset normalization', () => {
  it('normalizes loaded video settings to supported presets', () => {
    expect(
      normalizeVideoSettings({
        format: 'mp4',
        quality: 55,
        fps: 24,
        maxDurationSecs: null,
        includeCursor: true,
        captureSystemAudio: true,
        systemAudioDeviceId: null,
        systemAudioScope: { mode: 'all', targets: [] },
        allowFallbackToAllSystemAudio: false,
        microphoneDeviceIndex: null,
        captureWebcam: false,
        countdownSecs: 4,
        hideDesktopIcons: false,
        quickCapture: false,
      }),
    ).toMatchObject({
      fps: 30,
      quality: 60,
      countdownSecs: 3,
    });
  });

  it('normalizes loaded gif settings and preserves unlimited duration', () => {
    expect(
      normalizeGifSettings({
        qualityPreset: 'balanced',
        fps: 23,
        maxDurationSecs: 0,
        includeCursor: true,
        countdownSecs: 4,
      }),
    ).toMatchObject({
      fps: 20,
      maxDurationSecs: 0,
      countdownSecs: 3,
    });
  });

  it('normalizes process-scoped system audio to a single valid target', () => {
    expect(
      normalizeVideoSettings({
        format: 'mp4',
        quality: 80,
        fps: 30,
        maxDurationSecs: null,
        includeCursor: true,
        captureSystemAudio: true,
        systemAudioDeviceId: null,
        systemAudioScope: {
          mode: 'includeProcesses',
          targets: [
            { processId: 0, processName: 'Invalid', windowTitle: null },
            { processId: 42, processName: '  ', windowTitle: ' Browser ' },
            { processId: 84, processName: 'Music', windowTitle: null },
          ],
        },
        allowFallbackToAllSystemAudio: false,
        microphoneDeviceIndex: null,
        captureWebcam: false,
        countdownSecs: 3,
        hideDesktopIcons: false,
        quickCapture: false,
      }),
    ).toMatchObject({
      systemAudioScope: {
        mode: 'includeProcesses',
        targets: [{ processId: 42, processName: 'Process 42', windowTitle: 'Browser' }],
      },
    });
  });

  it('normalizes empty process-scoped audio back to all system audio', () => {
    expect(
      normalizeVideoSettingsUpdates({
        systemAudioScope: {
          mode: 'excludeProcesses',
          targets: [],
        },
      }),
    ).toEqual({
      systemAudioScope: { mode: 'all', targets: [] },
    });
  });

  it('normalizes partial video updates to supported presets', () => {
    expect(
      normalizeVideoSettingsUpdates({
        fps: 26,
        quality: 79,
        countdownSecs: 1,
      }),
    ).toEqual({
      fps: 30,
      quality: 80,
      countdownSecs: 0,
    });
  });

  it('normalizes partial gif updates to supported presets', () => {
    expect(
      normalizeGifSettingsUpdates({
        fps: 29,
        maxDurationSecs: 25,
        countdownSecs: 6,
      }),
    ).toEqual({
      fps: 30,
      maxDurationSecs: 30,
      countdownSecs: 5,
    });
  });
});
