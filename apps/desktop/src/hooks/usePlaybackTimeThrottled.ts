/**
 * usePlaybackTimeThrottled - Throttled playback time for low-frequency consumers.
 *
 * During playback, the store's currentTimeMs updates at ~60fps via RAF.
 * Components like captions, text overlays, masks, and annotations don't need
 * per-frame React re-renders — they only change at segment boundaries (every 2-5s).
 *
 * This hook subscribes imperatively to the store and only triggers React state
 * updates at the specified max rate. When not playing, updates are immediate
 * (scrubbing/seeking should feel instant).
 */

import { useEffect, useRef, useState } from 'react';
import { useVideoEditorStore } from '../stores/videoEditorStore';
import type { VideoEditorState } from '../stores/videoEditor/types';

/**
 * Returns currentTimeMs throttled to `maxFps` during playback.
 * When paused or scrubbing, updates are immediate.
 */
export function usePlaybackTimeThrottled(maxFps: number): number {
  const intervalMs = 1000 / maxFps;
  const [time, setTime] = useState(() => useVideoEditorStore.getState().currentTimeMs);
  const lastUpdateRef = useRef(0);
  const pendingRafRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = useVideoEditorStore.subscribe((state: VideoEditorState, prev: VideoEditorState) => {
      if (state.currentTimeMs === prev.currentTimeMs) return;

      // When not playing, update immediately (scrubbing/seeking needs instant feedback)
      if (!state.isPlaying) {
        lastUpdateRef.current = 0;
        if (pendingRafRef.current !== null) {
          cancelAnimationFrame(pendingRafRef.current);
          pendingRafRef.current = null;
        }
        setTime(state.currentTimeMs);
        return;
      }

      // During playback, throttle updates
      const now = performance.now();
      if (now - lastUpdateRef.current >= intervalMs) {
        lastUpdateRef.current = now;
        setTime(state.currentTimeMs);
      } else if (pendingRafRef.current === null) {
        // Schedule a trailing update so we don't miss the final position
        pendingRafRef.current = requestAnimationFrame(() => {
          pendingRafRef.current = null;
          lastUpdateRef.current = performance.now();
          setTime(useVideoEditorStore.getState().currentTimeMs);
        });
      }
    });

    return () => {
      unsubscribe();
      if (pendingRafRef.current !== null) {
        cancelAnimationFrame(pendingRafRef.current);
      }
    };
  }, [intervalMs]);

  return time;
}

/**
 * Returns previewTimeMs (when scrubbing) or throttled currentTimeMs.
 * Preview time is always immediate — throttling only applies during playback.
 */
export function usePreviewOrPlaybackTimeThrottled(maxFps: number): number {
  const intervalMs = 1000 / maxFps;
  const [time, setTime] = useState(() => {
    const state = useVideoEditorStore.getState();
    return state.previewTimeMs !== null ? state.previewTimeMs : state.currentTimeMs;
  });
  const lastUpdateRef = useRef(0);
  const pendingRafRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = useVideoEditorStore.subscribe((state: VideoEditorState, prev: VideoEditorState) => {
      const currentEffective = state.previewTimeMs !== null ? state.previewTimeMs : state.currentTimeMs;
      const prevEffective = prev.previewTimeMs !== null ? prev.previewTimeMs : prev.currentTimeMs;

      if (currentEffective === prevEffective && state.previewTimeMs === prev.previewTimeMs) return;

      // Preview time changes (scrubbing) and paused state: always immediate
      if (!state.isPlaying || state.previewTimeMs !== prev.previewTimeMs) {
        lastUpdateRef.current = 0;
        if (pendingRafRef.current !== null) {
          cancelAnimationFrame(pendingRafRef.current);
          pendingRafRef.current = null;
        }
        setTime(currentEffective);
        return;
      }

      // During playback, throttle updates
      const now = performance.now();
      if (now - lastUpdateRef.current >= intervalMs) {
        lastUpdateRef.current = now;
        setTime(currentEffective);
      } else if (pendingRafRef.current === null) {
        pendingRafRef.current = requestAnimationFrame(() => {
          pendingRafRef.current = null;
          lastUpdateRef.current = performance.now();
          const s = useVideoEditorStore.getState();
          setTime(s.previewTimeMs !== null ? s.previewTimeMs : s.currentTimeMs);
        });
      }
    });

    return () => {
      unsubscribe();
      if (pendingRafRef.current !== null) {
        cancelAnimationFrame(pendingRafRef.current);
      }
    };
  }, [intervalMs]);

  return time;
}
