/**
 * GifCropOverlay - draggable crop rectangle that sits on top of the
 * GIF editor's preview canvas. Coordinates are kept in *source* pixel
 * space; this component just maps pointer deltas through the canvas's
 * current display scale.
 *
 * The overlay uses `position: fixed` so it isn't clipped by any
 * `overflow: hidden` ancestors of the preview, and re-pulls the canvas
 * rect on every resize/scroll.
 */

import React, { useCallback, useEffect, useState, type CSSProperties } from 'react';

export type CropRect = { x: number; y: number; w: number; h: number };

type Handle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface Props {
  canvasEl: HTMLCanvasElement | null;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropRect;
  onChange: (next: CropRect) => void;
}

const HANDLE_SIZE = 12;
const MIN_CROP = 16;
const HANDLE_CURSORS: Record<Handle, string> = {
  move: 'move',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};
const CORNER_OFFSETS: Record<'nw' | 'ne' | 'sw' | 'se', CSSProperties> = {
  nw: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  ne: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
  sw: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 },
  se: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 },
};
const EDGE_OFFSETS: Record<'n' | 's' | 'e' | 'w', CSSProperties> = {
  n: { top: -HANDLE_SIZE / 2, left: '50%', marginLeft: -HANDLE_SIZE / 2 },
  s: { bottom: -HANDLE_SIZE / 2, left: '50%', marginLeft: -HANDLE_SIZE / 2 },
  w: { left: -HANDLE_SIZE / 2, top: '50%', marginTop: -HANDLE_SIZE / 2 },
  e: { right: -HANDLE_SIZE / 2, top: '50%', marginTop: -HANDLE_SIZE / 2 },
};

function cursorFor(handle: Handle): string {
  return HANDLE_CURSORS[handle];
}

function cornerStyle(corner: 'nw' | 'ne' | 'sw' | 'se'): CSSProperties {
  return {
    ...handleBaseStyle(corner),
    cursor: cursorFor(corner),
    ...CORNER_OFFSETS[corner],
  };
}

function edgeStyle(edge: 'n' | 's' | 'e' | 'w'): CSSProperties {
  return {
    ...handleBaseStyle(edge),
    cursor: cursorFor(edge),
    ...EDGE_OFFSETS[edge],
  };
}

function handleBaseStyle(handle: Handle): CSSProperties {
  return {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: 'white',
    border: '1px solid var(--accent-400)',
    borderRadius: 2,
    pointerEvents: 'auto',
    cursor: cursorFor(handle),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundCropRect(crop: CropRect): CropRect {
  return {
    x: Math.round(crop.x),
    y: Math.round(crop.y),
    w: Math.round(crop.w),
    h: Math.round(crop.h),
  };
}

function moveCropRect(
  crop: CropRect,
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number
): CropRect {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, sourceWidth - crop.w),
    y: clamp(crop.y + dy, 0, sourceHeight - crop.h),
  };
}

function resizeCropNorth(crop: CropRect, dy: number): CropRect {
  const y = clamp(crop.y + dy, 0, crop.y + crop.h - MIN_CROP);
  return {
    ...crop,
    y,
    h: crop.h - (y - crop.y),
  };
}

function resizeCropWest(crop: CropRect, dx: number): CropRect {
  const x = clamp(crop.x + dx, 0, crop.x + crop.w - MIN_CROP);
  return {
    ...crop,
    x,
    w: crop.w - (x - crop.x),
  };
}

function resizeCropSouth(crop: CropRect, dy: number, sourceHeight: number): CropRect {
  return {
    ...crop,
    h: clamp(crop.h + dy, MIN_CROP, sourceHeight - crop.y),
  };
}

function resizeCropEast(crop: CropRect, dx: number, sourceWidth: number): CropRect {
  return {
    ...crop,
    w: clamp(crop.w + dx, MIN_CROP, sourceWidth - crop.x),
  };
}

type CropResizeOperation = (crop: CropRect) => CropRect;
type CropResizeDirection = 'n' | 's' | 'w' | 'e';
type CropResizeOperationFactory = (
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number
) => CropResizeOperation;

const CROP_RESIZE_OPERATION_FACTORIES: Record<CropResizeDirection, CropResizeOperationFactory> = {
  n: (_dx, dy) => (crop) => resizeCropNorth(crop, dy),
  s: (_dx, dy, _sourceWidth, sourceHeight) => (crop) => resizeCropSouth(crop, dy, sourceHeight),
  w: (dx) => (crop) => resizeCropWest(crop, dx),
  e: (dx, _dy, sourceWidth) => (crop) => resizeCropEast(crop, dx, sourceWidth),
};

function getCropResizeOperations(
  handle: Exclude<Handle, 'move'>,
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number
): CropResizeOperation[] {
  return getCropResizeDirections(handle).map((direction) =>
    CROP_RESIZE_OPERATION_FACTORIES[direction](dx, dy, sourceWidth, sourceHeight)
  );
}

function getCropResizeDirections(handle: Exclude<Handle, 'move'>): CropResizeDirection[] {
  return (['n', 's', 'w', 'e'] as const).filter((direction) => handle.includes(direction));
}

function resizeCropRect(
  crop: CropRect,
  handle: Exclude<Handle, 'move'>,
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number
): CropRect {
  return getCropResizeOperations(handle, dx, dy, sourceWidth, sourceHeight)
    .reduce((next, operation) => operation(next), { ...crop });
}

function getNextCropRect(
  crop: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  sourceWidth: number,
  sourceHeight: number
): CropRect {
  if (handle === 'move') {
    return moveCropRect(crop, dx, dy, sourceWidth, sourceHeight);
  }

  return resizeCropRect(crop, handle, dx, dy, sourceWidth, sourceHeight);
}

export const GifCropOverlay: React.FC<Props> = ({
  canvasEl,
  sourceWidth,
  sourceHeight,
  crop,
  onChange,
}) => {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!canvasEl) return;
    const update = () => setRect(canvasEl.getBoundingClientRect());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvasEl);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [canvasEl]);

  const beginDrag = useCallback(
    (handle: Handle) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !rect) return;
      e.preventDefault();
      e.stopPropagation();
      const sx = rect.width / sourceWidth;
      const sy = rect.height / sourceHeight;
      const startX = e.clientX;
      const startY = e.clientY;
      const startCrop = { ...crop };

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / sx;
        const dy = (ev.clientY - startY) / sy;
        onChange(roundCropRect(getNextCropRect(
          startCrop,
          handle,
          dx,
          dy,
          sourceWidth,
          sourceHeight
        )));
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [rect, crop, onChange, sourceWidth, sourceHeight],
  );

  if (!rect) return null;

  const sx = rect.width / sourceWidth;
  const sy = rect.height / sourceHeight;
  const display = {
    left: crop.x * sx,
    top: crop.y * sy,
    width: crop.w * sx,
    height: crop.h * sy,
  };

  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    pointerEvents: 'none',
    zIndex: 30,
  };
  const dimStyle: CSSProperties = {
    position: 'absolute',
    background: 'rgba(0, 0, 0, 0.5)',
    pointerEvents: 'none',
  };

  return (
    <div style={containerStyle} aria-hidden>
      {/* Four dimming bands around the crop rect */}
      <div
        style={{ ...dimStyle, left: 0, top: 0, right: 0, height: display.top }}
      />
      <div
        style={{
          ...dimStyle,
          left: 0,
          top: display.top + display.height,
          right: 0,
          bottom: 0,
        }}
      />
      <div
        style={{
          ...dimStyle,
          left: 0,
          top: display.top,
          width: display.left,
          height: display.height,
        }}
      />
      <div
        style={{
          ...dimStyle,
          left: display.left + display.width,
          top: display.top,
          right: 0,
          height: display.height,
        }}
      />

      {/* The draggable crop rect */}
      <div
        style={{
          position: 'absolute',
          left: display.left,
          top: display.top,
          width: display.width,
          height: display.height,
          border: '2px solid var(--accent-400)',
          outline: '1px solid rgba(0, 0, 0, 0.4)',
          cursor: 'move',
          pointerEvents: 'auto',
        }}
        onPointerDown={beginDrag('move')}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
          <div
            key={c}
            style={cornerStyle(c)}
            onPointerDown={beginDrag(c)}
          />
        ))}
        {(['n', 's', 'e', 'w'] as const).map((edge) => (
          <div
            key={edge}
            style={edgeStyle(edge)}
            onPointerDown={beginDrag(edge)}
          />
        ))}
      </div>
    </div>
  );
};
