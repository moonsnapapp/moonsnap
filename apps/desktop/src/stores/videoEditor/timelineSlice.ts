import type { VideoProject } from '@/types';
import type { SliceCreator, TrackVisibility, HoveredTrack, DragEdge } from './types';
import { getEffectiveDuration } from './trimSlice';

export const DEFAULT_TIMELINE_ZOOM = 0.05; // 50px per second
export const MIN_ZOOM_PERCENT = 0.1; // 10%
export const MAX_ZOOM_PERCENT = 2.0; // 200%

export const TRACK_LABEL_WIDTH = 80;

/** Compute the zoom level where the full timeline exactly fills the viewport. */
export function getFitZoom(project: VideoProject | null, containerWidth: number): number | null {
  if (!project || containerWidth <= 0) return null;
  const durationMs = project.timeline.durationMs;
  if (durationMs <= 0) return null;
  return (containerWidth - TRACK_LABEL_WIDTH) / durationMs;
}

/**
 * Timeline view state and actions for timeline UI control
 */
export interface TimelineSlice {
  // Timeline interaction state
  isDraggingPlayhead: boolean;
  isDraggingZoomRegion: boolean;
  draggedZoomEdge: DragEdge;
  isDraggingSceneSegment: boolean;
  draggedSceneEdge: DragEdge;
  isDraggingMaskSegment: boolean;
  draggedMaskEdge: DragEdge;
  isDraggingTextSegment: boolean;
  draggedTextEdge: DragEdge;
  previewTimeMs: number | null;
  hoveredTrack: HoveredTrack;
  splitMode: boolean;

  // View state
  trackVisibility: TrackVisibility;
  timelineZoom: number;
  timelineScrollLeft: number;
  timelineContainerWidth: number;

  // Timeline view actions
  setTimelineZoom: (zoom: number) => void;
  setTimelineScrollLeft: (scrollLeft: number) => void;
  setTimelineContainerWidth: (width: number) => void;
  fitTimelineToWindow: () => void;
  toggleTrackVisibility: (track: keyof TrackVisibility) => void;

  // Drag state actions
  setDraggingPlayhead: (dragging: boolean) => void;
  setDraggingZoomRegion: (dragging: boolean, edge?: 'start' | 'end' | 'move') => void;
  setDraggingSceneSegment: (dragging: boolean, edge?: 'start' | 'end' | 'move') => void;
  setDraggingMaskSegment: (dragging: boolean, edge?: 'start' | 'end' | 'move') => void;
  setDraggingTextSegment: (dragging: boolean, edge?: 'start' | 'end' | 'move') => void;
  setPreviewTime: (timeMs: number | null) => void;
  setHoveredTrack: (track: HoveredTrack) => void;

  // Split mode actions
  setSplitMode: (enabled: boolean) => void;

  // IO markers for export range
  exportInPointMs: number | null;
  exportOutPointMs: number | null;
  setExportInPoint: (ms: number) => void;
  setExportOutPoint: (ms: number) => void;
  clearExportRange: () => void;
}

export const createTimelineSlice: SliceCreator<TimelineSlice> = (set, get) => ({
  // Initial state
  isDraggingPlayhead: false,
  isDraggingZoomRegion: false,
  draggedZoomEdge: null,
  isDraggingSceneSegment: false,
  draggedSceneEdge: null,
  isDraggingMaskSegment: false,
  draggedMaskEdge: null,
  isDraggingTextSegment: false,
  draggedTextEdge: null,
  previewTimeMs: null,
  hoveredTrack: null,
  splitMode: false,
  timelineZoom: DEFAULT_TIMELINE_ZOOM,
  timelineScrollLeft: 0,
  timelineContainerWidth: 0,
  trackVisibility: {
    video: true,
    text: true,
    mask: true,
    zoom: true,
    scene: true,
  },

  // Timeline view actions
  setTimelineZoom: (zoom) => {
    const { project, timelineContainerWidth } = get();
    const fitZoom = getFitZoom(project, timelineContainerWidth);
    const base = fitZoom ?? DEFAULT_TIMELINE_ZOOM;
    const min = base * MIN_ZOOM_PERCENT;
    const max = base * MAX_ZOOM_PERCENT;
    set({ timelineZoom: Math.max(min, Math.min(max, zoom)) });
  },

  setTimelineScrollLeft: (scrollLeft) => set({ timelineScrollLeft: scrollLeft }),

  setTimelineContainerWidth: (width) => set({ timelineContainerWidth: width }),

  fitTimelineToWindow: () => {
    const { project, timelineContainerWidth } = get();
    const fitZoom = getFitZoom(project, timelineContainerWidth);
    if (!fitZoom) return;

    set({
      timelineZoom: fitZoom,
      timelineScrollLeft: 0,
    });
  },

  toggleTrackVisibility: (track) =>
    set((state) => ({
      trackVisibility: {
        ...state.trackVisibility,
        [track]: !state.trackVisibility[track],
      },
    })),

  // Drag state actions
  setDraggingPlayhead: (dragging) => set({ isDraggingPlayhead: dragging }),
  setPreviewTime: (timeMs) => set({ previewTimeMs: timeMs }),

  setHoveredTrack: (track) => set({ hoveredTrack: track }),

  setDraggingZoomRegion: (dragging, edge) =>
    set({
      isDraggingZoomRegion: dragging,
      draggedZoomEdge: dragging ? edge ?? null : null,
    }),

  setDraggingSceneSegment: (dragging, edge) =>
    set({
      isDraggingSceneSegment: dragging,
      draggedSceneEdge: dragging ? edge ?? null : null,
    }),

  setDraggingMaskSegment: (dragging, edge) =>
    set({
      isDraggingMaskSegment: dragging,
      draggedMaskEdge: dragging ? edge ?? null : null,
    }),

  setDraggingTextSegment: (dragging, edge) =>
    set({
      isDraggingTextSegment: dragging,
      draggedTextEdge: dragging ? edge ?? null : null,
    }),

  // Split mode actions
  setSplitMode: (enabled) => set({ splitMode: enabled }),

  // IO markers for export range
  exportInPointMs: null,
  exportOutPointMs: null,

  setExportInPoint: (ms) => {
    const { exportOutPointMs, project } = get();
    const effectiveDurationMs = project
      ? getEffectiveDuration(project.timeline.segments ?? [], project.timeline.durationMs)
      : null;
    const newIn = effectiveDurationMs !== null
      ? Math.max(0, Math.min(ms, effectiveDurationMs))
      : Math.max(0, ms);

    // If only one marker is set, extend the counterpart marker to the timeline boundary.
    let newOut = exportOutPointMs;
    if (newOut === null && effectiveDurationMs !== null) {
      newOut = effectiveDurationMs;
    }

    // If I >= O, keep the newer in marker and extend out to timeline end.
    if (newOut !== null && newIn >= newOut) {
      newOut = effectiveDurationMs ?? newOut;
    }

    set({ exportInPointMs: newIn, exportOutPointMs: newOut });
    // Sync to project for persistence
    if (project) {
      set({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            inPoint: newIn,
            outPoint: newOut ?? project.timeline.durationMs,
          },
        },
      });
    }
  },

  setExportOutPoint: (ms) => {
    const { exportInPointMs, project } = get();
    const effectiveDurationMs = project
      ? getEffectiveDuration(project.timeline.segments ?? [], project.timeline.durationMs)
      : null;
    const newOut = effectiveDurationMs !== null
      ? Math.max(0, Math.min(ms, effectiveDurationMs))
      : Math.max(0, ms);

    // If only one marker is set, extend the counterpart marker to the timeline boundary.
    let newIn = exportInPointMs;
    if (newIn === null) {
      newIn = 0;
    }

    // If O <= I, keep the newer out marker and extend in to timeline start.
    if (newOut <= newIn) {
      newIn = 0;
    }

    set({ exportOutPointMs: newOut, exportInPointMs: newIn });
    // Sync to project for persistence
    if (project) {
      set({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            inPoint: newIn,
            outPoint: newOut,
          },
        },
      });
    }
  },

  clearExportRange: () => {
    const { project } = get();
    set({ exportInPointMs: null, exportOutPointMs: null });
    // Sync to project for persistence
    if (project) {
      const effectiveDurationMs = getEffectiveDuration(
        project.timeline.segments ?? [],
        project.timeline.durationMs,
      );
      set({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            inPoint: 0,
            outPoint: effectiveDurationMs,
          },
        },
      });
    }
  },
});
