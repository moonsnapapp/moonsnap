/**
 * CursorOverlay - Renders cursor on top of video preview.
 *
 * Uses SVG as PRIMARY cursor rendering (when cursor_shape is detected).
 * Falls back to captured bitmap for custom/unknown cursors.
 *
 * This matches Cap's approach for consistent, resolution-independent cursors.
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import { CURSOR } from '../../constants';
import { useCursorInterpolation } from '../../hooks/useCursorInterpolation';
import { getZoomScaleAt } from '../../hooks/useZoomPreview';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../hooks/useTimelineSourceTime';
import { WINDOWS_CURSORS, DEFAULT_CURSOR, type CursorDefinition } from '../../constants/cursors';
import { editorLogger } from '../../utils/logger';
import { remapNormalizedPointThroughCrop } from '../../utils/cropCoordinateMapping';
import { resolveRecordingDimensions } from '../../utils/recordingDimensions';
import { getRoundedPreviewDimensions } from './previewDimensions';
import type { CursorRecording, CursorConfig, CursorImage, WindowsCursorShape, ZoomRegion, CropConfig } from '../../types';

// Default cursor config values
const DEFAULT_CURSOR_SCALE = 1.0;
const DEFAULT_CIRCLE_SIZE = 20; // Circle diameter in pixels at scale 1.0

// Cursor scaling constants - MUST match export (src-tauri/src/rendering/exporter/mod.rs)
const BASE_CURSOR_HEIGHT = 24.0; // Base cursor height in pixels
const REFERENCE_HEIGHT = 720.0;  // Reference video height for scaling

// Motion blur constants - must stay aligned with Rust compositor logic
const MOTION_BLUR_SAMPLES = 32;
const MOTION_BLUR_BASE_TRAIL_SAMPLES = 19; // Equivalent to prior 20-sample implementation.
const MOTION_BLUR_MIN_VELOCITY = 0.005;
const MOTION_BLUR_VELOCITY_RAMP_END = 0.03;
const MOTION_BLUR_MAX_TRAIL = 0.15;
const MOTION_BLUR_MAX_USER_AMOUNT = 0.15;
const MOTION_BLUR_VELOCITY_SCALE = 2.0;
const MAX_MOTION_PIXELS = 320.0;
const MIN_MOTION_THRESHOLD = 0.01;
const MOTION_BLUR_VELOCITY_SMOOTHING = 0.35;
const MOTION_BLUR_RESET_GAP_MS = 120;
const MOTION_BLUR_MAX_FRAME_JUMP = 0.18;

// SVG rasterization - now done at exact target size for lossless quality
// Cache key includes size to avoid re-rasterizing at the same size

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

interface MotionBlurSample {
  x: number;
  y: number;
  timeMs: number;
}

interface MotionBlurFrame {
  velocityX: number;
  velocityY: number;
  velocityMagnitude: number;
  velocityFactor: number;
  trailLength: number;
  shouldDrawMotionBlur: boolean;
  blurDirX: number;
  blurDirY: number;
}

interface PreparedCursorCanvas {
  ctx: CanvasRenderingContext2D;
  renderScale: number;
}

interface CursorSizing {
  exportSizeScale: number;
  finalCursorHeight: number;
  svgTargetExtent: number;
}

type DrawCursorSample = (x: number, y: number, opacity: number) => void;

interface CurrentCursorFrame {
  cursorId: string | null;
  shape: WindowsCursorShape | null;
}

interface CursorConfigValues {
  visible: boolean;
  cursorType: CursorConfig['cursorType'];
  scale: number;
  motionBlur: number;
}

function getCursorVisible(cursorConfig: CursorConfig | undefined): boolean {
  return cursorConfig?.visible ?? true;
}

function getCursorType(cursorConfig: CursorConfig | undefined): CursorConfig['cursorType'] {
  return cursorConfig?.cursorType ?? 'auto';
}

function getCursorScale(cursorConfig: CursorConfig | undefined): number {
  return cursorConfig?.scale ?? DEFAULT_CURSOR_SCALE;
}

function clampCursorMotionBlur(motionBlur: number | undefined): number {
  return Math.min(Math.max(motionBlur ?? 0, 0), MOTION_BLUR_MAX_USER_AMOUNT);
}

function getCursorConfigValues(cursorConfig: CursorConfig | undefined): CursorConfigValues {
  return {
    visible: getCursorVisible(cursorConfig),
    cursorType: getCursorType(cursorConfig),
    scale: getCursorScale(cursorConfig),
    motionBlur: clampCursorMotionBlur(cursorConfig?.motionBlur),
  };
}

function shouldUsePreviewZoomScale(currentZoomScale: number) {
  return currentZoomScale > 1.001;
}

function getCursorZoomScaleGetter(
  currentZoomScale: number,
  getPreviewZoomScale: () => number
) {
  return shouldUsePreviewZoomScale(currentZoomScale) ? getPreviewZoomScale : null;
}

function getCursorHideWhenIdle(cursorConfig: CursorConfig | undefined) {
  return cursorConfig?.hideWhenIdle ?? true;
}

function getCursorDampening(cursorConfig: CursorConfig | undefined) {
  return cursorConfig?.dampening ?? CURSOR.DAMPENING_DEFAULT;
}

function getCursorInterpolationOptions({
  cursorConfig,
  currentZoomScale,
  getPreviewZoomScale,
}: {
  cursorConfig: CursorConfig | undefined;
  currentZoomScale: number;
  getPreviewZoomScale: () => number;
}) {
  return {
    hideWhenIdle: getCursorHideWhenIdle(cursorConfig),
    dampening: getCursorDampening(cursorConfig),
    getZoomScale: getCursorZoomScaleGetter(currentZoomScale, getPreviewZoomScale),
  };
}

function hasCursorId(
  cursorData: ReturnType<ReturnType<typeof useCursorInterpolation>['getCursorAt']> | null,
): cursorData is NonNullable<typeof cursorData> & { cursorId: string } {
  return Boolean(cursorData?.cursorId);
}

function getCurrentCursorFrame({
  cursorData,
  cursorImages,
  fallbackCursorShape,
}: {
  cursorData: ReturnType<ReturnType<typeof useCursorInterpolation>['getCursorAt']> | null;
  cursorImages: Record<string, CursorImage | undefined>;
  fallbackCursorShape: WindowsCursorShape;
}): CurrentCursorFrame {
  if (!hasCursorId(cursorData)) {
    return { cursorId: null, shape: null };
  }

  const cursorId = cursorData.cursorId;
  const cursorImageData = cursorImages[cursorId];
  return {
    cursorId,
    shape: cursorImageData?.cursorShape ?? fallbackCursorShape,
  };
}

function shouldRenderCursorOverlay(hasCursorData: boolean, visible: boolean) {
  return hasCursorData && visible;
}

function getCursorCanvasStyle(
  roundedDisplayWidth: number,
  roundedDisplayHeight: number
): React.CSSProperties {
  return {
    zIndex: 15,
    width: `${roundedDisplayWidth}px`,
    height: `${roundedDisplayHeight}px`,
  };
}

function clearCursorCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);
}

function prepareCursorCanvas(
  canvas: HTMLCanvasElement,
  renderWidth: number,
  renderHeight: number
): PreparedCursorCanvas | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const renderScale = getCursorCanvasRenderScale();
  const { targetWidth, targetHeight } = getCursorCanvasTargetSize(
    renderWidth,
    renderHeight,
    renderScale
  );

  resizeCursorCanvasIfNeeded(canvas, targetWidth, targetHeight);
  prepareCursorCanvasContext(ctx, renderScale);

  return { ctx, renderScale };
}

function getCursorCanvasRenderScale() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function getCursorCanvasTargetSize(
  renderWidth: number,
  renderHeight: number,
  renderScale: number,
) {
  return {
    targetWidth: Math.max(1, Math.round(renderWidth * renderScale)),
    targetHeight: Math.max(1, Math.round(renderHeight * renderScale)),
  };
}

function resizeCursorCanvasIfNeeded(
  canvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
) {
  if (canvas.width === targetWidth && canvas.height === targetHeight) return;

  canvas.width = targetWidth;
  canvas.height = targetHeight;
}

function prepareCursorCanvasContext(ctx: CanvasRenderingContext2D, renderScale: number) {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

function getCursorSizing(
  compositionRenderHeight: number,
  scale: number,
  clickAnimationScale: number,
  renderScale: number
): CursorSizing {
  const exportSizeScale = compositionRenderHeight / REFERENCE_HEIGHT;
  const exportCursorHeight = Math.min(
    Math.max(BASE_CURSOR_HEIGHT * exportSizeScale * scale, 16),
    256
  );

  return {
    exportSizeScale,
    finalCursorHeight: exportCursorHeight,
    svgTargetExtent: Math.round(exportCursorHeight * clickAnimationScale * renderScale),
  };
}

function drawMotionBlurTrail({
  blurFrame,
  motionBlur,
  cursorOpacity,
  pixelX,
  pixelY,
  renderWidth,
  renderHeight,
  drawSample,
}: {
  blurFrame: MotionBlurFrame;
  motionBlur: number;
  cursorOpacity: number;
  pixelX: number;
  pixelY: number;
  renderWidth: number;
  renderHeight: number;
  drawSample: DrawCursorSample;
}) {
  if (blurFrame.shouldDrawMotionBlur) {
    const trailSampleCount = Math.max(1, MOTION_BLUR_SAMPLES - 1);
    const weightNormalization = MOTION_BLUR_BASE_TRAIL_SAMPLES / trailSampleCount;
    for (let i = MOTION_BLUR_SAMPLES - 1; i >= 1; i -= 1) {
      const t = i / (MOTION_BLUR_SAMPLES - 1);
      const easedT = smoothstep(0, 1, t);
      const offsetX = blurFrame.blurDirX * blurFrame.trailLength * easedT;
      const offsetY = blurFrame.blurDirY * blurFrame.trailLength * easedT;
      const sampleX = pixelX + offsetX * renderWidth;
      const sampleY = pixelY + offsetY * renderHeight;
      const weight =
        (1 - t * 0.75) * motionBlur * blurFrame.velocityFactor * weightNormalization;
      if (weight > 0) {
        drawSample(sampleX, sampleY, weight * cursorOpacity);
      }
    }
  }

  drawSample(pixelX, pixelY, cursorOpacity);
}

function drawCircleCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opacity: number,
  exportSizeScale: number,
  scale: number
) {
  if (opacity <= 0) return;

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = opacity;
  const radius = (DEFAULT_CIRCLE_SIZE * exportSizeScale * scale) / 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = previousAlpha;
}

function drawSvgCursor(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  def: CursorDefinition,
  x: number,
  y: number,
  opacity: number,
  renderScale: number
) {
  if (opacity <= 0) return;

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = opacity;
  const drawWidth = img.width / renderScale;
  const drawHeight = img.height / renderScale;
  ctx.drawImage(
    img,
    x - drawWidth * def.hotspotX,
    y - drawHeight * def.hotspotY,
    drawWidth,
    drawHeight
  );
  ctx.globalAlpha = previousAlpha;
}

function drawBitmapCursor(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  hotspotX: number,
  hotspotY: number,
  x: number,
  y: number,
  opacity: number,
  finalCursorHeight: number,
  clickAnimationScale: number
) {
  if (opacity <= 0) return;

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = opacity;
  const bitmapScale = (finalCursorHeight / img.height) * clickAnimationScale;
  const drawWidth = img.width * bitmapScale;
  const drawHeight = img.height * bitmapScale;
  ctx.drawImage(
    img,
    x - hotspotX * bitmapScale,
    y - hotspotY * bitmapScale,
    drawWidth,
    drawHeight
  );
  ctx.globalAlpha = previousAlpha;
}

function drawCursorWithTrail({
  ctx,
  blurFrame,
  motionBlur,
  cursorOpacity,
  pixelX,
  pixelY,
  renderWidth,
  renderHeight,
  drawSample,
}: {
  ctx: CanvasRenderingContext2D;
  blurFrame: MotionBlurFrame;
  motionBlur: number;
  cursorOpacity: number;
  pixelX: number;
  pixelY: number;
  renderWidth: number;
  renderHeight: number;
  drawSample: DrawCursorSample;
}) {
  clearCursorCanvas(ctx, renderWidth, renderHeight);
  drawMotionBlurTrail({
    blurFrame,
    motionBlur,
    cursorOpacity,
    pixelX,
    pixelY,
    renderWidth,
    renderHeight,
    drawSample,
  });
}

interface CursorDrawSampleParams {
  ctx: CanvasRenderingContext2D;
  cursorType: CursorConfig['cursorType'] | 'auto';
  currentCursor: { cursorId: string | null; shape: WindowsCursorShape | null };
  cursorImages: Record<string, CursorImage | undefined>;
  triggerUpdate: () => void;
  sizing: CursorSizing;
  renderScale: number;
  clickAnimationScale: number;
  scale: number;
}

function getCircleCursorDrawSample({
  ctx,
  cursorType,
  sizing,
  scale,
}: CursorDrawSampleParams): DrawCursorSample | null {
  if (cursorType !== 'circle') return null;

  return (x, y, opacity) =>
    drawCircleCursor(ctx, x, y, opacity, sizing.exportSizeScale, scale);
}

function getSvgCursorDrawSample({
  ctx,
  currentCursor,
  triggerUpdate,
  sizing,
  renderScale,
}: CursorDrawSampleParams): DrawCursorSample | null {
  const { shape } = currentCursor;
  const definition = getWindowsCursorDefinition(shape);
  if (!shape || !definition) return null;

  const svgImage = getSvgCursorAtSize(shape, sizing.svgTargetExtent, triggerUpdate);
  if (!svgImage) return null;

  return (x, y, opacity) =>
    drawSvgCursor(ctx, svgImage, definition, x, y, opacity, renderScale);
}

function getWindowsCursorDefinition(shape: WindowsCursorShape | null | undefined) {
  return shape ? WINDOWS_CURSORS[shape] : undefined;
}

function getBitmapCursorDrawSample({
  ctx,
  currentCursor,
  cursorImages,
  sizing,
  clickAnimationScale,
}: CursorDrawSampleParams): DrawCursorSample | null {
  const bitmapCursor = getBitmapCursorRenderData(currentCursor.cursorId, cursorImages);
  if (!bitmapCursor) return null;

  return (x, y, opacity) =>
    drawBitmapCursor(
      ctx,
      bitmapCursor.image,
      bitmapCursor.data.hotspotX,
      bitmapCursor.data.hotspotY,
      x,
      y,
      opacity,
      sizing.finalCursorHeight,
      clickAnimationScale
    );
}

function getBitmapCursorRenderData(
  cursorId: string | null,
  cursorImages: Record<string, CursorImage | undefined>
) {
  if (!cursorId) return null;

  const data = cursorImages[cursorId];
  const image = cursorImageCache.get(cursorId);
  return data && image ? { data, image } : null;
}

function getDefaultCursorDrawSample({
  ctx,
  triggerUpdate,
  sizing,
  renderScale,
}: CursorDrawSampleParams): DrawCursorSample | null {
  const defaultImage = getSvgCursorAtSize('arrow', sizing.svgTargetExtent, triggerUpdate);
  if (!defaultImage) return null;

  return (x, y, opacity) =>
    drawSvgCursor(ctx, defaultImage, DEFAULT_CURSOR, x, y, opacity, renderScale);
}

function getCursorDrawSample(params: CursorDrawSampleParams): DrawCursorSample | null {
  return (
    getCircleCursorDrawSample(params) ??
    getSvgCursorDrawSample(params) ??
    getBitmapCursorDrawSample(params) ??
    getDefaultCursorDrawSample(params)
  );
}

function drawCursorFrame({
  ctx,
  cursorType,
  currentCursor,
  cursorImages,
  triggerUpdate,
  sizing,
  renderScale,
  clickAnimationScale,
  scale,
  blurFrame,
  motionBlur,
  cursorOpacity,
  pixelX,
  pixelY,
  renderWidth,
  renderHeight,
}: {
  ctx: CanvasRenderingContext2D;
  cursorType: CursorConfig['cursorType'] | 'auto';
  currentCursor: { cursorId: string | null; shape: WindowsCursorShape | null };
  cursorImages: Record<string, CursorImage | undefined>;
  triggerUpdate: () => void;
  sizing: CursorSizing;
  renderScale: number;
  clickAnimationScale: number;
  scale: number;
  blurFrame: MotionBlurFrame;
  motionBlur: number;
  cursorOpacity: number;
  pixelX: number;
  pixelY: number;
  renderWidth: number;
  renderHeight: number;
}): boolean {
  const drawSample = getCursorDrawSample({
    ctx,
    cursorType,
    currentCursor,
    cursorImages,
    triggerUpdate,
    sizing,
    renderScale,
    clickAnimationScale,
    scale,
  });

  if (!drawSample) {
    return false;
  }

  drawCursorWithTrail({
    ctx,
    blurFrame,
    motionBlur,
    cursorOpacity,
    pixelX,
    pixelY,
    renderWidth,
    renderHeight,
    drawSample,
  });
  return true;
}

function getCursorRenderPoint({
  cursorX,
  cursorY,
  cursorRecording,
  videoWidth,
  videoHeight,
  cropConfig,
  renderWidth,
  renderHeight,
}: {
  cursorX: number;
  cursorY: number;
  cursorRecording: CursorRecording | null | undefined;
  videoWidth: number;
  videoHeight: number;
  cropConfig?: CropConfig;
  renderWidth: number;
  renderHeight: number;
}) {
  const { width: recordingWidth, height: recordingHeight } = resolveRecordingDimensions(
    cursorRecording,
    videoWidth,
    videoHeight
  );
  const remappedCursor = remapNormalizedPointThroughCrop(
    { x: cursorX, y: cursorY },
    recordingWidth,
    recordingHeight,
    cropConfig
  );

  if (!remappedCursor.inVisibleBounds) return null;

  return {
    x: remappedCursor.point.x * renderWidth,
    y: remappedCursor.point.y * renderHeight,
  };
}

function getNormalizedMotionJump(
  deltaX: number,
  deltaY: number,
  renderWidth: number,
  renderHeight: number
): number {
  return Math.sqrt((deltaX / renderWidth) ** 2 + (deltaY / renderHeight) ** 2);
}

function canUseMotionDelta(deltaMs: number, normalizedJump: number): boolean {
  return (
    deltaMs > 0 &&
    deltaMs <= MOTION_BLUR_RESET_GAP_MS &&
    normalizedJump <= MOTION_BLUR_MAX_FRAME_JUMP
  );
}

function getSmoothedMotionVelocity({
  motionBlur,
  previousSample,
  previousVelocity,
  pixelX,
  pixelY,
  currentTimeMs,
  renderWidth,
  renderHeight,
}: {
  motionBlur: number;
  previousSample: MotionBlurSample | null;
  previousVelocity: { x: number; y: number };
  pixelX: number;
  pixelY: number;
  currentTimeMs: number;
  renderWidth: number;
  renderHeight: number;
}): { x: number; y: number } {
  if (motionBlur <= 0 || !previousSample) {
    return { x: 0, y: 0 };
  }

  const deltaMs = currentTimeMs - previousSample.timeMs;
  const deltaX = pixelX - previousSample.x;
  const deltaY = pixelY - previousSample.y;
  const normalizedJump = getNormalizedMotionJump(deltaX, deltaY, renderWidth, renderHeight);
  if (!canUseMotionDelta(deltaMs, normalizedJump)) {
    return { x: 0, y: 0 };
  }

  const dtSeconds = deltaMs / 1000;
  const instantVelocityX = (deltaX / renderWidth) / dtSeconds;
  const instantVelocityY = (deltaY / renderHeight) / dtSeconds;

  return {
    x:
      previousVelocity.x +
      (instantVelocityX - previousVelocity.x) * MOTION_BLUR_VELOCITY_SMOOTHING,
    y:
      previousVelocity.y +
      (instantVelocityY - previousVelocity.y) * MOTION_BLUR_VELOCITY_SMOOTHING,
  };
}

function getMotionTrailLength({
  motionBlur,
  velocityMagnitude,
  velocityFactor,
  frameDiagonal,
}: {
  motionBlur: number;
  velocityMagnitude: number;
  velocityFactor: number;
  frameDiagonal: number;
}): number {
  const motionPixels = velocityMagnitude * frameDiagonal * MOTION_BLUR_VELOCITY_SCALE;
  const clampedMotion = Math.min(motionPixels, MAX_MOTION_PIXELS);
  return Math.min(clampedMotion / frameDiagonal, MOTION_BLUR_MAX_TRAIL) * motionBlur * velocityFactor;
}

function shouldDrawMotionBlurTrail(
  motionBlur: number,
  velocityMagnitude: number,
  velocityFactor: number,
  trailLength: number
): boolean {
  return (
    motionBlur > 0 &&
    velocityMagnitude >= MOTION_BLUR_MIN_VELOCITY &&
    velocityFactor > 0 &&
    trailLength >= MIN_MOTION_THRESHOLD
  );
}

function getMotionBlurFrame({
  motionBlur,
  previousSample,
  previousVelocity,
  pixelX,
  pixelY,
  currentTimeMs,
  renderWidth,
  renderHeight,
}: {
  motionBlur: number;
  previousSample: MotionBlurSample | null;
  previousVelocity: { x: number; y: number };
  pixelX: number;
  pixelY: number;
  currentTimeMs: number;
  renderWidth: number;
  renderHeight: number;
}): MotionBlurFrame {
  const velocity = getSmoothedMotionVelocity({
    motionBlur,
    previousSample,
    previousVelocity,
    pixelX,
    pixelY,
    currentTimeMs,
    renderWidth,
    renderHeight,
  });

  const velocityMagnitude = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
  const frameDiagonal = Math.sqrt(renderWidth * renderWidth + renderHeight * renderHeight);
  const velocityFactor = smoothstep(
    MOTION_BLUR_MIN_VELOCITY,
    MOTION_BLUR_VELOCITY_RAMP_END,
    velocityMagnitude
  );
  const trailLength = getMotionTrailLength({
    motionBlur,
    velocityMagnitude,
    velocityFactor,
    frameDiagonal,
  });
  const shouldDrawMotionBlur = shouldDrawMotionBlurTrail(
    motionBlur,
    velocityMagnitude,
    velocityFactor,
    trailLength
  );

  return {
    velocityX: velocity.x,
    velocityY: velocity.y,
    velocityMagnitude,
    velocityFactor,
    trailLength,
    shouldDrawMotionBlur,
    blurDirX: shouldDrawMotionBlur ? -velocity.x / velocityMagnitude : 0,
    blurDirY: shouldDrawMotionBlur ? -velocity.y / velocityMagnitude : 0,
  };
}

interface CursorOverlayProps {
  cursorRecording: CursorRecording | null | undefined;
  cursorConfig: CursorConfig | undefined;
  /** Frame width in export/master coordinates */
  renderWidth: number;
  /** Frame height in export/master coordinates */
  renderHeight: number;
  /** Frame width in preview/display coordinates */
  displayWidth: number;
  /** Frame height in preview/display coordinates */
  displayHeight: number;
  /** Composition height in export/master coordinates (used for cursor size parity) */
  compositionRenderHeight: number;
  /** Original output video width (source coordinates for crop transform) */
  videoWidth: number;
  /** Original output video height (source coordinates for crop transform) */
  videoHeight: number;
  /** Zoom regions for applying the same transform as the video */
  zoomRegions?: ZoomRegion[];
  /** Background padding in pixels - needed for zoom transform alignment */
  backgroundPadding?: number;
  /** Corner rounding in pixels - needed for zoom transform alignment */
  rounding?: number;
  /** Crop configuration - cursor positions need to be transformed when crop is applied */
  cropConfig?: CropConfig;
}

/**
 * Global cache for decoded cursor images (both SVGs and bitmaps).
 * SVGs are cached by shape + target height for lossless rendering at any size.
 * Persists across component re-renders.
 */
const cursorImageCache = new Map<string, HTMLImageElement>();

/** Cache for raw SVG text to avoid re-fetching */
const svgTextCache = new Map<WindowsCursorShape, string>();

/** Pending SVG fetch promises to avoid duplicate fetches */
const svgFetchPromises = new Map<WindowsCursorShape, Promise<string>>();

/**
 * Generate cache key for SVG cursors at a specific size.
 */
function svgCacheKey(shape: WindowsCursorShape, targetExtent?: number): string {
  return targetExtent ? `__svg_${shape}_${targetExtent}__` : `__svg_${shape}__`;
}

/**
 * Fetch SVG text (with caching and deduplication).
 */
async function fetchSvgText(shape: WindowsCursorShape): Promise<string | null> {
  // Return cached text if available
  const cached = svgTextCache.get(shape);
  if (cached) return cached;

  // Return pending promise if already fetching
  const pending = svgFetchPromises.get(shape);
  if (pending) return pending;

  const definition = WINDOWS_CURSORS[shape];
  if (!definition) return null;

  // Start fetch and cache the promise
  const fetchPromise = fetch(definition.svg)
    .then(response => response.text())
    .then(text => {
      svgTextCache.set(shape, text);
      svgFetchPromises.delete(shape);
      return text;
    })
    .catch(err => {
      editorLogger.warn(`Failed to fetch SVG cursor ${shape}:`, err);
      svgFetchPromises.delete(shape);
      return null;
    });

  svgFetchPromises.set(shape, fetchPromise as Promise<string>);
  return fetchPromise;
}

function queueSvgTextLoad(shape: WindowsCursorShape, onLoad: () => void): void {
  fetchSvgText(shape).then(() => onLoad());
}

function readSvgDimension(svgElement: SVGSVGElement, attribute: 'width' | 'height'): number {
  const dimension = parseFloat(svgElement.getAttribute(attribute) ?? '24');
  return Number.isFinite(dimension) ? dimension : 24;
}

function resizeSvgElement(svgElement: SVGSVGElement, targetExtent: number): void {
  const origWidth = readSvgDimension(svgElement, 'width');
  const origHeight = readSvgDimension(svgElement, 'height');
  const dominantDimension = Math.max(origWidth, origHeight, 1);
  const scale = targetExtent / dominantDimension;
  const newWidth = Math.max(1, Math.round(origWidth * scale));
  const newHeight = Math.max(1, Math.round(origHeight * scale));

  svgElement.setAttribute('width', String(newWidth));
  svgElement.setAttribute('height', String(newHeight));
}

function rasterizeSvgDataUrl(svgText: string, targetExtent: number): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgElement = doc.querySelector('svg');

  if (!svgElement) return null;

  resizeSvgElement(svgElement, targetExtent);

  const serializer = new XMLSerializer();
  const modifiedSvg = serializer.serializeToString(doc);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(modifiedSvg)}`;
}

function loadSvgCursorImage({
  key,
  shape,
  targetExtent,
  dataUrl,
  onLoad,
}: {
  key: string;
  shape: WindowsCursorShape;
  targetExtent: number;
  dataUrl: string;
  onLoad: () => void;
}): void {
  const img = new Image();
  img.onload = () => {
    cursorImageCache.set(key, img);
    onLoad();
  };
  img.onerror = () => {
    editorLogger.warn(`Failed to rasterize SVG cursor ${shape} at ${targetExtent}px`);
  };
  img.src = dataUrl;
}

/**
 * Rasterize SVG at exact target extent for lossless quality.
 * Returns cached image if already rasterized at this size.
 */
function getSvgCursorAtSize(
  shape: WindowsCursorShape,
  targetExtent: number,
  onLoad: () => void
): HTMLImageElement | null {
  const key = svgCacheKey(shape, targetExtent);
  const cached = cursorImageCache.get(key);
  if (cached) return cached;

  const svgText = getSvgCursorRasterizationText(shape, onLoad);
  if (!svgText) return null;

  requestSvgCursorRasterization({ key, shape, targetExtent, svgText, onLoad });

  return null; // Image loading async, will trigger onLoad when ready
}

function hasWindowsCursorDefinition(shape: WindowsCursorShape) {
  return Boolean(WINDOWS_CURSORS[shape]);
}

function getSvgCursorRasterizationText(shape: WindowsCursorShape, onLoad: () => void) {
  if (!hasWindowsCursorDefinition(shape)) return null;

  const svgText = svgTextCache.get(shape);
  if (!svgText) {
    queueSvgTextLoad(shape, onLoad);
  }
  return svgText;
}

function requestSvgCursorRasterization({
  key,
  shape,
  targetExtent,
  svgText,
  onLoad,
}: {
  key: string;
  shape: WindowsCursorShape;
  targetExtent: number;
  svgText: string;
  onLoad: () => void;
}) {
  const dataUrl = rasterizeSvgDataUrl(svgText, targetExtent);
  if (!dataUrl) return;

  loadSvgCursorImage({ key, shape, targetExtent, dataUrl, onLoad });
}

/**
 * Preload SVG text for a shape (doesn't rasterize yet).
 */
function preloadSvgCursor(shape: WindowsCursorShape, onLoad: () => void): void {
  fetchSvgText(shape).then(() => onLoad());
}

/**
 * Load a cursor bitmap from base64 data.
 */
function loadBitmapCursor(
  id: string,
  image: CursorImage,
  onLoad: () => void
): HTMLImageElement | null {
  const cached = cursorImageCache.get(id);
  if (cached) {
    return cached;
  }

  const img = new Image();
  img.onload = () => {
    cursorImageCache.set(id, img);
    onLoad();
  };
  img.onerror = () => {
    editorLogger.warn(`Failed to load bitmap cursor: ${id}`);
  };
  img.src = `data:image/png;base64,${image.dataBase64}`;

  return null;
}

function clearBitmapCursorCache(): void {
  for (const key of cursorImageCache.keys()) {
    if (!key.startsWith('__svg_')) {
      cursorImageCache.delete(key);
    }
  }
}

function getCursorShapesToPreload(
  cursorImages: Record<string, CursorImage | undefined>
): Set<WindowsCursorShape> {
  const shapesInRecording = new Set<WindowsCursorShape>();

  for (const image of Object.values(cursorImages)) {
    if (image?.cursorShape) {
      shapesInRecording.add(image.cursorShape);
    }
  }

  return shapesInRecording;
}

function preloadSvgCursors(
  cursorImages: Record<string, CursorImage | undefined>,
  triggerUpdate: () => void
): void {
  preloadSvgCursor('arrow', triggerUpdate);

  for (const shape of getCursorShapesToPreload(cursorImages)) {
    preloadSvgCursor(shape, triggerUpdate);
  }
}

function preloadBitmapCursors(
  cursorImages: Record<string, CursorImage | undefined>,
  triggerUpdate: () => void
): void {
  for (const [id, image] of Object.entries(cursorImages)) {
    if (shouldPreloadBitmapCursor(id, image)) {
      loadBitmapCursor(id, image, triggerUpdate);
    }
  }
}

function shouldPreloadBitmapCursor(id: string, image: CursorImage | undefined): image is CursorImage {
  return Boolean(image && !image.cursorShape && !cursorImageCache.has(id));
}

function useCursorImagePreloading(
  cursorImages: Record<string, CursorImage | undefined>,
  triggerUpdate: () => void
) {
  useEffect(() => {
    clearBitmapCursorCache();
    preloadSvgCursors(cursorImages, triggerUpdate);
    preloadBitmapCursors(cursorImages, triggerUpdate);
  }, [cursorImages, triggerUpdate]);
}

interface CursorFrameRenderParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  motionBlurSampleRef: MutableRefObject<MotionBlurSample | null>;
  motionBlurVelocityRef: MutableRefObject<{ x: number; y: number }>;
  resetMotionBlurState: () => void;
  cursorData: { x: number; y: number; opacity?: number; scale?: number } | null;
  currentCursor: CurrentCursorFrame;
  cursorOpacity: number;
  visible: boolean;
  cursorType: CursorConfig['cursorType'] | 'auto';
  scale: number;
  motionBlur: number;
  roundedRenderWidth: number;
  roundedRenderHeight: number;
  compositionRenderHeight: number;
  videoWidth: number;
  actualVideoHeight: number;
  cursorImages: Record<string, CursorImage | undefined>;
  triggerUpdate: () => void;
  currentTimeMs: number;
  cursorRecording: CursorRecording | null | undefined;
  cropConfig?: CropConfig;
  imageLoadCounter: number;
}

interface CursorFrameCanvas {
  ctx: CanvasRenderingContext2D;
  renderScale: number;
}

function getCursorFrameCanvas({
  canvasRef,
  roundedRenderWidth,
  roundedRenderHeight,
}: Pick<
  CursorFrameRenderParams,
  'canvasRef' | 'roundedRenderWidth' | 'roundedRenderHeight'
>): CursorFrameCanvas | null {
  const canvas = canvasRef.current;
  if (!canvas) return null;

  return prepareCursorCanvas(
    canvas,
    roundedRenderWidth,
    roundedRenderHeight
  );
}

function shouldRenderCursorFrame(
  cursorData: CursorFrameRenderParams['cursorData'],
  visible: boolean,
  cursorOpacity: number
): cursorData is NonNullable<CursorFrameRenderParams['cursorData']> {
  return Boolean(cursorData && visible && cursorOpacity > 0);
}

function resetAndClearCursorFrame({
  ctx,
  roundedRenderWidth,
  roundedRenderHeight,
  resetMotionBlurState,
}: Pick<CursorFrameRenderParams, 'roundedRenderWidth' | 'roundedRenderHeight' | 'resetMotionBlurState'> & {
  ctx: CanvasRenderingContext2D;
}) {
  resetMotionBlurState();
  clearCursorCanvas(ctx, roundedRenderWidth, roundedRenderHeight);
}

function resetInvalidCursorFrame(
  params: Pick<CursorFrameRenderParams, 'roundedRenderWidth' | 'roundedRenderHeight' | 'resetMotionBlurState'> & {
    ctx: CanvasRenderingContext2D;
  }
) {
  resetAndClearCursorFrame(params);
}

function getRenderableCursorPoint({
  cursorData,
  cursorRecording,
  videoWidth,
  actualVideoHeight,
  cropConfig,
  roundedRenderWidth,
  roundedRenderHeight,
}: Pick<
  CursorFrameRenderParams,
  'cursorData' | 'cursorRecording' | 'videoWidth' | 'actualVideoHeight' | 'cropConfig' | 'roundedRenderWidth' | 'roundedRenderHeight'
>) {
  if (!cursorData) return null;

  return getCursorRenderPoint({
    cursorX: cursorData.x,
    cursorY: cursorData.y,
    cursorRecording,
    videoWidth,
    videoHeight: actualVideoHeight,
    cropConfig,
    renderWidth: roundedRenderWidth,
    renderHeight: roundedRenderHeight,
  });
}

function updateMotionBlurRefs({
  motionBlurSampleRef,
  motionBlurVelocityRef,
  blurFrame,
  pixelX,
  pixelY,
  currentTimeMs,
}: {
  motionBlurSampleRef: MutableRefObject<MotionBlurSample | null>;
  motionBlurVelocityRef: MutableRefObject<{ x: number; y: number }>;
  blurFrame: MotionBlurFrame;
  pixelX: number;
  pixelY: number;
  currentTimeMs: number;
}) {
  motionBlurVelocityRef.current = {
    x: blurFrame.velocityX,
    y: blurFrame.velocityY,
  };
  motionBlurSampleRef.current = {
    x: pixelX,
    y: pixelY,
    timeMs: currentTimeMs,
  };
}

interface CursorFrameRenderContext {
  ctx: CanvasRenderingContext2D;
  renderScale: number;
  cursorData: NonNullable<CursorFrameRenderParams['cursorData']>;
  cursorPoint: { x: number; y: number };
}

function getCursorFrameRenderContext({
  preparedCanvas,
  cursorData,
  visible,
  cursorOpacity,
  cursorRecording,
  videoWidth,
  actualVideoHeight,
  cropConfig,
  roundedRenderWidth,
  roundedRenderHeight,
  resetMotionBlurState,
}: Pick<
  CursorFrameRenderParams,
  'cursorData' | 'visible' | 'cursorOpacity' | 'cursorRecording' | 'videoWidth' | 'actualVideoHeight' | 'cropConfig' | 'roundedRenderWidth' | 'roundedRenderHeight' | 'resetMotionBlurState'
> & {
  preparedCanvas: PreparedCursorCanvas;
}): CursorFrameRenderContext | null {
  const { ctx, renderScale } = preparedCanvas;

  if (!shouldRenderCursorFrame(cursorData, visible, cursorOpacity)) {
    resetInvalidCursorFrame({ ctx, roundedRenderWidth, roundedRenderHeight, resetMotionBlurState });
    return null;
  }

  const cursorPoint = getRenderableCursorPoint({
    cursorData,
    cursorRecording,
    videoWidth,
    actualVideoHeight,
    cropConfig,
    roundedRenderWidth,
    roundedRenderHeight,
  });

  if (!cursorPoint) {
    resetInvalidCursorFrame({ ctx, roundedRenderWidth, roundedRenderHeight, resetMotionBlurState });
    return null;
  }

  return { ctx, renderScale, cursorData, cursorPoint };
}

function renderCursorOverlayFrame({
  canvasRef,
  motionBlurSampleRef,
  motionBlurVelocityRef,
  resetMotionBlurState,
  cursorData,
  currentCursor,
  cursorOpacity,
  visible,
  cursorType,
  scale,
  motionBlur,
  roundedRenderWidth,
  roundedRenderHeight,
  compositionRenderHeight,
  videoWidth,
  actualVideoHeight,
  cursorImages,
  triggerUpdate,
  currentTimeMs,
  cursorRecording,
  cropConfig,
}: CursorFrameRenderParams) {
  const preparedCanvas = getCursorFrameCanvas({
    canvasRef,
    roundedRenderWidth,
    roundedRenderHeight,
  });
  if (!preparedCanvas) return;

  const renderContext = getCursorFrameRenderContext({
    preparedCanvas,
    cursorData,
    visible,
    cursorOpacity,
    cursorRecording,
    videoWidth,
    actualVideoHeight,
    cropConfig,
    roundedRenderWidth,
    roundedRenderHeight,
    resetMotionBlurState,
  });
  if (!renderContext) return;

  const {
    ctx,
    renderScale,
    cursorData: renderCursorData,
    cursorPoint,
  } = renderContext;

  const clickAnimationScale = renderCursorData.scale ?? 1.0;
  const sizing = getCursorSizing(
    compositionRenderHeight,
    scale,
    clickAnimationScale,
    renderScale
  );
  const blurFrame = getMotionBlurFrame({
    motionBlur,
    previousSample: motionBlurSampleRef.current,
    previousVelocity: motionBlurVelocityRef.current,
    pixelX: cursorPoint.x,
    pixelY: cursorPoint.y,
    currentTimeMs,
    renderWidth: roundedRenderWidth,
    renderHeight: roundedRenderHeight,
  });

  updateMotionBlurRefs({
    motionBlurSampleRef,
    motionBlurVelocityRef,
    blurFrame,
    pixelX: cursorPoint.x,
    pixelY: cursorPoint.y,
    currentTimeMs,
  });

  drawCursorFrame({
    ctx,
    cursorType,
    currentCursor,
    cursorImages,
    triggerUpdate,
    sizing,
    renderScale,
    clickAnimationScale,
    scale,
    blurFrame,
    motionBlur,
    cursorOpacity,
    pixelX: cursorPoint.x,
    pixelY: cursorPoint.y,
    renderWidth: roundedRenderWidth,
    renderHeight: roundedRenderHeight,
  });
}

function useCursorCanvasRenderer(params: CursorFrameRenderParams) {
  useEffect(() => {
    renderCursorOverlayFrame(params);
  }, [params]);
}

function useCursorOverlayRenderState({
  cursorData,
  cursorImages,
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
}: {
  cursorData: ReturnType<ReturnType<typeof useCursorInterpolation>['getCursorAt']> | null;
  cursorImages: Record<string, CursorImage | undefined>;
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
}) {
  const fallbackCursorShape: WindowsCursorShape = 'arrow';
  const dimensions = getRoundedPreviewDimensions(renderWidth, renderHeight, displayWidth, displayHeight);
  const currentCursor = useMemo(
    () => getCurrentCursorFrame({ cursorData, cursorImages, fallbackCursorShape }),
    [cursorData, cursorImages, fallbackCursorShape]
  );

  return { ...dimensions, currentCursor };
}

function useCursorOverlayTiming(zoomRegions: ZoomRegion[] | undefined) {
  const currentTimeMs = usePreviewOrPlaybackTime();
  const toSourceTime = useTimelineToSourceTime();
  const sourceTimeMs = useMemo(
    () => toSourceTime(currentTimeMs),
    [currentTimeMs, toSourceTime]
  );
  const currentZoomScale = useMemo(
    () => getZoomScaleAt(zoomRegions, currentTimeMs),
    [zoomRegions, currentTimeMs]
  );

  return { currentTimeMs, sourceTimeMs, currentZoomScale };
}

function useCursorOverlayImageUpdate() {
  const [imageLoadCounter, forceUpdate] = useState(0);
  const triggerUpdate = useCallback(() => forceUpdate((n) => n + 1), []);

  return { imageLoadCounter, triggerUpdate };
}

function useCursorCanvasRenderParams({
  canvasRef,
  motionBlurSampleRef,
  motionBlurVelocityRef,
  resetMotionBlurState,
  cursorData,
  currentCursor,
  cursorOpacity,
  cursorConfigValues,
  roundedRenderWidth,
  roundedRenderHeight,
  compositionRenderHeight,
  videoWidth,
  actualVideoHeight,
  cursorImages,
  triggerUpdate,
  currentTimeMs,
  cursorRecording,
  cropConfig,
  imageLoadCounter,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  motionBlurSampleRef: MutableRefObject<MotionBlurSample | null>;
  motionBlurVelocityRef: MutableRefObject<{ x: number; y: number }>;
  resetMotionBlurState: () => void;
  cursorData: CursorFrameRenderParams['cursorData'];
  currentCursor: CurrentCursorFrame;
  cursorOpacity: number;
  cursorConfigValues: CursorConfigValues;
  roundedRenderWidth: number;
  roundedRenderHeight: number;
  compositionRenderHeight: number;
  videoWidth: number;
  actualVideoHeight: number;
  cursorImages: Record<string, CursorImage | undefined>;
  triggerUpdate: () => void;
  currentTimeMs: number;
  cursorRecording: CursorRecording | null | undefined;
  cropConfig: CropConfig | undefined;
  imageLoadCounter: number;
}): CursorFrameRenderParams {
  return {
    canvasRef,
    motionBlurSampleRef,
    motionBlurVelocityRef,
    resetMotionBlurState,
    cursorData,
    currentCursor,
    cursorOpacity,
    visible: cursorConfigValues.visible,
    cursorType: cursorConfigValues.cursorType,
    scale: cursorConfigValues.scale,
    motionBlur: cursorConfigValues.motionBlur,
    roundedRenderWidth,
    roundedRenderHeight,
    compositionRenderHeight,
    videoWidth,
    actualVideoHeight,
    cursorImages,
    triggerUpdate,
    currentTimeMs,
    cursorRecording: cursorRecording ?? null,
    cropConfig,
    imageLoadCounter,
  };
}

function CursorOverlayCanvas({
  hasCursorData,
  visible,
  roundedDisplayWidth,
  roundedDisplayHeight,
  renderParams,
}: {
  hasCursorData: boolean;
  visible: boolean;
  roundedDisplayWidth: number;
  roundedDisplayHeight: number;
  renderParams: CursorFrameRenderParams;
}) {
  useCursorCanvasRenderer(renderParams);

  if (!shouldRenderCursorOverlay(hasCursorData, visible)) {
    return null;
  }

  return (
    <canvas
      ref={renderParams.canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={getCursorCanvasStyle(roundedDisplayWidth, roundedDisplayHeight)}
    />
  );
}

/**
 * CursorOverlay component - renders cursor on video preview.
 *
 * Priority order (matches Cap):
 * 1. SVG cursor (if cursorShape is detected) - PRIMARY
 * 2. Bitmap cursor (fallback for custom cursors)
 * 3. Default arrow SVG (fallback when nothing else available)
 */
export const CursorOverlay = memo(function CursorOverlay({
  cursorRecording,
  cursorConfig,
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  compositionRenderHeight,
  videoWidth,
  videoHeight: actualVideoHeight,
  zoomRegions,
  backgroundPadding: _backgroundPadding = 0,
  rounding: _rounding = 0,
  cropConfig,
}: CursorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionBlurSampleRef = useRef<MotionBlurSample | null>(null);
  const motionBlurVelocityRef = useRef({ x: 0, y: 0 });
  const { currentTimeMs, sourceTimeMs, currentZoomScale } = useCursorOverlayTiming(zoomRegions);

  // NOTE: Zoom transform is applied by parent container (GPUVideoPreview's frameZoomStyle)
  // CursorOverlay should NOT apply its own zoom transform to avoid double-zooming

  // Simple counter to force re-render when images load
  // This counter is included in render useEffect deps to ensure canvas redraws after SVG load
  const { imageLoadCounter, triggerUpdate } = useCursorOverlayImageUpdate();
  const getPreviewZoomScale = useCallback(() => currentZoomScale, [currentZoomScale]);
  const resetMotionBlurState = useCallback(() => {
    motionBlurSampleRef.current = null;
    motionBlurVelocityRef.current = { x: 0, y: 0 };
  }, []);

  // Get interpolated cursor data
  const { getCursorAt, hasCursorData, cursorImages } = useCursorInterpolation(
    cursorRecording,
    getCursorInterpolationOptions({
      cursorConfig,
      currentZoomScale,
      getPreviewZoomScale,
    })
  );

  useCursorImagePreloading(cursorImages, triggerUpdate);

  // Get cursor config values with defaults
  const cursorConfigValues = getCursorConfigValues(cursorConfig);

  // Get cursor position at source time (cursor data is in source time coordinates)
  const cursorData = hasCursorData ? getCursorAt(sourceTimeMs) : null;
  const cursorOpacity = Math.max(0, Math.min(1, cursorData?.opacity ?? 1));
  const {
    roundedRenderWidth,
    roundedRenderHeight,
    roundedDisplayWidth,
    roundedDisplayHeight,
    currentCursor,
  } = useCursorOverlayRenderState({
    cursorData,
    cursorImages,
    renderWidth,
    renderHeight,
    displayWidth,
    displayHeight,
  });

  const renderParams = useCursorCanvasRenderParams({
    canvasRef,
    motionBlurSampleRef,
    motionBlurVelocityRef,
    resetMotionBlurState,
    cursorData,
    currentCursor,
    cursorOpacity,
    cursorConfigValues,
    roundedRenderWidth,
    roundedRenderHeight,
    compositionRenderHeight,
    videoWidth,
    actualVideoHeight,
    cursorImages,
    triggerUpdate,
    currentTimeMs,
    cursorRecording,
    cropConfig,
    imageLoadCounter,
  });

  return (
    <CursorOverlayCanvas
      hasCursorData={hasCursorData}
      visible={cursorConfigValues.visible}
      roundedDisplayWidth={roundedDisplayWidth}
      roundedDisplayHeight={roundedDisplayHeight}
      renderParams={renderParams}
    />
  );
});

export default CursorOverlay;
