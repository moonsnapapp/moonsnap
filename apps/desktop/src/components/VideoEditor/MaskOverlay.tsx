import { memo, useCallback, useState, useRef, useEffect } from 'react';
import type { MaskSegment, MaskType, CropConfig } from '../../types';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectSelectMaskSegment,
  selectSelectedMaskSegmentId,
  selectUpdateMaskSegment,
} from '../../stores/videoEditor/selectors';

interface MaskOverlayProps {
  segments: MaskSegment[];
  currentTimeMs: number;
  previewWidth: number;
  previewHeight: number;
  /** Video element to sample from for pixelation */
  videoElement: HTMLVideoElement | null;
  /** Original video dimensions for proper sampling */
  videoWidth: number;
  videoHeight: number;
  /** Zoom transform style - masks follow the video zoom */
  zoomStyle?: React.CSSProperties;
  /** Crop configuration for crop-aware pixelation sampling */
  cropConfig?: CropConfig;
}

interface MaskItemProps {
  segment: MaskSegment;
  isSelected: boolean;
  previewWidth: number;
  previewHeight: number;
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<MaskSegment>) => void;
  cropConfig?: CropConfig;
}

type MaskDragType = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';

interface MaskDragStart {
  x: number;
  y: number;
  segX: number;
  segY: number;
  segW: number;
  segH: number;
}

/**
 * Generate CSS mask for feathered (soft) edges.
 * Uses multiple linear gradients to create smooth fade on all edges.
 * Feather value is 0-100, where 0 = hard edge, 100 = maximum softness.
 */
const getFeatherMask = (feather: number, width: number, height: number): React.CSSProperties => {
  if (feather <= 0) return {};

  // Calculate feather size in pixels (percentage of smaller dimension)
  const minDim = Math.min(width, height);
  const featherPx = Math.max(1, (feather / 100) * minDim * 0.5);

  // Create gradient masks for each edge
  // Each gradient goes from transparent at edge to opaque after featherPx
  const maskImage = `
    linear-gradient(to right, transparent, black ${featherPx}px, black calc(100% - ${featherPx}px), transparent),
    linear-gradient(to bottom, transparent, black ${featherPx}px, black calc(100% - ${featherPx}px), transparent)
  `;

  return {
    maskImage,
    WebkitMaskImage: maskImage,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  };
};

/**
 * Get mask style based on type (for blur and solid only)
 */
const getMaskStyle = (maskType: MaskType, intensity: number): React.CSSProperties => {
  switch (maskType) {
    case 'blur':
      return {
        backdropFilter: `blur(${intensity / 5}px)`,
        WebkitBackdropFilter: `blur(${intensity / 5}px)`,
        backgroundColor: `rgba(0, 0, 0, ${intensity / 500})`,
      };
    case 'solid':
      return {
        backgroundColor: 'var(--mask-solid-color, #000000)',
      };
    default:
      return {};
  }
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resizesMaskLeft(type: MaskDragType): boolean {
  return type === 'resize-tl' || type === 'resize-bl';
}

function resizesMaskRight(type: MaskDragType): boolean {
  return type === 'resize-tr' || type === 'resize-br';
}

function resizesMaskTop(type: MaskDragType): boolean {
  return type === 'resize-tl' || type === 'resize-tr';
}

function resizesMaskBottom(type: MaskDragType): boolean {
  return type === 'resize-bl' || type === 'resize-br';
}

function getMovedMaskUpdate(
  start: MaskDragStart,
  deltaX: number,
  deltaY: number
): Partial<MaskSegment> {
  return {
    x: Math.max(0, Math.min(1 - start.segW, start.segX + deltaX)),
    y: Math.max(0, Math.min(1 - start.segH, start.segY + deltaY)),
  };
}

function getMaskRightEdge(start: MaskDragStart): number {
  return start.segX + start.segW;
}

function getMaskBottomEdge(start: MaskDragStart): number {
  return start.segY + start.segH;
}

function clampMaskStartEdge(value: number, oppositeEdge: number, minSize: number): number {
  return Math.max(0, Math.min(oppositeEdge - minSize, value));
}

function clampMaskEndEdge(startEdge: number, size: number, delta: number, minSize: number): number {
  return clampUnit(startEdge + Math.max(minSize, Math.min(1 - startEdge, size + delta)));
}

function getResizedMaskLeft(type: MaskDragType, start: MaskDragStart, deltaX: number, minSize: number) {
  return resizesMaskLeft(type)
    ? clampMaskStartEdge(start.segX + deltaX, getMaskRightEdge(start), minSize)
    : start.segX;
}

function getResizedMaskTop(type: MaskDragType, start: MaskDragStart, deltaY: number, minSize: number) {
  return resizesMaskTop(type)
    ? clampMaskStartEdge(start.segY + deltaY, getMaskBottomEdge(start), minSize)
    : start.segY;
}

function getResizedMaskRight(type: MaskDragType, start: MaskDragStart, deltaX: number, minSize: number) {
  return resizesMaskRight(type)
    ? clampMaskEndEdge(start.segX, start.segW, deltaX, minSize)
    : getMaskRightEdge(start);
}

function getResizedMaskBottom(type: MaskDragType, start: MaskDragStart, deltaY: number, minSize: number) {
  return resizesMaskBottom(type)
    ? clampMaskEndEdge(start.segY, start.segH, deltaY, minSize)
    : getMaskBottomEdge(start);
}

function getResizedMaskUpdate(
  type: MaskDragType,
  start: MaskDragStart,
  deltaX: number,
  deltaY: number
): Partial<MaskSegment> {
  const minSize = 0.02;
  const left = getResizedMaskLeft(type, start, deltaX, minSize);
  const top = getResizedMaskTop(type, start, deltaY, minSize);
  const right = getResizedMaskRight(type, start, deltaX, minSize);
  const bottom = getResizedMaskBottom(type, start, deltaY, minSize);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function getDraggedMaskUpdate(
  type: MaskDragType,
  start: MaskDragStart,
  deltaX: number,
  deltaY: number
): Partial<MaskSegment> {
  return type === 'move'
    ? getMovedMaskUpdate(start, deltaX, deltaY)
    : getResizedMaskUpdate(type, start, deltaX, deltaY);
}

function getFullVideoRegion(videoWidth: number, videoHeight: number) {
  return { x: 0, y: 0, width: videoWidth, height: videoHeight };
}

function hasUsableCropConfig(cropConfig: CropConfig | undefined): cropConfig is CropConfig {
  return Boolean(cropConfig?.enabled && cropConfig.width > 0 && cropConfig.height > 0);
}

function getHorizontalClipRegion(
  videoWidth: number,
  videoHeight: number,
  cropConfig: CropConfig,
  cropAspect: number,
) {
  const visibleW = videoHeight * cropAspect;
  const overflowX = videoWidth - visibleW;
  const overflowXCrop = videoWidth - cropConfig.width;
  const posXFraction = overflowXCrop > 0 ? cropConfig.x / overflowXCrop : 0.5;

  return {
    x: overflowX * posXFraction,
    y: 0,
    width: visibleW,
    height: videoHeight,
  };
}

function getVerticalClipRegion(
  videoWidth: number,
  videoHeight: number,
  cropConfig: CropConfig,
  cropAspect: number,
) {
  const visibleH = videoWidth / cropAspect;
  const overflowY = videoHeight - visibleH;
  const overflowYCrop = videoHeight - cropConfig.height;
  const posYFraction = overflowYCrop > 0 ? cropConfig.y / overflowYCrop : 0.5;

  return {
    x: 0,
    y: overflowY * posYFraction,
    width: videoWidth,
    height: visibleH,
  };
}

/**
 * Compute the visible video region in source pixels based on CSS object-fit:cover + object-position.
 * Replicates what the browser shows so pixelated content matches the visible video.
 */
function computeVisibleVideoRegion(
  videoWidth: number,
  videoHeight: number,
  cropConfig?: CropConfig,
): { x: number; y: number; width: number; height: number } {
  if (!hasUsableCropConfig(cropConfig)) {
    return getFullVideoRegion(videoWidth, videoHeight);
  }

  const cropAspect = cropConfig.width / cropConfig.height;
  const videoAspect = videoWidth / videoHeight;

  if (videoAspect > cropAspect) {
    return getHorizontalClipRegion(videoWidth, videoHeight, cropConfig, cropAspect);
  }

  return getVerticalClipRegion(videoWidth, videoHeight, cropConfig, cropAspect);
}
interface PixelateFrameGeometry {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  displayW: number;
  displayH: number;
  blockSize: number;
}

function getPixelateFrameGeometry({
  videoWidth,
  videoHeight,
  segmentX,
  segmentY,
  segmentWidth,
  segmentHeight,
  previewWidth,
  previewHeight,
  intensity,
  cropConfig,
}: {
  videoWidth: number;
  videoHeight: number;
  segmentX: number;
  segmentY: number;
  segmentWidth: number;
  segmentHeight: number;
  previewWidth: number;
  previewHeight: number;
  intensity: number;
  cropConfig?: CropConfig;
}): PixelateFrameGeometry {
  const visible = computeVisibleVideoRegion(videoWidth, videoHeight, cropConfig);

  return {
    srcX: Math.round(visible.x + segmentX * visible.width),
    srcY: Math.round(visible.y + segmentY * visible.height),
    srcW: Math.round(segmentWidth * visible.width),
    srcH: Math.round(segmentHeight * visible.height),
    displayW: Math.round(segmentWidth * previewWidth),
    displayH: Math.round(segmentHeight * previewHeight),
    blockSize: Math.max(2, Math.round(intensity / 5)),
  };
}

function hasDrawablePixelateFrame({ srcW, srcH, displayW, displayH }: PixelateFrameGeometry) {
  return srcW > 0 && srcH > 0 && displayW > 0 && displayH > 0;
}

function resizePixelateCanvas(
  canvas: HTMLCanvasElement,
  displayW: number,
  displayH: number
) {
  if (canvas.width !== displayW || canvas.height !== displayH) {
    canvas.width = displayW;
    canvas.height = displayH;
  }
}

function drawPixelatedVideoRegion(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  videoElement: HTMLVideoElement,
  geometry: PixelateFrameGeometry
) {
  const smallW = Math.max(1, Math.floor(geometry.displayW / geometry.blockSize));
  const smallH = Math.max(1, Math.floor(geometry.displayH / geometry.blockSize));

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    videoElement,
    geometry.srcX, geometry.srcY, geometry.srcW, geometry.srcH,
    0, 0, smallW, smallH
  );

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    canvas,
    0, 0, smallW, smallH,
    0, 0, geometry.displayW, geometry.displayH
  );
}

function drawPixelateFrame({
  canvas,
  videoElement,
  videoWidth,
  videoHeight,
  segmentX,
  segmentY,
  segmentWidth,
  segmentHeight,
  previewWidth,
  previewHeight,
  intensity,
  cropConfig,
}: {
  canvas: HTMLCanvasElement;
  videoElement: HTMLVideoElement;
  videoWidth: number;
  videoHeight: number;
  segmentX: number;
  segmentY: number;
  segmentWidth: number;
  segmentHeight: number;
  previewWidth: number;
  previewHeight: number;
  intensity: number;
  cropConfig?: CropConfig;
}): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const geometry = getPixelateFrameGeometry({
    videoWidth,
    videoHeight,
    segmentX,
    segmentY,
    segmentWidth,
    segmentHeight,
    previewWidth,
    previewHeight,
    intensity,
    cropConfig,
  });
  if (!hasDrawablePixelateFrame(geometry)) return false;

  resizePixelateCanvas(canvas, geometry.displayW, geometry.displayH);
  drawPixelatedVideoRegion(ctx, canvas, videoElement, geometry);
  return true;
}

type PixelateCanvasProps = {
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
  segmentX: number;
  segmentY: number;
  segmentWidth: number;
  segmentHeight: number;
  previewWidth: number;
  previewHeight: number;
  intensity: number;
  feather: number;
  cropConfig?: CropConfig;
};

function hasPositiveVideoDimensions(videoWidth: number, videoHeight: number) {
  return videoWidth > 0 && videoHeight > 0;
}

function getPixelateCanvasDrawTarget({
  canvas,
  videoElement,
  videoWidth,
  videoHeight,
}: {
  canvas: HTMLCanvasElement | null;
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
}) {
  if (!canvas || !videoElement || !hasPositiveVideoDimensions(videoWidth, videoHeight)) {
    return null;
  }

  return { canvas, videoElement };
}

function drawPixelateFrameFromProps(
  canvas: HTMLCanvasElement,
  props: PixelateCanvasProps & { videoElement: HTMLVideoElement }
) {
  drawPixelateFrame({
    canvas,
    videoElement: props.videoElement,
    videoWidth: props.videoWidth,
    videoHeight: props.videoHeight,
    segmentX: props.segmentX,
    segmentY: props.segmentY,
    segmentWidth: props.segmentWidth,
    segmentHeight: props.segmentHeight,
    previewWidth: props.previewWidth,
    previewHeight: props.previewHeight,
    intensity: props.intensity,
    cropConfig: props.cropConfig,
  });
}

/**
 * Canvas-based pixelation component that samples from video
 */
const PixelateCanvas = memo(function PixelateCanvas(props: PixelateCanvasProps) {
  const {
    videoElement,
    videoWidth,
    videoHeight,
    segmentWidth,
    segmentHeight,
    previewWidth,
    previewHeight,
    feather,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = getPixelateCanvasDrawTarget({
      canvas: canvasRef.current,
      videoElement,
      videoWidth,
      videoHeight,
    });
    if (target) {
      drawPixelateFrameFromProps(target.canvas, { ...props, videoElement: target.videoElement });
    }
  }, [props, videoElement, videoWidth, videoHeight]);

  // Continuously update canvas when video plays
  useEffect(() => {
    if (!videoElement) return;

    let animationId: number;

    const updateCanvas = () => {
      const target = getPixelateCanvasDrawTarget({
        canvas: canvasRef.current,
        videoElement,
        videoWidth,
        videoHeight,
      });
      if (target) {
        drawPixelateFrameFromProps(target.canvas, { ...props, videoElement: target.videoElement });
      }

      animationId = requestAnimationFrame(updateCanvas);
    };

    animationId = requestAnimationFrame(updateCanvas);
    return () => cancelAnimationFrame(animationId);
  }, [props, videoElement, videoWidth, videoHeight]);

  // Calculate display dimensions for feather
  const displayW = Math.round(segmentWidth * previewWidth);
  const displayH = Math.round(segmentHeight * previewHeight);
  const featherStyle = getFeatherMask(feather, displayW, displayH);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{
        imageRendering: 'pixelated',
        ...featherStyle,
      }}
    />
  );
});

function getMaskTypeLabel(maskType: MaskType): string {
  if (maskType === 'blur') return 'Blur';
  if (maskType === 'pixelate') return 'Pixelate';
  return 'Solid';
}

function getMaskItemCursor(isDragging: boolean, dragType: MaskDragType | null): string {
  if (!isDragging) return 'pointer';
  return dragType === 'move' ? 'grabbing' : 'nwse-resize';
}

function getMaskItemStyle({
  segment,
  previewWidth,
  previewHeight,
  isDragging,
  dragType,
}: {
  segment: MaskSegment;
  previewWidth: number;
  previewHeight: number;
  isDragging: boolean;
  dragType: MaskDragType | null;
}): React.CSSProperties {
  return {
    left: `${segment.x * previewWidth}px`,
    top: `${segment.y * previewHeight}px`,
    width: `${segment.width * previewWidth}px`,
    height: `${segment.height * previewHeight}px`,
    cursor: getMaskItemCursor(isDragging, dragType),
  };
}

function getMaskEffectStyle(
  segment: MaskSegment,
  previewWidth: number,
  previewHeight: number
): React.CSSProperties {
  if (segment.maskType === 'pixelate') {
    return { '--mask-solid-color': segment.color } as React.CSSProperties;
  }

  return {
    ...getMaskStyle(segment.maskType, segment.intensity),
    '--mask-solid-color': segment.color,
    ...getFeatherMask(
      segment.feather,
      segment.width * previewWidth,
      segment.height * previewHeight
    ),
  } as React.CSSProperties;
}

function MaskEffectLayer({
  segment,
  previewWidth,
  previewHeight,
  videoElement,
  videoWidth,
  videoHeight,
  cropConfig,
}: {
  segment: MaskSegment;
  previewWidth: number;
  previewHeight: number;
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
  cropConfig?: CropConfig;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={getMaskEffectStyle(segment, previewWidth, previewHeight)}
    >
      {segment.maskType === 'pixelate' && (
        <PixelateCanvas
          videoElement={videoElement}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          segmentX={segment.x}
          segmentY={segment.y}
          segmentWidth={segment.width}
          segmentHeight={segment.height}
          previewWidth={previewWidth}
          previewHeight={previewHeight}
          intensity={segment.intensity}
          feather={segment.feather}
          cropConfig={cropConfig}
        />
      )}
    </div>
  );
}

function MaskSelectionGizmo({
  segment,
  onMouseDown,
}: {
  segment: MaskSegment;
  onMouseDown: (event: React.MouseEvent, type: MaskDragType) => void;
}) {
  return (
    <>
      <div
        className="absolute inset-0 border-2 border-dashed border-purple-500 pointer-events-none z-10"
        style={{ borderRadius: 2 }}
      />
      <div
        className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-purple-500 rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform z-20"
        onMouseDown={(e) => onMouseDown(e, 'resize-tl')}
      />
      <div
        className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-purple-500 rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform z-20"
        onMouseDown={(e) => onMouseDown(e, 'resize-tr')}
      />
      <div
        className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-purple-500 rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform z-20"
        onMouseDown={(e) => onMouseDown(e, 'resize-bl')}
      />
      <div
        className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-purple-500 rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform z-20"
        onMouseDown={(e) => onMouseDown(e, 'resize-br')}
      />
      <div className="absolute -top-6 left-0 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap z-20">
        {getMaskTypeLabel(segment.maskType)} {segment.intensity}%
      </div>
    </>
  );
}

/**
 * Individual mask overlay item with drag/resize handles
 */
const MaskItem = memo(function MaskItem({
  segment,
  isSelected,
  previewWidth,
  previewHeight,
  videoElement,
  videoWidth,
  videoHeight,
  onSelect,
  onUpdate,
  cropConfig,
}: MaskItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<MaskDragType | null>(null);
  const dragStartRef = useRef<MaskDragStart | null>(null);

  const handleMouseDown = useCallback((
    e: React.MouseEvent,
    type: MaskDragType
  ) => {
    e.preventDefault();
    e.stopPropagation();

    onSelect(segment.id);
    setIsDragging(true);
    setDragType(type);

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      segX: segment.x,
      segY: segment.y,
      segW: segment.width,
      segH: segment.height,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const deltaX = (moveEvent.clientX - dragStart.x) / previewWidth;
      const deltaY = (moveEvent.clientY - dragStart.y) / previewHeight;
      onUpdate(segment.id, getDraggedMaskUpdate(type, dragStart, deltaX, deltaY));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragType(null);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [segment, previewWidth, previewHeight, onSelect, onUpdate]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(segment.id);
  }, [segment.id, onSelect]);

  return (
    <div
      className="absolute transition-shadow"
      style={getMaskItemStyle({ segment, previewWidth, previewHeight, isDragging, dragType })}
      onClick={handleClick}
    >
      <MaskEffectLayer
        segment={segment}
        previewWidth={previewWidth}
        previewHeight={previewHeight}
        videoElement={videoElement}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
        cropConfig={cropConfig}
      />

      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing z-10"
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      />

      {isSelected && <MaskSelectionGizmo segment={segment} onMouseDown={handleMouseDown} />}
    </div>
  );
});

/**
 * MaskOverlay - Renders mask overlays on the video preview.
 * Shows only masks that are active at the current time.
 * Uses canvas-based rendering for pixelation to properly sample from video.
 */
export const MaskOverlay = memo(function MaskOverlay({
  segments,
  currentTimeMs,
  previewWidth,
  previewHeight,
  videoElement,
  videoWidth,
  videoHeight,
  zoomStyle,
  cropConfig,
}: MaskOverlayProps) {
  const selectedMaskSegmentId = useVideoEditorStore(selectSelectedMaskSegmentId);
  const selectMaskSegment = useVideoEditorStore(selectSelectMaskSegment);
  const updateMaskSegment = useVideoEditorStore(selectUpdateMaskSegment);

  // Filter segments that are active at current time
  const activeSegments = segments.filter(
    (seg) => currentTimeMs >= seg.startMs && currentTimeMs <= seg.endMs
  );

  // Handle click on overlay container to deselect
  const handleContainerClick = useCallback(() => {
    selectMaskSegment(null);
  }, [selectMaskSegment]);

  if (activeSegments.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={zoomStyle}
      onClick={handleContainerClick}
    >
      {activeSegments.map((segment) => (
        <div key={segment.id} className="pointer-events-auto">
          <MaskItem
            segment={segment}
            isSelected={segment.id === selectedMaskSegmentId}
            previewWidth={previewWidth}
            previewHeight={previewHeight}
            videoElement={videoElement}
            videoWidth={videoWidth}
            videoHeight={videoHeight}
            onSelect={selectMaskSegment}
            onUpdate={updateMaskSegment}
            cropConfig={cropConfig}
          />
        </div>
      ))}
    </div>
  );
});
