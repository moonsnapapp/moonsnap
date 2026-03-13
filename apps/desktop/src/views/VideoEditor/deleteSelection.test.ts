import { describe, expect, it } from 'vitest';
import { getDeleteSelectionAction } from './deleteSelection';

describe('getDeleteSelectionAction', () => {
  it('deletes the selected annotation shape only in shape mode', () => {
    expect(getDeleteSelectionAction({
      selectedTrimSegmentId: null,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedMaskSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: 'annotation-segment-1',
      selectedAnnotationShapeId: 'annotation-shape-2',
      annotationDeleteMode: 'shape',
    })).toEqual({
      type: 'annotation-shape',
      segmentId: 'annotation-segment-1',
      shapeId: 'annotation-shape-2',
    });
  });

  it('deletes the whole annotation segment in segment mode even when a shape is selected', () => {
    expect(getDeleteSelectionAction({
      selectedTrimSegmentId: null,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedMaskSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: 'annotation-segment-1',
      selectedAnnotationShapeId: 'annotation-shape-2',
      annotationDeleteMode: 'segment',
    })).toEqual({
      type: 'annotation-segment',
      id: 'annotation-segment-1',
    });
  });

  it('falls back to deleting the whole annotation segment when no shape is selected', () => {
    expect(getDeleteSelectionAction({
      selectedTrimSegmentId: null,
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedMaskSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: 'annotation-segment-1',
      selectedAnnotationShapeId: null,
      annotationDeleteMode: 'shape',
    })).toEqual({
      type: 'annotation-segment',
      id: 'annotation-segment-1',
    });
  });

  it('keeps the existing segment priority ahead of annotations', () => {
    expect(getDeleteSelectionAction({
      selectedTrimSegmentId: 'trim-1',
      selectedZoomRegionId: null,
      selectedSceneSegmentId: null,
      selectedMaskSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: 'annotation-segment-1',
      selectedAnnotationShapeId: 'annotation-shape-1',
      annotationDeleteMode: 'shape',
    })).toEqual({
      type: 'trim-segment',
      id: 'trim-1',
    });
  });
});
