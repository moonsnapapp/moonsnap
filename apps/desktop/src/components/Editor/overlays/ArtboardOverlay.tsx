import React, { useRef } from 'react';
import { Rect, Circle, Group } from 'react-konva';
import type Konva from 'konva';

interface ArtboardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ArtboardOverlayProps {
  bounds: ArtboardBounds;
  zoom: number;
  onResizeStart: () => void;
  onResize: (bounds: ArtboardBounds) => void;
  onResizeEnd: () => void;
}

const CORNER_SIZE = 8;
const EDGE_HIT_SIZE = 10;
const MIN_SIZE = 20;

/** Convert stage pointer to canvas coordinates */
function getCanvasPointer(e: Konva.KonvaEventObject<DragEvent>): { x: number; y: number } | null {
  const stage = e.target.getStage();
  const pointer = stage?.getPointerPosition();
  if (!pointer || !stage) return null;
  return {
    x: (pointer.x - stage.x()) / stage.scaleX(),
    y: (pointer.y - stage.y()) / stage.scaleY(),
  };
}

/**
 * Artboard overlay - dashed outline with interactive resize handles.
 * Shown in select mode to let users resize the export bounds directly.
 */
export const ArtboardOverlay: React.FC<ArtboardOverlayProps> = ({
  bounds,
  zoom,
  onResizeStart,
  onResize,
  onResizeEnd,
}) => {
  const cornerRadius = CORNER_SIZE / 2 / zoom;
  const edgeHit = EDGE_HIT_SIZE / zoom;
  const startRef = useRef<ArtboardBounds | null>(null);

  // Compute new bounds from a handle drag
  const computeBounds = (handleId: string, px: number, py: number): ArtboardBounds => {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;

    switch (handleId) {
      case 'tl': return {
        x: Math.min(px, right - MIN_SIZE),
        y: Math.min(py, bottom - MIN_SIZE),
        width: Math.max(MIN_SIZE, right - px),
        height: Math.max(MIN_SIZE, bottom - py),
      };
      case 'tr': return {
        x: bounds.x,
        y: Math.min(py, bottom - MIN_SIZE),
        width: Math.max(MIN_SIZE, px - bounds.x),
        height: Math.max(MIN_SIZE, bottom - py),
      };
      case 'bl': return {
        x: Math.min(px, right - MIN_SIZE),
        y: bounds.y,
        width: Math.max(MIN_SIZE, right - px),
        height: Math.max(MIN_SIZE, py - bounds.y),
      };
      case 'br': return {
        x: bounds.x,
        y: bounds.y,
        width: Math.max(MIN_SIZE, px - bounds.x),
        height: Math.max(MIN_SIZE, py - bounds.y),
      };
      case 't': return {
        x: bounds.x,
        y: Math.min(py, bottom - MIN_SIZE),
        width: bounds.width,
        height: Math.max(MIN_SIZE, bottom - py),
      };
      case 'b': return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: Math.max(MIN_SIZE, py - bounds.y),
      };
      case 'l': return {
        x: Math.min(px, right - MIN_SIZE),
        y: bounds.y,
        width: Math.max(MIN_SIZE, right - px),
        height: bounds.height,
      };
      case 'r': return {
        x: bounds.x,
        y: bounds.y,
        width: Math.max(MIN_SIZE, px - bounds.x),
        height: bounds.height,
      };
      default: return bounds;
    }
  };

  const onHandleDragStart = (_handleId: string, e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.evt.button === 1) { e.target.stopDrag(); return; }
    startRef.current = { ...bounds };
    onResizeStart();
  };

  const onHandleDragMove = (handleId: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const pos = getCanvasPointer(e);
    if (!pos || !startRef.current) return;
    onResize(computeBounds(handleId, pos.x, pos.y));
  };

  const onHandleDragEnd = (_handleId: string, _e: Konva.KonvaEventObject<DragEvent>) => {
    startRef.current = null;
    onResizeEnd();
  };

  // Corner positions
  const corners = [
    { id: 'tl', x: bounds.x, y: bounds.y, cursor: 'nwse-resize' },
    { id: 'tr', x: bounds.x + bounds.width, y: bounds.y, cursor: 'nesw-resize' },
    { id: 'bl', x: bounds.x, y: bounds.y + bounds.height, cursor: 'nesw-resize' },
    { id: 'br', x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: 'nwse-resize' },
  ];

  // Edge hit areas (invisible, larger hit targets along each edge)
  const edges = [
    { id: 't', x: bounds.x, y: bounds.y - edgeHit / 2, w: bounds.width, h: edgeHit, cursor: 'ns-resize' },
    { id: 'b', x: bounds.x, y: bounds.y + bounds.height - edgeHit / 2, w: bounds.width, h: edgeHit, cursor: 'ns-resize' },
    { id: 'l', x: bounds.x - edgeHit / 2, y: bounds.y, w: edgeHit, h: bounds.height, cursor: 'ew-resize' },
    { id: 'r', x: bounds.x + bounds.width - edgeHit / 2, y: bounds.y, w: edgeHit, h: bounds.height, cursor: 'ew-resize' },
  ];

  return (
    <Group name="editor-gizmo">
      {/* Dashed outline */}
      <Rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        stroke="#94a3b8"
        strokeWidth={1 / zoom}
        dash={[6 / zoom, 4 / zoom]}
        listening={false}
        opacity={0.7}
      />

      {/* Edge hit areas */}
      {edges.map(edge => (
        <Rect
          key={edge.id}
          x={edge.x}
          y={edge.y}
          width={edge.w}
          height={edge.h}
          fill="transparent"
          draggable
          onDragStart={(e) => onHandleDragStart(edge.id, e)}
          onDragMove={(e) => onHandleDragMove(edge.id, e)}
          onDragEnd={(e) => onHandleDragEnd(edge.id, e)}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = edge.cursor;
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = 'default';
          }}
        />
      ))}

      {/* Corner handles */}
      {corners.map(corner => (
        <Circle
          key={corner.id}
          x={corner.x}
          y={corner.y}
          radius={cornerRadius}
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth={1 / zoom}
          draggable
          onDragStart={(e) => onHandleDragStart(corner.id, e)}
          onDragMove={(e) => onHandleDragMove(corner.id, e)}
          onDragEnd={(e) => onHandleDragEnd(corner.id, e)}
          onMouseEnter={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = corner.cursor;
          }}
          onMouseLeave={(e) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = 'default';
          }}
        />
      ))}
    </Group>
  );
};
