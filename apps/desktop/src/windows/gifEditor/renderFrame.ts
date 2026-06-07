import type { GifData } from './types';

/**
 * Composite the GIF up to `targetIndex` onto a fresh canvas, honoring the
 * minimal disposal rules we care about (keep / restore-to-background).
 */
export function renderFrameTo(
  ctx: CanvasRenderingContext2D,
  data: GifData,
  targetIndex: number,
): void {
  ctx.clearRect(0, 0, data.width, data.height);

  for (let i = 0; i <= getLastRenderableFrameIndex(data, targetIndex); i += 1) {
    const frame = data.frames[i];
    drawGifFrame(ctx, frame);

    // Disposal 2 = restore to background after rendering. We clear the frame's
    // bbox before drawing the *next* frame.
    clearDisposedFrame(ctx, frame, i, targetIndex);
  }
}

function getLastRenderableFrameIndex(data: GifData, targetIndex: number) {
  return Math.min(targetIndex, data.frames.length - 1);
}

function drawGifFrame(
  ctx: CanvasRenderingContext2D,
  frame: GifData['frames'][number],
) {
  const { top, left } = frame.dims;
  const offscreenCanvas = createFrameCanvas(frame);
  ctx.drawImage(offscreenCanvas, left, top);
}

function createFrameCanvas(frame: GifData['frames'][number]) {
  const { width, height } = frame.dims;
  const imageData = new ImageData(
    new Uint8ClampedArray(frame.patch),
    width,
    height,
  );
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = width;
  offscreenCanvas.height = height;
  offscreenCanvas.getContext('2d')?.putImageData(imageData, 0, 0);
  return offscreenCanvas;
}

function clearDisposedFrame(
  ctx: CanvasRenderingContext2D,
  frame: GifData['frames'][number],
  frameIndex: number,
  targetIndex: number,
) {
  if (frame.disposalType !== 2 || frameIndex >= targetIndex) return;

  const { width, height, top, left } = frame.dims;
  ctx.clearRect(left, top, width, height);
}
