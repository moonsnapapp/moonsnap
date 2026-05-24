import { memo, useCallback, useRef, useState } from 'react';
import type { CropConfig } from '../../types';

type DragType =
  | 'move'
  | 'resize-tl'
  | 'resize-tr'
  | 'resize-bl'
  | 'resize-br'
  | 'resize-t'
  | 'resize-b'
  | 'resize-l'
  | 'resize-r'
  | null;

export interface InlineCropOverlayProps {
  /** Current crop config (in video pixel space). */
  crop: CropConfig;
  /** Original (uncropped) video width in pixels. */
  videoWidth: number;
  /** Original (uncropped) video height in pixels. */
  videoHeight: number;
  /** Width of the displayed video frame (CSS pixels) the overlay fills. */
  displayWidth: number;
  /** Height of the displayed video frame (CSS pixels). */
  displayHeight: number;
  /** Called with the new crop on every drag update. */
  onCropChange: (crop: CropConfig) => void;
}

const MIN_CROP_SIZE = 50;

/**
 * Inline crop editor overlay rendered on top of the live video preview.
 *
 * Coordinates: drag handlers translate mouse movement from CSS pixels to
 * video pixel space via `videoWidth / displayWidth`. The crop rectangle
 * displays the current crop (in video pixels) scaled into display space.
 *
 * Updates fire on every rAF-coalesced mouse move so the rest of the app
 * (sidebar, export preview, output canvas) sees changes live.
 */
export const InlineCropOverlay = memo(function InlineCropOverlay({
  crop,
  videoWidth,
  videoHeight,
  displayWidth,
  displayHeight,
  onCropChange,
}: InlineCropOverlayProps) {
  const [dragType, setDragType] = useState<DragType>(null);
  const rafRef = useRef<number | null>(null);

  const scale = displayWidth > 0 ? displayWidth / videoWidth : 1;
  const cropLeft = crop.x * scale;
  const cropTop = crop.y * scale;
  const cropW = crop.width * scale;
  const cropH = crop.height * scale;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: Exclude<DragType, null>) => {
      e.preventDefault();
      e.stopPropagation();
      if (displayWidth <= 0 || displayHeight <= 0) return;

      setDragType(type);

      const startMouse = { x: e.clientX, y: e.clientY };
      const startCrop: CropConfig = { ...crop };
      const latest = { clientX: e.clientX, clientY: e.clientY };

      const processDrag = () => {
        const deltaX = (latest.clientX - startMouse.x) / scale;
        const deltaY = (latest.clientY - startMouse.y) / scale;

        const next: CropConfig = { ...startCrop };
        const rightEdge = startCrop.x + startCrop.width;
        const bottomEdge = startCrop.y + startCrop.height;

        switch (type) {
          case 'move':
            next.x = Math.round(
              Math.max(0, Math.min(videoWidth - startCrop.width, startCrop.x + deltaX))
            );
            next.y = Math.round(
              Math.max(0, Math.min(videoHeight - startCrop.height, startCrop.y + deltaY))
            );
            break;
          case 'resize-tl':
            next.x = Math.round(
              Math.max(0, Math.min(rightEdge - MIN_CROP_SIZE, startCrop.x + deltaX))
            );
            next.y = Math.round(
              Math.max(0, Math.min(bottomEdge - MIN_CROP_SIZE, startCrop.y + deltaY))
            );
            next.width = rightEdge - next.x;
            next.height = bottomEdge - next.y;
            break;
          case 'resize-tr':
            next.y = Math.round(
              Math.max(0, Math.min(bottomEdge - MIN_CROP_SIZE, startCrop.y + deltaY))
            );
            next.width = Math.round(
              Math.max(MIN_CROP_SIZE, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX))
            );
            next.height = bottomEdge - next.y;
            break;
          case 'resize-bl':
            next.x = Math.round(
              Math.max(0, Math.min(rightEdge - MIN_CROP_SIZE, startCrop.x + deltaX))
            );
            next.width = rightEdge - next.x;
            next.height = Math.round(
              Math.max(MIN_CROP_SIZE, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY))
            );
            break;
          case 'resize-br':
            next.width = Math.round(
              Math.max(MIN_CROP_SIZE, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX))
            );
            next.height = Math.round(
              Math.max(MIN_CROP_SIZE, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY))
            );
            break;
          case 'resize-t':
            next.y = Math.round(
              Math.max(0, Math.min(bottomEdge - MIN_CROP_SIZE, startCrop.y + deltaY))
            );
            next.height = bottomEdge - next.y;
            break;
          case 'resize-b':
            next.height = Math.round(
              Math.max(MIN_CROP_SIZE, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY))
            );
            break;
          case 'resize-l':
            next.x = Math.round(
              Math.max(0, Math.min(rightEdge - MIN_CROP_SIZE, startCrop.x + deltaX))
            );
            next.width = rightEdge - next.x;
            break;
          case 'resize-r':
            next.width = Math.round(
              Math.max(MIN_CROP_SIZE, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX))
            );
            break;
        }

        // Aspect-ratio lock — adjust the linked dimension and clamp to bounds.
        if (crop.lockAspectRatio && crop.aspectRatio) {
          const isVertical = type === 'resize-t' || type === 'resize-b';
          const isHorizontal = type === 'resize-l' || type === 'resize-r';

          if (isVertical) {
            next.width = Math.round(next.height * crop.aspectRatio);
          } else if (isHorizontal) {
            next.height = Math.round(next.width / crop.aspectRatio);
          } else if (type !== 'move') {
            next.height = Math.round(next.width / crop.aspectRatio);
          }

          if (next.x + next.width > videoWidth) {
            next.width = videoWidth - next.x;
            next.height = Math.round(next.width / crop.aspectRatio);
          }
          if (next.y + next.height > videoHeight) {
            next.height = videoHeight - next.y;
            next.width = Math.round(next.height * crop.aspectRatio);
          }
        }

        next.enabled = true;
        onCropChange(next);
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        latest.clientX = moveEvent.clientX;
        latest.clientY = moveEvent.clientY;
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          processDrag();
        });
      };

      const handleMouseUp = () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        processDrag();
        setDragType(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [crop, scale, videoWidth, videoHeight, displayWidth, displayHeight, onCropChange]
  );

  if (displayWidth <= 0 || displayHeight <= 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ width: displayWidth, height: displayHeight }}
    >
      {/* Dim outside the crop — four boxes for cheap rendering. */}
      <div
        className="absolute bg-black/55 pointer-events-none"
        style={{ left: 0, top: 0, right: 0, height: cropTop }}
      />
      <div
        className="absolute bg-black/55 pointer-events-none"
        style={{ left: 0, top: cropTop + cropH, right: 0, bottom: 0 }}
      />
      <div
        className="absolute bg-black/55 pointer-events-none"
        style={{ left: 0, top: cropTop, width: cropLeft, height: cropH }}
      />
      <div
        className="absolute bg-black/55 pointer-events-none"
        style={{ left: cropLeft + cropW, top: cropTop, right: 0, height: cropH }}
      />

      {/* Crop rect with handles. */}
      <div
        className="absolute border-2 border-white pointer-events-auto"
        style={{
          transform: `translate3d(${cropLeft}px, ${cropTop}px, 0)`,
          width: cropW,
          height: cropH,
          cursor: dragType === 'move' ? 'grabbing' : 'grab',
          willChange: dragType ? 'transform, width, height' : 'auto',
        }}
      >
        <div
          className="absolute inset-2 cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => handleMouseDown(e, 'move')}
        />

        {/* Corner handles — L-shaped SVG marks. */}
        <div
          className="absolute -left-0.5 -top-0.5 w-5 h-5 cursor-nwse-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-tl')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M2 2 H14 M2 2 V14" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>
        <div
          className="absolute -right-0.5 -top-0.5 w-5 h-5 cursor-nesw-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-tr')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M18 2 H6 M18 2 V14" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>
        <div
          className="absolute -left-0.5 -bottom-0.5 w-5 h-5 cursor-nesw-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-bl')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M2 18 H14 M2 18 V6" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>
        <div
          className="absolute -right-0.5 -bottom-0.5 w-5 h-5 cursor-nwse-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-br')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M18 18 H6 M18 18 V6" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>

        {/* Edge handles */}
        <div
          className="absolute top-1/2 -left-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-l')}
        />
        <div
          className="absolute top-1/2 -right-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-r')}
        />
        <div
          className="absolute left-1/2 -top-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-t')}
        />
        <div
          className="absolute left-1/2 -bottom-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-b')}
        />

        {dragType && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
          </div>
        )}

        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[11px] px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
          {crop.width} × {crop.height}
        </div>
      </div>
    </div>
  );
});
