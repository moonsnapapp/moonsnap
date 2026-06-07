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

interface TextShapePresentation {
  width: number;
  height: number;
  displayText: string;
  textOpacity: number;
  textBoxStroke: string;
  textBoxStrokeWidth: number;
  hasTextBackground: boolean;
  hasTextBoxOutline: boolean;
  shouldRenderText: boolean;
}

function shouldShowTextPlaceholder(
  hasText: boolean,
  isEditing: boolean,
  isActivelyDrawing: boolean
) {
  return !hasText && !isEditing && !isActivelyDrawing;
}

function getTextDisplayContent(shape: CanvasShape, showPlaceholder: boolean) {
  if (shape.text) return shape.text as string;
  return showPlaceholder ? 'Double-click to edit' : '';
}

function hasVisibleTextBackground(shape: CanvasShape) {
  return Boolean(shape.textBackground && shape.textBackground !== 'transparent');
}

function hasVisibleTextBoxOutline(stroke: string, strokeWidth: number) {
  return stroke !== 'transparent' && strokeWidth > 0;
}

function getTextShapeSize(shape: CanvasShape) {
  return {
    width: shape.width || MIN_WIDTH,
    height: shape.height || MIN_HEIGHT,
  };
}

function getTextBoxStroke(shape: CanvasShape) {
  return {
    textBoxStroke: shape.textBoxStroke || 'transparent',
    textBoxStrokeWidth: shape.textBoxStrokeWidth || 0,
  };
}

function getTextVisibilityPresentation({
  shape,
  isEditing,
  isActivelyDrawing,
}: {
  shape: CanvasShape;
  isEditing: boolean;
  isActivelyDrawing: boolean;
}) {
  const hasText = Boolean(shape.text);
  const showPlaceholder = shouldShowTextPlaceholder(hasText, isEditing, isActivelyDrawing);

  return {
    displayText: getTextDisplayContent(shape, showPlaceholder),
    textOpacity: hasText ? 1 : 0.4,
    shouldRenderText: !isActivelyDrawing || hasText,
  };
}

function getTextShapePresentation(
  shape: CanvasShape,
  isEditing: boolean,
  isActivelyDrawing: boolean
): TextShapePresentation {
  const { width, height } = getTextShapeSize(shape);
  const { textBoxStroke, textBoxStrokeWidth } = getTextBoxStroke(shape);

  return {
    width,
    height,
    ...getTextVisibilityPresentation({ shape, isEditing, isActivelyDrawing }),
    textBoxStroke,
    textBoxStrokeWidth,
    hasTextBackground: hasVisibleTextBackground(shape),
    hasTextBoxOutline: hasVisibleTextBoxOutline(textBoxStroke, textBoxStrokeWidth),
  };
}

function TextBackgroundNode({
  shape,
  presentation,
  isEditing,
}: {
  shape: CanvasShape;
  presentation: TextShapePresentation;
  isEditing: boolean;
}) {
  if (!presentation.hasTextBackground && !presentation.hasTextBoxOutline) {
    return null;
  }

  return (
    <Rect
      name="text-background"
      x={0}
      y={0}
      width={presentation.width}
      height={presentation.height}
      fill={presentation.hasTextBackground ? shape.textBackground : 'transparent'}
      stroke={presentation.textBoxStroke}
      strokeWidth={presentation.textBoxStrokeWidth}
      cornerRadius={4}
      visible={!isEditing}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

function getTextTypographyProps(shape: CanvasShape) {
  return {
    fontSize: shape.fontSize || EDITOR_TEXT.DEFAULT_FONT_SIZE,
    fontFamily: getEditorTextFontFamily(shape.fontFamily),
    fontStyle: getEditorTextFontStyle(shape.fontStyle),
    textDecoration: getEditorTextDecoration(shape.textDecoration),
    align: normalizeEditorTextAlign(shape.align),
    verticalAlign: normalizeEditorTextVerticalAlign(shape.verticalAlign),
    wrap: shape.wrap || EDITOR_TEXT.DEFAULT_WRAP,
    lineHeight: shape.lineHeight || EDITOR_TEXT.DEFAULT_LINE_HEIGHT,
  };
}

function getTextPaintProps(shape: CanvasShape, presentation: TextShapePresentation) {
  return {
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth || 0,
    opacity: presentation.textOpacity,
  };
}

function getTextContentNodeProps(
  shape: CanvasShape,
  presentation: TextShapePresentation,
  isEditing: boolean
): React.ComponentProps<typeof Text> {
  return {
    name: 'text-content',
    x: 0,
    y: 0,
    width: presentation.width,
    height: presentation.height,
    text: presentation.displayText,
    ...getTextTypographyProps(shape),
    ...getTextPaintProps(shape, presentation),
    visible: !isEditing,
    padding: 4,
    listening: false,
    perfectDrawEnabled: false,
  };
}

function TextContentNode({
  shape,
  presentation,
  isEditing,
}: {
  shape: CanvasShape;
  presentation: TextShapePresentation;
  isEditing: boolean;
}) {
  if (!presentation.shouldRenderText) {
    return null;
  }

  return (
    <Text {...getTextContentNodeProps(shape, presentation, isEditing)} />
  );
}

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
  const presentation = getTextShapePresentation(shape, isEditing, isActivelyDrawing);

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
      width={presentation.width}
      height={presentation.height}
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
        width={presentation.width}
        height={presentation.height}
        fill="transparent"
        strokeEnabled={false}
        perfectDrawEnabled={false}
      />

      {/* Text background fill — hidden while the HTML overlay is active to
           avoid sub-pixel misalignment between canvas and CSS positioning */}
      <TextBackgroundNode
        shape={shape}
        presentation={presentation}
        isEditing={isEditing}
      />

      {/* Bounding box border - always rendered, visibility toggled to avoid
          expensive Konva node mount/unmount on every select/deselect */}
      <Rect
        name="text-box-border editor-gizmo"
        x={0}
        y={0}
        width={presentation.width}
        height={presentation.height}
        stroke="#3B82F6"
        strokeWidth={borderStrokeWidth}
        dash={borderDash}
        visible={isActivelyDrawing}
        listening={false}
      />

      {/* Text content */}
      <TextContentNode
        shape={shape}
        presentation={presentation}
        isEditing={isEditing}
      />
    </Group>
  );
});

TextShape.displayName = 'TextShape';
