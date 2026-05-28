import type { SliceCreator, TextSegment } from '../types';
import { createTextSegmentId, getTextSegmentIndexFromId } from '../../../utils/textSegmentId';
import { calculateTextSegmentHeightRatio } from '../../../utils/textMeasure';
import { snapshotOverlayState } from '../overlayAdjustment';
import { pushTrimHistory } from '../trimSlice';
import { ensureTrimHistoryInitialized } from './shared';

const TEXT_AUTO_HEIGHT_KEYS: Array<keyof TextSegment> = [
  'content',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
];

function shouldAutoFitTextSegmentHeight(updates: Partial<TextSegment>): boolean {
  return TEXT_AUTO_HEIGHT_KEYS.some((key) => key in updates);
}

export interface TextSegmentsSlice {
  selectedTextSegmentId: string | null;

  selectTextSegment: (id: string | null) => void;
  addTextSegment: (segment: TextSegment) => void;
  updateTextSegment: (id: string, updates: Partial<TextSegment>) => void;
  deleteTextSegment: (id: string) => void;
}

export const createTextSegmentsSlice: SliceCreator<TextSegmentsSlice> = (set, get) => ({
  selectedTextSegmentId: null,

  selectTextSegment: (id) =>
    set({
      selectedTextSegmentId: id,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
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
    const {
      project,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const targetIndex = getTextSegmentIndexFromId(id);
    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= project.text.segments.length) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const shouldAutoFitHeight = shouldAutoFitTextSegmentHeight(updates);
    const newSegments = project.text.segments.map((s, idx) => {
      if (idx === targetIndex) {
        const nextSegment = { ...s, ...updates };
        if (!shouldAutoFitHeight) {
          return nextSegment;
        }

        return {
          ...nextSegment,
          size: {
            ...nextSegment.size,
            y: calculateTextSegmentHeightRatio(
              {
                content: nextSegment.content,
                fontFamily: nextSegment.fontFamily,
                fontSize: nextSegment.fontSize,
                fontWeight: nextSegment.fontWeight,
                italic: nextSegment.italic,
              },
              nextSegment.size.x,
              project.sources.originalWidth,
              project.sources.originalHeight,
            ),
          },
        };
      }
      return s;
    });
    const overlays = snapshotOverlayState(project);
    overlays.textSegments = newSegments;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments: newSegments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteTextSegment: (id) => {
    const {
      project,
      selectedTextSegmentId,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const targetIndex = getTextSegmentIndexFromId(id);
    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= project.text.segments.length) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const overlays = snapshotOverlayState(project);
    overlays.textSegments = project.text.segments.filter((_, idx) => idx !== targetIndex);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments: overlays.textSegments,
        },
      },
      selectedTextSegmentId: selectedTextSegmentId === id ? null : selectedTextSegmentId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },
});
