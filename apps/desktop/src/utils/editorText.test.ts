import { describe, it, expect } from 'vitest';
import {
  EDITOR_TEXT,
  createEditorClickTextShape,
  createEditorDragTextShape,
  getEditorTextDefaultBoxHeight,
  getEditorTextDragBoxHeight,
  getEditorTextResizeDimensions,
  getEditorTextVerticalAlignJustifyContent,
  normalizeEditorTextFontStyle,
  toggleEditorTextFontStyle,
} from './editorText';

describe('editorText', () => {
  it('normalizes font style tokens', () => {
    expect(normalizeEditorTextFontStyle(undefined)).toBe('normal');
    expect(normalizeEditorTextFontStyle('bold')).toBe('bold');
    expect(normalizeEditorTextFontStyle('italic')).toBe('italic');
    expect(normalizeEditorTextFontStyle('italic bold')).toBe('bold italic');
  });

  it('toggles bold and italic font style tokens', () => {
    expect(toggleEditorTextFontStyle('normal', 'bold')).toBe('bold');
    expect(toggleEditorTextFontStyle('bold', 'italic')).toBe('bold italic');
    expect(toggleEditorTextFontStyle('bold italic', 'bold')).toBe('italic');
    expect(toggleEditorTextFontStyle('italic', 'italic')).toBe('normal');
  });

  it('creates drag text shape with minimum width and font-size-based drag height', () => {
    const shape = createEditorDragTextShape({
      id: 'shape_1',
      startPos: { x: 10, y: 10 },
      endPos: { x: 12, y: 13 },
      fontSize: 16,
      color: '#ff0000',
    });

    expect(shape.width).toBe(EDITOR_TEXT.MIN_BOX_WIDTH);
    expect(shape.height).toBe(getEditorTextDragBoxHeight(16));
  });

  it('creates click text shape with default size', () => {
    const shape = createEditorClickTextShape({
      id: 'shape_2',
      position: { x: 20, y: 30 },
      fontSize: 16,
      color: '#00ff00',
    });

    expect(shape.width).toBe(EDITOR_TEXT.DEFAULT_BOX_WIDTH);
    expect(shape.height).toBe(getEditorTextDefaultBoxHeight(16));
    expect(shape.fontFamily).toBe(EDITOR_TEXT.DEFAULT_FONT_FAMILY);
    expect(shape.align).toBe(EDITOR_TEXT.DEFAULT_ALIGN);
    expect(shape.verticalAlign).toBe(EDITOR_TEXT.DEFAULT_VERTICAL_ALIGN);
  });

  it('maps vertical align values to flex justifyContent', () => {
    expect(getEditorTextVerticalAlignJustifyContent('top')).toBe('flex-start');
    expect(getEditorTextVerticalAlignJustifyContent('middle')).toBe('center');
    expect(getEditorTextVerticalAlignJustifyContent('bottom')).toBe('flex-end');
  });

  it('derives live resize dimensions from the original text box size', () => {
    const firstPass = getEditorTextResizeDimensions(100, 40, 1.1, 1.25);
    const secondPass = getEditorTextResizeDimensions(100, 40, 1.2, 1.5);

    expect(firstPass.width).toBeCloseTo(110);
    expect(firstPass.height).toBeCloseTo(50);
    expect(secondPass.width).toBeCloseTo(120);
    expect(secondPass.height).toBeCloseTo(60);
  });

  it('falls back to text minimums when resize inputs are missing', () => {
    expect(getEditorTextResizeDimensions(undefined, undefined, 1, 1)).toEqual({
      width: EDITOR_TEXT.MIN_BOX_WIDTH,
      height: EDITOR_TEXT.MIN_BOX_HEIGHT,
    });
  });
});
