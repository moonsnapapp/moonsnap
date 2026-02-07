import type { SliceCreator } from './types';
import type { TrimSegment } from '../../types';
import {
  adjustOverlaySegmentsForDeletion,
  adjustTextSegmentsForDeletion,
  snapshotOverlayState,
  type OverlaySnapshot,
} from './overlayAdjustment';

/**
 * Minimum segment duration in milliseconds.
 * Prevents micro-segments that are difficult to interact with.
 */
export const MIN_TRIM_SEGMENT_DURATION_MS = 100;

/**
 * Maximum undo history size.
 */
const MAX_UNDO_HISTORY = 50;

/**
 * Generate a unique trim segment ID.
 */
export function generateTrimSegmentId(): string {
  return `trim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Convert timeline time to source time.
 * Timeline time is the position after cuts have been applied (rippled).
 * Source time is the position in the original video.
 *
 * @param timelineMs - Time in the edited timeline (after cuts)
 * @param segments - Array of trim segments (if empty, returns timelineMs unchanged)
 * @returns Source time in the original video
 */
export function timelineToSource(timelineMs: number, segments: TrimSegment[]): number {
  if (!segments || segments.length === 0) {
    return timelineMs;
  }

  let accumulatedTimeline = 0;

  for (const segment of segments) {
    const segmentDuration = segment.sourceEndMs - segment.sourceStartMs;

    if (timelineMs < accumulatedTimeline + segmentDuration) {
      const offsetInSegment = timelineMs - accumulatedTimeline;
      return segment.sourceStartMs + offsetInSegment;
    }

    accumulatedTimeline += segmentDuration;
  }

  const lastSegment = segments[segments.length - 1];
  return lastSegment.sourceEndMs;
}

/**
 * Convert source time to timeline time.
 *
 * @param sourceMs - Time in the original video
 * @param segments - Array of trim segments (if empty, returns sourceMs unchanged)
 * @returns Timeline time after cuts have been applied, or null if source time is in a deleted region
 */
export function sourceToTimeline(sourceMs: number, segments: TrimSegment[]): number | null {
  if (!segments || segments.length === 0) {
    return sourceMs;
  }

  let accumulatedTimeline = 0;

  for (const segment of segments) {
    if (sourceMs >= segment.sourceStartMs && sourceMs < segment.sourceEndMs) {
      const offsetInSegment = sourceMs - segment.sourceStartMs;
      return accumulatedTimeline + offsetInSegment;
    }

    if (sourceMs < segment.sourceStartMs) {
      return accumulatedTimeline;
    }

    accumulatedTimeline += segment.sourceEndMs - segment.sourceStartMs;
  }

  return accumulatedTimeline;
}

/**
 * Calculate the effective duration of the timeline after cuts.
 *
 * @param segments - Array of trim segments
 * @param originalDurationMs - Original video duration (used if no segments)
 * @returns Total duration of included segments
 */
export function getEffectiveDuration(segments: TrimSegment[], originalDurationMs: number): number {
  if (!segments || segments.length === 0) {
    return originalDurationMs;
  }

  return segments.reduce((total, segment) => {
    return total + (segment.sourceEndMs - segment.sourceStartMs);
  }, 0);
}

/**
 * Calculate timeline position for a segment (where it starts in the rippled timeline).
 *
 * @param segmentIndex - Index of the segment
 * @param segments - Array of all segments
 * @returns Timeline start position in ms
 */
export function getSegmentTimelinePosition(segmentIndex: number, segments: TrimSegment[]): number {
  if (!segments || segmentIndex < 0 || segmentIndex >= segments.length) {
    return 0;
  }

  let position = 0;
  for (let i = 0; i < segmentIndex; i++) {
    position += segments[i].sourceEndMs - segments[i].sourceStartMs;
  }
  return position;
}

/**
 * Find which segment contains a given source time.
 */
export function findSegmentAtSourceTime(sourceMs: number, segments: TrimSegment[]): TrimSegment | null {
  if (!segments) return null;
  for (const segment of segments) {
    if (sourceMs >= segment.sourceStartMs && sourceMs < segment.sourceEndMs) {
      return segment;
    }
  }
  return null;
}

/**
 * Find the segment index at a given timeline time.
 */
export function findSegmentIndexAtTimelineTime(timelineMs: number, segments: TrimSegment[]): number {
  if (!segments || segments.length === 0) {
    return -1;
  }

  let accumulatedTimeline = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentDuration = segment.sourceEndMs - segment.sourceStartMs;

    if (timelineMs < accumulatedTimeline + segmentDuration) {
      return i;
    }

    accumulatedTimeline += segmentDuration;
  }

  return segments.length - 1;
}

/**
 * Clip trim segments to a timeline range defined by in/out points.
 * Walks segments tracking accumulated timeline time, clips each to the IO overlap.
 * When no segments exist, creates a single segment [inPointMs, outPointMs).
 *
 * @param segments - Array of trim segments (may be empty)
 * @param inPointMs - Start of export range in timeline time (null = start of timeline)
 * @param outPointMs - End of export range in timeline time (null = end of timeline)
 * @param totalDurationMs - Original video duration (used when no segments exist)
 * @returns Clipped array of trim segments
 */
export function clipSegmentsToTimelineRange(
  segments: TrimSegment[],
  inPointMs: number | null,
  outPointMs: number | null,
  totalDurationMs: number
): TrimSegment[] {
  const effectiveIn = inPointMs ?? 0;
  const effectiveOut = outPointMs ?? Infinity;

  // No segments means untrimmed: create a single segment for the IO range
  if (!segments || segments.length === 0) {
    const clampedOut = Math.min(effectiveOut, totalDurationMs);
    return [{
      id: generateTrimSegmentId(),
      sourceStartMs: Math.round(effectiveIn),
      sourceEndMs: Math.round(clampedOut),
    }];
  }

  const result: TrimSegment[] = [];
  let accumulatedTimeline = 0;

  for (const segment of segments) {
    const segmentDuration = segment.sourceEndMs - segment.sourceStartMs;
    const segmentTimelineStart = accumulatedTimeline;
    const segmentTimelineEnd = accumulatedTimeline + segmentDuration;

    // Find overlap between [segmentTimelineStart, segmentTimelineEnd) and [effectiveIn, effectiveOut)
    const overlapStart = Math.max(segmentTimelineStart, effectiveIn);
    const overlapEnd = Math.min(segmentTimelineEnd, effectiveOut);

    if (overlapStart < overlapEnd) {
      // Map back to source time
      const sourceOffset = overlapStart - segmentTimelineStart;
      const sourceLength = overlapEnd - overlapStart;

      result.push({
        id: segment.id,
        sourceStartMs: Math.round(segment.sourceStartMs + sourceOffset),
        sourceEndMs: Math.round(segment.sourceStartMs + sourceOffset + sourceLength),
      });
    }

    accumulatedTimeline += segmentDuration;
  }

  return result;
}

/**
 * Undo history entry for timeline operations (trim + overlays).
 */
interface TimelineHistoryEntry {
  segments: TrimSegment[];
  selectedId: string | null;
  overlays: OverlaySnapshot;
}

/**
 * Create a single segment covering the full video duration.
 */
function createFullSegment(durationMs: number): TrimSegment {
  return {
    id: generateTrimSegmentId(),
    sourceStartMs: 0,
    sourceEndMs: Math.round(durationMs),
  };
}

/**
 * Trim state and actions for managing video trim segments.
 */
export interface TrimSlice {
  // Selection state
  selectedTrimSegmentId: string | null;

  // Undo/redo history
  trimHistory: TimelineHistoryEntry[];
  trimHistoryIndex: number;

  // Selection actions
  selectTrimSegment: (id: string | null) => void;

  // Segment actions
  splitAtPlayhead: () => void;
  deleteTrimSegment: (id: string) => void;
  updateTrimSegment: (id: string, updates: Partial<Pick<TrimSegment, 'sourceStartMs' | 'sourceEndMs'>>) => void;

  // Initialize segments
  initializeTrimSegments: () => void;

  // Reset to full video
  resetTrimSegments: () => void;

  // Undo/redo
  undoTrim: () => void;
  redoTrim: () => void;
  canUndoTrim: () => boolean;
  canRedoTrim: () => boolean;
}

/**
 * Push a new state to history, clearing any redo states.
 */
function pushTrimHistory(
  history: TimelineHistoryEntry[],
  historyIndex: number,
  newEntry: TimelineHistoryEntry
): { history: TimelineHistoryEntry[]; index: number } {
  // Remove any future states (redo stack)
  const newHistory = history.slice(0, historyIndex + 1);

  // Add new state
  newHistory.push(newEntry);

  // Limit history size
  if (newHistory.length > MAX_UNDO_HISTORY) {
    newHistory.shift();
    return { history: newHistory, index: newHistory.length - 1 };
  }

  return { history: newHistory, index: newHistory.length - 1 };
}

export const createTrimSlice: SliceCreator<TrimSlice> = (set, get) => ({
  // Initial state
  selectedTrimSegmentId: null,
  trimHistory: [],
  trimHistoryIndex: -1,

  // Selection actions
  selectTrimSegment: (id) =>
    set({
      selectedTrimSegmentId: id,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  // Initialize segments - creates a single segment covering the full video if none exist
  initializeTrimSegments: () => {
    const { project, trimHistory, trimHistoryIndex } = get();
    if (!project) return;
    if (project.timeline.segments && project.timeline.segments.length > 0) return;

    const newSegments = [createFullSegment(project.timeline.durationMs)];
    const { history, index } = pushTrimHistory(trimHistory, trimHistoryIndex, {
      segments: newSegments,
      selectedId: null,
      overlays: snapshotOverlayState(project),
    });

    set({
      project: {
        ...project,
        timeline: { ...project.timeline, segments: newSegments },
      },
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Reset to full video (single segment covering entire duration)
  resetTrimSegments: () => {
    const { project, trimHistory, trimHistoryIndex } = get();
    if (!project) return;

    const newSegments = [createFullSegment(project.timeline.durationMs)];
    const { history, index } = pushTrimHistory(trimHistory, trimHistoryIndex, {
      segments: newSegments,
      selectedId: null,
      overlays: snapshotOverlayState(project),
    });

    set({
      project: {
        ...project,
        timeline: { ...project.timeline, segments: newSegments },
      },
      selectedTrimSegmentId: null,
      trimHistory: history,
      trimHistoryIndex: index,
      currentTimeMs: 0,
    });
  },

  // Split the video at the current playhead position
  splitAtPlayhead: () => {
    const { project, currentTimeMs } = get();
    let { trimHistory, trimHistoryIndex } = get();
    if (!project) return;

    let segments = project.timeline.segments ? [...project.timeline.segments] : [];

    // If no segments, create initial segment first
    if (segments.length === 0) {
      segments = [createFullSegment(project.timeline.durationMs)];
    }

    // If history is empty, push the current state first so we can undo back to it
    if (trimHistory.length === 0) {
      const { selectedTrimSegmentId } = get();
      const initialHistory = pushTrimHistory([], -1, {
        segments: [...segments],
        selectedId: selectedTrimSegmentId,
        overlays: snapshotOverlayState(project),
      });
      trimHistory = initialHistory.history;
      trimHistoryIndex = initialHistory.index;
    }

    // Current time is in timeline time, convert to source time
    // Round to integer since Rust expects u64
    const sourceTimeMs = Math.round(timelineToSource(currentTimeMs, segments));

    // Find the segment that contains this source time
    const segmentIndex = segments.findIndex(
      (s) => sourceTimeMs > s.sourceStartMs && sourceTimeMs < s.sourceEndMs
    );

    if (segmentIndex === -1) {
      return;
    }

    const segment = segments[segmentIndex];

    // Check minimum duration constraints
    const leftDuration = sourceTimeMs - segment.sourceStartMs;
    const rightDuration = segment.sourceEndMs - sourceTimeMs;

    if (leftDuration < MIN_TRIM_SEGMENT_DURATION_MS || rightDuration < MIN_TRIM_SEGMENT_DURATION_MS) {
      return;
    }

    // Create two new segments from the split
    const leftSegment: TrimSegment = {
      id: generateTrimSegmentId(),
      sourceStartMs: Math.round(segment.sourceStartMs),
      sourceEndMs: sourceTimeMs,
    };

    const rightSegment: TrimSegment = {
      id: generateTrimSegmentId(),
      sourceStartMs: sourceTimeMs,
      sourceEndMs: Math.round(segment.sourceEndMs),
    };

    const newSegments = [
      ...segments.slice(0, segmentIndex),
      leftSegment,
      rightSegment,
      ...segments.slice(segmentIndex + 1),
    ];

    // Push to history (split doesn't change overlays — snapshot current state)
    const { history, index } = pushTrimHistory(trimHistory, trimHistoryIndex, {
      segments: newSegments,
      selectedId: rightSegment.id,
      overlays: snapshotOverlayState(project),
    });

    set({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          segments: newSegments,
        },
      },
      selectedTrimSegmentId: rightSegment.id,
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Delete a trim segment (ripple: remaining segments collapse together, overlays adjusted)
  deleteTrimSegment: (id) => {
    const { project, selectedTrimSegmentId, trimHistory, trimHistoryIndex } = get();
    if (!project) return;

    const segments = project.timeline.segments;
    if (!segments || segments.length <= 1) {
      return;
    }

    // Find the deleted segment's index to calculate its timeline position
    const deletedIndex = segments.findIndex((s) => s.id === id);
    if (deletedIndex === -1) return;

    const deletedSegment = segments[deletedIndex];
    const delStartMs = getSegmentTimelinePosition(deletedIndex, segments);
    const delEndMs = delStartMs + (deletedSegment.sourceEndMs - deletedSegment.sourceStartMs);

    const newSegments = segments.filter((s) => s.id !== id);

    // Adjust all overlay segments for the deleted timeline range
    const newZoomRegions = adjustOverlaySegmentsForDeletion(project.zoom.regions, delStartMs, delEndMs);
    const newMaskSegments = adjustOverlaySegmentsForDeletion(project.mask.segments, delStartMs, delEndMs);
    const newSceneSegments = adjustOverlaySegmentsForDeletion(project.scene.segments, delStartMs, delEndMs);
    const newTextSegments = adjustTextSegmentsForDeletion(project.text.segments, delStartMs, delEndMs);
    const newWebcamSegments = adjustOverlaySegmentsForDeletion(project.webcam.visibilitySegments, delStartMs, delEndMs);

    const newSelectedId = selectedTrimSegmentId === id ? null : selectedTrimSegmentId;

    // Push to history with new overlay state
    const { history, index } = pushTrimHistory(trimHistory, trimHistoryIndex, {
      segments: newSegments,
      selectedId: newSelectedId,
      overlays: {
        zoomRegions: newZoomRegions,
        maskSegments: newMaskSegments,
        sceneSegments: newSceneSegments,
        textSegments: newTextSegments,
        webcamVisibilitySegments: newWebcamSegments,
      },
    });

    set({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          segments: newSegments,
        },
        zoom: { ...project.zoom, regions: newZoomRegions },
        mask: { ...project.mask, segments: newMaskSegments },
        scene: { ...project.scene, segments: newSceneSegments },
        text: { ...project.text, segments: newTextSegments },
        webcam: { ...project.webcam, visibilitySegments: newWebcamSegments },
      },
      selectedTrimSegmentId: newSelectedId,
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Update a trim segment's boundaries (for edge dragging)
  updateTrimSegment: (id, updates) => {
    const { project, trimHistory, trimHistoryIndex } = get();
    if (!project) return;

    const segments = project.timeline.segments;
    if (!segments) return;

    const segmentIndex = segments.findIndex((s) => s.id === id);
    if (segmentIndex === -1) return;

    const segment = segments[segmentIndex];
    const newStartMs = updates.sourceStartMs ?? segment.sourceStartMs;
    const newEndMs = updates.sourceEndMs ?? segment.sourceEndMs;

    if (newEndMs - newStartMs < MIN_TRIM_SEGMENT_DURATION_MS) {
      return;
    }

    // Round to integers since Rust expects u64
    const clampedStartMs = Math.round(Math.max(0, newStartMs));
    const clampedEndMs = Math.round(Math.min(project.timeline.durationMs, newEndMs));

    const newSegments = segments.map((s, i) => {
      if (i === segmentIndex) {
        return {
          ...s,
          sourceStartMs: clampedStartMs,
          sourceEndMs: clampedEndMs,
        };
      }
      return s;
    });

    // Push to history
    const { history, index } = pushTrimHistory(trimHistory, trimHistoryIndex, {
      segments: newSegments,
      selectedId: id,
      overlays: snapshotOverlayState(project),
    });

    set({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          segments: newSegments,
        },
      },
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Undo last trim operation (restores both trim segments and overlay state)
  undoTrim: () => {
    const { project, trimHistory, trimHistoryIndex } = get();
    if (!project || trimHistoryIndex <= 0) return;

    const prevEntry = trimHistory[trimHistoryIndex - 1];

    set({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          segments: prevEntry.segments,
        },
        zoom: { ...project.zoom, regions: prevEntry.overlays.zoomRegions },
        mask: { ...project.mask, segments: prevEntry.overlays.maskSegments },
        scene: { ...project.scene, segments: prevEntry.overlays.sceneSegments },
        text: { ...project.text, segments: prevEntry.overlays.textSegments },
        webcam: { ...project.webcam, visibilitySegments: prevEntry.overlays.webcamVisibilitySegments },
      },
      selectedTrimSegmentId: prevEntry.selectedId,
      trimHistoryIndex: trimHistoryIndex - 1,
    });
  },

  // Redo last undone trim operation (restores both trim segments and overlay state)
  redoTrim: () => {
    const { project, trimHistory, trimHistoryIndex } = get();
    if (!project || trimHistoryIndex >= trimHistory.length - 1) return;

    const nextEntry = trimHistory[trimHistoryIndex + 1];

    set({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          segments: nextEntry.segments,
        },
        zoom: { ...project.zoom, regions: nextEntry.overlays.zoomRegions },
        mask: { ...project.mask, segments: nextEntry.overlays.maskSegments },
        scene: { ...project.scene, segments: nextEntry.overlays.sceneSegments },
        text: { ...project.text, segments: nextEntry.overlays.textSegments },
        webcam: { ...project.webcam, visibilitySegments: nextEntry.overlays.webcamVisibilitySegments },
      },
      selectedTrimSegmentId: nextEntry.selectedId,
      trimHistoryIndex: trimHistoryIndex + 1,
    });
  },

  canUndoTrim: () => {
    const { trimHistoryIndex } = get();
    return trimHistoryIndex > 0;
  },

  canRedoTrim: () => {
    const { trimHistory, trimHistoryIndex } = get();
    return trimHistoryIndex < trimHistory.length - 1;
  },
});
