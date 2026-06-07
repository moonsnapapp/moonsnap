import type { SliceCreator, VideoEditorState } from './types';
import { createZoomSegmentsSlice, type ZoomSegmentsSlice } from './segments/zoomSegments';
import { createTextSegmentsSlice, type TextSegmentsSlice } from './segments/textSegments';
import {
  createAnnotationSegmentsSlice,
  type AnnotationSegmentsSlice,
} from './segments/annotationSegments';
import { createMaskSegmentsSlice, type MaskSegmentsSlice } from './segments/maskSegments';
import { createSceneSegmentsSlice, type SceneSegmentsSlice } from './segments/sceneSegments';
import { createWebcamSegmentsSlice, type WebcamSegmentsSlice } from './segments/webcamSegments';
import { normalizeAnnotationConfig } from '../../utils/videoAnnotations';
import { getTextSegmentIndexFromId } from '../../utils/textSegmentId';

// Re-export the zoom region ID generator (kept here for import stability).
export { generateZoomRegionId } from './segments/zoomSegments';

/**
 * Segments state and actions for managing timeline segments
 * (zoom regions, text, mask, scene, webcam). The implementation is split into
 * one sub-slice per segment domain under `./segments/`; this interface is their
 * union and `createSegmentsSlice` merges them.
 */
export interface SegmentsSlice
  extends ZoomSegmentsSlice,
    TextSegmentsSlice,
    AnnotationSegmentsSlice,
    MaskSegmentsSlice,
    SceneSegmentsSlice,
    WebcamSegmentsSlice {
  deleteSelectedTimelineItem: () => void;
  nudgeSelectedTimelineItem: (deltaMs: number) => void;
}

function getNudgedRange(startMs: number, endMs: number, deltaMs: number, durationMs: number) {
  const segmentDurationMs = Math.max(0, endMs - startMs);
  const maxStartMs = Math.max(0, durationMs - segmentDurationMs);
  const nextStartMs = Math.max(0, Math.min(maxStartMs, startMs + deltaMs));
  return {
    startMs: nextStartMs,
    endMs: nextStartMs + segmentDurationMs,
  };
}

function nudgeSelectedZoomRegion(
  state: VideoEditorState,
  project: NonNullable<VideoEditorState['project']>,
  deltaMs: number,
  durationMs: number
) {
  if (!state.selectedZoomRegionId) return false;
  const region = project.zoom.regions.find((item) => item.id === state.selectedZoomRegionId);
  if (!region) return true;
  state.updateZoomRegion(region.id, getNudgedRange(region.startMs, region.endMs, deltaMs, durationMs));
  return true;
}

function nudgeSelectedTextSegment(
  state: VideoEditorState,
  project: NonNullable<VideoEditorState['project']>,
  deltaMs: number,
  durationMs: number
) {
  if (!state.selectedTextSegmentId) return false;
  const index = getTextSegmentIndexFromId(state.selectedTextSegmentId);
  const segment = index === null ? null : project.text.segments[index];
  if (!segment) return true;

  const next = getNudgedRange(segment.start * 1000, segment.end * 1000, deltaMs, durationMs);
  state.updateTextSegment(state.selectedTextSegmentId, {
    start: next.startMs / 1000,
    end: next.endMs / 1000,
  });
  return true;
}

function nudgeSelectedAnnotationSegment(
  state: VideoEditorState,
  project: NonNullable<VideoEditorState['project']>,
  deltaMs: number,
  durationMs: number
) {
  if (!state.selectedAnnotationSegmentId) return false;
  const annotations = normalizeAnnotationConfig(project.annotations);
  const segment = annotations.segments.find((item) => item.id === state.selectedAnnotationSegmentId);
  if (!segment) return true;
  state.updateAnnotationSegment(segment.id, getNudgedRange(segment.startMs, segment.endMs, deltaMs, durationMs));
  return true;
}

function nudgeSelectedMaskSegment(
  state: VideoEditorState,
  project: NonNullable<VideoEditorState['project']>,
  deltaMs: number,
  durationMs: number
) {
  if (!state.selectedMaskSegmentId) return false;
  const segment = project.mask.segments.find((item) => item.id === state.selectedMaskSegmentId);
  if (!segment) return true;
  state.updateMaskSegment(segment.id, getNudgedRange(segment.startMs, segment.endMs, deltaMs, durationMs));
  return true;
}

function nudgeSelectedSceneSegment(
  state: VideoEditorState,
  project: NonNullable<VideoEditorState['project']>,
  deltaMs: number,
  durationMs: number
) {
  if (!state.selectedSceneSegmentId) return false;
  const segment = project.scene.segments.find((item) => item.id === state.selectedSceneSegmentId);
  if (!segment) return true;
  state.updateSceneSegment(segment.id, getNudgedRange(segment.startMs, segment.endMs, deltaMs, durationMs));
  return true;
}

function nudgeSelectedWebcamSegment(
  state: VideoEditorState,
  project: NonNullable<VideoEditorState['project']>,
  deltaMs: number,
  durationMs: number
) {
  if (state.selectedWebcamSegmentIndex === null) return false;
  const segment = project.webcam.visibilitySegments[state.selectedWebcamSegmentIndex];
  if (!segment) return true;
  state.updateWebcamSegment(
    state.selectedWebcamSegmentIndex,
    getNudgedRange(segment.startMs, segment.endMs, deltaMs, durationMs)
  );
  return true;
}

export const createSegmentsSlice: SliceCreator<SegmentsSlice> = (set, get, store) => ({
  ...createZoomSegmentsSlice(set, get, store),
  ...createTextSegmentsSlice(set, get, store),
  ...createAnnotationSegmentsSlice(set, get, store),
  ...createMaskSegmentsSlice(set, get, store),
  ...createSceneSegmentsSlice(set, get, store),
  ...createWebcamSegmentsSlice(set, get, store),

  deleteSelectedTimelineItem: () => {
    const state = get();

    if (state.selectedZoomRegionId) {
      state.deleteZoomRegion(state.selectedZoomRegionId);
      return;
    }

    if (state.selectedTextSegmentId) {
      state.deleteTextSegment(state.selectedTextSegmentId);
      return;
    }

    if (state.selectedAnnotationSegmentId) {
      if (state.annotationDeleteMode === 'shape' && state.selectedAnnotationShapeId) {
        state.deleteAnnotationShape(state.selectedAnnotationSegmentId, state.selectedAnnotationShapeId);
      } else {
        state.deleteAnnotationSegment(state.selectedAnnotationSegmentId);
      }
      return;
    }

    if (state.selectedMaskSegmentId) {
      state.deleteMaskSegment(state.selectedMaskSegmentId);
      return;
    }

    if (state.selectedSceneSegmentId) {
      state.deleteSceneSegment(state.selectedSceneSegmentId);
      return;
    }

    if (state.selectedWebcamSegmentIndex !== null) {
      state.deleteWebcamSegment(state.selectedWebcamSegmentIndex);
    }
  },

  nudgeSelectedTimelineItem: (deltaMs) => {
    if (deltaMs === 0) return;

    const state = get();
    const { project } = state;
    if (!project) return;

    const durationMs = project.timeline.durationMs;
    if (nudgeSelectedZoomRegion(state, project, deltaMs, durationMs)) return;
    if (nudgeSelectedTextSegment(state, project, deltaMs, durationMs)) return;
    if (nudgeSelectedAnnotationSegment(state, project, deltaMs, durationMs)) return;
    if (nudgeSelectedMaskSegment(state, project, deltaMs, durationMs)) return;
    if (nudgeSelectedSceneSegment(state, project, deltaMs, durationMs)) return;
    nudgeSelectedWebcamSegment(state, project, deltaMs, durationMs);
  },
});
