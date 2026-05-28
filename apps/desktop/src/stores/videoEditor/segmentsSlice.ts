import type { SliceCreator } from './types';
import { createZoomSegmentsSlice, type ZoomSegmentsSlice } from './segments/zoomSegments';
import { createTextSegmentsSlice, type TextSegmentsSlice } from './segments/textSegments';
import {
  createAnnotationSegmentsSlice,
  type AnnotationSegmentsSlice,
} from './segments/annotationSegments';
import { createMaskSegmentsSlice, type MaskSegmentsSlice } from './segments/maskSegments';
import { createSceneSegmentsSlice, type SceneSegmentsSlice } from './segments/sceneSegments';
import { createWebcamSegmentsSlice, type WebcamSegmentsSlice } from './segments/webcamSegments';

// Re-export the zoom region ID generator (kept here for import stability).
export { generateZoomRegionId } from './segments/zoomSegments';

/**
 * Segments state and actions for managing timeline segments
 * (zoom regions, text, mask, scene, webcam). The implementation is split into
 * one sub-slice per segment domain under `./segments/`; this interface is their
 * union and `createSegmentsSlice` merges them.
 */
export interface SegmentsSlice
  extends ZoomSegmentsSlice,
    TextSegmentsSlice,
    AnnotationSegmentsSlice,
    MaskSegmentsSlice,
    SceneSegmentsSlice,
    WebcamSegmentsSlice {}

export const createSegmentsSlice: SliceCreator<SegmentsSlice> = (set, get, store) => ({
  ...createZoomSegmentsSlice(set, get, store),
  ...createTextSegmentsSlice(set, get, store),
  ...createAnnotationSegmentsSlice(set, get, store),
  ...createMaskSegmentsSlice(set, get, store),
  ...createSceneSegmentsSlice(set, get, store),
  ...createWebcamSegmentsSlice(set, get, store),
});
