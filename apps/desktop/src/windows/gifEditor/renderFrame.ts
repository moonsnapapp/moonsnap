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

  for (let i = 0; i <= targetIndex && i < data.frames.length; i += 1) {
    const frame = data.frames[i];
    const { width, height, top, left } = frame.dims;

    const imageData = new ImageData(
      new Uint8ClampedArray(frame.patch),
      width,
      height,
    );
    // Draw via an offscreen canvas to keep transparency intact when composited.
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    off.getContext('2d')?.putImageData(imageData, 0, 0);
    ctx.drawImage(off, left, top);

    // Disposal 2 = restore to background after rendering. We clear the frame's
    // bbox before drawing the *next* frame.
    if (frame.disposalType === 2 && i < targetIndex) {
      ctx.clearRect(left, top, width, height);
    }
  }
}
