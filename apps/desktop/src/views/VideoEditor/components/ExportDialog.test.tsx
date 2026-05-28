import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTION_SETTINGS } from '../../../stores/videoEditor/captionSlice';
import type { VideoProject } from '../../../types';
import { clearInvokeResponses, setInvokeResponse } from '../../../test/mocks/tauri';
import { ExportDialog } from './ExportDialog';

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

describe('ExportDialog', () => {
  beforeEach(() => {
    clearInvokeResponses();
    setInvokeResponse('check_nvenc_available', true);
  });

  it('shows the MP4 hardware-encoding toggle and updates export config', async () => {
    const onUpdateExportConfig = vi.fn();

    render(
      <ExportDialog
        open
        project={createTestProject()}
        onOpenChange={vi.fn()}
        onUpdateExportConfig={onUpdateExportConfig}
        onConfirm={vi.fn()}
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
      <ExportDialog
        open
        project={{
          ...project,
          export: { ...project.export, format: 'webm' },
        }}
        onOpenChange={vi.fn()}
        onUpdateExportConfig={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByRole('switch', { name: /prefer hardware encoding/i })).not.toBeInTheDocument();
  });

  it('shows the GIF-specific title and save label when format is gif', () => {
    const project = createTestProject();

    render(
      <ExportDialog
        open
        project={{
          ...project,
          export: { ...project.export, format: 'gif' },
        }}
        onOpenChange={vi.fn()}
        onUpdateExportConfig={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByRole('switch', { name: /prefer hardware encoding/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^Format$/)).toBeInTheDocument();
    expect(screen.getByText(/^Frame Rate$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save gif/i })).toBeInTheDocument();
  });

  it('fires onConfirm when the save button is clicked', () => {
    const onConfirm = vi.fn();
    const project = createTestProject();

    render(
      <ExportDialog
        open
        project={{
          ...project,
          export: { ...project.export, format: 'webm' },
        }}
        onOpenChange={vi.fn()}
        onUpdateExportConfig={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save video/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
