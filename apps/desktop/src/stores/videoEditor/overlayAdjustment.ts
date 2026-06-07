import type { ZoomRegion, AnnotationSegment, MaskSegment, SceneSegment, TextSegment, VisibilitySegment } from './types';

/**
 * Minimum overlay duration in milliseconds.
 * Overlays shorter than this after adjustment are removed.
 */
export const MIN_OVERLAY_DURATION_MS = 50;

/**
 * A segment with ms-based start/end times.
 */
interface MsSegment {
  startMs: number;
  endMs: number;
}

function keepAdjustedSegment<T extends MsSegment>(
  segment: T,
  startMs: number,
  endMs: number,
  minDurationMs: number
): T | null {
  if (endMs - startMs < minDurationMs) return null;
  return { ...segment, startMs, endMs };
}

function adjustOverlaySegmentForDeletion<T extends MsSegment>(
  segment: T,
  delStartMs: number,
  delEndMs: number,
  deletedDuration: number,
  minDurationMs: number
): T | null {
  const { startMs, endMs } = segment;

  if (endMs <= delStartMs) return segment;
  if (startMs >= delEndMs) {
    return {
      ...segment,
      startMs: startMs - deletedDuration,
      endMs: endMs - deletedDuration,
    };
  }
  if (startMs >= delStartMs && endMs <= delEndMs) return null;
  if (startMs < delStartMs && endMs <= delEndMs) {
    return keepAdjustedSegment(segment, startMs, delStartMs, minDurationMs);
  }
  if (startMs >= delStartMs && endMs > delEndMs) {
    return keepAdjustedSegment(
      segment,
      delStartMs,
      delStartMs + (endMs - delEndMs),
      minDurationMs
    );
  }

  return keepAdjustedSegment(segment, startMs, endMs - deletedDuration, minDurationMs);
}

/**
 * Adjust overlay segments when a timeline range [delStartMs, delEndMs] is deleted.
 *
 * Six cases:
 *   1. segEnd <= delStart       → No change (entirely before deletion)
 *   2. segStart >= delEnd       → Shift left by deletedDuration (entirely after)
 *   3. segStart >= delStart && segEnd <= delEnd → Remove (entirely within)
 *   4. segStart < delStart && segEnd <= delEnd  → Trim end to delStart (overlaps start of deletion)
 *   5. segStart >= delStart && segEnd > delEnd  → Shift to delStart, shrink (overlaps end of deletion)
 *   6. segStart < delStart && segEnd > delEnd   → Shrink end by deletedDuration (encloses deletion)
 */
export function adjustOverlaySegmentsForDeletion<T extends MsSegment>(
  segments: T[],
  delStartMs: number,
  delEndMs: number,
  minDurationMs: number = MIN_OVERLAY_DURATION_MS
): T[] {
  const deletedDuration = delEndMs - delStartMs;
  if (deletedDuration <= 0) return segments;

  return segments.flatMap((segment) => {
    const adjusted = adjustOverlaySegmentForDeletion(
      segment,
      delStartMs,
      delEndMs,
      deletedDuration,
      minDurationMs
    );
    return adjusted ? [adjusted] : [];
  });
}

/**
 * Adjust text segments for deletion. Text segments use seconds (start/end)
 * instead of milliseconds (startMs/endMs), so we convert back and forth.
 */
export function adjustTextSegmentsForDeletion(
  segments: TextSegment[],
  delStartMs: number,
  delEndMs: number,
  minDurationMs: number = MIN_OVERLAY_DURATION_MS
): TextSegment[] {
  // Convert to ms-based wrapper objects
  const msSegments = segments.map((seg, i) => ({
    ...seg,
    _index: i,
    startMs: seg.start * 1000,
    endMs: seg.end * 1000,
  }));

  const adjusted = adjustOverlaySegmentsForDeletion(msSegments, delStartMs, delEndMs, minDurationMs);

  // Convert back to seconds, rounding to 3 decimal places
  return adjusted.map(({ _index: _, startMs, endMs, ...rest }) => ({
    ...(rest as unknown as Omit<TextSegment, 'start' | 'end'>),
    start: Number((startMs / 1000).toFixed(3)),
    end: Number((endMs / 1000).toFixed(3)),
  })) as TextSegment[];
}

/**
 * Snapshot of all overlay state for undo/redo history.
 */
export interface OverlaySnapshot {
  zoomRegions: ZoomRegion[];
  annotationSegments: AnnotationSegment[];
  maskSegments: MaskSegment[];
  sceneSegments: SceneSegment[];
  textSegments: TextSegment[];
  webcamVisibilitySegments: VisibilitySegment[];
}

/**
 * Capture overlay state from project for history snapshot.
 */
export function snapshotOverlayState(project: {
  zoom: { regions: ZoomRegion[] };
  annotations: { segments: AnnotationSegment[] };
  mask: { segments: MaskSegment[] };
  scene: { segments: SceneSegment[] };
  text: { segments: TextSegment[] };
  webcam: { visibilitySegments: VisibilitySegment[] };
}): OverlaySnapshot {
  return {
    zoomRegions: [...project.zoom.regions],
    annotationSegments: [...(project.annotations?.segments ?? [])],
    maskSegments: [...project.mask.segments],
    sceneSegments: [...project.scene.segments],
    textSegments: [...project.text.segments],
    webcamVisibilitySegments: [...project.webcam.visibilitySegments],
  };
}
