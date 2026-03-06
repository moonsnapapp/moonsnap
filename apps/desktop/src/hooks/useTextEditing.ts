import { useState, useCallback, useRef } from 'react';
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
}: UseTextEditingProps): UseTextEditingReturn => {
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    // Convert measured pixel height (screen space) back to canvas space
    const newHeight = measuredHeight != null && zoom > 0
      ? Math.max(measuredHeight / zoom, EDITOR_TEXT.MIN_BOX_HEIGHT)
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
  }, [editingTextId, editingTextValue, shapes, onShapesChange, zoom]);

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

    // Get container bounds
    const containerRect = containerRef.current.getBoundingClientRect();

    // Calculate screen position
    const screenX = containerRect.left + position.x + (shape.x || 0) * zoom;
    const screenY = containerRect.top + position.y + (shape.y || 0) * zoom;

    return {
      left: screenX,
      top: screenY,
      width: (shape.width || EDITOR_TEXT.DEFAULT_BOX_WIDTH) * zoom,
      height: (shape.height || getEditorTextDefaultBoxHeight(fontSize)) * zoom,
      fontSize: fontSize * zoom,
      fontFamily: getEditorTextFontFamily(shape.fontFamily),
      fontStyle: getEditorTextFontStyle(shape.fontStyle),
      textDecoration: getEditorTextDecoration(shape.textDecoration),
      align: normalizeEditorTextAlign(shape.align),
      verticalAlign: normalizeEditorTextVerticalAlign(shape.verticalAlign),
      color: shape.fill || EDITOR_TEXT.DEFAULT_COLOR,
      textBackground: shape.textBackground || 'transparent',
    };
  }, [editingTextId, shapes, position, zoom, containerRef]);

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
