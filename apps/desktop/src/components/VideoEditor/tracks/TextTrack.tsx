import { memo, useCallback, useMemo } from 'react';
import type { TextSegment } from '../../../types';
import { TEXT_ANIMATION, TEXT_STYLE } from '../../../constants';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import { fitTextSegmentToContent } from '../../../utils/textMeasure';
import {
  selectAddTextSegment,
  selectDeleteTextSegment,
  selectHoveredTrack,
  selectIsDraggingAnySegment,
  selectIsPlaying,
  selectOriginalVideoHeight,
  selectOriginalVideoWidth,
  selectPreviewTimeMs,
  selectSelectTextSegment,
  selectSelectedTextSegmentId,
  selectSetDraggingTextSegment,
  selectSetHoveredTrack,
  selectUpdateTextSegment,
} from '../../../stores/videoEditor/selectors';
import { createTextSegmentId } from '../../../utils/textSegmentId';
import type { SegmentTooltipPlacement } from './BaseTrack';
import {
  DEFAULT_TEXT_DURATION_SEC,
  MIN_TEXT_DURATION_SEC,
  TextPreviewSegment,
  TextSegmentItem,
} from './TextTrackComposition';

/**
 * TextTrack uses seconds for time values (matching Cap's model),
 * while other tracks use milliseconds. This component handles the
 * conversion internally rather than using BaseSegmentItem directly.
 */

interface TextTrackProps {
  segments: TextSegment[];
  durationMs: number;
  timelineZoom: number;
  width: number;
  tooltipPlacement?: SegmentTooltipPlacement;
}

/**
 * TextTrackContent - Track content without label for two-column layout.
 * Uses Cap's model: time in seconds, center-based positioning.
 * Memoized to prevent re-renders during playback.
 */
export const TextTrackContent = memo(function TextTrackContent({
  segments,
  durationMs,
  timelineZoom,
  width,
  tooltipPlacement = 'below',
}: TextTrackProps) {
  const selectedTextSegmentId = useVideoEditorStore(selectSelectedTextSegmentId);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const hoveredTrack = useVideoEditorStore(selectHoveredTrack);
  const setHoveredTrack = useVideoEditorStore(selectSetHoveredTrack);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const selectTextSegment = useVideoEditorStore(selectSelectTextSegment);
  const updateTextSegment = useVideoEditorStore(selectUpdateTextSegment);
  const deleteTextSegment = useVideoEditorStore(selectDeleteTextSegment);
  const addTextSegment = useVideoEditorStore(selectAddTextSegment);
  const setDraggingTextSegment = useVideoEditorStore(selectSetDraggingTextSegment);

  // Duration in seconds
  const durationSec = durationMs / 1000;

  // Check if any segment is being dragged
  const isDraggingAny = useVideoEditorStore(selectIsDraggingAnySegment);

  // Calculate preview segment details when hovering
  const previewSegmentDetails = useMemo(() => {
    // Only show preview when hovering over this track, not playing, and not dragging
    if (hoveredTrack !== 'text' || previewTimeMs === null || isPlaying || isDraggingAny) {
      return null;
    }

    const previewTimeSec = previewTimeMs / 1000;

    // Check if hovering over an existing segment
    const isOnSegment = segments.some(
      (seg) => previewTimeSec >= seg.start && previewTimeSec <= seg.end
    );

    if (isOnSegment) {
      return null;
    }

    // Calculate preview segment bounds - left edge at playhead
    const startSec = previewTimeSec;
    const endSec = Math.min(durationSec, startSec + DEFAULT_TEXT_DURATION_SEC);

    // Don't allow if there's not enough space for minimum duration
    if (endSec - startSec < MIN_TEXT_DURATION_SEC) {
      return null;
    }

    // Check for collisions with existing segments
    for (const seg of segments) {
      if (startSec < seg.end && endSec > seg.start) {
        return null;
      }
    }

    return { startSec, endSec };
  }, [hoveredTrack, previewTimeMs, isPlaying, isDraggingAny, segments, durationSec]);

  // Handle track hover
  const handleMouseEnter = useCallback(() => {
    setHoveredTrack('text');
  }, [setHoveredTrack]);

  const handleMouseLeave = useCallback(() => {
    setHoveredTrack(null);
  }, [setHoveredTrack]);

  // Get video dimensions for text measurement
  const videoWidth = useVideoEditorStore(selectOriginalVideoWidth);
  const videoHeight = useVideoEditorStore(selectOriginalVideoHeight);

  // Handle click to add segment
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    // Only add if we have a valid preview segment
    if (!previewSegmentDetails) return;

    // Don't add if clicking on a segment
    if ((e.target as HTMLElement).closest('[data-segment]')) return;

    // Default text properties
    const content = 'Text';
    const fontFamily = 'sans-serif';
    const fontSize = 48;
    const fontWeight = 700;
    const size = fitTextSegmentToContent(
      {
        content,
        fontFamily,
        fontSize,
        fontWeight,
        italic: false,
      },
      videoWidth,
      videoHeight,
    );

    // Create new segment with Cap's model
    const newSegment: TextSegment = {
      start: previewSegmentDetails.startSec,
      end: previewSegmentDetails.endSec,
      enabled: true,
      content,
      center: { x: 0.5, y: 0.5 },
      size,
      fontFamily,
      fontSize,
      fontWeight,
      italic: false,
      color: TEXT_STYLE.DEFAULT_COLOR,
      backgroundColor: null,
      backgroundStrokeColor: null,
      backgroundStrokeWidth: 0,
      strokeColor: null,
      strokeWidth: 0,
      fadeDuration: TEXT_ANIMATION.DEFAULT_FADE_DURATION_SEC,
      animation: TEXT_ANIMATION.DEFAULT_MODE,
      typewriterCharsPerSecond: TEXT_ANIMATION.DEFAULT_TYPEWRITER_CHARS_PER_SECOND,
      typewriterSoundEnabled: false,
    };

    // addTextSegment handles selection internally after sorting
    addTextSegment(newSegment);
  }, [previewSegmentDetails, addTextSegment, videoWidth, videoHeight]);

  return (
    <div
      className={`relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)] ${
        hoveredTrack === 'text' && previewSegmentDetails ? 'cursor-pointer' : ''
      }`}
      style={{ width: `${width}px` }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleTrackClick}
    >
      {segments.map((segment, index) => {
        const segmentId = createTextSegmentId(segment.start, index);
        return (
          <TextSegmentItem
            key={`text_segment_${index}`}
            segment={segment}
            segmentId={segmentId}
            isSelected={segmentId === selectedTextSegmentId}
            timelineZoom={timelineZoom}
            durationSec={durationSec}
            onSelect={selectTextSegment}
            onUpdate={updateTextSegment}
            onDelete={deleteTextSegment}
            onDragStart={setDraggingTextSegment}
            tooltipPlacement={tooltipPlacement}
          />
        );
      })}

      {/* Preview segment (ghost) when hovering over empty space */}
      {previewSegmentDetails && (
        <TextPreviewSegment
          startSec={previewSegmentDetails.startSec}
          endSec={previewSegmentDetails.endSec}
          timelineZoom={timelineZoom}
        />
      )}

      {/* Empty state hint */}
      {segments.length === 0 && !previewSegmentDetails && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] text-[var(--ink-subtle)]">
            Hover to add text overlays
          </span>
        </div>
      )}
    </div>
  );
});
