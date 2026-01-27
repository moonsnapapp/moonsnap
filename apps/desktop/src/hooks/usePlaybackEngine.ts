/**
 * usePlaybackEngine - Simple playback engine that updates Zustand store.
 *
 * Uses RAF to poll video.currentTime during playback and update the store.
 * Components subscribe to store.currentTimeMs for reactive updates.
 *
 * Note: Currently operates in source time. Trim segments define which portions
 * of the source video are included, but playback still traverses source time.
 * The TrimTrack shows gaps where content has been cut, and the export will
 * skip those regions.
 */

import { useCallback, useMemo } from 'react';
import { useVideoEditorStore, getEffectiveDuration, sourceToTimeline, timelineToSource, findSegmentAtSourceTime } from '../stores/videoEditorStore';

// Module-level state for RAF loop
let rafId: number | null = null;
let videoElement: HTMLVideoElement | null = null;
let isPlayingInternal = false;

/**
 * RAF loop that updates store with current video time.
 * Handles trim segment boundaries - skips deleted regions and converts to timeline time.
 */
function rafLoop() {
  if (!isPlayingInternal) {
    rafId = null;
    return;
  }

  // Update store with current video time
  if (videoElement) {
    const sourceTimeMs = videoElement.currentTime * 1000;
    const state = useVideoEditorStore.getState();
    const segments = state.project?.timeline.segments;
    const sourceDurationMs = state.project?.timeline.durationMs ?? 0;

    if (segments && segments.length > 0) {
      // Check if we're in a deleted region
      const currentSegment = findSegmentAtSourceTime(sourceTimeMs, segments);

      if (!currentSegment) {
        // We're in a deleted region - find the next segment to jump to
        let nextSegment = null;
        for (const seg of segments) {
          if (seg.sourceStartMs > sourceTimeMs) {
            nextSegment = seg;
            break;
          }
        }

        if (nextSegment) {
          // Jump to the start of the next segment
          videoElement.currentTime = nextSegment.sourceStartMs / 1000;
        } else {
          // No more segments - we've reached the end
          const effectiveDuration = getEffectiveDuration(segments, sourceDurationMs);
          useVideoEditorStore.getState().setCurrentTime(effectiveDuration);
          useVideoEditorStore.getState().setIsPlaying(false);
          rafId = null;
          return;
        }
      } else {
        // We're in a valid segment - convert to timeline time
        const timelineTimeMs = sourceToTimeline(sourceTimeMs, segments);
        if (timelineTimeMs !== null) {
          useVideoEditorStore.getState().setCurrentTime(timelineTimeMs);
        }
      }

      // Check if we've reached the end of the effective duration
      const effectiveDuration = getEffectiveDuration(segments, sourceDurationMs);
      const currentTimelineTime = sourceToTimeline(sourceTimeMs, segments) ?? 0;
      if (currentTimelineTime >= effectiveDuration) {
        useVideoEditorStore.getState().setCurrentTime(effectiveDuration);
        useVideoEditorStore.getState().setIsPlaying(false);
        rafId = null;
        return;
      }
    } else {
      // No segments - use source time directly
      useVideoEditorStore.getState().setCurrentTime(sourceTimeMs);
    }
  }

  // Continue loop
  rafId = requestAnimationFrame(rafLoop);
}

function startRAFLoop() {
  if (rafId !== null) return;
  isPlayingInternal = true;
  rafId = requestAnimationFrame(rafLoop);
}

function stopRAFLoop() {
  isPlayingInternal = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/**
 * Start the RAF loop for playback time updates.
 * Called by GPUVideoPreview when isPlaying becomes true.
 */
export function startPlaybackLoop() {
  startRAFLoop();
}

/**
 * Stop the RAF loop.
 * Called by GPUVideoPreview when isPlaying becomes false.
 */
export function stopPlaybackLoop() {
  stopRAFLoop();
}

/**
 * Hook for components that need the current playback time.
 * Returns preview time when scrubbing, otherwise current time from store.
 */
export function usePlaybackTime(): number {
  const currentTimeMs = useVideoEditorStore((s) => s.currentTimeMs);
  return currentTimeMs;
}

/**
 * Hook that returns preview time when scrubbing, or playback time otherwise.
 */
export function usePreviewOrPlaybackTime(): number {
  const currentTimeMs = useVideoEditorStore((s) => s.currentTimeMs);
  const previewTimeMs = useVideoEditorStore((s) => s.previewTimeMs);
  return previewTimeMs !== null ? previewTimeMs : currentTimeMs;
}

/**
 * Hook for components that need playback controls.
 * Uses module-level videoElement so all callers operate on the same video.
 */
export function usePlaybackControls() {
  const play = useCallback(() => {
    if (isPlayingInternal) return;
    isPlayingInternal = true;
    // Only update store - the effect in GPUVideoPreview handles video.play()
    useVideoEditorStore.getState().setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    if (!isPlayingInternal) return;
    isPlayingInternal = false;
    // Sync final time to store before pausing
    if (videoElement) {
      useVideoEditorStore.getState().setCurrentTime(videoElement.currentTime * 1000);
    }
    // Only update store - the effect in GPUVideoPreview handles video.pause()
    useVideoEditorStore.getState().setIsPlaying(false);
  }, []);

  const seek = useCallback((timelineTimeMs: number) => {
    const state = useVideoEditorStore.getState();
    const segments = state.project?.timeline.segments;
    const sourceDuration = state.project?.timeline.durationMs ?? 0;

    // Get effective duration (timeline duration after cuts)
    const effectiveDuration = segments && segments.length > 0
      ? getEffectiveDuration(segments, sourceDuration)
      : sourceDuration;

    // Clamp to effective timeline duration
    const clampedTimelineTime = Math.max(0, Math.min(timelineTimeMs, effectiveDuration));

    // Convert timeline time to source time for video seeking
    const sourceTimeMs = segments && segments.length > 0
      ? timelineToSource(clampedTimelineTime, segments)
      : clampedTimelineTime;

    // Sync video element (use module-level variable)
    if (videoElement) {
      videoElement.currentTime = sourceTimeMs / 1000;
    }

    // Update store with timeline time (not source time)
    useVideoEditorStore.getState().setCurrentTime(clampedTimelineTime);
  }, []);

  const toggle = useCallback(() => {
    if (isPlayingInternal) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  const setDuration = useCallback((_ms: number) => {
    // Duration comes from project, no need to store separately
  }, []);

  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoElement = el;
  }, []);

  const syncFromVideo = useCallback((_timeMs: number) => {
    // Not used anymore - RAF loop handles syncing
  }, []);

  // Memoize return object to prevent re-renders from creating new object references
  // This is critical - effects depending on 'controls' will re-run if this changes
  return useMemo(() => ({
    play,
    pause,
    seek,
    toggle,
    setDuration,
    setVideoElement,
    syncFromVideo,
    isPlaying: () => isPlayingInternal,
    getCurrentTime: () => useVideoEditorStore.getState().currentTimeMs,
  }), [play, pause, seek, toggle, setDuration, setVideoElement, syncFromVideo]);
}

/**
 * Initialize playback engine with project data.
 */
export function initPlaybackEngine(_projectDurationMs: number, initialTimeMs = 0) {
  stopRAFLoop();
  isPlayingInternal = false;
  useVideoEditorStore.getState().setCurrentTime(initialTimeMs);
}

/**
 * Reset playback engine state.
 */
export function resetPlaybackEngine() {
  stopRAFLoop();
  isPlayingInternal = false;
  videoElement = null;
  useVideoEditorStore.getState().setCurrentTime(0);
}

/**
 * Get current playback state.
 */
export function getPlaybackState() {
  const state = useVideoEditorStore.getState();
  const project = state.project;
  const sourceDuration = project?.timeline.durationMs ?? 0;
  const segments = project?.timeline.segments ?? [];

  return {
    currentTimeMs: state.currentTimeMs,
    isPlaying: state.isPlaying,
    durationMs: sourceDuration,
    // Effective duration after cuts (for UI display)
    effectiveDurationMs: getEffectiveDuration(segments, sourceDuration),
    // Whether trim segments exist
    hasTrimSegments: segments.length > 0,
  };
}
