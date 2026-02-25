import type { CropConfig } from '@/types';
import { hasEnabledCrop } from '@/utils/videoContentDimensions';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface CropRemapResult {
  point: NormalizedPoint;
  cropped: boolean;
  inVisibleBounds: boolean;
}

export const DEFAULT_NORMALIZED_VISIBILITY_MARGIN = 0.1;

export function isPointInNormalizedVisibilityBounds(
  point: NormalizedPoint,
  margin = DEFAULT_NORMALIZED_VISIBILITY_MARGIN
): boolean {
  return (
    point.x >= -margin &&
    point.x <= 1 + margin &&
    point.y >= -margin &&
    point.y <= 1 + margin
  );
}

/**
 * Remap normalized coordinates from source-video space into crop-relative space.
 * When crop is not enabled, coordinates are returned unchanged.
 */
export function remapNormalizedPointThroughCrop(
  point: NormalizedPoint,
  sourceWidth: number,
  sourceHeight: number,
  crop: CropConfig | undefined
): CropRemapResult {
  if (!hasEnabledCrop(crop)) {
    return {
      point,
      cropped: false,
      inVisibleBounds: true,
    };
  }

  const pxX = point.x * sourceWidth;
  const pxY = point.y * sourceHeight;
  const mapped = {
    x: (pxX - crop.x) / crop.width,
    y: (pxY - crop.y) / crop.height,
  };

  return {
    point: mapped,
    cropped: true,
    inVisibleBounds: isPointInNormalizedVisibilityBounds(mapped),
  };
}
