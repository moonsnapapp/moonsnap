/**
 * CursorOverlay - Renders cursor on top of video preview.
 *
 * Uses SVG as PRIMARY cursor rendering (when cursor_shape is detected).
 * Falls back to captured bitmap for custom/unknown cursors.
 *
 * This matches Cap's approach for consistent, resolution-independent cursors.
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useCursorInterpolation } from '../../hooks/useCursorInterpolation';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { WINDOWS_CURSORS, DEFAULT_CURSOR, type CursorDefinition } from '../../constants/cursors';
import { editorLogger } from '../../utils/logger';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { timelineToSource } from '../../stores/videoEditor/trimSlice';
import type { CursorRecording, CursorConfig, CursorImage, WindowsCursorShape, ZoomRegion, CropConfig } from '../../types';

// Default cursor config values
const DEFAULT_CURSOR_SCALE = 1.0;
const DEFAULT_CIRCLE_SIZE = 20; // Circle diameter in pixels at scale 1.0

// Cursor scaling constants - MUST match export (src-tauri/src/rendering/exporter/mod.rs)
const BASE_CURSOR_HEIGHT = 24.0; // Base cursor height in pixels
const REFERENCE_HEIGHT = 720.0;  // Reference video height for scaling

// SVG rasterization - now done at exact target size for lossless quality
// Cache key includes size to avoid re-rasterizing at the same size


interface CursorOverlayProps {
  cursorRecording: CursorRecording | null | undefined;
  cursorConfig: CursorConfig | undefined;
  /** Container width in pixels */
  containerWidth: number;
  /** Container height in pixels */
  containerHeight: number;
  /** Actual output video width (for WYSIWYG cursor scaling) */
  videoWidth: number;
  /** Actual output video height (for WYSIWYG cursor scaling) */
  videoHeight: number;
  /** Video aspect ratio (width/height) for object-contain offset calculation */
  videoAspectRatio?: number;
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
function svgCacheKey(shape: WindowsCursorShape, targetHeight?: number): string {
  return targetHeight ? `__svg_${shape}_${targetHeight}__` : `__svg_${shape}__`;
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
 * Rasterize SVG at exact target height for lossless quality.
 * Returns cached image if already rasterized at this size.
 */
function getSvgCursorAtSize(
  shape: WindowsCursorShape,
  targetHeight: number,
  onLoad: () => void
): HTMLImageElement | null {
  const key = svgCacheKey(shape, targetHeight);
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

  // Calculate exact dimensions for target height
  const scale = targetHeight / origHeight;
  const newWidth = Math.round(origWidth * scale);
  const newHeight = targetHeight;

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
    editorLogger.warn(`Failed to rasterize SVG cursor ${shape} at ${targetHeight}px`);
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
/**
 * Calculate the actual video bounds within a container using object-contain.
 * Returns the offset and dimensions of the video area.
 */
function calculateVideoBounds(
  containerWidth: number,
  containerHeight: number,
  videoAspectRatio: number
): { offsetX: number; offsetY: number; width: number; height: number } {
  const containerAspect = containerWidth / containerHeight;

  if (containerAspect > videoAspectRatio) {
    // Container is wider than video - letterboxing on sides (pillarboxing)
    const videoWidth = containerHeight * videoAspectRatio;
    const offsetX = (containerWidth - videoWidth) / 2;
    return { offsetX, offsetY: 0, width: videoWidth, height: containerHeight };
  } else {
    // Container is taller than video - letterboxing on top/bottom
    const videoHeight = containerWidth / videoAspectRatio;
    const offsetY = (containerHeight - videoHeight) / 2;
    return { offsetX: 0, offsetY, width: containerWidth, height: videoHeight };
  }
}

// Selector for trim segments
const selectSegments = (s: ReturnType<typeof useVideoEditorStore.getState>) =>
  s.project?.timeline.segments;

export const CursorOverlay = memo(function CursorOverlay({
  cursorRecording,
  cursorConfig,
  containerWidth,
  containerHeight,
  videoWidth,
  videoHeight: actualVideoHeight,
  videoAspectRatio,
  zoomRegions: _zoomRegions,
  backgroundPadding: _backgroundPadding = 0,
  rounding: _rounding = 0,
  cropConfig,
}: CursorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const segments = useVideoEditorStore(selectSegments);

  // Convert timeline time to source time for cursor lookup
  // Cursor data is recorded in source time (original video), but currentTimeMs is in timeline time (after cuts)
  const sourceTimeMs = useMemo(
    () => timelineToSource(currentTimeMs, segments ?? []),
    [currentTimeMs, segments]
  );

  // NOTE: Zoom transform is applied by parent container (GPUVideoPreview's frameZoomStyle)
  // CursorOverlay should NOT apply its own zoom transform to avoid double-zooming

  // Simple counter to force re-render when images load
  // This counter is included in render useEffect deps to ensure canvas redraws after SVG load
  const [imageLoadCounter, forceUpdate] = useState(0);
  const triggerUpdate = useCallback(() => forceUpdate((n) => n + 1), []);

  // Get interpolated cursor data
  const { getCursorAt, hasCursorData, cursorImages } = useCursorInterpolation(cursorRecording);

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

  // Get cursor position at source time (cursor data is in source time coordinates)
  const cursorData = hasCursorData ? getCursorAt(sourceTimeMs) : null;

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

    // Use DPR for retina sharpness, capped for performance on high-DPI displays
    // Zoom is handled by parent container's CSS transform, not here
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderScale = dpr;

    // Set canvas size at higher resolution for sharpness
    const targetWidth = Math.round(containerWidth * renderScale);
    const targetHeight = Math.round(containerHeight * renderScale);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    // Scale the context to draw at the higher resolution
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

    // Enable high-quality image smoothing for SVG cursor rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Calculate pixel position from normalized coordinates
    // The cursor coordinates are normalized (0-1) relative to the capture region.
    // IMPORTANT: Use cursor recording dimensions (not video dimensions) for positioning,
    // as cursor coordinates are normalized to the capture region, not the video file.
    // These can differ for area selection recordings (FFmpeg may force even dimensions, etc.)
    let pixelX: number;
    let pixelY: number;
    let previewVideoHeight: number;

    // Transform cursor coordinates for crop
    // Cursor coords are 0-1 relative to original video, need to transform to cropped space
    let cursorX = cursorData.x;
    let cursorY = cursorData.y;
    const cropEnabled = cropConfig?.enabled && cropConfig.width > 0 && cropConfig.height > 0;

    if (cropEnabled && cropConfig) {
      // The video uses CSS object-fit: cover + object-position to show the crop region.
      // CSS formula: posX% = (cropConfig.x / (videoWidth - cropWidth)) * 100
      //
      // With object-fit: cover, the video scales to FILL the container, potentially
      // clipping content. The actual visible region depends on container aspect ratio.
      //
      // Match the CSS behavior by calculating what portion of the video is actually visible
      const recordingWidth = cursorRecording?.width ?? videoWidth;
      const recordingHeight = cursorRecording?.height ?? actualVideoHeight;

      const cursorPxX = cursorX * recordingWidth;
      const cursorPxY = cursorY * recordingHeight;

      // Calculate overflow (same as CSS formula in GPUVideoPreview)
      const overflowX = recordingWidth - cropConfig.width;
      const overflowY = recordingHeight - cropConfig.height;

      // CSS object-position percentages
      const posXPercent = overflowX > 0 ? cropConfig.x / overflowX : 0.5;
      const posYPercent = overflowY > 0 ? cropConfig.y / overflowY : 0.5;

      // With object-fit: cover, the visible region in video pixels:
      // The video is scaled so both dimensions fill or exceed the container
      // For a container matching crop aspect ratio (1:1 for square crop):
      const cropAspect = cropConfig.width / cropConfig.height;
      const videoAspect = recordingWidth / recordingHeight;

      let visibleX: number, visibleY: number, visibleW: number, visibleH: number;

      if (videoAspect > cropAspect) {
        // Video is wider - scaled by height, horizontal clipping
        visibleH = recordingHeight;
        visibleW = recordingHeight * cropAspect;
        visibleY = 0;
        const totalOverflowX = recordingWidth - visibleW;
        visibleX = totalOverflowX * posXPercent;
      } else {
        // Video is taller - scaled by width, vertical clipping
        visibleW = recordingWidth;
        visibleH = recordingWidth / cropAspect;
        visibleX = 0;
        const totalOverflowY = recordingHeight - visibleH;
        visibleY = totalOverflowY * posYPercent;
      }

      // Transform cursor to the CSS-visible region coordinates
      cursorX = (cursorPxX - visibleX) / visibleW;
      cursorY = (cursorPxY - visibleY) / visibleH;

      // Hide cursor if outside visible region
      if (cursorX < -0.1 || cursorX > 1.1 || cursorY < -0.1 || cursorY > 1.1) {
        ctx.clearRect(0, 0, containerWidth, containerHeight);
        return;
      }
    }

    // Use cursor recording's aspect ratio for cursor positioning
    // When crop is enabled, use crop aspect ratio instead
    const cursorAspectRatio = cropEnabled && cropConfig
      ? cropConfig.width / cropConfig.height
      : cursorRecording?.width && cursorRecording?.height
        ? cursorRecording.width / cursorRecording.height
        : videoAspectRatio;

    if (cursorAspectRatio && cursorAspectRatio > 0) {
      // Calculate actual video bounds within the container (accounting for object-contain)
      const bounds = calculateVideoBounds(containerWidth, containerHeight, cursorAspectRatio);
      pixelX = bounds.offsetX + cursorX * bounds.width;
      pixelY = bounds.offsetY + cursorY * bounds.height;
      previewVideoHeight = bounds.height;
    } else {
      // Fallback: assume container matches video aspect ratio exactly
      pixelX = cursorX * containerWidth;
      pixelY = cursorY * containerHeight;
      previewVideoHeight = containerHeight;
    }

    // Calculate cursor size for WYSIWYG with export
    // Step 1: Calculate at EXPORT resolution (matches exporter/mod.rs exactly)
    const exportSizeScale = actualVideoHeight / REFERENCE_HEIGHT;
    const exportCursorHeight = Math.min(Math.max(BASE_CURSOR_HEIGHT * exportSizeScale * scale, 16), 256);

    // Step 2: Scale to preview resolution
    const previewScale = previewVideoHeight / actualVideoHeight;
    const finalCursorHeight = exportCursorHeight * previewScale;

    // Helper to draw circle cursor
    const drawCircle = () => {
      ctx.clearRect(0, 0, containerWidth, containerHeight);
      // Circle uses the same resolution-dependent scaling as cursor
      // Calculate at export resolution, then scale to preview
      const exportCircleSize = DEFAULT_CIRCLE_SIZE * exportSizeScale * scale;
      const radius = (exportCircleSize / 2) * previewScale;
      ctx.beginPath();
      ctx.arc(pixelX, pixelY, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    // Get click animation scale from cursor data (0.7-1.0)
    const clickAnimationScale = cursorData.scale ?? 1.0;

    // Calculate exact SVG rasterization height for lossless rendering
    // Account for DPR so the SVG is rasterized at screen pixel resolution
    const svgTargetHeight = Math.round(finalCursorHeight * clickAnimationScale * renderScale);

    // Helper to draw SVG cursor at exact size (lossless - no scaling in drawImage)
    // SVG cursors use fractional hotspot (0-1)
    const drawSvgCursor = (img: HTMLImageElement, def: CursorDefinition) => {
      ctx.clearRect(0, 0, containerWidth, containerHeight);
      // Image is already at exact size (svgTargetHeight), draw at 1:1
      // But we need to account for renderScale in our coordinate system
      const drawHeight = finalCursorHeight * clickAnimationScale;
      const drawWidth = (img.width / img.height) * drawHeight;
      const drawX = pixelX - drawWidth * def.hotspotX;
      const drawY = pixelY - drawHeight * def.hotspotY;
      // Draw at exact pixel size (img is already scaled for DPR)
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    };

    // Helper to draw bitmap cursor with pixel hotspot
    // Bitmap cursors are scaled to match finalCursorHeight (same as export)
    const drawBitmap = (img: HTMLImageElement, hotspotX: number, hotspotY: number) => {
      ctx.clearRect(0, 0, containerWidth, containerHeight);
      // Scale bitmap to finalCursorHeight, matching export formula:
      // bitmap_scale = final_cursor_height / cursor_image.height
      // Apply click animation scale (matches export behavior)
      const bitmapScale = (finalCursorHeight / img.height) * clickAnimationScale;
      const drawWidth = img.width * bitmapScale;
      const drawHeight = img.height * bitmapScale;
      const drawX = pixelX - hotspotX * bitmapScale;
      const drawY = pixelY - hotspotY * bitmapScale;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    };

    if (cursorType === 'circle') {
      drawCircle();
      return;
    }

    // Get cursor data for current frame
    const { cursorId, shape } = currentCursor;
    const cursorImageData = cursorId ? cursorImages[cursorId] : null;

    // Priority 1: SVG cursor at exact size (if cursorShape is detected)
    if (shape) {
      const definition: CursorDefinition | undefined = WINDOWS_CURSORS[shape as WindowsCursorShape];
      if (definition) {
        // Get or trigger rasterization at exact target height
        const svgImage = getSvgCursorAtSize(shape, svgTargetHeight, triggerUpdate);
        if (svgImage) {
          drawSvgCursor(svgImage, definition);
          return;
        }
      }
      // SVG not ready yet - continue to check bitmap fallback
    }

    // Priority 2: Bitmap cursor (fallback for custom cursors)
    if (cursorId && cursorImageData) {
      const bitmapImage = cursorImageCache.get(cursorId);
      if (bitmapImage) {
        drawBitmap(bitmapImage, cursorImageData.hotspotX, cursorImageData.hotspotY);
        return;
      }
      // Bitmap not loaded yet - continue to default
    }

    // Priority 3: Default arrow SVG at exact size (final fallback)
    const defaultImage = getSvgCursorAtSize('arrow', svgTargetHeight, triggerUpdate);
    if (defaultImage) {
      drawSvgCursor(defaultImage, DEFAULT_CURSOR);
      return;
    }

    // Nothing loaded yet - don't clear, keep previous frame
  }, [
    cursorData,
    currentCursor,
    visible,
    cursorType,
    scale,
    containerWidth,
    containerHeight,
    actualVideoHeight, // For WYSIWYG cursor sizing
    videoAspectRatio,
    cursorImages,
    currentTimeMs,
    cursorRecording?.width,
    cursorRecording?.height,
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
        // Use CSS dimensions for visual size (canvas internal resolution is higher for sharpness)
        width: containerWidth,
        height: containerHeight,
        // NOTE: Zoom transform is applied by parent container, not here
      }}
    />
  );
});

export default CursorOverlay;
