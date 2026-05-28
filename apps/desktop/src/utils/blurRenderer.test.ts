import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderBlurCanvas } from './blurRenderer';

// renderBlurCanvas draws to a 2D context, which jsdom does not implement.
// Stub getContext so the (valuable) coordinate clamping/normalization math runs
// and we can assert the returned bounds. The drawing calls become no-ops.
let getContextSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  const stubCtx = {
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    filter: '',
  } as unknown as CanvasRenderingContext2D;
  getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(stubCtx);
});

afterEach(() => {
  getContextSpy.mockRestore();
});

function fakeImage(width: number, height: number): HTMLImageElement {
  return Object.assign(new Image(), { width, height });
}

describe('renderBlurCanvas', () => {
  const image = () => fakeImage(100, 100);

  it('returns null for a sub-pixel region', () => {
    expect(renderBlurCanvas(image(), 10, 10, 0, 50, 'blur', 5)).toBeNull();
    expect(renderBlurCanvas(image(), 10, 10, 50, 0.5, 'blur', 5)).toBeNull();
  });

  it('returns the region unchanged when fully inside the image', () => {
    const result = renderBlurCanvas(image(), 20, 30, 40, 25, 'blur', 5);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ x: 20, y: 30, width: 40, height: 25 });
    expect(result?.canvas.width).toBe(40);
    expect(result?.canvas.height).toBe(25);
  });

  it('normalizes a negative-width/height region to its top-left origin', () => {
    // Drawn right-to-left / bottom-to-top from (80,80) back to (30,30)
    const result = renderBlurCanvas(image(), 80, 80, -50, -50, 'pixelate', 8);
    expect(result).toMatchObject({ x: 30, y: 30, width: 50, height: 50 });
  });

  it('clamps a region that overflows the right/bottom edges', () => {
    const result = renderBlurCanvas(image(), 50, 50, 100, 100, 'blur', 5);
    expect(result).toMatchObject({ x: 50, y: 50, width: 50, height: 50 });
  });

  it('clamps a region that starts above/left of the image origin', () => {
    const result = renderBlurCanvas(image(), -30, -30, 50, 50, 'blur', 5);
    expect(result).toMatchObject({ x: 0, y: 0, width: 20, height: 20 });
  });

  it('returns null when the region lies completely outside the image', () => {
    expect(renderBlurCanvas(image(), 200, 200, 50, 50, 'blur', 5)).toBeNull();
  });

  it('sizes the output canvas to the clamped region for pixelate', () => {
    const result = renderBlurCanvas(image(), 0, 0, 64, 64, 'pixelate', 8);
    expect(result?.canvas.width).toBe(64);
    expect(result?.canvas.height).toBe(64);
  });
});
