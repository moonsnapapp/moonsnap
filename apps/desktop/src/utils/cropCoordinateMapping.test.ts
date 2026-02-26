import { describe, expect, it } from 'vitest';
import {
  isPointInNormalizedVisibilityBounds,
  remapNormalizedPointThroughCrop,
} from '@/utils/cropCoordinateMapping';

describe('cropCoordinateMapping', () => {
  it('keeps point unchanged when crop is disabled', () => {
    const result = remapNormalizedPointThroughCrop(
      { x: 0.25, y: 0.75 },
      1920,
      1080,
      {
        enabled: false,
        x: 100,
        y: 50,
        width: 1000,
        height: 500,
        lockAspectRatio: false,
        aspectRatio: null,
      }
    );

    expect(result).toEqual({
      point: { x: 0.25, y: 0.75 },
      cropped: false,
      inVisibleBounds: true,
    });
  });

  it('remaps point into crop-relative coordinates', () => {
    // Source pixel = (960, 540), crop starts at (480, 270) and is 960x540.
    const result = remapNormalizedPointThroughCrop(
      { x: 0.5, y: 0.5 },
      1920,
      1080,
      {
        enabled: true,
        x: 480,
        y: 270,
        width: 960,
        height: 540,
        lockAspectRatio: false,
        aspectRatio: null,
      }
    );

    expect(result.point.x).toBeCloseTo(0.5, 6);
    expect(result.point.y).toBeCloseTo(0.5, 6);
    expect(result.cropped).toBe(true);
    expect(result.inVisibleBounds).toBe(true);
  });

  it('marks remapped point outside extended bounds as not visible', () => {
    const result = remapNormalizedPointThroughCrop(
      { x: 0.0, y: 0.0 },
      1920,
      1080,
      {
        enabled: true,
        x: 600,
        y: 300,
        width: 200,
        height: 100,
        lockAspectRatio: false,
        aspectRatio: null,
      }
    );

    expect(result.inVisibleBounds).toBe(false);
  });

  it('checks normalized visibility bounds with margin', () => {
    expect(isPointInNormalizedVisibilityBounds({ x: -0.1, y: 1.1 })).toBe(true);
    expect(isPointInNormalizedVisibilityBounds({ x: -0.11, y: 0.5 })).toBe(false);
    expect(isPointInNormalizedVisibilityBounds({ x: 0.5, y: 1.11 })).toBe(false);
  });
});
