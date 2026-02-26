import { useCallback } from 'react';
import { useVideoEditorStore, timelineToSource } from '@/stores/videoEditorStore';
import { selectTimelineSegments } from '@/stores/videoEditor/selectors';
import type { TrimSegment } from '@/types';

/**
 * Convert timeline time to source time with safe fallback when trim segments are absent.
 */
export function mapTimelineToSourceTime(
  timelineTimeMs: number,
  segments: TrimSegment[] | undefined
): number {
  if (!segments || segments.length === 0) {
    return timelineTimeMs;
  }
  return timelineToSource(timelineTimeMs, segments);
}

/**
 * Returns a stable converter function for mapping timeline time to source time.
 */
export function useTimelineToSourceTime(): (timelineTimeMs: number) => number {
  const segments = useVideoEditorStore(selectTimelineSegments);

  return useCallback(
    (timelineTimeMs: number) => mapTimelineToSourceTime(timelineTimeMs, segments),
    [segments]
  );
}
