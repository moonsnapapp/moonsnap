/**
 * Text rendering shared between preview and export.
 *
 * Canvas 2D fillText() uses the same system font rasterizer as CSS
 * (DirectWrite on Windows, CoreText on macOS), so glyphs are identical.
 * Using a single rendering function for both paths guarantees WYSIWYG.
 */

import { invoke } from '@tauri-apps/api/core';
import type { TextSegment } from '../types';

/** Per-line layout info for typewriter reveal in export. */
export interface LineMetric {
  topPx: number;
  heightPx: number;
  cumulativeChars: number;
  contentWidthPx: number;
  revealWidthsPx: number[];
}

/** Result of pre-rendering a single text segment. */
export interface PreRenderedSegment {
  segmentIndex: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  sizeX: number;
  sizeY: number;
  rgbaData: Uint8Array;
  lineMetrics: LineMetric[];
}

/** Options for renderTextOnCanvas. */
export interface RenderTextOptions {
  content: string;
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  fontSize: number;
  color: string;
}

type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TextLayoutMetrics {
  lines: string[];
  lineHeightPx: number;
  totalHeightPx: number;
  baselineInLinePx: number;
  maxLineWidthPx: number;
}

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

let graphemeSegmenter: GraphemeSegmenter | null | undefined;

function splitGraphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    const segmenterCtor = (Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: 'grapheme' },
      ) => GraphemeSegmenter;
    }).Segmenter;
    graphemeSegmenter = segmenterCtor
      ? new segmenterCtor(undefined, { granularity: 'grapheme' })
      : null;
  }

  if (!graphemeSegmenter) {
    return Array.from(text);
  }

  return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
}

/**
 * Break a single word into chunks that each fit within maxWidth.
 */
function breakWord(
  ctx: RenderContext,
  word: string,
  maxWidth: number,
): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of word) {
    const test = current + char;
    if (current && ctx.measureText(test).width > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Word-wrap text to fit within maxWidth using Canvas 2D measureText.
 * Breaks mid-word when a single word exceeds maxWidth.
 */
function wordWrap(
  ctx: RenderContext,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    if (ctx.measureText(word).width > maxWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      const chunks = breakWord(ctx, word, maxWidth);
      for (let i = 0; i < chunks.length; i++) {
        if (i < chunks.length - 1) {
          lines.push(chunks[i]);
        } else {
          currentLine = chunks[i];
        }
      }
      continue;
    }

    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

function configureTextContext(
  ctx: RenderContext,
  opts: RenderTextOptions,
  referenceHeight: number,
): { lineHeightPx: number; baselineInLinePx: number } {
  const heightScale = referenceHeight / 1080;
  const fontSizePx = Math.max(1, opts.fontSize * heightScale);
  const lineHeightPx = fontSizePx * 1.2;

  const fontStyle = opts.italic ? 'italic ' : '';
  ctx.font = `${fontStyle}${opts.fontWeight} ${fontSizePx}px ${opts.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const fontMetrics = ctx.measureText('Ag');
  const fontAscent = fontMetrics.fontBoundingBoxAscent || fontSizePx * 0.8;
  const fontDescent = fontMetrics.fontBoundingBoxDescent || fontSizePx * 0.2;
  const contentArea = fontAscent + fontDescent;
  const halfLeading = Math.max(0, (lineHeightPx - contentArea) / 2);

  return {
    lineHeightPx,
    baselineInLinePx: halfLeading + fontAscent,
  };
}

/**
 * Measure the wrapped text layout using the same font and word-wrap rules
 * as preview/export rendering.
 */
export function measureTextLayout(
  ctx: RenderContext,
  opts: RenderTextOptions,
  canvasWidth: number,
  referenceHeight: number,
): TextLayoutMetrics {
  const safeWidth = Math.max(1, canvasWidth);
  const { lineHeightPx, baselineInLinePx } = configureTextContext(ctx, opts, referenceHeight);
  const lines = wordWrap(ctx, opts.content, safeWidth);

  let maxLineWidthPx = 0;
  for (const line of lines) {
    maxLineWidthPx = Math.max(maxLineWidthPx, ctx.measureText(line).width);
  }

  return {
    lines,
    lineHeightPx,
    totalHeightPx: lines.length * lineHeightPx,
    baselineInLinePx,
    maxLineWidthPx,
  };
}

/** Line layout info returned by renderTextOnCanvas for typewriter export. */
export interface RenderedLineInfo {
  /** Text content of this line. */
  text: string;
  /** Y offset from the top of the drawing area. */
  topPx: number;
  /** Height of this line box. */
  heightPx: number;
  /** Measured pixel width of text content on this line. */
  contentWidthPx: number;
  /** Measured reveal width after each grapheme in the line. */
  revealWidthsPx: number[];
}

/**
 * Render text onto a canvas context. Single source of truth for text rendering,
 * used by both preview (TextOverlay canvas) and export (preRenderForExport).
 *
 * The caller is responsible for setting up the canvas size and any transforms
 * (e.g. DPR scaling for preview, padding offset for export).
 *
 * @param ctx - Canvas 2D context (regular or offscreen)
 * @param opts - Text content and style
 * @param canvasWidth - Drawing area width in current coordinate space
 * @param canvasHeight - Drawing area height in current coordinate space
 * @param referenceHeight - Video height for font scaling (videoSize.height for preview, exportHeight for export)
 * @returns Line layout info for typewriter reveal (empty array if not needed)
 */
export function renderTextOnCanvas(
  ctx: RenderContext,
  opts: RenderTextOptions,
  canvasWidth: number,
  canvasHeight: number,
  referenceHeight: number,
): RenderedLineInfo[] {
  const {
    lines,
    lineHeightPx,
    totalHeightPx,
    baselineInLinePx,
  } = measureTextLayout(ctx, opts, canvasWidth, referenceHeight);

  // Vertically center the text block
  const startY = Math.max(0, (canvasHeight - totalHeightPx) / 2);

  // Text shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  ctx.fillStyle = opts.color;
  const centerX = canvasWidth / 2;
  const lineInfos: RenderedLineInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineTopPx = startY + i * lineHeightPx;
    const lineText = lines[i];
    ctx.fillText(lineText, centerX, lineTopPx + baselineInLinePx);
    const graphemes = splitGraphemes(lineText);
    const revealWidthsPx: number[] = [];
    let prefix = '';
    for (const grapheme of graphemes) {
      prefix += grapheme;
      revealWidthsPx.push(ctx.measureText(prefix).width);
    }

    lineInfos.push({
      text: lineText,
      topPx: lineTopPx,
      heightPx: lineHeightPx,
      contentWidthPx: ctx.measureText(lineText).width,
      revealWidthsPx,
    });
  }

  return lineInfos;
}

/**
 * Pre-render a single text segment to RGBA pixel data for export.
 * Adds padding around the content area for anti-aliasing/shadow overflow.
 */
function preRenderSegment(
  segment: TextSegment,
  segmentIndex: number,
  exportWidth: number,
  exportHeight: number,
): PreRenderedSegment | null {
  if (!segment.enabled || !segment.content) return null;

  const padding = 4;
  const contentWidth = Math.round(segment.size.x * exportWidth);
  const contentHeight = Math.round(segment.size.y * exportHeight);
  const boxWidth = contentWidth + padding * 2;
  const boxHeight = contentHeight + padding * 2;

  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const canvas = new OffscreenCanvas(boxWidth, boxHeight);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, boxWidth, boxHeight);

  // Offset by padding so text renders in the content area
  ctx.save();
  ctx.translate(padding, padding);

  const lineInfos = renderTextOnCanvas(ctx, {
    content: segment.content,
    fontFamily: segment.fontFamily || 'sans-serif',
    fontWeight: segment.fontWeight || 700,
    italic: !!segment.italic,
    fontSize: segment.fontSize,
    color: segment.color || '#ffffff',
  }, contentWidth, contentHeight, exportHeight);

  ctx.restore();

  // Build per-line metrics for typewriter reveal.
  // topPx is offset by padding to match the pre-rendered image coordinates.
  // cumulativeChars must match revealWidthsPx indexing (grapheme-based).
  let cumulativeChars = 0;
  const lineMetrics: LineMetric[] = lineInfos.map((info) => {
    cumulativeChars += info.revealWidthsPx.length;
    return {
      topPx: Math.round(info.topPx + padding),
      heightPx: Math.round(info.heightPx),
      cumulativeChars,
      contentWidthPx: Math.round(info.contentWidthPx),
      revealWidthsPx: info.revealWidthsPx.map((width) => Math.round(width)),
    };
  });

  const imageData = ctx.getImageData(0, 0, boxWidth, boxHeight);

  return {
    segmentIndex,
    width: boxWidth,
    height: boxHeight,
    centerX: segment.center.x,
    centerY: segment.center.y,
    sizeX: segment.size.x,
    sizeY: segment.size.y,
    rgbaData: new Uint8Array(imageData.data.buffer),
    lineMetrics,
  };
}

/**
 * Pre-render all enabled text segments and register them with Rust.
 */
export async function preRenderForExport(
  segments: TextSegment[],
  exportWidth: number,
  exportHeight: number,
): Promise<void> {
  // Clear any previous pre-rendered texts
  await invoke('clear_prerendered_texts');

  const promises: Promise<void>[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment.enabled) continue;

    const rendered = preRenderSegment(segment, i, exportWidth, exportHeight);
    if (!rendered) continue;

    // Send to Rust
    promises.push(
      invoke('register_prerendered_text', {
        segmentIndex: rendered.segmentIndex,
        width: rendered.width,
        height: rendered.height,
        centerX: rendered.centerX,
        centerY: rendered.centerY,
        sizeX: rendered.sizeX,
        sizeY: rendered.sizeY,
        rgbaData: rendered.rgbaData,
        lineMetrics: rendered.lineMetrics,
      }),
    );
  }

  await Promise.all(promises);
}
