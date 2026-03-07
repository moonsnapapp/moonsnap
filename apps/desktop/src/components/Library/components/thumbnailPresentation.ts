import { LAYOUT } from '@/constants';
import type { CaptureListItem } from '../../../types';

export type ThumbnailFitMode = 'cover' | 'preserve';

const NON_IMAGE_CAPTURE_TYPES = new Set(['video', 'gif']);

/**
 * Avoid upscaling still-image thumbnails that are smaller than the card frame.
 * This keeps short or low-resolution screenshots sharp instead of stretching them.
 */
export function getCaptureCardThumbnailFit(capture: CaptureListItem): ThumbnailFitMode {
  if (NON_IMAGE_CAPTURE_TYPES.has(capture.capture_type)) {
    return 'cover';
  }

  const { width, height } = capture.dimensions;

  if (width <= 0 || height <= 0) {
    return 'cover';
  }

  const thumbnailFrameHeight = Math.round(LAYOUT.MIN_CARD_WIDTH / LAYOUT.CARD_THUMBNAIL_ASPECT_RATIO);

  return width <= LAYOUT.MIN_CARD_WIDTH || height <= thumbnailFrameHeight ? 'preserve' : 'cover';
}
