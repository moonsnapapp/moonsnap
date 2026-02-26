/**
 * useZoomPreview - Calculates CSS transforms for zoom preview.
 *
 * Ports Cap's zoom interpolation logic to TypeScript for real-time
 * preview in the video player using CSS transforms.
 *
 * Uses Cap's bezier easing curves and bounds-based interpolation for
 * smooth zoom transitions with a fixed 1-second duration.
 *
 * Supports two zoom modes:
 * - Manual: Fixed zoom position (targetX/targetY)
 * - Auto: Follows cursor position during playback (like Cap)
 */

import { useMemo } from 'react';
import type { ZoomRegion, CursorRecording } from '../types';
import { useCursorInterpolation, type InterpolatedCursor } from './useCursorInterpolation';

/** Fixed zoom transition duration in seconds (matches Cap) */
const ZOOM_DURATION_S = 1.0;

// ============================================================================
// Bezier Easing (Cap's curves) - Proper cubic bezier implementation
// ============================================================================

/**
 * Attempt to solve the cubic bezier curve for a given t value.
 * For bezier(x1, y1, x2, y2), we need to:
 * 1. Find the parametric t that gives us our input x
 * 2. Return the y value at that t
 * 
 * Uses Newton-Raphson iteration for accuracy (same approach as bezier-easing crate).
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  // Sample the bezier X coordinate at parametric t
  const sampleCurveX = (t: number): number => {
    return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
  };
  
  // Sample the bezier Y coordinate at parametric t
  const sampleCurveY = (t: number): number => {
    return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
  };
  
  // Derivative of X with respect to t
  const sampleCurveDerivativeX = (t: number): number => {
    return (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
  };
  
  // Newton-Raphson iteration to find t for given x
  const solveCurveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xEstimate = sampleCurveX(t) - x;
      if (Math.abs(xEstimate) < 1e-6) return t;
      const derivative = sampleCurveDerivativeX(t);
      if (Math.abs(derivative) < 1e-6) break;
      t = t - xEstimate / derivative;
    }
    // Fallback: binary search
    let lo = 0, hi = 1;
    t = x;
    while (lo < hi) {
      const xEstimate = sampleCurveX(t);
      if (Math.abs(xEstimate - x) < 1e-6) return t;
      if (x > xEstimate) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  
  return (x: number): number => {
    if (x === 0 || x === 1) return x;
    return sampleCurveY(solveCurveX(x));
  };
}

// Pre-create Cap's easing functions for performance
const easeInCurve = cubicBezier(0.1, 0.0, 0.3, 1.0);
const easeOutCurve = cubicBezier(0.5, 0.0, 0.5, 1.0);

/**
 * Cap's ease-in curve: bezier(0.1, 0.0, 0.3, 1.0)
 * Starts slow, accelerates through middle, eases into end.
 */
function easeIn(t: number): number {
  return easeInCurve(t);
}

/**
 * Cap's ease-out curve: bezier(0.5, 0.0, 0.5, 1.0)
 * Symmetric S-curve, smooth start and end.
 */
function easeOut(t: number): number {
  return easeOutCurve(t);
}

// ============================================================================
// Bounds-based Zoom (Cap's approach)
// ============================================================================

interface XY {
  x: number;
  y: number;
}

interface SegmentBounds {
  topLeft: XY;
  bottomRight: XY;
}

function defaultBounds(): SegmentBounds {
  return { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 1 } };
}

/**
 * Calculate bounds from a zoom region using Cap's formula.
 */
function boundsFromRegion(
  region: ZoomRegion,
  cursorPos: XY | null
): SegmentBounds {
  // Get position - either from cursor (Auto mode) or fixed target
  const position = region.mode === 'auto' && cursorPos
    ? cursorPos
    : { x: region.targetX, y: region.targetY };

  const amount = region.scale;

  // Cap's calculation: scale the center, then offset to maintain position
  const scaledCenter = { x: position.x * amount, y: position.y * amount };
  const centerDiff = { x: scaledCenter.x - position.x, y: scaledCenter.y - position.y };

  return {
    topLeft: { x: 0 - centerDiff.x, y: 0 - centerDiff.y },
    bottomRight: { x: amount - centerDiff.x, y: amount - centerDiff.y },
  };
}

function lerpXY(a: XY, b: XY, t: number): XY {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function lerpBounds(a: SegmentBounds, b: SegmentBounds, t: number): SegmentBounds {
  return {
    topLeft: lerpXY(a.topLeft, b.topLeft, t),
    bottomRight: lerpXY(a.bottomRight, b.bottomRight, t),
  };
}

function boundsWidth(bounds: SegmentBounds): number {
  return bounds.bottomRight.x - bounds.topLeft.x;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ============================================================================
// Segments Cursor (tracks position in zoom timeline)
// ============================================================================

interface SegmentsCursor {
  timeS: number;
  segment: ZoomRegion | null;
  prevSegment: ZoomRegion | null;
  segments: ZoomRegion[];
}

function sortRegionsByStart(regions: ZoomRegion[]): ZoomRegion[] {
  if (regions.length < 2) {
    return regions;
  }

  let alreadySorted = true;
  for (let i = 1; i < regions.length; i++) {
    if (regions[i - 1].startMs > regions[i].startMs) {
      alreadySorted = false;
      break;
    }
  }

  if (alreadySorted) {
    return regions;
  }

  return [...regions].sort((a, b) => a.startMs - b.startMs);
}

function findLastRegionStartedBefore(segments: ZoomRegion[], timeMs: number): number {
  let low = 0;
  let high = segments.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startMs < timeMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function createCursor(timeS: number, segments: ZoomRegion[]): SegmentsCursor {
  const timeMs = timeS * 1000;
  const candidateIdx = findLastRegionStartedBefore(segments, timeMs);

  if (candidateIdx >= 0 && timeMs <= segments[candidateIdx].endMs) {
    return {
      timeS,
      segment: segments[candidateIdx],
      prevSegment: candidateIdx > 0 ? segments[candidateIdx - 1] : null,
      segments,
    };
  }

  return {
    timeS,
    segment: null,
    prevSegment: candidateIdx >= 0 ? segments[candidateIdx] : null,
    segments,
  };
}

// ============================================================================
// Interpolated Zoom (Cap's algorithm)
// ============================================================================

interface InterpolatedZoom {
  t: number;
  bounds: SegmentBounds;
}

function interpolateZoom(
  cursor: SegmentsCursor,
  cursorPos: XY | null
): InterpolatedZoom {
  const defaultB = defaultBounds();
  const { prevSegment, segment, timeS, segments } = cursor;

  // Case 1: After a segment, zooming out
  if (prevSegment && !segment) {
    const prevEndS = prevSegment.endMs / 1000;
    const zoomT = easeOut(clamp01((timeS - prevEndS) / ZOOM_DURATION_S));
    const prevBounds = boundsFromRegion(prevSegment, cursorPos);

    return {
      t: 1 - zoomT,
      bounds: lerpBounds(prevBounds, defaultB, zoomT),
    };
  }

  // Case 2: In first segment, zooming in
  if (!prevSegment && segment) {
    const startS = segment.startMs / 1000;
    const t = easeIn(clamp01((timeS - startS) / ZOOM_DURATION_S));
    const segmentBounds = boundsFromRegion(segment, cursorPos);

    return {
      t,
      bounds: lerpBounds(defaultB, segmentBounds, t),
    };
  }

  // Case 3: Transitioning between segments
  if (prevSegment && segment) {
    const prevBounds = boundsFromRegion(prevSegment, cursorPos);
    const segmentBounds = boundsFromRegion(segment, cursorPos);
    const segmentStartS = segment.startMs / 1000;
    const prevEndS = prevSegment.endMs / 1000;

    const zoomT = easeIn(clamp01((timeS - segmentStartS) / ZOOM_DURATION_S));

    // No gap: direct transition between segments
    if (Math.abs(segment.startMs - prevSegment.endMs) < 10) {
      return {
        t: 1,
        bounds: lerpBounds(prevBounds, segmentBounds, zoomT),
      };
    }
    // Small gap: interrupted zoom-out
    else if (segmentStartS - prevEndS < ZOOM_DURATION_S) {
      // Find where the zoom-out was interrupted
      const minCursor = createCursor(segmentStartS, segments);
      const min = interpolateZoom(minCursor, cursorPos);

      return {
        t: (min.t * (1 - zoomT)) + zoomT,
        bounds: lerpBounds(min.bounds, segmentBounds, zoomT),
      };
    }
    // Large gap: fully separate segments
    else {
      return {
        t: zoomT,
        bounds: lerpBounds(defaultB, segmentBounds, zoomT),
      };
    }
  }

  // No segments active
  return { t: 0, bounds: defaultB };
}

// ============================================================================
// Convert to ZoomState and CSS Transform
// ============================================================================

interface ZoomState {
  scale: number;
  centerX: number;
  centerY: number;
}

interface ZoomTransformStyle {
  transform: string;
  transformOrigin: string;
}

function boundsToZoomState(interp: InterpolatedZoom): ZoomState {
  const scale = boundsWidth(interp.bounds);

  // No zoom (scale ~= 1.0)
  if (Math.abs(scale - 1) < 0.001) {
    return { scale: 1, centerX: 0.5, centerY: 0.5 };
  }

  // Recover target coordinates from bounds.
  // The bounds are calculated as:
  //   topLeft = (0 - centerDiff.x, 0 - centerDiff.y)
  //   where centerDiff = (target * scale - target) = target * (scale - 1)
  // So: topLeft = -target * (scale - 1)
  // Therefore: target = -topLeft / (scale - 1)
  const centerX = -interp.bounds.topLeft.x / (scale - 1);
  const centerY = -interp.bounds.topLeft.y / (scale - 1);

  return { scale, centerX, centerY };
}

/**
 * Calculate the zoom state at a specific timestamp.
 */
function getZoomStateAtSorted(
  sortedRegions: ZoomRegion[],
  timestampMs: number,
  getCursorAt?: ((timeMs: number) => InterpolatedCursor) | null
): ZoomState {
  if (!sortedRegions || sortedRegions.length === 0) {
    return { scale: 1, centerX: 0.5, centerY: 0.5 };
  }

  const timeS = timestampMs / 1000;

  // Get cursor position for auto mode
  let cursorPos: XY | null = null;
  if (getCursorAt) {
    const cursor = getCursorAt(timestampMs);
    cursorPos = { x: cursor.x, y: cursor.y };
  }

  const cursor = createCursor(timeS, sortedRegions);
  const interp = interpolateZoom(cursor, cursorPos);

  return boundsToZoomState(interp);
}

export function getZoomStateAt(
  regions: ZoomRegion[],
  timestampMs: number,
  getCursorAt?: ((timeMs: number) => InterpolatedCursor) | null
): ZoomState {
  if (!regions || regions.length === 0) {
    return { scale: 1, centerX: 0.5, centerY: 0.5 };
  }
  return getZoomStateAtSorted(sortRegionsByStart(regions), timestampMs, getCursorAt);
}

interface ZoomTransformOptions {
  /** Background padding in pixels - when > 0, allows extended zoom range */
  backgroundPadding?: number;
  /** Corner rounding in pixels - used to preserve rounded corners when zooming */
  rounding?: number;
  /** Video dimensions for calculating rounding ratio */
  videoWidth?: number;
  videoHeight?: number;
}

/**
 * Convert zoom state to CSS transform properties.
 *
 * Parity note:
 * Export shader applies zoom by scaling around `zoom_center` (transform-origin equivalent)
 * with no extra translate/clamp adjustment. Keep preview identical.
 */
export function zoomStateToTransform(
  state: ZoomState,
  _options: ZoomTransformOptions = {}
): ZoomTransformStyle {
  // Always use an actual transform (even identity) to ensure consistent GPU compositing
  // Using 'none' vs actual transforms can cause rendering artifacts
  if (state.scale <= 1.001) {
    return {
      transform: 'scale(1)',
      transformOrigin: 'center center',
    };
  }

  return {
    transform: `scale(${state.scale})`,
    transformOrigin: `${state.centerX * 100}% ${state.centerY * 100}%`,
  };
}

interface UseZoomPreviewOptions {
  /** Background padding in pixels - when > 0, allows extended zoom range */
  backgroundPadding?: number;
  /** Corner rounding in pixels - preserves rounded corners when zooming */
  rounding?: number;
  /** Video width for calculating rounding ratio */
  videoWidth?: number;
  /** Video height for calculating rounding ratio */
  videoHeight?: number;
  /** Optional source-time timestamp for Auto zoom cursor lookup (trim-aware parity). */
  cursorTimeMs?: number;
}

/**
 * Hook to get zoom transform style for the current timestamp.
 *
 * Clamping behavior based on background settings:
 * - No padding: Clamp to prevent showing empty areas
 * - With padding + rounding: Allow extended range while preserving rounded corners
 * - With padding, no rounding: Allow full zoom range
 */
export function useZoomPreview(
  regions: ZoomRegion[] | undefined,
  currentTimeMs: number,
  cursorRecording?: CursorRecording | null,
  options: UseZoomPreviewOptions = {}
): ZoomTransformStyle {
  const {
    backgroundPadding = 0,
    rounding = 0,
    videoWidth = 1920,
    videoHeight = 1080,
    cursorTimeMs,
  } = options;
  const { getCursorAt, hasCursorData } = useCursorInterpolation(cursorRecording);
  const sortedRegions = useMemo(
    () => (regions && regions.length > 0 ? sortRegionsByStart(regions) : []),
    [regions]
  );

  return useMemo(() => {
    // Always return an identity transform instead of 'none'
    // This ensures consistent GPU compositing and prevents rendering artifacts
    // that can occur when switching between 'none' and actual transforms
    const identityTransform: ZoomTransformStyle = {
      transform: 'scale(1)',
      transformOrigin: 'center center',
    };

    if (sortedRegions.length === 0) {
      return identityTransform;
    }

    const state = getZoomStateAtSorted(
      sortedRegions,
      currentTimeMs,
      hasCursorData
        ? (timeMs) => getCursorAt(cursorTimeMs ?? timeMs)
        : null
    );

    // Pass through all options for smart clamping
    return zoomStateToTransform(state, { backgroundPadding, rounding, videoWidth, videoHeight });
  }, [
    sortedRegions,
    currentTimeMs,
    getCursorAt,
    hasCursorData,
    backgroundPadding,
    rounding,
    videoWidth,
    videoHeight,
    cursorTimeMs,
  ]);
}

/**
 * Check if any zoom is active at the given timestamp.
 */
export function isZoomedAt(regions: ZoomRegion[] | undefined, timestampMs: number): boolean {
  if (!regions || regions.length === 0) return false;
  const state = getZoomStateAt(regions, timestampMs);
  return state.scale > 1.001;
}
