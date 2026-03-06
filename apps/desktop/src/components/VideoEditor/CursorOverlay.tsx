/**
 * CursorOverlay - Renders cursor on top of video preview.
 *
 * Uses SVG as PRIMARY cursor rendering (when cursor_shape is detected).
 * Falls back to captured bitmap for custom/unknown cursors.
 *
 * This matches Cap's approach for consistent, resolution-independent cursors.
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { CURSOR } from '../../constants';
import { useCursorInterpolation } from '../../hooks/useCursorInterpolation';
import { getZoomScaleAt } from '../../hooks/useZoomPreview';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../hooks/useTimelineSourceTime';
import { WINDOWS_CURSORS, DEFAULT_CURSOR, type CursorDefinition } from '../../constants/cursors';
import { editorLogger } from '../../utils/logger';
import { remapNormalizedPointThroughCrop } from '../../utils/cropCoordinateMapping';
import { resolveRecordingDimensions } from '../../utils/recordingDimensions';
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

// SVG rasterization - now done at exact target size for lossless quality
// Cache key includes size to avoid re-rasterizing at the same size

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
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

  const definition = WINDOWS_CURSORS[shape];
  if (!definition) return null;

  // Check if we have the SVG text cached
  const svgText = svgTextCache.get(shape);
  if (!svgText) {
    // Fetch SVG text first, then retry
    fetchSvgText(shape).then(() => onLoad());
    return null;
  }

  // Parse and rasterize at exact target size
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgElement = doc.querySelector('svg');

  if (!svgElement) return null;

  // Get original dimensions
  const origWidth = parseFloat(svgElement.getAttribute('width') || '24');
  const origHeight = parseFloat(svgElement.getAttribute('height') || '24');

  // Normalize cursors by fitting the larger SVG dimension to targetExtent.
  // This prevents wide cursors like sizeWE from rendering much larger than arrow.
  const dominantDimension = Math.max(origWidth, origHeight, 1);
  const scale = targetExtent / dominantDimension;
  const newWidth = Math.max(1, Math.round(origWidth * scale));
  const newHeight = Math.max(1, Math.round(origHeight * scale));

  // Update SVG dimensions
  svgElement.setAttribute('width', String(newWidth));
  svgElement.setAttribute('height', String(newHeight));

  // Create data URL
  const serializer = new XMLSerializer();
  const modifiedSvg = serializer.serializeToString(doc);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(modifiedSvg)}`;

  // Load as Image
  const img = new Image();
  img.onload = () => {
    cursorImageCache.set(key, img);
    onLoad();
  };
  img.onerror = () => {
    editorLogger.warn(`Failed to rasterize SVG cursor ${shape} at ${targetExtent}px`);
  };
  img.src = dataUrl;

  return null; // Image loading async, will trigger onLoad when ready
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
  const currentTimeMs = usePreviewOrPlaybackTime();
  const toSourceTime = useTimelineToSourceTime();

  // Convert timeline time to source time for cursor lookup
  // Cursor data is recorded in source time (original video), but currentTimeMs is in timeline time (after cuts)
  const sourceTimeMs = useMemo(
    () => toSourceTime(currentTimeMs),
    [currentTimeMs, toSourceTime]
  );

  // NOTE: Zoom transform is applied by parent container (GPUVideoPreview's frameZoomStyle)
  // CursorOverlay should NOT apply its own zoom transform to avoid double-zooming

  // Simple counter to force re-render when images load
  // This counter is included in render useEffect deps to ensure canvas redraws after SVG load
  const [imageLoadCounter, forceUpdate] = useState(0);
  const triggerUpdate = useCallback(() => forceUpdate((n) => n + 1), []);
  const currentZoomScale = useMemo(
    () => getZoomScaleAt(zoomRegions, currentTimeMs),
    [zoomRegions, currentTimeMs]
  );
  const getPreviewZoomScale = useCallback(() => currentZoomScale, [currentZoomScale]);

  // Get interpolated cursor data
  const { getCursorAt, hasCursorData, cursorImages } = useCursorInterpolation(
    cursorRecording,
    {
      hideWhenIdle: cursorConfig?.hideWhenIdle ?? true,
      dampening: cursorConfig?.dampening ?? CURSOR.DAMPENING_DEFAULT,
      getZoomScale: currentZoomScale > 1.001 ? getPreviewZoomScale : null,
    }
  );

  // Default cursor shape fallback when shape detection fails.
  // Uses 'arrow' as the universal default (most common cursor in general usage).
  // Previously used "most common shape in recording" which caused issues:
  // If recording in a text editor, iBeam would be most common, so any cursor
  // without detected shape (custom cursors) would show as I-beam incorrectly.
  const fallbackCursorShape: WindowsCursorShape = 'arrow';

  // Preload SVG cursors for all shapes found in recording + default arrow
  useEffect(() => {
    // Clear bitmap cache entries when cursor images change (new project loaded)
    // SVG entries (keys starting with __svg_) are project-independent and can stay
    // Bitmap entries use cursor IDs like "cursor_0" which can collide between projects
    for (const key of cursorImageCache.keys()) {
      if (!key.startsWith('__svg_')) {
        cursorImageCache.delete(key);
      }
    }

    // Preload SVG text for default arrow (final fallback)
    preloadSvgCursor('arrow', triggerUpdate);

    // Preload SVG text for all cursor shapes in the recording
    // (actual rasterization happens at render time at exact size needed)
    const shapesInRecording = new Set<WindowsCursorShape>();
    for (const image of Object.values(cursorImages)) {
      if (image?.cursorShape) {
        shapesInRecording.add(image.cursorShape);
      }
    }

    for (const shape of shapesInRecording) {
      preloadSvgCursor(shape, triggerUpdate);
    }

    // Also load bitmap fallbacks for cursors without shapes
    for (const [id, image] of Object.entries(cursorImages)) {
      if (image && !image.cursorShape && !cursorImageCache.has(id)) {
        loadBitmapCursor(id, image, triggerUpdate);
      }
    }
  }, [cursorImages, triggerUpdate]);

  // Get cursor config values with defaults
  const visible = cursorConfig?.visible ?? true;
  const cursorType = cursorConfig?.cursorType ?? 'auto';
  const scale = cursorConfig?.scale ?? DEFAULT_CURSOR_SCALE;
  const motionBlur = Math.min(Math.max(cursorConfig?.motionBlur ?? 0, 0), MOTION_BLUR_MAX_USER_AMOUNT);

  // Get cursor position at source time (cursor data is in source time coordinates)
  const cursorData = hasCursorData ? getCursorAt(sourceTimeMs) : null;
  const cursorOpacity = Math.max(0, Math.min(1, cursorData?.opacity ?? 1));
  const roundedRenderWidth = Math.max(1, Math.round(renderWidth));
  const roundedRenderHeight = Math.max(1, Math.round(renderHeight));
  const roundedDisplayWidth = Math.max(1, Math.round(displayWidth));
  const roundedDisplayHeight = Math.max(1, Math.round(displayHeight));

  // Get current cursor shape directly from cursor data
  // Note: Cursor shape stabilization (debouncing short-lived shapes) should happen
  // at recording time in Rust (stabilize_short_lived_cursor_shapes), not here.
  // Previous debouncing logic here was buggy and caused random cursor display.
  const currentCursor = useMemo(() => {
    if (!cursorData?.cursorId) {
      return { cursorId: null, shape: null };
    }

    const cursorId = cursorData.cursorId;
    const cursorImageData = cursorImages[cursorId];
    // Use cursor's detected shape, or fallback to arrow
    const shape = cursorImageData?.cursorShape ?? fallbackCursorShape;

    return { cursorId, shape };
  }, [cursorData?.cursorId, cursorImages, fallbackCursorShape]);

  // Draw cursor on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cursorData || !visible) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw in render-space, then display-scale via CSS for stable parity.
    // DPR is applied to keep edges sharp on HiDPI screens.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderScale = dpr;

    const targetWidth = Math.max(1, Math.round(roundedRenderWidth * renderScale));
    const targetHeight = Math.max(1, Math.round(roundedRenderHeight * renderScale));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    // Scale the context to draw at the higher resolution
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

    // Enable high-quality image smoothing for SVG cursor rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (cursorOpacity <= 0) {
      ctx.clearRect(0, 0, roundedRenderWidth, roundedRenderHeight);
      return;
    }

    // Transform cursor coordinates for crop
    // Cursor coords are 0-1 relative to original video, need to transform to cropped space
    let cursorX = cursorData.x;
    let cursorY = cursorData.y;
    const { width: recordingWidth, height: recordingHeight } = resolveRecordingDimensions(
      cursorRecording,
      videoWidth,
      actualVideoHeight
    );
    const remappedCursor = remapNormalizedPointThroughCrop(
      { x: cursorX, y: cursorY },
      recordingWidth,
      recordingHeight,
      cropConfig
    );
    cursorX = remappedCursor.point.x;
    cursorY = remappedCursor.point.y;

    // Hide cursor if outside visible region after crop remap.
    if (!remappedCursor.inVisibleBounds) {
      ctx.clearRect(0, 0, roundedRenderWidth, roundedRenderHeight);
      return;
    }

    // Cursor coordinates are normalized (0-1) in source-space.
    // Convert to render-space after optional crop remapping.
    const pixelX = cursorX * roundedRenderWidth;
    const pixelY = cursorY * roundedRenderHeight;

    // Calculate cursor size for WYSIWYG with export
    // Matches exporter/mod.rs: uses composition height as scale reference.
    const exportSizeScale = compositionRenderHeight / REFERENCE_HEIGHT;
    const exportCursorHeight = Math.min(Math.max(BASE_CURSOR_HEIGHT * exportSizeScale * scale, 16), 256);
    const finalCursorHeight = exportCursorHeight;

    // Get click animation scale from cursor data (0.7-1.0)
    const clickAnimationScale = cursorData.scale ?? 1.0;

    // Calculate exact SVG rasterization extent for lossless rendering
    // Account for DPR so the SVG is rasterized at screen pixel resolution
    const svgTargetExtent = Math.round(finalCursorHeight * clickAnimationScale * renderScale);

    const velocityX = cursorData.velocityX ?? 0;
    const velocityY = cursorData.velocityY ?? 0;
    const velocityMagnitude = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    const frameDiagonal = Math.sqrt(
      roundedRenderWidth * roundedRenderWidth + roundedRenderHeight * roundedRenderHeight
    );
    const motionPixels = velocityMagnitude * frameDiagonal * MOTION_BLUR_VELOCITY_SCALE;
    const clampedMotion = Math.min(motionPixels, MAX_MOTION_PIXELS);
    const velocityFactor = smoothstep(
      MOTION_BLUR_MIN_VELOCITY,
      MOTION_BLUR_VELOCITY_RAMP_END,
      velocityMagnitude
    );
    const trailLength =
      Math.min(clampedMotion / frameDiagonal, MOTION_BLUR_MAX_TRAIL) * motionBlur * velocityFactor;
    const shouldDrawMotionBlur =
      motionBlur > 0 &&
      velocityMagnitude >= MOTION_BLUR_MIN_VELOCITY &&
      velocityFactor > 0 &&
      trailLength >= MIN_MOTION_THRESHOLD;
    const blurDirX = shouldDrawMotionBlur ? -velocityX / velocityMagnitude : 0;
    const blurDirY = shouldDrawMotionBlur ? -velocityY / velocityMagnitude : 0;

    // Draw a motion trail (if enabled) and then the main cursor sample.
    const drawMotionBlurTrail = (drawSample: (x: number, y: number, opacity: number) => void) => {
      if (shouldDrawMotionBlur) {
        const trailSampleCount = Math.max(1, MOTION_BLUR_SAMPLES - 1);
        const weightNormalization = MOTION_BLUR_BASE_TRAIL_SAMPLES / trailSampleCount;
        for (let i = MOTION_BLUR_SAMPLES - 1; i >= 1; i -= 1) {
          const t = i / (MOTION_BLUR_SAMPLES - 1);
          const easedT = smoothstep(0, 1, t);
          const offsetX = blurDirX * trailLength * easedT;
          const offsetY = blurDirY * trailLength * easedT;
          const sampleX = pixelX + offsetX * roundedRenderWidth;
          const sampleY = pixelY + offsetY * roundedRenderHeight;
          const weight = (1 - t * 0.75) * motionBlur * velocityFactor * weightNormalization;
          if (weight > 0) {
            drawSample(sampleX, sampleY, weight * cursorOpacity);
          }
        }
      }
      drawSample(pixelX, pixelY, cursorOpacity);
    };

    const drawCircleAt = (x: number, y: number, opacity: number) => {
      if (opacity <= 0) return;
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = opacity;
      // Circle uses the same resolution-dependent scaling as cursor
      const exportCircleSize = DEFAULT_CIRCLE_SIZE * exportSizeScale * scale;
      const radius = exportCircleSize / 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = previousAlpha;
    };

    // Helper to draw SVG cursor at exact size (lossless - no scaling in drawImage)
    // SVG cursors use fractional hotspot (0-1)
    const drawSvgCursorAt = (
      img: HTMLImageElement,
      def: CursorDefinition,
      x: number,
      y: number,
      opacity: number
    ) => {
      if (opacity <= 0) return;
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = opacity;
      // Image is already rasterized to exact display size at renderScale.
      const drawWidth = img.width / renderScale;
      const drawHeight = img.height / renderScale;
      const drawX = x - drawWidth * def.hotspotX;
      const drawY = y - drawHeight * def.hotspotY;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.globalAlpha = previousAlpha;
    };

    // Helper to draw bitmap cursor with pixel hotspot
    // Bitmap cursors are scaled to match finalCursorHeight (same as export)
    const drawBitmapAt = (
      img: HTMLImageElement,
      hotspotX: number,
      hotspotY: number,
      x: number,
      y: number,
      opacity: number
    ) => {
      if (opacity <= 0) return;
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = opacity;
      // Scale bitmap to finalCursorHeight, matching export formula:
      // bitmap_scale = final_cursor_height / cursor_image.height
      // Apply click animation scale (matches export behavior)
      const bitmapScale = (finalCursorHeight / img.height) * clickAnimationScale;
      const drawWidth = img.width * bitmapScale;
      const drawHeight = img.height * bitmapScale;
      const drawX = x - hotspotX * bitmapScale;
      const drawY = y - hotspotY * bitmapScale;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.globalAlpha = previousAlpha;
    };

    if (cursorType === 'circle') {
      ctx.clearRect(0, 0, roundedRenderWidth, roundedRenderHeight);
      drawMotionBlurTrail(drawCircleAt);
      return;
    }

    // Get cursor data for current frame
    const { cursorId, shape } = currentCursor;
    const cursorImageData = cursorId ? cursorImages[cursorId] : null;

    // Priority 1: SVG cursor at exact size (if cursorShape is detected)
    if (shape) {
      const definition: CursorDefinition | undefined = WINDOWS_CURSORS[shape as WindowsCursorShape];
      if (definition) {
        // Get or trigger rasterization at exact target extent
        const svgImage = getSvgCursorAtSize(shape, svgTargetExtent, triggerUpdate);
        if (svgImage) {
          ctx.clearRect(0, 0, roundedRenderWidth, roundedRenderHeight);
          drawMotionBlurTrail((x, y, opacity) => drawSvgCursorAt(svgImage, definition, x, y, opacity));
          return;
        }
      }
      // SVG not ready yet - continue to check bitmap fallback
    }

    // Priority 2: Bitmap cursor (fallback for custom cursors)
    if (cursorId && cursorImageData) {
      const bitmapImage = cursorImageCache.get(cursorId);
      if (bitmapImage) {
        ctx.clearRect(0, 0, roundedRenderWidth, roundedRenderHeight);
        drawMotionBlurTrail((x, y, opacity) =>
          drawBitmapAt(bitmapImage, cursorImageData.hotspotX, cursorImageData.hotspotY, x, y, opacity)
        );
        return;
      }
      // Bitmap not loaded yet - continue to default
    }

    // Priority 3: Default arrow SVG at exact size (final fallback)
    const defaultImage = getSvgCursorAtSize('arrow', svgTargetExtent, triggerUpdate);
    if (defaultImage) {
      ctx.clearRect(0, 0, roundedRenderWidth, roundedRenderHeight);
      drawMotionBlurTrail((x, y, opacity) => drawSvgCursorAt(defaultImage, DEFAULT_CURSOR, x, y, opacity));
      return;
    }

    // Nothing loaded yet - don't clear, keep previous frame
  }, [
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
    cursorRecording?.width,
    cursorRecording?.height,
    cropConfig,
    cropConfig?.enabled,
    cropConfig?.x,
    cropConfig?.y,
    cropConfig?.width,
    cropConfig?.height,
    imageLoadCounter, // Re-run when SVG/bitmap images finish loading
  ]);

  // Don't render if no cursor data or not visible
  if (!hasCursorData || !visible) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 15,
        width: `${roundedDisplayWidth}px`,
        height: `${roundedDisplayHeight}px`,
        // NOTE: Zoom transform is applied by parent container, not here
      }}
    />
  );
});

export default CursorOverlay;
