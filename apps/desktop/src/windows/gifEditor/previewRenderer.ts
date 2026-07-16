import type { GifCrop } from '@/types/generated/GifCrop';
import { renderFrameTo } from './renderFrame';
import type { ExportPreviewState, FrameRow, GifData, UiState } from './types';

type GifLoaderData = GifData;

export function getGifCropPayload(crop: UiState['crop']): GifCrop | null {
  return crop
    ? {
        x: Math.max(0, Math.round(crop.x)),
        y: Math.max(0, Math.round(crop.y)),
        width: Math.max(1, Math.round(crop.w)),
        height: Math.max(1, Math.round(crop.h)),
      }
    : null;
}

function getGifOutputBaseline(ui: UiState, gifData: GifLoaderData | null) {
  if (ui.crop) {
    return {
      width: ui.crop.w,
      height: ui.crop.h,
    };
  }

  if (gifData) {
    return {
      width: gifData.width,
      height: gifData.height,
    };
  }

  return {
    width: 0,
    height: 0,
  };
}

function hasExplicitGifOutputSize(ui: UiState, gifData: GifLoaderData | null) {
  const baseline = getGifOutputBaseline(ui, gifData);
  return !!gifData && (ui.outputWidth !== baseline.width || ui.outputHeight !== baseline.height);
}

function normalizeExplicitGifSize(value: number) {
  return Math.max(1, Math.round(value));
}

export function getGifExplicitOutputSize(ui: UiState, gifData: GifLoaderData | null) {
  if (!hasExplicitGifOutputSize(ui, gifData)) {
    return { outputWidth: null, outputHeight: null };
  }

  return {
    outputWidth: normalizeExplicitGifSize(ui.outputWidth),
    outputHeight: normalizeExplicitGifSize(ui.outputHeight),
  };
}

interface GifPreviewTransform {
  crop: UiState['crop'];
  rotation: UiState['rotation'];
  flipH: UiState['flipH'];
  flipV: UiState['flipV'];
}

function getGifPreviewCropBounds(gifData: GifLoaderData, crop: UiState['crop']) {
  if (!crop) {
    return {
      cropX: 0,
      cropY: 0,
      cropW: gifData.width,
      cropH: gifData.height,
    };
  }

  return {
    cropX: crop.x,
    cropY: crop.y,
    cropW: crop.w,
    cropH: crop.h,
  };
}

function getRotatedGifPreviewSize(width: number, height: number, rotation: UiState['rotation']) {
  if (rotation === 90 || rotation === 270) {
    return { dstW: height, dstH: width };
  }

  return { dstW: width, dstH: height };
}

export function getGifPreviewDrawBounds(gifData: GifLoaderData, transform: GifPreviewTransform) {
  const cropBounds = getGifPreviewCropBounds(gifData, transform.crop);
  const previewSize = getRotatedGifPreviewSize(
    cropBounds.cropW,
    cropBounds.cropH,
    transform.rotation
  );

  return {
    ...cropBounds,
    ...previewSize,
  };
}

function resizeGifPreviewCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function getGifCanvasContext(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d');
}

function renderGifFrameToOffscreen(gifData: GifLoaderData, row: FrameRow) {
  const offscreen = document.createElement('canvas');
  offscreen.width = gifData.width;
  offscreen.height = gifData.height;
  const offscreenCtx = getGifCanvasContext(offscreen);
  if (!offscreenCtx) return null;

  renderFrameTo(offscreenCtx, gifData, row.sourceIndex);
  return offscreen;
}

function renderCropEditingPreviewFrame(
  canvas: HTMLCanvasElement,
  gifData: GifLoaderData,
  row: FrameRow
) {
  const ctx = getGifCanvasContext(canvas);
  if (!ctx) return;

  resizeGifPreviewCanvas(canvas, gifData.width, gifData.height);
  renderFrameTo(ctx, gifData, row.sourceIndex);
}

function drawTransformedGifPreviewFrame({
  ctx,
  offscreen,
  bounds,
  transform,
}: {
  ctx: CanvasRenderingContext2D;
  offscreen: HTMLCanvasElement;
  bounds: ReturnType<typeof getGifPreviewDrawBounds>;
  transform: GifPreviewTransform;
}) {
  const { cropX, cropY, cropW, cropH, dstW, dstH } = bounds;

  ctx.save();
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.translate(dstW / 2, dstH / 2);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
  ctx.drawImage(
    offscreen,
    cropX,
    cropY,
    cropW,
    cropH,
    -cropW / 2,
    -cropH / 2,
    cropW,
    cropH,
  );
  ctx.restore();
}

function renderEditedGifPreviewFrame(
  canvas: HTMLCanvasElement,
  gifData: GifLoaderData,
  row: FrameRow,
  transform: GifPreviewTransform
) {
  const ctx = getGifCanvasContext(canvas);
  if (!ctx) return;

  const bounds = getGifPreviewDrawBounds(gifData, transform);
  const { dstW, dstH } = bounds;
  resizeGifPreviewCanvas(canvas, dstW, dstH);
  const offscreen = renderGifFrameToOffscreen(gifData, row);
  if (!offscreen) return;

  drawTransformedGifPreviewFrame({ ctx, offscreen, bounds, transform });
}

export function renderEditedPreviewIfReady({
  canvas,
  gifData,
  row,
  transform,
}: {
  canvas: HTMLCanvasElement | null;
  gifData: GifLoaderData | null;
  row: FrameRow | undefined;
  transform: GifPreviewTransform;
}): void {
  if (!canvas || !gifData || !row) {
    return;
  }

  renderEditedGifPreviewFrame(canvas, gifData, row, transform);
}

export function renderCropEditingPreviewIfReady({
  canvas,
  gifData,
  row,
}: {
  canvas: HTMLCanvasElement | null;
  gifData: GifLoaderData | null;
  row: FrameRow | undefined;
}) {
  if (!canvas || !gifData || !row) {
    return;
  }

  renderCropEditingPreviewFrame(canvas, gifData, row);
}

export function renderExportPreviewFrameIfReady({
  canvas,
  exportPreview,
  previewFrameIdx,
  gifData,
  transform,
}: {
  canvas: HTMLCanvasElement | null;
  exportPreview: ExportPreviewState | null;
  previewFrameIdx: number;
  gifData: GifLoaderData | null;
  transform: GifPreviewTransform;
}) {
  if (!exportPreview || !gifData) {
    return;
  }

  renderEditedPreviewIfReady({
    canvas,
    gifData,
    row: exportPreview.rows[previewFrameIdx],
    transform,
  });
}
