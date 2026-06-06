import { memo, useCallback, useMemo } from 'react';
import { Highlighter, Plus } from 'lucide-react';
import { ANNOTATIONS } from '@/constants';
import type { AnnotationSegment } from '@/types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import {
  selectAddAnnotationSegment,
  selectBeginAnnotationDrag,
  selectCommitAnnotationDrag,
  selectDeleteAnnotationSegment,
  selectHoveredTrack,
  selectIsDraggingAnySegment,
  selectIsPlaying,
  selectPreviewTimeMs,
  selectSelectAnnotationSegment,
  selectSelectedAnnotationSegmentId,
  selectSetDraggingAnnotationSegment,
  selectSetHoveredTrack,
  selectUpdateAnnotationSegment,
} from '@/stores/videoEditor/selectors';
import { BaseSegmentItem, BaseSegmentLabel, BaseSegmentWidthGate, type BaseSegment, type SegmentTooltipPlacement } from './BaseTrack';
import { createDefaultAnnotationSegment } from '@/utils/videoAnnotations';

interface AnnotationTrackProps {
  segments: AnnotationSegment[];
  durationMs: number;
  timelineZoom: number;
  width: number;
  tooltipPlacement?: SegmentTooltipPlacement;
}

type AnnotationSegmentWithBase = AnnotationSegment & BaseSegment;

const ANNOTATION_COLORS = {
  backgroundColor: 'var(--track-annotation-bg, rgba(249, 115, 22, 0.14))',
  selectedBackgroundColor: 'var(--track-annotation-bg-selected, rgba(249, 115, 22, 0.24))',
  borderColor: 'var(--track-annotation-border, rgba(249, 115, 22, 0.55))',
  selectedBorderColor: 'var(--track-annotation-border-selected, rgba(249, 115, 22, 0.9))',
  hoverColor: 'var(--track-annotation-hover, rgba(249, 115, 22, 0.2))',
  textColor: 'var(--track-annotation-text, #9A3412)',
};

const PreviewSegment = memo(function PreviewSegment({
  startMs,
  endMs,
  timelineZoom,
}: {
  startMs: number;
  endMs: number;
  timelineZoom: number;
}) {
  const left = startMs * timelineZoom;
  const width = (endMs - startMs) * timelineZoom;

  return (
    <div
      className="absolute top-1 bottom-1 rounded-md border-2 border-dashed pointer-events-none opacity-70"
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 40)}px`,
        backgroundColor: ANNOTATION_COLORS.backgroundColor,
        borderColor: ANNOTATION_COLORS.selectedBorderColor,
      }}
    >
      <div className="flex h-full items-center justify-center" style={{ color: ANNOTATION_COLORS.textColor }}>
        <Plus className="h-4 w-4" />
      </div>
    </div>
  );
});

export const AnnotationTrackContent = memo(function AnnotationTrackContent({
  segments,
  durationMs,
  timelineZoom,
  width,
  tooltipPlacement = 'below',
}: AnnotationTrackProps) {
  const selectedAnnotationSegmentId = useVideoEditorStore(selectSelectedAnnotationSegmentId);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const hoveredTrack = useVideoEditorStore(selectHoveredTrack);
  const setHoveredTrack = useVideoEditorStore(selectSetHoveredTrack);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const isDraggingAny = useVideoEditorStore(selectIsDraggingAnySegment);
  const selectAnnotationSegment = useVideoEditorStore(selectSelectAnnotationSegment);
  const addAnnotationSegment = useVideoEditorStore(selectAddAnnotationSegment);
  const updateAnnotationSegment = useVideoEditorStore(selectUpdateAnnotationSegment);
  const deleteAnnotationSegment = useVideoEditorStore(selectDeleteAnnotationSegment);
  const setDraggingAnnotationSegment = useVideoEditorStore(selectSetDraggingAnnotationSegment);

  const previewSegmentDetails = useMemo(() => {
    if (hoveredTrack !== 'annotation' || previewTimeMs === null || isPlaying || isDraggingAny) {
      return null;
    }

    const isOnSegment = segments.some((segment) => previewTimeMs >= segment.startMs && previewTimeMs <= segment.endMs);
    if (isOnSegment) {
      return null;
    }

    const startMs = previewTimeMs;
    const endMs = Math.min(durationMs, startMs + ANNOTATIONS.DEFAULT_SEGMENT_DURATION_MS);
    if (endMs - startMs < ANNOTATIONS.MIN_SEGMENT_DURATION_MS) {
      return null;
    }

    for (const segment of segments) {
      if (startMs < segment.endMs && endMs > segment.startMs) {
        return null;
      }
    }

    return { startMs, endMs };
  }, [durationMs, hoveredTrack, isDraggingAny, isPlaying, previewTimeMs, segments]);

  const handleMouseEnter = useCallback(() => {
    setHoveredTrack('annotation');
  }, [setHoveredTrack]);

  const handleMouseLeave = useCallback(() => {
    setHoveredTrack(null);
  }, [setHoveredTrack]);

  const handleTrackClick = useCallback((event: React.MouseEvent) => {
    if (!previewSegmentDetails) {
      return;
    }

    if ((event.target as HTMLElement).closest('[data-segment]')) {
      return;
    }

    addAnnotationSegment(createDefaultAnnotationSegment(previewSegmentDetails.startMs, previewSegmentDetails.endMs));
  }, [addAnnotationSegment, previewSegmentDetails]);

  const beginAnnotationDrag = useVideoEditorStore(selectBeginAnnotationDrag);
  const commitAnnotationDrag = useVideoEditorStore(selectCommitAnnotationDrag);

  const handleDragStart = useCallback((dragging: boolean, edge?: 'start' | 'end' | 'move') => {
    if (dragging) {
      beginAnnotationDrag();
    } else {
      commitAnnotationDrag();
    }
    setDraggingAnnotationSegment(dragging, edge);
  }, [setDraggingAnnotationSegment, beginAnnotationDrag, commitAnnotationDrag]);

  return (
    <div
      className={`relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)] ${
        hoveredTrack === 'annotation' && previewSegmentDetails ? 'cursor-pointer' : ''
      }`}
      style={{ width: `${width}px` }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleTrackClick}
    >
      {segments.map((segment) => (
        <BaseSegmentItem<AnnotationSegmentWithBase>
          key={segment.id}
          segment={segment}
          isSelected={segment.id === selectedAnnotationSegmentId}
          timelineZoom={timelineZoom}
          durationMs={durationMs}
          minDurationMs={ANNOTATIONS.MIN_SEGMENT_DURATION_MS}
          onSelect={selectAnnotationSegment}
          onUpdate={updateAnnotationSegment}
          onDelete={deleteAnnotationSegment}
          onDragStart={handleDragStart}
          appearance={ANNOTATION_COLORS}
          tooltipPlacement={tooltipPlacement}
        >
          <BaseSegmentLabel icon={<Highlighter className="w-3 h-3" />}>
            <BaseSegmentWidthGate minWidth={100}>
              <span className="text-[10px] font-mono">
                {segment.shapes.length === 1 ? '1 shape' : `${segment.shapes.length} shapes`}
              </span>
            </BaseSegmentWidthGate>
          </BaseSegmentLabel>
        </BaseSegmentItem>
      ))}

      {previewSegmentDetails && (
        <PreviewSegment
          startMs={previewSegmentDetails.startMs}
          endMs={previewSegmentDetails.endMs}
          timelineZoom={timelineZoom}
        />
      )}

      {segments.length === 0 && !previewSegmentDetails && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] text-[var(--ink-subtle)]">
            Hover to add annotations
          </span>
        </div>
      )}
    </div>
  );
});
