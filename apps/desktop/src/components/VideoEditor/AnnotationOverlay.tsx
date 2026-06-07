import { memo, useCallback, useEffect, useRef } from 'react';
import { ANNOTATIONS } from '@/constants';
import type { AnnotationSegment, AnnotationShape } from '@/types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import {
  getAnnotationArrowEndpoints,
  getAnnotationArrowRenderGeometry,
  getAnnotationArrowShaftOutline,
  getAnnotationArrowShapeUpdate,
  getAnnotationCornerRadius,
  getAnnotationRenderBox,
  getAnnotationStepRenderGeometry,
  getAnnotationStrokeWidth,
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

type AnnotationShapeUpdate = Partial<AnnotationShape>;

function getResizeGeometry(
  shape: AnnotationShape,
  mode: DragMode,
  deltaX: number,
  deltaY: number
) {
  switch (mode) {
    case 'resize-tl':
      return {
        x: shape.x + deltaX,
        y: shape.y + deltaY,
        width: shape.width - deltaX,
        height: shape.height - deltaY,
      };
    case 'resize-tr':
      return {
        x: shape.x,
        y: shape.y + deltaY,
        width: shape.width + deltaX,
        height: shape.height - deltaY,
      };
    case 'resize-bl':
      return {
        x: shape.x + deltaX,
        y: shape.y,
        width: shape.width - deltaX,
        height: shape.height + deltaY,
      };
    case 'resize-br':
      return {
        x: shape.x,
        y: shape.y,
        width: shape.width + deltaX,
        height: shape.height + deltaY,
      };
    default:
      return {
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      };
  }
}

function normalizeStepResizeGeometry(
  shape: AnnotationShape,
  mode: DragMode,
  geometry: { x: number; y: number; width: number; height: number }
) {
  if (
    shape.shapeType !== 'step' ||
    !['resize-tl', 'resize-tr', 'resize-bl', 'resize-br'].includes(mode)
  ) {
    return geometry;
  }

  const size = Math.max(geometry.width, geometry.height);
  const initialRight = shape.x + shape.width;
  const initialBottom = shape.y + shape.height;

  switch (mode) {
    case 'resize-tl':
      return { x: initialRight - size, y: initialBottom - size, width: size, height: size };
    case 'resize-tr':
      return { x: shape.x, y: initialBottom - size, width: size, height: size };
    case 'resize-bl':
      return { x: initialRight - size, y: shape.y, width: size, height: size };
    default:
      return { x: shape.x, y: shape.y, width: size, height: size };
  }
}

function getAnnotationDragUpdate(
  dragState: DragState,
  event: PointerEvent,
  previewWidth: number,
  previewHeight: number
): AnnotationShapeUpdate {
  const contentZoomScale = Math.max(dragState.zoomScale, 0.001);
  const deltaX = (event.clientX - dragState.startX) / (previewWidth * contentZoomScale);
  const deltaY = (event.clientY - dragState.startY) / (previewHeight * contentZoomScale);
  const shape = dragState.initialShape;
  const minSize = ANNOTATIONS.MIN_NORMALIZED_SIZE;

  if (dragState.mode === 'move' && isEndpointAnnotationShapeType(shape.shapeType)) {
    const endpoints = getAnnotationArrowEndpoints(shape);
    return getAnnotationArrowShapeUpdate(shape, {
      tailX: endpoints.tailX + deltaX,
      tailY: endpoints.tailY + deltaY,
      headX: endpoints.headX + deltaX,
      headY: endpoints.headY + deltaY,
    });
  }

  if (dragState.mode === 'move') {
    return {
      x: shape.x + deltaX,
      y: shape.y + deltaY,
      width: shape.width,
      height: shape.height,
    };
  }

  if (dragState.mode === 'arrow-start' || dragState.mode === 'arrow-end') {
    const endpoints = getAnnotationArrowEndpoints(shape);
    return getAnnotationArrowShapeUpdate(shape, dragState.mode === 'arrow-start'
      ? {
          tailX: endpoints.tailX + deltaX,
          tailY: endpoints.tailY + deltaY,
        }
      : {
          headX: endpoints.headX + deltaX,
          headY: endpoints.headY + deltaY,
        });
  }

  const resized = getResizeGeometry(shape, dragState.mode, deltaX, deltaY);
  const normalized = normalizeStepResizeGeometry(shape, dragState.mode, {
    ...resized,
    width: Math.max(minSize, resized.width),
    height: Math.max(minSize, resized.height),
  });

  return normalized;
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
  const box = getAnnotationRenderBox(shape, previewWidth, previewHeight);
  const strokeWidth = getAnnotationStrokeWidth(shape, previewHeight);
  const stepGeometry = getAnnotationStepRenderGeometry(box);
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
          x={box.left}
          y={box.top}
          width={box.width}
          height={box.height}
          rx={getAnnotationCornerRadius(box)}
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={strokeWidth}
          opacity={shape.opacity}
        />
      )}

      {shape.shapeType === 'ellipse' && (
        <ellipse
          cx={box.centerX}
          cy={box.centerY}
          rx={box.width / 2}
          ry={box.height / 2}
          fill={shape.fillColor}
          stroke={shape.strokeColor}
          strokeWidth={strokeWidth}
          opacity={shape.opacity}
        />
      )}

      {shape.shapeType === 'step' && (
        <>
          <circle
            cx={stepGeometry.centerX}
            cy={stepGeometry.centerY}
            r={stepGeometry.radius}
            fill={shape.fillColor}
            opacity={shape.opacity}
          />
          <text
            x={stepGeometry.centerX}
            y={stepGeometry.centerY}
            fill={ANNOTATIONS.DEFAULT_STEP_TEXT_COLOR}
            fontSize={stepGeometry.fontSize}
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
                  fill="var(--accent-400)"
                  stroke="#fff"
                  strokeWidth={1.5}
                  onPointerDown={(event) => onHandlePointerDown(event, segmentId, shape, handle.mode)}
                />
              ))}
            </>
          ) : (
            <>
              <rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                fill="none"
                stroke="var(--accent-400)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
              {[
                { cx: box.left, cy: box.top, mode: 'resize-tl' },
                { cx: box.left + box.width, cy: box.top, mode: 'resize-tr' },
                { cx: box.left, cy: box.top + box.height, mode: 'resize-bl' },
                { cx: box.left + box.width, cy: box.top + box.height, mode: 'resize-br' },
              ].map((handle) => (
                <circle
                  key={`${shape.id}_${handle.mode}`}
                  cx={handle.cx}
                  cy={handle.cy}
                  r={HANDLE_SIZE_PX / 2}
                  fill="var(--accent-400)"
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

      updateAnnotationShape(
        dragState.segmentId,
        dragState.shapeId,
        getAnnotationDragUpdate(dragState, event, previewWidth, previewHeight)
      );
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
