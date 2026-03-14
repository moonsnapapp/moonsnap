import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CaptureToolbar } from './CaptureToolbar';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';

const mockUseRustAudioLevels = vi.fn();

vi.mock('@/hooks/useRustAudioLevels', () => ({
  useRustAudioLevels: (...args: unknown[]) => mockUseRustAudioLevels(...args),
}));

describe('CaptureToolbar recording audio indicators', () => {
  beforeEach(() => {
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
          microphoneDeviceIndex: 0,
          captureWebcam: false,
          countdownSecs: 3,
          hideDesktopIcons: false,
          quickCapture: false,
        },
        gif: {
          qualityPreset: 'balanced',
          fps: 15,
          maxDurationSecs: 30,
          includeCursor: true,
          countdownSecs: 3,
        },
      },
      afterRecordingAction: 'preview',
      saveSettings: async () => {},
    });

    mockUseRustAudioLevels.mockReturnValue({
      micLevel: 0.5,
      systemLevel: 0.25,
      micActive: true,
      systemActive: true,
      error: null,
      isStarting: false,
    });
  });

  it('renders compact mic and system audio indicators in the recording HUD', () => {
    const { container } = render(
      <CaptureToolbar
        mode="recording"
        captureType="video"
        width={0}
        height={0}
        format="mp4"
        elapsedTime={17}
        onCapture={() => {}}
        onCaptureTypeChange={() => {}}
        onRedo={() => {}}
        onCancel={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        minimalChrome="floating"
        showRecordingAudioIndicators
      />
    );

    expect(container.querySelectorAll('.glass-recording-audio-indicator')).toHaveLength(2);
    expect(container.querySelectorAll('.glass-audio-meter--recording')).toHaveLength(2);
    expect(screen.getByTitle('Microphone level')).toBeInTheDocument();
    expect(screen.getByTitle('System audio level')).toBeInTheDocument();
    expect(mockUseRustAudioLevels).toHaveBeenCalledWith({
      micDeviceIndex: 0,
      monitorSystemAudio: true,
      enabled: true,
    });
  });

  it('does not render recording audio indicators when the HUD flag is disabled', () => {
    const { container } = render(
      <CaptureToolbar
        mode="recording"
        captureType="video"
        width={0}
        height={0}
        format="mp4"
        elapsedTime={17}
        onCapture={() => {}}
        onCaptureTypeChange={() => {}}
        onRedo={() => {}}
        onCancel={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        minimalChrome="floating"
      />
    );

    expect(container.querySelector('.glass-recording-audio-section')).not.toBeInTheDocument();
    expect(mockUseRustAudioLevels).toHaveBeenCalledWith({
      micDeviceIndex: 0,
      monitorSystemAudio: true,
      enabled: false,
    });
  });

  it('keeps both recording audio indicators visible when one source is disabled', () => {
    useCaptureSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        video: {
          ...state.settings.video,
          microphoneDeviceIndex: null,
          captureSystemAudio: true,
        },
      },
    }));

    mockUseRustAudioLevels.mockReturnValue({
      micLevel: 0,
      systemLevel: 0.4,
      micActive: false,
      systemActive: true,
      error: null,
      isStarting: false,
    });

    const { container } = render(
      <CaptureToolbar
        mode="recording"
        captureType="video"
        width={0}
        height={0}
        format="mp4"
        elapsedTime={17}
        onCapture={() => {}}
        onCaptureTypeChange={() => {}}
        onRedo={() => {}}
        onCancel={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        minimalChrome="floating"
        showRecordingAudioIndicators
      />
    );

    expect(container.querySelectorAll('.glass-recording-audio-indicator')).toHaveLength(2);
    expect(screen.getByTitle('Microphone disabled')).toBeInTheDocument();
    expect(screen.getByTitle('System audio level')).toBeInTheDocument();
    expect(mockUseRustAudioLevels).toHaveBeenCalledWith({
      micDeviceIndex: null,
      monitorSystemAudio: true,
      enabled: true,
    });
  });

  it('uses explicit recording audio config instead of the local store defaults', () => {
    useCaptureSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        video: {
          ...state.settings.video,
          microphoneDeviceIndex: null,
          captureSystemAudio: true,
        },
      },
    }));

    render(
      <CaptureToolbar
        mode="recording"
        captureType="video"
        width={0}
        height={0}
        format="mp4"
        elapsedTime={17}
        onCapture={() => {}}
        onCaptureTypeChange={() => {}}
        onRedo={() => {}}
        onCancel={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        minimalChrome="floating"
        showRecordingAudioIndicators
        recordingAudioConfig={{
          microphoneDeviceIndex: 4,
          systemAudioEnabled: false,
        }}
      />
    );

    expect(mockUseRustAudioLevels).toHaveBeenCalledWith({
      micDeviceIndex: 4,
      monitorSystemAudio: false,
      enabled: true,
    });
  });

  it('does not show or enable recording audio indicators for GIF recordings', () => {
    const { container } = render(
      <CaptureToolbar
        mode="recording"
        captureType="gif"
        width={0}
        height={0}
        format="gif"
        elapsedTime={17}
        onCapture={() => {}}
        onCaptureTypeChange={() => {}}
        onRedo={() => {}}
        onCancel={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        minimalChrome="floating"
        showRecordingAudioIndicators
        recordingAudioConfig={{
          microphoneDeviceIndex: 4,
          systemAudioEnabled: true,
        }}
      />
    );

    expect(container.querySelector('.glass-recording-audio-section')).not.toBeInTheDocument();
    expect(mockUseRustAudioLevels).toHaveBeenCalledWith({
      micDeviceIndex: 4,
      monitorSystemAudio: true,
      enabled: false,
    });
  });
});
