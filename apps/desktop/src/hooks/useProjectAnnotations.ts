/**
 * Project Annotations Hook
 *
 * Syncs project annotations to editor state when a project is loaded.
 * Handles:
 * - Background shape initialization
 * - Crop region restoration (new) and crop bounds migration (legacy)
 * - Compositor settings restoration
 * - Original image size tracking
 * - Shape annotation conversion
 *
 * Extracted from App.tsx for better separation of concerns.
 */

import { useEffect } from 'react';
import { useCaptureStore } from '../stores/captureStore';
import { useEditorStore } from '../stores/editorStore';
import {
  isCropBoundsAnnotation,
  isCropRegionAnnotation,
  isCompositorSettingsAnnotation,
  DEFAULT_COMPOSITOR_SETTINGS,
} from '../types';
import type {
  Annotation,
  CanvasBounds,
  CanvasShape,
  CompositorSettingsAnnotation,
  CropBoundsAnnotation,
  CropRegionAnnotation,
  Dimensions,
  Region,
} from '../types';
import { ensureBackgroundShape } from '../utils/canvasGeometry';

interface ProjectAnnotationParts {
  cropBoundsAnn: CropBoundsAnnotation | undefined;
  cropRegionAnn: CropRegionAnnotation | undefined;
  compositorAnn: CompositorSettingsAnnotation | undefined;
  shapeAnnotations: Annotation[];
}

function splitProjectAnnotations(annotations: Annotation[]): ProjectAnnotationParts {
  return {
    cropBoundsAnn: annotations.find(isCropBoundsAnnotation),
    cropRegionAnn: annotations.find(isCropRegionAnnotation),
    compositorAnn: annotations.find(isCompositorSettingsAnnotation),
    shapeAnnotations: annotations.filter(
      (ann) =>
        !isCropBoundsAnnotation(ann) &&
        !isCropRegionAnnotation(ann) &&
        !isCompositorSettingsAnnotation(ann)
    ),
  };
}

function getRestoredCropRegion(
  cropRegionAnn: CropRegionAnnotation | undefined,
  cropBoundsAnn: CropBoundsAnnotation | undefined,
  dimensions: Dimensions | undefined
): Region | null {
  if (cropRegionAnn) {
    return {
      x: cropRegionAnn.x,
      y: cropRegionAnn.y,
      width: cropRegionAnn.width,
      height: cropRegionAnn.height,
    };
  }

  if (cropBoundsAnn) {
    return {
      x: -cropBoundsAnn.imageOffsetX,
      y: -cropBoundsAnn.imageOffsetY,
      width: cropBoundsAnn.width,
      height: cropBoundsAnn.height,
    };
  }

  return dimensions
    ? { x: 0, y: 0, width: dimensions.width, height: dimensions.height }
    : null;
}

function getRestoredCanvasBounds(
  cropBoundsAnn: CropBoundsAnnotation | undefined
): CanvasBounds | null {
  return cropBoundsAnn
    ? {
        width: cropBoundsAnn.width,
        height: cropBoundsAnn.height,
        imageOffsetX: cropBoundsAnn.imageOffsetX,
        imageOffsetY: cropBoundsAnn.imageOffsetY,
      }
    : null;
}

function getRestoredCompositorSettings(
  compositorAnn: CompositorSettingsAnnotation | undefined
) {
  if (!compositorAnn) {
    return { ...DEFAULT_COMPOSITOR_SETTINGS };
  }

  const { id: _id, type: _type, ...savedSettings } = compositorAnn;
  return {
    ...DEFAULT_COMPOSITOR_SETTINGS,
    ...savedSettings,
  };
}

function getProjectShapes(
  shapeAnnotations: Annotation[],
  dimensions: Dimensions | undefined
): CanvasShape[] {
  const projectShapes = shapeAnnotations.map((ann) => ({
    ...ann,
    id: ann.id,
    type: ann.type,
  } as CanvasShape));

  return dimensions
    ? ensureBackgroundShape(projectShapes, dimensions.width, dimensions.height)
    : projectShapes;
}

function getOriginalImageSize(dimensions: Dimensions | undefined): Dimensions | null {
  return dimensions ? { width: dimensions.width, height: dimensions.height } : null;
}

/**
 * Hook that syncs project annotations to editor state.
 * Call this at the app level to ensure annotations are loaded when opening a project.
 */
export function useProjectAnnotations() {
  const { currentProject } = useCaptureStore();
  const {
    setShapes,
    setCanvasBounds,
    setCropRegion,
    setCompositorSettings,
    setOriginalImageSize,
  } = useEditorStore();

  useEffect(() => {
    if (!currentProject?.annotations) {
      setShapes([]);
      return;
    }

    const {
      cropBoundsAnn,
      cropRegionAnn,
      compositorAnn,
      shapeAnnotations,
    } = splitProjectAnnotations(currentProject.annotations);

    setCropRegion(
      getRestoredCropRegion(cropRegionAnn, cropBoundsAnn, currentProject.dimensions)
    );
    setCanvasBounds(getRestoredCanvasBounds(cropBoundsAnn));
    setCompositorSettings(getRestoredCompositorSettings(compositorAnn));

    const originalImageSize = getOriginalImageSize(currentProject.dimensions);
    if (originalImageSize) {
      setOriginalImageSize(originalImageSize);
    }

    setShapes(getProjectShapes(shapeAnnotations, currentProject.dimensions));
  }, [
    currentProject,
    setCanvasBounds,
    setCropRegion,
    setCompositorSettings,
    setOriginalImageSize,
    setShapes,
  ]);
}
