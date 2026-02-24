import React from 'react';
import { Rect, Group } from 'react-konva';
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

/**
 * Artboard overlay - dashed outline with interactive resize handles.
 * Shown in select mode to let users resize the export bounds directly.
 *
 * Uses e.target.x()/y() (same pattern as CropOverlay) to avoid jitter
 * from pointer-vs-node position mismatch.
 */
export const ArtboardOverlay: React.FC<ArtboardOverlayProps> = ({
  bounds,
  zoom,
  onResizeStart,
  onResize,
  onResizeEnd,
}) => {
  const handleSize = CORNER_SIZE / zoom;
  const edgeHit = EDGE_HIT_SIZE / zoom;

  // Corner anchor: the inner corner of the handle square that touches
  // the artboard corner. We compute new bounds from this anchor point.
  const getCornerAnchor = (id: string, nx: number, ny: number) => {
    switch (id) {
      case 'tl': return { x: nx + handleSize, y: ny + handleSize };
      case 'tr': return { x: nx,              y: ny + handleSize };
      case 'bl': return { x: nx + handleSize, y: ny };
      case 'br': return { x: nx,              y: ny };
      default:   return { x: nx, y: ny };
    }
  };

  const computeCornerBounds = (id: string, ax: number, ay: number): ArtboardBounds => {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    switch (id) {
      case 'tl': return {
        x: Math.min(ax, right - MIN_SIZE),
        y: Math.min(ay, bottom - MIN_SIZE),
        width: Math.max(MIN_SIZE, right - ax),
        height: Math.max(MIN_SIZE, bottom - ay),
      };
      case 'tr': return {
        x: bounds.x,
        y: Math.min(ay, bottom - MIN_SIZE),
        width: Math.max(MIN_SIZE, ax - bounds.x),
        height: Math.max(MIN_SIZE, bottom - ay),
      };
      case 'bl': return {
        x: Math.min(ax, right - MIN_SIZE),
        y: bounds.y,
        width: Math.max(MIN_SIZE, right - ax),
        height: Math.max(MIN_SIZE, ay - bounds.y),
      };
      case 'br': return {
        x: bounds.x,
        y: bounds.y,
        width: Math.max(MIN_SIZE, ax - bounds.x),
        height: Math.max(MIN_SIZE, ay - bounds.y),
      };
      default: return bounds;
    }
  };

  // Edge handles: extract the edge position from the node position.
  // Edge rects are offset by -edgeHit/2, so the actual edge = node + edgeHit/2.
  const computeEdgeBounds = (id: string, nx: number, ny: number): ArtboardBounds => {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    switch (id) {
      case 't': { const ey = ny + edgeHit / 2; return { x: bounds.x, y: Math.min(ey, bottom - MIN_SIZE), width: bounds.width, height: Math.max(MIN_SIZE, bottom - ey) }; }
      case 'b': { const ey = ny + edgeHit / 2; return { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(MIN_SIZE, ey - bounds.y) }; }
      case 'l': { const ex = nx + edgeHit / 2; return { x: Math.min(ex, right - MIN_SIZE), y: bounds.y, width: Math.max(MIN_SIZE, right - ex), height: bounds.height }; }
      case 'r': { const ex = nx + edgeHit / 2; return { x: bounds.x, y: bounds.y, width: Math.max(MIN_SIZE, ex - bounds.x), height: bounds.height }; }
      default: return bounds;
    }
  };

  const corners = [
    { id: 'tl', x: bounds.x - handleSize, y: bounds.y - handleSize, cursor: 'nwse-resize' },
    { id: 'tr', x: bounds.x + bounds.width, y: bounds.y - handleSize, cursor: 'nesw-resize' },
    { id: 'bl', x: bounds.x - handleSize, y: bounds.y + bounds.height, cursor: 'nesw-resize' },
    { id: 'br', x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: 'nwse-resize' },
  ];

  const edges = [
    { id: 't', x: bounds.x, y: bounds.y - edgeHit / 2, w: bounds.width, h: edgeHit, cursor: 'ns-resize' },
    { id: 'b', x: bounds.x, y: bounds.y + bounds.height - edgeHit / 2, w: bounds.width, h: edgeHit, cursor: 'ns-resize' },
    { id: 'l', x: bounds.x - edgeHit / 2, y: bounds.y, w: edgeHit, h: bounds.height, cursor: 'ew-resize' },
    { id: 'r', x: bounds.x + bounds.width - edgeHit / 2, y: bounds.y, w: edgeHit, h: bounds.height, cursor: 'ew-resize' },
  ];

  const setCursor = (e: Konva.KonvaEventObject<MouseEvent>, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };

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

      {/* Edge hit areas (invisible, drag to resize) */}
      {edges.map(edge => (
        <Rect
          key={edge.id}
          x={edge.x}
          y={edge.y}
          width={edge.w}
          height={edge.h}
          fill="transparent"
          draggable
          onDragStart={(e) => {
            if (e.evt.button === 1) { e.target.stopDrag(); return; }
            onResizeStart();
          }}
          onDragMove={(e) => onResize(computeEdgeBounds(edge.id, e.target.x(), e.target.y()))}
          onDragEnd={(e) => {
            onResize(computeEdgeBounds(edge.id, e.target.x(), e.target.y()));
            onResizeEnd();
          }}
          onMouseEnter={(e) => setCursor(e, edge.cursor)}
          onMouseLeave={(e) => setCursor(e, 'default')}
        />
      ))}

      {/* Corner handles — squares sitting outside the artboard edges */}
      {corners.map(corner => (
        <Rect
          key={corner.id}
          x={corner.x}
          y={corner.y}
          width={handleSize}
          height={handleSize}
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth={1 / zoom}
          draggable
          onDragStart={(e) => {
            if (e.evt.button === 1) { e.target.stopDrag(); return; }
            onResizeStart();
          }}
          onDragMove={(e) => {
            const anchor = getCornerAnchor(corner.id, e.target.x(), e.target.y());
            onResize(computeCornerBounds(corner.id, anchor.x, anchor.y));
          }}
          onDragEnd={(e) => {
            const anchor = getCornerAnchor(corner.id, e.target.x(), e.target.y());
            onResize(computeCornerBounds(corner.id, anchor.x, anchor.y));
            onResizeEnd();
          }}
          onMouseEnter={(e) => setCursor(e, corner.cursor)}
          onMouseLeave={(e) => setCursor(e, 'default')}
        />
      ))}
    </Group>
  );
};
