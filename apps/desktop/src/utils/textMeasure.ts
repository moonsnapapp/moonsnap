import { TEXT_LAYOUT } from '../constants';
import { measureTextLayout, type RenderTextOptions } from './textPreRenderer';

type MeasureContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type MeasureTextInput = Pick<
  RenderTextOptions,
  'content' | 'fontFamily' | 'fontWeight' | 'italic' | 'fontSize'
>;

function createMeasurementContext(): MeasureContext | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1).getContext('2d');
  }

  if (typeof document !== 'undefined') {
    return document.createElement('canvas').getContext('2d');
  }

  return null;
}

function clampRatio(value: number, min: number): number {
  return Math.min(TEXT_LAYOUT.MAX_SIZE_RATIO, Math.max(min, value));
}

/**
 * Shared text measurement utility used by the text overlay, timeline, and
 * text segment editor. Mirrors the same wrap rules as preview/export.
 */
export function measureTextSize(
  input: MeasureTextInput,
  maxWidthPx: number,
  referenceHeight: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, maxWidthPx);
  const safeReferenceHeight = Math.max(1, referenceHeight);
  const ctx = createMeasurementContext();

  if (!ctx) {
    const scaledFontSize = Math.max(1, input.fontSize * (safeReferenceHeight / 1080));
    const estimatedCharsPerLine = Math.max(1, Math.floor(safeWidth / Math.max(scaledFontSize * 0.6, 1)));
    const estimatedLineCount = Math.max(
      1,
      Math.ceil(Array.from(input.content || '').length / estimatedCharsPerLine),
    );

    return {
      width: safeWidth,
      height: estimatedLineCount * scaledFontSize * 1.2,
    };
  }

  const { maxLineWidthPx, totalHeightPx } = measureTextLayout(
    ctx,
    {
      ...input,
      color: '#ffffff',
    },
    safeWidth,
    safeReferenceHeight,
  );

  return {
    width: maxLineWidthPx,
    height: totalHeightPx,
  };
}

export function fitTextSegmentToContent(
  input: MeasureTextInput,
  videoWidth: number,
  videoHeight: number,
  maxWidthRatio: number = TEXT_LAYOUT.DEFAULT_MAX_WIDTH_RATIO,
): { x: number; y: number } {
  const safeVideoWidth = Math.max(1, videoWidth);
  const safeVideoHeight = Math.max(1, videoHeight);
  const safeMaxWidthRatio = clampRatio(maxWidthRatio, TEXT_LAYOUT.MIN_WIDTH_RATIO);
  const measured = measureTextSize(input, safeVideoWidth * safeMaxWidthRatio, safeVideoHeight);

  return {
    x: clampRatio(
      (measured.width * TEXT_LAYOUT.BOX_PADDING_FACTOR) / safeVideoWidth,
      TEXT_LAYOUT.MIN_WIDTH_RATIO,
    ),
    y: clampRatio(
      (measured.height * TEXT_LAYOUT.BOX_PADDING_FACTOR) / safeVideoHeight,
      TEXT_LAYOUT.MIN_HEIGHT_RATIO,
    ),
  };
}

export function calculateTextSegmentHeightRatio(
  input: MeasureTextInput,
  widthRatio: number,
  videoWidth: number,
  videoHeight: number,
): number {
  const safeVideoWidth = Math.max(1, videoWidth);
  const safeVideoHeight = Math.max(1, videoHeight);
  const safeWidthRatio = clampRatio(widthRatio, TEXT_LAYOUT.MIN_WIDTH_RATIO);
  const measured = measureTextSize(input, safeVideoWidth * safeWidthRatio, safeVideoHeight);

  return clampRatio(
    (measured.height * TEXT_LAYOUT.BOX_PADDING_FACTOR) / safeVideoHeight,
    TEXT_LAYOUT.MIN_HEIGHT_RATIO,
  );
}
