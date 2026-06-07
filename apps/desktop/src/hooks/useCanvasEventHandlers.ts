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

type CanvasPointer = { x: number; y: number };

function getCurrentCanvasPointer({
  stageRef,
  getCanvasPosition,
}: {
  stageRef: React.RefObject<Konva.Stage | null>;
  getCanvasPosition: (screenPos: CanvasPointer) => CanvasPointer;
}): CanvasPointer | null {
  const stage = stageRef.current;
  const screenPos = stage?.getPointerPosition();
  return screenPos ? getCanvasPosition(screenPos) : null;
}

function shouldIgnoreCanvasMouseDown(
  event: Konva.KonvaEventObject<MouseEvent>,
  editingTextId: string | null
) {
  return event.evt.button === 1 || Boolean(editingTextId);
}

function isStageBackgroundClick(event: Konva.KonvaEventObject<MouseEvent>) {
  return event.target === event.target.getStage();
}

function isDrawingMoveTool(selectedTool: string) {
  return selectedTool !== 'select' && selectedTool !== 'crop' && selectedTool !== 'background';
}

function shouldIgnoreTextMouseDown({
  event,
  shapeId,
  selectedTool,
  editingTextId,
  selectedCount,
}: {
  event: Konva.KonvaEventObject<MouseEvent>;
  shapeId: string;
  selectedTool: string;
  editingTextId: string | null;
  selectedCount: number;
}) {
  if (shouldIgnoreTextSelectionMouseDown({ event, selectedTool, editingTextId, shapeId })) {
    return true;
  }

  return !canStartTextManualDrag({ event, selectedCount });
}

function isPrimaryMouseDown(event: Konva.KonvaEventObject<MouseEvent>): boolean {
  return event.evt?.button === 0;
}

function shouldIgnoreTextSelectionMouseDown({
  event,
  selectedTool,
  editingTextId,
  shapeId,
}: {
  event: Konva.KonvaEventObject<MouseEvent>;
  selectedTool: string;
  editingTextId: string | null;
  shapeId: string;
}): boolean {
  return !isPrimaryMouseDown(event) || selectedTool !== 'select' || editingTextId === shapeId;
}

function canStartTextManualDrag({
  event,
  selectedCount,
}: {
  event: Konva.KonvaEventObject<MouseEvent>;
  selectedCount: number;
}): boolean {
  return selectedCount <= 1 && event.evt.detail < 2;
}

function createManualTextDragState({
  shapeId,
  dragNode,
  screenPos,
  getCanvasPosition,
}: {
  shapeId: string;
  dragNode: Konva.Node | null;
  screenPos: { x: number; y: number } | null | undefined;
  getCanvasPosition: (screenPos: { x: number; y: number }) => { x: number; y: number };
}): ManualTextDragState | null {
  if (!dragNode || !screenPos) {
    return null;
  }

  return {
    shapeId,
    node: dragNode,
    startPointer: getCanvasPosition(screenPos),
    startPosition: { x: dragNode.x(), y: dragNode.y() },
    activated: false,
    drewFirstFrame: false,
  };
}

function getManualTextDragDelta(manualTextDrag: ManualTextDragState) {
  return {
    dx: manualTextDrag.node.x() - manualTextDrag.startPosition.x,
    dy: manualTextDrag.node.y() - manualTextDrag.startPosition.y,
  };
}

function getManualTextPointerDelta(
  pointer: CanvasPointer,
  manualTextDrag: ManualTextDragState
) {
  return {
    dx: pointer.x - manualTextDrag.startPointer.x,
    dy: pointer.y - manualTextDrag.startPointer.y,
  };
}

function didManualTextDragMove(dx: number, dy: number): boolean {
  return Math.abs(dx) > TEXT_MANUAL_DRAG_EPSILON || Math.abs(dy) > TEXT_MANUAL_DRAG_EPSILON;
}

function isManualTextDragWithinEpsilon(dx: number, dy: number): boolean {
  return Math.abs(dx) <= TEXT_MANUAL_DRAG_EPSILON && Math.abs(dy) <= TEXT_MANUAL_DRAG_EPSILON;
}

function activateManualTextDrag({
  manualTextDrag,
  isShapeDraggingRef,
  transformerRef,
  preTextDragHideRef,
}: {
  manualTextDrag: ManualTextDragState;
  isShapeDraggingRef: React.MutableRefObject<boolean>;
  transformerRef: React.RefObject<Konva.Transformer | null>;
  preTextDragHideRef: React.MutableRefObject<boolean>;
}) {
  if (manualTextDrag.activated) return;

  manualTextDrag.activated = true;
  isShapeDraggingRef.current = true;

  const tr = transformerRef.current;
  if (tr?.visible()) {
    tr.visible(false);
    preTextDragHideRef.current = true;
  }
}

function updateManualTextDragNode(
  manualTextDrag: ManualTextDragState,
  { dx, dy }: { dx: number; dy: number }
) {
  manualTextDrag.node.position({
    x: manualTextDrag.startPosition.x + dx,
    y: manualTextDrag.startPosition.y + dy,
  });
}

function redrawManualTextDragLayer(manualTextDrag: ManualTextDragState) {
  const dragLayer = manualTextDrag.node.getLayer();
  if (!dragLayer) return;

  manualTextDrag.drewFirstFrame = true;
  dragLayer.batchDraw();
}

function restoreTransformerOnNextFrame({
  transformerRef,
  reattachTransformerToSelection,
}: {
  transformerRef: React.RefObject<Konva.Transformer | null>;
  reattachTransformerToSelection: () => void;
}) {
  requestAnimationFrame(() => {
    const tr = transformerRef.current;
    if (tr) {
      tr.visible(true);
    }
    reattachTransformerToSelection();
  });
}

function restoreTransformerIfHidden(
  transformerRef: React.RefObject<Konva.Transformer | null>
) {
  const tr = transformerRef.current;
  if (tr) {
    tr.visible(true);
  }
}

function startMarqueeFromCurrentPointer({
  stageRef,
  navigation,
  marquee,
}: {
  stageRef: React.RefObject<Konva.Stage | null>;
  navigation: UseCanvasEventHandlersProps['navigation'];
  marquee: UseCanvasEventHandlersProps['marquee'];
}) {
  const pos = getCurrentCanvasPointer({
    stageRef,
    getCanvasPosition: navigation.getCanvasPosition,
  });
  if (pos) {
    marquee.startMarquee(pos);
  }
}

function updateCanvasPointerMove({
  pos,
  selectedTool,
  drawing,
  marquee,
}: {
  pos: CanvasPointer;
  selectedTool: string;
  drawing: UseCanvasEventHandlersProps['drawing'];
  marquee: UseCanvasEventHandlersProps['marquee'];
}) {
  if (drawing.isDrawing || isDrawingMoveTool(selectedTool)) {
    drawing.handleDrawingMouseMove(pos);
    return;
  }

  if (marquee.isMarqueeSelecting) {
    marquee.updateMarquee(pos);
  }
}

function handleSelectToolMouseDown({
  event,
  setSelectedIds,
  stageRef,
  navigation,
  marquee,
}: {
  event: Konva.KonvaEventObject<MouseEvent>;
  setSelectedIds: (ids: string[]) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  navigation: UseCanvasEventHandlersProps['navigation'];
  marquee: UseCanvasEventHandlersProps['marquee'];
}): void {
  if (!isStageBackgroundClick(event)) {
    return;
  }

  setSelectedIds([]);
  startMarqueeFromCurrentPointer({ stageRef, navigation, marquee });
}

function handleCanvasToolMouseDown({
  event,
  selectedTool,
  setSelectedIds,
  stageRef,
  navigation,
  marquee,
}: {
  event: Konva.KonvaEventObject<MouseEvent>;
  selectedTool: string;
  setSelectedIds: (ids: string[]) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  navigation: UseCanvasEventHandlersProps['navigation'];
  marquee: UseCanvasEventHandlersProps['marquee'];
}) {
  if (selectedTool === 'crop') {
    return;
  }

  if (selectedTool === 'select') {
    handleSelectToolMouseDown({ event, setSelectedIds, stageRef, navigation, marquee });
  }
}

function shouldAttachTransformer({
  isDrawing,
  editingTextId,
  selectedTool,
}: {
  isDrawing: boolean;
  editingTextId: string | null;
  selectedTool: string;
}): boolean {
  return !isDrawing && !editingTextId && selectedTool === 'select';
}

function canAttachShapeTransformer(
  shapeId: string,
  isMultiSelect: boolean,
  shapeById: Map<string, CanvasShape>
): boolean {
  if (isMultiSelect) return true;

  const shape = shapeById.get(shapeId);
  return Boolean(shape && shape.type !== 'arrow' && shape.type !== 'line');
}

function getSelectedTransformerNodes({
  selectedIds,
  layer,
  shapeById,
}: {
  selectedIds: string[];
  layer: Konva.Layer;
  shapeById: Map<string, CanvasShape>;
}): Konva.Node[] {
  const isMultiSelect = selectedIds.length > 1;
  return selectedIds
    .filter((shapeId) => canAttachShapeTransformer(shapeId, isMultiSelect, shapeById))
    .map((shapeId) => layer.findOne(`#${shapeId}`))
    .filter((node): node is Konva.Node => node !== null && node !== undefined);
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
  const {
    commitManualDragDelta,
    handleShapeDragStart: transformHandleShapeDragStart,
    handleShapeDragEnd: transformHandleShapeDragEnd,
  } = transform;

  const updateManualTextDrag = useCallback((pointer: { x: number; y: number }): boolean => {
    const manualTextDrag = manualTextDragRef.current;
    if (!manualTextDrag) return false;

    const delta = getManualTextPointerDelta(pointer, manualTextDrag);
    if (isManualTextDragWithinEpsilon(delta.dx, delta.dy)) {
      return true;
    }

    activateManualTextDrag({
      manualTextDrag,
      isShapeDraggingRef,
      transformerRef,
      preTextDragHideRef,
    });
    updateManualTextDragNode(manualTextDrag, delta);
    redrawManualTextDragLayer(manualTextDrag);

    return true;
  }, [isShapeDraggingRef, transformerRef]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (shouldIgnoreCanvasMouseDown(e, textEditing.editingTextId)) return;

      // Handle drawing tools
      if (drawing.handleDrawingMouseDown(e)) {
        return;
      }

      handleCanvasToolMouseDown({
        event: e,
        selectedTool,
        setSelectedIds,
        stageRef,
        navigation,
        marquee,
      });
    },
    [drawing, selectedTool, setSelectedIds, marquee, stageRef, navigation, textEditing.editingTextId]
  );

  const handleMouseMove = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      const pos = getCurrentCanvasPointer({
        stageRef,
        getCanvasPosition: navigation.getCanvasPosition,
      });
      if (!pos) return;

      if (updateManualTextDrag(pos)) {
        return;
      }

      // Drawing move (also handles pending → drawing transition on drag threshold)
      updateCanvasPointerMove({ pos, selectedTool, drawing, marquee });
    },
    [drawing, marquee, navigation, stageRef, selectedTool, updateManualTextDrag]
  );

  const handleShapeSelect = useCallback((id: string) => {
    setSelectedIds([id]);
  }, [setSelectedIds]);

  const reattachTransformerToSelection = useCallback(() => {
    const tr = transformerRef.current;
    const layer = layerRef.current;
    if (!tr || !layer || !shouldAttachTransformer({
      isDrawing: drawing.isDrawing,
      editingTextId: textEditing.editingTextId,
      selectedTool,
    })) return;

    const nodes = getSelectedTransformerNodes({ selectedIds, layer, shapeById });

    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [drawing.isDrawing, selectedIds, selectedTool, shapeById, textEditing.editingTextId, transformerRef, layerRef]);

  const handleTextMouseDown = useCallback((shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (shouldIgnoreTextMouseDown({
      event: e,
      shapeId,
      selectedTool,
      editingTextId: textEditing.editingTextId,
      selectedCount: selectedIds.length,
    })) {
      return;
    }

    // Keep stage handlers out of this path and run manual drag for selected text.
    e.cancelBubble = true;

    // Ensure first-gesture drag works even when the shape was not selected yet.
    if (!selectedSet.has(shapeId) || selectedIds.length !== 1) {
      setSelectedIds([shapeId]);
    }

    const dragNode = e.currentTarget as Konva.Node | null;
    const stage = stageRef.current;
    manualTextDragRef.current = createManualTextDragState({
      shapeId,
      dragNode,
      screenPos: stage?.getPointerPosition(),
      getCanvasPosition: navigation.getCanvasPosition,
    });
  }, [navigation, selectedIds.length, selectedSet, selectedTool, setSelectedIds, stageRef, textEditing.editingTextId]);

  const finishManualTextDrag = useCallback((manualTextDrag: ManualTextDragState) => {
    manualTextDragRef.current = null;
    const wasDragging = manualTextDrag.activated;
    isShapeDraggingRef.current = false;
    preTextDragHideRef.current = false;

    const { dx, dy } = getManualTextDragDelta(manualTextDrag);
    if (wasDragging && didManualTextDragMove(dx, dy)) {
      commitManualDragDelta(manualTextDrag.shapeId, dx, dy);
    }

    if (wasDragging) {
      restoreTransformerOnNextFrame({ transformerRef, reattachTransformerToSelection });
    }
  }, [commitManualDragDelta, isShapeDraggingRef, reattachTransformerToSelection, transformerRef]);

  const finishCanvasMouseUp = useCallback(() => {
    drawing.handleDrawingMouseUp();
    if (marquee.isMarqueeSelecting) {
      marquee.finishMarquee();
    }

    if (preTextDragHideRef.current && !isShapeDraggingRef.current) {
      preTextDragHideRef.current = false;
      restoreTransformerIfHidden(transformerRef);
    }
  }, [drawing, marquee, transformerRef, isShapeDraggingRef]);

  const handleMouseUp = useCallback(() => {
    const manualTextDrag = manualTextDragRef.current;
    if (manualTextDrag) {
      finishManualTextDrag(manualTextDrag);
      return;
    }

    finishCanvasMouseUp();
  }, [finishCanvasMouseUp, finishManualTextDrag]);

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
    transformHandleShapeDragStart(id, e);
  }, [transformHandleShapeDragStart, transformerRef, isShapeDraggingRef]);

  const handleShapeDragEnd = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    transformHandleShapeDragEnd(id, e);
    isShapeDraggingRef.current = false;
    requestAnimationFrame(() => {
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(true);
      }
      reattachTransformerToSelection();
    });
  }, [transformHandleShapeDragEnd, reattachTransformerToSelection, transformerRef, isShapeDraggingRef]);

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
