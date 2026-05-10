import { describe, expect, it } from 'vitest';
import { renderTextOnCanvas } from './textPreRenderer';

interface MockRenderContext extends Partial<CanvasRenderingContext2D> {
  font: string;
  operations: string[];
}

function createMockContext(): CanvasRenderingContext2D {
  const ctx: MockRenderContext = {
    font: '',
    textAlign: 'center',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '#ffffff',
    strokeStyle: '#000000',
    lineWidth: 0,
    lineJoin: 'miter',
    miterLimit: 10,
    operations: [],
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    fill: () => {
      ctx.operations.push('fill-background');
    },
    stroke: () => {
      ctx.operations.push('stroke-background');
    },
    measureText: (text: string) => ({
      width: text.length * 12,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 4,
    } as TextMetrics),
    fillText: () => {
      ctx.operations.push('fill-text');
    },
    strokeText: () => {
      ctx.operations.push('stroke-text');
    },
  };

  return ctx as CanvasRenderingContext2D;
}

describe('renderTextOnCanvas', () => {
  it('keeps font size independent from text box bounds', () => {
    const context = createMockContext();

    renderTextOnCanvas(
      context,
      {
        content: 'Text',
        fontFamily: 'sans-serif',
        fontWeight: 700,
        italic: false,
        fontSize: 48,
        color: '#ffffff',
      },
      400,
      120,
      1080,
    );
    const fontWithSmallerBounds = context.font;

    renderTextOnCanvas(
      context,
      {
        content: 'Text',
        fontFamily: 'sans-serif',
        fontWeight: 700,
        italic: false,
        fontSize: 48,
        color: '#ffffff',
      },
      800,
      320,
      1080,
    );
    const fontWithLargerBounds = context.font;

    expect(fontWithSmallerBounds).toBe(fontWithLargerBounds);
    expect(fontWithSmallerBounds).toContain('48px');
  });

  it('draws background before text stroke and fill', () => {
    const context = createMockContext() as CanvasRenderingContext2D & { operations: string[] };

    renderTextOnCanvas(
      context,
      {
        content: 'Text',
        fontFamily: 'sans-serif',
        fontWeight: 700,
        italic: false,
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: '#111111',
        backgroundStrokeColor: '#eeeeee',
        backgroundStrokeWidth: 2,
        strokeColor: '#000000',
        strokeWidth: 4,
      },
      400,
      120,
      1080,
    );

    expect(context.operations).toEqual(['fill-background', 'stroke-background', 'stroke-text', 'fill-text']);
  });
});
