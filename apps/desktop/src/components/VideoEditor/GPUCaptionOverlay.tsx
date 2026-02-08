import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { usePreviewStream } from '../../hooks/usePreviewStream';
import { videoEditorLogger } from '../../utils/logger';

interface GPUCaptionOverlayProps {
  containerWidth: number;
  containerHeight: number;
  onActiveChange?: (active: boolean) => void;
}

type RenderCaptionOverlayArgs = {
  timeMs: number;
  width: number;
  height: number;
  segments: ReturnType<typeof useVideoEditorStore.getState>['captionSegments'];
  settings: ReturnType<typeof useVideoEditorStore.getState>['captionSettings'];
};

export const GPUCaptionOverlay = memo(function GPUCaptionOverlay({
  containerWidth,
  containerHeight,
  onActiveChange,
}: GPUCaptionOverlayProps) {
  const captionSegments = useVideoEditorStore((s) => s.captionSegments);
  const captionSettings = useVideoEditorStore((s) => s.captionSettings);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const [gpuFailed, setGpuFailed] = useState(false);

  const canUseGpu = !gpuFailed;
  const roundedWidth = Math.max(1, Math.round(containerWidth));
  const roundedHeight = Math.max(1, Math.round(containerHeight));

  const { canvasRef, hasFrame, isConnected, initPreview, shutdown } = usePreviewStream({
    onError: (error) => {
      videoEditorLogger.warn('[CaptionParity] GPU caption overlay fallback:', error);
      setGpuFailed(true);
    },
  });

  const renderInFlightRef = useRef(false);
  const queuedArgsRef = useRef<RenderCaptionOverlayArgs | null>(null);
  const rafRef = useRef<number | null>(null);
  const isActive = canUseGpu && captionSettings.enabled && hasFrame;

  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  const flushQueuedRender = useCallback(() => {
    if (!canUseGpu || !isConnected || !captionSettings.enabled) {
      return;
    }
    if (renderInFlightRef.current) {
      return;
    }

    const args = queuedArgsRef.current;
    if (!args) {
      return;
    }

    queuedArgsRef.current = null;
    renderInFlightRef.current = true;

    invoke('render_caption_overlay', args)
      .catch((error) => {
        videoEditorLogger.warn('[CaptionParity] render_caption_overlay failed:', error);
        setGpuFailed(true);
      })
      .finally(() => {
        renderInFlightRef.current = false;
        if (queuedArgsRef.current) {
          flushQueuedRender();
        }
      });
  }, [canUseGpu, isConnected, captionSettings.enabled]);

  useEffect(() => {
    if (!canUseGpu || !captionSettings.enabled) {
      return;
    }

    let cancelled = false;

    initPreview()
      .catch((error) => {
        if (!cancelled) {
          videoEditorLogger.warn('[CaptionParity] init_preview failed:', error);
          setGpuFailed(true);
        }
      });

    return () => {
      cancelled = true;
      shutdown().catch((error) => {
        videoEditorLogger.warn('[CaptionParity] shutdown_preview failed:', error);
      });
    };
  }, [canUseGpu, captionSettings.enabled, initPreview, shutdown]);

  useEffect(() => {
    if (!canUseGpu || !captionSettings.enabled || !isConnected) {
      return;
    }

    queuedArgsRef.current = {
      timeMs: Math.max(0, Math.floor(currentTimeMs)),
      width: roundedWidth,
      height: roundedHeight,
      segments: captionSegments,
      settings: captionSettings,
    };

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushQueuedRender();
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    canUseGpu,
    captionSettings,
    captionSegments,
    currentTimeMs,
    flushQueuedRender,
    isConnected,
    roundedHeight,
    roundedWidth,
  ]);

  if (!isActive) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 z-50 pointer-events-none"
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${roundedWidth}px`,
          height: `${roundedHeight}px`,
        }}
      />
    </div>
  );
});

export default GPUCaptionOverlay;
