import { useState, useCallback, useRef, useEffect } from 'react';
import type Konva from 'konva';
import type { CanvasShape } from '../types';
import {
  EDITOR_TEXT,
  getEditorTextDecoration,
  getEditorTextDefaultBoxHeight,
  getEditorTextFontFamily,
  getEditorTextFontStyle,
  normalizeEditorTextAlign,
  normalizeEditorTextVerticalAlign,
} from '../utils/editorText';

interface UseTextEditingProps {
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
  zoom: number;
  position: { x: number; y: number };
  containerRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<Konva.Stage | null>;
}

interface TextareaPosition {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontStyle: string;
  textDecoration: string;
  align: string;
  verticalAlign: string;
  color: string;
  textBackground: string;
}

interface UseTextEditingReturn {
  editingTextId: string | null;
  editingTextValue: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  startEditing: (shapeId: string, currentText: string) => void;
  handleTextChange: (value: string) => void;
  handleSaveTextEdit: (measuredHeight?: number) => void;
  handleCancelTextEdit: () => void;
  getTextareaPosition: () => TextareaPosition | null;
}

interface StageTransformSnapshot {
  x: number;
  y: number;
  zoom: number;
}

const TRANSFORM_SYNC_EPSILON = 0.01;

function hasStageTransformChanged(
  prev: StageTransformSnapshot | null,
  next: StageTransformSnapshot
): boolean {
  if (!prev) return true;
  return (
    Math.abs(prev.x - next.x) > TRANSFORM_SYNC_EPSILON ||
    Math.abs(prev.y - next.y) > TRANSFORM_SYNC_EPSILON ||
    Math.abs(prev.zoom - next.zoom) > TRANSFORM_SYNC_EPSILON
  );
}

/**
 * Hook for inline text editing in the editor canvas
 * Manages the state and handlers for editing text shapes
 */
export const useTextEditing = ({
  shapes,
  onShapesChange,
  zoom,
  position,
  containerRef,
  stageRef,
}: UseTextEditingProps): UseTextEditingReturn => {
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [liveStageTransform, setLiveStageTransform] = useState<StageTransformSnapshot | null>(null);
  const lastStageTransformRef = useRef<StageTransformSnapshot | null>(null);

  useEffect(() => {
    if (!editingTextId) {
      lastStageTransformRef.current = null;
      setLiveStageTransform(null);
      return;
    }

    let rafId = 0;
    let isCancelled = false;

    const readTransform = (): StageTransformSnapshot => {
      const stage = stageRef.current;
      return {
        x: stage?.x() ?? position.x,
        y: stage?.y() ?? position.y,
        zoom: stage?.scaleX() ?? zoom,
      };
    };

    const syncTransform = () => {
      if (isCancelled) return;

      const nextTransform = readTransform();
      if (hasStageTransformChanged(lastStageTransformRef.current, nextTransform)) {
        lastStageTransformRef.current = nextTransform;
        setLiveStageTransform(nextTransform);
      }

      rafId = requestAnimationFrame(syncTransform);
    };

    const initialTransform = readTransform();
    lastStageTransformRef.current = initialTransform;
    setLiveStageTransform(initialTransform);
    rafId = requestAnimationFrame(syncTransform);

    return () => {
      isCancelled = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [editingTextId, position.x, position.y, stageRef, zoom]);

  // Start editing a text shape
  const startEditing = useCallback((shapeId: string, currentText: string) => {
    setEditingTextId(shapeId);
    setEditingTextValue(currentText);
  }, []);

  // Handle text value change
  const handleTextChange = useCallback((value: string) => {
    setEditingTextValue(value);
  }, []);

  // Save text edit, optionally resizing the shape to fit measured content height
  const handleSaveTextEdit = useCallback((measuredHeight?: number) => {
    if (!editingTextId) return;

    const currentShape = shapes.find((s) => s.id === editingTextId);
    const nextText = editingTextValue;

    if (!currentShape) {
      setEditingTextId(null);
      setEditingTextValue('');
      return;
    }

    const activeZoom = liveStageTransform?.zoom ?? stageRef.current?.scaleX() ?? zoom;

    // Convert measured pixel height (screen space) back to canvas space
    const newHeight = measuredHeight != null && activeZoom > 0
      ? Math.max(measuredHeight / activeZoom, EDITOR_TEXT.MIN_BOX_HEIGHT)
      : undefined;

    const textChanged = (currentShape.text || '') !== nextText;
    const heightChanged = newHeight != null && Math.abs((currentShape.height || 0) - newHeight) > 1;

    // Avoid shape-array churn when nothing actually changed.
    if (!textChanged && !heightChanged) {
      setEditingTextId(null);
      setEditingTextValue('');
      return;
    }

    const updatedShapes = shapes.map((s) =>
      s.id === editingTextId
        ? { ...s, text: nextText, ...(heightChanged ? { height: newHeight } : {}) }
        : s
    );
    onShapesChange(updatedShapes);
    setEditingTextId(null);
    setEditingTextValue('');
  }, [editingTextId, editingTextValue, liveStageTransform?.zoom, shapes, onShapesChange, stageRef, zoom]);

  // Cancel text edit
  const handleCancelTextEdit = useCallback(() => {
    setEditingTextId(null);
    setEditingTextValue('');
  }, []);

  // Get the position for the textarea overlay
  const getTextareaPosition = useCallback((): TextareaPosition | null => {
    if (!editingTextId || !containerRef.current) return null;

    const shape = shapes.find(s => s.id === editingTextId);
    if (!shape) return null;

    const fontSize = shape.fontSize ?? EDITOR_TEXT.DEFAULT_FONT_SIZE;

    // Read the actual Konva node position to avoid any formula mismatch
    // between our manual calculation and Konva's internal transform pipeline.
    const stage = stageRef.current;
    const node = stage?.findOne(`#${editingTextId}`);
    const activeZoom = liveStageTransform?.zoom ?? stage?.scaleX() ?? zoom;

    let left: number;
    let top: number;
    let effectiveWidth: number;
    let effectiveHeight: number;

    if (node) {
      // getClientRect() returns the bounding box in stage-container pixels,
      // already accounting for stage position, scale, and node transforms.
      // This matches Konva's rendering exactly — no manual formula needed.
      const rect = node.getClientRect();
      left = rect.x;
      top = rect.y;
      effectiveWidth = rect.width;
      effectiveHeight = rect.height;
    } else {
      // Fallback when the Konva node isn't mounted yet
      const stageX = liveStageTransform?.x ?? stage?.x() ?? position.x;
      const stageY = liveStageTransform?.y ?? stage?.y() ?? position.y;
      left = stageX + (shape.x || 0) * activeZoom;
      top = stageY + (shape.y || 0) * activeZoom;
      effectiveWidth = (shape.width || EDITOR_TEXT.DEFAULT_BOX_WIDTH) * activeZoom;
      effectiveHeight = (shape.height || getEditorTextDefaultBoxHeight(fontSize)) * activeZoom;
    }

    return {
      left,
      top,
      width: effectiveWidth,
      height: effectiveHeight,
      fontSize: fontSize * activeZoom,
      fontFamily: getEditorTextFontFamily(shape.fontFamily),
      fontStyle: getEditorTextFontStyle(shape.fontStyle),
      textDecoration: getEditorTextDecoration(shape.textDecoration),
      align: normalizeEditorTextAlign(shape.align),
      verticalAlign: normalizeEditorTextVerticalAlign(shape.verticalAlign),
      color: shape.fill || EDITOR_TEXT.DEFAULT_COLOR,
      textBackground: shape.textBackground || 'transparent',
    };
  }, [editingTextId, liveStageTransform, shapes, position, zoom, containerRef, stageRef]);

  return {
    editingTextId,
    editingTextValue,
    textareaRef,
    startEditing,
    handleTextChange,
    handleSaveTextEdit,
    handleCancelTextEdit,
    getTextareaPosition,
  };
};
