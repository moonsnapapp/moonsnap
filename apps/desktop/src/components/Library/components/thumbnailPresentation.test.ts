import { describe, expect, it } from 'vitest';

import type { CaptureListItem } from '../../../types';
import { getCaptureCardThumbnailFit } from './thumbnailPresentation';

function createCapture(overrides: Partial<CaptureListItem> = {}): CaptureListItem {
  return {
    id: 'capture-1',
    created_at: '2026-03-07T00:00:00.000Z',
    updated_at: '2026-03-07T00:00:00.000Z',
    capture_type: 'region',
    dimensions: { width: 1920, height: 1080 },
    thumbnail_path: 'thumb.png',
    image_path: 'image.png',
    has_annotations: false,
    tags: [],
    favorite: false,
    is_missing: false,
    ...overrides,
  };
}

describe('getCaptureCardThumbnailFit', () => {
  it('preserves small still-image thumbnails instead of upscaling them', () => {
    const capture = createCapture({
      dimensions: { width: 803, height: 101 },
    });

    expect(getCaptureCardThumbnailFit(capture)).toBe('preserve');
  });

  it('keeps normal screenshots full-bleed', () => {
    const capture = createCapture({
      dimensions: { width: 1093, height: 762 },
    });

    expect(getCaptureCardThumbnailFit(capture)).toBe('cover');
  });

  it('keeps videos on cover mode', () => {
    const capture = createCapture({
      capture_type: 'video',
      dimensions: { width: 320, height: 120 },
    });

    expect(getCaptureCardThumbnailFit(capture)).toBe('cover');
  });
});
