import { describe, expect, it } from 'vitest';
import { clamp, clampWithFallback } from '@/utils/math';

describe('math utils', () => {
  it('clamps values within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });

  it('uses fallback when range is invalid', () => {
    expect(clampWithFallback(5, 10, 0, 'min')).toBe(10);
    expect(clampWithFallback(5, 10, 0, 'midpoint')).toBe(5);
  });
});
