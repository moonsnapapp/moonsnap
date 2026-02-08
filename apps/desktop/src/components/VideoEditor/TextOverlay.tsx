import { memo, useCallback, useState, useRef, useMemo, useEffect } from 'react';
import type { TextSegment } from '../../types';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { renderTextOnCanvas } from '../../utils/textPreRenderer';

/**
 * Measure text dimensions using an offscreen canvas.
 * Returns { width, height } in pixels.
 */
let _measureCanvas: OffscreenCanvas | null = null;
export function measureTextSize(
  content: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  maxWidthPx: number,
): { width: number; height: number } {
  if (!_measureCanvas) {
    _measureCanvas = new OffscreenCanvas(1, 1);
  }
  const ctx = _measureCanvas.getContext('2d');
  if (!ctx) return { width: 100, height: fontSize * 1.2 };

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(content);
  const textWidth = metrics.width;

  // Approximate line wrapping
  const lines = Math.max(1, Math.ceil(textWidth / maxWidthPx));
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines * lineHeight;
  const effectiveWidth = lines > 1 ? maxWidthPx : textWidth;

  return { width: effectiveWidth, height: totalHeight };
}

interface TextOverlayProps {
  segments: TextSegment[];
  currentTimeMs: number;
  previewWidth: number;
  previewHeight: number;
  videoAspectRatio: number;
}

interface TextItemProps {
  segment: TextSegment;
  segmentId: string;
  isSelected: boolean;
  opacity: number;
  videoOffset: { x: number; y: number };
  videoSize: { width: number; height: number };
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TextSegment>) => void;
}

interface ResizeHandleProps {
  position: 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w';
  onMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Resize handle for corners and sides of the bounding box
 */
const ResizeHandle = memo(function ResizeHandle({ position, onMouseDown }: ResizeHandleProps) {
  const positionClasses: Record<string, string> = {
    nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize',
    ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize',
    sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize',
    se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize',
    e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-e-resize',
    w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-w-resize',
  };

  return (
    <div
      className={`absolute w-3 h-3 bg-blue-500 border border-white rounded-full shadow-sm transition-transform hover:scale-125 ${positionClasses[position]}`}
      onMouseDown={onMouseDown}
    />
  );
});

/**
 * Calculate video bounds within container (accounting for letterboxing)
 */
function calculateVideoBounds(
  containerWidth: number,
  containerHeight: number,
  videoAspectRatio: number
): { offsetX: number; offsetY: number; width: number; height: number } {
  const containerAspect = containerWidth / containerHeight;

  if (containerAspect > videoAspectRatio) {
    // Container is wider than video - pillarboxing (black bars on sides)
    const videoWidth = containerHeight * videoAspectRatio;
    const offsetX = (containerWidth - videoWidth) / 2;
    return { offsetX, offsetY: 0, width: videoWidth, height: containerHeight };
  } else {
    // Container is taller than video - letterboxing (black bars top/bottom)
    const videoHeight = containerWidth / videoAspectRatio;
    const offsetY = (containerHeight - videoHeight) / 2;
    return { offsetX: 0, offsetY, width: containerWidth, height: videoHeight };
  }
}

/**
 * Clamp a value between min and max, handling edge cases
 */
function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

const MIN_VISIBLE_OPACITY = 0.001;

/**
 * Match export fade logic (prerendered_text.rs) for preview parity.
 */
function calculateTextSegmentOpacity(segment: TextSegment, timeSec: number): number {
  const fadeDuration = Math.max(segment.fadeDuration, 0);
  if (fadeDuration <= 0) {
    return 1;
  }

  const timeSinceStart = timeSec - segment.start;
  const timeUntilEnd = segment.end - timeSec;
  const segmentDuration = segment.end - segment.start;

  if (timeSinceStart < fadeDuration) {
    return Math.max(0, Math.min(1, timeSinceStart / fadeDuration));
  }

  if (timeUntilEnd < fadeDuration && segmentDuration > fadeDuration * 2) {
    return Math.max(0, Math.min(1, timeUntilEnd / fadeDuration));
  }

  return 1;
}

/**
 * Individual text item bounding box with drag and resize support.
 * Canvas text rendering shares the same code path as export (renderTextOnCanvas)
 * to guarantee WYSIWYG. Uses center-based positioning matching Cap's model.
 */
const TextItem = memo(function TextItem({
  segment,
  segmentId,
  isSelected,
  opacity,
  videoOffset,
  videoSize,
  onSelect,
  onUpdate,
}: TextItemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    centerX: number;
    centerY: number;
    sizeX: number;
    sizeY: number;
    fontSize: number;
  } | null>(null);

  // Calculate pixel position from center-based normalized coordinates
  // Match glyphon's calculation exactly
  const width = Math.max(segment.size.x * videoSize.width, 1);
  const height = Math.max(segment.size.y * videoSize.height, 1);
  const halfW = width / 2;
  const halfH = height / 2;
  const left = Math.max(0, videoOffset.x + segment.center.x * videoSize.width - halfW);
  const top = Math.max(0, videoOffset.y + segment.center.y * videoSize.height - halfH);

  // Render text on canvas — same code path as export for WYSIWYG
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    // Setting canvas dimensions clears it and resets context state
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Scale for HiDPI — all drawing uses CSS pixel coordinates
    ctx.scale(dpr, dpr);

    renderTextOnCanvas(ctx, {
      content: segment.content || 'Text',
      fontFamily: segment.fontFamily || 'sans-serif',
      fontWeight: segment.fontWeight || 700,
      italic: !!segment.italic,
      fontSize: segment.fontSize,
      color: segment.color || '#ffffff',
      sizeY: segment.size.y,
    }, width, height, videoSize.height);
  }, [segment.content, segment.fontFamily, segment.fontWeight, segment.fontSize,
      segment.italic, segment.color, segment.size.y, width, height, videoSize.height]);

  // Handle drag to move
  const handleMove = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isSelected) {
      onSelect(segmentId);
    }

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      centerX: segment.center.x,
      centerY: segment.center.y,
      sizeX: segment.size.x,
      sizeY: segment.size.y,
      fontSize: segment.fontSize,
    };

    const minPadding = 0.02;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;

      const dx = (moveEvent.clientX - dragStartRef.current.x) / videoSize.width;
      const dy = (moveEvent.clientY - dragStartRef.current.y) / videoSize.height;

      const halfW = segment.size.x / 2;
      const halfH = segment.size.y / 2;

      const newCenterX = clamp(
        dragStartRef.current.centerX + dx,
        halfW + minPadding,
        1 - halfW - minPadding
      );
      const newCenterY = clamp(
        dragStartRef.current.centerY + dy,
        halfH + minPadding,
        1 - halfH - minPadding
      );

      onUpdate(segmentId, { center: { x: newCenterX, y: newCenterY } });
    };

    const handleMouseUp = () => {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [segment, videoSize, isSelected, segmentId, onSelect, onUpdate]);

  // Handle corner resize (proportional scaling with font size)
  const createCornerResizeHandler = useCallback((dirX: -1 | 1, dirY: -1 | 1) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        centerX: segment.center.x,
        centerY: segment.center.y,
        sizeX: segment.size.x,
        sizeY: segment.size.y,
        fontSize: segment.fontSize,
      };

      const minSize = 0.03;
      const maxSize = 0.95;
      const minPadding = 0.02;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;

        const dy = (moveEvent.clientY - dragStartRef.current.y) / videoSize.height;

        // Calculate scale based on vertical drag
        const currentHeightPx = dragStartRef.current.sizeY * videoSize.height;
        const deltaPxY = dy * videoSize.height * dirY;
        const scale = (currentHeightPx + deltaPxY) / currentHeightPx;

        if (scale > 0.1 && scale < 10) {
          const newFontSize = clamp(dragStartRef.current.fontSize * scale, 8, 400);
          const newSizeX = clamp(dragStartRef.current.sizeX * scale, minSize, maxSize);
          const newSizeY = clamp(dragStartRef.current.sizeY * scale, minSize, maxSize);

          const widthDiff = newSizeX - dragStartRef.current.sizeX;
          const heightDiff = newSizeY - dragStartRef.current.sizeY;

          const halfWidth = newSizeX / 2;
          const halfHeight = newSizeY / 2;

          const newCenterX = clamp(
            dragStartRef.current.centerX + (widthDiff * dirX) / 2,
            halfWidth + minPadding,
            1 - halfWidth - minPadding
          );
          const newCenterY = clamp(
            dragStartRef.current.centerY + (heightDiff * dirY) / 2,
            halfHeight + minPadding,
            1 - halfHeight - minPadding
          );

          onUpdate(segmentId, {
            fontSize: newFontSize,
            size: { x: newSizeX, y: newSizeY },
            center: { x: newCenterX, y: newCenterY },
          });
        }
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        dragStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  }, [segment, videoSize, segmentId, onUpdate]);

  // Handle side resize (width only, no font size change)
  const createSideResizeHandler = useCallback((dirX: -1 | 1) => {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        centerX: segment.center.x,
        centerY: segment.center.y,
        sizeX: segment.size.x,
        sizeY: segment.size.y,
        fontSize: segment.fontSize,
      };

      const minSize = 0.03;
      const maxSize = 0.95;
      const minPadding = 0.02;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;

        const dx = (moveEvent.clientX - dragStartRef.current.x) / videoSize.width;

        const targetWidth = dragStartRef.current.sizeX + dx * dirX;
        const newSizeX = clamp(targetWidth, minSize, maxSize);
        const appliedDelta = newSizeX - dragStartRef.current.sizeX;

        const halfWidth = newSizeX / 2;

        const newCenterX = clamp(
          dragStartRef.current.centerX + (dirX * appliedDelta) / 2,
          halfWidth + minPadding,
          1 - halfWidth - minPadding
        );

        onUpdate(segmentId, {
          size: { x: newSizeX, y: segment.size.y },
          center: { x: newCenterX, y: segment.center.y },
        });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        dragStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  }, [segment, videoSize, segmentId, onUpdate]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(segmentId);
  }, [segmentId, onSelect]);

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        opacity,
        cursor: isResizing ? undefined : (isSelected ? 'move' : 'pointer'),
      }}
      onClick={handleClick}
      onMouseDown={isSelected ? handleMove : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Canvas text — same rendering as export for WYSIWYG */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Bounding box border - visible on hover/select */}
      <div
        className={`absolute inset-0 rounded-md border-2 transition-colors ${
          isSelected
            ? 'border-blue-500 bg-blue-500/10'
            : isHovered
            ? 'border-blue-400 bg-blue-400/5'
            : 'border-transparent'
        }`}
      />

      {/* Resize handles (only when selected) */}
      {isSelected && (
        <>
          {/* Corner handles - proportional resize with font scaling */}
          <ResizeHandle position="nw" onMouseDown={createCornerResizeHandler(-1, -1)} />
          <ResizeHandle position="ne" onMouseDown={createCornerResizeHandler(1, -1)} />
          <ResizeHandle position="sw" onMouseDown={createCornerResizeHandler(-1, 1)} />
          <ResizeHandle position="se" onMouseDown={createCornerResizeHandler(1, 1)} />

          {/* Side handles - width only */}
          <ResizeHandle position="w" onMouseDown={createSideResizeHandler(-1)} />
          <ResizeHandle position="e" onMouseDown={createSideResizeHandler(1)} />
        </>
      )}
    </div>
  );
});

/**
 * TextOverlay - Interactive bounding boxes for text segments.
 *
 * Provides selection, dragging, and resizing of text segments.
 * Text rendering uses Canvas 2D (shared with export) for WYSIWYG.
 *
 * Uses Cap's model: time in seconds, center-based positioning.
 */
export const TextOverlay = memo(function TextOverlay({
  segments,
  currentTimeMs,
  previewWidth,
  previewHeight,
  videoAspectRatio,
}: TextOverlayProps) {
  const selectedTextSegmentId = useVideoEditorStore((s) => s.selectedTextSegmentId);
  const selectTextSegment = useVideoEditorStore((s) => s.selectTextSegment);
  const updateTextSegment = useVideoEditorStore((s) => s.updateTextSegment);

  // Calculate video bounds within container (accounting for letterboxing)
  const videoBounds = calculateVideoBounds(previewWidth, previewHeight, videoAspectRatio);
  const videoOffset = { x: videoBounds.offsetX, y: videoBounds.offsetY };
  const videoSize = { width: videoBounds.width, height: videoBounds.height };

  // Current time in seconds (Cap uses seconds)
  const currentTimeSec = currentTimeMs / 1000;

  // Filter segments that are active at current time and enabled
  // Keep track of original index for ID generation
  const activeSegmentsWithIndex = useMemo(() =>
    segments
      .map((seg, originalIndex) => ({ segment: seg, originalIndex }))
      .filter(
        ({ segment: seg }) => seg.enabled && currentTimeSec >= seg.start && currentTimeSec <= seg.end
      )
      .map(({ segment, originalIndex }) => ({
        segment,
        originalIndex,
        opacity: calculateTextSegmentOpacity(segment, currentTimeSec),
      }))
      .filter(({ opacity }) => opacity >= MIN_VISIBLE_OPACITY),
    [segments, currentTimeSec]
  );

  // Handle click on overlay container to deselect
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    // Only deselect if clicking on the container itself, not a child
    if (e.target === e.currentTarget) {
      selectTextSegment(null);
    }
  }, [selectTextSegment]);

  // Generate stable IDs for segments based on start time and ORIGINAL index
  // This must match TextTrack's ID generation exactly
  const segmentIds = useMemo(() =>
    activeSegmentsWithIndex.map(({ segment: seg, originalIndex }) =>
      `text_${seg.start.toFixed(3)}_${originalIndex}`
    ),
    [activeSegmentsWithIndex]
  );

  const hasSelection = selectedTextSegmentId !== null;

  return (
    <div
      className={`absolute inset-0 ${hasSelection ? '' : 'pointer-events-none'}`}
      onClick={handleContainerClick}
    >
      {activeSegmentsWithIndex.map(({ segment, opacity }, index) => (
        <TextItem
          key={segmentIds[index]}
          segment={segment}
          segmentId={segmentIds[index]}
          isSelected={segmentIds[index] === selectedTextSegmentId}
          opacity={opacity}
          videoOffset={videoOffset}
          videoSize={videoSize}
          onSelect={selectTextSegment}
          onUpdate={updateTextSegment}
        />
      ))}
    </div>
  );
});
