// VideoEditor components - export all for easy importing
export { VideoTimeline } from './VideoTimeline';
export { TimelineRuler } from './TimelineRuler';
export { WebcamTrack } from './WebcamTrack';

// Track components - re-export from tracks folder
export {
  ZoomTrackContent,
  SceneTrack,
  SceneTrackContent,
  MaskTrackContent,
  TextTrackContent,
  AnnotationTrackContent,
  BaseSegmentItem,
  BaseSegmentGrip,
  BaseSegmentLabel,
  BaseSegmentWidthGate,
  BaseSegmentVisibleContent,
  useBaseSegmentComposition,
  useSegmentDrag,
  type BaseSegmentAppearance,
  type BaseSegment,
  type BaseSegmentItemProps,
  type DragEdge,
  type SegmentTooltipPlacement,
} from './tracks';
