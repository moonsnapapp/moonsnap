import type {
  SliceCreator,
  ZoomRegion,
  TextSegment,
  AnnotationSegment,
  AnnotationShape,
  MaskSegment,
  SceneSegment,
  VisibilitySegment,
  WebcamConfig,
  CursorConfig,
  AudioTrackSettings,
} from './types';
import { createTextSegmentId, getTextSegmentIndexFromId } from '../../utils/textSegmentId';
import { clampAnnotationShape, normalizeAnnotationConfig } from '../../utils/videoAnnotations';

/**
 * Generate a unique zoom region ID
 */
export function generateZoomRegionId(): string {
  return `zoom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Segments state and actions for managing timeline segments
 * (zoom regions, text, mask, scene, webcam)
 */
export interface SegmentsSlice {
  // Selection state
  selectedZoomRegionId: string | null;
  selectedWebcamSegmentIndex: number | null;
  selectedSceneSegmentId: string | null;
  selectedTextSegmentId: string | null;
  selectedAnnotationSegmentId: string | null;
  selectedAnnotationShapeId: string | null;
  selectedMaskSegmentId: string | null;

  // Zoom region actions
  selectZoomRegion: (id: string | null) => void;
  addZoomRegion: (region: ZoomRegion) => void;
  updateZoomRegion: (id: string, updates: Partial<ZoomRegion>) => void;
  deleteZoomRegion: (id: string) => void;
  splitZoomRegionAtPlayhead: () => void;
  deleteSelectedZoomRegion: () => void;

  // Text segment actions
  selectTextSegment: (id: string | null) => void;
  addTextSegment: (segment: TextSegment) => void;
  updateTextSegment: (id: string, updates: Partial<TextSegment>) => void;
  deleteTextSegment: (id: string) => void;

  // Annotation segment actions
  selectAnnotationSegment: (id: string | null) => void;
  selectAnnotationShape: (id: string | null) => void;
  addAnnotationSegment: (segment: AnnotationSegment) => void;
  updateAnnotationSegment: (id: string, updates: Partial<AnnotationSegment>) => void;
  deleteAnnotationSegment: (id: string) => void;
  addAnnotationShape: (segmentId: string, shape: AnnotationShape) => void;
  updateAnnotationShape: (segmentId: string, shapeId: string, updates: Partial<AnnotationShape>) => void;
  deleteAnnotationShape: (segmentId: string, shapeId: string) => void;

  // Mask segment actions
  selectMaskSegment: (id: string | null) => void;
  addMaskSegment: (segment: MaskSegment) => void;
  updateMaskSegment: (id: string, updates: Partial<MaskSegment>) => void;
  deleteMaskSegment: (id: string) => void;

  // Scene segment actions
  selectSceneSegment: (id: string | null) => void;
  addSceneSegment: (segment: SceneSegment) => void;
  updateSceneSegment: (id: string, updates: Partial<SceneSegment>) => void;
  deleteSceneSegment: (id: string) => void;

  // Webcam segment actions
  selectWebcamSegment: (index: number | null) => void;
  addWebcamSegment: (segment: VisibilitySegment) => void;
  updateWebcamSegment: (index: number, updates: Partial<VisibilitySegment>) => void;
  deleteWebcamSegment: (index: number) => void;
  toggleWebcamAtTime: (timeMs: number) => void;

  // Config actions
  updateWebcamConfig: (updates: Partial<WebcamConfig>) => void;
  updateCursorConfig: (updates: Partial<CursorConfig>) => void;
  updateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
}

export const createSegmentsSlice: SliceCreator<SegmentsSlice> = (set, get) => ({
  // Initial selection state
  selectedZoomRegionId: null,
  selectedWebcamSegmentIndex: null,
  selectedSceneSegmentId: null,
  selectedTextSegmentId: null,
  selectedAnnotationSegmentId: null,
  selectedAnnotationShapeId: null,
  selectedMaskSegmentId: null,

  // Zoom region actions
  selectZoomRegion: (id) =>
    set({
      selectedZoomRegionId: id,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addZoomRegion: (region) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedRegion = {
      ...region,
      startMs: Math.max(0, Math.min(region.startMs, durationMs)),
      endMs: Math.max(0, Math.min(region.endMs, durationMs)),
    };

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: [...project.zoom.regions, clampedRegion],
        },
      },
      selectedZoomRegionId: clampedRegion.id,
    });
  },

  updateZoomRegion: (id, updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: project.zoom.regions.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        },
      },
    });
  },

  deleteZoomRegion: (id) => {
    const { project, selectedZoomRegionId } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: project.zoom.regions.filter((r) => r.id !== id),
        },
      },
      selectedZoomRegionId: selectedZoomRegionId === id ? null : selectedZoomRegionId,
    });
  },

  splitZoomRegionAtPlayhead: () => {
    const { project, currentTimeMs, selectedZoomRegionId } = get();
    if (!project || !selectedZoomRegionId) return;

    const region = project.zoom.regions.find((r) => r.id === selectedZoomRegionId);
    if (!region) return;

    // Check if playhead is within the region (with some margin)
    const minDuration = 100; // Minimum 100ms per segment
    if (currentTimeMs <= region.startMs + minDuration || currentTimeMs >= region.endMs - minDuration) {
      return; // Can't split at edges or if segments would be too small
    }

    // Create two new regions from the split
    const region1: ZoomRegion = {
      ...region,
      id: generateZoomRegionId(),
      endMs: currentTimeMs,
    };

    const region2: ZoomRegion = {
      ...region,
      id: generateZoomRegionId(),
      startMs: currentTimeMs,
    };

    // Replace original with two new regions
    const newRegions = project.zoom.regions
      .filter((r) => r.id !== selectedZoomRegionId)
      .concat([region1, region2])
      .sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: newRegions,
        },
      },
      selectedZoomRegionId: region1.id, // Select the first part
    });
  },

  deleteSelectedZoomRegion: () => {
    const { selectedZoomRegionId, deleteZoomRegion } = get();
    if (selectedZoomRegionId) {
      deleteZoomRegion(selectedZoomRegionId);
    }
  },

  // Text segment actions
  selectTextSegment: (id) =>
    set({
      selectedTextSegmentId: id,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addTextSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration (convert ms to seconds)
    const durationSec = project.timeline.durationMs / 1000;
    const clampedSegment = {
      ...segment,
      start: Math.max(0, Math.min(segment.start, durationSec)),
      end: Math.max(0, Math.min(segment.end, durationSec)),
    };

    const segments = [...project.text.segments, clampedSegment];
    // Sort by start time (Cap uses seconds)
    segments.sort((a, b) => a.start - b.start);

    // Find the index of the newly added segment after sorting
    const newIndex = segments.findIndex((s) => Math.abs(s.start - clampedSegment.start) < 0.001);

    // Generate selection ID (shared formatter used by TextTrack/TextOverlay).
    const segmentId = createTextSegmentId(clampedSegment.start, newIndex);

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments,
        },
      },
      selectedTextSegmentId: segmentId,
    });
  },

  updateTextSegment: (id, updates) => {
    const { project } = get();
    if (!project) return;

    const targetIndex = getTextSegmentIndexFromId(id);
    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= project.text.segments.length) return;

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments: project.text.segments.map((s, idx) => {
            if (idx === targetIndex) {
              return { ...s, ...updates };
            }
            return s;
          }),
        },
      },
    });
  },

  deleteTextSegment: (id) => {
    const { project, selectedTextSegmentId } = get();
    if (!project) return;

    const targetIndex = getTextSegmentIndexFromId(id);
    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= project.text.segments.length) return;

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments: project.text.segments.filter((_, idx) => idx !== targetIndex),
        },
      },
      selectedTextSegmentId: selectedTextSegmentId === id ? null : selectedTextSegmentId,
    });
  },

  // Annotation segment actions
  selectAnnotationSegment: (id) =>
    set((state) => {
      const annotations = normalizeAnnotationConfig(state.project?.annotations);
      const selectedSegment = id
        ? annotations.segments.find((segment) => segment.id === id) ?? null
        : null;

      return {
        selectedAnnotationSegmentId: id,
        selectedAnnotationShapeId: selectedSegment?.shapes[0]?.id ?? null,
        selectedZoomRegionId: null,
        selectedSceneSegmentId: null,
        selectedTextSegmentId: null,
        selectedMaskSegmentId: null,
        selectedWebcamSegmentIndex: null,
      };
    }),

  selectAnnotationShape: (id) => set({ selectedAnnotationShapeId: id }),

  addAnnotationSegment: (segment) => {
    const { project } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
      shapes: segment.shapes.map(clampAnnotationShape),
    };

    const segments = [...annotations.segments, clampedSegment]
      .sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        annotations: {
          ...annotations,
          segments,
        },
      },
      selectedAnnotationSegmentId: clampedSegment.id,
      selectedAnnotationShapeId: clampedSegment.shapes[0]?.id ?? null,
    });
  },

  updateAnnotationSegment: (id, updates) => {
    const { project } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    set({
      project: {
        ...project,
        annotations: {
          ...annotations,
          segments: annotations.segments
            .map((segment) => {
              if (segment.id !== id) {
                return segment;
              }

              return {
                ...segment,
                ...updates,
                shapes: (updates.shapes ?? segment.shapes).map(clampAnnotationShape),
              };
            })
            .sort((a, b) => a.startMs - b.startMs),
        },
      },
    });
  },

  deleteAnnotationSegment: (id) => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    set({
      project: {
        ...project,
        annotations: {
          ...annotations,
          segments: annotations.segments.filter((segment) => segment.id !== id),
        },
      },
      selectedAnnotationSegmentId: selectedAnnotationSegmentId === id ? null : selectedAnnotationSegmentId,
      selectedAnnotationShapeId: selectedAnnotationSegmentId === id ? null : selectedAnnotationShapeId,
    });
  },

  addAnnotationShape: (segmentId, shape) => {
    const { project } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    const clampedShape = clampAnnotationShape(shape);
    set({
      project: {
        ...project,
        annotations: {
          ...annotations,
          segments: annotations.segments.map((segment) =>
            segment.id === segmentId
              ? { ...segment, shapes: [...segment.shapes, clampedShape] }
              : segment
          ),
        },
      },
      selectedAnnotationSegmentId: segmentId,
      selectedAnnotationShapeId: clampedShape.id,
    });
  },

  updateAnnotationShape: (segmentId, shapeId, updates) => {
    const { project } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    set({
      project: {
        ...project,
        annotations: {
          ...annotations,
          segments: annotations.segments.map((segment) => {
            if (segment.id !== segmentId) {
              return segment;
            }

            return {
              ...segment,
              shapes: segment.shapes.map((shape) =>
                shape.id === shapeId ? clampAnnotationShape({ ...shape, ...updates }) : shape
              ),
            };
          }),
        },
      },
    });
  },

  deleteAnnotationShape: (segmentId, shapeId) => {
    const { project, selectedAnnotationShapeId } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    let nextSelectedShapeId = selectedAnnotationShapeId;
    const segments = annotations.segments.map((segment) => {
      if (segment.id !== segmentId) {
        return segment;
      }

      const nextShapes = segment.shapes.filter((shape) => shape.id !== shapeId);
      if (selectedAnnotationShapeId === shapeId) {
        nextSelectedShapeId = nextShapes[0]?.id ?? null;
      }

      return {
        ...segment,
        shapes: nextShapes,
      };
    });

    set({
      project: {
        ...project,
        annotations: {
          ...annotations,
          segments,
        },
      },
      selectedAnnotationShapeId: nextSelectedShapeId,
    });
  },

  // Mask segment actions
  selectMaskSegment: (id) =>
    set({
      selectedMaskSegmentId: id,
      selectedZoomRegionId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      selectedSceneSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addMaskSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
    };

    const segments = [...project.mask.segments, clampedSegment];
    segments.sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments,
        },
      },
      selectedMaskSegmentId: clampedSegment.id,
    });
  },

  updateMaskSegment: (id, updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments: project.mask.segments.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        },
      },
    });
  },

  deleteMaskSegment: (id) => {
    const { project, selectedMaskSegmentId } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments: project.mask.segments.filter((s) => s.id !== id),
        },
      },
      selectedMaskSegmentId: selectedMaskSegmentId === id ? null : selectedMaskSegmentId,
    });
  },

  // Scene segment actions
  selectSceneSegment: (id) =>
    set({
      selectedSceneSegmentId: id,
      selectedZoomRegionId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addSceneSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
    };

    const segments = [...project.scene.segments, clampedSegment];
    segments.sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments,
        },
      },
      selectedSceneSegmentId: clampedSegment.id,
    });
  },

  updateSceneSegment: (id, updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments: project.scene.segments.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        },
      },
    });
  },

  deleteSceneSegment: (id) => {
    const { project, selectedSceneSegmentId } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments: project.scene.segments.filter((s) => s.id !== id),
        },
      },
      selectedSceneSegmentId: selectedSceneSegmentId === id ? null : selectedSceneSegmentId,
    });
  },

  // Webcam segment actions
  selectWebcamSegment: (index) =>
    set({
      selectedWebcamSegmentIndex: index,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      selectedMaskSegmentId: null,
    }),

  addWebcamSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
    };

    const segments = [...project.webcam.visibilitySegments, clampedSegment];
    // Sort by start time
    segments.sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          visibilitySegments: segments,
        },
      },
    });
  },

  updateWebcamSegment: (index, updates) => {
    const { project } = get();
    if (!project) return;

    const segments = [...project.webcam.visibilitySegments];
    segments[index] = { ...segments[index], ...updates };

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          visibilitySegments: segments,
        },
      },
    });
  },

  deleteWebcamSegment: (index) => {
    const { project, selectedWebcamSegmentIndex } = get();
    if (!project) return;

    const segments = project.webcam.visibilitySegments.filter((_, i) => i !== index);

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          visibilitySegments: segments,
        },
      },
      selectedWebcamSegmentIndex: selectedWebcamSegmentIndex === index ? null : selectedWebcamSegmentIndex,
    });
  },

  toggleWebcamAtTime: (timeMs) => {
    const { project } = get();
    if (!project) return;

    const segments = project.webcam.visibilitySegments;

    // Find if current time is within a segment
    const segmentIndex = segments.findIndex((s) => timeMs >= s.startMs && timeMs <= s.endMs);

    if (segmentIndex >= 0) {
      // Split or remove segment
      const segment = segments[segmentIndex];
      const newSegments = [...segments];

      if (timeMs === segment.startMs) {
        // At start, just remove
        newSegments.splice(segmentIndex, 1);
      } else if (timeMs === segment.endMs) {
        // At end, just remove
        newSegments.splice(segmentIndex, 1);
      } else {
        // In middle, split into two
        newSegments.splice(segmentIndex, 1, { ...segment, endMs: timeMs }, { ...segment, startMs: timeMs });
      }

      set({
        project: {
          ...project,
          webcam: {
            ...project.webcam,
            visibilitySegments: newSegments,
          },
        },
      });
    } else {
      // Add new segment (default 5 seconds)
      const endMs = Math.min(timeMs + 5000, project.timeline.durationMs);
      const newSegment: VisibilitySegment = {
        startMs: timeMs,
        endMs,
        visible: true,
      };

      const newSegments = [...segments, newSegment].sort((a, b) => a.startMs - b.startMs);

      set({
        project: {
          ...project,
          webcam: {
            ...project.webcam,
            visibilitySegments: newSegments,
          },
        },
      });
    }
  },

  // Config actions
  updateWebcamConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          ...updates,
        },
      },
    });
  },

  updateCursorConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        cursor: {
          ...project.cursor,
          ...updates,
        },
      },
    });
  },

  updateAudioConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        audio: {
          ...project.audio,
          ...updates,
        },
      },
    });
  },
});
