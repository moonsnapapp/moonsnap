import type {
  SliceCreator,
  VisibilitySegment,
  WebcamConfig,
  CursorConfig,
  AudioTrackSettings,
} from '../types';
import { snapshotOverlayState } from '../overlayAdjustment';
import { pushTrimHistory } from '../trimSlice';
import { ensureTrimHistoryInitialized } from './shared';

export interface WebcamSegmentsSlice {
  selectedWebcamSegmentIndex: number | null;

  selectWebcamSegment: (index: number | null) => void;
  addWebcamSegment: (segment: VisibilitySegment) => void;
  updateWebcamSegment: (index: number, updates: Partial<VisibilitySegment>) => void;
  deleteWebcamSegment: (index: number) => void;
  toggleWebcamAtTime: (timeMs: number) => void;

  // Config actions
  updateWebcamConfig: (updates: Partial<WebcamConfig>) => void;
  updateCursorConfig: (updates: Partial<CursorConfig>) => void;
  updateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
}

export const createWebcamSegmentsSlice: SliceCreator<WebcamSegmentsSlice> = (set, get) => ({
  selectedWebcamSegmentIndex: null,

  selectWebcamSegment: (index) =>
    set({
      selectedWebcamSegmentIndex: index,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedMaskSegmentId: null,
    }),

  addWebcamSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
    };

    const segments = [...project.webcam.visibilitySegments, clampedSegment];
    // Sort by start time
    segments.sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          visibilitySegments: segments,
        },
      },
    });
  },

  updateWebcamSegment: (index, updates) => {
    const {
      project,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const segments = [...project.webcam.visibilitySegments];
    segments[index] = { ...segments[index], ...updates };
    const overlays = snapshotOverlayState(project);
    overlays.webcamVisibilitySegments = segments;
    const { history, index: nextIndex } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          visibilitySegments: segments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: nextIndex,
    });
  },

  deleteWebcamSegment: (index) => {
    const {
      project,
      selectedWebcamSegmentIndex,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const overlays = snapshotOverlayState(project);
    overlays.webcamVisibilitySegments = project.webcam.visibilitySegments.filter((_, i) => i !== index);
    const { history, index: nextIndex } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          visibilitySegments: overlays.webcamVisibilitySegments,
        },
      },
      selectedWebcamSegmentIndex: selectedWebcamSegmentIndex === index ? null : selectedWebcamSegmentIndex,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: nextIndex,
    });
  },

  toggleWebcamAtTime: (timeMs) => {
    const { project } = get();
    if (!project) return;

    const segments = project.webcam.visibilitySegments;

    // Find if current time is within a segment
    const segmentIndex = segments.findIndex((s) => timeMs >= s.startMs && timeMs <= s.endMs);

    if (segmentIndex >= 0) {
      // Split or remove segment
      const segment = segments[segmentIndex];
      const newSegments = [...segments];

      if (timeMs === segment.startMs) {
        // At start, just remove
        newSegments.splice(segmentIndex, 1);
      } else if (timeMs === segment.endMs) {
        // At end, just remove
        newSegments.splice(segmentIndex, 1);
      } else {
        // In middle, split into two
        newSegments.splice(segmentIndex, 1, { ...segment, endMs: timeMs }, { ...segment, startMs: timeMs });
      }

      set({
        project: {
          ...project,
          webcam: {
            ...project.webcam,
            visibilitySegments: newSegments,
          },
        },
      });
    } else {
      // Add new segment (default 5 seconds)
      const endMs = Math.min(timeMs + 5000, project.timeline.durationMs);
      const newSegment: VisibilitySegment = {
        startMs: timeMs,
        endMs,
        visible: true,
      };

      const newSegments = [...segments, newSegment].sort((a, b) => a.startMs - b.startMs);

      set({
        project: {
          ...project,
          webcam: {
            ...project.webcam,
            visibilitySegments: newSegments,
          },
        },
      });
    }
  },

  // Config actions
  updateWebcamConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        webcam: {
          ...project.webcam,
          ...updates,
        },
      },
    });
  },

  updateCursorConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        cursor: {
          ...project.cursor,
          ...updates,
        },
      },
    });
  },

  updateAudioConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        audio: {
          ...project.audio,
          ...updates,
        },
      },
    });
  },
});
