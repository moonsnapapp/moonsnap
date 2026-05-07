import { beforeEach, describe, expect, it } from 'vitest';

import { startRecordingCaptureFlow } from './recordingStartFlow';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { useWebcamSettingsStore } from '@/stores/webcamSettingsStore';
import { mockEmit, mockInvoke, mockOnce } from '@/test/mocks/tauri';

describe('startRecordingCaptureFlow', () => {
  beforeEach(() => {
    mockEmit.mockClear();
    mockInvoke.mockClear();
    mockOnce.mockClear();

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
            microphoneDeviceIndex: null,
          }),
        }),
      })
    );
  });

  it('keeps recording options consistent when Quick save is selected', async () => {
    useCaptureSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        video: {
          ...state.settings.video,
          countdownSecs: 3,
          includeCursor: true,
        },
      },
      afterRecordingAction: 'save',
    }));

    useWebcamSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        enabled: true,
      },
    }));

    await startRecordingCaptureFlow({
      captureType: 'video',
      selection: {
        x: 40,
        y: 60,
        width: 1280,
        height: 720,
        captureType: 'video',
        sourceType: 'display',
        sourceMode: 'display',
        monitorIndex: 1,
      },
      hudAnchor: {
        x: 48,
        y: 780,
        width: 360,
        height: 60,
      },
    });

    expect(mockInvoke).toHaveBeenCalledWith('set_webcam_enabled', { enabled: true });
    expect(mockEmit).toHaveBeenCalledWith('recording-preview-anchor', {
      x: 40,
      y: 60,
      width: 1280,
      height: 720,
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'start_recording',
      expect.objectContaining({
        settings: expect.objectContaining({
          format: 'mp4',
          countdownSecs: 3,
          includeCursor: true,
          quickCapture: true,
        }),
      })
    );
  });
});
