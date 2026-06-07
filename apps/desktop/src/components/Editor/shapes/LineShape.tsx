import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { Line, Circle, Group } from 'react-konva';
import Konva from 'konva';
import type { CanvasShape } from '../../../types';
import { useShapeCursor } from '../../../hooks/useShapeCursor';

interface LineShapeProps {
  shape: CanvasShape;
  isSelected: boolean;
  isDraggable: boolean;
  zoom: number;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>, newPoints: number[]) => void;
  onEndpointDragEnd: (endpointIndex: 0 | 1, newPoints: number[]) => void;
  /** Take snapshot before starting an edit action */
  takeSnapshot: () => void;
  /** Commit snapshot after completing an edit action */
  commitSnapshot: () => void;
}

type EndpointIndex = 0 | 1;

interface LineEndpointHandleProps {
  circleRef: React.RefObject<Konva.Circle | null>;
  x: number;
  y: number;
  zoom: number;
  handleSize: number;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}

interface SelectedLineEndpointHandlesProps {
  visible: boolean;
  startHandleRef: React.RefObject<Konva.Circle | null>;
  endHandleRef: React.RefObject<Konva.Circle | null>;
  startEndpoint: { x: number; y: number };
  endEndpoint: { x: number; y: number };
  zoom: number;
  handleSize: number;
  onDragStart: () => void;
  onStartDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onEndDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onStartDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onEndDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}

function animateEndpointHandle(
  handleRef: React.RefObject<Konva.Circle | null>,
  isSelected: boolean,
  handleSize: number,
  handleStrokeWidth: number,
) {
  if (!handleRef.current || !isSelected) {
    return;
  }

  handleRef.current.to({ radius: handleSize, strokeWidth: handleStrokeWidth, duration: 0.1 });
}

function positionEndpointHandle(
  handleRef: React.RefObject<Konva.Circle | null>,
  x: number,
  y: number,
) {
  handleRef.current?.position({ x, y });
}

function getMovedLinePoints(points: number[], dx: number, dy: number) {
  return [points[0] + dx, points[1] + dy, points[2] + dx, points[3] + dy];
}

function getEndpointCoordinates(points: number[], endpointIndex: EndpointIndex) {
  return endpointIndex === 0
    ? { x: points[0], y: points[1] }
    : { x: points[2], y: points[3] };
}

function getDraggedEndpointPoints(
  points: number[],
  endpointIndex: EndpointIndex,
  x: number,
  y: number,
) {
  const newPoints = [...points];
  const pointOffset = endpointIndex * 2;
  newPoints[pointOffset] = x;
  newPoints[pointOffset + 1] = y;
  return newPoints;
}

function updateLineEndpointDuringDrag(
  lineRef: React.RefObject<Konva.Line | null>,
  points: number[],
  endpointIndex: EndpointIndex,
  x: number,
  y: number,
) {
  lineRef.current?.points(getDraggedEndpointPoints(points, endpointIndex, x, y));
}

function setStageCursor(e: Konva.KonvaEventObject<MouseEvent>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

function LineEndpointHandle({
  circleRef,
  x,
  y,
  zoom,
  handleSize,
  onDragStart,
  onDragMove,
  onDragEnd,
  onMouseEnter,
  onMouseLeave,
}: LineEndpointHandleProps) {
  return (
    <Circle
      ref={circleRef}
      name="editor-gizmo"
      x={x}
      y={y}
      radius={handleSize}
      fill="#fff"
      stroke="#374151"
      strokeWidth={1.5 / zoom}
      draggable
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

function SelectedLineEndpointHandles({
  visible,
  startHandleRef,
  endHandleRef,
  startEndpoint,
  endEndpoint,
  zoom,
  handleSize,
  onDragStart,
  onStartDragMove,
  onEndDragMove,
  onStartDragEnd,
  onEndDragEnd,
  onMouseEnter,
  onMouseLeave,
}: SelectedLineEndpointHandlesProps) {
  if (!visible) {
    return null;
  }

  return (
    <>
      <LineEndpointHandle
        circleRef={startHandleRef}
        x={startEndpoint.x}
        y={startEndpoint.y}
        zoom={zoom}
        handleSize={handleSize}
        onDragStart={onDragStart}
        onDragMove={onStartDragMove}
        onDragEnd={onStartDragEnd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
      <LineEndpointHandle
        circleRef={endHandleRef}
        x={endEndpoint.x}
        y={endEndpoint.y}
        zoom={zoom}
        handleSize={handleSize}
        onDragStart={onDragStart}
        onDragMove={onEndDragMove}
        onDragEnd={onEndDragEnd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </>
  );
}

export const LineShape: React.FC<LineShapeProps> = React.memo(({
  shape,
  isSelected,
  isDraggable,
  zoom,
  onClick,
  onSelect,
  onDragStart,
  onDragEnd,
  onEndpointDragEnd,
  takeSnapshot,
  commitSnapshot,
}) => {
  const cursorHandlers = useShapeCursor(isDraggable);
  // points[] = [startX, startY, endX, endY]
  // Memoize to prevent new array reference on every render when shape.points is undefined
  const points = useMemo(() => shape.points || [0, 0, 0, 0], [shape.points]);
  const strokeWidth = shape.strokeWidth || 2;
  const handleSize = Math.min(6, Math.max(4, strokeWidth * 0.2)) / zoom;

  // Refs
  const lineRef = useRef<Konva.Line>(null);
  const startHandleRef = useRef<Konva.Circle>(null);
  const endHandleRef = useRef<Konva.Circle>(null);

  // Smooth handle size transitions on zoom
  const handleStrokeWidth = 1.5 / zoom;
  useEffect(() => {
    animateEndpointHandle(startHandleRef, isSelected, handleSize, handleStrokeWidth);
    animateEndpointHandle(endHandleRef, isSelected, handleSize, handleStrokeWidth);
  }, [handleSize, handleStrokeWidth, isSelected]);

  // Line drag handlers
  const handleLineDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onDragStart(e);
  }, [onDragStart]);

  // Sync endpoint handles with line body during drag
  const handleLineDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const moveDx = e.target.x();
    const moveDy = e.target.y();
    positionEndpointHandle(startHandleRef, points[0] + moveDx, points[1] + moveDy);
    positionEndpointHandle(endHandleRef, points[2] + moveDx, points[3] + moveDy);
  }, [points]);

  const handleLineDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const dx = e.target.x();
    const dy = e.target.y();
    e.target.position({ x: 0, y: 0 });
    onDragEnd(e, getMovedLinePoints(points, dx, dy));
  }, [points, onDragEnd]);

  // Handle drag - moves 1:1, updates line in real-time
  const handleStartDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    updateLineEndpointDuringDrag(lineRef, points, 0, e.target.x(), e.target.y());
  }, [points]);

  const handleEndDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    updateLineEndpointDuringDrag(lineRef, points, 1, e.target.x(), e.target.y());
  }, [points]);

  const handleEndpointDragEnd = useCallback((endpointIndex: EndpointIndex, e: Konva.KonvaEventObject<DragEvent>) => {
    const newPoints = getDraggedEndpointPoints(points, endpointIndex, e.target.x(), e.target.y());
    onEndpointDragEnd(endpointIndex, newPoints);
    commitSnapshot();
  }, [points, onEndpointDragEnd, commitSnapshot]);

  const handleEndpointMouseEnter = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    setStageCursor(e, 'crosshair');
  }, []);

  const handleEndpointMouseLeave = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    setStageCursor(e, 'default');
  }, []);

  const hitStrokeWidth = Math.max((shape.strokeWidth || 2) * 3, 12);
  const startEndpoint = getEndpointCoordinates(points, 0);
  const endEndpoint = getEndpointCoordinates(points, 1);
  const showEndpointHandles = isSelected && isDraggable;

  return (
    <Group id={shape.id}>
      <Line
        ref={lineRef}
        points={points}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={hitStrokeWidth}
        draggable={isDraggable}
        onClick={onClick}
        onTap={onSelect}
        onDragStart={handleLineDragStart}
        onDragMove={handleLineDragMove}
        onDragEnd={handleLineDragEnd}
        {...cursorHandlers}
      />
      <SelectedLineEndpointHandles
        visible={showEndpointHandles}
        startHandleRef={startHandleRef}
        endHandleRef={endHandleRef}
        startEndpoint={startEndpoint}
        endEndpoint={endEndpoint}
        zoom={zoom}
        handleSize={handleSize}
        onDragStart={takeSnapshot}
        onStartDragMove={handleStartDragMove}
        onEndDragMove={handleEndDragMove}
        onStartDragEnd={(e) => handleEndpointDragEnd(0, e)}
        onEndDragEnd={(e) => handleEndpointDragEnd(1, e)}
        onMouseEnter={handleEndpointMouseEnter}
        onMouseLeave={handleEndpointMouseLeave}
      />
    </Group>
  );
});

LineShape.displayName = 'LineShape';
