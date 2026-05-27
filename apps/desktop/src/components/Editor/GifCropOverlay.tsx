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

function cursorFor(handle: Handle): string {
  switch (handle) {
    case 'move':
      return 'move';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
  }
}

function cornerStyle(corner: 'nw' | 'ne' | 'sw' | 'se'): CSSProperties {
  const half = HANDLE_SIZE / 2;
  return {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: 'white',
    border: '1px solid var(--accent-400)',
    borderRadius: 2,
    pointerEvents: 'auto',
    cursor: cursorFor(corner),
    top: corner.startsWith('n') ? -half : undefined,
    bottom: corner.startsWith('s') ? -half : undefined,
    left: corner.endsWith('w') ? -half : undefined,
    right: corner.endsWith('e') ? -half : undefined,
  };
}

function edgeStyle(edge: 'n' | 's' | 'e' | 'w'): CSSProperties {
  const half = HANDLE_SIZE / 2;
  const base: CSSProperties = {
    position: 'absolute',
    background: 'white',
    border: '1px solid var(--accent-400)',
    borderRadius: 2,
    pointerEvents: 'auto',
    cursor: cursorFor(edge),
  };
  switch (edge) {
    case 'n':
      return {
        ...base,
        top: -half,
        left: '50%',
        marginLeft: -half,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
      };
    case 's':
      return {
        ...base,
        bottom: -half,
        left: '50%',
        marginLeft: -half,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
      };
    case 'w':
      return {
        ...base,
        left: -half,
        top: '50%',
        marginTop: -half,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
      };
    case 'e':
      return {
        ...base,
        right: -half,
        top: '50%',
        marginTop: -half,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
      };
  }
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
        const next: CropRect = { ...startCrop };

        if (handle === 'move') {
          next.x = Math.max(
            0,
            Math.min(sourceWidth - startCrop.w, startCrop.x + dx),
          );
          next.y = Math.max(
            0,
            Math.min(sourceHeight - startCrop.h, startCrop.y + dy),
          );
        } else {
          if (handle.startsWith('n')) {
            const newY = Math.max(
              0,
              Math.min(startCrop.y + startCrop.h - MIN_CROP, startCrop.y + dy),
            );
            next.h = startCrop.h - (newY - startCrop.y);
            next.y = newY;
          }
          if (handle.startsWith('s')) {
            next.h = Math.max(
              MIN_CROP,
              Math.min(sourceHeight - startCrop.y, startCrop.h + dy),
            );
          }
          if (handle.endsWith('w')) {
            const newX = Math.max(
              0,
              Math.min(startCrop.x + startCrop.w - MIN_CROP, startCrop.x + dx),
            );
            next.w = startCrop.w - (newX - startCrop.x);
            next.x = newX;
          }
          if (handle.endsWith('e')) {
            next.w = Math.max(
              MIN_CROP,
              Math.min(sourceWidth - startCrop.x, startCrop.w + dx),
            );
          }
        }

        onChange({
          x: Math.round(next.x),
          y: Math.round(next.y),
          w: Math.round(next.w),
          h: Math.round(next.h),
        });
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
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.4)',
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
