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

  it('fades cursor opacity out after inactivity', () => {
    const recording = createRecording();
    const { result } = renderHook(() => useCursorInterpolation(recording));

    const fullyVisible = result.current.getCursorAt(2100);
    const fading = result.current.getCursorAt(2350);
    const hidden = result.current.getCursorAt(2700);

    expect(fullyVisible.opacity).toBeCloseTo(1, 3);
    expect(fading.opacity).toBeGreaterThan(0);
    expect(fading.opacity).toBeLessThan(1);
    expect(hidden.opacity).toBeCloseTo(0, 3);
  });

  it('restores opacity on click activity', () => {
    const recording: CursorRecording = {
      ...createRecording(),
      events: [
        { timestampMs: 0, x: 0, y: 0.5, eventType: { type: 'move' }, cursorId: null },
        { timestampMs: 1000, x: 1, y: 0.5, eventType: { type: 'move' }, cursorId: null },
        { timestampMs: 2600, x: 1, y: 0.5, eventType: { type: 'leftClick', pressed: true }, cursorId: null },
      ],
    };

    const { result } = renderHook(() => useCursorInterpolation(recording));

    const beforeClick = result.current.getCursorAt(2500);
    const onClick = result.current.getCursorAt(2600);

    expect(beforeClick.opacity).toBeCloseTo(0, 3);
    expect(onClick.opacity).toBeCloseTo(1, 3);
  });

  it('ignores tiny move jitter for activity detection', () => {
    const recording: CursorRecording = {
      ...createRecording(),
      events: [
        { timestampMs: 0, x: 0, y: 0.5, eventType: { type: 'move' }, cursorId: null },
        { timestampMs: 1000, x: 1, y: 0.5, eventType: { type: 'move' }, cursorId: null },
        // Very small move (~0.0003 normalized), below deadzone threshold.
        { timestampMs: 2500, x: 1.0003, y: 0.5, eventType: { type: 'move' }, cursorId: null },
      ],
    };

    const { result } = renderHook(() => useCursorInterpolation(recording));
    const afterJitter = result.current.getCursorAt(2600);

    expect(afterJitter.opacity).toBeCloseTo(0, 3);
  });

  it('keeps opacity at 1 when hideWhenIdle is disabled', () => {
    const recording = createRecording();
    const { result } = renderHook(() => useCursorInterpolation(recording, false));
    const cursor = result.current.getCursorAt(5000);
    expect(cursor.opacity).toBeCloseTo(1, 3);
  });
});
