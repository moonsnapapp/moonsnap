import { memo, useCallback, useState, useRef, useMemo, useEffect } from 'react';
import type { TextSegment } from '../../types';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectSelectTextSegment,
  selectSelectedTextSegmentId,
  selectUpdateTextSegment,
} from '../../stores/videoEditor/selectors';
import { createTextSegmentId } from '../../utils/textSegmentId';
import { clampWithFallback } from '../../utils/math';
import { renderTextOnCanvas } from '../../utils/textPreRenderer';
import { getAnimatedTextContent } from '../../utils/textSegmentAnimation';

interface TextOverlayProps {
  segments: TextSegment[];
  currentTimeMs: number;
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
}

interface TextItemProps {
  segment: TextSegment;
  displayContent: string;
  segmentId: string;
  isSelected: boolean;
  opacity: number;
  renderSize: { width: number; height: number };
  interactionSize: { width: number; height: number };
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
 * Clamp a value between min and max, handling edge cases
 */
function clamp(value: number, min: number, max: number): number {
  return clampWithFallback(value, min, max, 'midpoint');
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
  displayContent,
  segmentId,
  isSelected,
  opacity,
  renderSize,
  interactionSize,
  onSelect,
  onUpdate,
}: TextItemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    centerX: number;
    centerY: number;
    sizeX: number;
    sizeY: number;
  } | null>(null);

  // Calculate pixel position from center-based normalized coordinates
  // Match glyphon's calculation exactly
  const width = Math.max(segment.size.x * renderSize.width, 1);
  const height = Math.max(segment.size.y * renderSize.height, 1);
  const halfW = width / 2;
  const halfH = height / 2;
  const left = segment.center.x * renderSize.width - halfW;
  const top = segment.center.y * renderSize.height - halfH;

  const drawTextPreview = useCallback((targetWidth: number, targetHeight: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const safeWidth = Math.max(1, targetWidth);
    const safeHeight = Math.max(1, targetHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(safeWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(safeHeight * dpr));

    // Setting canvas dimensions clears it and resets context state.
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Scale for HiDPI; all drawing uses CSS pixel coordinates.
    ctx.scale(dpr, dpr);

    renderTextOnCanvas(ctx, {
      content: displayContent,
      fontFamily: segment.fontFamily || 'sans-serif',
      fontWeight: segment.fontWeight || 700,
      italic: !!segment.italic,
      fontSize: segment.fontSize,
      color: segment.color || '#ffffff',
    }, safeWidth, safeHeight, renderSize.height);
  }, [
    displayContent,
    segment.fontFamily,
    segment.fontWeight,
    segment.italic,
    segment.fontSize,
    segment.color,
    renderSize.height,
  ]);

  // Render text on canvas — same code path as export for WYSIWYG
  useEffect(() => {
    drawTextPreview(width, height);
  }, [drawTextPreview, width, height]);

  // Handle drag to move — updates DOM directly during drag for zero-lag interaction,
  // commits final position to store on mouseUp to avoid per-frame re-render cascade.
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
    };

    const el = containerRef.current;
    const pxWidth = Math.max(segment.size.x * renderSize.width, 1);
    const pxHalfW = pxWidth / 2;
    const pxHeight = Math.max(segment.size.y * renderSize.height, 1);
    const pxHalfH = pxHeight / 2;

    // Track final center for store commit
    let finalCenterX = segment.center.x;
    let finalCenterY = segment.center.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;

      const dx = (moveEvent.clientX - dragStartRef.current.x) / interactionSize.width;
      const dy = (moveEvent.clientY - dragStartRef.current.y) / interactionSize.height;

      // Allow center anywhere in 0..1 — text can overflow edges and gets clipped in export
      finalCenterX = clamp(dragStartRef.current.centerX + dx, 0, 1);
      finalCenterY = clamp(dragStartRef.current.centerY + dy, 0, 1);

      // Update DOM directly — no React state, no store, no re-render
      if (el) {
        el.style.left = `${finalCenterX * renderSize.width - pxHalfW}px`;
        el.style.top = `${finalCenterY * renderSize.height - pxHalfH}px`;
      }
    };

    const handleMouseUp = () => {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Single store update on release
      onUpdate(segmentId, { center: { x: finalCenterX, y: finalCenterY } });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [segment, interactionSize, renderSize, isSelected, segmentId, onSelect, onUpdate]);

  // Handle corner resize (bounds only, no font size change)
  // Updates DOM directly during drag, commits to store on mouseUp.
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
      };

      const minSize = 0.03;
      const el = containerRef.current;

      // Track final values for store commit
      let finalUpdate: Partial<TextSegment> = {};

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;

        const dx = (moveEvent.clientX - dragStartRef.current.x) / interactionSize.width;
        const dy = (moveEvent.clientY - dragStartRef.current.y) / interactionSize.height;

        const targetWidth = dragStartRef.current.sizeX + dx * dirX;
        const targetHeight = dragStartRef.current.sizeY + dy * dirY;
        const newSizeX = Math.max(targetWidth, minSize);
        const newSizeY = Math.max(targetHeight, minSize);
        const appliedDeltaX = newSizeX - dragStartRef.current.sizeX;
        const appliedDeltaY = newSizeY - dragStartRef.current.sizeY;

        // Allow center anywhere in 0..1 - overflow gets clipped in export
        const newCenterX = clamp(
          dragStartRef.current.centerX + (dirX * appliedDeltaX) / 2,
          0, 1
        );
        const newCenterY = clamp(
          dragStartRef.current.centerY + (dirY * appliedDeltaY) / 2,
          0, 1
        );

        finalUpdate = {
          size: { x: newSizeX, y: newSizeY },
          center: { x: newCenterX, y: newCenterY },
        };

        // Update DOM directly for visual feedback
        if (el) {
          const pxW = Math.max(newSizeX * renderSize.width, 1);
          const pxH = Math.max(newSizeY * renderSize.height, 1);
          el.style.width = `${pxW}px`;
          el.style.height = `${pxH}px`;
          el.style.left = `${newCenterX * renderSize.width - pxW / 2}px`;
          el.style.top = `${newCenterY * renderSize.height - pxH / 2}px`;
          drawTextPreview(pxW, pxH);
        }
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        dragStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Single store update on release
        if (Object.keys(finalUpdate).length > 0) {
          onUpdate(segmentId, finalUpdate);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  }, [segment, interactionSize, renderSize, segmentId, onUpdate, drawTextPreview]);

  // Handle side resize (width only, no font size change)
  // Updates DOM directly during drag, commits to store on mouseUp.
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
      };

      const minSize = 0.03;
      const el = containerRef.current;

      // Track final values for store commit
      let finalUpdate: Partial<TextSegment> = {};

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;

        const dx = (moveEvent.clientX - dragStartRef.current.x) / interactionSize.width;

        const targetWidth = dragStartRef.current.sizeX + dx * dirX;
        const newSizeX = Math.max(targetWidth, minSize);
        const appliedDelta = newSizeX - dragStartRef.current.sizeX;

        // Allow center anywhere in 0..1 — overflow gets clipped in export
        const newCenterX = clamp(
          dragStartRef.current.centerX + (dirX * appliedDelta) / 2,
          0, 1
        );

        finalUpdate = {
          size: { x: newSizeX, y: segment.size.y },
          center: { x: newCenterX, y: segment.center.y },
        };

        // Update DOM directly for visual feedback
        if (el) {
          const pxW = Math.max(newSizeX * renderSize.width, 1);
          const pxH = Math.max(dragStartRef.current.sizeY * renderSize.height, 1);
          el.style.width = `${pxW}px`;
          el.style.left = `${newCenterX * renderSize.width - pxW / 2}px`;
          drawTextPreview(pxW, pxH);
        }
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        dragStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Single store update on release
        if (Object.keys(finalUpdate).length > 0) {
          onUpdate(segmentId, finalUpdate);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  }, [segment, interactionSize, renderSize, segmentId, onUpdate, drawTextPreview]);

  return (
    <div
      ref={containerRef}
      className="absolute pointer-events-auto"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        opacity,
        cursor: isResizing ? undefined : 'move',
      }}
      onMouseDown={handleMove}
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
          {/* Corner handles - resize text bounds without changing font size */}
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
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
}: TextOverlayProps) {
  const selectedTextSegmentId = useVideoEditorStore(selectSelectedTextSegmentId);
  const selectTextSegment = useVideoEditorStore(selectSelectTextSegment);
  const updateTextSegment = useVideoEditorStore(selectUpdateTextSegment);

  const safeRenderWidth = Math.max(1, Math.round(renderWidth));
  const safeRenderHeight = Math.max(1, Math.round(renderHeight));
  const safeDisplayWidth = Math.max(1, Math.round(displayWidth));
  const safeDisplayHeight = Math.max(1, Math.round(displayHeight));
  // Use uniform scale matching object-fit: contain on the video element.
  // Separate scaleX/scaleY would stretch the overlay when rounding causes
  // the container to be slightly wider/taller than the video's natural fit.
  const uniformScale = Math.min(safeDisplayWidth / safeRenderWidth, safeDisplayHeight / safeRenderHeight);
  const fittedWidth = safeRenderWidth * uniformScale;
  const fittedHeight = safeRenderHeight * uniformScale;
  const offsetX = (safeDisplayWidth - fittedWidth) / 2;
  const offsetY = (safeDisplayHeight - fittedHeight) / 2;
  const renderSize = { width: safeRenderWidth, height: safeRenderHeight };
  const interactionSize = { width: fittedWidth, height: fittedHeight };

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
        displayContent: getAnimatedTextContent(segment, currentTimeSec),
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
      createTextSegmentId(seg.start, originalIndex)
    ),
    [activeSegmentsWithIndex]
  );

  const hasSelection = selectedTextSegmentId !== null;

  return (
    <div
      className="absolute left-0 top-0"
      style={{
        width: `${safeDisplayWidth}px`,
        height: `${safeDisplayHeight}px`,
      }}
    >
      <div
        className={`relative ${hasSelection ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{
          width: `${safeRenderWidth}px`,
          height: `${safeRenderHeight}px`,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${uniformScale})`,
          transformOrigin: 'top left',
        }}
        onClick={handleContainerClick}
      >
        {activeSegmentsWithIndex.map(({ segment, opacity, displayContent }, index) => (
          <TextItem
            key={segmentIds[index]}
            segment={segment}
            displayContent={displayContent}
            segmentId={segmentIds[index]}
            isSelected={segmentIds[index] === selectedTextSegmentId}
            opacity={opacity}
            renderSize={renderSize}
            interactionSize={interactionSize}
            onSelect={selectTextSegment}
            onUpdate={updateTextSegment}
          />
        ))}
      </div>
    </div>
  );
});
