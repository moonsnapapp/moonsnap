import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RecordingsTab } from './RecordingsTab';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';

describe('RecordingsTab', () => {
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
          microphoneDeviceIndex: null,
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
      promptRecordingMode: true,
      snapToolbarToSelection: true,
      showToolbarInRecording: false,
      saveSettings: async () => {},
    });
  });

  it('updates the store when selecting recording presets', () => {
    render(<RecordingsTab />);

    const headings = screen.getAllByRole('heading', { level: 3 });
    const videoSection = headings[1].closest('section');
    const gifSection = headings[2].closest('section');

    if (!videoSection || !gifSection) {
      throw new Error('Expected video and GIF sections to be present');
    }

    fireEvent.click(within(videoSection).getByRole('radio', { name: '60 fps' }));
    fireEvent.click(within(videoSection).getByRole('radio', { name: 'Off' }));
    fireEvent.click(within(gifSection).getByRole('radio', { name: 'Unlimited' }));

    expect(useCaptureSettingsStore.getState().settings.video.fps).toBe(60);
    expect(useCaptureSettingsStore.getState().settings.video.countdownSecs).toBe(0);
    expect(useCaptureSettingsStore.getState().settings.gif.maxDurationSecs).toBe(0);
  });

  it('toggles the "Ask before recording" switch', () => {
    render(<RecordingsTab />);

    const toggle = screen.getByRole('switch', { name: /ask before recording/i });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(useCaptureSettingsStore.getState().promptRecordingMode).toBe(false);

    fireEvent.click(toggle);
    expect(useCaptureSettingsStore.getState().promptRecordingMode).toBe(true);
  });
});
