/**
 * @deprecated Import from '@/stores/videoEditor' instead.
 * This file re-exports from the new modular location for backwards compatibility.
 */
export {
  useVideoEditorStore,
  createVideoEditorStore,
  generateZoomRegionId,
  formatTimecode,
  formatTimeSimple,
  sanitizeProjectForSave,
  DEFAULT_TIMELINE_ZOOM,
  TRACK_LABEL_WIDTH,
  getFitZoom,
  // Trim slice exports
  generateTrimSegmentId,
  timelineToSource,
  sourceToTimeline,
  getEffectiveDuration,
  getSegmentTimelinePosition,
  findSegmentAtSourceTime,
  findSegmentIndexAtTimelineTime,
  MIN_TRIM_SEGMENT_DURATION_MS,
  MIN_TRIM_SEGMENT_SPEED,
  MAX_TRIM_SEGMENT_SPEED,
  DEFAULT_FULL_SEGMENT_ID,
} from './videoEditor';

export type {
  VideoEditorState,
  VideoEditorStore,
  PlaybackSlice,
  TimelineSlice,
  SegmentsSlice,
  ExportSlice,
  ProjectSlice,
  GPUEditorSlice,
  TrimSlice,
} from './videoEditor';
