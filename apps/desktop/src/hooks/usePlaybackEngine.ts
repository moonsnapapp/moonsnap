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
 *
 * REFACTORED: Now uses ref-based state to support multiple video editor instances.
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useVideoEditorStore, getEffectiveDuration, sourceToTimeline, timelineToSource, findSegmentAtSourceTime } from '../stores/videoEditorStore';

/**
 * PlaybackEngine class - manages playback state for a single video editor instance.
 * Using a class allows proper encapsulation of RAF loop and video element references.
 */
class PlaybackEngine {
  private rafId: number | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isPlayingInternal = false;

  /**
   * RAF loop that updates store with current video time.
   * Handles trim segment boundaries - skips deleted regions and converts to timeline time.
   */
  private rafLoop = () => {
    if (!this.isPlayingInternal) {
      this.rafId = null;
      return;
    }

    // Update store with current video time
    if (this.videoElement) {
      const sourceTimeMs = this.videoElement.currentTime * 1000;
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
            this.videoElement.currentTime = nextSegment.sourceStartMs / 1000;
          } else {
            // No more segments - we've reached the end
            const effectiveDuration = getEffectiveDuration(segments, sourceDurationMs);
            useVideoEditorStore.getState().setCurrentTime(effectiveDuration);
            useVideoEditorStore.getState().setIsPlaying(false);
            this.rafId = null;
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
          this.rafId = null;
          return;
        }
      } else {
        // No segments - use source time directly
        useVideoEditorStore.getState().setCurrentTime(sourceTimeMs);
      }
    }

    // Continue loop
    this.rafId = requestAnimationFrame(this.rafLoop);
  };

  startRAFLoop() {
    if (this.rafId !== null) return;
    this.isPlayingInternal = true;
    this.rafId = requestAnimationFrame(this.rafLoop);
  }

  stopRAFLoop() {
    this.isPlayingInternal = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setVideoElement(el: HTMLVideoElement | null) {
    this.videoElement = el;
  }

  getVideoElement() {
    return this.videoElement;
  }

  isPlaying() {
    return this.isPlayingInternal;
  }

  setIsPlaying(playing: boolean) {
    this.isPlayingInternal = playing;
  }

  reset() {
    this.stopRAFLoop();
    this.isPlayingInternal = false;
    this.videoElement = null;
    useVideoEditorStore.getState().setCurrentTime(0);
  }

  init(_projectDurationMs: number, initialTimeMs = 0) {
    this.stopRAFLoop();
    this.isPlayingInternal = false;
    useVideoEditorStore.getState().setCurrentTime(initialTimeMs);
  }
}

// Default singleton for backward compatibility
const defaultEngine = new PlaybackEngine();

/**
 * Start the RAF loop for playback time updates.
 * Called by GPUVideoPreview when isPlaying becomes true.
 */
export function startPlaybackLoop() {
  defaultEngine.startRAFLoop();
}

/**
 * Stop the RAF loop.
 * Called by GPUVideoPreview when isPlaying becomes false.
 */
export function stopPlaybackLoop() {
  defaultEngine.stopRAFLoop();
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
 * Each instance of this hook gets its own PlaybackEngine via ref,
 * enabling multiple video editors with independent playback state.
 */
export function usePlaybackControls() {
  // Each component instance gets its own engine via ref
  const engineRef = useRef<PlaybackEngine | null>(null);

  // Lazy initialization of engine
  if (!engineRef.current) {
    engineRef.current = new PlaybackEngine();
  }

  const engine = engineRef.current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engine.reset();
    };
  }, [engine]);

  const play = useCallback(() => {
    if (engine.isPlaying()) return;
    engine.setIsPlaying(true);
    // Only update store - the effect in GPUVideoPreview handles video.play()
    useVideoEditorStore.getState().setIsPlaying(true);
  }, [engine]);

  const pause = useCallback(() => {
    if (!engine.isPlaying()) return;
    engine.setIsPlaying(false);
    // Sync final time to store before pausing
    const videoElement = engine.getVideoElement();
    if (videoElement) {
      useVideoEditorStore.getState().setCurrentTime(videoElement.currentTime * 1000);
    }
    // Only update store - the effect in GPUVideoPreview handles video.pause()
    useVideoEditorStore.getState().setIsPlaying(false);
  }, [engine]);

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

    // Sync video element
    const videoElement = engine.getVideoElement();
    if (videoElement) {
      videoElement.currentTime = sourceTimeMs / 1000;
    }

    // Update store with timeline time (not source time)
    useVideoEditorStore.getState().requestSeek(clampedTimelineTime);
  }, [engine]);

  const toggle = useCallback(() => {
    if (engine.isPlaying()) {
      pause();
    } else {
      play();
    }
  }, [engine, play, pause]);

  const setDuration = useCallback((_ms: number) => {
    // Duration comes from project, no need to store separately
  }, []);

  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    engine.setVideoElement(el);
  }, [engine]);

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
    isPlaying: () => engine.isPlaying(),
    getCurrentTime: () => useVideoEditorStore.getState().currentTimeMs,
    // Expose engine methods for external RAF loop control
    startRAFLoop: () => engine.startRAFLoop(),
    stopRAFLoop: () => engine.stopRAFLoop(),
  }), [engine, play, pause, seek, toggle, setDuration, setVideoElement, syncFromVideo]);
}

/**
 * Initialize playback engine with project data.
 */
export function initPlaybackEngine(projectDurationMs: number, initialTimeMs = 0) {
  defaultEngine.init(projectDurationMs, initialTimeMs);
}

/**
 * Reset playback engine state.
 */
export function resetPlaybackEngine() {
  defaultEngine.reset();
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
