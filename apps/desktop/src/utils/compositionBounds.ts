import type { CompositionConfig } from '@/types';

export const MIN_COMPOSITION_FRAME_DIMENSION = 1;
export const REFERENCE_COMPOSITION_HEIGHT = 1080;

export function toEven(value: number): number {
  return Math.floor(value / 2) * 2;
}

export function getEffectiveManualPadding(
  requestedPadding: number,
  outputWidth: number,
  outputHeight: number
): number {
  if (requestedPadding <= 0 || outputWidth <= 0 || outputHeight <= 0) {
    return 0;
  }

  const scaledPadding = requestedPadding * (outputHeight / REFERENCE_COMPOSITION_HEIGHT);
  const maxPadding = Math.max(
    0,
    (Math.min(outputWidth, outputHeight) - MIN_COMPOSITION_FRAME_DIMENSION) / 2
  );
  return Math.min(scaledPadding, maxPadding);
}

export function calculateCompositionOutputSize(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  compositionConfig: CompositionConfig | undefined
): { width: number; height: number } {
  if (!compositionConfig || compositionConfig.mode === 'auto') {
    return {
      width: toEven(videoWidth + padding * 2),
      height: toEven(videoHeight + padding * 2),
    };
  }

  if (compositionConfig.width && compositionConfig.height) {
    return {
      width: toEven(compositionConfig.width),
      height: toEven(compositionConfig.height),
    };
  }

  if (compositionConfig.aspectRatio) {
    const videoRatio = videoWidth / videoHeight;
    const targetRatio = compositionConfig.aspectRatio;

    if (targetRatio > videoRatio) {
      const h = videoHeight + padding * 2;
      return { width: toEven(h * targetRatio), height: toEven(h) };
    }

    const w = videoWidth + padding * 2;
    return { width: toEven(w), height: toEven(w / targetRatio) };
  }

  return {
    width: toEven(videoWidth + padding * 2),
    height: toEven(videoHeight + padding * 2),
  };
}

export function calculateFrameBoundsInComposition(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  compositionSize: { width: number; height: number },
  compositionConfig: CompositionConfig | undefined
): { x: number; y: number; width: number; height: number } {
  const manualMode = compositionConfig?.mode === 'manual';

  if (!manualMode) {
    return {
      x: padding,
      y: padding,
      width: videoWidth,
      height: videoHeight,
    };
  }

  const effectivePadding = getEffectiveManualPadding(
    padding,
    compositionSize.width,
    compositionSize.height
  );
  const availableW = Math.max(
    MIN_COMPOSITION_FRAME_DIMENSION,
    compositionSize.width - effectivePadding * 2
  );
  const availableH = Math.max(
    MIN_COMPOSITION_FRAME_DIMENSION,
    compositionSize.height - effectivePadding * 2
  );
  const videoAspect = videoWidth / videoHeight;
  const availableAspect = availableW / availableH;

  let frameWidth: number;
  let frameHeight: number;
  if (videoAspect > availableAspect) {
    frameWidth = availableW;
    frameHeight = availableW / videoAspect;
  } else {
    frameHeight = availableH;
    frameWidth = availableH * videoAspect;
  }

  return {
    x: (compositionSize.width - frameWidth) / 2,
    y: (compositionSize.height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}
