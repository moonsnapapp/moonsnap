import { describe, expect, it } from 'vitest';
import type { CompositionConfig } from '@/types';
import {
  calculateCompositionOutputSize,
  calculateFrameBoundsInComposition,
  getEffectiveManualPadding,
} from '@/utils/compositionBounds';

describe('compositionBounds', () => {
  it('calculates auto composition size from content + padding', () => {
    const composition = calculateCompositionOutputSize(1919, 1079, 40, {
      mode: 'auto',
      aspectRatio: null,
      aspectPreset: null,
      width: null,
      height: null,
    });

    expect(composition).toEqual({ width: 1998, height: 1158 });
  });

  it('uses explicit manual dimensions when provided', () => {
    const config: CompositionConfig = {
      mode: 'manual',
      width: 1921,
      height: 1081,
      aspectRatio: null,
      aspectPreset: null,
    };

    expect(calculateCompositionOutputSize(1280, 720, 40, config)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('computes aspect-ratio driven manual composition', () => {
    const config: CompositionConfig = {
      mode: 'manual',
      width: null,
      height: null,
      aspectRatio: 1,
      aspectPreset: null,
    };

    expect(calculateCompositionOutputSize(1920, 1080, 20, config)).toEqual({
      width: 1960,
      height: 1960,
    });
  });

  it('returns zero effective padding for invalid inputs', () => {
    expect(getEffectiveManualPadding(40, 0, 1080)).toBe(0);
    expect(getEffectiveManualPadding(-10, 1920, 1080)).toBe(0);
  });

  it('clamps effective manual padding to available composition size', () => {
    // requested padding scales to 100, but max allowed is 49.5 for 100x100.
    expect(getEffectiveManualPadding(100, 100, 1080)).toBe(49.5);
  });

  it('centers manual frame bounds inside composition', () => {
    const config: CompositionConfig = {
      mode: 'manual',
      width: 1920,
      height: 1080,
      aspectRatio: null,
      aspectPreset: null,
    };

    const bounds = calculateFrameBoundsInComposition(
      1280,
      720,
      80,
      { width: 1920, height: 1080 },
      config
    );

    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1080);
  });
});
