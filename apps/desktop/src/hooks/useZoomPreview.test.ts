import { describe, expect, it } from 'vitest';
import { getZoomStateAt, zoomStateToTransform } from './useZoomPreview';
import type { ZoomRegion } from '../types';

const manualZoomRegion: ZoomRegion = {
  id: 'zoom-1',
  startMs: 0,
  endMs: 1000,
  scale: 2,
  targetX: 0.25,
  targetY: 0.75,
  mode: 'manual',
  isAuto: false,
  transition: {
    durationInMs: 1000,
    durationOutMs: 1000,
    easing: 'linear',
  },
  motionBlur: 0,
};

describe('useZoomPreview math', () => {
  it('preserves zoom focus until the zoom-out transition reaches identity', () => {
    const state = getZoomStateAt([manualZoomRegion], 1999);
    const style = zoomStateToTransform(state);

    expect(state.scale).toBeGreaterThan(1);
    expect(state.centerX).toBeCloseTo(0.25);
    expect(state.centerY).toBeCloseTo(0.75);
    expect(style.transform).not.toBe('translateZ(0) scale(1)');
    expect(style.transformOrigin).toBe('25% 75%');
  });
});
