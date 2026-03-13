import { memo, useCallback, useEffect, useRef } from 'react';
import { ANNOTATIONS } from '@/constants';
import type { AnnotationSegment, AnnotationShape } from '@/types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import {
  getAnnotationArrowEndpoints,
  getAnnotationArrowRenderGeometry,
  getAnnotationArrowShaftOutline,
  getAnnotationArrowShapeUpdate,
  isEndpointAnnotationShapeType,
} from '@/utils/videoAnnotations';
import {
  selectSelectedAnnotationSegmentId,
  selectSelectedAnnotationShapeId,
  selectSelectAnnotationSegment,
  selectSelectAnnotationShape,
  selectUpdateAnnotationShape,
  selectBeginAnnotationDrag,
  selectCommitAnnotationDrag,
} from '@/stores/videoEditor/selectors';

interface AnnotationOverlayProps {
  segments: AnnotationSegment[];
  currentTimeMs: number;
  previewWidth: number;
  previewHeight: number;
  zoomScale?: number;
}

type DragMode =
  | 'move'
  | 'resize-tl'
  | 'resize-tr'
  | 'resize-bl'
  | 'resize-br'
  | 'arrow-start'
  | 'arrow-end';

interface DragState {
  segmentId: string;
  shapeId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  zoomScale: number;
  initialShape: AnnotationShape;
}

const HANDLE_SIZE_PX = 10;
const ARROW_HANDLE_SIZE_PX = 12;

function getScaledStrokeWidth(shape: AnnotationShape, previewHeight: number): number {
  return Math.max(1, shape.strokeWidth * (previewHeight / 1080));
}

function getScaledFontSize(shape: AnnotationShape, previewHeight: number): number {
  return Math.max(12, shape.fontSize * (previewHeight / 1080));
}

function AnnotationShapeNode({
  segmentId,
  shape,
  previewWidth,
  previewHeight,
  isSelected,
  onShapePointerDown,
  onHandlePointerDown,
}: {
  segmentId: string;
  shape: AnnotationShape;
  previewWidth: number;
  previewHeight: number;
  isSelected: boolean;
  onShapePointerDown: (event: React.PointerEvent<SVGElement>, segmentId: string, shape: AnnotationShape) => void;
  onHandlePointerDown: (
    event: React.PointerEvent<SVGCircleElement>,
    segmentId: string,
    shape: AnnotationShape,
    mode: DragMode
  ) => void;
}) {
  const left = shape.x * previewWidth;
  const top = shape.y * previewHeight;
  const width = shape.width * previewWidth;
  const height = shape.height * previewHeight;
  const strokeWidth = getScaledStrokeWidth(shape, previewHeight);
  const fontSize = getScaledFontSize(shape, previewHeight);
  const stepDiameter = Math.min(width, height);
  const stepRadius = stepDiameter / 2;
  const stepCenterX = left + width / 2;
  const stepCenterY = top + height / 2;
  const stepFontSize = Math.max(12, stepRadius * 0.93);
  const endpointGeometry = isEndpointAnnotationShapeType(shape.shapeType)
    ? getAnnotationArrowRenderGeometry(shape, previewWidth, previewHeight, strokeWidth)
    : null;
  const arrowShaftOutline = shape.shapeType === 'arrow' && endpointGeometry != null
    ? getAnnotationArrowShaftOutline(endpointGeometry, strokeWidth)
    : null;
  const showEndpointSelection = isSelected && endpointGeometry != null;

  return (
    <g
      onPointerDown={(event) => onShapePointerDown(event, segmentId, shape)}
      style={{ cursor: 'move' }}
    >
      {shape.shapeType === 'rectangle' && (
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          rx={Math.min(width, height) * 0.08}
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={strokeWidth}
          opacity={shape.opacity}
        />
      )}

      {shape.shapeType === 'ellipse' && (
        <ellipse
          cx={left + width / 2}
          cy={top + height / 2}
          rx={width / 2}
          ry={height / 2}
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={strokeWidth}
          opacity={shape.opacity}
        />
      )}

      {shape.shapeType === 'step' && (
        <>
          <circle
            cx={stepCenterX}
            cy={stepCenterY}
            r={stepRadius}
            fill={shape.fillColor}
            opacity={shape.opacity}
          />
          <text
            x={stepCenterX}
            y={stepCenterY}
            fill={ANNOTATIONS.DEFAULT_STEP_TEXT_COLOR}
            fontSize={stepFontSize}
            fontFamily={shape.fontFamily}
            fontWeight={Math.max(700, shape.fontWeight)}
            opacity={shape.opacity}
            textAnchor="middle"
            dominantBaseline="middle"
            pointerEvents="none"
          >
            {Math.max(1, Math.round(shape.number))}
          </text>
        </>
      )}

      {shape.shapeType === 'arrow' && endpointGeometry && arrowShaftOutline && (
        <>
          <path
            d={arrowShaftOutline.path}
            fill={shape.strokeColor}
            opacity={shape.opacity}
          />
          <polygon
            points={endpointGeometry.headPoints}
            fill={shape.strokeColor}
            opacity={shape.opacity}
          />
        </>
      )}

      {shape.shapeType === 'line' && endpointGeometry && (
        <line
          x1={endpointGeometry.tailX}
          y1={endpointGeometry.tailY}
          x2={endpointGeometry.headX}
          y2={endpointGeometry.headY}
          fill="none"
          stroke={shape.strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={shape.opacity}
        />
      )}

      {shape.shapeType === 'text' && (
        <text
          x={left + width / 2}
          y={top + height / 2}
          fill={shape.strokeColor}
          fontSize={fontSize}
          fontFamily={shape.fontFamily}
          fontWeight={shape.fontWeight}
          opacity={shape.opacity}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ paintOrder: 'stroke', stroke: 'rgba(15, 23, 42, 0.25)', strokeWidth: 1.5 }}
        >
          {(shape.text || ANNOTATIONS.DEFAULT_TEXT).split('\n').map((line: string, index: number, lines: string[]) => (
            <tspan
              key={`${shape.id}_${index}`}
              x={left + width / 2}
              dy={index === 0 ? `${((1 - lines.length) * 0.6).toFixed(2)}em` : '1.2em'}
            >
              {line}
            </tspan>
          ))}
        </text>
      )}

      {isSelected && (
        <>
          {showEndpointSelection ? (
            <>
              {[
                { cx: endpointGeometry.tailX, cy: endpointGeometry.tailY, mode: 'arrow-start' as const },
                { cx: endpointGeometry.headX, cy: endpointGeometry.headY, mode: 'arrow-end' as const },
              ].map((handle) => (
                <circle
                  key={`${shape.id}_${handle.mode}`}
                  cx={handle.cx}
                  cy={handle.cy}
                  r={ARROW_HANDLE_SIZE_PX / 2}
                  fill="var(--coral-400)"
                  stroke="#fff"
                  strokeWidth={1.5}
                  onPointerDown={(event) => onHandlePointerDown(event, segmentId, shape, handle.mode)}
                />
              ))}
            </>
          ) : (
            <>
              <rect
                x={left}
                y={top}
                width={width}
                height={height}
                fill="none"
                stroke="var(--coral-400)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
              {[
                { cx: left, cy: top, mode: 'resize-tl' },
                { cx: left + width, cy: top, mode: 'resize-tr' },
                { cx: left, cy: top + height, mode: 'resize-bl' },
                { cx: left + width, cy: top + height, mode: 'resize-br' },
              ].map((handle) => (
                <circle
                  key={`${shape.id}_${handle.mode}`}
                  cx={handle.cx}
                  cy={handle.cy}
                  r={HANDLE_SIZE_PX / 2}
                  fill="var(--coral-400)"
                  stroke="#fff"
                  strokeWidth={1.5}
                  onPointerDown={(event) => onHandlePointerDown(event, segmentId, shape, handle.mode as DragMode)}
                />
              ))}
            </>
          )}
        </>
      )}
    </g>
  );
}

export const AnnotationOverlay = memo(function AnnotationOverlay({
  segments,
  currentTimeMs,
  previewWidth,
  previewHeight,
  zoomScale = 1,
}: AnnotationOverlayProps) {
  const selectedAnnotationSegmentId = useVideoEditorStore(selectSelectedAnnotationSegmentId);
  const selectedAnnotationShapeId = useVideoEditorStore(selectSelectedAnnotationShapeId);
  const selectAnnotationSegment = useVideoEditorStore(selectSelectAnnotationSegment);
  const selectAnnotationShape = useVideoEditorStore(selectSelectAnnotationShape);
  const updateAnnotationShape = useVideoEditorStore(selectUpdateAnnotationShape);
  const beginAnnotationDrag = useVideoEditorStore(selectBeginAnnotationDrag);
  const commitAnnotationDrag = useVideoEditorStore(selectCommitAnnotationDrag);
  const dragStateRef = useRef<DragState | null>(null);

  const activeSegments = segments.filter(
    (segment) => segment.enabled && currentTimeMs >= segment.startMs && currentTimeMs <= segment.endMs
  );

  const finishDrag = useCallback(() => {
    if (dragStateRef.current) {
      commitAnnotationDrag();
    }
    dragStateRef.current = null;
    document.body.style.cursor = '';
  }, [commitAnnotationDrag]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || previewWidth <= 0 || previewHeight <= 0) {
        return;
      }

      const contentZoomScale = Math.max(dragState.zoomScale, 0.001);
      const deltaX = (event.clientX - dragState.startX) / (previewWidth * contentZoomScale);
      const deltaY = (event.clientY - dragState.startY) / (previewHeight * contentZoomScale);
      const minSize = ANNOTATIONS.MIN_NORMALIZED_SIZE;

      let nextX = dragState.initialShape.x;
      let nextY = dragState.initialShape.y;
      let nextWidth = dragState.initialShape.width;
      let nextHeight = dragState.initialShape.height;
      let arrowUpdates:
        | ReturnType<typeof getAnnotationArrowShapeUpdate>
        | null = null;

      if (dragState.mode === 'move') {
        if (isEndpointAnnotationShapeType(dragState.initialShape.shapeType)) {
          const endpoints = getAnnotationArrowEndpoints(dragState.initialShape);
          arrowUpdates = getAnnotationArrowShapeUpdate(dragState.initialShape, {
            tailX: endpoints.tailX + deltaX,
            tailY: endpoints.tailY + deltaY,
            headX: endpoints.headX + deltaX,
            headY: endpoints.headY + deltaY,
          });
          nextX = arrowUpdates.x;
          nextY = arrowUpdates.y;
          nextWidth = arrowUpdates.width;
          nextHeight = arrowUpdates.height;
        } else {
          nextX = dragState.initialShape.x + deltaX;
          nextY = dragState.initialShape.y + deltaY;
        }
      } else if (dragState.mode === 'arrow-start' || dragState.mode === 'arrow-end') {
        const endpoints = getAnnotationArrowEndpoints(dragState.initialShape);
        arrowUpdates = getAnnotationArrowShapeUpdate(dragState.initialShape, dragState.mode === 'arrow-start'
          ? {
              tailX: endpoints.tailX + deltaX,
              tailY: endpoints.tailY + deltaY,
            }
          : {
              headX: endpoints.headX + deltaX,
              headY: endpoints.headY + deltaY,
            });
        nextX = arrowUpdates.x;
        nextY = arrowUpdates.y;
        nextWidth = arrowUpdates.width;
        nextHeight = arrowUpdates.height;
      } else if (dragState.mode === 'resize-tl') {
        nextX = dragState.initialShape.x + deltaX;
        nextY = dragState.initialShape.y + deltaY;
        nextWidth = dragState.initialShape.width - deltaX;
        nextHeight = dragState.initialShape.height - deltaY;
      } else if (dragState.mode === 'resize-tr') {
        nextY = dragState.initialShape.y + deltaY;
        nextWidth = dragState.initialShape.width + deltaX;
        nextHeight = dragState.initialShape.height - deltaY;
      } else if (dragState.mode === 'resize-bl') {
        nextX = dragState.initialShape.x + deltaX;
        nextWidth = dragState.initialShape.width - deltaX;
        nextHeight = dragState.initialShape.height + deltaY;
      } else if (dragState.mode === 'resize-br') {
        nextWidth = dragState.initialShape.width + deltaX;
        nextHeight = dragState.initialShape.height + deltaY;
      }

      nextWidth = Math.max(minSize, nextWidth);
      nextHeight = Math.max(minSize, nextHeight);

      if (
        dragState.initialShape.shapeType === 'step' &&
        (dragState.mode === 'resize-tl' ||
          dragState.mode === 'resize-tr' ||
          dragState.mode === 'resize-bl' ||
          dragState.mode === 'resize-br')
      ) {
        const size = Math.max(nextWidth, nextHeight);
        const initialRight = dragState.initialShape.x + dragState.initialShape.width;
        const initialBottom = dragState.initialShape.y + dragState.initialShape.height;

        nextWidth = size;
        nextHeight = size;

        if (dragState.mode === 'resize-tl') {
          nextX = initialRight - size;
          nextY = initialBottom - size;
        } else if (dragState.mode === 'resize-tr') {
          nextX = dragState.initialShape.x;
          nextY = initialBottom - size;
        } else if (dragState.mode === 'resize-bl') {
          nextX = initialRight - size;
          nextY = dragState.initialShape.y;
        } else {
          nextX = dragState.initialShape.x;
          nextY = dragState.initialShape.y;
        }
      }

      updateAnnotationShape(dragState.segmentId, dragState.shapeId, {
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
        ...(arrowUpdates ?? {}),
      });
    };

    const handlePointerUp = () => {
      finishDrag();
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [finishDrag, previewHeight, previewWidth, updateAnnotationShape]);

  const handleShapePointerDown = useCallback((
    event: React.PointerEvent<SVGElement>,
    segmentId: string,
    shape: AnnotationShape
  ) => {
    event.preventDefault();
    event.stopPropagation();
    selectAnnotationSegment(segmentId, shape.id);
    beginAnnotationDrag();
    dragStateRef.current = {
      segmentId,
      shapeId: shape.id,
      mode: 'move',
      startX: event.clientX,
      startY: event.clientY,
      zoomScale,
      initialShape: shape,
    };
    document.body.style.cursor = 'grabbing';
  }, [selectAnnotationSegment, beginAnnotationDrag, zoomScale]);

  const handleHandlePointerDown = useCallback((
    event: React.PointerEvent<SVGCircleElement>,
    segmentId: string,
    shape: AnnotationShape,
    mode: DragMode
  ) => {
    event.preventDefault();
    event.stopPropagation();
    selectAnnotationSegment(segmentId, shape.id);
    beginAnnotationDrag();
    dragStateRef.current = {
      segmentId,
      shapeId: shape.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      zoomScale,
      initialShape: shape,
    };
    document.body.style.cursor =
      mode === 'arrow-start' || mode === 'arrow-end' ? 'grab' : 'nwse-resize';
  }, [selectAnnotationSegment, beginAnnotationDrag, zoomScale]);

  const handleBackgroundPointerDown = useCallback(() => {
    selectAnnotationShape(null);
    if (selectedAnnotationSegmentId && !activeSegments.some((segment) => segment.id === selectedAnnotationSegmentId)) {
      selectAnnotationSegment(null);
    }
  }, [activeSegments, selectAnnotationSegment, selectAnnotationShape, selectedAnnotationSegmentId]);

  if (activeSegments.length === 0 || previewWidth <= 0 || previewHeight <= 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-auto">
      <svg
        width={previewWidth}
        height={previewHeight}
        viewBox={`0 0 ${previewWidth} ${previewHeight}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        onPointerDown={handleBackgroundPointerDown}
      >
        {activeSegments.map((segment) =>
          segment.shapes.map((shape: AnnotationShape) => (
            <AnnotationShapeNode
              key={shape.id}
              segmentId={segment.id}
              shape={shape}
              previewWidth={previewWidth}
              previewHeight={previewHeight}
              isSelected={
                segment.id === selectedAnnotationSegmentId &&
                shape.id === selectedAnnotationShapeId
              }
              onShapePointerDown={handleShapePointerDown}
              onHandlePointerDown={handleHandlePointerDown}
            />
          ))
        )}
      </svg>
    </div>
  );
});
