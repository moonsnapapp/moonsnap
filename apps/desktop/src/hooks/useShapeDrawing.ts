import { useState, useCallback, useRef } from 'react';
import Konva from 'konva';
import type { Tool, CanvasShape, BlurType } from '../types';
import {
  createEditorClickTextShape,
  createEditorDragTextShape,
  EDITOR_TEXT,
  getEditorTextDragBoxHeight,
} from '../utils/editorText';
import type { EditorHistoryActions } from './useEditorHistory';

const MIN_SHAPE_SIZE = 5;
const TEXT_DRAG_EPSILON = 0.01;

// Tools that stay in draw mode after completing a shape
const TOOLS_RETAIN_MODE: Set<Tool> = new Set(['pen', 'steps']);

interface UseShapeDrawingProps {
  selectedTool: Tool;
  onToolChange: (tool: Tool) => void;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  blurType: BlurType;
  blurAmount: number;
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
  setSelectedIds: (ids: string[]) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  getCanvasPosition: (screenPos: { x: number; y: number }) => { x: number; y: number };
  onTextShapeCreated?: (shapeId: string) => void;
  /** Context-aware history actions for undo/redo support */
  history: EditorHistoryActions;
}

interface UseShapeDrawingReturn {
  isDrawing: boolean;
  handleDrawingMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => boolean; // returns true if handled
  handleDrawingMouseMove: (pos: { x: number; y: number }) => void;
  handleDrawingMouseUp: () => void;
  /** Force-finalize any in-progress drawing and return the current shapes.
   *  Call before saving to ensure no shapes are lost. */
  finalizeAndGetShapes: () => CanvasShape[];
}

/**
 * Hook for shape drawing - handles drag-to-draw and click-to-place tools
 * Uses refs for live drawing to avoid re-renders on every mouse move
 */
export const useShapeDrawing = ({
  selectedTool,
  onToolChange,
  strokeColor,
  fillColor,
  strokeWidth,
  fontSize,
  blurType,
  blurAmount,
  shapes,
  onShapesChange,
  setSelectedIds,
  stageRef,
  getCanvasPosition,
  onTextShapeCreated,
  history,
}: UseShapeDrawingProps): UseShapeDrawingReturn => {
  const { takeSnapshot, commitSnapshot, recordAction } = history;
  const [isDrawing, setIsDrawingState] = useState(false);
  // Mirror isDrawing as a ref so mouseMove sees updates immediately
  // (setState only takes effect after React re-renders, causing dropped frames)
  const isDrawingRef = useRef(false);
  const setIsDrawing = useCallback((v: boolean) => {
    isDrawingRef.current = v;
    setIsDrawingState(v);
  }, []);

  // Use refs for internal draw state (not used for rendering, avoids re-renders)
  const drawStartRef = useRef({ x: 0, y: 0 });
  const shapeSpawnedRef = useRef(false);
  // Tracks a pending mouseDown that hasn't entered drawing mode yet.
  // Drawing mode is deferred to mouseMove (when drag threshold is exceeded).
  // If mouseUp fires while still pending, it's a click.
  const pendingDrawRef = useRef<{ x: number; y: number } | null>(null);

  // Refs for live drawing without re-renders
  const liveShapeRef = useRef<CanvasShape | null>(null);
  const shapesBeforeDrawRef = useRef<CanvasShape[]>([]);
  const liveTextNodesRef = useRef<{
    shapeId: string;
    rect: Konva.Rect | null;
    textNode: Konva.Text | null;
  } | null>(null);
  const textDragMovedRef = useRef(false);

  // Create a new shape based on tool type
  const createShapeAtPosition = useCallback(
    (startPos: { x: number; y: number }, endPos: { x: number; y: number }): CanvasShape | null => {
      const id = `shape_${Date.now()}`;

      switch (selectedTool) {
        case 'arrow':
          return {
            id,
            type: 'arrow',
            points: [startPos.x, startPos.y, endPos.x, endPos.y],
            stroke: strokeColor,
            strokeWidth,
            fill: strokeColor,
          };
        case 'line':
          return {
            id,
            type: 'line',
            points: [startPos.x, startPos.y, endPos.x, endPos.y],
            stroke: strokeColor,
            strokeWidth,
          };
        case 'rect':
          return {
            id,
            type: 'rect',
            x: startPos.x,
            y: startPos.y,
            width: endPos.x - startPos.x,
            height: endPos.y - startPos.y,
            stroke: strokeColor,
            strokeWidth,
            fill: fillColor,
          };
        case 'circle': {
          const radiusX = Math.abs(endPos.x - startPos.x) / 2;
          const radiusY = Math.abs(endPos.y - startPos.y) / 2;
          const centerX = Math.min(startPos.x, endPos.x) + radiusX;
          const centerY = Math.min(startPos.y, endPos.y) + radiusY;
          return {
            id,
            type: 'circle',
            x: centerX,
            y: centerY,
            radiusX,
            radiusY,
            stroke: strokeColor,
            strokeWidth,
            fill: fillColor,
          };
        }
        case 'highlight': {
          // Convert strokeColor to rgba with 40% opacity
          const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
          };
          return {
            id,
            type: 'highlight',
            x: startPos.x,
            y: startPos.y,
            width: endPos.x - startPos.x,
            height: endPos.y - startPos.y,
            fill: hexToRgba(strokeColor, 0.4),
          };
        }
        case 'blur':
          return {
            id,
            type: 'blur',
            x: startPos.x,
            y: startPos.y,
            width: endPos.x - startPos.x,
            height: endPos.y - startPos.y,
            blurType: blurType,
            blurAmount: blurAmount,
            pixelSize: blurAmount,
          };
        case 'pen':
          return {
            id,
            type: 'pen',
            points: [startPos.x, startPos.y, endPos.x, endPos.y],
            stroke: strokeColor,
            strokeWidth,
          };
        case 'text':
          return createEditorDragTextShape({
            id,
            startPos,
            endPos,
            fontSize,
            color: strokeColor,
          });
        default:
          return null;
      }
    },
    [selectedTool, strokeColor, fillColor, strokeWidth, fontSize, blurType, blurAmount]
  );

  // Handle mouse down for drawing
  const handleDrawingMouseDown = useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>): boolean => {
      const stage = stageRef.current;
      if (!stage) return false;

      const screenPos = stage.getPointerPosition();
      if (!screenPos) return false;

      const pos = getCanvasPosition(screenPos);

      // Move and select tools don't draw
      if (selectedTool === 'move' || selectedTool === 'select') return false;

      // Click-to-place tools
      if (selectedTool === 'steps') {
        // Find the next available step number (fill gaps first, then continue series)
        const existingNumbers = shapes
          .filter((s) => s.type === 'step' && s.number !== undefined)
          .map((s) => s.number as number)
          .sort((a, b) => a - b);

        let nextNumber = 1;
        for (const num of existingNumbers) {
          if (num === nextNumber) {
            nextNumber++;
          } else if (num > nextNumber) {
            break; // Found a gap
          }
        }

        const id = `shape_${Date.now()}`;
        const newShape: CanvasShape = {
          id,
          type: 'step',
          x: pos.x,
          y: pos.y,
          number: nextNumber,
          fill: strokeColor,
          radius: 15,
        };
        recordAction(() => onShapesChange([...shapes, newShape]));
        setSelectedIds([id]);
        // Don't switch to select - steps tool retains mode
        return true;
      }

      // Crop tool is handled elsewhere
      if (selectedTool === 'crop') return false;

      // Text tool: pre-spawn shape on mouse down so first drag frame doesn't
      // pay shape mount cost. This removes the start-of-drag hitch.
      if (selectedTool === 'text') {
        takeSnapshot();
        drawStartRef.current = pos;
        shapesBeforeDrawRef.current = shapes;
        pendingDrawRef.current = null;
        liveTextNodesRef.current = null;
        shapeSpawnedRef.current = false;
        textDragMovedRef.current = false;
        setIsDrawing(true);

        const id = `shape_${Date.now()}`;
        const newShape = createEditorDragTextShape({
          id,
          startPos: pos,
          endPos: pos,
          fontSize,
          color: strokeColor,
        });

        liveShapeRef.current = newShape;
        onShapesChange([...shapesBeforeDrawRef.current, newShape]);
        shapeSpawnedRef.current = true;
        return true;
      }

      // For drag-to-draw tools, record position but defer drawing mode to mouseMove.
      // This avoids re-renders from isDrawing state changes on simple clicks.
      drawStartRef.current = pos;
      shapesBeforeDrawRef.current = shapes;
      pendingDrawRef.current = pos;
      liveShapeRef.current = null;
      liveTextNodesRef.current = null;
      shapeSpawnedRef.current = false;
      textDragMovedRef.current = false;
      return true;
    },
    [
      selectedTool,
      strokeColor,
      fontSize,
      shapes,
      onShapesChange,
      stageRef,
      getCanvasPosition,
      setSelectedIds,
      recordAction,
      takeSnapshot,
      setIsDrawing,
    ]
  );

  // Handle mouse move during drawing - uses Konva directly to avoid React re-renders
  const handleDrawingMouseMove = useCallback(
    (pos: { x: number; y: number }) => {
      const drawStart = drawStartRef.current;

      // If pending (mouseDown happened, but haven't entered drawing mode yet),
      // check if drag threshold is exceeded to enter drawing mode.
      if (pendingDrawRef.current && !isDrawingRef.current) {
        const distance = Math.sqrt(
          Math.pow(pos.x - drawStart.x, 2) + Math.pow(pos.y - drawStart.y, 2)
        );
        if (distance < MIN_SHAPE_SIZE) return;

        // Threshold exceeded — now enter drawing mode
        takeSnapshot();
        pendingDrawRef.current = null;
        shapeSpawnedRef.current = false;
        setIsDrawing(true);

        // Spawn the initial shape immediately
        const newShape = createShapeAtPosition(drawStart, pos);
        if (newShape) {
          liveShapeRef.current = newShape;
          if (newShape.type === 'text') {
            liveTextNodesRef.current = null;
          }
          onShapesChange([...shapesBeforeDrawRef.current, newShape]);
          if (newShape.type !== 'text') {
            setSelectedIds([newShape.id]);
          }
          shapeSpawnedRef.current = true;
        }
        return;
      }

      if (!isDrawingRef.current) return;

      const stage = stageRef.current;
      if (!stage) return;

      // If shape not spawned yet (shouldn't normally happen since we spawn above, but safety check)
      if (!shapeSpawnedRef.current) {
        const distance = Math.sqrt(
          Math.pow(pos.x - drawStart.x, 2) + Math.pow(pos.y - drawStart.y, 2)
        );
        if (distance < MIN_SHAPE_SIZE) return;

        const newShape = createShapeAtPosition(drawStart, pos);
        if (newShape) {
          liveShapeRef.current = newShape;
          if (newShape.type === 'text') {
            liveTextNodesRef.current = null;
          }
          onShapesChange([...shapesBeforeDrawRef.current, newShape]);
          if (newShape.type !== 'text') {
            setSelectedIds([newShape.id]);
          }
          shapeSpawnedRef.current = true;
        }
        return;
      }

      // Update existing shape via Konva directly (no React re-render)
      const liveShape = liveShapeRef.current;
      if (!liveShape) return;

      // Blur uses React state updates instead of Konva direct manipulation
      // Handle it separately before the node lookup
      if (liveShape.type === 'blur') {
        const width = pos.x - drawStart.x;
        const height = pos.y - drawStart.y;
        const updatedShape = { ...liveShape, width, height };
        liveShapeRef.current = updatedShape;
        // Update React state to trigger re-render with live blur
        onShapesChange([...shapesBeforeDrawRef.current, updatedShape]);
        return;
      }

      const node = stage.findOne(`#${liveShape.id}`);
      if (!node) {
        // Shape can briefly be missing right after text pre-spawn before React commits.
        // Keep state in sync with the latest pointer so first rendered frame is up-to-date.
        if (liveShape.type === 'text') {
          const width = Math.max(EDITOR_TEXT.MIN_BOX_WIDTH, Math.abs(pos.x - drawStart.x));
          const height = Math.max(getEditorTextDragBoxHeight(fontSize), Math.abs(pos.y - drawStart.y));
          const x = Math.min(drawStart.x, pos.x);
          const y = Math.min(drawStart.y, pos.y);
          const updatedShape = { ...liveShape, x, y, width, height };
          liveShapeRef.current = updatedShape;
          onShapesChange([...shapesBeforeDrawRef.current, updatedShape]);
          if (
            !textDragMovedRef.current &&
            (Math.abs(pos.x - drawStart.x) > TEXT_DRAG_EPSILON ||
              Math.abs(pos.y - drawStart.y) > TEXT_DRAG_EPSILON)
          ) {
            textDragMovedRef.current = true;
          }
        }
        return;
      }

      // For Group-wrapped shapes (arrow, line), drill into the first child
      const drawNode = node.getClassName() === 'Group'
        ? (node as Konva.Group).getChildren()[0]
        : node;

      switch (liveShape.type) {
        case 'arrow': {
          const arrow = drawNode as Konva.Arrow;
          const newPoints = [drawStart.x, drawStart.y, pos.x, pos.y];
          arrow.points(newPoints);
          liveShapeRef.current = { ...liveShape, points: newPoints };
          break;
        }
        case 'line': {
          const line = drawNode as Konva.Line;
          const newPoints = [drawStart.x, drawStart.y, pos.x, pos.y];
          line.points(newPoints);
          liveShapeRef.current = { ...liveShape, points: newPoints };
          break;
        }
        case 'rect':
        case 'highlight': {
          const rect = node as Konva.Rect;
          const width = pos.x - drawStart.x;
          const height = pos.y - drawStart.y;
          rect.width(width);
          rect.height(height);
          liveShapeRef.current = { ...liveShape, width, height };
          break;
        }
        case 'circle': {
          const ellipse = node as Konva.Ellipse;
          const radiusX = Math.abs(pos.x - drawStart.x) / 2;
          const radiusY = Math.abs(pos.y - drawStart.y) / 2;
          const centerX = Math.min(drawStart.x, pos.x) + radiusX;
          const centerY = Math.min(drawStart.y, pos.y) + radiusY;
          ellipse.x(centerX);
          ellipse.y(centerY);
          ellipse.radiusX(radiusX);
          ellipse.radiusY(radiusY);
          liveShapeRef.current = { ...liveShape, x: centerX, y: centerY, radiusX, radiusY };
          break;
        }
        case 'pen': {
          const line = node as Konva.Line;
          const existingPoints = liveShape.points || [];
          const newPoints = [...existingPoints, pos.x, pos.y];
          line.points(newPoints);
          liveShapeRef.current = { ...liveShape, points: newPoints };
          break;
        }
        case 'text': {
          // Cache child-node lookups to avoid repeated findOne calls while dragging.
          const group = node as Konva.Group;
          let cache = liveTextNodesRef.current;
          if (!cache || cache.shapeId !== liveShape.id) {
            cache = {
              shapeId: liveShape.id,
              rect: group.findOne('.text-box-border') as Konva.Rect | null,
              textNode: group.findOne('.text-content') as Konva.Text | null,
            };
            liveTextNodesRef.current = cache;
          }
          const width = Math.max(EDITOR_TEXT.MIN_BOX_WIDTH, Math.abs(pos.x - drawStart.x));
          const height = Math.max(getEditorTextDragBoxHeight(fontSize), Math.abs(pos.y - drawStart.y));
          const x = Math.min(drawStart.x, pos.x);
          const y = Math.min(drawStart.y, pos.y);
          if (
            !textDragMovedRef.current &&
            (Math.abs(pos.x - drawStart.x) > TEXT_DRAG_EPSILON ||
              Math.abs(pos.y - drawStart.y) > TEXT_DRAG_EPSILON)
          ) {
            textDragMovedRef.current = true;
          }
          group.x(x);
          group.y(y);
          if (cache.rect) {
            cache.rect.width(width);
            cache.rect.height(height);
          }
          if (cache.textNode) {
            cache.textNode.width(width);
            cache.textNode.height(height);
          }
          liveShapeRef.current = { ...liveShape, x, y, width, height };
          break;
        }
      }

      // Trigger Konva layer redraw (much faster than React re-render)
      node.getLayer()?.batchDraw();
    },
    [fontSize, createShapeAtPosition, setSelectedIds, stageRef, onShapesChange, takeSnapshot, setIsDrawing]
  );

  // Handle mouse up - finalize drawing and sync React state
  const handleDrawingMouseUp = useCallback(() => {
    // Click (mouseUp before drag threshold was reached — never entered drawing mode)
    if (pendingDrawRef.current) {
      const clickPos = pendingDrawRef.current;
      pendingDrawRef.current = null;

      if (selectedTool === 'text') {
        // Click-to-place: spawn a default-size text box at the click position
        const id = `shape_${Date.now()}`;
        const newShape = createEditorClickTextShape({
          id,
          position: clickPos,
          fontSize,
          color: strokeColor,
        });
        recordAction(() => onShapesChange([...shapesBeforeDrawRef.current, newShape]));
        setSelectedIds([id]);
        onToolChange('select');
        if (onTextShapeCreated) {
          onTextShapeCreated(id);
        }
      }
      // For non-text tools, a click does nothing (same as before)
      return;
    }

    if (!isDrawingRef.current) return;

    if (shapeSpawnedRef.current && liveShapeRef.current) {
      // Commit final shape to React state
      let finalShape = liveShapeRef.current;
      if (finalShape.type === 'text' && !textDragMovedRef.current) {
        // Preserve click-to-place behavior: click without drag becomes default text box size.
        finalShape = createEditorClickTextShape({
          id: finalShape.id,
          position: drawStartRef.current,
          fontSize,
          color: strokeColor,
        });
      }
      onShapesChange([...shapesBeforeDrawRef.current, finalShape]);
      commitSnapshot();
      // Switch to select mode unless tool retains mode
      if (!TOOLS_RETAIN_MODE.has(selectedTool)) {
        onToolChange('select');
      }
      // If text shape was created, trigger editor to open immediately
      if (finalShape.type === 'text' && onTextShapeCreated) {
        setSelectedIds([finalShape.id]);
        onTextShapeCreated(finalShape.id);
      }
    }

    // Clean up refs
    liveShapeRef.current = null;
    shapesBeforeDrawRef.current = [];
    liveTextNodesRef.current = null;
    textDragMovedRef.current = false;
    setIsDrawing(false);
    shapeSpawnedRef.current = false;
  }, [selectedTool, onToolChange, onShapesChange, onTextShapeCreated, fontSize, strokeColor, setSelectedIds, recordAction, commitSnapshot, setIsDrawing]);

  // Force-finalize any in-progress drawing and return the current shapes
  // This ensures no shapes are lost when exiting edit mode
  const finalizeAndGetShapes = useCallback((): CanvasShape[] => {
    // If there's a shape being drawn, include it in the result
    if (isDrawingRef.current && shapeSpawnedRef.current && liveShapeRef.current) {
      const finalShape = liveShapeRef.current;
      const finalShapes = [...shapesBeforeDrawRef.current, finalShape];

      // Also sync to React state
      onShapesChange(finalShapes);
      commitSnapshot();

      // Clean up
      liveShapeRef.current = null;
      shapesBeforeDrawRef.current = [];
      liveTextNodesRef.current = null;
      textDragMovedRef.current = false;
      setIsDrawing(false);
      shapeSpawnedRef.current = false;

      return finalShapes;
    }

    // No in-progress drawing, return current shapes
    return shapes;
  }, [shapes, onShapesChange, commitSnapshot, setIsDrawing]);

  return {
    isDrawing,
    handleDrawingMouseDown,
    handleDrawingMouseMove,
    handleDrawingMouseUp,
    finalizeAndGetShapes,
  };
};
