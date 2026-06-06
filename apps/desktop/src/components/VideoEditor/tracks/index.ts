// Track components
export { ZoomTrackContent } from './ZoomTrack';
export { AnnotationTrackContent } from './AnnotationTrack';
export { MaskTrackContent } from './MaskTrack';
export { TextTrackContent } from './TextTrack';
export { SceneTrack, SceneTrackContent } from './SceneTrack';
export { TrimTrackContent } from './TrimTrack';

// Base components and hooks
export {
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
} from './BaseTrack';
