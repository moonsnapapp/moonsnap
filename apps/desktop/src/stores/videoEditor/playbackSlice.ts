import { TIMING } from '../../constants';
import { getEffectiveDuration } from './trimSlice';
import type { SliceCreator, RenderedFrame } from './types';

/**
 * Playback state and actions for video playback control
 */
export interface PlaybackSlice {
  // Playback state
  currentTimeMs: number;
  currentFrame: number;
  isPlaying: boolean;
  renderedFrame: RenderedFrame | null;
  lastSeekToken: number;

  // Playback actions
  setCurrentTime: (timeMs: number) => void;
  requestSeek: (timeMs: number) => void;
  togglePlayback: () => void;
  setIsPlaying: (playing: boolean) => void;
}

function shouldRestartFromStart(currentTimeMs: number, effectiveDurationMs: number): boolean {
  if (effectiveDurationMs <= 0) {
    return false;
  }
  return currentTimeMs >= (effectiveDurationMs - TIMING.PLAYBACK_END_RESTART_THRESHOLD_MS);
}

export const createPlaybackSlice: SliceCreator<PlaybackSlice> = (set, get) => ({
  // Initial state
  currentTimeMs: 0,
  currentFrame: 0,
  isPlaying: false,
  renderedFrame: null,
  lastSeekToken: 0,

  // Actions
  setCurrentTime: (timeMs) => {
    const { project } = get();
    if (!project) return;

    // Clamp to valid range
    const clampedTime = Math.max(0, Math.min(timeMs, project.timeline.durationMs));
    set({ currentTimeMs: clampedTime });
  },
  requestSeek: (timeMs) => {
    const { project, lastSeekToken } = get();
    if (!project) return;

    const clampedTime = Math.max(0, Math.min(timeMs, project.timeline.durationMs));
    set({ currentTimeMs: clampedTime, lastSeekToken: lastSeekToken + 1 });
  },

  togglePlayback: () => set((state) => {
    const nextPlaying = !state.isPlaying;
    if (!nextPlaying) {
      return { isPlaying: false };
    }

    const sourceDurationMs = state.project?.timeline.durationMs ?? 0;
    const segments = state.project?.timeline.segments ?? [];
    const effectiveDurationMs = getEffectiveDuration(segments, sourceDurationMs);
    const restartFromStart = shouldRestartFromStart(state.currentTimeMs, effectiveDurationMs);

    if (restartFromStart) {
      return {
        isPlaying: true,
        previewTimeMs: null,
        currentTimeMs: 0,
        lastSeekToken: state.lastSeekToken + 1,
      };
    }

    return { isPlaying: true, previewTimeMs: null };
  }),

  setIsPlaying: (playing) => set((state) => {
    if (!playing) {
      return { isPlaying: false };
    }

    const sourceDurationMs = state.project?.timeline.durationMs ?? 0;
    const segments = state.project?.timeline.segments ?? [];
    const effectiveDurationMs = getEffectiveDuration(segments, sourceDurationMs);
    const restartFromStart = shouldRestartFromStart(state.currentTimeMs, effectiveDurationMs);

    if (restartFromStart) {
      return {
        isPlaying: true,
        previewTimeMs: null,
        currentTimeMs: 0,
        lastSeekToken: state.lastSeekToken + 1,
      };
    }

    return { isPlaying: true, previewTimeMs: null };
  }),
});
