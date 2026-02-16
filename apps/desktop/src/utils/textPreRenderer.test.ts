import { describe, expect, it } from 'vitest';
import { renderTextOnCanvas } from './textPreRenderer';

interface MockRenderContext extends Partial<CanvasRenderingContext2D> {
  font: string;
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
    measureText: (text: string) => ({
      width: text.length * 12,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 4,
    } as TextMetrics),
    fillText: () => undefined,
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
});
