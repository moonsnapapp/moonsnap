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
import { startWebCodecsCanvasPolling } from '../webCodecsCanvasPolling';

function isHoveringPreviewTrack(): boolean {
  return useVideoEditorStore.getState().hoveredTrack !== null;
}

function useLazyWebCodecsDecoder(previewTimeMs: number | null): boolean {
  const [shouldInitDecoder, setShouldInitDecoder] = useState(false);

  useEffect(() => {
    if (!shouldInitDecoder && previewTimeMs !== null) {
      setShouldInitDecoder(true);
    }
  }, [previewTimeMs, shouldInitDecoder]);

  return shouldInitDecoder;
}

function shouldUseWebCodecsPreviewFrame({
  isReady,
  isPlaying,
  previewTimeMs,
}: {
  isReady: boolean;
  isPlaying: boolean;
  previewTimeMs: number | null;
}) {
  return isReady && !isPlaying && previewTimeMs !== null && !isHoveringPreviewTrack();
}

function useWebCodecsFramePrefetch({
  isReady,
  isPlaying,
  previewTimeMs,
  getSourceTime,
  prefetchAround,
}: {
  isReady: boolean;
  isPlaying: boolean;
  previewTimeMs: number | null;
  getSourceTime: (timelineTimeMs: number) => number;
  prefetchAround: (timeMs: number) => void;
}) {
  useEffect(() => {
    if (!shouldUseWebCodecsPreviewFrame({ isReady, isPlaying, previewTimeMs })) return;
    if (previewTimeMs === null) return;

    prefetchAround(getSourceTime(previewTimeMs));
  }, [isReady, isPlaying, previewTimeMs, prefetchAround, getSourceTime]);
}

function useWebCodecsCanvasDrawing({
  canvasRef,
  rafIdRef,
  lastDrawnTimeRef,
  isReady,
  isPlaying,
  previewTimeMs,
  getSourceTime,
  getFrame,
  setHasFrame,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  rafIdRef: React.MutableRefObject<number>;
  lastDrawnTimeRef: React.MutableRefObject<number | null>;
  isReady: boolean;
  isPlaying: boolean;
  previewTimeMs: number | null;
  getSourceTime: (timelineTimeMs: number) => number;
  getFrame: ReturnType<typeof useWebCodecsPreview>['getFrame'];
  setHasFrame: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!shouldUseWebCodecsPreviewFrame({ isReady, isPlaying, previewTimeMs })) {
      setHasFrame(false);
      return;
    }
    if (previewTimeMs === null) return;

    return startWebCodecsCanvasPolling({
      canvasRef,
      rafIdRef,
      lastDrawnTimeRef,
      frameTimeMs: getSourceTime(previewTimeMs),
      getFrame,
      setHasFrame,
    });
  }, [canvasRef, rafIdRef, lastDrawnTimeRef, isReady, isPlaying, previewTimeMs, getFrame, getSourceTime, setHasFrame]);
}

function shouldShowWebCodecsCanvas({
  isPlaying,
  previewTimeMs,
  isReady,
  hasFrame,
}: {
  isPlaying: boolean;
  previewTimeMs: number | null;
  isReady: boolean;
  hasFrame: boolean;
}) {
  return !isPlaying && previewTimeMs !== null && isReady && hasFrame;
}

function getWebCodecsCanvasStyle(cropStyle: React.CSSProperties | undefined): React.CSSProperties {
  const hasCrop = cropStyle?.objectFit === 'cover';

  return {
    zIndex: 5,
    objectFit: hasCrop ? 'cover' : 'contain',
    ...cropStyle,
  };
}

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
  const shouldInitDecoder = useLazyWebCodecsDecoder(previewTimeMs);
  const decoderVideoPath = shouldInitDecoder ? videoPath : null;
  const { getFrame, prefetchAround, isReady } = useWebCodecsPreview(decoderVideoPath);

  // Prefetch frames when preview position changes (use source time).
  // Skip when hovering tracks — only prefetch for ruler scrubbing.
  useWebCodecsFramePrefetch({
    isReady,
    isPlaying,
    previewTimeMs,
    getSourceTime,
    prefetchAround,
  });

  // RAF-based canvas drawing - polls for frames without causing React re-renders.
  // Skip when hovering tracks — only draw for ruler scrubbing.
  useWebCodecsCanvasDrawing({
    canvasRef,
    rafIdRef,
    lastDrawnTimeRef,
    isReady,
    isPlaying,
    previewTimeMs,
    getSourceTime,
    getFrame,
    setHasFrame,
  });

  const showCanvas = shouldShowWebCodecsCanvas({ isPlaying, previewTimeMs, isReady, hasFrame });

  if (!showCanvas) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={getWebCodecsCanvasStyle(cropStyle)}
    />
  );
});

function hasCoverCropStyle(cropStyle?: React.CSSProperties) {
  return cropStyle?.objectFit === 'cover';
}

function getVideoNoZoomStyle({
  hidden,
  cropStyle,
}: {
  hidden?: boolean;
  cropStyle?: React.CSSProperties;
}): React.CSSProperties {
  return {
    minWidth: 320,
    minHeight: 180,
    opacity: hidden ? 0 : 1,
    pointerEvents: hidden ? 'none' : 'auto',
    objectFit: hasCoverCropStyle(cropStyle) ? 'cover' : 'contain',
    ...cropStyle,
  };
}

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
  // Video seeking is handled by usePlaybackSync — no duplicate seek here.
  // Default to contain, but crop style can override with cover + position
  return (
    <video
      ref={videoRef}
      src={videoSrc}
      className="w-full h-full cursor-pointer bg-[var(--polar-ice)]"
      style={getVideoNoZoomStyle({ hidden, cropStyle })}
      onClick={onVideoClick}
      playsInline
      preload="auto"
    />
  );
});

/**
 * Fullscreen webcam display for cameraOnly scene mode.
 */
function playFullscreenWebcam(video: HTMLVideoElement, getSourceTime: (timeMs: number) => number) {
  const timelineTime = useVideoEditorStore.getState().currentTimeMs;
  const sourceTime = getSourceTime(timelineTime);
  video.currentTime = sourceTime / 1000;
  video.play().catch(() => {});
}

function shouldPlayFullscreenWebcam(video: HTMLVideoElement, isPlaying: boolean): boolean {
  return isPlaying && video.paused;
}

function shouldPauseFullscreenWebcam(video: HTMLVideoElement, isPlaying: boolean): boolean {
  return !isPlaying && !video.paused;
}

function syncFullscreenWebcamPlayback(
  video: HTMLVideoElement | null,
  isPlaying: boolean,
  getSourceTime: (timeMs: number) => number
) {
  if (!video) return;

  if (shouldPlayFullscreenWebcam(video, isPlaying)) {
    playFullscreenWebcam(video, getSourceTime);
    return;
  }

  if (shouldPauseFullscreenWebcam(video, isPlaying)) {
    video.pause();
  }
}

function seekFullscreenWebcamIfNeeded(
  video: HTMLVideoElement | null,
  targetTime: number,
  isPlaying: boolean
) {
  if (!video || isPlaying) return;

  const diff = Math.abs(video.currentTime - targetTime);
  if (diff > 0.05) {
    video.currentTime = targetTime;
  }
}

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
    syncFullscreenWebcamPlayback(videoRef.current, isPlaying, getSourceTime);
  }, [isPlaying, getSourceTime]); // Remove currentTimeMs - only respond to play/pause changes

  // Seek webcam video when scrubbing (not playing)
  // Convert timeline time to source time before seeking
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    const sourceTimeMs = getSourceTime(currentTimeMs);
    const targetTime = sourceTimeMs / 1000;
    seekFullscreenWebcamIfNeeded(video, targetTime, isPlaying);
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
