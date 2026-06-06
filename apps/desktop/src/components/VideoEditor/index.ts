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
  BaseSegmentItem,
  BaseSegmentLabel,
  BaseSegmentWidthGate,
  BaseSegmentVisibleContent,
  useBaseSegmentComposition,
  useSegmentDrag,
  type BaseSegment,
  type BaseSegmentItemProps,
  type DragEdge,
} from './tracks';
