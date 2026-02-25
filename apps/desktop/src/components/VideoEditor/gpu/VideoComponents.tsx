/**
 * Video helper components for GPUVideoPreview.
 *
 * These memoized components handle video display without zoom transform.
 * Zoom is applied at the frame wrapper level in SceneModeRenderer.
 */

import { memo, useRef, useEffect, useState, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import {
  selectIsPlaying,
  selectPreviewTimeMs,
} from '../../../stores/videoEditor/selectors';
import { usePreviewOrPlaybackTime } from '../../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../../hooks/useTimelineSourceTime';
import { useWebCodecsPreview } from '../../../hooks/useWebCodecsPreview';

/**
 * WebCodecs-accelerated preview canvas for instant scrubbing.
 * Shows pre-decoded frames during timeline scrubbing for zero-latency preview.
 * Uses RAF polling instead of state-driven updates to avoid re-render overhead.
 * Zoom is applied at the frame wrapper level, not individually.
 */
export const WebCodecsCanvasNoZoom = memo(function WebCodecsCanvasNoZoom({
  videoPath,
  cropStyle,
}: {
  videoPath: string | null;
  cropStyle?: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDrawnTimeRef = useRef<number | null>(null);
  const rafIdRef = useRef<number>(0);
  const [hasFrame, setHasFrame] = useState(false);

  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const getSourceTime = useTimelineToSourceTime();
  const { getFrame, prefetchAround, isReady } = useWebCodecsPreview(videoPath);

  // Prefetch frames when preview position changes (use source time)
  useEffect(() => {
    if (!isReady || isPlaying || previewTimeMs === null) return;
    const sourceTimeMs = getSourceTime(previewTimeMs);
    prefetchAround(sourceTimeMs);
  }, [isReady, isPlaying, previewTimeMs, prefetchAround, getSourceTime]);

  // RAF-based canvas drawing - polls for frames without causing React re-renders
  useEffect(() => {
    if (!isReady || isPlaying || previewTimeMs === null) {
      setHasFrame(false);
      return;
    }

    // Convert timeline time to source time for fetching the correct frame
    const sourceTimeMs = getSourceTime(previewTimeMs);

    let active = true;
    let attempts = 0;
    const maxAttempts = 10;

    const tryDraw = () => {
      if (!active) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const frame = getFrame(sourceTimeMs);

      if (frame) {
        if (lastDrawnTimeRef.current !== sourceTimeMs) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            if (canvas.width !== frame.width || canvas.height !== frame.height) {
              canvas.width = frame.width;
              canvas.height = frame.height;
            }
            ctx.drawImage(frame, 0, 0);
            lastDrawnTimeRef.current = sourceTimeMs;
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
  }, [isReady, isPlaying, previewTimeMs, getFrame, getSourceTime]);

  const showCanvas = !isPlaying && previewTimeMs !== null && isReady && hasFrame;

  if (!showCanvas) return null;

  // Check if crop style is applied (object-cover with position)
  const hasCrop = cropStyle && cropStyle.objectFit === 'cover';

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{
        zIndex: 5,
        objectFit: hasCrop ? 'cover' : 'contain',
        ...cropStyle,
      }}
    />
  );
});

/**
 * Memoized video element without zoom transform.
 * Zoom is applied at the frame wrapper level instead.
 * Keeps video seeked for scrubbing and mask overlay sampling.
 */
export const VideoNoZoom = memo(function VideoNoZoom({
  videoRef,
  videoSrc,
  onVideoClick,
  hidden,
  cropStyle,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  onVideoClick: () => void;
  hidden?: boolean;
  cropStyle?: React.CSSProperties;
}) {
  const currentTimeMs = usePreviewOrPlaybackTime();
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const getSourceTime = useTimelineToSourceTime();

  // Keep video seeked even when hidden (needed for mask overlay sampling)
  // Convert timeline time to source time before seeking
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    const sourceTimeMs = getSourceTime(currentTimeMs);
    const targetTime = sourceTimeMs / 1000;
    const diff = Math.abs(video.currentTime - targetTime);

    // Seek when difference is noticeable
    if (diff > 0.05) {
      video.currentTime = targetTime;
    }
  }, [videoRef, currentTimeMs, isPlaying, getSourceTime]);

  // Default to contain, but crop style can override with cover + position
  const hasCrop = cropStyle && cropStyle.objectFit === 'cover';

  return (
    <video
      ref={videoRef}
      src={videoSrc}
      className="w-full h-full cursor-pointer bg-[var(--polar-ice)]"
      style={{
        minWidth: 320,
        minHeight: 180,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        objectFit: hasCrop ? 'cover' : 'contain',
        ...cropStyle,
      }}
      onClick={onVideoClick}
      playsInline
      preload="auto"
    />
  );
});

/**
 * Fullscreen webcam display for cameraOnly scene mode.
 */
export const FullscreenWebcam = memo(function FullscreenWebcam({
  webcamVideoPath,
  mirror,
  onClick,
}: {
  webcamVideoPath: string;
  mirror?: boolean;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const getSourceTime = useTimelineToSourceTime();

  const videoSrc = useMemo(() => convertFileSrc(webcamVideoPath), [webcamVideoPath]);

  // Sync webcam video play/pause state with main playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && video.paused) {
      // Read current time once from store, don't subscribe to updates
      const timelineTime = useVideoEditorStore.getState().currentTimeMs;
      const sourceTime = getSourceTime(timelineTime);
      video.currentTime = sourceTime / 1000;
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, getSourceTime]); // Remove currentTimeMs - only respond to play/pause changes

  // Seek webcam video when scrubbing (not playing)
  // Convert timeline time to source time before seeking
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    const sourceTimeMs = getSourceTime(currentTimeMs);
    const targetTime = sourceTimeMs / 1000;
    const diff = Math.abs(video.currentTime - targetTime);

    // Use smaller threshold for more responsive scrubbing
    if (diff > 0.05) {
      video.currentTime = targetTime;
    }
  }, [currentTimeMs, isPlaying, getSourceTime]);

  return (
    <video
      ref={videoRef}
      src={videoSrc}
      className="w-full h-full object-cover cursor-pointer bg-[var(--polar-mist)]"
      style={{
        transform: mirror ? 'scaleX(-1)' : 'none',
      }}
      onClick={onClick}
      muted
      playsInline
      preload="auto"
    />
  );
});
