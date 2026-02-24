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
import { isCropBoundsAnnotation, isCropRegionAnnotation, isCompositorSettingsAnnotation } from '../types';
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
      }

      // Load compositor settings if present (type is narrowed by type guard)
      if (compositorAnn) {
        setCompositorSettings({
          enabled: compositorAnn.enabled,
          backgroundType: compositorAnn.backgroundType ?? 'gradient',
          backgroundColor: compositorAnn.backgroundColor ?? '#6366f1',
          gradientStart: compositorAnn.gradientStart ?? '#667eea',
          gradientEnd: compositorAnn.gradientEnd ?? '#764ba2',
          gradientAngle: compositorAnn.gradientAngle ?? 135,
          wallpaper: compositorAnn.wallpaper ?? null,
          backgroundImage: compositorAnn.backgroundImage ?? null,
          padding: compositorAnn.padding ?? 64,
          borderRadius: compositorAnn.borderRadius ?? 12,
          borderRadiusType: compositorAnn.borderRadiusType ?? 'squircle',
          shadowIntensity: compositorAnn.shadowIntensity ?? 0.5,
          borderWidth: compositorAnn.borderWidth ?? 2,
          borderColor: compositorAnn.borderColor ?? '#ffffff',
          borderOpacity: compositorAnn.borderOpacity ?? 0,
          aspectRatio: compositorAnn.aspectRatio ?? 'auto',
        });
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
