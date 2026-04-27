import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';

// Import slice creators
import { createPlaybackSlice } from './playbackSlice';
import { createTimelineSlice } from './timelineSlice';
import { createSegmentsSlice } from './segmentsSlice';
import { createExportSlice } from './exportSlice';
import { createProjectSlice } from './projectSlice';
import { createGPUEditorSlice } from './gpuEditorSlice';
import { createCaptionSlice } from './captionSlice';
import { createTrimSlice } from './trimSlice';

// Import and re-export types
import type { VideoEditorState } from './types';
export type { VideoEditorState } from './types';

// Re-export slice types for consumers who need them
export type { PlaybackSlice } from './playbackSlice';
export type { TimelineSlice } from './timelineSlice';
export type { SegmentsSlice } from './segmentsSlice';
export type { ExportSlice } from './exportSlice';
export type { ProjectSlice } from './projectSlice';
export type { GPUEditorSlice } from './gpuEditorSlice';
export type { CaptionSlice } from './captionSlice';
export type { TrimSlice } from './trimSlice';

// Type alias for the store
export type VideoEditorStore = StoreApi<VideoEditorState>;

/**
 * Build a video editor store instance with all feature slices.
 */
const createVideoEditorStoreInstance = (): VideoEditorStore =>
  createStore<VideoEditorState>()(
    devtools(
      (...a) => ({
        ...createPlaybackSlice(...a),
        ...createTimelineSlice(...a),
        ...createSegmentsSlice(...a),
        ...createExportSlice(...a),
        ...createProjectSlice(...a),
        ...createGPUEditorSlice(...a),
        ...createCaptionSlice(...a),
        ...createTrimSlice(...a),
      }),
      { name: 'VideoEditorStore', enabled: process.env.NODE_ENV === 'development' }
    )
  );

const globalVideoEditorStore = createVideoEditorStoreInstance();
let activeVideoEditorStore: VideoEditorStore = globalVideoEditorStore;

// Context used by isolated video editor windows.
export const VideoEditorStoreContext = createContext<VideoEditorStore | null>(null);

export function getActiveVideoEditorStore(): VideoEditorStore {
  return activeVideoEditorStore;
}

export function setActiveVideoEditorStore(store: VideoEditorStore): void {
  activeVideoEditorStore = store;
}

export function resetActiveVideoEditorStore(): void {
  activeVideoEditorStore = globalVideoEditorStore;
}

const selectVideoEditorState = (state: VideoEditorState): VideoEditorState => state;

type UseVideoEditorStoreHook = {
  (): VideoEditorState;
  <T>(selector: (state: VideoEditorState) => T): T;
  getState: VideoEditorStore['getState'];
  setState: VideoEditorStore['setState'];
  subscribe: VideoEditorStore['subscribe'];
  getInitialState: VideoEditorStore['getInitialState'];
};

function useVideoEditorStoreBase(): VideoEditorState;
function useVideoEditorStoreBase<T>(selector: (state: VideoEditorState) => T): T;
function useVideoEditorStoreBase<T>(selector?: (state: VideoEditorState) => T): T | VideoEditorState {
  const contextStore = useContext(VideoEditorStoreContext);
  const store = contextStore ?? getActiveVideoEditorStore();
  const resolvedSelector: (state: VideoEditorState) => T | VideoEditorState = selector ?? selectVideoEditorState;
  return useStore(store, resolvedSelector);
}

function setActiveVideoEditorState(
  partial:
    | VideoEditorState
    | Partial<VideoEditorState>
    | ((state: VideoEditorState) => VideoEditorState | Partial<VideoEditorState>),
  replace?: false
): void;
function setActiveVideoEditorState(
  state: VideoEditorState | ((state: VideoEditorState) => VideoEditorState),
  replace: true
): void;
function setActiveVideoEditorState(
  state:
    | VideoEditorState
    | Partial<VideoEditorState>
    | ((state: VideoEditorState) => VideoEditorState | Partial<VideoEditorState>),
  replace?: boolean
): void {
  const store = getActiveVideoEditorStore();

  if (replace === true) {
    store.setState(
      state as VideoEditorState | ((current: VideoEditorState) => VideoEditorState),
      true
    );
    return;
  }

  store.setState(state);
}

const subscribeActiveVideoEditorStore: VideoEditorStore['subscribe'] = (listener) =>
  getActiveVideoEditorStore().subscribe(listener);

/**
 * Context-aware video editor store hook.
 *
 * - In an isolated window, returns data from the window's local store.
 * - Outside a provider, falls back to the app-global singleton store.
 *
 * Static store methods (`getState`, `setState`, `subscribe`) are preserved
 * for existing imperative call sites.
 */
export const useVideoEditorStore: UseVideoEditorStoreHook = Object.assign(
  useVideoEditorStoreBase,
  {
    getState: () => getActiveVideoEditorStore().getState(),
    setState: setActiveVideoEditorState,
    subscribe: subscribeActiveVideoEditorStore,
    getInitialState: () => getActiveVideoEditorStore().getInitialState(),
  }
);

// Re-export utility functions
export { generateZoomRegionId } from './segmentsSlice';
export { sanitizeProjectForSave } from './projectSlice';
export { DEFAULT_TIMELINE_ZOOM, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT, TRACK_LABEL_WIDTH, getFitZoom } from './timelineSlice';
export { DEFAULT_CAPTION_SETTINGS } from './captionSlice';
export {
  generateTrimSegmentId,
  timelineToSource,
  sourceToTimeline,
  getEffectiveDuration,
  getSegmentTimelinePosition,
  findSegmentAtSourceTime,
  findSegmentIndexAtTimelineTime,
  clipSegmentsToTimelineRange,
  MIN_TRIM_SEGMENT_DURATION_MS,
  MIN_TRIM_SEGMENT_SPEED,
  MAX_TRIM_SEGMENT_SPEED,
  DEFAULT_FULL_SEGMENT_ID,
} from './trimSlice';

/**
 * Format milliseconds as timecode (MM:SS:FF at 30fps)
 */
export function formatTimecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor((ms % 1000) / (1000 / 30)); // Assuming 30fps

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

/**
 * Format milliseconds as simple time (M:SS)
 */
export function formatTimeSimple(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Factory function to create an isolated video editor store.
 * Use this for floating video editor windows that need independent state.
 */
export function createVideoEditorStore(): VideoEditorStore {
  return createVideoEditorStoreInstance();
}
