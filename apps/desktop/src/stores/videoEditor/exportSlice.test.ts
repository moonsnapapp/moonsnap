import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setInvokeResponse } from '@/test/mocks/tauri';
import { useVideoEditorStore } from './index';
import { DEFAULT_CAPTION_SETTINGS } from './captionSlice';
import type { TextSegment, VideoProject } from '@/types';
import { preRenderForExport } from '../../utils/textPreRenderer';

vi.mock('../../utils/textPreRenderer', () => ({
  preRenderForExport: vi.fn().mockResolvedValue(undefined),
}));

function createTestTextSegment(): TextSegment {
  return {
    start: 0,
    end: 3,
    enabled: true,
    content: 'Parity test',
    center: { x: 0.5, y: 0.5 },
    size: { x: 0.35, y: 0.2 },
    fontFamily: 'sans-serif',
    fontSize: 48,
    fontWeight: 700,
    italic: false,
    color: '#ffffff',
    fadeDuration: 0.15,
  };
}

function createTestProject(textSegments: TextSegment[]): VideoProject {
  return {
    id: 'project-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Export Parity Test',
    sources: {
      screenVideo: 'C:/tmp/screen.mp4',
      webcamVideo: null,
      cursorData: null,
      audioFile: null,
      systemAudio: null,
      microphoneAudio: null,
      backgroundMusic: null,
      originalWidth: 3840,
      originalHeight: 2160,
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
      motionBlur: 0,
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
        bgType: 'solid',
        solidColor: '#000000',
        gradientStart: '#000000',
        gradientEnd: '#111111',
        gradientAngle: 135,
        wallpaper: null,
        imagePath: null,
        blur: 0,
        padding: 40,
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
        enabled: true,
        x: 200,
        y: 100,
        width: 3000,
        height: 1200,
        lockAspectRatio: false,
        aspectRatio: null,
      },
      composition: {
        mode: 'manual',
        aspectRatio: null,
        aspectPreset: '16:9',
        width: 1920,
        height: 1080,
      },
      preferHardwareEncoding: true,
    },
    scene: {
      segments: [],
      defaultMode: 'default',
    },
    text: {
      segments: textSegments,
    },
    mask: {
      segments: [],
    },
    captions: {
      ...DEFAULT_CAPTION_SETTINGS,
    },
    captionSegments: [],
  };
}

describe('exportSlice', () => {
  beforeEach(() => {
    useVideoEditorStore.getState().clearEditor();
    vi.clearAllMocks();
  });

  it('updateExportConfig merges partial config into project', () => {
    const project = createTestProject([]);
    useVideoEditorStore.getState().setProject(project);

    useVideoEditorStore.getState().updateExportConfig({ quality: 95, fps: 60 });

    const updated = useVideoEditorStore.getState().project!;
    expect(updated.export.quality).toBe(95);
    expect(updated.export.fps).toBe(60);
    // Other fields remain unchanged
    expect(updated.export.format).toBe('mp4');
  });

  it('setExportProgress updates progress state', () => {
    const progress: import('./types').ExportProgress = {
      progress: 0.5,
      stage: 'encoding',
      message: 'Encoding frame 150/300',
    };

    useVideoEditorStore.getState().setExportProgress(progress);
    expect(useVideoEditorStore.getState().exportProgress).toEqual(progress);

    useVideoEditorStore.getState().setExportProgress(null);
    expect(useVideoEditorStore.getState().exportProgress).toBeNull();
  });

  it('uses manual composition frame size (not raw crop size) for text pre-render', async () => {
    const mockedPreRenderForExport = vi.mocked(preRenderForExport);
    const project = createTestProject([createTestTextSegment()]);

    setInvokeResponse('export_video', {
      outputPath: 'C:/tmp/out.mp4',
      durationSecs: 10,
      fileSizeBytes: 1_000_000,
      format: 'mp4',
    });

    useVideoEditorStore.getState().setProject(project);
    await useVideoEditorStore.getState().exportVideo('C:/tmp/out.mp4');

    expect(mockedPreRenderForExport).toHaveBeenCalledTimes(1);
    expect(mockedPreRenderForExport).toHaveBeenCalledWith(
      project.text.segments,
      1840,
      736
    );
  });
});
