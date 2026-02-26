import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { selectCaptionSegments, selectCaptionSettings } from '../../stores/videoEditor/selectors';
import type { VideoEditorState } from '../../stores/videoEditor/types';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { usePreviewStream } from '../../hooks/usePreviewStream';
import { videoEditorLogger } from '../../utils/logger';

interface GPUCaptionOverlayProps {
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
  onActiveChange?: (active: boolean) => void;
}

type RenderCaptionOverlayArgs = {
  timeMs: number;
  width: number;
  height: number;
};

type CaptionOverlayDataArgs = {
  segments: VideoEditorState['captionSegments'];
  settings: VideoEditorState['captionSettings'];
};

export const GPUCaptionOverlay = memo(function GPUCaptionOverlay({
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  onActiveChange,
}: GPUCaptionOverlayProps) {
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const [gpuFailed, setGpuFailed] = useState(false);

  const canUseGpu = !gpuFailed;
  const roundedRenderWidth = Math.max(1, Math.round(renderWidth));
  const roundedRenderHeight = Math.max(1, Math.round(renderHeight));
  const roundedDisplayWidth = Math.max(1, Math.round(displayWidth));
  const roundedDisplayHeight = Math.max(1, Math.round(displayHeight));

  const { canvasRef, hasFrame, isConnected, initPreview, shutdown } = usePreviewStream({
    onError: (error) => {
      videoEditorLogger.warn('[CaptionParity] GPU caption overlay fallback:', error);
      setGpuFailed(true);
    },
  });

  const renderInFlightRef = useRef(false);
  const queuedArgsRef = useRef<RenderCaptionOverlayArgs | null>(null);
  const captionDataSyncInFlightRef = useRef(false);
  const queuedCaptionDataRef = useRef<CaptionOverlayDataArgs | null>(null);
  const rafRef = useRef<number | null>(null);
  const consecutiveRenderErrorsRef = useRef(0);
  // Only show GPU output when stream is connected and has produced at least one frame.
  const isActive = canUseGpu && captionSettings.enabled && isConnected && hasFrame;

  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  const flushQueuedRender = useCallback(() => {
    if (!canUseGpu || !isConnected || !captionSettings.enabled) {
      return;
    }
    if (renderInFlightRef.current || captionDataSyncInFlightRef.current) {
      return;
    }

    const args = queuedArgsRef.current;
    if (!args) {
      return;
    }

    queuedArgsRef.current = null;
    renderInFlightRef.current = true;

    invoke('render_caption_overlay_frame', args)
      .then(() => {
        consecutiveRenderErrorsRef.current = 0;
      })
      .catch((error) => {
        videoEditorLogger.warn('[CaptionParity] render_caption_overlay_frame failed:', error);
        consecutiveRenderErrorsRef.current += 1;
        // Allow transient command/stream hiccups without permanently switching to CSS.
        if (consecutiveRenderErrorsRef.current >= 3) {
          setGpuFailed(true);
        }
      })
      .finally(() => {
        renderInFlightRef.current = false;
        if (queuedArgsRef.current) {
          flushQueuedRender();
        }
      });
  }, [canUseGpu, isConnected, captionSettings.enabled]);

  const flushQueuedCaptionData = useCallback(() => {
    if (!canUseGpu || !isConnected || !captionSettings.enabled) {
      return;
    }
    if (captionDataSyncInFlightRef.current) {
      return;
    }

    const args = queuedCaptionDataRef.current;
    if (!args) {
      return;
    }

    queuedCaptionDataRef.current = null;
    captionDataSyncInFlightRef.current = true;

    invoke('set_caption_overlay_data', args)
      .then(() => {
        consecutiveRenderErrorsRef.current = 0;
      })
      .catch((error) => {
        videoEditorLogger.warn('[CaptionParity] set_caption_overlay_data failed:', error);
        consecutiveRenderErrorsRef.current += 1;
        if (consecutiveRenderErrorsRef.current >= 3) {
          setGpuFailed(true);
        }
      })
      .finally(() => {
        captionDataSyncInFlightRef.current = false;
        if (queuedCaptionDataRef.current) {
          flushQueuedCaptionData();
        } else if (queuedArgsRef.current) {
          flushQueuedRender();
        }
      });
  }, [canUseGpu, isConnected, captionSettings.enabled, flushQueuedRender]);

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

    queuedCaptionDataRef.current = {
      segments: captionSegments,
      settings: captionSettings,
    };
    flushQueuedCaptionData();
  }, [
    canUseGpu,
    captionSettings,
    captionSegments,
    flushQueuedCaptionData,
    isConnected,
  ]);

  useEffect(() => {
    if (!canUseGpu || !captionSettings.enabled || !isConnected) {
      return;
    }

    queuedArgsRef.current = {
      timeMs: Math.max(0, Math.floor(currentTimeMs)),
      width: roundedRenderWidth,
      height: roundedRenderHeight,
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
    currentTimeMs,
    flushQueuedRender,
    isConnected,
    roundedRenderHeight,
    roundedRenderWidth,
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
        width={roundedRenderWidth}
        height={roundedRenderHeight}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${roundedDisplayWidth}px`,
          height: `${roundedDisplayHeight}px`,
        }}
      />
    </div>
  );
});

export default GPUCaptionOverlay;
