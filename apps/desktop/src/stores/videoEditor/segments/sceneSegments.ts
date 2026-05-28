import type { SliceCreator, SceneSegment } from '../types';
import { snapshotOverlayState } from '../overlayAdjustment';
import { pushTrimHistory } from '../trimSlice';
import { ensureTrimHistoryInitialized } from './shared';

export interface SceneSegmentsSlice {
  selectedSceneSegmentId: string | null;

  selectSceneSegment: (id: string | null) => void;
  addSceneSegment: (segment: SceneSegment) => void;
  updateSceneSegment: (id: string, updates: Partial<SceneSegment>) => void;
  deleteSceneSegment: (id: string) => void;
}

export const createSceneSegmentsSlice: SliceCreator<SceneSegmentsSlice> = (set, get) => ({
  selectedSceneSegmentId: null,

  selectSceneSegment: (id) =>
    set({
      selectedSceneSegmentId: id,
      selectedZoomRegionId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
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
    const {
      project,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const newSegments = project.scene.segments.map((s) => (s.id === id ? { ...s, ...updates } : s));
    const overlays = snapshotOverlayState(project);
    overlays.sceneSegments = newSegments;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments: newSegments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteSceneSegment: (id) => {
    const {
      project,
      selectedSceneSegmentId,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const overlays = snapshotOverlayState(project);
    overlays.sceneSegments = project.scene.segments.filter((s) => s.id !== id);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments: overlays.sceneSegments,
        },
      },
      selectedSceneSegmentId: selectedSceneSegmentId === id ? null : selectedSceneSegmentId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },
});
