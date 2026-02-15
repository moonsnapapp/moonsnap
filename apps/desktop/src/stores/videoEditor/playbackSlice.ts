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
    return nextPlaying
      ? { isPlaying: true, previewTimeMs: null }
      : { isPlaying: false };
  }),

  setIsPlaying: (playing) => set(
    playing
      ? { isPlaying: true, previewTimeMs: null }
      : { isPlaying: false }
  ),
});
