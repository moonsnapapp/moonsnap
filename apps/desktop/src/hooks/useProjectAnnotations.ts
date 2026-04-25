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
import type { CanvasShape } from '../types';
import { ensureBackgroundShape } from '../utils/canvasGeometry';

/**
 * Hook that syncs project annotations to editor state.
 * Call this at the app level to ensure annotations are loaded when opening a project.
 */
export function useProjectAnnotations() {
  const { currentProject } = useCaptureStore();
  const { setShapes, setCanvasBounds, setCropRegion, setCompositorSettings, setOriginalImageSize } = useEditorStore();

  // Load annotations when project changes
  useEffect(() => {
    if (currentProject?.annotations) {
      // Separate special annotations from shape annotations using type guards
      const cropBoundsAnn = currentProject.annotations.find(isCropBoundsAnnotation);
      const cropRegionAnn = currentProject.annotations.find(isCropRegionAnnotation);
      const compositorAnn = currentProject.annotations.find(isCompositorSettingsAnnotation);
      const shapeAnnotations = currentProject.annotations.filter(
        (ann) => !isCropBoundsAnnotation(ann) && !isCropRegionAnnotation(ann) && !isCompositorSettingsAnnotation(ann)
      );

      // Load crop region: prefer new CropRegionAnnotation, fall back to legacy CropBoundsAnnotation
      if (cropRegionAnn) {
        setCropRegion({
          x: cropRegionAnn.x,
          y: cropRegionAnn.y,
          width: cropRegionAnn.width,
          height: cropRegionAnn.height,
        });
      } else if (cropBoundsAnn) {
        // Migrate legacy crop bounds → crop region
        setCropRegion({
          x: -cropBoundsAnn.imageOffsetX,
          y: -cropBoundsAnn.imageOffsetY,
          width: cropBoundsAnn.width,
          height: cropBoundsAnn.height,
        });
      } else if (currentProject.dimensions) {
        // Default artboard = full image dimensions
        setCropRegion({
          x: 0,
          y: 0,
          width: currentProject.dimensions.width,
          height: currentProject.dimensions.height,
        });
      } else {
        setCropRegion(null);
      }

      // Load crop bounds for canvas display (legacy: still used for auto-extend)
      if (cropBoundsAnn) {
        setCanvasBounds({
          width: cropBoundsAnn.width,
          height: cropBoundsAnn.height,
          imageOffsetX: cropBoundsAnn.imageOffsetX,
          imageOffsetY: cropBoundsAnn.imageOffsetY,
        });
      } else {
        setCanvasBounds(null);
      }

      // Load compositor settings if present (type is narrowed by type guard)
      if (compositorAnn) {
        setCompositorSettings({
          enabled: compositorAnn.enabled ?? DEFAULT_COMPOSITOR_SETTINGS.enabled,
          backgroundType: compositorAnn.backgroundType ?? DEFAULT_COMPOSITOR_SETTINGS.backgroundType,
          backgroundColor: compositorAnn.backgroundColor ?? DEFAULT_COMPOSITOR_SETTINGS.backgroundColor,
          gradientStart: compositorAnn.gradientStart ?? DEFAULT_COMPOSITOR_SETTINGS.gradientStart,
          gradientEnd: compositorAnn.gradientEnd ?? DEFAULT_COMPOSITOR_SETTINGS.gradientEnd,
          gradientAngle: compositorAnn.gradientAngle ?? DEFAULT_COMPOSITOR_SETTINGS.gradientAngle,
          wallpaper: compositorAnn.wallpaper ?? DEFAULT_COMPOSITOR_SETTINGS.wallpaper,
          backgroundImage: compositorAnn.backgroundImage ?? DEFAULT_COMPOSITOR_SETTINGS.backgroundImage,
          padding: compositorAnn.padding ?? DEFAULT_COMPOSITOR_SETTINGS.padding,
          borderRadius: compositorAnn.borderRadius ?? DEFAULT_COMPOSITOR_SETTINGS.borderRadius,
          borderRadiusType: compositorAnn.borderRadiusType ?? DEFAULT_COMPOSITOR_SETTINGS.borderRadiusType,
          shadowIntensity: compositorAnn.shadowIntensity ?? DEFAULT_COMPOSITOR_SETTINGS.shadowIntensity,
          borderWidth: compositorAnn.borderWidth ?? DEFAULT_COMPOSITOR_SETTINGS.borderWidth,
          borderColor: compositorAnn.borderColor ?? DEFAULT_COMPOSITOR_SETTINGS.borderColor,
          borderOpacity: compositorAnn.borderOpacity ?? DEFAULT_COMPOSITOR_SETTINGS.borderOpacity,
          aspectRatio: compositorAnn.aspectRatio ?? DEFAULT_COMPOSITOR_SETTINGS.aspectRatio,
        });
      } else {
        setCompositorSettings({ ...DEFAULT_COMPOSITOR_SETTINGS });
      }

      // Set original image size for reset functionality
      if (currentProject.dimensions) {
        setOriginalImageSize({
          width: currentProject.dimensions.width,
          height: currentProject.dimensions.height,
        });
      }

      // Convert annotations to shapes
      const projectShapes: CanvasShape[] = shapeAnnotations.map((ann) => ({
        ...ann,
        id: ann.id,
        type: ann.type,
      } as CanvasShape));

      // Ensure background shape exists at index 0
      const dims = currentProject.dimensions;
      if (dims) {
        setShapes(ensureBackgroundShape(projectShapes, dims.width, dims.height));
      } else {
        setShapes(projectShapes);
      }
    } else {
      setShapes([]);
    }
  }, [currentProject, setCanvasBounds, setCropRegion, setCompositorSettings, setOriginalImageSize, setShapes]);
}
