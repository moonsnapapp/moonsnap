import { useCallback, useEffect, useMemo, useRef } from 'react';
import Konva from 'konva';
import type { CanvasShape, CanvasBounds } from '../types';
import type { EditorHistoryActions } from './useEditorHistory';
import { expandBoundsForShapes, expandCropRegionForShapes } from '../utils/canvasGeometry';

interface UseShapeTransformProps {
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  /** Context-aware history actions for undo/redo support */
  history: EditorHistoryActions;
  /** Current canvas bounds for auto-extend */
  canvasBounds: CanvasBounds | null;
  /** Setter for canvas bounds */
  setCanvasBounds: (bounds: CanvasBounds | null) => void;
  /** Original image dimensions */
  originalImageSize: { width: number; height: number } | null;
  /** Current crop region for auto-extend */
  cropRegion: { x: number; y: number; width: number; height: number } | null;
  /** Setter for crop region */
  setCropRegion: (region: { x: number; y: number; width: number; height: number } | null) => void;
  /** Whether user has manually expanded crop — prevents auto-shrink */
  cropUserExpanded: boolean;
}

interface UseShapeTransformReturn {
  handleShapeDragStart: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  handleShapeDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  commitManualDragDelta: (id: string, dx: number, dy: number) => void;
  handleArrowDragEnd: (id: string, newPoints: number[]) => void;
  handleTransformStart: () => void;
  handleTransformEnd: (id: string, e: Konva.KonvaEventObject<Event>) => void;
  handleShapeClick: (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  handleArrowEndpointDragEnd: (shapeId: string, newPoints: number[]) => void;
}

type NativeDragTarget = Konva.KonvaEventObject<DragEvent>['target'];

interface NativeDragState {
  draggedShape: CanvasShape;
  selectedIdsSet: Set<string>;
  isGroupDrag: boolean;
  targetX: number;
  targetY: number;
  dx: number;
  dy: number;
  isPen: boolean;
}

const DRAG_EPSILON = 0.01;

function hasDrawablePoints(shape: CanvasShape) {
  return Boolean(shape.points && shape.points.length >= 2);
}

function hasPenPoints(shape: CanvasShape): shape is CanvasShape & { points: number[] } {
  return shape.type === 'pen' && hasDrawablePoints(shape);
}

function hasManualPointDragType(shape: CanvasShape) {
  return shape.type === 'pen' || shape.type === 'arrow' || shape.type === 'line';
}

function hasManualDragPoints(shape: CanvasShape): shape is CanvasShape & { points: number[] } {
  return hasManualPointDragType(shape) && hasDrawablePoints(shape);
}

function didMove(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_EPSILON || Math.abs(dy) > DRAG_EPSILON;
}

function movePoints(points: number[], dx: number, dy: number): number[] {
  return points.map((val, index) => (index % 2 === 0 ? val + dx : val + dy));
}

function moveShapePosition(shape: CanvasShape, dx: number, dy: number): CanvasShape {
  return {
    ...shape,
    x: (shape.x ?? 0) + dx,
    y: (shape.y ?? 0) + dy,
  };
}

function applyManualDragToShape(shape: CanvasShape, dx: number, dy: number): CanvasShape {
  if (hasManualDragPoints(shape)) {
    return { ...shape, points: movePoints(shape.points, dx, dy) };
  }

  return moveShapePosition(shape, dx, dy);
}

function getShapeDragDelta(
  shape: CanvasShape,
  targetX: number,
  targetY: number
): { dx: number; dy: number; isPen: boolean } {
  const isPen = hasPenPoints(shape);
  const origin = getShapeDragOrigin(shape, isPen);

  return {
    dx: targetX - origin.x,
    dy: targetY - origin.y,
    isPen,
  };
}

function getShapeDragOrigin(shape: CanvasShape, isPen: boolean) {
  return {
    x: getShapeDragOriginX(shape, isPen),
    y: getShapeDragOriginY(shape, isPen),
  };
}

function getShapeDragOriginX(shape: CanvasShape, isPen: boolean) {
  return isPen ? 0 : (shape.x ?? 0);
}

function getShapeDragOriginY(shape: CanvasShape, isPen: boolean) {
  return isPen ? 0 : (shape.y ?? 0);
}

function getNormalizedStart(origin: number | undefined, size: number | undefined): number {
  return (origin ?? 0) + Math.min(size ?? 0, 0);
}

function getBlurDragDelta(
  shape: CanvasShape,
  targetX: number,
  targetY: number
): { dx: number; dy: number } {
  return {
    dx: targetX - getNormalizedStart(shape.x, shape.width),
    dy: targetY - getNormalizedStart(shape.y, shape.height),
  };
}

function getNativeDragDelta(
  draggedShape: CanvasShape,
  isGroupDrag: boolean,
  targetX: number,
  targetY: number
) {
  const dragDelta = getShapeDragDelta(draggedShape, targetX, targetY);

  if (!isGroupDrag && draggedShape.type === 'blur') {
    return { ...dragDelta, ...getBlurDragDelta(draggedShape, targetX, targetY) };
  }

  return dragDelta;
}

function getNativeDragState({
  draggedShape,
  selectedIds,
  id,
  target,
}: {
  draggedShape: CanvasShape;
  selectedIds: string[];
  id: string;
  target: NativeDragTarget;
}): NativeDragState {
  const selectedIdsSet = new Set(selectedIds);
  const isGroupDrag = selectedIds.length > 1 && selectedIdsSet.has(id);
  const targetX = target.x();
  const targetY = target.y();
  const { dx, dy, isPen } = getNativeDragDelta(draggedShape, isGroupDrag, targetX, targetY);

  return {
    draggedShape,
    selectedIdsSet,
    isGroupDrag,
    targetX,
    targetY,
    dx,
    dy,
    isPen,
  };
}

function applyNativeGroupDrag(
  shapes: CanvasShape[],
  selectedIds: Set<string>,
  dx: number,
  dy: number
): CanvasShape[] {
  return shapes.map((shape) => {
    if (!selectedIds.has(shape.id)) return shape;
    return applyNativeGroupDragToShape(shape, dx, dy);
  });
}

function applyNativeGroupDragToShape(shape: CanvasShape, dx: number, dy: number) {
  return hasPenPoints(shape)
    ? { ...shape, points: movePoints(shape.points, dx, dy) }
    : moveShapePosition(shape, dx, dy);
}

function applyNativeSingleDrag(
  shapes: CanvasShape[],
  id: string,
  draggedShape: CanvasShape,
  targetX: number,
  targetY: number,
  dx: number,
  dy: number
): CanvasShape[] {
  if (hasPenPoints(draggedShape)) {
    const newPoints = movePoints(draggedShape.points, dx, dy);
    return shapes.map((shape) =>
      shape.id === id ? { ...shape, points: newPoints } : shape
    );
  }

  if (draggedShape.type === 'blur') {
    return shapes.map((shape) =>
      shape.id === id
        ? { ...shape, x: (shape.x ?? 0) + dx, y: (shape.y ?? 0) + dy }
        : shape
    );
  }

  return shapes.map((shape) =>
    shape.id === id ? { ...shape, x: targetX, y: targetY } : shape
  );
}

function applyNativeDrag(
  shapes: CanvasShape[],
  id: string,
  dragState: NativeDragState
): CanvasShape[] {
  if (dragState.isGroupDrag) {
    return applyNativeGroupDrag(shapes, dragState.selectedIdsSet, dragState.dx, dragState.dy);
  }

  return applyNativeSingleDrag(
    shapes,
    id,
    dragState.draggedShape,
    dragState.targetX,
    dragState.targetY,
    dragState.dx,
    dragState.dy
  );
}

function resetNativeDragTarget(target: NativeDragTarget, dragState: NativeDragState) {
  if (dragState.isPen) {
    target.position({ x: 0, y: 0 });
  }
}

function shouldIgnoreShapeClick(event: Konva.KonvaEventObject<MouseEvent>) {
  return event.evt?.button === 1;
}

function toggleShapeSelection(selectedIds: string[], selectedIdsSet: Set<string>, shapeId: string) {
  return selectedIdsSet.has(shapeId)
    ? selectedIds.filter((id) => id !== shapeId)
    : [...selectedIds, shapeId];
}

function getShapeClickSelection({
  shapeId,
  event,
  selectedIds,
}: {
  shapeId: string;
  event: Konva.KonvaEventObject<MouseEvent>;
  selectedIds: string[];
}): string[] | null {
  const selectedIdsSet = new Set(selectedIds);

  if (event.evt?.shiftKey) {
    return toggleShapeSelection(selectedIds, selectedIdsSet, shapeId);
  }

  return selectedIdsSet.has(shapeId) ? null : [shapeId];
}

function getExpandedCanvasBoundsAfterTransform({
  canvasBounds,
  updatedShapes,
  originalImageSize,
  cropUserExpanded,
}: {
  canvasBounds: CanvasBounds | null;
  updatedShapes: CanvasShape[];
  originalImageSize: { width: number; height: number } | null;
  cropUserExpanded: boolean;
}) {
  if (!canvasBounds || !originalImageSize) return null;
  return expandBoundsForShapes(canvasBounds, updatedShapes, originalImageSize, cropUserExpanded);
}

function getExpandedCropRegionAfterTransform({
  cropRegion,
  updatedShapes,
  cropUserExpanded,
}: {
  cropRegion: UseShapeTransformProps['cropRegion'];
  updatedShapes: CanvasShape[];
  cropUserExpanded: boolean;
}) {
  if (!cropRegion) return null;
  return expandCropRegionForShapes(cropRegion, updatedShapes, cropUserExpanded);
}

/**
 * Hook for shape transformation operations - drag, resize, rotate
 * Manages undo history snapshots for batched operations
 */
export const useShapeTransform = ({
  shapes,
  onShapesChange,
  selectedIds,
  setSelectedIds,
  history,
  canvasBounds,
  setCanvasBounds,
  originalImageSize,
  cropRegion,
  setCropRegion,
  cropUserExpanded,
}: UseShapeTransformProps): UseShapeTransformReturn => {
  const { takeSnapshot, commitSnapshot } = history;
  const selectedIdsRef = useRef(selectedIds);
  const shapeById = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape] as const)), [shapes]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  /** Try to expand canvas bounds and crop region to fit all shapes after a drag/transform */
  const maybeExpandBounds = useCallback(
    (updatedShapes: CanvasShape[]) => {
      const expanded = getExpandedCanvasBoundsAfterTransform({
        canvasBounds,
        updatedShapes,
        originalImageSize,
        cropUserExpanded,
      });
      if (expanded) {
        setCanvasBounds(expanded);
      }

      const expandedCrop = getExpandedCropRegionAfterTransform({
        cropRegion,
        updatedShapes,
        cropUserExpanded,
      });
      if (expandedCrop) {
        setCropRegion(expandedCrop);
      }
    },
    [canvasBounds, originalImageSize, setCanvasBounds, cropRegion, setCropRegion, cropUserExpanded]
  );

  // Drag start should stay lightweight for immediate pointer response.
  const handleShapeDragStart = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    // Ignore middle mouse button (used for panning)
    if (e.evt?.button === 1) {
      e.evt.preventDefault();
      return;
    }

    // Add to selection if not already selected
    if (!selectedIdsRef.current.includes(id)) {
      setSelectedIds([id]);
    }
  }, [setSelectedIds]);

  // Handle shape drag end - supports both single and group movement
  const handleShapeDragEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const draggedShape = shapeById.get(id);
      if (!draggedShape) {
        return;
      }

      const dragState = getNativeDragState({
        draggedShape,
        selectedIds: selectedIdsRef.current,
        id,
        target: e.target,
      });

      if (!didMove(dragState.dx, dragState.dy)) {
        return;
      }

      // Snapshot just before committing state updates. During drag, shapes are moved
      // imperatively in Konva and React shape state is unchanged, so this still captures
      // the true pre-drag state while avoiding drag-start latency.
      takeSnapshot();

      resetNativeDragTarget(e.target, dragState);
      const updatedShapes = applyNativeDrag(shapes, id, dragState);

      onShapesChange(updatedShapes);
      maybeExpandBounds(updatedShapes);

      // Resume history tracking
      commitSnapshot();
    },
    [shapes, shapeById, onShapesChange, takeSnapshot, commitSnapshot, maybeExpandBounds]
  );

  // Commit a drag delta produced outside Konva's native draggable pipeline.
  const commitManualDragDelta = useCallback((id: string, dx: number, dy: number) => {
    if (!didMove(dx, dy)) {
      return;
    }

    const draggedShape = shapeById.get(id);
    if (!draggedShape) return;

    const selectedNow = selectedIdsRef.current;
    const selectedNowSet = new Set(selectedNow);
    const isGroupDrag = selectedNow.length > 1 && selectedNowSet.has(id);

    takeSnapshot();

    const updatedShapes = shapes.map((shape) => {
      const shouldMove = isGroupDrag ? selectedNowSet.has(shape.id) : shape.id === id;
      return shouldMove ? applyManualDragToShape(shape, dx, dy) : shape;
    });

    onShapesChange(updatedShapes);
    maybeExpandBounds(updatedShapes);
    commitSnapshot();
  }, [shapes, shapeById, onShapesChange, takeSnapshot, commitSnapshot, maybeExpandBounds]);

  // Handle transform start - pause history
  const handleTransformStart = useCallback(() => {
    takeSnapshot();
  }, [takeSnapshot]);

  // Handle transform end - NO-OP for Transformer-attached shapes
  // The Transformer's onTransformEnd in EditorCanvas handles all shapes at once
  // to ensure proper batched history (single undo for multi-shape transforms).
  // This handler remains for API compatibility but does nothing.
  const handleTransformEnd = useCallback(
    (_id: string, _e: Konva.KonvaEventObject<Event>) => {
      // Intentionally empty - Transformer's onTransformEnd handles this
    },
    []
  );

  // Handle shape click with shift for multi-select
  const handleShapeClick = useCallback(
    (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      // Ignore middle mouse button (used for panning)
      if (shouldIgnoreShapeClick(e)) return;

      const nextSelection = getShapeClickSelection({
        shapeId,
        event: e,
        selectedIds: selectedIdsRef.current,
      });
      if (nextSelection) setSelectedIds(nextSelection);
    },
    [setSelectedIds]
  );

  // Handle arrow drag end - updates all points by delta
  const handleArrowDragEnd = useCallback(
    (id: string, newPoints: number[]) => {
      const updatedShapes = shapes.map(s =>
        s.id === id ? { ...s, points: newPoints } : s
      );
      onShapesChange(updatedShapes);
      maybeExpandBounds(updatedShapes);
      commitSnapshot();
    },
    [shapes, onShapesChange, commitSnapshot, maybeExpandBounds]
  );

  // Handle arrow endpoint drag end - update state and expand bounds
  const handleArrowEndpointDragEnd = useCallback(
    (shapeId: string, newPoints: number[]) => {
      const updatedShapes = shapes.map(s =>
        s.id === shapeId ? { ...s, points: newPoints } : s
      );
      onShapesChange(updatedShapes);
      maybeExpandBounds(updatedShapes);
    },
    [shapes, onShapesChange, maybeExpandBounds]
  );

  return {
    handleShapeDragStart,
    handleShapeDragEnd,
    commitManualDragDelta,
    handleArrowDragEnd,
    handleTransformStart,
    handleTransformEnd,
    handleShapeClick,
    handleArrowEndpointDragEnd,
  };
};
