import { describe, expect, it } from 'vitest';
import { ANNOTATIONS } from '@/constants';
import {
  clampAnnotationShape,
  createDefaultAnnotationSegment,
  createDefaultAnnotationShape,
  drawAnnotationShape,
  getAnnotationArrowRenderGeometry,
  getAnnotationBoxSliderBounds,
  getAnnotationCornerRadius,
  getNextAnnotationStepNumber,
  getAnnotationRenderBox,
  getAnnotationStepRenderGeometry,
  getAnnotationStrokeWidth,
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
