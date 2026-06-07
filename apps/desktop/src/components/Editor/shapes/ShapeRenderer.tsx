import React, { useMemo, useCallback } from 'react';
import Konva from 'konva';
import type { CanvasShape } from '../../../types';
import { RectShape } from './RectShape';
import { CircleShape } from './CircleShape';
import { HighlightShape } from './HighlightShape';
import { PenShape } from './PenShape';
import { TextShape } from './TextShape';
import { StepShape } from './StepShape';
import { ArrowShape } from './ArrowShape';
import { LineShape } from './LineShape';
import { BlurShape } from './BlurShape';
import { ImageShape } from './ImageShape';

interface ShapeRendererProps {
  shapes: CanvasShape[];
  selectedIds: string[];
  selectedTool: string;
  zoom: number;
  sourceImage: HTMLImageElement | undefined;
  isDrawing: boolean;
  isPanning: boolean;
  editingTextId: string | null;
  onShapeClick: (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onShapeSelect: (shapeId: string) => void;
  onDragStart: (shapeId: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (shapeId: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onArrowDragEnd: (shapeId: string, newPoints: number[]) => void;
  onTransformStart: () => void;
  onTransformEnd: (shapeId: string, e: Konva.KonvaEventObject<Event>) => void;
  onArrowEndpointDragEnd: (shapeId: string, newPoints: number[]) => void;
  onTextStartEdit: (shapeId: string, currentText: string) => void;
  onTextMouseDown?: (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  /** Take snapshot before starting an edit action */
  takeSnapshot: () => void;
  /** Commit snapshot after completing an edit action */
  commitSnapshot: () => void;
}

type MemoizedShapeProps = {
  shape: CanvasShape;
  isSelected: boolean;
  isDraggable: boolean;
  isPanning: boolean;
  isDrawing: boolean;
  isLastShape: boolean;
  zoom: number;
  sourceImage: HTMLImageElement | undefined;
  isEditingTextShape: boolean;
  onShapeClick: (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onShapeSelect: (shapeId: string) => void;
  onDragStart: (shapeId: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (shapeId: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onArrowDragEnd: (shapeId: string, newPoints: number[]) => void;
  onTransformStart: () => void;
  onTransformEnd: (shapeId: string, e: Konva.KonvaEventObject<Event>) => void;
  onArrowEndpointDragEnd: (shapeId: string, newPoints: number[]) => void;
  onTextStartEdit: (shapeId: string, currentText: string) => void;
  onTextMouseDown?: (shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  takeSnapshot: () => void;
  commitSnapshot: () => void;
};

type ShapeCommonProps = {
  shape: CanvasShape;
  isSelected: boolean;
  isDraggable: boolean;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
};

interface RenderedShapeByTypeProps {
  shape: CanvasShape;
  commonProps: ShapeCommonProps;
  zoom: number;
  sourceImage: HTMLImageElement | undefined;
  isSelected: boolean;
  isDraggable: boolean;
  isActivelyDrawing: boolean;
  isEditingTextShape: boolean;
  onSelect: ShapeCommonProps['onSelect'];
  onDragStart: ShapeCommonProps['onDragStart'];
  onDragEnd: ShapeCommonProps['onDragEnd'];
  onTransformStart: () => void;
  onTransformEnd: ShapeCommonProps['onTransformEnd'];
  onArrowDragEnd: (_e: unknown, newPoints: number[]) => void;
  onArrowEndpointDragEnd: (_e: unknown, newPoints: number[]) => void;
  onTextMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onTextStartEdit: () => void;
  takeSnapshot: () => void;
  commitSnapshot: () => void;
}

type ShapeRenderFn = (props: RenderedShapeByTypeProps) => React.ReactNode;

function isMiddleMouseEvent(e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  const evt = e?.evt as MouseEvent | undefined;
  return evt?.button === 1;
}

function canSelectRenderedShape(
  shape: CanvasShape,
  isPanning: boolean,
  e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>
) {
  return !isPanning && !shape.isBackground && !isMiddleMouseEvent(e);
}

function getTextMouseDownShapeId(shape: CanvasShape, isPanning: boolean) {
  if (isPanning) return null;
  if (shape.isBackground) return null;
  return shape.type === 'text' ? shape.id : null;
}

function renderArrowShape({
  commonProps,
  zoom,
  onArrowDragEnd,
  onArrowEndpointDragEnd,
  takeSnapshot,
  commitSnapshot,
}: RenderedShapeByTypeProps) {
  return (
    <ArrowShape
      {...commonProps}
      zoom={zoom}
      onDragEnd={onArrowDragEnd}
      onEndpointDragEnd={onArrowEndpointDragEnd}
      takeSnapshot={takeSnapshot}
      commitSnapshot={commitSnapshot}
    />
  );
}

function renderLineShape({
  commonProps,
  zoom,
  onArrowDragEnd,
  onArrowEndpointDragEnd,
  takeSnapshot,
  commitSnapshot,
}: RenderedShapeByTypeProps) {
  return (
    <LineShape
      {...commonProps}
      zoom={zoom}
      onDragEnd={onArrowDragEnd}
      onEndpointDragEnd={onArrowEndpointDragEnd}
      takeSnapshot={takeSnapshot}
      commitSnapshot={commitSnapshot}
    />
  );
}

function renderBlurShape({
  shape,
  sourceImage,
  isSelected,
  isDraggable,
  isActivelyDrawing,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
}: RenderedShapeByTypeProps) {
  return (
    <BlurShape
      shape={shape}
      sourceImage={sourceImage}
      isSelected={isSelected}
      isDraggable={isDraggable}
      isActivelyDrawing={isActivelyDrawing}
      onSelect={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    />
  );
}

function renderTextShape({
  commonProps,
  zoom,
  isActivelyDrawing,
  isEditingTextShape,
  onTextMouseDown,
  onTextStartEdit,
}: RenderedShapeByTypeProps) {
  return (
    <TextShape
      {...commonProps}
      isActivelyDrawing={isActivelyDrawing}
      isEditing={isEditingTextShape}
      zoom={zoom}
      onMouseDown={onTextMouseDown}
      onStartEdit={onTextStartEdit}
    />
  );
}

function renderImageShape({ shape, commonProps, sourceImage }: RenderedShapeByTypeProps) {
  return <ImageShape {...commonProps} sourceImage={shape.isBackground ? sourceImage : undefined} />;
}

const SHAPE_RENDERERS: Record<string, ShapeRenderFn> = {
  arrow: renderArrowShape,
  line: renderLineShape,
  rect: ({ commonProps }) => <RectShape {...commonProps} />,
  circle: ({ commonProps }) => <CircleShape {...commonProps} />,
  highlight: ({ commonProps }) => <HighlightShape {...commonProps} />,
  blur: renderBlurShape,
  text: renderTextShape,
  step: ({ commonProps }) => <StepShape {...commonProps} />,
  pen: ({ commonProps }) => <PenShape {...commonProps} />,
  image: renderImageShape,
};

function RenderedShapeByType(props: RenderedShapeByTypeProps) {
  const renderShape = SHAPE_RENDERERS[props.shape.type];
  return renderShape?.(props) ?? null;
}

/**
 * Individual shape wrapper - memoized to prevent re-renders when other shapes change
 */
const MemoizedShape = React.memo<MemoizedShapeProps>(({
  shape,
  isSelected,
  isDraggable,
  isPanning,
  isDrawing,
  isLastShape,
  zoom,
  sourceImage,
  isEditingTextShape,
  onShapeClick,
  onShapeSelect,
  onDragStart,
  onDragEnd,
  onArrowDragEnd,
  onTransformStart,
  onTransformEnd,
  onArrowEndpointDragEnd,
  onTextStartEdit,
  onTextMouseDown,
  takeSnapshot,
  commitSnapshot,
}) => {
  const isActivelyDrawing = isDrawing && isLastShape;

  // Stable callbacks that reference shape.id
  const handleSelect = useCallback((e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!canSelectRenderedShape(shape, isPanning, e)) return;
    onShapeSelect(shape.id);
  }, [isPanning, onShapeSelect, shape]);

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isPanning || shape.isBackground) return;
    onShapeClick(shape.id, e);
  }, [isPanning, onShapeClick, shape.id, shape.isBackground]);

  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (isPanning) return;
    onDragStart(shape.id, e);
  }, [isPanning, onDragStart, shape.id]);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onDragEnd(shape.id, e);
  }, [onDragEnd, shape.id]);

  const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
    onTransformEnd(shape.id, e);
  }, [onTransformEnd, shape.id]);

  const handleArrowDragEnd = useCallback((_e: unknown, newPoints: number[]) => {
    onArrowDragEnd(shape.id, newPoints);
  }, [onArrowDragEnd, shape.id]);

  const handleArrowEndpointDragEnd = useCallback((_: unknown, newPoints: number[]) => {
    onArrowEndpointDragEnd(shape.id, newPoints);
  }, [onArrowEndpointDragEnd, shape.id]);

  const handleTextStartEdit = useCallback(() => {
    onTextStartEdit(shape.id, shape.text || '');
  }, [onTextStartEdit, shape.id, shape.text]);

  const handleTextMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const textShapeId = getTextMouseDownShapeId(shape, isPanning);
    if (!textShapeId) return;
    onTextMouseDown?.(textShapeId, e);
  }, [isPanning, onTextMouseDown, shape]);

  const commonProps = useMemo(() => ({
    shape,
    isSelected,
    isDraggable,
    onSelect: handleSelect,
    onClick: handleClick,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onTransformStart,
    onTransformEnd: handleTransformEnd,
  }), [shape, isSelected, isDraggable, handleSelect, handleClick, handleDragStart, handleDragEnd, onTransformStart, handleTransformEnd]);

  return (
    <RenderedShapeByType
      shape={shape}
      commonProps={commonProps}
      zoom={zoom}
      sourceImage={sourceImage}
      isSelected={isSelected}
      isDraggable={isDraggable}
      isActivelyDrawing={isActivelyDrawing}
      isEditingTextShape={isEditingTextShape}
      onSelect={handleSelect}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTransformStart={onTransformStart}
      onTransformEnd={handleTransformEnd}
      onArrowDragEnd={handleArrowDragEnd}
      onArrowEndpointDragEnd={handleArrowEndpointDragEnd}
      onTextMouseDown={handleTextMouseDown}
      onTextStartEdit={handleTextStartEdit}
      takeSnapshot={takeSnapshot}
      commitSnapshot={commitSnapshot}
    />
  );
});

MemoizedShape.displayName = 'MemoizedShape';

/**
 * ShapeRenderer - dispatches rendering to appropriate shape component
 * Uses memoization to prevent re-renders when unrelated state changes
 */
export const ShapeRenderer: React.FC<ShapeRendererProps> = React.memo(({
  shapes,
  selectedIds,
  selectedTool,
  zoom,
  sourceImage,
  isDrawing,
  isPanning,
  editingTextId,
  onShapeClick,
  onShapeSelect,
  onDragStart,
  onDragEnd,
  onArrowDragEnd,
  onTransformStart,
  onTransformEnd,
  onArrowEndpointDragEnd,
  onTextStartEdit,
  onTextMouseDown,
  takeSnapshot,
  commitSnapshot,
}) => {
  const isDraggable = selectedTool === 'select' && !isPanning;

  // Memoize the selected set for O(1) lookup
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const lastShapeId = shapes[shapes.length - 1]?.id;

  return (
    <>
      {shapes.map((shape) => (
        <MemoizedShape
          key={shape.id}
          shape={shape}
          isSelected={!shape.isBackground && selectedSet.has(shape.id)}
          isDraggable={!shape.isBackground && isDraggable}
          isPanning={isPanning}
          isDrawing={isDrawing}
          isLastShape={shape.id === lastShapeId}
          zoom={zoom}
          sourceImage={sourceImage}
          isEditingTextShape={editingTextId === shape.id}
          onShapeClick={onShapeClick}
          onShapeSelect={onShapeSelect}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onArrowDragEnd={onArrowDragEnd}
          onTransformStart={onTransformStart}
          onTransformEnd={onTransformEnd}
          onArrowEndpointDragEnd={onArrowEndpointDragEnd}
          onTextStartEdit={onTextStartEdit}
          onTextMouseDown={onTextMouseDown}
          takeSnapshot={takeSnapshot}
          commitSnapshot={commitSnapshot}
        />
      ))}
    </>
  );
});
