import { describe, expect, it } from 'vitest';
import type { CanvasShape } from '../types';
import {
  BACKGROUND_SHAPE_ID,
  ensureBackgroundShape,
  shouldNormalizeBackgroundShape,
  screenToCanvas,
  getShapeBounds,
  getSelectionBounds,
  getVisibleBounds,
  getCompositionSize,
  rectsIntersect,
  lineIntersectsRect,
  shapeIntersectsRect,
} from './canvasGeometry';

function makeShape(overrides: Partial<CanvasShape> & { type: string }): CanvasShape {
  return { id: 'test', ...overrides };
}

function fakeImage(width: number, height: number): HTMLImageElement {
  return Object.assign(new Image(), { width, height });
}

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

describe('screenToCanvas', () => {
  it('is the identity at zoom 1 with no pan', () => {
    expect(screenToCanvas({ x: 42, y: 17 }, { x: 0, y: 0 }, 1)).toEqual({ x: 42, y: 17 });
  });

  it('subtracts the pan offset then divides by zoom', () => {
    expect(screenToCanvas({ x: 100, y: 100 }, { x: 20, y: 10 }, 2)).toEqual({ x: 40, y: 45 });
  });

  it('round-trips with the inverse canvas->screen transform', () => {
    const position = { x: 30, y: -15 };
    const zoom = 1.5;
    const canvasPt = { x: 12, y: 80 };
    const screenPt = { x: canvasPt.x * zoom + position.x, y: canvasPt.y * zoom + position.y };
    expect(screenToCanvas(screenPt, position, zoom)).toEqual(canvasPt);
  });
});

describe('getShapeBounds', () => {
  it('returns the rect itself when unrotated and stroke-free', () => {
    expect(getShapeBounds(makeShape({ type: 'rect', x: 10, y: 20, width: 100, height: 50 }))).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('inflates the bounds by half the stroke width on each side', () => {
    expect(
      getShapeBounds(makeShape({ type: 'rect', x: 10, y: 20, width: 100, height: 50, strokeWidth: 4 }))
    ).toEqual({ x: 8, y: 18, width: 104, height: 54 });
  });

  it('computes a circle bounding box from its radius', () => {
    expect(getShapeBounds(makeShape({ type: 'circle', x: 100, y: 100, radius: 50 }))).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    });
  });

  it('uses radiusX/radiusY for an axis-aligned ellipse', () => {
    expect(getShapeBounds(makeShape({ type: 'circle', x: 100, y: 100, radiusX: 80, radiusY: 40 }))).toEqual({
      x: 20,
      y: 60,
      width: 160,
      height: 80,
    });
  });

  it('swaps the extents for an ellipse rotated 90 degrees', () => {
    const bounds = getShapeBounds(
      makeShape({ type: 'circle', x: 100, y: 100, radiusX: 80, radiusY: 40, rotation: 90 })
    );
    expect(bounds.width).toBeCloseTo(80, 6);
    expect(bounds.height).toBeCloseTo(160, 6);
    expect(bounds.x).toBeCloseTo(60, 6);
    expect(bounds.y).toBeCloseTo(20, 6);
  });

  it('derives arrow/line bounds from endpoints regardless of direction', () => {
    const forward = getShapeBounds(makeShape({ type: 'arrow', points: [10, 10, 50, 30] }));
    const reversed = getShapeBounds(makeShape({ type: 'line', points: [50, 30, 10, 10] }));
    expect(forward).toEqual({ x: 10, y: 10, width: 40, height: 20 });
    expect(reversed).toEqual({ x: 10, y: 10, width: 40, height: 20 });
  });

  it('computes pen-stroke bounds from the min/max of all points', () => {
    expect(getShapeBounds(makeShape({ type: 'pen', points: [0, 0, 10, 5, 4, 20, -3, 2] }))).toEqual({
      x: -3,
      y: 0,
      width: 13,
      height: 20,
    });
  });

  it('grows the AABB to enclose a 45-degree rotated square', () => {
    const bounds = getShapeBounds(
      makeShape({ type: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 45 })
    );
    const diagonal = 100 * Math.SQRT2;
    expect(bounds.width).toBeCloseTo(diagonal, 4);
    expect(bounds.height).toBeCloseTo(diagonal, 4);
  });
});

describe('getSelectionBounds', () => {
  const shapes = [
    makeShape({ type: 'rect', id: 'a', x: 0, y: 0, width: 50, height: 50 }),
    makeShape({ type: 'rect', id: 'b', x: 100, y: 100, width: 50, height: 50 }),
  ];

  it('returns null when fewer than two shapes are selected', () => {
    expect(getSelectionBounds(shapes, ['a'])).toBeNull();
    expect(getSelectionBounds(shapes, [])).toBeNull();
  });

  it('returns the padded union of the selected shapes', () => {
    expect(getSelectionBounds(shapes, ['a', 'b'])).toEqual({
      x: -4,
      y: -4,
      width: 158,
      height: 158,
    });
  });

  it('honours a custom padding value', () => {
    expect(getSelectionBounds(shapes, ['a', 'b'], 0)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 150,
    });
  });

  it('returns null when none of the selected ids resolve to a shape', () => {
    expect(getSelectionBounds(shapes, ['x', 'y'])).toBeNull();
  });
});

describe('getVisibleBounds', () => {
  it('returns null without an image or canvas bounds', () => {
    expect(
      getVisibleBounds(undefined, { width: 10, height: 10, imageOffsetX: 0, imageOffsetY: 0 }, false)
    ).toBeNull();
    expect(getVisibleBounds(fakeImage(100, 100), null, false)).toBeNull();
  });

  it('shows the full image while crop mode is active', () => {
    const bounds = getVisibleBounds(
      fakeImage(1920, 1080),
      { width: 800, height: 600, imageOffsetX: 50, imageOffsetY: 50 },
      true
    );
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('returns the cropped region offset into the source image', () => {
    const bounds = getVisibleBounds(
      fakeImage(1920, 1080),
      { width: 800, height: 600, imageOffsetX: 100, imageOffsetY: 50 },
      false
    );
    expect(bounds).toEqual({ x: -100, y: -50, width: 800, height: 600 });
  });

  it('returns the full image when bounds match the image (no crop applied)', () => {
    const bounds = getVisibleBounds(
      fakeImage(1920, 1080),
      { width: 1920, height: 1080, imageOffsetX: 0, imageOffsetY: 0 },
      false
    );
    expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe('getCompositionSize', () => {
  it('returns the content size unchanged when the compositor is disabled', () => {
    expect(getCompositionSize(1920, 1080, 48, false)).toEqual({ width: 1920, height: 1080 });
  });

  it('adds padding on every side when the compositor is enabled', () => {
    expect(getCompositionSize(1920, 1080, 48, true)).toEqual({ width: 2016, height: 1176 });
  });
});

describe('rectsIntersect', () => {
  const base = { x: 0, y: 0, width: 100, height: 100 };

  it('detects overlapping rectangles', () => {
    expect(rectsIntersect(base, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
  });

  it('detects full containment', () => {
    expect(rectsIntersect(base, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
  });

  it('returns false for clearly separated rectangles', () => {
    expect(rectsIntersect(base, { x: 200, y: 200, width: 10, height: 10 })).toBe(false);
  });

  it('treats edge contact as intersecting', () => {
    expect(rectsIntersect(base, { x: 100, y: 0, width: 10, height: 100 })).toBe(true);
  });
});

describe('lineIntersectsRect', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };

  it('is true when an endpoint is inside the rectangle', () => {
    expect(lineIntersectsRect(50, 50, 200, 200, rect)).toBe(true);
  });

  it('is true when the segment crosses the rectangle without endpoints inside', () => {
    expect(lineIntersectsRect(-50, 50, 150, 50, rect)).toBe(true);
  });

  it('is false when the segment misses the rectangle entirely', () => {
    expect(lineIntersectsRect(200, 0, 300, 100, rect)).toBe(false);
  });

  it('is true for a segment lying along an edge (collinear)', () => {
    expect(lineIntersectsRect(-10, 0, 110, 0, rect)).toBe(true);
  });
});

describe('shapeIntersectsRect', () => {
  const marquee = { x: 0, y: 0, width: 100, height: 100 };

  it('uses line intersection for arrows that cross the marquee', () => {
    const arrow = makeShape({ type: 'arrow', points: [-50, 50, 150, 50] });
    expect(shapeIntersectsRect(arrow, marquee)).toBe(true);
  });

  it('returns false for a line whose segment misses the marquee', () => {
    const line = makeShape({ type: 'line', points: [200, 0, 300, 100] });
    expect(shapeIntersectsRect(line, marquee)).toBe(false);
  });

  it('uses bounding-box intersection for non-line shapes', () => {
    const overlapping = makeShape({ type: 'rect', x: 50, y: 50, width: 100, height: 100 });
    expect(shapeIntersectsRect(overlapping, marquee)).toBe(true);
    const far = makeShape({ type: 'rect', x: 500, y: 500, width: 10, height: 10 });
    expect(shapeIntersectsRect(far, marquee)).toBe(false);
  });
});
