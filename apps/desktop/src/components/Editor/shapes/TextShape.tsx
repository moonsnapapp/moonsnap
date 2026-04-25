import React, { useRef, useMemo, useCallback } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';
import type { CanvasShape } from '../../../types';
import { useShapeCursor } from '../../../hooks/useShapeCursor';
import {
  EDITOR_TEXT,
  getEditorTextDecoration,
  getEditorTextFontFamily,
  getEditorTextFontStyle,
  normalizeEditorTextAlign,
  normalizeEditorTextVerticalAlign,
} from '../../../utils/editorText';

interface TextShapeProps {
  shape: CanvasShape;
  isSelected: boolean;
  isDraggable: boolean;
  isActivelyDrawing: boolean;
  isEditing: boolean;
  zoom: number;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onStartEdit: () => void;
}

// Minimum dimensions for text box
const MIN_WIDTH = EDITOR_TEXT.MIN_BOX_WIDTH;
const MIN_HEIGHT = EDITOR_TEXT.MIN_BOX_HEIGHT;

export const TextShape: React.FC<TextShapeProps> = React.memo(({
  shape,
  isDraggable,
  isActivelyDrawing,
  isEditing,
  zoom,
  onClick,
  onMouseDown,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
  onStartEdit,
}) => {
  const cursorHandlers = useShapeCursor(isDraggable);
  const groupRef = useRef<Konva.Group>(null);

  const width = shape.width || MIN_WIDTH;
  const height = shape.height || MIN_HEIGHT;

  // Avoid placeholder layout while dragging a new text box; only show it once drawing is done.
  const hasText = Boolean(shape.text);
  const showPlaceholder = !hasText && !isEditing && !isActivelyDrawing;
  const displayText = hasText ? (shape.text as string) : (showPlaceholder ? 'Double-click to edit' : '');
  const textOpacity = hasText ? 1 : 0.4;
  const textBoxStroke = shape.textBoxStroke || 'transparent';
  const textBoxStrokeWidth = shape.textBoxStrokeWidth || 0;
  const hasTextBackground = Boolean(shape.textBackground && shape.textBackground !== 'transparent');
  const hasTextBoxOutline = textBoxStroke !== 'transparent' && textBoxStrokeWidth > 0;

  // Memoize zoom-dependent values to avoid new references every render
  const borderStrokeWidth = 1 / zoom;
  const borderDash = useMemo(() => [4 / zoom, 4 / zoom], [zoom]);
  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    onClick(e);
  }, [onClick]);

  return (
    <Group
      ref={groupRef}
      id={shape.id}
      x={shape.x}
      y={shape.y}
      width={width}
      height={height}
      rotation={shape.rotation}
      scaleX={shape.scaleX}
      scaleY={shape.scaleY}
      // Text dragging is handled manually in EditorCanvas for lower-latency first-frame updates.
      draggable={false}
      dragDistance={0}
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onTap={onSelect}
      onDblClick={onStartEdit}
      onDblTap={onStartEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
      {...cursorHandlers}
    >
      {/* Lightweight hit area for selection/dragging.
          Avoids expensive glyph hit-testing on the Text node at drag start. */}
      <Rect
        name="text-hit-area"
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        strokeEnabled={false}
        perfectDrawEnabled={false}
      />

      {/* Text background fill — hidden while the HTML overlay is active to
           avoid sub-pixel misalignment between canvas and CSS positioning */}
      {(hasTextBackground || hasTextBoxOutline) && (
        <Rect
          name="text-background"
          x={0}
          y={0}
          width={width}
          height={height}
          fill={hasTextBackground ? shape.textBackground : 'transparent'}
          stroke={textBoxStroke}
          strokeWidth={textBoxStrokeWidth}
          cornerRadius={4}
          visible={!isEditing}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* Bounding box border - always rendered, visibility toggled to avoid
          expensive Konva node mount/unmount on every select/deselect */}
      <Rect
        name="text-box-border editor-gizmo"
        x={0}
        y={0}
        width={width}
        height={height}
        stroke="#3B82F6"
        strokeWidth={borderStrokeWidth}
        dash={borderDash}
        visible={isActivelyDrawing}
        listening={false}
      />

      {/* Text content */}
      {(!isActivelyDrawing || hasText) && (
        <Text
          name="text-content"
          x={0}
          y={0}
          width={width}
          height={height}
          text={displayText}
          fontSize={shape.fontSize || EDITOR_TEXT.DEFAULT_FONT_SIZE}
          fontFamily={getEditorTextFontFamily(shape.fontFamily)}
          fontStyle={getEditorTextFontStyle(shape.fontStyle)}
          textDecoration={getEditorTextDecoration(shape.textDecoration)}
          align={normalizeEditorTextAlign(shape.align)}
          verticalAlign={normalizeEditorTextVerticalAlign(shape.verticalAlign)}
          wrap={shape.wrap || EDITOR_TEXT.DEFAULT_WRAP}
          lineHeight={shape.lineHeight || EDITOR_TEXT.DEFAULT_LINE_HEIGHT}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth || 0}
          opacity={textOpacity}
          visible={!isEditing}
          padding={4}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
});

TextShape.displayName = 'TextShape';
