import type { Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { editorLogger } from '@/utils/logger';
import { buildGifFrameEncodeOptions } from './frameEditOps';
import type { ExportPreviewState, FrameRow, GifData, UiState } from './types';

type GifLoaderData = GifData;

export function getGifPreviewPlaybackDelay(row: FrameRow, speed: number) {
  return Math.max(10, row.delayMs / Math.max(0.05, speed));
}
export function getNextPreviewFrameIndex(index: number, rowCount: number) {
  return index + 1 >= rowCount ? 0 : index + 1;
}

function setGifEstimateIfActive(
  cancelled: boolean,
  setEstimatedBytes: Dispatch<SetStateAction<number | null>>,
  value: number | null
) {
  if (!cancelled) {
    setEstimatedBytes(value);
  }
}

export async function estimateGifPreviewSize({
  exportPreview,
  capturePath,
  ui,
  gifData,
  isCancelled,
  setEstimatedBytes,
  setEstimating,
}: {
  exportPreview: ExportPreviewState;
  capturePath: string;
  ui: UiState;
  gifData: GifLoaderData;
  isCancelled: () => boolean;
  setEstimatedBytes: Dispatch<SetStateAction<number | null>>;
  setEstimating: Dispatch<SetStateAction<boolean>>;
}) {
  setEstimating(true);
  setEstimatedBytes(null);
  const options = buildGifFrameEncodeOptions(exportPreview.rows, ui, gifData);

  try {
    const size = await invoke<number>('estimate_gif_size_from_frames', {
      inputPath: capturePath,
      options,
    });
    setGifEstimateIfActive(isCancelled(), setEstimatedBytes, size);
  } catch (err) {
    setGifEstimateIfActive(isCancelled(), setEstimatedBytes, null);
    editorLogger.warn('GIF size estimate failed:', err);
  } finally {
    if (!isCancelled()) {
      setEstimating(false);
    }
  }
}
