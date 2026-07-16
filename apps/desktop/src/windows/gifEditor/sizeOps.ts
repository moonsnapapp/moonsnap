import type { GifData, UiState } from './types';

type GifLoaderData = GifData;

export interface GifBaselineSize {
  width: number;
  height: number;
}

function getActiveGifBounds(gifData: GifLoaderData, ui: UiState) {
  return ui.crop ?? { w: gifData.width, h: gifData.height };
}

export function getGifBaselineSize(gifData: GifLoaderData, ui: UiState): GifBaselineSize {
  const bounds = getActiveGifBounds(gifData, ui);
  return {
    width: bounds.w,
    height: bounds.h,
  };
}

export function parseGifOutputDimension(value: string): number {
  return Math.max(1, Math.round(Number(value) || 0));
}

export function getGifScalePercent(outputWidth: number, baselineWidth: number): number {
  return baselineWidth > 0 ? Math.round((outputWidth / baselineWidth) * 100) : 100;
}

export function resizeGifWidth(
  previous: UiState,
  width: number,
  baseline: GifBaselineSize
): UiState {
  if (!previous.keepAspect) return { ...previous, outputWidth: width };

  return {
    ...previous,
    outputWidth: width,
    outputHeight: Math.max(1, Math.round(width * (baseline.height / baseline.width))),
  };
}

export function resizeGifHeight(
  previous: UiState,
  height: number,
  baseline: GifBaselineSize
): UiState {
  if (!previous.keepAspect) return { ...previous, outputHeight: height };

  return {
    ...previous,
    outputHeight: height,
    outputWidth: Math.max(1, Math.round(height * (baseline.width / baseline.height))),
  };
}

export function scaleGifOutputSize(previous: UiState, value: number, baseline: GifBaselineSize): UiState {
  return {
    ...previous,
    outputWidth: Math.max(1, Math.round((baseline.width * value) / 100)),
    outputHeight: Math.max(1, Math.round((baseline.height * value) / 100)),
  };
}
