import { Loader2 } from 'lucide-react';

import { HudTitlebar } from '@/components/Titlebar/Titlebar';
import type { GifData, UiState } from './types';

type GifLoaderData = GifData;

export function getCropEditingStartState(previous: UiState, gifData: GifLoaderData) {
  if (previous.crop) return previous;

  const width = Math.max(16, Math.round(gifData.width * 0.8));
  const height = Math.max(16, Math.round(gifData.height * 0.8));
  return {
    ...previous,
    crop: {
      x: Math.round((gifData.width - width) / 2),
      y: Math.round((gifData.height - height) / 2),
      w: width,
      h: height,
    },
  };
}
export function getAppliedCropState(previous: UiState) {
  return previous.crop
    ? { ...previous, outputWidth: previous.crop.w, outputHeight: previous.crop.h }
    : previous;
}

function getCancelledCropDimension(
  cropDimension: number | undefined,
  gifDimension: number | undefined,
  previousDimension: number
): number {
  if (cropDimension !== undefined) {
    return cropDimension;
  }

  return gifDimension !== undefined ? gifDimension : previousDimension;
}

function getGifDataOutputSize(gifData: GifLoaderData | null, previous: UiState) {
  if (!gifData) {
    return {
      outputWidth: previous.outputWidth,
      outputHeight: previous.outputHeight,
    };
  }

  return {
    outputWidth: gifData.width,
    outputHeight: gifData.height,
  };
}

function getCancelledCropOutputSize(
  priorCrop: UiState['crop'],
  gifData: GifLoaderData | null,
  previous: UiState
) {
  const gifOutputSize = getGifDataOutputSize(gifData, previous);
  return {
    outputWidth: getCancelledCropDimension(priorCrop?.w, gifOutputSize.outputWidth, previous.outputWidth),
    outputHeight: getCancelledCropDimension(priorCrop?.h, gifOutputSize.outputHeight, previous.outputHeight),
  };
}

export function getCancelledCropState(
  previous: UiState,
  priorCrop: UiState['crop'],
  gifData: GifLoaderData | null
) {
  const next = { ...previous, crop: priorCrop };
  if (!gifData) return next;

  const outputSize = getCancelledCropOutputSize(priorCrop, gifData, previous);
  next.outputWidth = outputSize.outputWidth;
  next.outputHeight = outputSize.outputHeight;
  return next;
}

export function getRemovedCropState(previous: UiState, gifData: GifLoaderData | null) {
  return {
    ...previous,
    crop: null,
    ...getGifDataOutputSize(gifData, previous),
  };
}

export function getGifEditorOuterClasses(embedded: boolean) {
  return embedded
    ? 'editor-window flex-1 flex flex-col min-h-0'
    : 'editor-window h-screen w-screen flex flex-col overflow-hidden';
}

export function renderGifEditorTitlebar(embedded: boolean, detailLabel: string) {
  return embedded ? null : (
    <HudTitlebar
      title="MoonSnap"
      contextLabel="GIF Editor"
      detailLabel={detailLabel}
      showMaximize
    />
  );
}

export function renderGifEditorStatusView({
  isLoading,
  error,
  capturePath,
  outerClasses,
  embedded,
}: {
  isLoading: boolean;
  error: string | null;
  capturePath: string | null;
  outerClasses: string;
  embedded: boolean;
}) {
  if (isLoading) {
    return (
      <div className={outerClasses}>
        {renderGifEditorTitlebar(embedded, 'Loading')}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
            <p className="text-sm text-(--ink-muted)">Loading GIF...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className={outerClasses}>
      {renderGifEditorTitlebar(embedded, 'Error')}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-(--error-light) flex items-center justify-center">
            <span className="text-2xl">!</span>
          </div>
          <p className="text-sm text-(--error)">{error}</p>
          {capturePath && (
            <p className="text-xs text-(--ink-muted) break-all">{capturePath}</p>
          )}
        </div>
      </div>
    </div>
  );
}
