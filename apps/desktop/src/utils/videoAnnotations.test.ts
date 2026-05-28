import { describe, expect, it } from 'vitest';
import { ANNOTATIONS } from '@/constants';
import {
  clampAnnotationShape,
  createDefaultAnnotationSegment,
  createDefaultAnnotationShape,
  drawAnnotationShape,
  getAnnotationArrowEndpoints,
  getAnnotationArrowRenderGeometry,
  getAnnotationArrowShapeUpdate,
  getAnnotationBoxSliderBounds,
  getAnnotationCornerRadius,
  getNextAnnotationStepNumber,
  getAnnotationRenderBox,
  getAnnotationStepRenderGeometry,
  getAnnotationStrokeWidth,
  isEndpointAnnotationShapeType,
  isLegacyAnnotationShapeType,
  normalizeAnnotationConfig,
  normalizeAnnotationSegment,
} from './videoAnnotations';

describe('getAnnotationBoxSliderBounds', () => {
  it('uses a fixed overflow-friendly range for box sliders', () => {
    expect(getAnnotationBoxSliderBounds()).toEqual({
      xMin: ANNOTATIONS.BOX_SLIDER_POSITION_MIN,
      xMax: ANNOTATIONS.BOX_SLIDER_POSITION_MAX,
      yMin: ANNOTATIONS.BOX_SLIDER_POSITION_MIN,
      yMax: ANNOTATIONS.BOX_SLIDER_POSITION_MAX,
      widthMin: ANNOTATIONS.MIN_NORMALIZED_SIZE,
      widthMax: ANNOTATIONS.BOX_SLIDER_SIZE_MAX,
      heightMin: ANNOTATIONS.MIN_NORMALIZED_SIZE,
      heightMax: ANNOTATIONS.BOX_SLIDER_SIZE_MAX,
    });
  });

  it('keeps slider bounds stable even when the shape is already outside the frame', () => {
    const bounds = getAnnotationBoxSliderBounds();

    expect(bounds.xMin).toBe(ANNOTATIONS.BOX_SLIDER_POSITION_MIN);
    expect(bounds.xMax).toBe(ANNOTATIONS.BOX_SLIDER_POSITION_MAX);
    expect(bounds.widthMax).toBe(ANNOTATIONS.BOX_SLIDER_SIZE_MAX);
    expect(bounds.heightMax).toBe(ANNOTATIONS.BOX_SLIDER_SIZE_MAX);
  });
});

describe('clampAnnotationShape', () => {
  it('preserves box shape overflow while still enforcing minimum size', () => {
    const shape = {
      ...createDefaultAnnotationShape('rectangle'),
      x: -0.4,
      y: 1.2,
      width: 0.01,
      height: 0.02,
    };

    const clamped = clampAnnotationShape(shape);

    expect(clamped.x).toBe(-0.4);
    expect(clamped.y).toBe(1.2);
    expect(clamped.width).toBe(ANNOTATIONS.MIN_NORMALIZED_SIZE);
    expect(clamped.height).toBe(ANNOTATIONS.MIN_NORMALIZED_SIZE);
  });

  it('keeps step annotations square and clamps their number to a positive integer', () => {
    const shape = {
      ...createDefaultAnnotationShape('step', { number: 0 }),
      width: 0.05,
      height: 0.08,
    };

    const clamped = clampAnnotationShape(shape);

    expect(clamped.width).toBe(0.08);
    expect(clamped.height).toBe(0.08);
    expect(clamped.number).toBe(1);
  });
});

describe('default annotation shape', () => {
  it('uses arrow as the default shape for new annotations', () => {
    expect(createDefaultAnnotationShape()).toMatchObject({
      shapeType: 'arrow',
      strokeWidth: ANNOTATIONS.DEFAULT_STROKE_WIDTH,
    });
    expect(createDefaultAnnotationSegment(0, 1000).shapes[0]).toMatchObject({
      shapeType: 'arrow',
      strokeWidth: ANNOTATIONS.DEFAULT_STROKE_WIDTH,
    });
  });
});

describe('getNextAnnotationStepNumber', () => {
  it('fills numbering gaps across the whole annotation track before extending the sequence', () => {
    expect(getNextAnnotationStepNumber([
      {
        id: 'segment-1',
        startMs: 0,
        endMs: 1000,
        enabled: true,
        shapes: [
          createDefaultAnnotationShape('step', { number: 1 }),
          createDefaultAnnotationShape('rectangle'),
        ],
      },
      {
        id: 'segment-2',
        startMs: 1000,
        endMs: 2000,
        enabled: true,
        shapes: [
          createDefaultAnnotationShape('step', { number: 3 }),
        ],
      },
    ])).toBe(2);
  });
});

describe('drawAnnotationShape', () => {
  it('computes shared preview/export geometry for box annotations', () => {
    const shape = createDefaultAnnotationShape('rectangle', {
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.3,
      strokeWidth: 12,
    });
    const box = getAnnotationRenderBox(shape, 800, 450);

    expect(box).toEqual({
      left: 80,
      top: 90,
      width: 320,
      height: 135,
      centerX: 240,
      centerY: 157.5,
    });
    expect(getAnnotationCornerRadius(box)).toBe(10.8);
    expect(getAnnotationStrokeWidth(shape, 450)).toBe(5);
  });

  it('computes shared preview/export geometry for step annotations', () => {
    const shape = createDefaultAnnotationShape('step', {
      x: 0.25,
      y: 0.25,
      width: 0.1,
      height: 0.1,
    });
    const box = getAnnotationRenderBox(shape, 1280, 720);
    const step = getAnnotationStepRenderGeometry(box);

    expect(step.diameter).toBe(72);
    expect(step.radius).toBe(36);
    expect(step.centerX).toBe(384);
    expect(step.centerY).toBe(216);
    expect(step.fontSize).toBeCloseTo(33.48);
  });

  it('does not render legacy annotation text shapes', () => {
    const shape = createDefaultAnnotationShape('text');
    const operations: string[] = [];
    const ctx = {
      globalAlpha: 1,
      save() {
        operations.push('save');
      },
      restore() {
        operations.push('restore');
      },
      fillText() {
        operations.push('fillText');
      },
      fill() {
        operations.push('fill');
      },
      stroke() {
        operations.push('stroke');
      },
      beginPath() {
        operations.push('beginPath');
      },
      roundRect() {
        operations.push('roundRect');
      },
    } as unknown as CanvasRenderingContext2D;

    drawAnnotationShape(ctx, shape, 1280, 720, 720);

    expect(operations).toEqual(['save', 'restore']);
  });

  it('extends the shaft slightly into the head to avoid a visible gap', () => {
    const shape = createDefaultAnnotationShape('arrow');
    const strokeWidth = 3;
    const geometry = getAnnotationArrowRenderGeometry(shape, 320, 180, strokeWidth);
    const shaftInset = Math.hypot(geometry.headX - geometry.shaftEndX, geometry.headY - geometry.shaftEndY);
    const fullLength = Math.hypot(geometry.headX - geometry.tailX, geometry.headY - geometry.tailY);
    const desiredHeadLength = Math.max(strokeWidth * ANNOTATIONS.ARROW_HEAD_FACTOR, 14);
    const headLength = Math.min(desiredHeadLength, fullLength * 0.55);
    const headBaseInset = headLength * Math.cos(Math.PI / 6);

    expect(shaftInset).toBeLessThan(headBaseInset);
  });

  it('draws arrows as a single shaft shape before the head', () => {
    const shape = createDefaultAnnotationShape('arrow');
    const operations: string[] = [];
    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      save() {},
      restore() {},
      beginPath() {
        operations.push('beginPath');
      },
      moveTo() {
        operations.push('moveTo');
      },
      lineTo() {
        operations.push('lineTo');
      },
      fill() {
        operations.push(`fill:${this.fillStyle}`);
      },
      closePath() {
        operations.push('closePath');
      },
      bezierCurveTo() {
        operations.push('bezierCurveTo');
      },
    } as unknown as CanvasRenderingContext2D;

    drawAnnotationShape(ctx, shape, 320, 180, 180);

    expect(operations).toContain('bezierCurveTo');
    expect(operations.filter((operation) => operation === `fill:${shape.strokeColor}`)).toHaveLength(2);
  });
});

describe('isEndpointAnnotationShapeType / isLegacyAnnotationShapeType', () => {
  it('classifies arrow and line as endpoint shapes', () => {
    expect(isEndpointAnnotationShapeType('arrow')).toBe(true);
    expect(isEndpointAnnotationShapeType('line')).toBe(true);
    expect(isEndpointAnnotationShapeType('rectangle')).toBe(false);
    expect(isEndpointAnnotationShapeType('step')).toBe(false);
    expect(isEndpointAnnotationShapeType('text')).toBe(false);
  });

  it('classifies line and text as legacy shapes', () => {
    expect(isLegacyAnnotationShapeType('line')).toBe(true);
    expect(isLegacyAnnotationShapeType('text')).toBe(true);
    expect(isLegacyAnnotationShapeType('arrow')).toBe(false);
    expect(isLegacyAnnotationShapeType('rectangle')).toBe(false);
  });
});

describe('getAnnotationArrowEndpoints', () => {
  it('uses explicit arrow endpoints when present', () => {
    const shape = createDefaultAnnotationShape('arrow', {
      arrowStartX: 0.1,
      arrowStartY: 0.2,
      arrowEndX: 0.7,
      arrowEndY: 0.5,
    });
    expect(getAnnotationArrowEndpoints(shape)).toEqual({
      tailX: 0.1,
      tailY: 0.2,
      headX: 0.7,
      headY: 0.5,
    });
  });

  it('derives endpoints from the box when explicit ones are absent', () => {
    // 'rectangle' shapes leave arrowStart/End null; padding factor is 0.18
    const shape = createDefaultAnnotationShape('rectangle', {
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.2,
    });
    const endpoints = getAnnotationArrowEndpoints(shape);
    expect(endpoints.tailX).toBeCloseTo(0.254, 6); // 0.2 + 0.3*0.18
    expect(endpoints.tailY).toBeCloseTo(0.364, 6); // 0.2 + 0.2*(1-0.18)
    expect(endpoints.headX).toBeCloseTo(0.446, 6); // 0.2 + 0.3*(1-0.18)
    expect(endpoints.headY).toBeCloseTo(0.236, 6); // 0.2 + 0.2*0.18
  });

  it('enforces a minimum length for a too-short arrow without snapping to bounds', () => {
    const shape = createDefaultAnnotationShape('arrow', {
      arrowStartX: 0.5,
      arrowStartY: 0.5,
      arrowEndX: 0.51,
      arrowEndY: 0.5,
    });
    const endpoints = getAnnotationArrowEndpoints(shape);
    expect(endpoints.tailX).toBe(0.5);
    expect(endpoints.headX).toBeCloseTo(0.53, 6); // extended to MIN_NORMALIZED_SIZE (0.03)
    expect(endpoints.headY).toBeCloseTo(0.5, 6);
  });

  it('uses a diagonal fallback direction for a zero-length arrow', () => {
    const shape = createDefaultAnnotationShape('arrow', {
      arrowStartX: 0.5,
      arrowStartY: 0.5,
      arrowEndX: 0.5,
      arrowEndY: 0.5,
    });
    const endpoints = getAnnotationArrowEndpoints(shape);
    const unit = 0.03 / Math.SQRT2;
    expect(endpoints.headX).toBeCloseTo(0.5 + unit, 6);
    expect(endpoints.headY).toBeCloseTo(0.5 - unit, 6);
  });
});

describe('getAnnotationArrowShapeUpdate', () => {
  it('derives the bounding box from the current endpoints', () => {
    const shape = createDefaultAnnotationShape('arrow', {
      arrowStartX: 0.2,
      arrowStartY: 0.7,
      arrowEndX: 0.6,
      arrowEndY: 0.3,
    });
    expect(getAnnotationArrowShapeUpdate(shape, {})).toEqual({
      x: 0.2,
      y: 0.3,
      width: expect.closeTo(0.4, 6),
      height: expect.closeTo(0.4, 6),
      arrowStartX: 0.2,
      arrowStartY: 0.7,
      arrowEndX: 0.6,
      arrowEndY: 0.3,
    });
  });

  it('applies endpoint updates and recomputes the box', () => {
    const shape = createDefaultAnnotationShape('arrow', {
      arrowStartX: 0.2,
      arrowStartY: 0.7,
      arrowEndX: 0.6,
      arrowEndY: 0.3,
    });
    const update = getAnnotationArrowShapeUpdate(shape, { headX: 0.9, headY: 0.1 });
    expect(update.x).toBeCloseTo(0.2, 6);
    expect(update.y).toBeCloseTo(0.1, 6);
    expect(update.width).toBeCloseTo(0.7, 6);
    expect(update.height).toBeCloseTo(0.6, 6);
    expect(update.arrowEndX).toBeCloseTo(0.9, 6);
    expect(update.arrowEndY).toBeCloseTo(0.1, 6);
  });

  it('floors the collapsed dimension of a horizontal arrow to the minimum size', () => {
    const shape = createDefaultAnnotationShape('arrow', {
      arrowStartX: 0.2,
      arrowStartY: 0.5,
      arrowEndX: 0.6,
      arrowEndY: 0.5,
    });
    const update = getAnnotationArrowShapeUpdate(shape, {});
    expect(update.width).toBeCloseTo(0.4, 6);
    expect(update.height).toBe(0.03); // MIN_NORMALIZED_SIZE
  });
});

describe('normalizeAnnotationSegment / normalizeAnnotationConfig', () => {
  it('fills in defaults for an undefined segment', () => {
    const segment = normalizeAnnotationSegment(undefined);
    expect(segment.startMs).toBe(0);
    expect(segment.endMs).toBe(3000); // DEFAULT_SEGMENT_DURATION_MS
    expect(segment.enabled).toBe(true);
    expect(segment.shapes).toHaveLength(1);
    expect(typeof segment.id).toBe('string');
  });

  it('clamps an end time that precedes the start time up to the start', () => {
    const segment = normalizeAnnotationSegment({ startMs: 5000, endMs: 2000 });
    expect(segment.startMs).toBe(5000);
    expect(segment.endMs).toBe(5000);
  });

  it('returns an empty config for null/invalid input', () => {
    expect(normalizeAnnotationConfig(null)).toEqual({ segments: [] });
    expect(normalizeAnnotationConfig({})).toEqual({ segments: [] });
  });

  it('normalizes each segment of a valid config', () => {
    const config = normalizeAnnotationConfig({
      segments: [{ startMs: 0, endMs: 1000 }],
    });
    expect(config.segments).toHaveLength(1);
    expect(config.segments[0].endMs).toBe(1000);
    expect(config.segments[0].shapes).toHaveLength(1);
  });
});
