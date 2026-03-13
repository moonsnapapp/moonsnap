import { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { WEBCAM } from '../../constants';
import {
  selectIsPlaying,
  selectPreviewTimeMs,
} from '../../stores/videoEditor/selectors';
import { useWebCodecsPreview } from '../../hooks/useWebCodecsPreview';
import { webcamLogger } from '../../utils/logger';
import { generateSquircleClipPath } from '../../utils/squircle';
import type { WebcamConfig, VisibilitySegment, CornerStyle } from '../../types';

interface WebcamOverlayProps {
  webcamVideoPath: string;
  config: WebcamConfig;
  containerWidth: number;
  containerHeight: number;
  /** Actual export composition width — used to scale the 16px margin proportionally */
  renderWidth: number;
  /** Opacity from scene transitions (0-1). When transitioning to camera-only mode, this fades to 0. */
  sceneOpacity?: number;
  /** Active screen zoom scale so the PiP can shrink with the zoom motion. */
  zoomScale?: number;
}

/**
 * Check if webcam should be visible at given timestamp.
 */
function isWebcamVisibleAt(segments: VisibilitySegment[], timestampMs: number): boolean {
  // If no segments defined, webcam is always visible
  if (segments.length === 0) return true;

  // Check if current time falls within any visible segment
  return segments.some(
    seg => seg.visible && timestampMs >= seg.startMs && timestampMs <= seg.endMs
  );
}

/**
 * Get position style based on position preset.
 * Handles corner presets and custom positions with proper centering.
 */
function getPositionStyle(
  position: WebcamConfig['position'],
  customX: number,
  customY: number,
  containerWidth: number,
  containerHeight: number,
  webcamWidth: number,
  webcamHeight: number,
  margin: number,
): React.CSSProperties {

  switch (position) {
    case 'topLeft':
      return { top: margin, left: margin };
    case 'topRight':
      return { top: margin, right: margin };
    case 'bottomLeft':
      return { bottom: margin, left: margin };
    case 'bottomRight':
      return { bottom: margin, right: margin };
    case 'custom': {
      // Calculate position with centering support
      // customX/Y of 0.5 means centered on that axis
      // customX/Y near 0 or 1 means edge-aligned with margin
      let left: number;
      let top: number;

      // Horizontal positioning
      if (customX <= 0.1) {
        left = margin;
      } else if (customX >= 0.9) {
        left = containerWidth - webcamWidth - margin;
      } else {
        // Center the webcam at the specified X position
        left = customX * containerWidth - webcamWidth / 2;
      }

      // Vertical positioning
      if (customY <= 0.1) {
        top = margin;
      } else if (customY >= 0.9) {
        top = containerHeight - webcamHeight - margin;
      } else {
        // Center the webcam at the specified Y position
        top = customY * containerHeight - webcamHeight / 2;
      }

      return { top, left };
    }
    default:
      return { bottom: margin, right: margin };
  }
}

/**
 * Generate CSS drop-shadow filter from a single shadow intensity value.
 * Creates an even spread shadow around all edges with sensible defaults.
 */
function getShadowFilter(
  shadow: number,
  width: number,
  height: number
): string {
  if (shadow <= 0) return 'none';

  const minDim = Math.min(width, height);
  const strength = shadow / 100;

  // Sensible defaults baked in:
  // - Blur scales with size for natural look
  // - Opacity stays subtle but visible
  const blur = strength * minDim * 0.15;
  const opacity = strength * 0.5; // Max 50% opacity at full strength

  // CSS drop-shadow with 0 offset for even spread around all edges
  return `drop-shadow(0 0 ${blur}px rgba(0, 0, 0, ${opacity}))`;
}

function getWebcamSizeFactorForZoom(zoomScale: number): number {
  const safeZoomScale = Math.max(zoomScale, 1);
  if (safeZoomScale <= 1.001) {
    return 1;
  }

  return Math.max(
    WEBCAM.MIN_ZOOM_SIZE_FACTOR,
    1 - (safeZoomScale - 1) * WEBCAM.ZOOM_SHRINK_PER_SCALE_UNIT,
  );
}

/**
 * Get shape style based on shape, rounding percentage, and corner style.
 * Implements proper squircle (superellipse) support like Cap.
 *
 * @param shape - The shape type (circle, roundedRectangle, rectangle, source)
 * @param rounding - Rounding percentage (0-100)
 * @param cornerStyle - Corner style (squircle or rounded)
 * @param width - Width of the element in pixels
 * @param height - Height of the element in pixels
 */
function getShapeStyle(
  shape: WebcamConfig['shape'],
  rounding: number,
  _cornerStyle: CornerStyle,
  width: number,
  height: number
): React.CSSProperties {
  switch (shape) {
    case 'circle':
      // True circle - always use borderRadius: 50%
      return { borderRadius: '50%' };

    case 'roundedRectangle': {
      // Squircle - use superellipse clip-path for proper squircle corners
      // The rounding controls how rounded the corners are (0-100%)
      return { clipPath: generateSquircleClipPath(rounding, width, height) };
    }

    case 'source': {
      // Source: native aspect ratio with configurable rounding
      // 0% rounding = sharp rectangle, 100% = full squircle
      if (rounding <= 2) {
        return { borderRadius: '0' };
      }
      return { clipPath: generateSquircleClipPath(rounding, width, height) };
    }

    case 'rectangle':
      // No rounding - sharp corners
      return { borderRadius: '0' };

    default:
      return { borderRadius: '50%' };
  }
}

/**
 * Webcam overlay component that syncs with playback time.
 * Supports proper squircle shapes using CSS clip-path with superellipse.
 */
export const WebcamOverlay = memo(function WebcamOverlay({
  webcamVideoPath,
  config,
  containerWidth,
  containerHeight,
  renderWidth,
  sceneOpacity = 1,
  zoomScale = 1,
}: WebcamOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDrawnTimeRef = useRef<number | null>(null);
  const rafIdRef = useRef<number>(0);

  const currentTimeMs = usePreviewOrPlaybackTime();
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const [shouldInitWebCodecs, setShouldInitWebCodecs] = useState(false);

  // WebCodecs preview for instant scrubbing
  const webCodecsVideoPath = shouldInitWebCodecs ? webcamVideoPath : null;
  const { getFrame, prefetchAround, isReady: webCodecsReady } = useWebCodecsPreview(webCodecsVideoPath);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    if (!shouldInitWebCodecs && previewTimeMs !== null) {
      setShouldInitWebCodecs(true);
    }
  }, [previewTimeMs, shouldInitWebCodecs]);

  // Track native video dimensions for "source" shape
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  // Callback to update dimensions from video element
  const updateVideoDimensions = useCallback((video: HTMLVideoElement) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const newDims = { width: video.videoWidth, height: video.videoHeight };
      setVideoDimensions(prev => {
        // Only update if different to avoid unnecessary re-renders
        if (prev?.width !== newDims.width || prev?.height !== newDims.height) {
          return newDims;
        }
        return prev;
      });
    }
  }, []);

  // Try to get dimensions from video ref (handles already-loaded videos)
  // Only run once on mount, not every render
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) {
      updateVideoDimensions(video);
    }
  }, [updateVideoDimensions]);

  // Check visibility at current time
  const isVisible = useMemo(() => {
    if (!config.enabled) return false;
    return isWebcamVisibleAt(config.visibilitySegments, currentTimeMs);
  }, [config.enabled, config.visibilitySegments, currentTimeMs]);

  // Prefetch frames when preview position changes (scrubbing)
  useEffect(() => {
    if (!webCodecsReady || isPlaying || previewTimeMs === null) return;
    prefetchAround(previewTimeMs);
  }, [webCodecsReady, isPlaying, previewTimeMs, prefetchAround]);

  // RAF-based canvas drawing for WebCodecs preview frames
  useEffect(() => {
    if (!webCodecsReady || isPlaying || previewTimeMs === null) {
      setHasFrame(false);
      return;
    }

    let active = true;
    let attempts = 0;
    const maxAttempts = 10;

    const tryDraw = () => {
      if (!active) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const frame = getFrame(previewTimeMs);

      if (frame) {
        if (lastDrawnTimeRef.current !== previewTimeMs) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            if (canvas.width !== frame.width || canvas.height !== frame.height) {
              canvas.width = frame.width;
              canvas.height = frame.height;
            }
            ctx.drawImage(frame, 0, 0);
            lastDrawnTimeRef.current = previewTimeMs;
          }
        }
        setHasFrame(true);
      } else {
        attempts++;
        if (attempts < maxAttempts) {
          rafIdRef.current = requestAnimationFrame(tryDraw);
        } else {
          setHasFrame(false);
        }
      }
    };

    tryDraw();

    return () => {
      active = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [webCodecsReady, isPlaying, previewTimeMs, getFrame]);

  // Convert file path to asset URL
  const videoSrc = useMemo(() => convertFileSrc(webcamVideoPath), [webcamVideoPath]);

  // Calculate webcam dimensions based on shape
  // - Source: uses native video aspect ratio with squircle rounding (like Cap)
  // - Rectangle: forces 16:9 aspect ratio
  // - Circle/RoundedRectangle: forces 1:1 square
  const zoomSizeFactor = useMemo(
    () => getWebcamSizeFactorForZoom(zoomScale),
    [zoomScale]
  );
  const { webcamWidth, webcamHeight } = useMemo(() => {
    const baseSize = containerWidth * config.size * zoomSizeFactor;

    if (config.shape === 'source' && videoDimensions) {
      // Source shape: preserve native webcam aspect ratio (like Cap)
      const aspect = videoDimensions.width / videoDimensions.height;
      if (aspect >= 1.0) {
        // Landscape webcam: width = base * aspect, height = base
        return { webcamWidth: baseSize * aspect, webcamHeight: baseSize };
      } else {
        // Portrait webcam: width = base, height = base / aspect
        return { webcamWidth: baseSize, webcamHeight: baseSize / aspect };
      }
    } else if (config.shape === 'rectangle') {
      // Rectangle: force 16:9 aspect ratio
      return { webcamWidth: baseSize * (16 / 9), webcamHeight: baseSize };
    } else {
      // Circle, RoundedRectangle, or Source (before video loads): force 1:1 square
      return { webcamWidth: baseSize, webcamHeight: baseSize };
    }
  }, [containerWidth, config.size, config.shape, videoDimensions, zoomSizeFactor]);

  // Scale the 16px margin to match export: at export resolution it's 16px,
  // in the scaled-down preview it must be proportionally the same.
  const scaledMargin = renderWidth > 0 ? 16 * (containerWidth / renderWidth) : 16;

  // Position style
  const positionStyle = useMemo(() =>
    getPositionStyle(
      config.position,
      config.customX,
      config.customY,
      containerWidth,
      containerHeight,
      webcamWidth,
      webcamHeight,
      scaledMargin,
    ),
    [config.position, config.customX, config.customY, containerWidth, containerHeight, webcamWidth, webcamHeight, scaledMargin]
  );

  // Shape style - calculate shape from rounding percentage and corner style
  const shapeStyle = useMemo(
    () => getShapeStyle(config.shape, config.rounding, config.cornerStyle, webcamWidth, webcamHeight),
    [config.shape, config.rounding, config.cornerStyle, webcamWidth, webcamHeight]
  );

  // Border: for polygon clip-path shapes, use an overlay div with inset
  // box-shadow (rendered on top so video doesn't cover it). For circle/rectangle,
  // CSS border works fine since there's no polygon clip.
  const usesPolygonClip = (config.shape === 'roundedRectangle') ||
    (config.shape === 'source' && config.rounding > 2);

  const borderStyle = useMemo((): React.CSSProperties => {
    if (!config.border.enabled) return {};
    return {
      border: `${config.border.width}px solid ${config.border.color}`,
    };
  }, [config.border]);

  const borderOverlayStyle = useMemo((): React.CSSProperties | null => {
    if (!config.border.enabled || !usesPolygonClip) return null;
    return {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 1,
      boxShadow: `inset 0 0 0 ${config.border.width}px ${config.border.color}`, // tauri-shadow-allow
    };
  }, [config.border, usesPolygonClip]);

  // Shadow filter - single slider controls everything
  const shadowFilter = useMemo(
    () => getShadowFilter(config.shadow, webcamWidth, webcamHeight),
    [config.shadow, webcamWidth, webcamHeight]
  );

  // Sync webcam video play/pause state with main playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVisible) return;

    if (isPlaying && video.paused) {
      // Read current time once from store, don't subscribe to updates
      const targetTime = useVideoEditorStore.getState().currentTimeMs / 1000;
      video.currentTime = targetTime;
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, isVisible]); // Re-run when visibility toggles so remounted video resumes.

  // Seek webcam video when scrubbing (not playing)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying || !isVisible) return;

    const targetTime = currentTimeMs / 1000;
    const diff = Math.abs(video.currentTime - targetTime);

    // Only seek if difference is significant
    if (diff > 0.1) {
      video.currentTime = targetTime;
    }
  }, [currentTimeMs, isPlaying, isVisible]);

  // Hide completely only when webcam is disabled via visibility segments
  // Keep mounted during scene transitions (sceneOpacity) to maintain video sync
  if (!isVisible) {
    return null;
  }

  // Determine if overlay should be visually hidden (but keep mounted for sync)
  const isHidden = sceneOpacity <= 0.01;

  return (
    // Outer wrapper for shadow filter (must be separate from clipped element)
    <div
      className="absolute z-20"
      style={{
        width: webcamWidth,
        height: webcamHeight,
        ...positionStyle,
        filter: shadowFilter,
        opacity: sceneOpacity,
        visibility: isHidden ? 'hidden' : 'visible',
        pointerEvents: isHidden ? 'none' : 'auto',
      }}
    >
      {/* Inner container with shape clipping and border */}
      <div
        className="w-full h-full overflow-hidden"
        style={{
          ...shapeStyle,
          ...borderStyle,
        }}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full h-full object-cover bg-zinc-800"
          style={{
            // Mirror flips horizontally
            transform: config.mirror ? 'scaleX(-1)' : 'none',
          }}
          muted
          playsInline
          preload="auto"
          onError={(e) => {
            webcamLogger.error('Video load error:', e.currentTarget.error);
          }}
          onLoadedMetadata={(e) => {
            updateVideoDimensions(e.currentTarget);
          }}
          onLoadedData={(e) => {
            // Also try here in case metadata event was missed
            updateVideoDimensions(e.currentTarget);
          }}
        />
        {/* WebCodecs preview canvas - shown during scrubbing for instant preview */}
        {!isPlaying && previewTimeMs !== null && webCodecsReady && hasFrame && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{
              transform: config.mirror ? 'scaleX(-1)' : 'none',
            }}
          />
        )}
        {/* Squircle border overlay — on top so video doesn't cover it */}
        {borderOverlayStyle && <div style={borderOverlayStyle} />}
      </div>
    </div>
  );
});
