import { memo, useCallback, useMemo, useRef } from 'react';
import { Video, Eye, EyeOff } from 'lucide-react';
import type { VisibilitySegment } from '../../types';
import { useVideoEditorStore, formatTimeSimple } from '../../stores/videoEditorStore';
import {
  selectDeleteWebcamSegment,
  selectSelectWebcamSegment,
  selectSelectedWebcamSegmentIndex,
  selectUpdateWebcamSegment,
} from '../../stores/videoEditor/selectors';
import { useSegmentDrag } from './tracks/BaseTrack';

interface WebcamTrackProps {
  segments: VisibilitySegment[];
  durationMs: number;
  timelineZoom: number;
  width: number;
  enabled: boolean;
}

const MIN_WEBCAM_SEGMENT_DURATION_MS = 100;

/**
 * Memoized webcam segment component.
 * Uses refs for intermediate drag state to avoid re-renders during drag.
 */
const WebcamSegmentItem = memo(function WebcamSegmentItem({
  segment,
  index,
  isSelected,
  timelineZoom,
  durationMs,
  onSelect,
  onUpdate,
  onDelete,
}: {
  segment: VisibilitySegment;
  index: number;
  isSelected: boolean;
  timelineZoom: number;
  durationMs: number;
  onSelect: (index: number) => void;
  onUpdate: (index: number, updates: Partial<VisibilitySegment>) => void;
  onDelete: (index: number) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const draggableSegment = useMemo(
    () => ({
      ...segment,
      id: `webcam-${index}`,
    }),
    [segment, index]
  );

  const left = segment.startMs * timelineZoom;
  const segmentWidth = (segment.endMs - segment.startMs) * timelineZoom;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(index);
  }, [onSelect, index]);

  const { handlePointerDown } = useSegmentDrag({
    segment: draggableSegment,
    timelineZoom,
    durationMs,
    minDurationMs: MIN_WEBCAM_SEGMENT_DURATION_MS,
    elementRef,
    tooltipRef,
    onSelect: () => onSelect(index),
    onUpdate: (_id, updates) => onUpdate(index, updates),
    onDragStart: () => {},
  });

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(index);
  }, [onDelete, index]);

  const handleToggleVisibility = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(index, { visible: !segment.visible });
  }, [segment.visible, index, onUpdate]);

  return (
    <div
      ref={elementRef}
      className={`
        absolute top-1 bottom-1 rounded-md cursor-pointer
        ${segment.visible
          ? isSelected
            ? 'bg-emerald-500/50 border-2 border-emerald-400 shadow-lg shadow-emerald-500/20'
            : 'bg-emerald-500/30 border border-emerald-500/50 hover:bg-emerald-500/40'
          : isSelected
            ? 'bg-zinc-600/50 border-2 border-zinc-400'
            : 'bg-zinc-600/30 border border-zinc-500/50 hover:bg-zinc-600/40'
        }
      `}
      style={{
        left: `${left}px`,
        width: `${Math.max(segmentWidth, 20)}px`,
      }}
      onClick={handleClick}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-emerald-400/50 rounded-l-md touch-none"
        onPointerDown={(e) => handlePointerDown(e, 'start')}
      />

      {/* Center drag handle */}
      <div
        className="absolute inset-x-2 top-0 bottom-0 cursor-move flex items-center justify-center touch-none"
        onPointerDown={(e) => handlePointerDown(e, 'move')}
      >
        {segmentWidth > 40 && (
          <button
            className={`p-1 rounded transition-colors ${
              segment.visible
                ? 'text-emerald-300/80 hover:text-emerald-200'
                : 'text-zinc-400/80 hover:text-zinc-300'
            }`}
            onClick={handleToggleVisibility}
          >
            {segment.visible ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-emerald-400/50 rounded-r-md touch-none"
        onPointerDown={(e) => handlePointerDown(e, 'end')}
      />

      {/* Delete button (shown when selected) */}
      {isSelected && (
        <button
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-xs shadow-md"
          onClick={handleDelete}
        >
          ×
        </button>
      )}

      {/* Tooltip showing time range */}
      {isSelected && (
        <div
          ref={tooltipRef}
          className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-zinc-300 text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20"
        >
          {formatTimeSimple(segment.startMs)} - {formatTimeSimple(segment.endMs)}
        </div>
      )}
    </div>
  );
});

/**
 * WebcamTrack - Displays webcam visibility segments.
 * Memoized to prevent re-renders during playback.
 */
export const WebcamTrack = memo(function WebcamTrack({ 
  segments, 
  durationMs, 
  timelineZoom, 
  width, 
  enabled 
}: WebcamTrackProps) {
  const selectedWebcamSegmentIndex = useVideoEditorStore(selectSelectedWebcamSegmentIndex);
  const selectWebcamSegment = useVideoEditorStore(selectSelectWebcamSegment);
  const updateWebcamSegment = useVideoEditorStore(selectUpdateWebcamSegment);
  const deleteWebcamSegment = useVideoEditorStore(selectDeleteWebcamSegment);

  return (
    <div 
      className={`relative h-12 ${enabled ? 'bg-zinc-800/60' : 'bg-zinc-800/30 opacity-60'}`}
      style={{ width: `${width}px` }}
    >
      {/* Track label */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-zinc-900/80 border-r border-zinc-700/50 flex items-center justify-center z-10">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Video className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">Webcam</span>
        </div>
      </div>

      {/* Visibility segments */}
      <div className="absolute left-20 top-0 bottom-0 right-0">
        {/* Background pattern for "off" areas */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 4px,
              rgba(100, 100, 100, 0.3) 4px,
              rgba(100, 100, 100, 0.3) 8px
            )`,
          }}
        />

        {segments.map((segment, index) => (
          <WebcamSegmentItem
            key={`webcam-${index}-${segment.startMs}`}
            segment={segment}
            index={index}
            isSelected={index === selectedWebcamSegmentIndex}
            timelineZoom={timelineZoom}
            durationMs={durationMs}
            onSelect={selectWebcamSegment}
            onUpdate={updateWebcamSegment}
            onDelete={deleteWebcamSegment}
          />
        ))}
      </div>
    </div>
  );
});
