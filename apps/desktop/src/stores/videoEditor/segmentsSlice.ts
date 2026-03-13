import type {
  SliceCreator,
  ZoomRegion,
  TextSegment,
  AnnotationSegment,
  AnnotationShape,
  MaskSegment,
  SceneSegment,
  VisibilitySegment,
  WebcamConfig,
  CursorConfig,
  AudioTrackSettings,
  VideoProject,
} from './types';
import { createTextSegmentId, getTextSegmentIndexFromId } from '../../utils/textSegmentId';
import { clampAnnotationShape, normalizeAnnotationConfig } from '../../utils/videoAnnotations';
import { snapshotOverlayState } from './overlayAdjustment';
import { pushTrimHistory } from './trimSlice';

/**
 * Maximum annotation undo history size.
 */
const MAX_ANNOTATION_HISTORY = 50;

/**
 * Undo history entry for annotation operations.
 */
interface AnnotationHistoryEntry {
  segments: AnnotationSegment[];
  selectedSegmentId: string | null;
  selectedShapeId: string | null;
  deleteMode: 'segment' | 'shape' | null;
}

/**
 * Push a new state to annotation history, clearing any redo states.
 */
function pushAnnotationHistory(
  history: AnnotationHistoryEntry[],
  historyIndex: number,
  newEntry: AnnotationHistoryEntry
): { history: AnnotationHistoryEntry[]; index: number } {
  const newHistory = history.slice(0, historyIndex + 1);
  newHistory.push(newEntry);

  if (newHistory.length > MAX_ANNOTATION_HISTORY) {
    newHistory.shift();
    return { history: newHistory, index: newHistory.length - 1 };
  }

  return { history: newHistory, index: newHistory.length - 1 };
}

function ensureTrimHistoryInitialized(
  project: VideoProject,
  trimHistory: Parameters<typeof pushTrimHistory>[0],
  trimHistoryIndex: number,
  selectedTrimSegmentId: string | null
): ReturnType<typeof pushTrimHistory> {
  if (trimHistory.length > 0) {
    return { history: trimHistory, index: trimHistoryIndex };
  }

  return pushTrimHistory([], -1, {
    segments: [...project.timeline.segments],
    selectedId: selectedTrimSegmentId,
    overlays: snapshotOverlayState(project),
  });
}

/**
 * Generate a unique zoom region ID
 */
export function generateZoomRegionId(): string {
  return `zoom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Segments state and actions for managing timeline segments
 * (zoom regions, text, mask, scene, webcam)
 */
export interface SegmentsSlice {
  // Selection state
  selectedZoomRegionId: string | null;
  selectedWebcamSegmentIndex: number | null;
  selectedSceneSegmentId: string | null;
  selectedTextSegmentId: string | null;
  selectedAnnotationSegmentId: string | null;
  selectedAnnotationShapeId: string | null;
  annotationDeleteMode: 'segment' | 'shape' | null;
  selectedMaskSegmentId: string | null;

  // Zoom region actions
  selectZoomRegion: (id: string | null) => void;
  addZoomRegion: (region: ZoomRegion) => void;
  updateZoomRegion: (id: string, updates: Partial<ZoomRegion>) => void;
  deleteZoomRegion: (id: string) => void;
  splitZoomRegionAtPlayhead: () => void;
  deleteSelectedZoomRegion: () => void;

  // Text segment actions
  selectTextSegment: (id: string | null) => void;
  addTextSegment: (segment: TextSegment) => void;
  updateTextSegment: (id: string, updates: Partial<TextSegment>) => void;
  deleteTextSegment: (id: string) => void;

  // Annotation segment actions
  selectAnnotationSegment: (id: string | null, shapeId?: string | null) => void;
  selectAnnotationShape: (id: string | null) => void;
  addAnnotationSegment: (segment: AnnotationSegment) => void;
  updateAnnotationSegment: (id: string, updates: Partial<AnnotationSegment>) => void;
  deleteAnnotationSegment: (id: string) => void;
  addAnnotationShape: (segmentId: string, shape: AnnotationShape) => void;
  updateAnnotationShape: (segmentId: string, shapeId: string, updates: Partial<AnnotationShape>) => void;
  deleteAnnotationShape: (segmentId: string, shapeId: string) => void;

  // Annotation undo/redo
  annotationHistory: AnnotationHistoryEntry[];
  annotationHistoryIndex: number;
  undoAnnotation: () => void;
  redoAnnotation: () => void;

  // Annotation drag batching — call before/after continuous operations (move/resize)
  _annotationDragSnapshot: AnnotationHistoryEntry | null;
  beginAnnotationDrag: () => void;
  commitAnnotationDrag: () => void;

  // Mask segment actions
  selectMaskSegment: (id: string | null) => void;
  addMaskSegment: (segment: MaskSegment) => void;
  updateMaskSegment: (id: string, updates: Partial<MaskSegment>) => void;
  deleteMaskSegment: (id: string) => void;

  // Scene segment actions
  selectSceneSegment: (id: string | null) => void;
  addSceneSegment: (segment: SceneSegment) => void;
  updateSceneSegment: (id: string, updates: Partial<SceneSegment>) => void;
  deleteSceneSegment: (id: string) => void;

  // Webcam segment actions
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

export const createSegmentsSlice: SliceCreator<SegmentsSlice> = (set, get) => ({
  // Initial selection state
  selectedZoomRegionId: null,
  selectedWebcamSegmentIndex: null,
  selectedSceneSegmentId: null,
  selectedTextSegmentId: null,
  selectedAnnotationSegmentId: null,
  selectedAnnotationShapeId: null,
  annotationDeleteMode: null,
  annotationHistory: [],
  annotationHistoryIndex: -1,
  _annotationDragSnapshot: null,
  selectedMaskSegmentId: null,

  // Zoom region actions
  selectZoomRegion: (id) =>
    set({
      selectedZoomRegionId: id,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addZoomRegion: (region) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedRegion = {
      ...region,
      startMs: Math.max(0, Math.min(region.startMs, durationMs)),
      endMs: Math.max(0, Math.min(region.endMs, durationMs)),
    };

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: [...project.zoom.regions, clampedRegion],
        },
      },
      selectedZoomRegionId: clampedRegion.id,
    });
  },

  updateZoomRegion: (id, updates) => {
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
    const newRegions = project.zoom.regions.map((r) => (r.id === id ? { ...r, ...updates } : r));
    const overlays = snapshotOverlayState(project);
    overlays.zoomRegions = newRegions;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: newRegions,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteZoomRegion: (id) => {
    const {
      project,
      selectedZoomRegionId,
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
    overlays.zoomRegions = project.zoom.regions.filter((r) => r.id !== id);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: overlays.zoomRegions,
        },
      },
      selectedZoomRegionId: selectedZoomRegionId === id ? null : selectedZoomRegionId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  splitZoomRegionAtPlayhead: () => {
    const { project, currentTimeMs, selectedZoomRegionId } = get();
    if (!project || !selectedZoomRegionId) return;

    const region = project.zoom.regions.find((r) => r.id === selectedZoomRegionId);
    if (!region) return;

    // Check if playhead is within the region (with some margin)
    const minDuration = 100; // Minimum 100ms per segment
    if (currentTimeMs <= region.startMs + minDuration || currentTimeMs >= region.endMs - minDuration) {
      return; // Can't split at edges or if segments would be too small
    }

    // Create two new regions from the split
    const region1: ZoomRegion = {
      ...region,
      id: generateZoomRegionId(),
      endMs: currentTimeMs,
    };

    const region2: ZoomRegion = {
      ...region,
      id: generateZoomRegionId(),
      startMs: currentTimeMs,
    };

    // Replace original with two new regions
    const newRegions = project.zoom.regions
      .filter((r) => r.id !== selectedZoomRegionId)
      .concat([region1, region2])
      .sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: newRegions,
        },
      },
      selectedZoomRegionId: region1.id, // Select the first part
    });
  },

  deleteSelectedZoomRegion: () => {
    const { selectedZoomRegionId, deleteZoomRegion } = get();
    if (selectedZoomRegionId) {
      deleteZoomRegion(selectedZoomRegionId);
    }
  },

  // Text segment actions
  selectTextSegment: (id) =>
    set({
      selectedTextSegmentId: id,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addTextSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration (convert ms to seconds)
    const durationSec = project.timeline.durationMs / 1000;
    const clampedSegment = {
      ...segment,
      start: Math.max(0, Math.min(segment.start, durationSec)),
      end: Math.max(0, Math.min(segment.end, durationSec)),
    };

    const segments = [...project.text.segments, clampedSegment];
    // Sort by start time (Cap uses seconds)
    segments.sort((a, b) => a.start - b.start);

    // Find the index of the newly added segment after sorting
    const newIndex = segments.findIndex((s) => Math.abs(s.start - clampedSegment.start) < 0.001);

    // Generate selection ID (shared formatter used by TextTrack/TextOverlay).
    const segmentId = createTextSegmentId(clampedSegment.start, newIndex);

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments,
        },
      },
      selectedTextSegmentId: segmentId,
    });
  },

  updateTextSegment: (id, updates) => {
    const {
      project,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const targetIndex = getTextSegmentIndexFromId(id);
    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= project.text.segments.length) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const newSegments = project.text.segments.map((s, idx) => {
      if (idx === targetIndex) {
        return { ...s, ...updates };
      }
      return s;
    });
    const overlays = snapshotOverlayState(project);
    overlays.textSegments = newSegments;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments: newSegments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteTextSegment: (id) => {
    const {
      project,
      selectedTextSegmentId,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const targetIndex = getTextSegmentIndexFromId(id);
    if (targetIndex === null) return;
    if (targetIndex < 0 || targetIndex >= project.text.segments.length) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const overlays = snapshotOverlayState(project);
    overlays.textSegments = project.text.segments.filter((_, idx) => idx !== targetIndex);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        text: {
          ...project.text,
          segments: overlays.textSegments,
        },
      },
      selectedTextSegmentId: selectedTextSegmentId === id ? null : selectedTextSegmentId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Annotation segment actions
  selectAnnotationSegment: (id, shapeId) =>
    set((state) => {
      const annotations = normalizeAnnotationConfig(state.project?.annotations);
      const selectedSegment = id
        ? annotations.segments.find((segment) => segment.id === id) ?? null
        : null;
      const explicitShapeId =
        shapeId != null &&
        selectedSegment?.shapes.some((shape) => shape.id === shapeId)
          ? shapeId
          : null;
      const currentSelectedShapeId = state.selectedAnnotationShapeId;
      const preservedShapeId =
        id != null &&
        id === state.selectedAnnotationSegmentId &&
        currentSelectedShapeId != null &&
        selectedSegment?.shapes.some((shape) => shape.id === currentSelectedShapeId)
          ? currentSelectedShapeId
          : null;

      return {
        selectedAnnotationSegmentId: id,
        selectedAnnotationShapeId:
          explicitShapeId ??
          preservedShapeId ??
          selectedSegment?.shapes[0]?.id ??
          null,
        annotationDeleteMode:
          id == null
            ? null
            : explicitShapeId != null
              ? 'shape'
              : 'segment',
        selectedZoomRegionId: null,
        selectedSceneSegmentId: null,
        selectedTextSegmentId: null,
        selectedMaskSegmentId: null,
        selectedWebcamSegmentIndex: null,
      };
    }),

  selectAnnotationShape: (id) =>
    set((state) => ({
      selectedAnnotationShapeId: id,
      annotationDeleteMode:
        id != null
          ? 'shape'
          : state.selectedAnnotationSegmentId != null
            ? 'segment'
            : null,
    })),

  addAnnotationSegment: (segment) => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId } = get();
    let { annotationHistory, annotationHistoryIndex } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    // Push initial state on first mutation so undo can restore it
    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: get().annotationDeleteMode,
      });
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
      shapes: segment.shapes.map(clampAnnotationShape),
    };

    const newSegments = [...annotations.segments, clampedSegment]
      .sort((a, b) => a.startMs - b.startMs);

    const newSelectedSegmentId = clampedSegment.id;
    const newSelectedShapeId = clampedSegment.shapes[0]?.id ?? null;

    // Push result state to history
    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: newSegments,
      selectedSegmentId: newSelectedSegmentId,
      selectedShapeId: newSelectedShapeId,
      deleteMode: 'segment',
    });

    set({
      project: {
        ...project,
        annotations: { ...annotations, segments: newSegments },
      },
      selectedAnnotationSegmentId: newSelectedSegmentId,
      selectedAnnotationShapeId: newSelectedShapeId,
      annotationDeleteMode: 'segment',
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
    });
  },

  updateAnnotationSegment: (id, updates) => {
    const { project, _annotationDragSnapshot, annotationDeleteMode } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    const newSegments = annotations.segments
      .map((segment) => {
        if (segment.id !== id) return segment;
        return {
          ...segment,
          ...updates,
          shapes: (updates.shapes ?? segment.shapes).map(clampAnnotationShape),
        };
      })
      .sort((a, b) => a.startMs - b.startMs);

    // During a drag, skip history — it will be committed in commitAnnotationDrag
    if (_annotationDragSnapshot) {
      set({
        project: {
          ...project,
          annotations: { ...annotations, segments: newSegments },
        },
      });
      return;
    }

    const { selectedAnnotationSegmentId, selectedAnnotationShapeId } = get();
    let { annotationHistory, annotationHistoryIndex } = get();

    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: annotationDeleteMode,
      });
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: newSegments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });

    set({
      project: {
        ...project,
        annotations: { ...annotations, segments: newSegments },
      },
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
    });
  },

  deleteAnnotationSegment: (id) => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId, annotationDeleteMode } = get();
    let { annotationHistory, annotationHistoryIndex } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: annotationDeleteMode,
      });
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    const newSegments = annotations.segments.filter((segment) => segment.id !== id);
    const newSelectedSegmentId = selectedAnnotationSegmentId === id ? null : selectedAnnotationSegmentId;
    const newSelectedShapeId = selectedAnnotationSegmentId === id ? null : selectedAnnotationShapeId;

    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: newSegments,
      selectedSegmentId: newSelectedSegmentId,
      selectedShapeId: newSelectedShapeId,
      deleteMode: selectedAnnotationSegmentId === id ? null : annotationDeleteMode,
    });

    set({
      project: {
        ...project,
        annotations: { ...annotations, segments: newSegments },
      },
      selectedAnnotationSegmentId: newSelectedSegmentId,
      selectedAnnotationShapeId: newSelectedShapeId,
      annotationDeleteMode: selectedAnnotationSegmentId === id ? null : annotationDeleteMode,
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
    });
  },

  addAnnotationShape: (segmentId, shape) => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId, annotationDeleteMode } = get();
    let { annotationHistory, annotationHistoryIndex } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: annotationDeleteMode,
      });
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    const clampedShape = clampAnnotationShape(shape);
    const newSegments = annotations.segments.map((segment) =>
      segment.id === segmentId
        ? { ...segment, shapes: [...segment.shapes, clampedShape] }
        : segment
    );

    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: newSegments,
      selectedSegmentId: segmentId,
      selectedShapeId: clampedShape.id,
      deleteMode: 'shape',
    });

    set({
      project: {
        ...project,
        annotations: { ...annotations, segments: newSegments },
      },
      selectedAnnotationSegmentId: segmentId,
      selectedAnnotationShapeId: clampedShape.id,
      annotationDeleteMode: 'shape',
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
    });
  },

  updateAnnotationShape: (segmentId, shapeId, updates) => {
    const { project, _annotationDragSnapshot, annotationDeleteMode } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    const newSegments = annotations.segments.map((segment) => {
      if (segment.id !== segmentId) return segment;
      return {
        ...segment,
        shapes: segment.shapes.map((shape) =>
          shape.id === shapeId ? clampAnnotationShape({ ...shape, ...updates }) : shape
        ),
      };
    });

    // During a drag, skip history — it will be committed in commitAnnotationDrag
    if (_annotationDragSnapshot) {
      set({
        project: {
          ...project,
          annotations: { ...annotations, segments: newSegments },
        },
      });
      return;
    }

    const { selectedAnnotationSegmentId, selectedAnnotationShapeId } = get();
    let { annotationHistory, annotationHistoryIndex } = get();

    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: annotationDeleteMode,
      });
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: newSegments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });

    set({
      project: {
        ...project,
        annotations: { ...annotations, segments: newSegments },
      },
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
    });
  },

  deleteAnnotationShape: (segmentId, shapeId) => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId, annotationDeleteMode } = get();
    let { annotationHistory, annotationHistoryIndex } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: annotationDeleteMode,
      });
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    let nextSelectedShapeId = selectedAnnotationShapeId;
    const newSegments = annotations.segments.map((segment) => {
      if (segment.id !== segmentId) return segment;

      const nextShapes = segment.shapes.filter((shape) => shape.id !== shapeId);
      if (selectedAnnotationShapeId === shapeId) {
        nextSelectedShapeId = nextShapes[0]?.id ?? null;
      }

      return { ...segment, shapes: nextShapes };
    });

    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: newSegments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: nextSelectedShapeId,
      deleteMode: nextSelectedShapeId != null ? 'shape' : 'segment',
    });

    set({
      project: {
        ...project,
        annotations: { ...annotations, segments: newSegments },
      },
      selectedAnnotationShapeId: nextSelectedShapeId,
      annotationDeleteMode: nextSelectedShapeId != null ? 'shape' : 'segment',
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
    });
  },

  undoAnnotation: () => {
    const { project, annotationHistory, annotationHistoryIndex } = get();
    if (!project || annotationHistoryIndex <= 0) return;

    const prevEntry = annotationHistory[annotationHistoryIndex - 1];

    set({
      project: {
        ...project,
        annotations: {
          ...normalizeAnnotationConfig(project.annotations),
          segments: prevEntry.segments,
        },
      },
      selectedAnnotationSegmentId: prevEntry.selectedSegmentId,
      selectedAnnotationShapeId: prevEntry.selectedShapeId,
      annotationDeleteMode: prevEntry.deleteMode,
      activeUndoDomain: 'annotation',
      annotationHistoryIndex: annotationHistoryIndex - 1,
    });
  },

  redoAnnotation: () => {
    const { project, annotationHistory, annotationHistoryIndex } = get();
    if (!project || annotationHistoryIndex >= annotationHistory.length - 1) return;

    const nextEntry = annotationHistory[annotationHistoryIndex + 1];

    set({
      project: {
        ...project,
        annotations: {
          ...normalizeAnnotationConfig(project.annotations),
          segments: nextEntry.segments,
        },
      },
      selectedAnnotationSegmentId: nextEntry.selectedSegmentId,
      selectedAnnotationShapeId: nextEntry.selectedShapeId,
      annotationDeleteMode: nextEntry.deleteMode,
      activeUndoDomain: 'annotation',
      annotationHistoryIndex: annotationHistoryIndex + 1,
    });
  },

  beginAnnotationDrag: () => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId, annotationDeleteMode } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    set({
      _annotationDragSnapshot: {
        segments: annotations.segments,
        selectedSegmentId: selectedAnnotationSegmentId,
        selectedShapeId: selectedAnnotationShapeId,
        deleteMode: annotationDeleteMode,
      },
    });
  },

  commitAnnotationDrag: () => {
    const {
      project,
      _annotationDragSnapshot,
      selectedAnnotationSegmentId,
      selectedAnnotationShapeId,
      annotationDeleteMode,
    } = get();
    if (!project || !_annotationDragSnapshot) return;
    const annotations = normalizeAnnotationConfig(project.annotations);

    let { annotationHistory, annotationHistoryIndex } = get();

    // Push pre-drag snapshot as initial state if history is empty
    if (annotationHistory.length === 0) {
      const init = pushAnnotationHistory([], -1, _annotationDragSnapshot);
      annotationHistory = init.history;
      annotationHistoryIndex = init.index;
    }

    // Push result state (current state after drag)
    const { history, index } = pushAnnotationHistory(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });

    set({
      activeUndoDomain: 'annotation',
      annotationHistory: history,
      annotationHistoryIndex: index,
      _annotationDragSnapshot: null,
    });
  },

  // Mask segment actions
  selectMaskSegment: (id) =>
    set({
      selectedMaskSegmentId: id,
      selectedZoomRegionId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedSceneSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addMaskSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
    };

    const segments = [...project.mask.segments, clampedSegment];
    segments.sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments,
        },
      },
      selectedMaskSegmentId: clampedSegment.id,
    });
  },

  updateMaskSegment: (id, updates) => {
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
    const newSegments = project.mask.segments.map((s) => (s.id === id ? { ...s, ...updates } : s));
    const overlays = snapshotOverlayState(project);
    overlays.maskSegments = newSegments;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments: newSegments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteMaskSegment: (id) => {
    const {
      project,
      selectedMaskSegmentId,
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
    overlays.maskSegments = project.mask.segments.filter((s) => s.id !== id);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        mask: {
          ...project.mask,
          segments: overlays.maskSegments,
        },
      },
      selectedMaskSegmentId: selectedMaskSegmentId === id ? null : selectedMaskSegmentId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Scene segment actions
  selectSceneSegment: (id) =>
    set({
      selectedSceneSegmentId: id,
      selectedZoomRegionId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addSceneSegment: (segment) => {
    const { project } = get();
    if (!project) return;

    // Clamp to video duration
    const durationMs = project.timeline.durationMs;
    const clampedSegment = {
      ...segment,
      startMs: Math.max(0, Math.min(segment.startMs, durationMs)),
      endMs: Math.max(0, Math.min(segment.endMs, durationMs)),
    };

    const segments = [...project.scene.segments, clampedSegment];
    segments.sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments,
        },
      },
      selectedSceneSegmentId: clampedSegment.id,
    });
  },

  updateSceneSegment: (id, updates) => {
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
    const newSegments = project.scene.segments.map((s) => (s.id === id ? { ...s, ...updates } : s));
    const overlays = snapshotOverlayState(project);
    overlays.sceneSegments = newSegments;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments: newSegments,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteSceneSegment: (id) => {
    const {
      project,
      selectedSceneSegmentId,
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
    overlays.sceneSegments = project.scene.segments.filter((s) => s.id !== id);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        scene: {
          ...project.scene,
          segments: overlays.sceneSegments,
        },
      },
      selectedSceneSegmentId: selectedSceneSegmentId === id ? null : selectedSceneSegmentId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  // Webcam segment actions
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
