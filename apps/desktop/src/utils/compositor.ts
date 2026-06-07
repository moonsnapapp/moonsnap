/**
 * Compositor utilities for image export
 * 
 * Uses shared logic from useCompositorBackground hook to ensure
 * preview and export render identically.
 */

import type { CompositorSettings, CanvasBounds } from '../types';
import {
  calculateGradientPoints,
  calculateCoverSize,
  calculateCompositorDimensions,
} from '../hooks/useCompositorBackground';
import { getEditorShadowLayers } from './frameEffects';

interface CompositeOptions {
  settings: CompositorSettings;
  sourceCanvas: HTMLCanvasElement;
  canvasBounds?: CanvasBounds | null;
}

/**
 * Draw a rounded rectangle path
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draw background using shared gradient/cover calculations
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  settings: CompositorSettings,
  width: number,
  height: number,
  backgroundImage: HTMLImageElement | null
) {
  ctx.save();

  switch (settings.backgroundType) {
    case 'solid':
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, width, height);
      break;

    case 'gradient': {
      // Use shared gradient calculation
      const gradientPoints = calculateGradientPoints(
        settings.gradientAngle,
        width,
        height
      );

      const gradient = ctx.createLinearGradient(
        gradientPoints.x1,
        gradientPoints.y1,
        gradientPoints.x2,
        gradientPoints.y2
      );
      gradient.addColorStop(0, settings.gradientStart);
      gradient.addColorStop(1, settings.gradientEnd);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }

    case 'wallpaper':
    case 'image':
      if (backgroundImage) {
        // Use shared cover calculation
        const cover = calculateCoverSize(
          backgroundImage.width,
          backgroundImage.height,
          width,
          height
        );
        ctx.drawImage(
          backgroundImage,
          cover.offsetX,
          cover.offsetY,
          cover.width,
          cover.height
        );
      } else {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);
      }
      break;
  }

  ctx.restore();
}

/**
 * Draw shadow layers
 */
function drawShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  intensity: number
) {
  ctx.save();

  const shadowLayers = getEditorShadowLayers(intensity);

  shadowLayers.forEach((layer) => {
    ctx.shadowColor = `rgba(0, 0, 0, ${layer.opacity})`;
    ctx.shadowBlur = layer.blurPx;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = layer.offsetY;

    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Load an image from URL
 * Sets crossOrigin to allow canvas export (prevents tainted canvas error)
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Check if the source canvas has ANY transparent pixels.
 * Scales down to a small thumbnail for fast scanning.
 * When true, shadow/border-radius would create a floaty look.
 */
function hasAnyTransparency(canvas: HTMLCanvasElement): boolean {
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return false;

  // Scale down to small thumbnail and scan all pixels
  const size = 20;
  const thumb = document.createElement('canvas');
  thumb.width = size;
  thumb.height = size;
  const ctx = thumb.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(canvas, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Clean up a temporary canvas to release memory
 */
function cleanupCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Clean up an image element to release memory
 */
function cleanupImage(img: HTMLImageElement | null): void {
  if (!img) return;
  img.onload = null;
  img.onerror = null;
  img.src = '';
}

function applyCanvasBounds(
  sourceCanvas: HTMLCanvasElement,
  canvasBounds: CanvasBounds | null | undefined
) {
  if (!canvasBounds) {
    return { workingCanvas: sourceCanvas, croppedCanvas: null };
  }

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = canvasBounds.width;
  croppedCanvas.height = canvasBounds.height;
  const croppedCtx = croppedCanvas.getContext('2d');

  if (croppedCtx) {
    croppedCtx.clearRect(0, 0, canvasBounds.width, canvasBounds.height);
    croppedCtx.drawImage(
      sourceCanvas,
      canvasBounds.imageOffsetX,
      canvasBounds.imageOffsetY
    );
  }

  return { workingCanvas: croppedCanvas, croppedCanvas };
}

async function loadCompositorBackground(settings: CompositorSettings) {
  const backgroundImage = settings.backgroundImage;
  const usesImageBackground =
    settings.backgroundType === 'image' || settings.backgroundType === 'wallpaper';
  if (!usesImageBackground || !backgroundImage) return null;
  return loadImage(backgroundImage);
}

function drawCompositedContent({
  ctx,
  workingCanvas,
  settings,
  backgroundImage,
  transparentEdges,
  contentX,
  contentY,
}: {
  ctx: CanvasRenderingContext2D;
  workingCanvas: HTMLCanvasElement;
  settings: CompositorSettings;
  backgroundImage: HTMLImageElement | null;
  transparentEdges: boolean;
  contentX: number;
  contentY: number;
}) {
  const sourceWidth = workingCanvas.width;
  const sourceHeight = workingCanvas.height;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sourceWidth;
  tempCanvas.height = sourceHeight;
  const tempCtx = tempCanvas.getContext('2d');

  if (!tempCtx) {
    ctx.drawImage(workingCanvas, contentX, contentY);
    return tempCanvas;
  }

  if (settings.borderRadius > 0 && !transparentEdges) {
    drawRoundedRect(tempCtx, 0, 0, sourceWidth, sourceHeight, settings.borderRadius);
    tempCtx.clip();
  }
  if (!transparentEdges) {
    drawBackground(tempCtx, settings, sourceWidth, sourceHeight, backgroundImage);
  }

  tempCtx.drawImage(workingCanvas, 0, 0);
  ctx.drawImage(tempCanvas, contentX, contentY);
  return tempCanvas;
}

/**
 * Composite an image with compositor settings applied
 * Uses shared dimension calculations to match preview exactly
 * 
 * Note: This function properly cleans up intermediate canvases and images
 * to prevent memory leaks during frequent exports.
 */
export async function compositeImage(
  options: CompositeOptions
): Promise<HTMLCanvasElement> {
  const { settings, sourceCanvas, canvasBounds } = options;

  // Track intermediate resources for cleanup
  let croppedCanvas: HTMLCanvasElement | null = null;
  let tempCanvas: HTMLCanvasElement | null = null;
  let backgroundImage: HTMLImageElement | null = null;

  try {
    // Apply canvas bounds (crop/expand) if provided
    const boundedSource = applyCanvasBounds(sourceCanvas, canvasBounds);
    const workingCanvas = boundedSource.workingCanvas;
    croppedCanvas = boundedSource.croppedCanvas;

    // If compositor disabled, return canvas as-is
    if (!settings.enabled) {
      // Don't cleanup croppedCanvas if we're returning it
      if (workingCanvas === croppedCanvas) {
        croppedCanvas = null; // Prevent cleanup
      }
      return workingCanvas;
    }

    // If the source has any transparency, keep background but skip
    // shadow and border-radius to avoid the floaty look.
    const transparentEdges = hasAnyTransparency(workingCanvas);

    const sourceWidth = workingCanvas.width;
    const sourceHeight = workingCanvas.height;

    // Use shared dimension calculation (matches preview exactly)
    const dimensions = calculateCompositorDimensions(
      sourceWidth,
      sourceHeight,
      settings
    );

    // Create output canvas
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = dimensions.outputWidth;
    outputCanvas.height = dimensions.outputHeight;
    const ctx = outputCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Load background image if needed (for both 'image' and 'wallpaper' types)
    backgroundImage = await loadCompositorBackground(settings);

    // Draw full background
    drawBackground(
      ctx,
      settings,
      dimensions.outputWidth,
      dimensions.outputHeight,
      backgroundImage
    );

    // Draw shadow if intensity > 0 (skip when transparent edges — causes floaty look)
    if (settings.shadowIntensity > 0 && !transparentEdges) {
      drawShadow(
        ctx,
        dimensions.contentX,
        dimensions.contentY,
        sourceWidth,
        sourceHeight,
        settings.borderRadius,
        settings.shadowIntensity
      );
    }

    tempCanvas = drawCompositedContent({
      ctx,
      workingCanvas,
      settings,
      backgroundImage,
      transparentEdges,
      contentX: dimensions.contentX,
      contentY: dimensions.contentY,
    });

    return outputCanvas;
  } finally {
    // Clean up intermediate resources to prevent memory leaks
    cleanupCanvas(croppedCanvas);
    cleanupCanvas(tempCanvas);
    cleanupImage(backgroundImage);
  }
}
