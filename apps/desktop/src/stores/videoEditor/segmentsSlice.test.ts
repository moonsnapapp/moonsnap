import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoProject } from '../../types';
import { createDefaultAnnotationShape } from '../../utils/videoAnnotations';
import { createTextSegmentId } from '../../utils/textSegmentId';
import { useVideoEditorStore } from './index';

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
    annotations: {
      segments: [],
    },
    mask: {
      segments: [],
    },
    ...overrides,
  };
}

function createMockTextMeasureContext(): CanvasRenderingContext2D {
  return {
    font: '',
    textAlign: 'center',
    textBaseline: 'alphabetic',
    measureText: (text: string) => ({
      width: text.length * 12,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 4,
    } as TextMetrics),
  } as CanvasRenderingContext2D;
}

class MockOffscreenCanvas {
  constructor(_width: number, _height: number) {}

  getContext(_contextId: '2d') {
    return createMockTextMeasureContext();
  }
}

describe('annotation shape selection', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({
      project: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      activeUndoDomain: null,
      trimHistory: [],
      trimHistoryIndex: -1,
      annotationHistory: [],
      annotationHistoryIndex: -1,
    });
  });

  it('preserves the selected shape when the same segment is reselected', () => {
    const firstShape = { ...createDefaultAnnotationShape('rectangle'), id: 'shape-1' };
    const secondShape = { ...createDefaultAnnotationShape('ellipse'), id: 'shape-2' };
    const segment = {
      id: 'segment-1',
      startMs: 0,
      endMs: 1000,
      enabled: true,
      shapes: [firstShape, secondShape],
    };

    useVideoEditorStore.getState().setProject(createTestProject({
      annotations: {
        segments: [segment],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectAnnotationSegment(segment.id);
    expect(useVideoEditorStore.getState().selectedAnnotationShapeId).toBe(firstShape.id);
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('segment');

    store.selectAnnotationShape(secondShape.id);
    expect(useVideoEditorStore.getState().selectedAnnotationShapeId).toBe(secondShape.id);
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('shape');

    store.selectAnnotationSegment(segment.id);
    expect(useVideoEditorStore.getState().selectedAnnotationShapeId).toBe(secondShape.id);
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('segment');
  });

  it('allows explicit shape selection when selecting a segment', () => {
    const firstShape = { ...createDefaultAnnotationShape('rectangle'), id: 'shape-a' };
    const secondShape = { ...createDefaultAnnotationShape('ellipse'), id: 'shape-b' };
    const segment = {
      id: 'segment-a',
      startMs: 0,
      endMs: 1000,
      enabled: true,
      shapes: [firstShape, secondShape],
    };

    useVideoEditorStore.getState().setProject(createTestProject({
      annotations: {
        segments: [segment],
      },
    }));

    useVideoEditorStore.getState().selectAnnotationSegment(segment.id, secondShape.id);

    expect(useVideoEditorStore.getState().selectedAnnotationSegmentId).toBe(segment.id);
    expect(useVideoEditorStore.getState().selectedAnnotationShapeId).toBe(secondShape.id);
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('shape');
  });

  it('falls back to segment delete mode when the selected shape is cleared', () => {
    const shape = { ...createDefaultAnnotationShape('rectangle'), id: 'shape-clear' };
    const segment = {
      id: 'segment-clear',
      startMs: 0,
      endMs: 1000,
      enabled: true,
      shapes: [shape],
    };

    useVideoEditorStore.getState().setProject(createTestProject({
      annotations: {
        segments: [segment],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectAnnotationSegment(segment.id, shape.id);
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('shape');

    store.selectAnnotationShape(null);

    expect(useVideoEditorStore.getState().selectedAnnotationShapeId).toBeNull();
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('segment');
  });

  it('keeps shape delete mode while other shapes remain after deleting the selected shape', () => {
    const firstShape = { ...createDefaultAnnotationShape('rectangle'), id: 'shape-next-1' };
    const secondShape = { ...createDefaultAnnotationShape('ellipse'), id: 'shape-next-2' };
    const segment = {
      id: 'segment-next',
      startMs: 0,
      endMs: 1000,
      enabled: true,
      shapes: [firstShape, secondShape],
    };

    useVideoEditorStore.getState().setProject(createTestProject({
      annotations: {
        segments: [segment],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectAnnotationSegment(segment.id, secondShape.id);
    store.deleteAnnotationShape(segment.id, secondShape.id);

    expect(useVideoEditorStore.getState().selectedAnnotationSegmentId).toBe(segment.id);
    expect(useVideoEditorStore.getState().selectedAnnotationShapeId).toBe(firstShape.id);
    expect(useVideoEditorStore.getState().annotationDeleteMode).toBe('shape');
  });

  it('keeps annotation undo active after deleting the selected annotation segment', () => {
    const shape = { ...createDefaultAnnotationShape('rectangle'), id: 'shape-delete-segment' };
    const segment = {
      id: 'segment-delete',
      startMs: 0,
      endMs: 1000,
      enabled: true,
      shapes: [shape],
    };

    useVideoEditorStore.getState().setProject(createTestProject({
      annotations: {
        segments: [segment],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectAnnotationSegment(segment.id);
    store.deleteAnnotationSegment(segment.id);

    expect(useVideoEditorStore.getState().selectedAnnotationSegmentId).toBeNull();
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('annotation');

    store.undoAnnotation();

    expect(useVideoEditorStore.getState().project?.annotations.segments).toHaveLength(1);
    expect(useVideoEditorStore.getState().project?.annotations.segments[0]?.id).toBe(segment.id);
  });
});

describe('segment delete undo history', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
    useVideoEditorStore.setState({
      project: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      activeUndoDomain: null,
      trimHistory: [],
      trimHistoryIndex: -1,
      annotationHistory: [],
      annotationHistoryIndex: -1,
      selectedZoomRegionId: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records zoom region deletions in trim history so undo restores them', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      zoom: {
        regions: [
          {
            id: 'zoom-1',
            startMs: 100,
            endMs: 400,
            scale: 2,
            targetX: 0.5,
            targetY: 0.5,
            isAuto: false,
            transition: { durationInMs: 200, durationOutMs: 200, easing: 'easeInOut' },
          },
        ],
        autoZoom: null,
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectZoomRegion('zoom-1');
    store.deleteZoomRegion('zoom-1');

    expect(useVideoEditorStore.getState().project?.zoom.regions).toHaveLength(0);
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('trim');
    expect(useVideoEditorStore.getState().trimHistoryIndex).toBe(1);

    store.undoTrim();

    expect(useVideoEditorStore.getState().project?.zoom.regions).toHaveLength(1);
    expect(useVideoEditorStore.getState().project?.zoom.regions[0]?.id).toBe('zoom-1');
  });

  it('records zoom region updates in trim history so undo and redo restore moved bounds', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      zoom: {
        regions: [
          {
            id: 'zoom-move-1',
            startMs: 100,
            endMs: 400,
            scale: 2,
            targetX: 0.5,
            targetY: 0.5,
            mode: 'manual',
            isAuto: false,
            transition: { durationInMs: 200, durationOutMs: 200, easing: 'easeInOut' },
          },
        ],
        autoZoom: null,
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectZoomRegion('zoom-move-1');
    store.updateZoomRegion('zoom-move-1', { startMs: 250, endMs: 650 });

    expect(useVideoEditorStore.getState().project?.zoom.regions[0]).toMatchObject({
      id: 'zoom-move-1',
      startMs: 250,
      endMs: 650,
    });
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('trim');

    store.undoTrim();

    expect(useVideoEditorStore.getState().project?.zoom.regions[0]).toMatchObject({
      id: 'zoom-move-1',
      startMs: 100,
      endMs: 400,
    });

    store.redoTrim();

    expect(useVideoEditorStore.getState().project?.zoom.regions[0]).toMatchObject({
      id: 'zoom-move-1',
      startMs: 250,
      endMs: 650,
    });
  });

  it('records text segment updates in trim history so undo and redo restore moved bounds', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      text: {
        segments: [
          {
            start: 1,
            end: 2,
            enabled: true,
            content: 'Hello',
            center: { x: 0.5, y: 0.5 },
            size: { x: 0.3, y: 0.15 },
            fontFamily: 'Arial',
            fontSize: 48,
            fontWeight: 700,
            italic: false,
            color: '#ffffff',
            fadeDuration: 0,
            animation: 'none',
            typewriterCharsPerSecond: 24,
            typewriterSoundEnabled: false,
          },
        ],
      },
    }));

    const store = useVideoEditorStore.getState();
    const textSegmentId = createTextSegmentId(1, 0);
    store.selectTextSegment(textSegmentId);
    store.updateTextSegment(textSegmentId, { start: 2.5, end: 4.25 });

    expect(useVideoEditorStore.getState().project?.text.segments[0]).toMatchObject({
      start: 2.5,
      end: 4.25,
    });
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('trim');

    store.undoTrim();

    expect(useVideoEditorStore.getState().project?.text.segments[0]).toMatchObject({
      start: 1,
      end: 2,
    });

    store.redoTrim();

    expect(useVideoEditorStore.getState().project?.text.segments[0]).toMatchObject({
      start: 2.5,
      end: 4.25,
    });
  });

  it('auto-fits text segment height when content changes', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      text: {
        segments: [
          {
            start: 1,
            end: 2,
            enabled: true,
            content: 'Hello',
            center: { x: 0.5, y: 0.5 },
            size: { x: 0.18, y: 0.08 },
            fontFamily: 'Arial',
            fontSize: 48,
            fontWeight: 700,
            italic: false,
            color: '#ffffff',
            fadeDuration: 0,
            animation: 'none',
            typewriterCharsPerSecond: 24,
            typewriterSoundEnabled: false,
          },
        ],
      },
    }));

    const store = useVideoEditorStore.getState();
    const textSegmentId = createTextSegmentId(1, 0);
    store.updateTextSegment(
      textSegmentId,
      { content: 'word '.repeat(24).trim() },
    );

    expect(useVideoEditorStore.getState().project?.text.segments[0]?.size.y).toBeGreaterThan(0.08);
  });

  it('records mask segment updates in trim history so undo and redo restore moved bounds', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      mask: {
        segments: [
          {
            id: 'mask-1',
            startMs: 500,
            endMs: 1200,
            x: 0.1,
            y: 0.2,
            width: 0.25,
            height: 0.3,
            maskType: 'blur',
            intensity: 50,
            feather: 10,
            color: '#000000',
          },
        ],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectMaskSegment('mask-1');
    store.updateMaskSegment('mask-1', { startMs: 800, endMs: 1600 });

    expect(useVideoEditorStore.getState().project?.mask.segments[0]).toMatchObject({
      id: 'mask-1',
      startMs: 800,
      endMs: 1600,
    });
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('trim');

    store.undoTrim();

    expect(useVideoEditorStore.getState().project?.mask.segments[0]).toMatchObject({
      id: 'mask-1',
      startMs: 500,
      endMs: 1200,
    });

    store.redoTrim();

    expect(useVideoEditorStore.getState().project?.mask.segments[0]).toMatchObject({
      id: 'mask-1',
      startMs: 800,
      endMs: 1600,
    });
  });

  it('records scene segment updates in trim history so undo and redo restore moved bounds', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      scene: {
        segments: [
          {
            id: 'scene-1',
            startMs: 300,
            endMs: 1100,
            mode: 'cameraOnly',
          },
        ],
        defaultMode: 'default',
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectSceneSegment('scene-1');
    store.updateSceneSegment('scene-1', { startMs: 900, endMs: 1700 });

    expect(useVideoEditorStore.getState().project?.scene.segments[0]).toMatchObject({
      id: 'scene-1',
      startMs: 900,
      endMs: 1700,
    });
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('trim');

    store.undoTrim();

    expect(useVideoEditorStore.getState().project?.scene.segments[0]).toMatchObject({
      id: 'scene-1',
      startMs: 300,
      endMs: 1100,
    });

    store.redoTrim();

    expect(useVideoEditorStore.getState().project?.scene.segments[0]).toMatchObject({
      id: 'scene-1',
      startMs: 900,
      endMs: 1700,
    });
  });

  it('records webcam segment updates in trim history so undo and redo restore moved bounds', () => {
    useVideoEditorStore.getState().setProject(createTestProject({
      webcam: {
        enabled: false,
        position: 'bottom-right',
        size: 25,
        shape: 'circle',
        borderWidth: 3,
        borderColor: '#ffffff',
        shadowEnabled: true,
        visibilitySegments: [
          {
            startMs: 200,
            endMs: 1000,
            visible: true,
          },
        ],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectWebcamSegment(0);
    store.updateWebcamSegment(0, { startMs: 600, endMs: 1400 });

    expect(useVideoEditorStore.getState().project?.webcam.visibilitySegments[0]).toMatchObject({
      startMs: 600,
      endMs: 1400,
      visible: true,
    });
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('trim');

    store.undoTrim();

    expect(useVideoEditorStore.getState().project?.webcam.visibilitySegments[0]).toMatchObject({
      startMs: 200,
      endMs: 1000,
      visible: true,
    });

    store.redoTrim();

    expect(useVideoEditorStore.getState().project?.webcam.visibilitySegments[0]).toMatchObject({
      startMs: 600,
      endMs: 1400,
      visible: true,
    });
  });
});

describe('annotation segment move undo history', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({
      project: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      activeUndoDomain: null,
      trimHistory: [],
      trimHistoryIndex: -1,
      annotationHistory: [],
      annotationHistoryIndex: -1,
    });
  });

  it('records annotation segment updates in annotation history so undo and redo restore moved bounds', () => {
    const shape = { ...createDefaultAnnotationShape('arrow'), id: 'shape-move-1' };
    const segment = {
      id: 'annotation-move-1',
      startMs: 100,
      endMs: 800,
      enabled: true,
      shapes: [shape],
    };

    useVideoEditorStore.getState().setProject(createTestProject({
      annotations: {
        segments: [segment],
      },
    }));

    const store = useVideoEditorStore.getState();
    store.selectAnnotationSegment(segment.id);
    store.updateAnnotationSegment(segment.id, { startMs: 500, endMs: 1300 });

    expect(useVideoEditorStore.getState().project?.annotations.segments[0]).toMatchObject({
      id: 'annotation-move-1',
      startMs: 500,
      endMs: 1300,
    });
    expect(useVideoEditorStore.getState().activeUndoDomain).toBe('annotation');

    store.undoAnnotation();

    expect(useVideoEditorStore.getState().project?.annotations.segments[0]).toMatchObject({
      id: 'annotation-move-1',
      startMs: 100,
      endMs: 800,
    });

    store.redoAnnotation();

    expect(useVideoEditorStore.getState().project?.annotations.segments[0]).toMatchObject({
      id: 'annotation-move-1',
      startMs: 500,
      endMs: 1300,
    });
  });
});
