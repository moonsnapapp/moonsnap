import { describe, expect, it } from 'vitest';
import type { VideoProject } from '../../types';
import { reconcileProjectDuration } from './projectSlice';

function createTestProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: 'test-project-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Test Project',
    sources: {
      screenVideo: '/path/to/video.mp4',
      webcamVideo: null,
      cursorData: null,
      audioFile: null,
      systemAudio: null,
      microphoneAudio: null,
      backgroundMusic: null,
      originalWidth: 1920,
      originalHeight: 1080,
      durationMs: 10000,
      fps: 30,
    },
    timeline: {
      durationMs: 10000,
      inPoint: 0,
      outPoint: 10000,
      speed: 1.0,
      segments: [],
    },
    zoom: {
      regions: [],
      autoZoom: null,
    },
    cursor: {
      visible: true,
      cursorType: 'auto',
      scale: 1.0,
      smoothMovement: true,
      animationStyle: 'mellow',
      tension: 120,
      mass: 1.1,
      friction: 18,
      motionBlur: 0.05,
      dampening: 0.5,
      clickHighlight: {
        enabled: true,
        color: '#FF6B6B',
        radius: 30,
        durationMs: 400,
        style: 'ripple',
      },
    },
    webcam: {
      enabled: false,
      position: 'bottom-right',
      size: 25,
      shape: 'circle',
      borderWidth: 3,
      borderColor: '#ffffff',
      shadowEnabled: true,
      visibilitySegments: [],
    },
    audio: {
      systemVolume: 1.0,
      microphoneVolume: 1.0,
      masterVolume: 1.0,
      systemMuted: false,
      microphoneMuted: false,
    },
    export: {
      format: 'mp4',
      fps: 30,
      quality: 80,
    },
    scene: {
      segments: [],
      defaultMode: 'default',
    },
    text: {
      segments: [],
    },
    mask: {
      segments: [],
    },
    ...overrides,
  };
}

describe('reconcileProjectDuration', () => {
  it('returns the same project when the duration already matches', () => {
    const project = createTestProject();

    expect(reconcileProjectDuration(project, 10000)).toBe(project);
  });

  it('updates source and timeline duration when media duration is shorter', () => {
    const project = createTestProject();

    const reconciled = reconcileProjectDuration(project, 9750);

    expect(reconciled.sources.durationMs).toBe(9750);
    expect(reconciled.timeline.durationMs).toBe(9750);
    expect(reconciled.timeline.outPoint).toBe(9750);
  });

  it('clamps trim segments and export range to the actual media duration', () => {
    const project = createTestProject({
      timeline: {
        durationMs: 10000,
        inPoint: 1000,
        outPoint: 9500,
        speed: 1.0,
        segments: [
          { id: 'seg-1', sourceStartMs: 0, sourceEndMs: 5000 },
          { id: 'seg-2', sourceStartMs: 8000, sourceEndMs: 10000 },
        ],
      },
    });

    const reconciled = reconcileProjectDuration(project, 9000);

    expect(reconciled.timeline.durationMs).toBe(9000);
    expect(reconciled.timeline.segments).toEqual([
      { id: 'seg-1', sourceStartMs: 0, sourceEndMs: 5000 },
      { id: 'seg-2', sourceStartMs: 8000, sourceEndMs: 9000 },
    ]);
    expect(reconciled.timeline.inPoint).toBe(1000);
    expect(reconciled.timeline.outPoint).toBe(6000);
  });
});
