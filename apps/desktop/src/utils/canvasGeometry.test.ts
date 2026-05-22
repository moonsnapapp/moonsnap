import { describe, expect, it } from 'vitest';
import type { CanvasShape } from '../types';
import {
  BACKGROUND_SHAPE_ID,
  ensureBackgroundShape,
  shouldNormalizeBackgroundShape,
} from './canvasGeometry';

describe('ensureBackgroundShape', () => {
  it('inserts a background shape when one is missing', () => {
    const shape: CanvasShape = { id: 'rect-1', type: 'rect', x: 10, y: 10, width: 20, height: 20 };

    const result = ensureBackgroundShape([shape], 1920, 1080);

    expect(result[0]).toEqual({
      id: BACKGROUND_SHAPE_ID,
      type: 'image',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      isBackground: true,
    });
    expect(result[1]).toBe(shape);
  });

  it('normalizes a persisted background shape to the source image dimensions', () => {
    const staleBackground: CanvasShape = {
      id: BACKGROUND_SHAPE_ID,
      type: 'image',
      x: 12,
      y: 8,
      width: 800,
      height: 600,
      isBackground: true,
    };
    const annotation: CanvasShape = { id: 'arrow-1', type: 'arrow', points: [0, 0, 100, 100] };

    const result = ensureBackgroundShape([annotation, staleBackground], 1616, 1269);

    expect(result[0]).toEqual({
      ...staleBackground,
      x: 0,
      y: 0,
      width: 1616,
      height: 1269,
      isBackground: true,
    });
    expect(result[1]).toBe(annotation);
  });
});

describe('shouldNormalizeBackgroundShape', () => {
  it('detects a missing background shape', () => {
    const shape: CanvasShape = { id: 'rect-1', type: 'rect', x: 10, y: 10, width: 20, height: 20 };

    expect(shouldNormalizeBackgroundShape([shape], 1920, 1080)).toBe(true);
  });

  it('detects a stale persisted background shape', () => {
    const staleBackground: CanvasShape = {
      id: BACKGROUND_SHAPE_ID,
      type: 'image',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      isBackground: true,
    };

    expect(shouldNormalizeBackgroundShape([staleBackground], 1616, 1269)).toBe(true);
  });

  it('accepts a matching background shape at the front of the shape list', () => {
    const background: CanvasShape = {
      id: BACKGROUND_SHAPE_ID,
      type: 'image',
      x: 0,
      y: 0,
      width: 1616,
      height: 1269,
      isBackground: true,
    };
    const annotation: CanvasShape = { id: 'arrow-1', type: 'arrow', points: [0, 0, 100, 100] };

    expect(shouldNormalizeBackgroundShape([background, annotation], 1616, 1269)).toBe(false);
  });

  it('detects a matching background shape in the wrong draw order', () => {
    const annotation: CanvasShape = { id: 'arrow-1', type: 'arrow', points: [0, 0, 100, 100] };
    const background: CanvasShape = {
      id: BACKGROUND_SHAPE_ID,
      type: 'image',
      x: 0,
      y: 0,
      width: 1616,
      height: 1269,
      isBackground: true,
    };

    expect(shouldNormalizeBackgroundShape([annotation, background], 1616, 1269)).toBe(true);
  });
});
