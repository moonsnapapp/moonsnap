import { memo, useCallback, useRef } from 'react';
import { Type, GripVertical, Plus } from 'lucide-react';
import type { TextSegment } from '../../../types';
import { formatTimeSimple } from '../../../stores/videoEditorStore';
import type { DragEdge, SegmentTooltipPlacement } from './BaseTrack';
import { useDocumentPointerDrag } from './useDocumentPointerDrag';

interface DragState {
  start: number;
  end: number;
}

export const DEFAULT_TEXT_DURATION_SEC = 3;
export const MIN_TEXT_DURATION_SEC = 0.5;

const TEXT_COLORS = {
  bg: 'var(--track-text-bg)',
  bgSelected: 'var(--track-text-bg-selected)',
  border: 'var(--track-text-border)',
  borderSelected: 'var(--track-text-border-selected)',
  hover: 'var(--track-text-hover)',
  text: 'var(--track-text-text)',
};

export const TextPreviewSegment = memo(function TextPreviewSegment({
  startSec,
  endSec,
  timelineZoom,
}: {
  startSec: number;
  endSec: number;
  timelineZoom: number;
}) {
  const left = startSec * 1000 * timelineZoom;
  const width = (endSec - startSec) * 1000 * timelineZoom;

  return (
    <div
      className="absolute top-1 bottom-1 rounded-md border-2 border-dashed pointer-events-none opacity-70"
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 40)}px`,
        backgroundColor: TEXT_COLORS.bg,
        borderColor: TEXT_COLORS.borderSelected,
      }}
    >
      <div className="flex items-center justify-center h-full" style={{ color: TEXT_COLORS.text }}>
        <Plus className="h-4 w-4" />
      </div>
    </div>
  );
});

export const TextSegmentItem = memo(function TextSegmentItem({
  segment,
  segmentId,
  isSelected,
  timelineZoom,
  durationSec,
  onSelect,
  onUpdate,
  onDelete,
  onDragStart,
  tooltipPlacement = 'below',
}: {
  segment: TextSegment;
  segmentId: string;
  isSelected: boolean;
  timelineZoom: number;
  durationSec: number;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, updates: Partial<TextSegment>) => void;
  onDelete: (id: string) => void;
  onDragStart: (dragging: boolean, edge?: DragEdge) => void;
  tooltipPlacement?: SegmentTooltipPlacement;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const startDocumentPointerDrag = useDocumentPointerDrag();

  const left = segment.start * 1000 * timelineZoom;
  const segmentWidth = (segment.end - segment.start) * 1000 * timelineZoom;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(segmentId);
  }, [onSelect, segmentId]);

  const handlePointerDown = useCallback((
    e: React.PointerEvent,
    edge: DragEdge
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const captureTarget = e.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(e.pointerId);

    onSelect(segmentId);
    onDragStart(true, edge);

    const startX = e.clientX;
    const startTimeSec = edge === 'end' ? segment.end : segment.start;
    const segmentDuration = segment.end - segment.start;

    dragStateRef.current = { start: segment.start, end: segment.end };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSec = deltaX / (timelineZoom * 1000);

      let newStart = dragStateRef.current!.start;
      let newEnd = dragStateRef.current!.end;

      if (edge === 'start') {
        newStart = Math.max(0, Math.min(segment.end - MIN_TEXT_DURATION_SEC, startTimeSec + deltaSec));
        newEnd = segment.end;
      } else if (edge === 'end') {
        newStart = segment.start;
        newEnd = Math.max(segment.start + MIN_TEXT_DURATION_SEC, Math.min(durationSec, startTimeSec + deltaSec));
      } else {
        newStart = startTimeSec + deltaSec;
        newEnd = newStart + segmentDuration;

        if (newStart < 0) {
          newStart = 0;
          newEnd = segmentDuration;
        }
        if (newEnd > durationSec) {
          newEnd = durationSec;
          newStart = durationSec - segmentDuration;
        }
      }

      dragStateRef.current = { start: newStart, end: newEnd };

      if (elementRef.current) {
        const newLeft = newStart * 1000 * timelineZoom;
        const newWidth = (newEnd - newStart) * 1000 * timelineZoom;
        elementRef.current.style.left = `${newLeft}px`;
        elementRef.current.style.width = `${Math.max(newWidth, 20)}px`;
      }

      if (tooltipRef.current) {
        tooltipRef.current.textContent = `${formatTimeSimple(newStart * 1000)} - ${formatTimeSimple(newEnd * 1000)}`;
      }
    };

    startDocumentPointerDrag({
      pointerId: e.pointerId,
      captureTarget,
      onMove: handlePointerMove,
      onCommit: () => {
        if (dragStateRef.current) {
          const { start, end } = dragStateRef.current;
          if (start !== segment.start || end !== segment.end) {
            onUpdate(segmentId, { start, end });
          }
        }
        dragStateRef.current = null;
        onDragStart(false);
      },
      onCancel: () => {
        dragStateRef.current = null;
        if (elementRef.current) {
          elementRef.current.style.left = `${left}px`;
          elementRef.current.style.width = `${Math.max(segmentWidth, 20)}px`;
        }
        if (tooltipRef.current) {
          tooltipRef.current.textContent = `${formatTimeSimple(segment.start * 1000)} - ${formatTimeSimple(segment.end * 1000)}`;
        }
        onDragStart(false);
      },
    });
  }, [segment, durationSec, timelineZoom, segmentId, onSelect, onUpdate, onDragStart, startDocumentPointerDrag, left, segmentWidth]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(segmentId);
  }, [onDelete, segmentId]);
  const tooltipClassName = tooltipPlacement === 'above'
    ? 'absolute -top-6 left-1/2 -translate-x-1/2 bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] text-[var(--ink-dark)] text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20 shadow-sm'
    : 'absolute -bottom-6 left-1/2 -translate-x-1/2 bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] text-[var(--ink-dark)] text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20 shadow-sm';

  return (
    <div
      ref={elementRef}
      data-segment
      className={`
        absolute top-1 bottom-1 rounded-md cursor-pointer
        ${isSelected ? 'border-2 shadow-lg' : 'border'}
      `}
      style={{
        left: `${left}px`,
        width: `${Math.max(segmentWidth, 20)}px`,
        backgroundColor: isSelected ? TEXT_COLORS.bgSelected : TEXT_COLORS.bg,
        borderColor: isSelected ? TEXT_COLORS.borderSelected : TEXT_COLORS.border,
      }}
      onClick={handleClick}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-md touch-none"
        onPointerDown={(e) => handlePointerDown(e, 'start')}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TEXT_COLORS.hover)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      />

      <div
        className="absolute inset-x-2 top-0 bottom-0 cursor-move flex items-center justify-center touch-none"
        onPointerDown={(e) => handlePointerDown(e, 'move')}
      >
        {segmentWidth > 60 && (
          <div className="flex items-center gap-1 overflow-hidden" style={{ color: TEXT_COLORS.text }}>
            <GripVertical className="w-3 h-3 flex-shrink-0" />
            <span className="text-[10px] font-medium truncate">
              {segment.content || 'Text'}
            </span>
          </div>
        )}
        {segmentWidth <= 60 && segmentWidth > 30 && (
          <Type className="w-3 h-3" style={{ color: TEXT_COLORS.text }} />
        )}
      </div>

      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-md touch-none"
        onPointerDown={(e) => handlePointerDown(e, 'end')}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = TEXT_COLORS.hover)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      />

      {isSelected && (
        <button
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-xs shadow-md"
          onClick={handleDelete}
        >
          x
        </button>
      )}

      {isSelected && (
        <div
          ref={tooltipRef}
          className={tooltipClassName}
        >
          {formatTimeSimple(segment.start * 1000)} - {formatTimeSimple(segment.end * 1000)}
        </div>
      )}
    </div>
  );
});
