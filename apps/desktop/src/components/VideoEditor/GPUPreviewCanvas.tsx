/**
 * GPUPreviewCanvas - Displays GPU-rendered preview frames from WebSocket stream.
 *
 * This component receives frames from the Rust backend via WebSocket,
 * ensuring the preview exactly matches the exported video (text rendered by glyphon).
 *
 * Uses Cap's approach: calculate exact pixel dimensions instead of object-contain.
 */

import { memo, useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePreviewStream } from '../../hooks/usePreviewStream';
import type { VideoProject } from '../../types';
import { videoEditorLogger } from '@/utils/logger';

interface GPUPreviewCanvasProps {
  /** Video project configuration */
  project: VideoProject | null;
  /** Current playback time in milliseconds */
  currentTimeMs: number;
  /** Container width in pixels */
  containerWidth: number;
  /** Container height in pixels */
  containerHeight: number;
  /** Whether to enable GPU preview (falls back to HTML video if false) */
  enabled?: boolean;
  /** Whether currently playing (uses text-only mode for performance) */
  isPlaying?: boolean;
  /** Zoom style to apply (matches video zoom) */
  zoomStyle?: React.CSSProperties;
  /** Callback when preview is ready */
  onReady?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

type InitStateRef = React.MutableRefObject<'idle' | 'initializing' | 'ready' | 'error'>;

function canSyncGpuPreviewProject({
  enabled,
  project,
  initStateRef,
  isConnected,
}: {
  enabled: boolean;
  project: VideoProject | null;
  initStateRef: InitStateRef;
  isConnected: boolean;
}) {
  return Boolean(enabled && project && initStateRef.current === 'ready' && isConnected);
}

function getProjectTextVersion(project: VideoProject | null) {
  return project?.text?.segments
    ? JSON.stringify(
      project.text.segments.map((s) => ({
        start: s.start,
        end: s.end,
        content: s.content,
        center: s.center,
        size: s.size,
        fontSize: s.fontSize,
        fadeDuration: s.fadeDuration,
        animation: s.animation,
        typewriterCharsPerSecond: s.typewriterCharsPerSecond,
      }))
    )
    : null;
}

function syncNewGpuPreviewProject({
  project,
  textVersion,
  currentTimeMs,
  lastTextVersionRef,
  doSetProject,
}: {
  project: VideoProject;
  textVersion: string | null;
  currentTimeMs: number;
  lastTextVersionRef: React.MutableRefObject<string | null>;
  doSetProject: (project: VideoProject, timeMs: number, isNewProject: boolean) => void;
}) {
  lastTextVersionRef.current = textVersion;
  doSetProject(project, currentTimeMs, true);
}

function scheduleGpuPreviewTextSync({
  project,
  textVersion,
  currentTimeMs,
  lastTextVersionRef,
  doSetProject,
}: {
  project: VideoProject;
  textVersion: string | null;
  currentTimeMs: number;
  lastTextVersionRef: React.MutableRefObject<string | null>;
  doSetProject: (project: VideoProject, timeMs: number, isNewProject: boolean) => void;
}) {
  const timeoutId = setTimeout(() => {
    lastTextVersionRef.current = textVersion;
    doSetProject(project, currentTimeMs, false);
  }, 300);

  return () => clearTimeout(timeoutId);
}

function syncGpuPreviewProjectChange({
  project,
  projectId,
  textVersion,
  currentTimeMs,
  lastTextVersionRef,
  doSetProject,
}: {
  project: VideoProject;
  projectId: string | null;
  textVersion: string | null;
  currentTimeMs: number;
  lastTextVersionRef: React.MutableRefObject<string | null>;
  doSetProject: (project: VideoProject, timeMs: number, isNewProject: boolean) => void;
}) {
  const isNewProject = projectId !== project.id;
  const textChanged = lastTextVersionRef.current !== textVersion;

  if (isNewProject) {
    syncNewGpuPreviewProject({
      project,
      textVersion,
      currentTimeMs,
      lastTextVersionRef,
      doSetProject,
    });
    return undefined;
  }

  return textChanged
    ? scheduleGpuPreviewTextSync({
      project,
      textVersion,
      currentTimeMs,
      lastTextVersionRef,
      doSetProject,
    })
    : undefined;
}

function shouldRenderGpuPreviewFrame({
  enabled,
  isConnected,
  initStateRef,
  projectId,
}: {
  enabled: boolean;
  isConnected: boolean;
  initStateRef: InitStateRef;
  projectId: string | null;
}) {
  return Boolean(isConnected && enabled && initStateRef.current === 'ready' && projectId);
}

function getGpuPreviewRenderInterval(isPlaying: boolean) {
  return isPlaying ? 66 : 16;
}

function shouldThrottleGpuPreviewRender(
  now: number,
  lastRenderTime: number,
  isPlaying: boolean
) {
  return now - lastRenderTime < getGpuPreviewRenderInterval(isPlaying);
}

function getGpuPreviewFrameSize(width: number | undefined, height: number | undefined) {
  return {
    width: width ?? 1920,
    height: height ?? 1080,
  };
}

function fitGpuPreviewDisplaySize({
  frameSize,
  containerWidth,
  containerHeight,
}: {
  frameSize: { width: number; height: number };
  containerWidth: number;
  containerHeight: number;
}) {
  if (containerWidth === 0 || containerHeight === 0) return frameSize;
  return fitFrameInsideContainer(frameSize, { width: containerWidth, height: containerHeight });
}

function fitFrameInsideContainer(
  frameSize: { width: number; height: number },
  containerSize: { width: number; height: number }
) {
  const containerAspect = containerSize.width / containerSize.height;
  const frameAspect = frameSize.width / frameSize.height;

  return frameAspect < containerAspect
    ? { height: containerSize.height, width: containerSize.height * frameAspect }
    : { width: containerSize.width, height: containerSize.width / frameAspect };
}

function isGpuPreviewInitializingOrReady(initStateRef: InitStateRef) {
  return initStateRef.current === 'initializing' || initStateRef.current === 'ready';
}

function markGpuPreviewReady(
  initStateRef: InitStateRef,
  onReadyRef: React.MutableRefObject<GPUPreviewCanvasProps['onReady']>
) {
  initStateRef.current = 'ready';
  onReadyRef.current?.();
}

function markGpuPreviewError(
  initStateRef: InitStateRef,
  onErrorRef: React.MutableRefObject<GPUPreviewCanvasProps['onError']>,
  error: unknown
) {
  videoEditorLogger.error('GPUPreviewCanvas failed to initialize:', error);
  initStateRef.current = 'error';
  onErrorRef.current?.(String(error));
}

function isGpuPreviewReady(initStateRef: InitStateRef) {
  return initStateRef.current === 'ready';
}

async function setGpuPreviewProject(project: VideoProject) {
  await invoke('set_preview_project', { project });
}

async function renderGpuPreviewFrame(timeMs: number) {
  await invoke('render_preview_frame', { timeMs: Math.floor(timeMs) });
}

function recordNewGpuPreviewProject(
  project: VideoProject,
  setProjectId: React.Dispatch<React.SetStateAction<string | null>>,
) {
  setProjectId(project.id);
  videoEditorLogger.info('GPUPreviewCanvas project set:', project.id);
}

function handleGpuPreviewProjectError(
  error: unknown,
  onErrorRef: React.MutableRefObject<GPUPreviewCanvasProps['onError']>,
) {
  videoEditorLogger.error('GPUPreviewCanvas failed to set project:', error);
  onErrorRef.current?.(String(error));
}

/**
 * Canvas-based preview that displays GPU-rendered frames.
 * Sizes canvas to exact pixel dimensions to fill container without letterboxing.
 */
export const GPUPreviewCanvas = memo(function GPUPreviewCanvas({
  project,
  currentTimeMs,
  containerWidth,
  containerHeight,
  enabled = true,
  isPlaying = false,
  zoomStyle,
  onReady,
  onError,
}: GPUPreviewCanvasProps) {
  // Track initialization state to prevent re-initialization
  const initStateRef = useRef<'idle' | 'initializing' | 'ready' | 'error'>('idle');
  // Track which project is set (state to trigger re-renders)
  const [projectId, setProjectId] = useState<string | null>(null);
  // Track text content version to detect changes
  const lastTextVersionRef = useRef<string | null>(null);

  const {
    canvasRef,
    isConnected,
    hasFrame,
    initPreview,
    renderFrame,
    shutdown,
  } = usePreviewStream({
    onFrame: (_frameNumber) => {
      // Frame received - could update UI if needed
    },
    onError: (error) => {
      videoEditorLogger.error('GPUPreviewCanvas error:', error);
      initStateRef.current = 'error';
      onError?.(error);
    },
  });

  // Calculate display size for the canvas (Cap's approach: exact pixel dimensions)
  // CSS handles padding/background, GPU canvas only shows video content.
  // Display size is based on video dimensions to fill the container area.
  const displaySize = useMemo(() => {
    return fitGpuPreviewDisplaySize({
      frameSize: getGpuPreviewFrameSize(
        project?.sources.originalWidth,
        project?.sources.originalHeight
      ),
      containerWidth,
      containerHeight,
    });
  }, [project?.sources.originalWidth, project?.sources.originalHeight, containerWidth, containerHeight]);

  // Stable callbacks that don't change on every render
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onReady, onError]);

  // Initialize preview system once
  const doInit = useCallback(async () => {
    if (isGpuPreviewInitializingOrReady(initStateRef)) {
      return;
    }

    initStateRef.current = 'initializing';

    try {
      await initPreview();
      markGpuPreviewReady(initStateRef, onReadyRef);
    } catch (error) {
      markGpuPreviewError(initStateRef, onErrorRef, error);
    }
  }, [initPreview]);

  // Set project when it changes (by ID or content)
  const doSetProject = useCallback(async (proj: VideoProject, timeMs: number, isNewProject: boolean) => {
    if (!isGpuPreviewReady(initStateRef)) {
      return;
    }

    try {
      await setGpuPreviewProject(proj);

      // Only update state if this is a new project (ID changed)
      // This prevents re-renders on text edits
      if (isNewProject) {
        recordNewGpuPreviewProject(proj, setProjectId);
      }

      // Render a frame immediately after setting project
      await renderGpuPreviewFrame(timeMs);
    } catch (error) {
      handleGpuPreviewProjectError(error, onErrorRef);
    }
  }, []);

  // Initialize preview when enabled
  useEffect(() => {
    if (!enabled) {
      return;
    }

    doInit();

    return () => {
      // Only shutdown on unmount, not on every effect cleanup
      if (initStateRef.current === 'ready') {
        initStateRef.current = 'idle';
        setProjectId(null);
        shutdown();
      }
    };
  }, [enabled, doInit, shutdown]);

  // Compute a version string for text content to detect changes
  const textVersion = getProjectTextVersion(project);

  // Set project when initialized, connected, and project/text changes
  // Debounce text changes to avoid interrupting typing
  useEffect(() => {
    if (!canSyncGpuPreviewProject({ enabled, project, initStateRef, isConnected }) || !project) {
      return;
    }

    return syncGpuPreviewProjectChange({
      project,
      projectId,
      textVersion,
      currentTimeMs,
      lastTextVersionRef,
      doSetProject,
    });
  }, [enabled, project, isConnected, projectId, textVersion, currentTimeMs, doSetProject]);

  // Render frame when time changes
  // Use different modes: full frame for scrubbing, text-only for playback
  const lastRenderTimeRef = useRef<number>(0);

  useEffect(() => {
    // Only render if connected, ready, AND project is set
    if (!shouldRenderGpuPreviewFrame({ enabled, isConnected, initStateRef, projectId })) {
      return;
    }

    const now = Date.now();

    // Always use text-only mode (no video decoding - much faster)
    // Video is handled by HTML video (playback) or WebCodecs (scrubbing)
    // GPU only renders text overlay on transparent background
    if (shouldThrottleGpuPreviewRender(now, lastRenderTimeRef.current, isPlaying)) {
      return;
    }
    lastRenderTimeRef.current = now;
    renderFrame(currentTimeMs);
  }, [currentTimeMs, isConnected, enabled, projectId, isPlaying, renderFrame]);

  if (!enabled) {
    return null;
  }

  // Don't render canvas at all until we have a valid frame
  // This prevents any possibility of showing uninitialized/skewed content
  if (!hasFrame) {
    // Still need to render the canvas element for the ref to work,
    // but keep it completely hidden and off-screen
    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: -9999,
          top: -9999,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      />
    );
  }

  // Center the canvas and set explicit pixel dimensions (Cap's approach)
  // This ensures the canvas fills the container without gaps
  // Apply zoomStyle to match video zoom transform
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <canvas
        ref={canvasRef}
        style={{
          width: `${displaySize.width}px`,
          height: `${displaySize.height}px`,
          ...zoomStyle,
        }}
      />
    </div>
  );
});

export default GPUPreviewCanvas;
