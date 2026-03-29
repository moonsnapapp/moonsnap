import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS } from '../../../stores/videoEditor/captionSlice';
import type { VideoProject } from '../../../types';
import { setInvokeResponse } from '../../../test/mocks/tauri';
import { ExportConfigPanel } from './ExportConfigPanel';

function createTestProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: 'project-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Export Test Project',
    originalFileName: 'recording.mp4',
    quickCapture: false,
    sources: {
      screenVideo: 'C:/tmp/screen.mp4',
      webcamVideo: null,
      cursorData: null,
      audioFile: null,
      systemAudio: null,
      microphoneAudio: null,
      backgroundMusic: null,
      originalWidth: 1920,
      originalHeight: 1080,
      durationMs: 10_000,
      fps: 30,
    },
    timeline: {
      durationMs: 10_000,
      inPoint: 0,
      outPoint: 10_000,
      speed: 1,
      segments: [],
    },
    zoom: {
      mode: 'manual',
      autoZoomScale: 2,
      regions: [],
    },
    cursor: {
      visible: true,
      cursorType: 'auto',
      scale: 1,
      dampening: 0.5,
      motionBlur: 0,
      hideWhenIdle: false,
      clickHighlight: {
        enabled: true,
        color: '#ff4444',
        radius: 48,
        durationMs: 300,
        style: 'ring',
      },
    },
    webcam: {
      enabled: false,
      position: 'bottomRight',
      customX: 0,
      customY: 0,
      size: 0.2,
      shape: 'circle',
      rounding: 100,
      cornerStyle: 'squircle',
      shadow: 50,
      shadowConfig: {
        size: 20,
        opacity: 40,
        blur: 20,
      },
      mirror: false,
      border: {
        enabled: false,
        width: 2,
        color: '#ffffff',
      },
      visibilitySegments: [],
    },
    audio: {
      systemVolume: 1,
      microphoneVolume: 1,
      musicVolume: 0.5,
      musicFadeInSecs: 2,
      musicFadeOutSecs: 2,
      normalizeOutput: true,
      systemMuted: false,
      microphoneMuted: false,
      musicMuted: false,
    },
    export: {
      format: 'mp4',
      quality: 80,
      fps: 30,
      background: {
        enabled: false,
        bgType: 'solid',
        solidColor: '#000000',
        gradientStart: '#000000',
        gradientEnd: '#111111',
        gradientAngle: 135,
        wallpaper: null,
        imagePath: null,
        blur: 0,
        padding: 0,
        inset: 0,
        rounding: 0,
        roundingType: 'rounded',
        shadow: {
          enabled: false,
          shadow: 0,
        },
        border: {
          enabled: false,
          width: 1,
          color: '#ffffff',
          opacity: 100,
        },
      },
      crop: {
        enabled: false,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        lockAspectRatio: false,
        aspectRatio: null,
      },
      composition: {
        mode: 'auto',
        aspectRatio: null,
        aspectPreset: null,
        width: null,
        height: null,
      },
      preferHardwareEncoding: false,
    },
    scene: {
      segments: [],
      defaultMode: 'default',
    },
    text: {
      segments: [],
    },
    annotations: {
      segments: [],
    },
    mask: {
      segments: [],
    },
    captions: DEFAULT_CAPTION_SETTINGS,
    captionSegments: [],
    ...overrides,
  };
}

describe('ExportConfigPanel', () => {
  it('shows the MP4 hardware-encoding toggle and updates export config', async () => {
    setInvokeResponse('check_nvenc_available', true);
    const onUpdateExportConfig = vi.fn();

    render(
      <ExportConfigPanel
        project={createTestProject()}
        onUpdateExportConfig={onUpdateExportConfig}
        onUpdateAudioConfig={vi.fn()}
        onOpenCropDialog={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/NVIDIA NVENC is available if you want faster MP4 exports/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('switch', { name: /prefer hardware encoding/i }));

    expect(onUpdateExportConfig).toHaveBeenCalledWith({ preferHardwareEncoding: true });
  });

  it('hides the hardware-encoding toggle for non-MP4 exports', () => {
    const project = createTestProject();

    render(
      <ExportConfigPanel
        project={{
          ...project,
          export: {
            ...project.export,
            format: 'webm',
          },
        }}
        onUpdateExportConfig={vi.fn()}
        onUpdateAudioConfig={vi.fn()}
        onOpenCropDialog={vi.fn()}
      />
    );

    expect(screen.queryByRole('switch', { name: /prefer hardware encoding/i })).not.toBeInTheDocument();
  });
});
