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

const DRAG_EPSILON = 0.01;

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
      if (!canvasBounds || !originalImageSize) return;
      const expanded = expandBoundsForShapes(canvasBounds, updatedShapes, originalImageSize, cropUserExpanded);
      if (expanded) {
        setCanvasBounds(expanded);
      }
      if (cropRegion) {
        const expandedCrop = expandCropRegionForShapes(cropRegion, updatedShapes, cropUserExpanded);
        if (expandedCrop) {
          setCropRegion(expandedCrop);
        }
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

      // Calculate delta based on shape type
      const selectedNow = selectedIdsRef.current;
      const selectedNowSet = new Set(selectedNow);
      const isGroupDrag = selectedNow.length > 1 && selectedNowSet.has(id);
      const isPen = draggedShape.type === 'pen' && draggedShape.points && draggedShape.points.length >= 2;
      const dx = e.target.x() - (isPen ? 0 : (draggedShape.x ?? 0));
      const dy = e.target.y() - (isPen ? 0 : (draggedShape.y ?? 0));
      const movedByDelta = Math.abs(dx) > DRAG_EPSILON || Math.abs(dy) > DRAG_EPSILON;

      let blurDx = 0;
      let blurDy = 0;
      if (!isGroupDrag && draggedShape.type === 'blur') {
        const normalizedX = (draggedShape.width ?? 0) < 0
          ? (draggedShape.x ?? 0) + (draggedShape.width ?? 0)
          : (draggedShape.x ?? 0);
        const normalizedY = (draggedShape.height ?? 0) < 0
          ? (draggedShape.y ?? 0) + (draggedShape.height ?? 0)
          : (draggedShape.y ?? 0);
        blurDx = e.target.x() - normalizedX;
        blurDy = e.target.y() - normalizedY;
        const movedBlur = Math.abs(blurDx) > DRAG_EPSILON || Math.abs(blurDy) > DRAG_EPSILON;
        if (!movedBlur) {
          return;
        }
      } else if (!movedByDelta) {
        return;
      }

      // Snapshot just before committing state updates. During drag, shapes are moved
      // imperatively in Konva and React shape state is unchanged, so this still captures
      // the true pre-drag state while avoiding drag-start latency.
      takeSnapshot();

      // Reset position for pen strokes (they use points, not x/y)
      if (isPen) {
        e.target.position({ x: 0, y: 0 });
      }

      let updatedShapes: CanvasShape[];

      // Group drag: move all selected shapes by the same delta
      if (isGroupDrag) {
        updatedShapes = shapes.map((shape) => {
          if (!selectedNowSet.has(shape.id)) return shape;

          if (shape.type === 'pen' && shape.points && shape.points.length >= 2) {
            const newPoints = shape.points.map((val, i) =>
              i % 2 === 0 ? val + dx : val + dy
            );
            return { ...shape, points: newPoints };
          }

          return {
            ...shape,
            x: (shape.x ?? 0) + dx,
            y: (shape.y ?? 0) + dy,
          };
        });
      } else {
        // Single shape drag
        if (isPen) {
          const newPoints = draggedShape.points!.map((val, i) =>
            i % 2 === 0 ? val + dx : val + dy
          );
          updatedShapes = shapes.map((shape) =>
            shape.id === id ? { ...shape, points: newPoints } : shape
          );
        } else if (draggedShape.type === 'blur') {
          updatedShapes = shapes.map((shape) =>
            shape.id === id
              ? { ...shape, x: (shape.x ?? 0) + blurDx, y: (shape.y ?? 0) + blurDy }
              : shape
          );
        } else {
          updatedShapes = shapes.map((shape) =>
            shape.id === id
              ? { ...shape, x: e.target.x(), y: e.target.y() }
              : shape
          );
        }
      }

      onShapesChange(updatedShapes);
      maybeExpandBounds(updatedShapes);

      // Resume history tracking
      commitSnapshot();
    },
    [shapes, shapeById, onShapesChange, takeSnapshot, commitSnapshot, maybeExpandBounds]
  );

  // Commit a drag delta produced outside Konva's native draggable pipeline.
  const commitManualDragDelta = useCallback((id: string, dx: number, dy: number) => {
    if (Math.abs(dx) <= DRAG_EPSILON && Math.abs(dy) <= DRAG_EPSILON) {
      return;
    }

    const draggedShape = shapeById.get(id);
    if (!draggedShape) return;

    const selectedNow = selectedIdsRef.current;
    const selectedNowSet = new Set(selectedNow);
    const isGroupDrag = selectedNow.length > 1 && selectedNowSet.has(id);

    takeSnapshot();

    let updatedShapes: CanvasShape[];
    if (isGroupDrag) {
      updatedShapes = shapes.map((shape) => {
        if (!selectedNowSet.has(shape.id)) return shape;

        if ((shape.type === 'pen' || shape.type === 'arrow' || shape.type === 'line') && shape.points && shape.points.length >= 2) {
          const newPoints = shape.points.map((val, i) => (i % 2 === 0 ? val + dx : val + dy));
          return { ...shape, points: newPoints };
        }

        return {
          ...shape,
          x: (shape.x ?? 0) + dx,
          y: (shape.y ?? 0) + dy,
        };
      });
    } else if ((draggedShape.type === 'pen' || draggedShape.type === 'arrow' || draggedShape.type === 'line') && draggedShape.points && draggedShape.points.length >= 2) {
      const newPoints = draggedShape.points.map((val, i) => (i % 2 === 0 ? val + dx : val + dy));
      updatedShapes = shapes.map((shape) =>
        shape.id === id ? { ...shape, points: newPoints } : shape
      );
    } else {
      updatedShapes = shapes.map((shape) =>
        shape.id === id
          ? { ...shape, x: (shape.x ?? 0) + dx, y: (shape.y ?? 0) + dy }
          : shape
      );
    }

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
      if (e.evt?.button === 1) return;

      const selectedNow = selectedIdsRef.current;
      const selectedNowSet = new Set(selectedNow);
      if (e.evt?.shiftKey) {
        // Toggle selection with shift
        if (selectedNowSet.has(shapeId)) {
          setSelectedIds(selectedNow.filter(id => id !== shapeId));
        } else {
          setSelectedIds([...selectedNow, shapeId]);
        }
      } else {
        // Keep group selection if clicking already-selected shape
        if (!selectedNowSet.has(shapeId)) {
          setSelectedIds([shapeId]);
        }
      }
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
