import { convertFileSrc } from '@tauri-apps/api/core';

import type { PreviewBackgroundConfig } from './sceneTypes';

export function getCompositionBackground(
  hasFrameStyling: boolean,
  backgroundConfig: PreviewBackgroundConfig | undefined,
) {
  if (!hasFrameStyling || !backgroundConfig) return undefined;
  if (backgroundConfig.bgType === 'solid') return backgroundConfig.solidColor;
  if (backgroundConfig.bgType === 'gradient') {
    return `linear-gradient(${backgroundConfig.gradientAngle}deg, ${backgroundConfig.gradientStart}, ${backgroundConfig.gradientEnd})`;
  }
  return undefined;
}

export function getPreviewBackgroundImageSrc(
  backgroundConfig: PreviewBackgroundConfig | undefined,
): string | null {
  if (backgroundConfig?.bgType !== 'image' || !backgroundConfig.imagePath) return null;
  return backgroundConfig.imagePath.startsWith('data:')
    ? backgroundConfig.imagePath
    : convertFileSrc(backgroundConfig.imagePath);
}

export function getPreviewBackgroundLayerSrc(
  backgroundConfig: PreviewBackgroundConfig | undefined,
  wallpaperUrl: string | null,
  imageSrc: string | null,
): string | null {
  return backgroundConfig?.bgType === 'wallpaper' ? wallpaperUrl : imageSrc;
}
