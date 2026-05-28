import type { AnnotationSegment, VideoProject } from '../types';
import { snapshotOverlayState } from '../overlayAdjustment';
import { pushTrimHistory } from '../trimSlice';

/**
 * Maximum annotation undo history size.
 */
export const MAX_ANNOTATION_HISTORY = 50;

/**
 * Undo history entry for annotation operations.
 */
export interface AnnotationHistoryEntry {
  segments: AnnotationSegment[];
  selectedSegmentId: string | null;
  selectedShapeId: string | null;
  deleteMode: 'segment' | 'shape' | null;
}

/**
 * Push a new state to annotation history, clearing any redo states.
 */
export function pushAnnotationHistory(
  history: AnnotationHistoryEntry[],
  historyIndex: number,
  newEntry: AnnotationHistoryEntry
): { history: AnnotationHistoryEntry[]; index: number } {
  const newHistory = history.slice(0, historyIndex + 1);
  newHistory.push(newEntry);

  if (newHistory.length > MAX_ANNOTATION_HISTORY) {
    newHistory.shift();
    return { history: newHistory, index: newHistory.length - 1 };
  }

  return { history: newHistory, index: newHistory.length - 1 };
}

/**
 * Seed the trim-history stack with the current overlay/timeline state on the
 * first overlay mutation, so the very first undo can restore the pre-edit state.
 * Shared by the zoom/text/mask/scene/webcam slices, which all push overlay
 * edits onto the trim undo domain.
 */
export function ensureTrimHistoryInitialized(
  project: VideoProject,
  trimHistory: Parameters<typeof pushTrimHistory>[0],
  trimHistoryIndex: number,
  selectedTrimSegmentId: string | null
): ReturnType<typeof pushTrimHistory> {
  if (trimHistory.length > 0) {
    return { history: trimHistory, index: trimHistoryIndex };
  }

  return pushTrimHistory([], -1, {
    segments: [...project.timeline.segments],
    selectedId: selectedTrimSegmentId,
    overlays: snapshotOverlayState(project),
  });
}
