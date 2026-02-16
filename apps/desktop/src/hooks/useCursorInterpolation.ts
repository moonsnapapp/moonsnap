/**
 * useCursorInterpolation - Raw cursor interpolation for video preview/export parity.
 *
 * Smooth movement has been removed. Cursor position is interpolated linearly
 * between recorded move events.
 */

import { useMemo, useCallback } from 'react';
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
  /** Scale factor (reserved for click animation parity) */
  scale: number;
}

function getCursorClickScale(_events: CursorEvent[], _timeMs: number): number {
  return 1.0;
}

function getActiveCursorId(events: CursorEvent[], timeMs: number): string | null {
  let activeCursorId: string | null = null;

  for (const event of events) {
    if (event.timestampMs > timeMs) break;
    if (event.cursorId !== null) {
      activeCursorId = event.cursorId;
    }
  }

  return activeCursorId;
}

function getSegmentVelocity(curr: CursorEvent, next: CursorEvent): XY {
  const dtMs = Math.max(next.timestampMs - curr.timestampMs, 1);
  const dtSeconds = dtMs / 1000;
  return {
    x: (next.x - curr.x) / dtSeconds,
    y: (next.y - curr.y) / dtSeconds,
  };
}

function interpolateRawAtTime(
  moveEvents: CursorEvent[],
  originalEvents: CursorEvent[],
  timeMs: number,
  cursorId: string | null
): InterpolatedCursor {
  const scale = getCursorClickScale(originalEvents, timeMs);

  if (moveEvents.length === 0) {
    return { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, cursorId, scale };
  }

  if (timeMs <= moveEvents[0].timestampMs) {
    const next = moveEvents[1];
    const velocity = next ? getSegmentVelocity(moveEvents[0], next) : { x: 0, y: 0 };
    return {
      x: moveEvents[0].x,
      y: moveEvents[0].y,
      velocityX: velocity.x,
      velocityY: velocity.y,
      cursorId,
      scale,
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
      cursorId,
      scale,
    };
  }

  for (let i = 0; i < moveEvents.length - 1; i++) {
    const curr = moveEvents[i];
    const next = moveEvents[i + 1];
    if (timeMs >= curr.timestampMs && timeMs < next.timestampMs) {
      const dtMs = Math.max(next.timestampMs - curr.timestampMs, 1);
      const t = (timeMs - curr.timestampMs) / dtMs;
      const velocity = getSegmentVelocity(curr, next);
      return {
        x: curr.x + (next.x - curr.x) * t,
        y: curr.y + (next.y - curr.y) * t,
        velocityX: velocity.x,
        velocityY: velocity.y,
        cursorId,
        scale,
      };
    }
  }

  return {
    x: last.x,
    y: last.y,
    velocityX: 0,
    velocityY: 0,
    cursorId,
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
  cursorRecording: CursorRecording | null | undefined
) {
  const rawMoveEvents = useMemo(() => {
    if (!cursorRecording) {
      return [];
    }
    return cursorRecording.events.filter((e) => e.eventType.type === 'move');
  }, [cursorRecording]);

  const originalEvents = useMemo(() => cursorRecording?.events ?? [], [cursorRecording]);
  const fallbackCursorId = useMemo(
    () => getFallbackCursorId(cursorRecording),
    [cursorRecording]
  );
  const videoStartOffsetMs = cursorRecording?.videoStartOffsetMs ?? 0;

  const getCursorAt = useCallback(
    (timeMs: number): InterpolatedCursor => {
      const adjustedTimeMs = timeMs + videoStartOffsetMs;
      const cursorId = getActiveCursorId(originalEvents, adjustedTimeMs) ?? fallbackCursorId;
      return interpolateRawAtTime(rawMoveEvents, originalEvents, adjustedTimeMs, cursorId);
    },
    [rawMoveEvents, originalEvents, fallbackCursorId, videoStartOffsetMs]
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
  timeMs: number
): InterpolatedCursor {
  if (!recording || recording.events.length === 0) {
    return { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, cursorId: null, scale: 1.0 };
  }

  const adjustedTimeMs = timeMs + (recording.videoStartOffsetMs ?? 0);
  const moveEvents = recording.events.filter((e: CursorEvent) => e.eventType.type === 'move');
  const cursorId = getActiveCursorId(recording.events, adjustedTimeMs) ?? getFallbackCursorId(recording);

  return interpolateRawAtTime(moveEvents, recording.events, adjustedTimeMs, cursorId);
}
