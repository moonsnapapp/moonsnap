import type { SliceCreator, MaskSegment } from '../types';
import { snapshotOverlayState } from '../overlayAdjustment';
import { pushTrimHistory } from '../trimSlice';
import { clampSegmentToDuration, ensureTrimHistoryInitialized } from './shared';

export interface MaskSegmentsSlice {
  selectedMaskSegmentId: string | null;

  selectMaskSegment: (id: string | null) => void;
  addMaskSegment: (segment: MaskSegment) => void;
  updateMaskSegment: (id: string, updates: Partial<MaskSegment>) => void;
  deleteMaskSegment: (id: string) => void;
}

export const createMaskSegmentsSlice: SliceCreator<MaskSegmentsSlice> = (set, get) => ({
  selectedMaskSegmentId: null,

  selectMaskSegment: (id) =>
    set({
      selectedMaskSegmentId: id,
      selectedZoomRegionId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedSceneSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addMaskSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    const clampedSegment = clampSegmentToDuration(segment, project.timeline.durationMs);

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
    const newSegments = project.mask.segments.map((s) => (s.id === id ? { ...s, ...updates } : s));
    const overlays = snapshotOverlayState(project);
    overlays.maskSegments = newSegments;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments: newSegments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteMaskSegment: (id) => {
    const {
      project,
      selectedMaskSegmentId,
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
    overlays.maskSegments = project.mask.segments.filter((s) => s.id !== id);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments: overlays.maskSegments,
        },
      },
      selectedMaskSegmentId: selectedMaskSegmentId === id ? null : selectedMaskSegmentId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },
});
