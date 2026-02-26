import { describe, expect, it } from 'vitest';
import { getContentDimensionsFromCrop, hasEnabledCrop } from '@/utils/videoContentDimensions';

describe('videoContentDimensions', () => {
  it('detects enabled crop only when dimensions are positive', () => {
    expect(hasEnabledCrop(undefined)).toBe(false);
    expect(hasEnabledCrop(null)).toBe(false);
    expect(hasEnabledCrop({ enabled: false, width: 1920, height: 1080 })).toBe(false);
    expect(hasEnabledCrop({ enabled: true, width: 0, height: 1080 })).toBe(false);
    expect(hasEnabledCrop({ enabled: true, width: 1920, height: 0 })).toBe(false);
    expect(hasEnabledCrop({ enabled: true, width: 1280, height: 720 })).toBe(true);
  });

  it('returns crop size when crop is enabled', () => {
    expect(
      getContentDimensionsFromCrop({ enabled: true, width: 800, height: 600 }, 1920, 1080)
    ).toEqual({
      width: 800,
      height: 600,
      cropEnabled: true,
    });
  });

  it('falls back to original source size when crop is disabled', () => {
    expect(
      getContentDimensionsFromCrop({ enabled: false, width: 800, height: 600 }, 1920, 1080)
    ).toEqual({
      width: 1920,
      height: 1080,
      cropEnabled: false,
    });
  });
});
