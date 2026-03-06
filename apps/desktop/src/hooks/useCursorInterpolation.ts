/**
 * useCursorInterpolation - Cursor interpolation for preview playback.
 *
 * Base sampling remains raw linear interpolation between recorded move events.
 * Preview callers can optionally enable zoom-adaptive smoothing so abrupt
 * cursor jumps feel less harsh when the frame is magnified.
 */

import { useMemo, useCallback } from 'react';
import { CURSOR } from '../constants';
import type { CursorRecording, CursorEvent } from '../types';

interface XY {
  x: number;
  y: number;
}

export interface InterpolatedCursor {
  /** Normalized position (0-1) */
  x: number;
  y: number;
  /** Velocity for motion blur effects */
  velocityX: number;
  velocityY: number;
  /** Active cursor image ID (references cursorImages map) */
  cursorId: string | null;
  /** Opacity (0-1) based on inactivity fade-out */
  opacity: number;
  /** Scale factor (reserved for click animation parity) */
  scale: number;
}

// Cursor idle fade constants - keep aligned with Rust rendering/cursor.rs.
const CURSOR_IDLE_TIMEOUT_MS = 1200;
const CURSOR_IDLE_FADE_DURATION_MS = 300;
// Ignore tiny move jitter when deciding if cursor is "active".
// Normalized units: 0.0015 ~= ~3px at 1920px width.
const CURSOR_ACTIVITY_MOVE_DEADZONE = 0.0015;
const CURSOR_ACTIVITY_MOVE_DEADZONE_SQ = CURSOR_ACTIVITY_MOVE_DEADZONE * CURSOR_ACTIVITY_MOVE_DEADZONE;
const CURSOR_SMOOTHING_MIN_ZOOM = 1.15;
const CURSOR_SMOOTHING_MAX_ZOOM = 2.0;
const CURSOR_SMOOTHING_MAX_WINDOW_MS = 72;
const CURSOR_SMOOTHING_MIN_WINDOW_MS = 12;
const CURSOR_SMOOTHING_OVERDRIVE_WINDOW_MS = 56;
const CURSOR_SMOOTHING_SAMPLE_OFFSETS = [-1, -0.5, 0, 0.5, 1] as const;
const CURSOR_SMOOTHING_SAMPLE_WEIGHTS = [0.12, 0.2, 0.36, 0.2, 0.12] as const;
const CURSOR_SMOOTHING_VELOCITY_DELTA_RATIO = 0.35;
const CURSOR_SMOOTHING_MIN_VELOCITY_DELTA_MS = 8;
const CURSOR_CATCHUP_RESPONSE_START = 0.0025;
const CURSOR_CATCHUP_RESPONSE_END = 0.045;
const CURSOR_CATCHUP_BASE_STRENGTH = 0.3;
const CURSOR_CATCHUP_OVERDRIVE_STRENGTH = 0.18;

export interface CursorInterpolationOptions {
  hideWhenIdle?: boolean;
  /** Cursor smoothing amount (0 = linear, 1 = fully smooth). */
  dampening?: number;
  /**
   * Returns the active preview zoom scale for the current frame.
   * When scale > 1, cursor motion is progressively smoothed to avoid
   * amplified shake in high-zoom playback.
   */
  getZoomScale?: ((timeMs: number) => number | null | undefined) | null;
}

function getCursorClickScale(_events: CursorEvent[], _timeMs: number): number {
  return 1.0;
}

function smoothstep(low: number, high: number, value: number): number {
  if (high <= low) {
    return value >= high ? 1 : 0;
  }
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function isCursorActivityEvent(event: CursorEvent): boolean {
  const type = event.eventType.type;
  return (
    type === 'move' ||
    type === 'leftClick' ||
    type === 'rightClick' ||
    type === 'middleClick' ||
    type === 'scroll'
  );
}

function collectCursorActivityEvents(events: CursorEvent[]): CursorEvent[] {
  const activityEvents: CursorEvent[] = [];
  let lastSignificantMove: CursorEvent | null = null;

  for (const event of events) {
    if (!isCursorActivityEvent(event)) {
      continue;
    }

    if (event.eventType.type !== 'move') {
      activityEvents.push(event);
      continue;
    }

    if (!lastSignificantMove) {
      activityEvents.push(event);
      lastSignificantMove = event;
      continue;
    }

    const dx = event.x - lastSignificantMove.x;
    const dy = event.y - lastSignificantMove.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= CURSOR_ACTIVITY_MOVE_DEADZONE_SQ) {
      activityEvents.push(event);
      lastSignificantMove = event;
    }
  }

  return activityEvents;
}

function getCursorIdleOpacity(activityEvents: CursorEvent[], timeMs: number): number {
  if (activityEvents.length === 0) {
    return 1.0;
  }

  const idx = findLastEventAtOrBefore(activityEvents, timeMs);
  if (idx < 0) {
    return 1.0;
  }

  const idleMs = Math.max(0, timeMs - activityEvents[idx].timestampMs);
  if (idleMs <= CURSOR_IDLE_TIMEOUT_MS) {
    return 1.0;
  }

  if (CURSOR_IDLE_FADE_DURATION_MS <= 0) {
    return 0.0;
  }

  const fadeProgress = (idleMs - CURSOR_IDLE_TIMEOUT_MS) / CURSOR_IDLE_FADE_DURATION_MS;
  return Math.max(0, Math.min(1, 1 - fadeProgress));
}

function findLastEventAtOrBefore(events: CursorEvent[], timeMs: number): number {
  let low = 0;
  let high = events.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const eventTime = events[mid].timestampMs;
    if (eventTime <= timeMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function getActiveCursorId(cursorIdEvents: CursorEvent[], timeMs: number): string | null {
  if (cursorIdEvents.length === 0) {
    return null;
  }
  const idx = findLastEventAtOrBefore(cursorIdEvents, timeMs);
  if (idx < 0) {
    return null;
  }
  return cursorIdEvents[idx].cursorId ?? null;
}

function getSegmentVelocity(curr: CursorEvent, next: CursorEvent): XY {
  const dtMs = Math.max(next.timestampMs - curr.timestampMs, 1);
  const dtSeconds = dtMs / 1000;
  return {
    x: (next.x - curr.x) / dtSeconds,
    y: (next.y - curr.y) / dtSeconds,
  };
}

interface RawCursorMotion {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

function sampleRawCursorMotionAtTime(moveEvents: CursorEvent[], timeMs: number): RawCursorMotion {
  if (moveEvents.length === 0) {
    return { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0 };
  }

  if (timeMs <= moveEvents[0].timestampMs) {
    const next = moveEvents[1];
    const velocity = next ? getSegmentVelocity(moveEvents[0], next) : { x: 0, y: 0 };
    return {
      x: moveEvents[0].x,
      y: moveEvents[0].y,
      velocityX: velocity.x,
      velocityY: velocity.y,
    };
  }

  const last = moveEvents[moveEvents.length - 1];
  if (timeMs >= last.timestampMs) {
    const prev = moveEvents[moveEvents.length - 2];
    const velocity = prev ? getSegmentVelocity(prev, last) : { x: 0, y: 0 };
    return {
      x: last.x,
      y: last.y,
      velocityX: velocity.x,
      velocityY: velocity.y,
    };
  }

  const idx = findLastEventAtOrBefore(moveEvents, timeMs);
  if (idx >= 0 && idx < moveEvents.length - 1) {
    const curr = moveEvents[idx];
    const next = moveEvents[idx + 1];
    const dtMs = Math.max(next.timestampMs - curr.timestampMs, 1);
    const t = (timeMs - curr.timestampMs) / dtMs;
    const velocity = getSegmentVelocity(curr, next);
    return {
      x: curr.x + (next.x - curr.x) * t,
      y: curr.y + (next.y - curr.y) * t,
      velocityX: velocity.x,
      velocityY: velocity.y,
    };
  }

  return {
    x: last.x,
    y: last.y,
    velocityX: 0,
    velocityY: 0,
  };
}

function getAdaptiveSmoothingStrength(
  getZoomScale: CursorInterpolationOptions['getZoomScale'],
  dampening: number,
  timeMs: number
): number {
  if (!getZoomScale || dampening <= 0) {
    return 0;
  }

  const zoomScale = getZoomScale(timeMs) ?? 1;
  if (!Number.isFinite(zoomScale) || zoomScale <= CURSOR_SMOOTHING_MIN_ZOOM) {
    return 0;
  }

  const zoomFactor = smoothstep(CURSOR_SMOOTHING_MIN_ZOOM, CURSOR_SMOOTHING_MAX_ZOOM, zoomScale);
  const baseDampening = Math.min(1, dampening);
  return zoomFactor * baseDampening;
}

function getAdaptiveSmoothingWindowMs(
  getZoomScale: CursorInterpolationOptions['getZoomScale'],
  dampening: number,
  timeMs: number
): number {
  if (!getZoomScale || dampening <= 0) {
    return CURSOR_SMOOTHING_MIN_WINDOW_MS;
  }

  const zoomScale = getZoomScale(timeMs) ?? 1;
  if (!Number.isFinite(zoomScale) || zoomScale <= CURSOR_SMOOTHING_MIN_ZOOM) {
    return CURSOR_SMOOTHING_MIN_WINDOW_MS;
  }

  const zoomFactor = smoothstep(CURSOR_SMOOTHING_MIN_ZOOM, CURSOR_SMOOTHING_MAX_ZOOM, zoomScale);
  const overdrive = Math.max(0, dampening - 1);
  return (
    CURSOR_SMOOTHING_MIN_WINDOW_MS +
    (CURSOR_SMOOTHING_MAX_WINDOW_MS - CURSOR_SMOOTHING_MIN_WINDOW_MS) * zoomFactor +
    CURSOR_SMOOTHING_OVERDRIVE_WINDOW_MS * zoomFactor * overdrive
  );
}

function getSmoothedCursorMotionAtTime(
  moveEvents: CursorEvent[],
  timeMs: number,
  getZoomScale: CursorInterpolationOptions['getZoomScale'],
  dampening: number
): RawCursorMotion {
  const rawMotion = sampleRawCursorMotionAtTime(moveEvents, timeMs);
  const smoothingStrength = getAdaptiveSmoothingStrength(getZoomScale, dampening, timeMs);

  if (smoothingStrength <= 0 || moveEvents.length < 3) {
    return rawMotion;
  }

  const windowMs = getAdaptiveSmoothingWindowMs(getZoomScale, dampening, timeMs);

  let totalWeight = 0;
  let accumulatedX = 0;
  let accumulatedY = 0;

  for (let i = 0; i < CURSOR_SMOOTHING_SAMPLE_OFFSETS.length; i += 1) {
    const weight = CURSOR_SMOOTHING_SAMPLE_WEIGHTS[i];
    const sampleTimeMs = timeMs + CURSOR_SMOOTHING_SAMPLE_OFFSETS[i] * windowMs;
    const sample = sampleRawCursorMotionAtTime(moveEvents, sampleTimeMs);
    totalWeight += weight;
    accumulatedX += sample.x * weight;
    accumulatedY += sample.y * weight;
  }

  if (totalWeight <= 0) {
    return rawMotion;
  }

  const averagedX = accumulatedX / totalWeight;
  const averagedY = accumulatedY / totalWeight;
  const derivativeDeltaMs = Math.max(
    CURSOR_SMOOTHING_MIN_VELOCITY_DELTA_MS,
    windowMs * CURSOR_SMOOTHING_VELOCITY_DELTA_RATIO
  );
  const before = sampleRawCursorMotionAtTime(moveEvents, timeMs - derivativeDeltaMs);
  const after = sampleRawCursorMotionAtTime(moveEvents, timeMs + derivativeDeltaMs);
  const derivativeScale = 1000 / Math.max(derivativeDeltaMs * 2, 1);
  const averagedVelocityX = (after.x - before.x) * derivativeScale;
  const averagedVelocityY = (after.y - before.y) * derivativeScale;
  const smoothedX = rawMotion.x + (averagedX - rawMotion.x) * smoothingStrength;
  const smoothedY = rawMotion.y + (averagedY - rawMotion.y) * smoothingStrength;
  const smoothedVelocityX =
    rawMotion.velocityX + (averagedVelocityX - rawMotion.velocityX) * smoothingStrength;
  const smoothedVelocityY =
    rawMotion.velocityY + (averagedVelocityY - rawMotion.velocityY) * smoothingStrength;
  const responseDistance = Math.hypot(smoothedX - rawMotion.x, smoothedY - rawMotion.y);
  const responseFactor = smoothstep(
    CURSOR_CATCHUP_RESPONSE_START,
    CURSOR_CATCHUP_RESPONSE_END,
    responseDistance
  );
  const overdrive = Math.max(0, dampening - 1);
  const catchupStrength = Math.min(
    0.65,
    smoothingStrength *
      responseFactor *
      (CURSOR_CATCHUP_BASE_STRENGTH + CURSOR_CATCHUP_OVERDRIVE_STRENGTH * overdrive)
  );

  return {
    x: smoothedX + (rawMotion.x - smoothedX) * catchupStrength,
    y: smoothedY + (rawMotion.y - smoothedY) * catchupStrength,
    velocityX: smoothedVelocityX + (rawMotion.velocityX - smoothedVelocityX) * catchupStrength,
    velocityY: smoothedVelocityY + (rawMotion.velocityY - smoothedVelocityY) * catchupStrength,
  };
}

function interpolateRawAtTime(
  moveEvents: CursorEvent[],
  originalEvents: CursorEvent[],
  timeMs: number,
  cursorId: string | null,
  opacity: number,
  getZoomScale: CursorInterpolationOptions['getZoomScale'],
  dampening: number
): InterpolatedCursor {
  const scale = getCursorClickScale(originalEvents, timeMs);
  const motion = getSmoothedCursorMotionAtTime(moveEvents, timeMs, getZoomScale, dampening);
  return {
    x: motion.x,
    y: motion.y,
    velocityX: motion.velocityX,
    velocityY: motion.velocityY,
    cursorId,
    opacity,
    scale,
  };
}

function getFallbackCursorId(cursorRecording: CursorRecording | null | undefined): string | null {
  const images = cursorRecording?.cursorImages ?? {};
  if (images['cursor_0']) {
    return 'cursor_0';
  }
  for (const [id, img] of Object.entries(images)) {
    if (img?.cursorShape === 'arrow') {
      return id;
    }
  }
  const keys = Object.keys(images);
  return keys.length > 0 ? keys[0] : null;
}

/**
 * Hook to get interpolated cursor position at any timestamp.
 */
export function useCursorInterpolation(
  cursorRecording: CursorRecording | null | undefined,
  hideWhenIdleOrOptions: boolean | CursorInterpolationOptions = true
) {
  const options = useMemo<CursorInterpolationOptions>(() => {
    if (typeof hideWhenIdleOrOptions === 'boolean') {
      return { hideWhenIdle: hideWhenIdleOrOptions };
    }
    return hideWhenIdleOrOptions;
  }, [hideWhenIdleOrOptions]);

  const hideWhenIdle = options.hideWhenIdle ?? true;
  const dampening = Math.max(
    CURSOR.DAMPENING_MIN,
    Math.min(CURSOR.DAMPENING_MAX, options.dampening ?? 0)
  );
  const getZoomScale = options.getZoomScale ?? null;

  const originalEvents = useMemo(() => {
    const events = cursorRecording?.events ?? [];
    if (events.length < 2) {
      return events;
    }
    return [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  }, [cursorRecording]);

  const rawMoveEvents = useMemo(() => {
    return originalEvents.filter((e) => e.eventType.type === 'move');
  }, [originalEvents]);

  const cursorIdEvents = useMemo(
    () => originalEvents.filter((e) => e.cursorId !== null),
    [originalEvents]
  );
  const activityEvents = useMemo(
    () => collectCursorActivityEvents(originalEvents),
    [originalEvents]
  );
  const fallbackCursorId = useMemo(
    () => getFallbackCursorId(cursorRecording),
    [cursorRecording]
  );
  const videoStartOffsetMs = cursorRecording?.videoStartOffsetMs ?? 0;

  const getCursorAt = useCallback(
    (timeMs: number): InterpolatedCursor => {
      const adjustedTimeMs = timeMs + videoStartOffsetMs;
      const cursorId = getActiveCursorId(cursorIdEvents, adjustedTimeMs) ?? fallbackCursorId;
      const opacity = hideWhenIdle
        ? getCursorIdleOpacity(activityEvents, adjustedTimeMs)
        : 1.0;
      return interpolateRawAtTime(
        rawMoveEvents,
        originalEvents,
        adjustedTimeMs,
        cursorId,
        opacity,
        getZoomScale,
        dampening
      );
    },
    [
      rawMoveEvents,
      originalEvents,
      cursorIdEvents,
      activityEvents,
      fallbackCursorId,
      videoStartOffsetMs,
      hideWhenIdle,
      getZoomScale,
      dampening,
    ]
  );

  return {
    getCursorAt,
    hasCursorData: rawMoveEvents.length > 0,
    cursorImages: cursorRecording?.cursorImages ?? {},
  };
}

/**
 * Get cursor position at a specific time (raw linear interpolation).
 */
export function getRawCursorAt(
  recording: CursorRecording | null | undefined,
  timeMs: number,
  hideWhenIdle = true
): InterpolatedCursor {
  if (!recording || recording.events.length === 0) {
    return { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, cursorId: null, opacity: 1.0, scale: 1.0 };
  }

  const adjustedTimeMs = timeMs + (recording.videoStartOffsetMs ?? 0);
  const originalEvents = recording.events.length < 2
    ? recording.events
    : [...recording.events].sort((a, b) => a.timestampMs - b.timestampMs);
  const moveEvents = originalEvents.filter((e: CursorEvent) => e.eventType.type === 'move');
  const cursorIdEvents = originalEvents.filter((e) => e.cursorId !== null);
  const activityEvents = collectCursorActivityEvents(originalEvents);
  const cursorId = getActiveCursorId(cursorIdEvents, adjustedTimeMs) ?? getFallbackCursorId(recording);
  const opacity = hideWhenIdle
    ? getCursorIdleOpacity(activityEvents, adjustedTimeMs)
    : 1.0;

  return interpolateRawAtTime(
    moveEvents,
    originalEvents,
    adjustedTimeMs,
    cursorId,
    opacity,
    null,
    0
  );
}
