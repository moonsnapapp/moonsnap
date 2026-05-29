import { describe, it, expect } from 'vitest';
import {
  generateSquircleClipPath,
  generateSquircleClipPathFromRadius,
  generateSquircleBorderClipPath,
} from './squircle';

// Pull the percentage numbers out of a polygon(...) clip-path.
function polygonCoords(clip: string): number[] {
  return (clip.match(/[\d.]+(?=%)/g) ?? []).map(Number);
}

function polygonPointCount(clip: string): number {
  return polygonCoords(clip).length / 2;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// generateSquircleClipPath
// ---------------------------------------------------------------------------

describe('generateSquircleClipPath', () => {
  it('produces a plain rectangle at 0% rounding', () => {
    expect(generateSquircleClipPath(0)).toBe(
      'polygon(0.00% 0.00%, 100.00% 0.00%, 100.00% 100.00%, 0.00% 100.00%)'
    );
  });

  it('emits 4*numPoints + 1 points for a rounded squircle', () => {
    expect(polygonPointCount(generateSquircleClipPath(100, 100, 100, 2))).toBe(9);
    expect(polygonPointCount(generateSquircleClipPath(100, 100, 100, 16))).toBe(65);
  });

  it('keeps every coordinate within the element bounds', () => {
    const coords = polygonCoords(generateSquircleClipPath(80, 100, 100, 16));
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(100);
    }
  });

  it('formats every coordinate with two decimals', () => {
    const clip = generateSquircleClipPath(50, 100, 100, 4);
    expect(clip.startsWith('polygon(')).toBe(true);
    for (const token of clip.replace(/^polygon\(|\)$/g, '').split(', ')) {
      expect(token).toMatch(/^\d+\.\d{2}% \d+\.\d{2}%$/);
    }
  });
});

// ---------------------------------------------------------------------------
// generateSquircleClipPathFromRadius
// ---------------------------------------------------------------------------

describe('generateSquircleClipPathFromRadius', () => {
  it('returns a degenerate rectangle for a non-positive dimension', () => {
    expect(generateSquircleClipPathFromRadius(20, 0, 100)).toBe(
      'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'
    );
  });

  it('produces a rectangle when the radius is zero', () => {
    expect(generateSquircleClipPathFromRadius(0, 100, 100)).toBe(
      'polygon(0.00% 0.00%, 100.00% 0.00%, 100.00% 100.00%, 0.00% 100.00%)'
    );
  });

  it('clamps the radius factor to half the smaller dimension', () => {
    // Anything >= 50px on a 100px element clamps to the same 0.5 factor
    const huge = generateSquircleClipPathFromRadius(1000, 100, 100);
    const atCap = generateSquircleClipPathFromRadius(50, 100, 100);
    expect(huge).toBe(atCap);
  });
});

// ---------------------------------------------------------------------------
// generateSquircleBorderClipPath
// ---------------------------------------------------------------------------

describe('generateSquircleBorderClipPath', () => {
  it('emits an even-odd two-subpath ring for a normal border', () => {
    const path = generateSquircleBorderClipPath(40, 10, 200, 200, 16);
    expect(path.startsWith('path(evenodd, "')).toBe(true);
    expect(countOccurrences(path, 'M')).toBe(2); // outer + inner sub-paths
    expect(countOccurrences(path, 'Z')).toBe(2);
  });

  it('uses pixel coordinates scaled to the element size', () => {
    // The rightmost outer point sits at x = 100% -> 200px for a 200px-wide box
    const path = generateSquircleBorderClipPath(40, 10, 200, 200, 16);
    expect(path).toContain('200.00');
  });

  it('falls back to a single filled squircle when the border is too thick', () => {
    const path = generateSquircleBorderClipPath(40, 50, 100, 100, 16);
    expect(path.startsWith('path("M')).toBe(true);
    expect(path).not.toContain('evenodd');
    expect(countOccurrences(path, 'M')).toBe(1);
  });
});
