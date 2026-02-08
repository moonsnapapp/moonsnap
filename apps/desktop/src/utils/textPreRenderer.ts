/**
 * Text rendering shared between preview and export.
 *
 * Canvas 2D fillText() uses the same system font rasterizer as CSS
 * (DirectWrite on Windows, CoreText on macOS), so glyphs are identical.
 * Using a single rendering function for both paths guarantees WYSIWYG.
 */

import { invoke } from '@tauri-apps/api/core';
import type { TextSegment } from '../types';

/** Base text height for size scaling. */
const BASE_TEXT_HEIGHT = 0.2;

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
}

/** Options for renderTextOnCanvas. */
export interface RenderTextOptions {
  content: string;
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  fontSize: number;
  color: string;
  sizeY: number;
}

type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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
 */
export function renderTextOnCanvas(
  ctx: RenderContext,
  opts: RenderTextOptions,
  canvasWidth: number,
  canvasHeight: number,
  referenceHeight: number,
): void {
  const sizeScale = Math.min(4, Math.max(0.25, opts.sizeY / BASE_TEXT_HEIGHT));
  const heightScale = referenceHeight / 1080;
  const fontSize = Math.max(1, opts.fontSize * sizeScale * heightScale);
  const lineHeight = fontSize * 1.2;

  const fontStyle = opts.italic ? 'italic ' : '';
  ctx.font = `${fontStyle}${opts.fontWeight} ${fontSize}px ${opts.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Measure font metrics for vertical positioning.
  // CSS line-height creates line boxes with half-leading above/below the
  // font content area. We replicate this using fontBoundingBoxAscent/Descent.
  const fontMetrics = ctx.measureText('Ag');
  const fontAscent = fontMetrics.fontBoundingBoxAscent;
  const fontDescent = fontMetrics.fontBoundingBoxDescent;
  const contentArea = fontAscent + fontDescent;
  const halfLeading = Math.max(0, (lineHeight - contentArea) / 2);
  const baselineInLine = halfLeading + fontAscent;

  const lines = wordWrap(ctx, opts.content, canvasWidth);

  // Vertically center the text block
  const totalTextHeight = lines.length * lineHeight;
  const startY = Math.max(0, (canvasHeight - totalTextHeight) / 2);

  // Text shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  ctx.fillStyle = opts.color;
  const centerX = canvasWidth / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], centerX, startY + i * lineHeight + baselineInLine);
  }
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

  renderTextOnCanvas(ctx, {
    content: segment.content,
    fontFamily: segment.fontFamily || 'sans-serif',
    fontWeight: segment.fontWeight || 700,
    italic: !!segment.italic,
    fontSize: segment.fontSize,
    color: segment.color || '#ffffff',
    sizeY: segment.size.y,
  }, contentWidth, contentHeight, exportHeight);

  ctx.restore();

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
        rgbaData: Array.from(rendered.rgbaData),
      }),
    );
  }

  await Promise.all(promises);
}
