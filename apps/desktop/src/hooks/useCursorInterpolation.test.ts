import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCursorInterpolation } from './useCursorInterpolation';
import type { CursorRecording } from '../types';

function createRecording(): CursorRecording {
  return {
    sampleRate: 100,
    width: 1920,
    height: 1080,
    regionX: 0,
    regionY: 0,
    videoStartOffsetMs: 0,
    events: [
      { timestampMs: 0, x: 0, y: 0.5, eventType: { type: 'move' }, cursorId: null },
      { timestampMs: 1000, x: 1, y: 0.5, eventType: { type: 'move' }, cursorId: null },
    ],
    cursorImages: {},
  };
}

describe('useCursorInterpolation', () => {
  it('uses raw linear interpolation', () => {
    const recording = createRecording();
    const { result } = renderHook(() => useCursorInterpolation(recording));

    const cursor = result.current.getCursorAt(250);
    expect(cursor.x).toBeCloseTo(0.25, 2);
    expect(cursor.y).toBeCloseTo(0.5, 2);
    expect(cursor.velocityX).toBeCloseTo(1, 2);
    expect(result.current.hasCursorData).toBe(true);
  });

  it('returns stable values for repeated reads at the same timestamp', () => {
    const recording = createRecording();
    const { result } = renderHook(() => useCursorInterpolation(recording));
    const a = result.current.getCursorAt(250);
    const b = result.current.getCursorAt(250);

    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.velocityX).toBeCloseTo(b.velocityX, 6);
    expect(a.velocityY).toBeCloseTo(b.velocityY, 6);
  });
});
