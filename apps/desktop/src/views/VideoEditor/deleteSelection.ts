export interface DeleteSelectionState {
  selectedTrimSegmentId: string | null;
  selectedZoomRegionId: string | null;
  selectedSceneSegmentId: string | null;
  selectedMaskSegmentId: string | null;
  selectedTextSegmentId: string | null;
  selectedAnnotationSegmentId: string | null;
  selectedAnnotationShapeId: string | null;
  annotationDeleteMode: 'segment' | 'shape' | null;
}

export type DeleteSelectionAction =
  | { type: 'trim-segment'; id: string }
  | { type: 'zoom-region'; id: string }
  | { type: 'scene-segment'; id: string }
  | { type: 'mask-segment'; id: string }
  | { type: 'text-segment'; id: string }
  | { type: 'annotation-segment'; id: string }
  | { type: 'annotation-shape'; segmentId: string; shapeId: string };

export function getDeleteSelectionAction(state: DeleteSelectionState): DeleteSelectionAction | null {
  if (state.selectedTrimSegmentId) {
    return { type: 'trim-segment', id: state.selectedTrimSegmentId };
  }

  if (state.selectedZoomRegionId) {
    return { type: 'zoom-region', id: state.selectedZoomRegionId };
  }

  if (state.selectedSceneSegmentId) {
    return { type: 'scene-segment', id: state.selectedSceneSegmentId };
  }

  if (state.selectedMaskSegmentId) {
    return { type: 'mask-segment', id: state.selectedMaskSegmentId };
  }

  if (state.selectedTextSegmentId) {
    return { type: 'text-segment', id: state.selectedTextSegmentId };
  }

  if (!state.selectedAnnotationSegmentId) {
    return null;
  }

  if (state.annotationDeleteMode === 'shape' && state.selectedAnnotationShapeId) {
    return {
      type: 'annotation-shape',
      segmentId: state.selectedAnnotationSegmentId,
      shapeId: state.selectedAnnotationShapeId,
    };
  }

  return {
    type: 'annotation-segment',
    id: state.selectedAnnotationSegmentId,
  };
}
