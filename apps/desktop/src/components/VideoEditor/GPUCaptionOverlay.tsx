import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectCaptionSegments,
  selectCaptionSettings,
  selectTimelineSegments,
} from '../../stores/videoEditor/selectors';
import type { VideoEditorState } from '../../stores/videoEditor/types';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { usePreviewStream } from '../../hooks/usePreviewStream';
import { videoEditorLogger } from '../../utils/logger';
import { getRoundedPreviewDimensions } from './previewDimensions';
import { remapCaptionSegmentsToTimeline } from '@/utils/captionTimeline';

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

function canFlushCaptionOverlayQueue(
  canUseGpu: boolean,
  isConnected: boolean,
  enabled: boolean
): boolean {
  return canUseGpu && isConnected && enabled;
}

function recordCaptionOverlayRenderSuccess(
  consecutiveRenderErrorsRef: React.MutableRefObject<number>
): void {
  consecutiveRenderErrorsRef.current = 0;
}

function recordCaptionOverlayRenderFailure({
  error,
  operation,
  consecutiveRenderErrorsRef,
  setGpuFailed,
}: {
  error: unknown;
  operation: string;
  consecutiveRenderErrorsRef: React.MutableRefObject<number>;
  setGpuFailed: (failed: boolean) => void;
}): void {
  videoEditorLogger.warn(`[CaptionParity] ${operation} failed:`, error);
  consecutiveRenderErrorsRef.current += 1;
  if (consecutiveRenderErrorsRef.current >= 3) {
    setGpuFailed(true);
  }
}

function shouldFlushQueuedRender(
  queuedArgsRef: React.MutableRefObject<RenderCaptionOverlayArgs | null>
): boolean {
  return queuedArgsRef.current !== null;
}

function canStartCaptionOverlayRender({
  canUseGpu,
  isConnected,
  enabled,
  renderInFlightRef,
  captionDataSyncInFlightRef,
}: {
  canUseGpu: boolean;
  isConnected: boolean;
  enabled: boolean;
  renderInFlightRef: React.MutableRefObject<boolean>;
  captionDataSyncInFlightRef: React.MutableRefObject<boolean>;
}) {
  return (
    canFlushCaptionOverlayQueue(canUseGpu, isConnected, enabled) &&
    !renderInFlightRef.current &&
    !captionDataSyncInFlightRef.current
  );
}

function cancelCaptionOverlayRaf(rafRef: React.MutableRefObject<number | null>) {
  if (rafRef.current === null) return;
  cancelAnimationFrame(rafRef.current);
  rafRef.current = null;
}

function getCaptionOverlayFrameArgs(
  currentTimeMs: number,
  roundedRenderWidth: number,
  roundedRenderHeight: number
): RenderCaptionOverlayArgs {
  return {
    timeMs: Math.max(0, Math.floor(currentTimeMs)),
    width: roundedRenderWidth,
    height: roundedRenderHeight,
  };
}

function isGpuCaptionOverlayActive({
  canUseGpu,
  enabled,
  isConnected,
  hasFrame,
}: {
  canUseGpu: boolean;
  enabled: boolean;
  isConnected: boolean;
  hasFrame: boolean;
}) {
  return canUseGpu && enabled && isConnected && hasFrame;
}

function useCaptionOverlayActiveChange(
  isActive: boolean,
  onActiveChange: GPUCaptionOverlayProps['onActiveChange']
) {
  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);
}

function GPUCaptionOverlayCanvas({
  canvasRef,
  roundedRenderWidth,
  roundedRenderHeight,
  roundedDisplayWidth,
  roundedDisplayHeight,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  roundedRenderWidth: number;
  roundedRenderHeight: number;
  roundedDisplayWidth: number;
  roundedDisplayHeight: number;
}) {
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
}

export const GPUCaptionOverlay = memo(function GPUCaptionOverlay({
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  onActiveChange,
}: GPUCaptionOverlayProps) {
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const timelineSegments = useVideoEditorStore(selectTimelineSegments);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const [gpuFailed, setGpuFailed] = useState(false);
  const timelineCaptionSegments = useMemo(
    () => remapCaptionSegmentsToTimeline(captionSegments, timelineSegments),
    [captionSegments, timelineSegments]
  );

  const canUseGpu = !gpuFailed;
  const {
    roundedRenderWidth,
    roundedRenderHeight,
    roundedDisplayWidth,
    roundedDisplayHeight,
  } = getRoundedPreviewDimensions(renderWidth, renderHeight, displayWidth, displayHeight);

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
  const isActive = isGpuCaptionOverlayActive({
    canUseGpu,
    enabled: captionSettings.enabled,
    isConnected,
    hasFrame,
  });

  useCaptionOverlayActiveChange(isActive, onActiveChange);

  const flushQueuedRender = useCallback(() => {
    if (!canStartCaptionOverlayRender({
      canUseGpu,
      isConnected,
      enabled: captionSettings.enabled,
      renderInFlightRef,
      captionDataSyncInFlightRef,
    })) {
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
        recordCaptionOverlayRenderSuccess(consecutiveRenderErrorsRef);
      })
      .catch((error) => {
        recordCaptionOverlayRenderFailure({
          error,
          operation: 'render_caption_overlay_frame',
          consecutiveRenderErrorsRef,
          setGpuFailed,
        });
      })
      .finally(() => {
        renderInFlightRef.current = false;
        if (shouldFlushQueuedRender(queuedArgsRef)) {
          flushQueuedRender();
        }
      });
  }, [canUseGpu, isConnected, captionSettings.enabled]);

  const flushQueuedCaptionData = useCallback(() => {
    if (!canFlushCaptionOverlayQueue(canUseGpu, isConnected, captionSettings.enabled)) {
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
        recordCaptionOverlayRenderSuccess(consecutiveRenderErrorsRef);
      })
      .catch((error) => {
        recordCaptionOverlayRenderFailure({
          error,
          operation: 'set_caption_overlay_data',
          consecutiveRenderErrorsRef,
          setGpuFailed,
        });
      })
      .finally(() => {
        captionDataSyncInFlightRef.current = false;
        if (queuedCaptionDataRef.current) {
          flushQueuedCaptionData();
        } else if (shouldFlushQueuedRender(queuedArgsRef)) {
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
      segments: timelineCaptionSegments,
      settings: captionSettings,
    };
    flushQueuedCaptionData();
  }, [
    canUseGpu,
    captionSettings,
    flushQueuedCaptionData,
    isConnected,
    timelineCaptionSegments,
  ]);

  useEffect(() => {
    if (!canUseGpu || !captionSettings.enabled || !isConnected) {
      return;
    }

    queuedArgsRef.current = getCaptionOverlayFrameArgs(
      currentTimeMs,
      roundedRenderWidth,
      roundedRenderHeight
    );

    cancelCaptionOverlayRaf(rafRef);

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushQueuedRender();
    });

    return () => cancelCaptionOverlayRaf(rafRef);
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
    <GPUCaptionOverlayCanvas
      canvasRef={canvasRef}
      roundedRenderWidth={roundedRenderWidth}
      roundedRenderHeight={roundedRenderHeight}
      roundedDisplayWidth={roundedDisplayWidth}
      roundedDisplayHeight={roundedDisplayHeight}
    />
  );
});

export default GPUCaptionOverlay;
