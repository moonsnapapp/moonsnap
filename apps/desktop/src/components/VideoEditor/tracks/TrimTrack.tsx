import { memo, useCallback, useMemo, useRef } from 'react';
import { GripVertical, Film } from 'lucide-react';
import type { TrimSegment } from '../../../types';
import {
  useVideoEditorStore,
  formatTimeSimple,
  MIN_TRIM_SEGMENT_DURATION_MS,
  getSegmentTimelinePosition,
  getEffectiveDuration,
} from '../../../stores/videoEditorStore';

interface TrimTrackProps {
  segments: TrimSegment[];
  durationMs: number;
  timelineZoom: number;
  width: number;
  audioPath?: string;
}

// CSS variable names for trim track styling
const TRIM_COLORS = {
  bg: 'var(--coral-100)',
  bgSelected: 'var(--coral-200)',
  border: 'var(--coral-200)',
  borderSelected: 'var(--coral-400)',
  hover: 'var(--coral-300)',
  text: 'var(--coral-400)',
};

// Selectors for atomic subscriptions
const selectSelectedTrimSegmentId = (s: ReturnType<typeof useVideoEditorStore.getState>) =>
  s.selectedTrimSegmentId;

/**
 * Individual trim segment component with drag handles.
 * Positioned by timeline time (accumulated duration of previous segments).
 */
const TrimSegmentItem = memo(function TrimSegmentItem({
  segment,
  segmentIndex,
  allSegments,
  isSelected,
  timelineZoom,
  sourceDurationMs,
  onSelect,
  onUpdate,
  onDelete,
  onDragStart,
}: {
  segment: TrimSegment;
  segmentIndex: number;
  allSegments: TrimSegment[];
  isSelected: boolean;
  timelineZoom: number;
  sourceDurationMs: number;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<TrimSegment, 'sourceStartMs' | 'sourceEndMs'>>) => void;
  onDelete: (id: string) => void;
  onDragStart: (dragging: boolean, edge?: 'start' | 'end' | 'move') => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ sourceStartMs: number; sourceEndMs: number } | null>(null);

  // Calculate timeline position (where this segment starts after rippling)
  const timelinePosition = getSegmentTimelinePosition(segmentIndex, allSegments);

  // Segment duration and width
  const segmentDuration = segment.sourceEndMs - segment.sourceStartMs;
  const segmentWidth = segmentDuration * timelineZoom;
  const left = timelinePosition * timelineZoom;

  const canDelete = allSegments.length > 1;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, edge: 'start' | 'end') => {
      e.preventDefault();
      e.stopPropagation();

      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      onSelect(segment.id);
      onDragStart(true, edge);

      const startX = e.clientX;
      const startSourceStart = segment.sourceStartMs;
      const startSourceEnd = segment.sourceEndMs;

      dragStateRef.current = { sourceStartMs: startSourceStart, sourceEndMs: startSourceEnd };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaMs = deltaX / timelineZoom;

        let newSourceStart = dragStateRef.current!.sourceStartMs;
        let newSourceEnd = dragStateRef.current!.sourceEndMs;

        if (edge === 'start') {
          // Drag left edge - trim the start (expand/contract the source range)
          newSourceStart = Math.max(0, Math.min(startSourceEnd - MIN_TRIM_SEGMENT_DURATION_MS, startSourceStart + deltaMs));
        } else if (edge === 'end') {
          // Drag right edge - trim the end
          newSourceEnd = Math.max(startSourceStart + MIN_TRIM_SEGMENT_DURATION_MS, Math.min(sourceDurationMs, startSourceEnd + deltaMs));
        }

        dragStateRef.current = { sourceStartMs: newSourceStart, sourceEndMs: newSourceEnd };

        // Update DOM directly for smooth dragging
        if (elementRef.current) {
          const newWidth = (newSourceEnd - newSourceStart) * timelineZoom;
          elementRef.current.style.width = `${Math.max(newWidth, 20)}px`;
        }

        if (tooltipRef.current) {
          const duration = newSourceEnd - newSourceStart;
          tooltipRef.current.textContent = formatTimeSimple(duration);
        }
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        (upEvent.target as HTMLElement).releasePointerCapture(upEvent.pointerId);

        if (dragStateRef.current) {
          const { sourceStartMs, sourceEndMs } = dragStateRef.current;
          if (sourceStartMs !== segment.sourceStartMs || sourceEndMs !== segment.sourceEndMs) {
            onUpdate(segment.id, { sourceStartMs, sourceEndMs });
          }
        }
        dragStateRef.current = null;
        onDragStart(false);
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    },
    [segment, sourceDurationMs, timelineZoom, onSelect, onUpdate, onDragStart]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(segment.id);
    },
    [onSelect, segment.id]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(segment.id);
    },
    [onDelete, segment.id]
  );

  return (
    <div
      ref={elementRef}
      data-trim-segment
      className={`
        absolute top-1 bottom-1 rounded-md cursor-pointer
        ${isSelected ? 'border-2 shadow-lg' : 'border'}
      `}
      style={{
        left: `${left}px`,
        width: `${Math.max(segmentWidth, 20)}px`,
        backgroundColor: isSelected ? TRIM_COLORS.bgSelected : TRIM_COLORS.bg,
        borderColor: isSelected ? TRIM_COLORS.borderSelected : TRIM_COLORS.border,
      }}
      onClick={handleClick}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-md touch-none z-10"
        onPointerDown={(e) => handlePointerDown(e, 'start')}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TRIM_COLORS.hover)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      />

      {/* Center content area */}
      <div className="absolute inset-x-2 top-0 bottom-0 flex items-center justify-center pointer-events-none">
        {segmentWidth > 60 && (
          <div className="flex items-center gap-1" style={{ color: TRIM_COLORS.text }}>
            <GripVertical className="w-3 h-3" />
            <span className="text-[10px] font-mono">
              {formatTimeSimple(segmentDuration)}
            </span>
          </div>
        )}
      </div>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-md touch-none z-10"
        onPointerDown={(e) => handlePointerDown(e, 'end')}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TRIM_COLORS.hover)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      />

      {/* Delete button (shown when selected and can delete) */}
      {isSelected && canDelete && (
        <button
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-xs shadow-md z-20"
          onClick={handleDelete}
        >
          x
        </button>
      )}

      {/* Tooltip showing duration */}
      {isSelected && (
        <div
          ref={tooltipRef}
          className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] text-[var(--ink-dark)] text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20 shadow-sm"
        >
          {formatTimeSimple(segmentDuration)}
        </div>
      )}
    </div>
  );
});

/**
 * TrimTrackContent - Track content for video trim segments.
 * Shows segments rippled together (no gaps between them).
 */
export const TrimTrackContent = memo(function TrimTrackContent({
  segments,
  durationMs,
  timelineZoom,
  width,
}: TrimTrackProps) {
  const selectedTrimSegmentId = useVideoEditorStore(selectSelectedTrimSegmentId);

  const {
    selectTrimSegment,
    updateTrimSegment,
    deleteTrimSegment,
    setDraggingZoomRegion,
  } = useVideoEditorStore();

  // Calculate effective duration (total of all segments)
  const effectiveDuration = useMemo(() => {
    return getEffectiveDuration(segments, durationMs);
  }, [segments, durationMs]);

  // Wrapper for onDragStart
  const handleDragStart = useCallback(
    (dragging: boolean) => {
      setDraggingZoomRegion(dragging);
    },
    [setDraggingZoomRegion]
  );

  // If no segments, show full video as a single block
  if (!segments || segments.length === 0) {
    return (
      <div
        className="relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)]"
        style={{ width: `${width}px` }}
      >
        {/* Full video clip */}
        <div
          className="absolute top-1 bottom-1 rounded-md bg-[var(--coral-100)] border border-[var(--coral-200)] overflow-hidden"
          style={{ left: 0, width: `${durationMs * timelineZoom}px` }}
        >
          <div className="absolute top-0 left-0 right-0 flex items-center px-2 h-full pointer-events-none">
            <span className="text-[10px] text-[var(--coral-300)]/80 font-medium truncate drop-shadow-sm">
              <Film className="w-3 h-3 inline mr-1" />
              Recording
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)]"
      style={{ width: `${width}px` }}
    >
      {/* Render segments - positioned by accumulated timeline time */}
      {segments.map((segment, index) => (
        <TrimSegmentItem
          key={segment.id}
          segment={segment}
          segmentIndex={index}
          allSegments={segments}
          isSelected={segment.id === selectedTrimSegmentId}
          timelineZoom={timelineZoom}
          sourceDurationMs={durationMs}
          onSelect={selectTrimSegment}
          onUpdate={updateTrimSegment}
          onDelete={deleteTrimSegment}
          onDragStart={handleDragStart}
        />
      ))}

      {/* Show effective duration indicator if different from source */}
      {effectiveDuration < durationMs && (
        <div
          className="absolute top-1 bottom-1 pointer-events-none border-l-2 border-dashed border-[var(--ink-subtle)]/30"
          style={{ left: `${effectiveDuration * timelineZoom}px` }}
        />
      )}
    </div>
  );
});
