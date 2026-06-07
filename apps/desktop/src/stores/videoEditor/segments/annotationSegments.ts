import type { SliceCreator, AnnotationSegment, AnnotationShape } from '../types';
import { clampAnnotationShape, normalizeAnnotationConfig } from '../../../utils/videoAnnotations';
import {
  clampSegmentToDuration,
  ensureAnnotationHistoryInitialized,
  type AnnotationHistoryEntry,
  pushAnnotationHistory,
} from './shared';

export interface AnnotationSegmentsSlice {
  selectedAnnotationSegmentId: string | null;
  selectedAnnotationShapeId: string | null;
  annotationDeleteMode: 'segment' | 'shape' | null;

  selectAnnotationSegment: (id: string | null, shapeId?: string | null) => void;
  selectAnnotationShape: (id: string | null) => void;
  addAnnotationSegment: (segment: AnnotationSegment) => void;
  updateAnnotationSegment: (id: string, updates: Partial<AnnotationSegment>) => void;
  deleteAnnotationSegment: (id: string) => void;
  addAnnotationShape: (segmentId: string, shape: AnnotationShape) => void;
  updateAnnotationShape: (segmentId: string, shapeId: string, updates: Partial<AnnotationShape>) => void;
  reorderAnnotationShape: (segmentId: string, shapeId: string, targetIndex: number) => void;
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
}

export const createAnnotationSegmentsSlice: SliceCreator<AnnotationSegmentsSlice> = (set, get) => ({
  selectedAnnotationSegmentId: null,
  selectedAnnotationShapeId: null,
  annotationDeleteMode: null,
  annotationHistory: [],
  annotationHistoryIndex: -1,
  _annotationDragSnapshot: null,

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

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: get().annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

    const clampedSegment = {
      ...clampSegmentToDuration(segment, project.timeline.durationMs),
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

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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

  reorderAnnotationShape: (segmentId, shapeId, targetIndex) => {
    const { project, selectedAnnotationSegmentId, selectedAnnotationShapeId, annotationDeleteMode } = get();
    let { annotationHistory, annotationHistoryIndex } = get();
    if (!project) return;
    const annotations = normalizeAnnotationConfig(project.annotations);
    let didReorder = false;

    const newSegments = annotations.segments.map((segment) => {
      if (segment.id !== segmentId) return segment;

      const currentIndex = segment.shapes.findIndex((shape) => shape.id === shapeId);
      if (currentIndex < 0) return segment;

      const nextIndex = Math.max(0, Math.min(Math.round(targetIndex), segment.shapes.length - 1));
      if (nextIndex === currentIndex) return segment;
      if (nextIndex < 0 || nextIndex >= segment.shapes.length) return segment;

      const nextShapes = [...segment.shapes];
      const [movedShape] = nextShapes.splice(currentIndex, 1);
      nextShapes.splice(nextIndex, 0, movedShape);
      didReorder = true;

      return { ...segment, shapes: nextShapes };
    });

    if (!didReorder) return;

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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

    const seed = ensureAnnotationHistoryInitialized(annotationHistory, annotationHistoryIndex, {
      segments: annotations.segments,
      selectedSegmentId: selectedAnnotationSegmentId,
      selectedShapeId: selectedAnnotationShapeId,
      deleteMode: annotationDeleteMode,
    });
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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

    const seed = ensureAnnotationHistoryInitialized(
      annotationHistory,
      annotationHistoryIndex,
      _annotationDragSnapshot
    );
    annotationHistory = seed.history;
    annotationHistoryIndex = seed.index;

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
});
