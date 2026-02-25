/**
 * Shared offscreen text measurement utility used by text overlay + timeline.
 */
let measureCanvas: OffscreenCanvas | null = null;

export function measureTextSize(
  content: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  maxWidthPx: number
): { width: number; height: number } {
  if (!measureCanvas) {
    measureCanvas = new OffscreenCanvas(1, 1);
  }

  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return { width: 100, height: fontSize * 1.2 };

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(content);
  const textWidth = metrics.width;

  // Approximate line wrapping.
  const lines = Math.max(1, Math.ceil(textWidth / maxWidthPx));
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines * lineHeight;
  const effectiveWidth = lines > 1 ? maxWidthPx : textWidth;

  return { width: effectiveWidth, height: totalHeight };
}
