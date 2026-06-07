/**
 * ClickHighlightOverlay - Renders click highlight animations on video preview.
 *
 * Displays visual feedback (ripple, spotlight, ring) at click locations
 * during video playback. Animations are triggered by click events from
 * the cursor recording data.
 */

import { memo, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../hooks/useTimelineSourceTime';
import { remapNormalizedPointThroughCrop } from '../../utils/cropCoordinateMapping';
import { resolveRecordingDimensions } from '../../utils/recordingDimensions';
import { getRoundedPreviewDimensions } from './previewDimensions';
import type { CursorRecording, ClickHighlightConfig, CursorEvent, ZoomRegion, CropConfig } from '../../types';

interface ClickHighlightOverlayProps {
  cursorRecording: CursorRecording | null | undefined;
  clickHighlightConfig: ClickHighlightConfig | undefined;
  /** Frame width in export/master coordinates */
  renderWidth: number;
  /** Frame height in export/master coordinates */
  renderHeight: number;
  /** Frame width in preview/display coordinates */
  displayWidth: number;
  /** Frame height in preview/display coordinates */
  displayHeight: number;
  /** Composition height in export/master coordinates */
  compositionRenderHeight: number;
  /** Video width in source coordinates for crop transform */
  videoWidth?: number;
  /** Video height in source coordinates for crop transform */
  videoHeight?: number;
  /** Zoom regions for applying the same transform as the video */
  zoomRegions?: ZoomRegion[];
  /** Background padding in pixels - needed for zoom transform alignment */
  backgroundPadding?: number;
  /** Corner rounding in pixels - needed for zoom transform alignment */
  rounding?: number;
  /** Crop configuration - click positions need to be transformed when crop is applied */
  cropConfig?: CropConfig;
}

const DEFAULT_CLICK_HIGHLIGHT_COLOR = { r: 255, g: 107, b: 107, a: 0.5 };

function parseHexClickColor(trimmed: string): { r: number; g: number; b: number; a: number } | null {
  if (!trimmed.startsWith('#')) {
    return null;
  }

  const hex = trimmed.slice(1);
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 0.5,
    };
  }

  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }

  return null;
}

function parseRgbClickColor(trimmed: string): { r: number; g: number; b: number; a: number } | null {
  const rgbaMatch = trimmed.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (!rgbaMatch) {
    return null;
  }

  return {
    r: parseInt(rgbaMatch[1], 10),
    g: parseInt(rgbaMatch[2], 10),
    b: parseInt(rgbaMatch[3], 10),
    a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 0.5,
  };
}

/**
 * Parse a CSS color string into RGBA values.
 * Supports: #RRGGBB, #RRGGBBAA, rgb(r,g,b), rgba(r,g,b,a)
 */
function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  if (!color) {
    return DEFAULT_CLICK_HIGHLIGHT_COLOR;
  }

  const trimmed = color.trim();
  return parseHexClickColor(trimmed)
    ?? parseRgbClickColor(trimmed)
    ?? DEFAULT_CLICK_HIGHLIGHT_COLOR;
}

/**
 * Get all active click highlights for a given timestamp.
 * Returns click positions with animation progress (0-1).
 * Cursor event coordinates are already normalized (0.0-1.0).
 */
function getActiveClicks(
  events: CursorEvent[],
  currentTimeMs: number,
  durationMs: number
): Array<{ x: number; y: number; progress: number }> {
  return events.flatMap((event) => {
    const progress = getActiveClickProgress(event, currentTimeMs, durationMs);
    return progress === null ? [] : [{ x: event.x, y: event.y, progress }];
  });
}

function isClickDownEvent(event: CursorEvent): boolean {
  const eventType = event.eventType;
  return (
    (eventType.type === 'leftClick' ||
      eventType.type === 'rightClick' ||
      eventType.type === 'middleClick') &&
    eventType.pressed
  );
}

function getActiveClickProgress(
  event: CursorEvent,
  currentTimeMs: number,
  durationMs: number
): number | null {
  if (!isClickDownEvent(event) || currentTimeMs < event.timestampMs) {
    return null;
  }

  const elapsed = currentTimeMs - event.timestampMs;
  return elapsed > durationMs ? null : elapsed / durationMs;
}

/**
 * Render ripple effect - expanding circle that fades out.
 */
function renderRipple(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  progress: number,
  maxRadius: number,
  r: number,
  g: number,
  b: number,
  baseAlpha: number
) {
  // Ripple expands from 0 to maxRadius with easing
  const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
  const currentRadius = maxRadius * easedProgress;
  
  // Fade out as ripple expands
  const alpha = baseAlpha * (1 - progress);
  
  if (currentRadius <= 0 || alpha <= 0) return;
  
  // Draw filled circle with soft edges using radial gradient
  const innerRadius = currentRadius * 0.7;
  const gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, currentRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  
  ctx.beginPath();
  ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

/**
 * Render spotlight effect - static glow that fades out.
 */
function renderSpotlight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  progress: number,
  radius: number,
  r: number,
  g: number,
  b: number,
  baseAlpha: number
) {
  // Spotlight stays same size but fades out
  const alpha = baseAlpha * (1 - progress);
  
  if (alpha <= 0) return;
  
  // Draw gaussian-like glow using radial gradient
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

/**
 * Render ring effect - expanding hollow ring that fades out.
 */
function renderRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  progress: number,
  maxRadius: number,
  r: number,
  g: number,
  b: number,
  baseAlpha: number
) {
  // Ring expands from 0 to maxRadius with easing
  const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
  const currentRadius = maxRadius * easedProgress;
  
  // Fade out as ring expands
  const alpha = baseAlpha * (1 - progress);
  
  if (currentRadius <= 0 || alpha <= 0) return;
  
  // Ring thickness proportional to radius
  const ringThickness = Math.max(currentRadius * 0.15, 2);
  
  ctx.beginPath();
  ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.lineWidth = ringThickness;
  ctx.stroke();
}

function ensureClickCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function prepareClickHighlightCanvas(
  canvas: HTMLCanvasElement | null,
  enabled: boolean,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  if (!canvas || !enabled) {
    return null;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ensureClickCanvasSize(canvas, width, height);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function getAdjustedClickTimeMs(
  cursorRecording: CursorRecording,
  sourceTimeMs: number
): number {
  return sourceTimeMs + (cursorRecording.videoStartOffsetMs ?? 0);
}

function getRenderableActiveClicks(
  cursorRecording: CursorRecording,
  sourceTimeMs: number,
  durationMs: number
): ReturnType<typeof getActiveClicks> | null {
  const activeClicks = getActiveClicks(
    cursorRecording.events,
    getAdjustedClickTimeMs(cursorRecording, sourceTimeMs),
    durationMs
  );

  return activeClicks.length > 0 ? activeClicks : null;
}

function renderClickHighlight(
  ctx: CanvasRenderingContext2D,
  style: NonNullable<ClickHighlightConfig['style']>,
  x: number,
  y: number,
  progress: number,
  radius: number,
  color: ReturnType<typeof parseColor>
) {
  if (style === 'spotlight') {
    renderSpotlight(ctx, x, y, progress, radius, color.r, color.g, color.b, color.a);
    return;
  }
  if (style === 'ring') {
    renderRing(ctx, x, y, progress, radius, color.r, color.g, color.b, color.a);
    return;
  }

  renderRipple(ctx, x, y, progress, radius, color.r, color.g, color.b, color.a);
}

function renderActiveClickHighlights({
  ctx,
  cursorRecording,
  activeClicks,
  roundedRenderWidth,
  roundedRenderHeight,
  videoWidth,
  videoHeight,
  cropConfig,
  radius,
  style,
  color,
}: {
  ctx: CanvasRenderingContext2D;
  cursorRecording: CursorRecording;
  activeClicks: ReturnType<typeof getActiveClicks>;
  roundedRenderWidth: number;
  roundedRenderHeight: number;
  videoWidth: number;
  videoHeight: number;
  cropConfig?: CropConfig;
  radius: number;
  style: NonNullable<ClickHighlightConfig['style']>;
  color: ReturnType<typeof parseColor>;
}) {
  const { width: recordingWidth, height: recordingHeight } = resolveRecordingDimensions(
    cursorRecording,
    videoWidth,
    videoHeight
  );
  const scaledRadius = radius * (roundedRenderHeight / 1080);

  for (const click of activeClicks) {
    const remappedClick = remapNormalizedPointThroughCrop(
      { x: click.x, y: click.y },
      recordingWidth,
      recordingHeight,
      cropConfig
    );
    if (!remappedClick.inVisibleBounds) continue;

    renderClickHighlight(
      ctx,
      style,
      remappedClick.point.x * roundedRenderWidth,
      remappedClick.point.y * roundedRenderHeight,
      click.progress,
      scaledRadius,
      color
    );
  }
}

function getClickHighlightSettings(config: ClickHighlightConfig | undefined) {
  const {
    enabled = true,
    color = '#FF6B6B',
    radius = 30,
    durationMs = 400,
    style = 'ripple',
  } = config ?? {};

  return {
    enabled,
    color,
    radius,
    durationMs,
    style,
  };
}

function shouldRenderClickHighlightOverlay(
  enabled: boolean,
  cursorRecording: CursorRecording | null | undefined
) {
  return enabled && !!cursorRecording && cursorRecording.events.length > 0;
}

/**
 * ClickHighlightOverlay component - renders click highlight animations on video.
 */
export const ClickHighlightOverlay = memo(function ClickHighlightOverlay({
  cursorRecording,
  clickHighlightConfig,
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  compositionRenderHeight: _compositionRenderHeight,
  videoWidth: _videoWidth = 1920,
  videoHeight: _videoHeight = 1080,
  zoomRegions: _zoomRegions,
  backgroundPadding: _backgroundPadding = 0,
  rounding: _rounding = 0,
  cropConfig,
}: ClickHighlightOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const lastRenderTimeRef = useRef<number>(-1);
  const toSourceTime = useTimelineToSourceTime();

  // Convert timeline time to source time for cursor lookup
  // Click events are recorded in source time (original video), but currentTimeMs is in timeline time (after cuts)
  const sourceTimeMs = useMemo(
    () => toSourceTime(currentTimeMs),
    [currentTimeMs, toSourceTime]
  );

  // NOTE: Zoom transform is applied by parent container (GPUVideoPreview's frameZoomStyle)
  // ClickHighlightOverlay should NOT apply its own zoom transform to avoid double-zooming
  
  // Get config values with defaults
  const { enabled, color, radius, durationMs, style } = getClickHighlightSettings(clickHighlightConfig);
  const {
    roundedRenderWidth,
    roundedRenderHeight,
    roundedDisplayWidth,
    roundedDisplayHeight,
  } = getRoundedPreviewDimensions(renderWidth, renderHeight, displayWidth, displayHeight);
  
  // Parse color once
  const parsedColor = parseColor(color);
  
  // Render function for the highlight animations
  const render = useCallback(() => {
    if (!cursorRecording) return;

    const ctx = prepareClickHighlightCanvas(
      canvasRef.current,
      enabled,
      roundedRenderWidth,
      roundedRenderHeight
    );
    if (!ctx) return;

    const activeClicks = getRenderableActiveClicks(cursorRecording, sourceTimeMs, durationMs);
    if (!activeClicks) return;
    
    renderActiveClickHighlights({
      ctx,
      cursorRecording,
      activeClicks,
      roundedRenderWidth,
      roundedRenderHeight,
      videoWidth: _videoWidth,
      videoHeight: _videoHeight,
      cropConfig,
      radius,
      style,
      color: parsedColor,
    });
  }, [
    cursorRecording,
    enabled,
    radius,
    durationMs,
    style,
    roundedRenderWidth,
    roundedRenderHeight,
    _videoWidth,
    _videoHeight,
    cropConfig,
    sourceTimeMs,
    parsedColor,
  ]);
  
  // Animation loop for smooth rendering
  useEffect(() => {
    if (!enabled || !cursorRecording) return;

    // Only re-render if source time changed
    if (lastRenderTimeRef.current === sourceTimeMs) return;
    lastRenderTimeRef.current = sourceTimeMs;

    render();
  }, [enabled, cursorRecording, sourceTimeMs, render]);
  
  // Don't render if disabled or no cursor data
  if (!shouldRenderClickHighlightOverlay(enabled, cursorRecording)) {
    return null;
  }
  
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: 14, // Below cursor (15), above video content
        width: `${roundedDisplayWidth}px`,
        height: `${roundedDisplayHeight}px`,
        // NOTE: Zoom transform is applied by parent container, not here
      }}
      width={roundedRenderWidth}
      height={roundedRenderHeight}
    />
  );
});

export default ClickHighlightOverlay;
