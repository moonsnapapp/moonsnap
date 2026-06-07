import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Group, Image, Rect } from 'react-konva';
import Konva from 'konva';
import type { CanvasShape } from '../../../types';
import { renderBlurCanvas, BlurRenderResult } from '../../../utils/blurRenderer';
import { useShapeCursor } from '../../../hooks/useShapeCursor';

interface BlurShapeProps {
  shape: CanvasShape;
  sourceImage: HTMLImageElement | undefined;
  isSelected: boolean;
  isDraggable: boolean;
  isActivelyDrawing: boolean;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}

interface BlurBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BlurAxisBounds {
  start: number;
  size: number;
}

interface BlurInteractionPresentation {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: number[];
}

interface BlurInteractionHandlers {
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: () => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}

function getBlurRender(
  sourceImage: HTMLImageElement | undefined,
  bounds: BlurBounds,
  blurType: NonNullable<CanvasShape['blurType']>,
  blurAmount: number
): BlurRenderResult | null {
  if (!sourceImage || bounds.width < 1 || bounds.height < 1) {
    return null;
  }

  return renderBlurCanvas(
    sourceImage,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    blurType,
    blurAmount
  );
}

function getAxisBounds(origin: number | undefined, size: number | undefined): BlurAxisBounds {
  const rawOrigin = origin ?? 0;
  const rawSize = size ?? 0;

  return {
    start: Math.min(rawOrigin, rawOrigin + rawSize),
    size: Math.abs(rawSize),
  };
}

function getBlurBounds(shape: CanvasShape): BlurBounds {
  const xAxis = getAxisBounds(shape.x, shape.width);
  const yAxis = getAxisBounds(shape.y, shape.height);

  return {
    x: xAxis.start,
    y: yAxis.start,
    width: xAxis.size,
    height: yAxis.size,
  };
}

interface BlurInteractionRectProps {
  rectRef: React.RefObject<Konva.Rect | null>;
  shapeId: string;
  bounds: BlurBounds;
  isDraggable: boolean;
  handlers: BlurInteractionHandlers;
  cursorHandlers: ReturnType<typeof useShapeCursor>;
  placeholder?: boolean;
}

function getBlurInteractionPresentation(placeholder: boolean): BlurInteractionPresentation {
  if (placeholder) {
    return {
      fill: 'rgba(128, 128, 128, 0.5)',
      stroke: '#666',
      strokeWidth: 1,
      dash: [4, 4],
    };
  }

  return {
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
  };
}

function getBlurInteractionDimension(size: number): number {
  return size > 0 ? size : 50;
}

function BlurInteractionRect({
  rectRef,
  shapeId,
  bounds,
  isDraggable,
  handlers,
  cursorHandlers,
  placeholder = false,
}: BlurInteractionRectProps) {
  const presentation = getBlurInteractionPresentation(placeholder);

  return (
    <Rect
      ref={rectRef}
      id={shapeId}
      x={bounds.x}
      y={bounds.y}
      width={getBlurInteractionDimension(bounds.width)}
      height={getBlurInteractionDimension(bounds.height)}
      fill={presentation.fill}
      stroke={presentation.stroke}
      strokeWidth={presentation.strokeWidth}
      dash={presentation.dash}
      draggable={isDraggable}
      onMouseDown={handlers.onSelect}
      onTouchStart={handlers.onSelect}
      onClick={handlers.onSelect}
      onTap={handlers.onSelect}
      onDragStart={handlers.onDragStart}
      onDragMove={handlers.onDragMove}
      onDragEnd={handlers.onDragEnd}
      onTransformStart={handlers.onTransformStart}
      onTransform={handlers.onTransform}
      onTransformEnd={handlers.onTransformEnd}
      {...cursorHandlers}
    />
  );
}

interface DrawingBlurPreviewProps {
  shapeId: string;
  bounds: BlurBounds;
  blurResult: BlurRenderResult;
}

function DrawingBlurPreview({ shapeId, bounds, blurResult }: DrawingBlurPreviewProps) {
  return (
    <Group>
      <Image
        id={shapeId}
        image={blurResult.canvas}
        x={blurResult.x}
        y={blurResult.y}
        width={blurResult.width}
        height={blurResult.height}
        listening={false}
      />
      <Rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        stroke="#fbbf24"
        strokeWidth={2}
        dash={[6, 3]}
        listening={false}
      />
    </Group>
  );
}

interface RenderedBlurShapeProps {
  groupRef: React.RefObject<Konva.Group | null>;
  imageRef: React.RefObject<Konva.Image | null>;
  rectRef: React.RefObject<Konva.Rect | null>;
  shapeId: string;
  bounds: BlurBounds;
  isDraggable: boolean;
  blurResult: BlurRenderResult | null;
  handlers: BlurInteractionHandlers;
  cursorHandlers: ReturnType<typeof useShapeCursor>;
}

function RenderedBlurShape({
  groupRef,
  imageRef,
  rectRef,
  shapeId,
  bounds,
  isDraggable,
  blurResult,
  handlers,
  cursorHandlers,
}: RenderedBlurShapeProps) {
  return (
    <Group ref={groupRef}>
      {blurResult && (
        <Image
          ref={imageRef}
          image={blurResult.canvas}
          x={blurResult.x}
          y={blurResult.y}
          width={blurResult.width}
          height={blurResult.height}
          listening={false}
        />
      )}
      <BlurInteractionRect
        rectRef={rectRef}
        shapeId={shapeId}
        bounds={bounds}
        isDraggable={isDraggable}
        handlers={handlers}
        cursorHandlers={cursorHandlers}
      />
    </Group>
  );
}

interface BlurShapeContentProps {
  groupRef: React.RefObject<Konva.Group | null>;
  imageRef: React.RefObject<Konva.Image | null>;
  rectRef: React.RefObject<Konva.Rect | null>;
  shapeId: string;
  sourceImage: HTMLImageElement | undefined;
  bounds: BlurBounds;
  blurType: NonNullable<CanvasShape['blurType']>;
  blurAmount: number;
  isDraggable: boolean;
  isActivelyDrawing: boolean;
  blurResult: BlurRenderResult | null;
  handlers: BlurInteractionHandlers;
  cursorHandlers: ReturnType<typeof useShapeCursor>;
}

function shouldShowBlurPlaceholder(
  sourceImage: HTMLImageElement | undefined,
  bounds: BlurBounds
) {
  return !sourceImage || bounds.width < 1 || bounds.height < 1;
}

function DrawingBlurPreviewSlot({
  shapeId,
  sourceImage,
  bounds,
  blurType,
  blurAmount,
  isActivelyDrawing,
}: Pick<
  BlurShapeContentProps,
  'shapeId' | 'sourceImage' | 'bounds' | 'blurType' | 'blurAmount' | 'isActivelyDrawing'
>) {
  if (!isActivelyDrawing) return null;

  const drawingBlur = getBlurRender(sourceImage, bounds, blurType, blurAmount);
  return drawingBlur
    ? <DrawingBlurPreview shapeId={shapeId} bounds={bounds} blurResult={drawingBlur} />
    : null;
}

function BlurPlaceholderRect({
  rectRef,
  shapeId,
  bounds,
  isDraggable,
  handlers,
  cursorHandlers,
}: Pick<
  BlurShapeContentProps,
  'rectRef' | 'shapeId' | 'bounds' | 'isDraggable' | 'handlers' | 'cursorHandlers'
>) {
  return (
    <BlurInteractionRect
      rectRef={rectRef}
      shapeId={shapeId}
      bounds={bounds}
      isDraggable={isDraggable}
      handlers={handlers}
      cursorHandlers={cursorHandlers}
      placeholder={true}
    />
  );
}

function getLiveBlurRenderContext(
  sourceImage: HTMLImageElement | undefined,
  imageNode: Konva.Image | null,
  width: number,
  height: number
) {
  if (!hasLiveBlurSource(sourceImage)) return null;
  if (!hasLiveBlurImageNode(imageNode)) return null;
  if (!hasRenderableBlurSize(width, height)) return null;

  return { sourceImage, imageNode };
}

function hasLiveBlurSource(
  sourceImage: HTMLImageElement | undefined,
): sourceImage is HTMLImageElement {
  return Boolean(sourceImage);
}

function hasLiveBlurImageNode(imageNode: Konva.Image | null): imageNode is Konva.Image {
  return Boolean(imageNode);
}

function hasRenderableBlurSize(width: number, height: number) {
  return width >= 1 && height >= 1;
}

function applyBlurRenderToImageNode(imageNode: Konva.Image, result: BlurRenderResult) {
  imageNode.image(result.canvas);
  imageNode.x(result.x);
  imageNode.y(result.y);
  imageNode.width(result.width);
  imageNode.height(result.height);
  imageNode.getLayer()?.batchDraw();
}

function BlurShapeContent({
  groupRef,
  imageRef,
  rectRef,
  shapeId,
  sourceImage,
  bounds,
  blurType,
  blurAmount,
  isDraggable,
  isActivelyDrawing,
  blurResult,
  handlers,
  cursorHandlers,
}: BlurShapeContentProps) {
  if (isActivelyDrawing) {
    return (
      <DrawingBlurPreviewSlot
        shapeId={shapeId}
        sourceImage={sourceImage}
        bounds={bounds}
        blurType={blurType}
        blurAmount={blurAmount}
        isActivelyDrawing={isActivelyDrawing}
      />
    );
  }

  if (shouldShowBlurPlaceholder(sourceImage, bounds)) {
    return (
      <BlurPlaceholderRect
        rectRef={rectRef}
        shapeId={shapeId}
        bounds={bounds}
        isDraggable={isDraggable}
        handlers={handlers}
        cursorHandlers={cursorHandlers}
      />
    );
  }

  return (
    <RenderedBlurShape
      groupRef={groupRef}
      imageRef={imageRef}
      rectRef={rectRef}
      shapeId={shapeId}
      bounds={bounds}
      isDraggable={isDraggable}
      blurResult={blurResult}
      handlers={handlers}
      cursorHandlers={cursorHandlers}
    />
  );
}

function useLiveBlurInteraction({
  sourceImage,
  blurType,
  blurAmount,
  bounds,
  imageRef,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
}: {
  sourceImage: HTMLImageElement | undefined;
  blurType: NonNullable<CanvasShape['blurType']>;
  blurAmount: number;
  bounds: BlurBounds;
  imageRef: React.RefObject<Konva.Image | null>;
  onDragStart: BlurShapeProps['onDragStart'];
  onDragEnd: BlurShapeProps['onDragEnd'];
  onTransformStart: BlurShapeProps['onTransformStart'];
  onTransformEnd: BlurShapeProps['onTransformEnd'];
}) {
  const liveWidthRef = useRef(0);
  const liveHeightRef = useRef(0);

  useEffect(() => {
    liveWidthRef.current = bounds.width;
    liveHeightRef.current = bounds.height;
  }, [bounds.width, bounds.height]);

  const renderBlurLive = useCallback((x: number, y: number, width: number, height: number) => {
    const imageNode = imageRef.current;
    const context = getLiveBlurRenderContext(sourceImage, imageNode, width, height);
    if (!context) return;

    const result = renderBlurCanvas(context.sourceImage, x, y, width, height, blurType, blurAmount);
    if (!result) return;

    applyBlurRenderToImageNode(context.imageNode, result);
  }, [sourceImage, imageRef, blurType, blurAmount]);

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    renderBlurLive(node.x(), node.y(), liveWidthRef.current, liveHeightRef.current);
  }, [renderBlurLive]);

  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    const newWidth = Math.abs(node.width() * node.scaleX());
    const newHeight = Math.abs(node.height() * node.scaleY());
    const newX = node.x();
    const newY = node.y();

    node.scaleX(1);
    node.scaleY(1);
    node.width(newWidth);
    node.height(newHeight);

    liveWidthRef.current = newWidth;
    liveHeightRef.current = newHeight;
    renderBlurLive(newX, newY, newWidth, newHeight);
  }, [renderBlurLive]);

  return {
    onDragStart,
    onDragMove: handleDragMove,
    onDragEnd,
    onTransformStart,
    onTransform: handleTransform,
    onTransformEnd,
  };
}

/**
 * BlurShape component - renders blur/pixelate effect with LIVE preview
 * Re-renders blur in real-time during drag and resize for accurate preview
 */
export const BlurShape: React.FC<BlurShapeProps> = React.memo(({
  shape,
  sourceImage,
  isSelected: _isSelected,
  isDraggable,
  isActivelyDrawing,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
}) => {
  void _isSelected; // Blur shapes don't show selection border
  const cursorHandlers = useShapeCursor(isDraggable);
  const rectRef = useRef<Konva.Rect>(null);
  const imageRef = useRef<Konva.Image>(null);
  const groupRef = useRef<Konva.Group>(null);
  const [blurResult, setBlurResult] = useState<BlurRenderResult | null>(null);

  const blurType = shape.blurType || 'pixelate';
  const blurAmount = shape.blurAmount || shape.pixelSize || 15;

  const bounds = useMemo(() => getBlurBounds(shape), [shape]);

  // Initial blur render from props
  useEffect(() => {
    setBlurResult(getBlurRender(sourceImage, bounds, blurType, blurAmount));
  }, [sourceImage, bounds, blurType, blurAmount]);

  const liveInteractionHandlers = useLiveBlurInteraction({
    sourceImage,
    blurType,
    blurAmount,
    bounds,
    imageRef,
    onDragStart,
    onDragEnd,
    onTransformStart,
    onTransformEnd,
  });

  const interactionHandlers: BlurInteractionHandlers = {
    onSelect,
    ...liveInteractionHandlers,
  };

  return (
    <BlurShapeContent
      groupRef={groupRef}
      imageRef={imageRef}
      rectRef={rectRef}
      shapeId={shape.id}
      sourceImage={sourceImage}
      bounds={bounds}
      blurType={blurType}
      blurAmount={blurAmount}
      isDraggable={isDraggable}
      isActivelyDrawing={isActivelyDrawing}
      blurResult={blurResult}
      handlers={interactionHandlers}
      cursorHandlers={cursorHandlers}
    />
  );
});

BlurShape.displayName = 'BlurShape';
