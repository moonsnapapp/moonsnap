import { describe, expect, it } from 'vitest';
import {
  getEditorShadowCss,
  getEditorShadowLayers,
  getVideoFrameShadowMetrics,
} from './frameEffects';

describe('frameEffects', () => {
  describe('getVideoFrameShadowMetrics', () => {
    it('returns zero metrics for invalid frame size', () => {
      expect(getVideoFrameShadowMetrics(50, 0, 1080)).toEqual({ blurPx: 0, opacity: 0 });
      expect(getVideoFrameShadowMetrics(50, 1920, 0)).toEqual({ blurPx: 0, opacity: 0 });
    });

    it('matches compositor formula for blur and opacity', () => {
      const metrics = getVideoFrameShadowMetrics(50, 1920, 1080);
      // strength = 0.5, minHalf = 540, blur = 0.5 * 540 * 0.15 = 40.5
      expect(metrics.blurPx).toBeCloseTo(40.5, 5);
      // opacity = 0.5 * 0.5 = 0.25
      expect(metrics.opacity).toBeCloseTo(0.25, 5);
    });

    it('clamps shadow percent to [0, 100]', () => {
      const low = getVideoFrameShadowMetrics(-10, 1000, 1000);
      const high = getVideoFrameShadowMetrics(120, 1000, 1000);

      expect(low).toEqual({ blurPx: 0, opacity: 0 });
      expect(high.opacity).toBeCloseTo(0.5, 5);
    });
  });

  describe('getEditorShadowLayers', () => {
    it('returns empty for zero intensity', () => {
      expect(getEditorShadowLayers(0)).toEqual([]);
    });

    it('scales layer blur/offset/opacity by intensity', () => {
      const layers = getEditorShadowLayers(0.5);
      expect(layers).toHaveLength(3);
      expect(layers[0]).toEqual({ blurPx: 5, offsetY: 1, opacity: 0.075 });
      expect(layers[1]).toEqual({ blurPx: 15, offsetY: 4, opacity: 0.125 });
      expect(layers[2]).toEqual({ blurPx: 30, offsetY: 8, opacity: 0.175 });
    });

    it('clamps intensity to [0, 1]', () => {
      const clamped = getEditorShadowLayers(2);
      expect(clamped[0]).toEqual({ blurPx: 10, offsetY: 2, opacity: 0.15 });
    });
  });

  describe('getEditorShadowCss', () => {
    it('serializes layers into box-shadow CSS', () => {
      const css = getEditorShadowCss([
        { blurPx: 10, offsetY: 2, opacity: 0.15 },
        { blurPx: 20, offsetY: 4, opacity: 0.25 },
      ]);

      expect(css).toContain('0 2px 10px rgba(0, 0, 0, 0.15)');
      expect(css).toContain('0 4px 20px rgba(0, 0, 0, 0.25)');
    });
  });
});
