import { beforeEach, describe, expect, it } from 'vitest';

import { startRecordingCaptureFlow } from './recordingStartFlow';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { useWebcamSettingsStore } from '@/stores/webcamSettingsStore';
import { clearInvokeResponses, mockInvoke, mockOnce, setInvokeResponse } from '@/test/mocks/tauri';

describe('startRecordingCaptureFlow', () => {
  beforeEach(() => {
    clearInvokeResponses();
    setInvokeResponse('set_hide_desktop_icons', null);
    setInvokeResponse('set_webcam_enabled', null);
    setInvokeResponse('capture_overlay_confirm', null);
    setInvokeResponse('show_recording_controls', null);
    setInvokeResponse('show_recording_border', null);
    setInvokeResponse('show_countdown_window', null);
    setInvokeResponse('start_recording', null);

    useCaptureSettingsStore.setState({
      settings: {
        screenshot: {
          format: 'png',
          jpgQuality: 85,
          includeCursor: true,
        },
        video: {
          format: 'mp4',
          quality: 80,
          fps: 30,
          maxDurationSecs: null,
          includeCursor: true,
          captureSystemAudio: true,
          systemAudioDeviceId: null,
          systemAudioScope: { mode: 'all', targets: [] },
          allowFallbackToAllSystemAudio: false,
          microphoneDeviceIndex: 3,
          captureWebcam: false,
          countdownSecs: 3,
          hideDesktopIcons: false,
          quickCapture: false,
        },
        gif: {
          qualityPreset: 'balanced',
          fps: 15,
          maxDurationSecs: 0,
          includeCursor: true,
          countdownSecs: 3,
        },
      },
      afterRecordingAction: 'preview',
      showToolbarInRecording: false,
      saveSettings: async () => {},
    });

    useWebcamSettingsStore.setState({
      settings: {
        enabled: false,
        deviceIndex: 0,
        position: { type: 'bottomRight' },
        size: 'small',
        shape: 'squircle',
        mirror: true,
      },
    });

    mockOnce.mockImplementation((_event: string, handler?: () => void) => {
      handler?.();
      return Promise.resolve(() => {});
    });
  });

  it('maps unlimited GIF duration to null and initializes the HUD as GIF', async () => {
    await startRecordingCaptureFlow({
      captureType: 'gif',
      selection: {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'gif',
        sourceType: 'area',
        sourceMode: 'area',
      },
      hudAnchor: {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        centerOnSelection: true,
      },
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'show_recording_controls',
      expect.objectContaining({
        recordingFormat: 'gif',
        microphoneDeviceIndex: null,
        systemAudioEnabled: false,
      })
    );

    expect(mockInvoke).toHaveBeenCalledWith(
      'start_recording',
      expect.objectContaining({
        settings: expect.objectContaining({
          format: 'gif',
          maxDurationSecs: null,
          audio: expect.objectContaining({
            captureSystemAudio: false,
            systemAudioScope: { mode: 'all', targets: [] },
            allowFallbackToAllSystemAudio: false,
            microphoneDeviceIndex: null,
          }),
        }),
      })
    );
  });

  it('passes process-scoped system audio settings for video recording', async () => {
    useCaptureSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        video: {
          ...state.settings.video,
          systemAudioScope: {
            mode: 'includeProcesses',
            targets: [
              {
                processId: 1234,
                processName: 'chrome.exe',
                windowTitle: 'Demo tab',
              },
            ],
          },
          allowFallbackToAllSystemAudio: true,
        },
      },
    }));

    await startRecordingCaptureFlow({
      captureType: 'video',
      selection: {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceType: 'area',
        sourceMode: 'area',
      },
      hudAnchor: {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
      },
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'start_recording',
      expect.objectContaining({
        settings: expect.objectContaining({
          format: 'mp4',
          audio: expect.objectContaining({
            captureSystemAudio: true,
            systemAudioScope: {
              mode: 'includeProcesses',
              targets: [
                {
                  processId: 1234,
                  processName: 'chrome.exe',
                  windowTitle: 'Demo tab',
                },
              ],
            },
            allowFallbackToAllSystemAudio: true,
            microphoneDeviceIndex: 3,
          }),
        }),
      })
    );
  });

  it('keeps process scope while sending muted system audio state', async () => {
    useCaptureSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        video: {
          ...state.settings.video,
          captureSystemAudio: false,
          systemAudioScope: {
            mode: 'excludeProcesses',
            targets: [
              {
                processId: 2345,
                processName: 'teams.exe',
                windowTitle: 'Standup',
              },
            ],
          },
        },
      },
    }));

    await startRecordingCaptureFlow({
      captureType: 'video',
      selection: {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceType: 'area',
        sourceMode: 'area',
      },
      hudAnchor: {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
      },
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'start_recording',
      expect.objectContaining({
        settings: expect.objectContaining({
          audio: expect.objectContaining({
            captureSystemAudio: false,
            systemAudioScope: {
              mode: 'excludeProcesses',
              targets: [
                {
                  processId: 2345,
                  processName: 'teams.exe',
                  windowTitle: 'Standup',
                },
              ],
            },
          }),
        }),
      })
    );
  });

  it('does not confirm the overlay when chooser handoff is cancelled', async () => {
    await expect(
      startRecordingCaptureFlow({
        captureType: 'video',
        selection: {
          x: 100,
          y: 150,
          width: 800,
          height: 450,
          captureType: 'video',
          sourceType: 'area',
          sourceMode: 'area',
        },
        hudAnchor: { x: 100, y: 608, width: 360, height: 60 },
        onBeforeOverlayConfirm: () => Promise.reject(new Error('cancelled')),
      }),
    ).rejects.toThrow('cancelled');

    expect(mockInvoke).not.toHaveBeenCalledWith('capture_overlay_confirm', expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith('start_recording', expect.anything());
  });
});
