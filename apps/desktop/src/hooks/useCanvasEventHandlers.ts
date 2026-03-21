import { useRef, useCallback, useEffect } from 'react';
import Konva from 'konva';
import type { CanvasShape } from '../types';

const TEXT_MANUAL_DRAG_EPSILON = 0.01;

export interface ManualTextDragState {
  shapeId: string;
  node: Konva.Node;
  startPointer: { x: number; y: number };
  startPosition: { x: number; y: number };
  activated: boolean;
  drewFirstFrame: boolean;
}

interface UseCanvasEventHandlersProps {
  stageRef: React.RefObject<Konva.Stage | null>;
  transformerRef: React.RefObject<Konva.Transformer | null>;
  layerRef: React.RefObject<Konva.Layer | null>;
  selectedTool: string;
  setSelectedIds: (ids: string[]) => void;
  selectedIds: string[];
  selectedSet: Set<string>;
  shapeById: Map<string, CanvasShape>;
  navigation: {
    getCanvasPosition: (screenPos: { x: number; y: number }) => { x: number; y: number };
  };
  drawing: {
    isDrawing: boolean;
    handleDrawingMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => boolean;
    handleDrawingMouseMove: (pos: { x: number; y: number }) => void;
    handleDrawingMouseUp: () => void;
  };
  marquee: {
    isMarqueeSelecting: boolean;
    startMarquee: (pos: { x: number; y: number }) => void;
    updateMarquee: (pos: { x: number; y: number }) => void;
    finishMarquee: () => void;
  };
  textEditing: {
    editingTextId: string | null;
  };
  transform: {
    handleShapeDragStart: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
    handleShapeDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
    commitManualDragDelta: (shapeId: string, dx: number, dy: number) => void;
  };
  isShapeDraggingRef: React.MutableRefObject<boolean>;
}

interface UseCanvasEventHandlersReturn {
  handleMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  handleMouseMove: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  handleMouseUp: () => void;
  handleShapeSelect: (id: string) => void;
  handleTextMouseDown: (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  handleShapeDragStart: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  handleShapeDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
}

export function useCanvasEventHandlers({
  stageRef,
  transformerRef,
  layerRef,
  selectedTool,
  setSelectedIds,
  selectedIds,
  selectedSet,
  shapeById,
  navigation,
  drawing,
  marquee,
  textEditing,
  transform,
  isShapeDraggingRef,
}: UseCanvasEventHandlersProps): UseCanvasEventHandlersReturn {
  const preTextDragHideRef = useRef(false);
  const manualTextDragRef = useRef<ManualTextDragState | null>(null);

  const updateManualTextDrag = useCallback((pointer: { x: number; y: number }): boolean => {
    const manualTextDrag = manualTextDragRef.current;
    if (!manualTextDrag) return false;

    const dx = pointer.x - manualTextDrag.startPointer.x;
    const dy = pointer.y - manualTextDrag.startPointer.y;
    if (Math.abs(dx) <= TEXT_MANUAL_DRAG_EPSILON && Math.abs(dy) <= TEXT_MANUAL_DRAG_EPSILON) {
      return true;
    }

    if (!manualTextDrag.activated) {
      manualTextDrag.activated = true;
      isShapeDraggingRef.current = true;

      // Defer transformer hide to actual movement to keep mousedown path minimal.
      const tr = transformerRef.current;
      if (tr?.visible()) {
        tr.visible(false);
        preTextDragHideRef.current = true;
      }
    }

    manualTextDrag.node.position({
      x: manualTextDrag.startPosition.x + dx,
      y: manualTextDrag.startPosition.y + dy,
    });

    const dragLayer = manualTextDrag.node.getLayer();
    if (dragLayer) {
      manualTextDrag.drewFirstFrame = true;
      dragLayer.batchDraw();
    }

    return true;
  }, [transformerRef]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Ignore if middle mouse button
      if (e.evt.button === 1) return;

      // Handle drawing tools
      if (drawing.handleDrawingMouseDown(e)) {
        return;
      }

      // Handle crop tool
      if (selectedTool === 'crop') return;

      // Handle select tool - start marquee or click on stage
      if (selectedTool === 'select') {
        // Only the stage itself counts as empty space (background is now a selectable shape)
        const clickedOnStage = e.target === e.target.getStage();

        if (clickedOnStage) {
          setSelectedIds([]);

          // While editing text, empty-click should only close editor/deselect.
          // Skip marquee setup to avoid unnecessary shape intersection work.
          if (textEditing.editingTextId) {
            return;
          }

          const stage = stageRef.current;
          if (stage) {
            const screenPos = stage.getPointerPosition();
            if (screenPos) {
              const pos = navigation.getCanvasPosition(screenPos);
              marquee.startMarquee(pos);
            }
          }
        }
      }
    },
    [drawing, selectedTool, setSelectedIds, marquee, stageRef, navigation, textEditing.editingTextId]
  );

  const handleMouseMove = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const screenPos = stage.getPointerPosition();
      if (!screenPos) return;

      const pos = navigation.getCanvasPosition(screenPos);

      if (updateManualTextDrag(pos)) {
        return;
      }

      // Drawing move (also handles pending → drawing transition on drag threshold)
      if (drawing.isDrawing || (selectedTool !== 'select' && selectedTool !== 'crop' && selectedTool !== 'background')) {
        drawing.handleDrawingMouseMove(pos);
        return;
      }

      // Marquee move
      if (marquee.isMarqueeSelecting) {
        marquee.updateMarquee(pos);
      }
    },
    [drawing, marquee, navigation, stageRef, selectedTool, updateManualTextDrag]
  );

  const handleShapeSelect = useCallback((id: string) => {
    setSelectedIds([id]);
  }, [setSelectedIds]);

  const reattachTransformerToSelection = useCallback(() => {
    const tr = transformerRef.current;
    const layer = layerRef.current;
    if (!tr || !layer || drawing.isDrawing || textEditing.editingTextId || selectedTool !== 'select') return;

    const selectedNow = selectedIds;
    const isMultiSelect = selectedNow.length > 1;
    const nodes = selectedNow
      .filter((shapeId) => {
        if (isMultiSelect) return true;
        const shape = shapeById.get(shapeId);
        return shape && shape.type !== 'arrow' && shape.type !== 'line';
      })
      .map((shapeId) => layer.findOne(`#${shapeId}`))
      .filter((node): node is Konva.Node => node !== null && node !== undefined);

    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [drawing.isDrawing, selectedIds, selectedTool, shapeById, textEditing.editingTextId, transformerRef, layerRef]);

  const handleTextMouseDown = useCallback((shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt?.button !== 0 || selectedTool !== 'select') return;
    if (textEditing.editingTextId === shapeId) return;
    if (selectedIds.length > 1) return;
    // Preserve double-click editing path.
    if (e.evt.detail >= 2) return;

    // Keep stage handlers out of this path and run manual drag for selected text.
    e.cancelBubble = true;

    // Ensure first-gesture drag works even when the shape was not selected yet.
    if (!selectedSet.has(shapeId) || selectedIds.length !== 1) {
      setSelectedIds([shapeId]);
    }

    const dragNode = e.currentTarget as Konva.Node | null;
    const stage = stageRef.current;
    const screenPos = stage?.getPointerPosition();
    if (!dragNode || !screenPos) return;

    manualTextDragRef.current = {
      shapeId,
      node: dragNode,
      startPointer: navigation.getCanvasPosition(screenPos),
      startPosition: { x: dragNode.x(), y: dragNode.y() },
      activated: false,
      drewFirstFrame: false,
    };
  }, [navigation, selectedIds.length, selectedSet, selectedTool, setSelectedIds, stageRef, textEditing.editingTextId]);

  const handleMouseUp = useCallback(() => {
    const manualTextDrag = manualTextDragRef.current;
    if (manualTextDrag) {
      manualTextDragRef.current = null;
      const wasDragging = manualTextDrag.activated;
      isShapeDraggingRef.current = false;
      preTextDragHideRef.current = false;

      const dx = manualTextDrag.node.x() - manualTextDrag.startPosition.x;
      const dy = manualTextDrag.node.y() - manualTextDrag.startPosition.y;
      if (wasDragging && (Math.abs(dx) > TEXT_MANUAL_DRAG_EPSILON || Math.abs(dy) > TEXT_MANUAL_DRAG_EPSILON)) {
        transform.commitManualDragDelta(manualTextDrag.shapeId, dx, dy);
      }

      if (wasDragging) {
        requestAnimationFrame(() => {
          const tr = transformerRef.current;
          if (tr) {
            tr.visible(true);
          }
          reattachTransformerToSelection();
        });
      }
      return;
    }

    // Finish drawing or click-to-place (always call - it no-ops when idle)
    drawing.handleDrawingMouseUp();
    // Finish marquee
    if (marquee.isMarqueeSelecting) {
      marquee.finishMarquee();
    }
    // Restore transformer if we hid it for a forced text drag that never started.
    if (preTextDragHideRef.current && !isShapeDraggingRef.current) {
      preTextDragHideRef.current = false;
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(true);
      }
    }
  }, [transform.commitManualDragDelta, drawing, marquee, reattachTransformerToSelection, transformerRef]);

  useEffect(() => {
    const handleWindowMouseMove = (evt: MouseEvent) => {
      if (!manualTextDragRef.current) return;
      const stage = stageRef.current;
      if (!stage) return;

      const rect = stage.container().getBoundingClientRect();
      const pointer = navigation.getCanvasPosition({
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
      });

      updateManualTextDrag(pointer);
    };

    const handleWindowMouseUp = () => {
      if (!manualTextDragRef.current) return;
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove, true);
    window.addEventListener('mouseup', handleWindowMouseUp, true);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove, true);
      window.removeEventListener('mouseup', handleWindowMouseUp, true);
    };
  }, [handleMouseUp, navigation, stageRef, updateManualTextDrag]);

  const handleShapeDragStart = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    // Hide transformer during drag to reduce overlay work on text-heavy scenes.
    if (e.evt?.button !== 1) {
      isShapeDraggingRef.current = true;
      preTextDragHideRef.current = false;
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(false);
      }
    }
    transform.handleShapeDragStart(id, e);
  }, [transform.handleShapeDragStart, transformerRef]);

  const handleShapeDragEnd = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    transform.handleShapeDragEnd(id, e);
    isShapeDraggingRef.current = false;
    requestAnimationFrame(() => {
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(true);
      }
      reattachTransformerToSelection();
    });
  }, [transform.handleShapeDragEnd, reattachTransformerToSelection, transformerRef]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleShapeSelect,
    handleTextMouseDown,
    handleShapeDragStart,
    handleShapeDragEnd,
  };
}
