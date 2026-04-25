import type { CanvasShape } from '../types';

export const EDITOR_TEXT = {
  MIN_BOX_WIDTH: 50,
  MIN_BOX_HEIGHT: 30,
  DEFAULT_BOX_WIDTH: 320,
  DEFAULT_HEIGHT_MULTIPLIER: 1.5,
  DEFAULT_FONT_SIZE: 36,
  DEFAULT_FONT_FAMILY: 'Arial',
  DEFAULT_FONT_STYLE: 'normal',
  DEFAULT_TEXT_DECORATION: '',
  DEFAULT_ALIGN: 'center',
  DEFAULT_VERTICAL_ALIGN: 'middle',
  DEFAULT_WRAP: 'word',
  DEFAULT_LINE_HEIGHT: 1.2,
  DEFAULT_COLOR: '#000000',
  DEFAULT_TEXT_BACKGROUND: '#FFFFFF',
  DEFAULT_TEXT_BOX_STROKE: '#EF4444',
  DEFAULT_TEXT_BOX_STROKE_WIDTH: 2,
} as const;

export type EditorTextFontToken = 'bold' | 'italic';
export type EditorTextFontStyle = 'normal' | 'bold' | 'italic' | 'bold italic';
export type EditorTextAlign = 'left' | 'center' | 'right';
export type EditorTextVerticalAlign = 'top' | 'middle' | 'bottom';

interface Point {
  x: number;
  y: number;
}

interface CreateTextShapeInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
}

interface CreateDragTextShapeInput {
  id: string;
  startPos: Point;
  endPos: Point;
  fontSize: number;
  color: string;
}

interface CreateClickTextShapeInput {
  id: string;
  position: Point;
  fontSize: number;
  color: string;
}

function hasFontToken(fontStyle: string | undefined, token: EditorTextFontToken): boolean {
  return Boolean(fontStyle && fontStyle.includes(token));
}

export function normalizeEditorTextFontStyle(fontStyle: string | undefined): EditorTextFontStyle {
  const hasBold = hasFontToken(fontStyle, 'bold');
  const hasItalic = hasFontToken(fontStyle, 'italic');

  if (hasBold && hasItalic) return 'bold italic';
  if (hasBold) return 'bold';
  if (hasItalic) return 'italic';
  return EDITOR_TEXT.DEFAULT_FONT_STYLE;
}

export function toggleEditorTextFontStyle(
  fontStyle: string | undefined,
  token: EditorTextFontToken
): EditorTextFontStyle {
  const hasBold = hasFontToken(fontStyle, 'bold');
  const hasItalic = hasFontToken(fontStyle, 'italic');

  const nextBold = token === 'bold' ? !hasBold : hasBold;
  const nextItalic = token === 'italic' ? !hasItalic : hasItalic;

  if (nextBold && nextItalic) return 'bold italic';
  if (nextBold) return 'bold';
  if (nextItalic) return 'italic';
  return EDITOR_TEXT.DEFAULT_FONT_STYLE;
}

export function isEditorTextStyleBold(fontStyle: string | undefined): boolean {
  return hasFontToken(fontStyle, 'bold');
}

export function isEditorTextStyleItalic(fontStyle: string | undefined): boolean {
  return hasFontToken(fontStyle, 'italic');
}

export function normalizeEditorTextAlign(align: string | undefined): EditorTextAlign {
  if (align === 'center' || align === 'right') {
    return align;
  }
  return EDITOR_TEXT.DEFAULT_ALIGN;
}

export function normalizeEditorTextVerticalAlign(
  verticalAlign: string | undefined
): EditorTextVerticalAlign {
  if (verticalAlign === 'middle' || verticalAlign === 'bottom') {
    return verticalAlign;
  }
  return EDITOR_TEXT.DEFAULT_VERTICAL_ALIGN;
}

export function getEditorTextVerticalAlignJustifyContent(
  verticalAlign: string | undefined
): 'flex-start' | 'center' | 'flex-end' {
  const normalized = normalizeEditorTextVerticalAlign(verticalAlign);
  if (normalized === 'middle') return 'center';
  if (normalized === 'bottom') return 'flex-end';
  return 'flex-start';
}

export function getEditorTextDragBoxHeight(fontSize: number): number {
  return fontSize * EDITOR_TEXT.DEFAULT_HEIGHT_MULTIPLIER;
}

export function getEditorTextDefaultBoxHeight(fontSize: number): number {
  return Math.max(
    getEditorTextDragBoxHeight(fontSize),
    EDITOR_TEXT.MIN_BOX_HEIGHT
  );
}

export function getEditorTextResizeDimensions(
  width: number | undefined,
  height: number | undefined,
  scaleX: number,
  scaleY: number
): { width: number; height: number } {
  const baseWidth = Math.max(Math.abs(width ?? EDITOR_TEXT.MIN_BOX_WIDTH), EDITOR_TEXT.MIN_BOX_WIDTH);
  const baseHeight = Math.max(Math.abs(height ?? EDITOR_TEXT.MIN_BOX_HEIGHT), EDITOR_TEXT.MIN_BOX_HEIGHT);

  return {
    width: baseWidth * scaleX,
    height: baseHeight * scaleY,
  };
}

export function createEditorTextShape({
  id,
  x,
  y,
  width,
  height,
  fontSize,
  color,
}: CreateTextShapeInput): CanvasShape {
  return {
    id,
    type: 'text',
    x,
    y,
    width,
    height,
    text: '',
    fontSize,
    fontFamily: EDITOR_TEXT.DEFAULT_FONT_FAMILY,
    fontStyle: EDITOR_TEXT.DEFAULT_FONT_STYLE,
    textDecoration: EDITOR_TEXT.DEFAULT_TEXT_DECORATION,
    align: EDITOR_TEXT.DEFAULT_ALIGN,
    verticalAlign: EDITOR_TEXT.DEFAULT_VERTICAL_ALIGN,
    wrap: EDITOR_TEXT.DEFAULT_WRAP,
    lineHeight: EDITOR_TEXT.DEFAULT_LINE_HEIGHT,
    fill: color,
    stroke: undefined,
    strokeWidth: 0,
    textBackground: EDITOR_TEXT.DEFAULT_TEXT_BACKGROUND,
    textBoxStroke: EDITOR_TEXT.DEFAULT_TEXT_BOX_STROKE,
    textBoxStrokeWidth: EDITOR_TEXT.DEFAULT_TEXT_BOX_STROKE_WIDTH,
  };
}

export function createEditorDragTextShape({
  id,
  startPos,
  endPos,
  fontSize,
  color,
}: CreateDragTextShapeInput): CanvasShape {
  return createEditorTextShape({
    id,
    x: Math.min(startPos.x, endPos.x),
    y: Math.min(startPos.y, endPos.y),
    width: Math.max(EDITOR_TEXT.MIN_BOX_WIDTH, Math.abs(endPos.x - startPos.x)),
    height: Math.max(getEditorTextDragBoxHeight(fontSize), Math.abs(endPos.y - startPos.y)),
    fontSize,
    color,
  });
}

export function createEditorClickTextShape({
  id,
  position,
  fontSize,
  color,
}: CreateClickTextShapeInput): CanvasShape {
  return createEditorTextShape({
    id,
    x: position.x,
    y: position.y,
    width: EDITOR_TEXT.DEFAULT_BOX_WIDTH,
    height: getEditorTextDefaultBoxHeight(fontSize),
    fontSize,
    color,
  });
}

export function getEditorTextFontFamily(value: string | undefined): string {
  return value || EDITOR_TEXT.DEFAULT_FONT_FAMILY;
}

export function getEditorTextFontStyle(value: string | undefined): EditorTextFontStyle {
  return normalizeEditorTextFontStyle(value);
}

export function getEditorTextDecoration(value: string | undefined): string {
  return value || EDITOR_TEXT.DEFAULT_TEXT_DECORATION;
}
