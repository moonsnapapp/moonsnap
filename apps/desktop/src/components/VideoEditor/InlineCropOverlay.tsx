import { memo, useCallback, useRef, useState } from 'react';
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
} from 'react';
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
type ActiveDragType = Exclude<DragType, null>;

interface CropDisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type CropMouseDownHandler = (e: ReactMouseEvent, type: ActiveDragType) => void;

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
const VERTICAL_RESIZE_TYPES = new Set<DragType>(['resize-t', 'resize-b']);
const DIMMER_CLASS = 'absolute bg-black/55 pointer-events-none';

const CORNER_HANDLES = [
  {
    type: 'resize-tl',
    className: 'absolute -left-0.5 -top-0.5 w-5 h-5 cursor-nwse-resize',
    path: 'M2 2 H14 M2 2 V14',
  },
  {
    type: 'resize-tr',
    className: 'absolute -right-0.5 -top-0.5 w-5 h-5 cursor-nesw-resize',
    path: 'M18 2 H6 M18 2 V14',
  },
  {
    type: 'resize-bl',
    className: 'absolute -left-0.5 -bottom-0.5 w-5 h-5 cursor-nesw-resize',
    path: 'M2 18 H14 M2 18 V6',
  },
  {
    type: 'resize-br',
    className: 'absolute -right-0.5 -bottom-0.5 w-5 h-5 cursor-nwse-resize',
    path: 'M18 18 H6 M18 18 V6',
  },
] as const satisfies Array<{
  type: ActiveDragType;
  className: string;
  path: string;
}>;

const EDGE_HANDLES = [
  {
    type: 'resize-l',
    className:
      'absolute top-1/2 -left-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize',
  },
  {
    type: 'resize-r',
    className:
      'absolute top-1/2 -right-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize',
  },
  {
    type: 'resize-t',
    className:
      'absolute left-1/2 -top-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize',
  },
  {
    type: 'resize-b',
    className:
      'absolute left-1/2 -bottom-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize',
  },
] as const satisfies Array<{
  type: ActiveDragType;
  className: string;
}>;

const CROP_GRID_LINE_CLASSES = [
  'absolute left-1/3 top-0 bottom-0 w-px bg-white/40',
  'absolute left-2/3 top-0 bottom-0 w-px bg-white/40',
  'absolute top-1/3 left-0 right-0 h-px bg-white/40',
  'absolute top-2/3 left-0 right-0 h-px bg-white/40',
];

function clampRound(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function resizesLeft(type: DragType): boolean {
  return type === 'resize-tl' || type === 'resize-bl' || type === 'resize-l';
}

function resizesRight(type: DragType): boolean {
  return type === 'resize-tr' || type === 'resize-br' || type === 'resize-r';
}

function resizesTop(type: DragType): boolean {
  return type === 'resize-tl' || type === 'resize-tr' || type === 'resize-t';
}

function resizesBottom(type: DragType): boolean {
  return type === 'resize-bl' || type === 'resize-br' || type === 'resize-b';
}

function moveCrop({
  startCrop,
  deltaX,
  deltaY,
  videoWidth,
  videoHeight,
}: {
  startCrop: CropConfig;
  deltaX: number;
  deltaY: number;
  videoWidth: number;
  videoHeight: number;
}): CropConfig {
  return {
    ...startCrop,
    x: clampRound(startCrop.x + deltaX, 0, videoWidth - startCrop.width),
    y: clampRound(startCrop.y + deltaY, 0, videoHeight - startCrop.height),
  };
}

function getResizedLeft(type: DragType, startCrop: CropConfig, deltaX: number, rightEdge: number): number {
  return resizesLeft(type)
    ? clampRound(startCrop.x + deltaX, 0, rightEdge - MIN_CROP_SIZE)
    : startCrop.x;
}

function getResizedTop(type: DragType, startCrop: CropConfig, deltaY: number, bottomEdge: number): number {
  return resizesTop(type)
    ? clampRound(startCrop.y + deltaY, 0, bottomEdge - MIN_CROP_SIZE)
    : startCrop.y;
}

function getResizedRight(
  type: DragType,
  startCrop: CropConfig,
  deltaX: number,
  videoWidth: number,
  rightEdge: number
): number {
  return resizesRight(type)
    ? startCrop.x + clampRound(startCrop.width + deltaX, MIN_CROP_SIZE, videoWidth - startCrop.x)
    : rightEdge;
}

function getResizedBottom(
  type: DragType,
  startCrop: CropConfig,
  deltaY: number,
  videoHeight: number,
  bottomEdge: number
): number {
  return resizesBottom(type)
    ? startCrop.y + clampRound(startCrop.height + deltaY, MIN_CROP_SIZE, videoHeight - startCrop.y)
    : bottomEdge;
}

function resizeCropWithoutAspectLock({
  type,
  startCrop,
  deltaX,
  deltaY,
  videoWidth,
  videoHeight,
}: {
  type: Exclude<DragType, null>;
  startCrop: CropConfig;
  deltaX: number;
  deltaY: number;
  videoWidth: number;
  videoHeight: number;
}) {
  const rightEdge = startCrop.x + startCrop.width;
  const bottomEdge = startCrop.y + startCrop.height;

  if (type === 'move') {
    return moveCrop({ startCrop, deltaX, deltaY, videoWidth, videoHeight });
  }

  const left = getResizedLeft(type, startCrop, deltaX, rightEdge);
  const top = getResizedTop(type, startCrop, deltaY, bottomEdge);
  const right = getResizedRight(type, startCrop, deltaX, videoWidth, rightEdge);
  const bottom = getResizedBottom(type, startCrop, deltaY, videoHeight, bottomEdge);

  return {
    ...startCrop,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function applyPrimaryAspectDimension(
  next: CropConfig,
  type: Exclude<DragType, null>,
  aspectRatio: number
) {
  if (type === 'move') return;

  if (VERTICAL_RESIZE_TYPES.has(type)) {
    next.width = Math.round(next.height * aspectRatio);
    return;
  }

  next.height = Math.round(next.width / aspectRatio);
}

function clampAspectWidthToVideo(
  next: CropConfig,
  aspectRatio: number,
  videoWidth: number
) {
  if (next.x + next.width <= videoWidth) return;

  next.width = videoWidth - next.x;
  next.height = Math.round(next.width / aspectRatio);
}

function clampAspectHeightToVideo(
  next: CropConfig,
  aspectRatio: number,
  videoHeight: number
) {
  if (next.y + next.height <= videoHeight) return;

  next.height = videoHeight - next.y;
  next.width = Math.round(next.height * aspectRatio);
}

function applyAspectRatioLock({
  next,
  type,
  aspectRatio,
  videoWidth,
  videoHeight,
}: {
  next: CropConfig;
  type: Exclude<DragType, null>;
  aspectRatio: number | null | undefined;
  videoWidth: number;
  videoHeight: number;
}) {
  if (!aspectRatio) return next;

  applyPrimaryAspectDimension(next, type, aspectRatio);
  clampAspectWidthToVideo(next, aspectRatio, videoWidth);
  clampAspectHeightToVideo(next, aspectRatio, videoHeight);

  return next;
}

function getDraggedCrop({
  type,
  startCrop,
  deltaX,
  deltaY,
  videoWidth,
  videoHeight,
}: {
  type: Exclude<DragType, null>;
  startCrop: CropConfig;
  deltaX: number;
  deltaY: number;
  videoWidth: number;
  videoHeight: number;
}) {
  const next = resizeCropWithoutAspectLock({
    type,
    startCrop,
    deltaX,
    deltaY,
    videoWidth,
    videoHeight,
  });

  if (startCrop.lockAspectRatio) {
    applyAspectRatioLock({
      next,
      type,
      aspectRatio: startCrop.aspectRatio,
      videoWidth,
      videoHeight,
    });
  }

  next.enabled = true;
  return next;
}

function getCropDisplayRect(crop: CropConfig, scale: number): CropDisplayRect {
  return {
    left: crop.x * scale,
    top: crop.y * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  };
}

function getVideoDisplayScale(displayWidth: number, videoWidth: number) {
  return displayWidth > 0 ? displayWidth / videoWidth : 1;
}

function hasCropDisplayArea(displayWidth: number, displayHeight: number) {
  return displayWidth > 0 && displayHeight > 0;
}

function getCropRectStyle(rect: CropDisplayRect, dragType: DragType): CSSProperties {
  return {
    transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
    width: rect.width,
    height: rect.height,
    cursor: dragType === 'move' ? 'grabbing' : 'grab',
    willChange: dragType ? 'transform, width, height' : 'auto',
  };
}

function getDimmerStyles({
  left,
  top,
  width,
  height,
}: CropDisplayRect): CSSProperties[] {
  return [
    { left: 0, top: 0, right: 0, height: top },
    { left: 0, top: top + height, right: 0, bottom: 0 },
    { left: 0, top, width: left, height },
    { left: left + width, top, right: 0, height },
  ];
}

function CropDimmers({ rect }: { rect: CropDisplayRect }) {
  return (
    <>
      {getDimmerStyles(rect).map((style, index) => (
        <div key={index} className={DIMMER_CLASS} style={style} />
      ))}
    </>
  );
}

function CropCornerHandles({ onMouseDown }: { onMouseDown: CropMouseDownHandler }) {
  return (
    <>
      {CORNER_HANDLES.map(({ type, className, path }) => (
        <div key={type} className={className} onMouseDown={(e) => onMouseDown(e, type)}>
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path
              d={path}
              stroke="white"
              strokeWidth="3"
              strokeLinecap="square"
              fill="none"
            />
          </svg>
        </div>
      ))}
    </>
  );
}

function CropEdgeHandles({ onMouseDown }: { onMouseDown: CropMouseDownHandler }) {
  return (
    <>
      {EDGE_HANDLES.map(({ type, className }) => (
        <div key={type} className={className} onMouseDown={(e) => onMouseDown(e, type)} />
      ))}
    </>
  );
}

function CropGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {CROP_GRID_LINE_CLASSES.map((className) => (
        <div key={className} className={className} />
      ))}
    </div>
  );
}

function clearPendingCropDragFrame(rafRef: MutableRefObject<number | null>) {
  if (rafRef.current === null) return;

  cancelAnimationFrame(rafRef.current);
  rafRef.current = null;
}

function startCropDragSession({
  event,
  type,
  crop,
  scale,
  videoWidth,
  videoHeight,
  rafRef,
  onCropChange,
  onDragEnd,
}: {
  event: ReactMouseEvent;
  type: ActiveDragType;
  crop: CropConfig;
  scale: number;
  videoWidth: number;
  videoHeight: number;
  rafRef: MutableRefObject<number | null>;
  onCropChange: (crop: CropConfig) => void;
  onDragEnd: () => void;
}) {
  const startMouse = { x: event.clientX, y: event.clientY };
  const startCrop: CropConfig = { ...crop };
  const latest = { clientX: event.clientX, clientY: event.clientY };

  const processDrag = () => {
    const deltaX = (latest.clientX - startMouse.x) / scale;
    const deltaY = (latest.clientY - startMouse.y) / scale;
    onCropChange(getDraggedCrop({
      type,
      startCrop,
      deltaX,
      deltaY,
      videoWidth,
      videoHeight,
    }));
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
    clearPendingCropDragFrame(rafRef);
    processDrag();
    onDragEnd();
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

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

  const scale = getVideoDisplayScale(displayWidth, videoWidth);
  const cropRect = getCropDisplayRect(crop, scale);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent, type: ActiveDragType) => {
      e.preventDefault();
      e.stopPropagation();
      if (!hasCropDisplayArea(displayWidth, displayHeight)) return;

      setDragType(type);
      startCropDragSession({
        event: e,
        type,
        crop,
        scale,
        videoWidth,
        videoHeight,
        rafRef,
        onCropChange,
        onDragEnd: () => setDragType(null),
      });
    },
    [crop, scale, videoWidth, videoHeight, displayWidth, displayHeight, onCropChange]
  );

  if (!hasCropDisplayArea(displayWidth, displayHeight)) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ width: displayWidth, height: displayHeight }}
    >
      {/* Dim outside the crop — four boxes for cheap rendering. */}
      <CropDimmers rect={cropRect} />

      {/* Crop rect with handles. */}
      <div
        className="absolute border-2 border-white pointer-events-auto"
        style={getCropRectStyle(cropRect, dragType)}
      >
        <div
          className="absolute inset-2 cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => handleMouseDown(e, 'move')}
        />

        {/* Corner handles — L-shaped SVG marks. */}
        <CropCornerHandles onMouseDown={handleMouseDown} />

        {/* Edge handles */}
        <CropEdgeHandles onMouseDown={handleMouseDown} />

        {dragType && <CropGrid />}

        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[11px] px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
          {crop.width} × {crop.height}
        </div>
      </div>
    </div>
  );
});
