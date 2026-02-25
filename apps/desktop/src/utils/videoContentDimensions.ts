import type { CropConfig } from '@/types';

type CropDimensions = Pick<CropConfig, 'enabled' | 'width' | 'height'>;

export interface ContentDimensions {
  width: number;
  height: number;
  cropEnabled: boolean;
}

export function hasEnabledCrop(
  crop: CropDimensions | null | undefined
): crop is CropDimensions {
  return Boolean(crop?.enabled && crop.width > 0 && crop.height > 0);
}

export function getContentDimensionsFromCrop(
  crop: CropDimensions | null | undefined,
  originalWidth: number,
  originalHeight: number
): ContentDimensions {
  if (hasEnabledCrop(crop)) {
    return {
      width: crop.width,
      height: crop.height,
      cropEnabled: true,
    };
  }

  return {
    width: originalWidth,
    height: originalHeight,
    cropEnabled: false,
  };
}
