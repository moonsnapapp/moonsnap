/**
 * Editor Actions Hook
 *
 * Extracted from App.tsx to centralize editor save/export logic.
 * Handles copy to clipboard, save to file, and save as different formats.
 */

import { useState, useCallback } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import Konva from 'konva';
import { useCaptureStore } from '../stores/captureStore';
import { useEditorStore } from '../stores/editorStore';
import { exportToClipboard, exportToFile } from '../utils/canvasExport';
import { reportError } from '../utils/errorReporting';
import type { Annotation, CropRegionAnnotation } from '../types';

interface UseEditorActionsProps {
  stageRef: React.RefObject<Konva.Stage | null>;
  /** Optional image data for standalone windows that don't use captureStore */
  imageData?: string | null;
}

type SaveImageFormat = 'png' | 'jpg' | 'webp';

const IMAGE_FORMATS: Record<SaveImageFormat, {
  ext: SaveImageFormat;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  name: string;
  quality?: number;
}> = {
  png: { ext: 'png', mime: 'image/png', name: 'PNG' },
  jpg: { ext: 'jpg', mime: 'image/jpeg', name: 'JPEG', quality: 0.92 },
  webp: { ext: 'webp', mime: 'image/webp', name: 'WebP', quality: 0.9 },
};

function getSaveImageFormat(filePath: string): typeof IMAGE_FORMATS[SaveImageFormat] {
  const extension = filePath.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase();

  if (extension === 'jpg' || extension === 'jpeg') {
    return IMAGE_FORMATS.jpg;
  }

  if (extension === 'webp') {
    return IMAGE_FORMATS.webp;
  }

  return IMAGE_FORMATS.png;
}

export function useEditorActions({ stageRef, imageData }: UseEditorActionsProps) {
  const [isCopying, setIsCopying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { currentProject, currentImageData, updateAnnotations } = useCaptureStore();
  const { shapes, canvasBounds, cropRegion, compositorSettings } = useEditorStore();

  // Use provided imageData or fall back to store value
  const hasImageData = imageData ?? currentImageData;

  /**
   * Save all project annotations (shapes, crop bounds, compositor settings).
   */
  const saveProjectAnnotations = useCallback(async () => {
    if (!currentProject) return;

    // Exclude imageSrc for background shapes (loaded from project image)
    const shapeAnnotations: Annotation[] = shapes.map((shape) => {
      if (shape.isBackground) {
        const { imageSrc: _unused, ...rest } = shape;
        void _unused;
        return { ...rest } as Annotation;
      }
      return { ...shape } as Annotation;
    });

    const annotations = [...shapeAnnotations];
    if (canvasBounds) {
      annotations.push({
        id: '__crop_bounds__',
        type: '__crop_bounds__',
        width: canvasBounds.width,
        height: canvasBounds.height,
        imageOffsetX: canvasBounds.imageOffsetX,
        imageOffsetY: canvasBounds.imageOffsetY,
      } as Annotation);
    }

    // Save crop region if set
    if (cropRegion) {
      const cropRegionAnn: CropRegionAnnotation = {
        id: '__crop_region__',
        type: '__crop_region__',
        x: cropRegion.x,
        y: cropRegion.y,
        width: cropRegion.width,
        height: cropRegion.height,
      };
      annotations.push(cropRegionAnn);
    }

    // Save all compositor settings
    annotations.push({
      id: '__compositor_settings__',
      type: '__compositor_settings__',
      ...compositorSettings,
    } as Annotation);

    await updateAnnotations(annotations);
  }, [currentProject, shapes, canvasBounds, cropRegion, compositorSettings, updateAnnotations]);

  /**
   * Copy canvas to clipboard (browser native API - faster than Rust for clipboard).
   */
  const handleCopy = useCallback(async () => {
    if (!stageRef.current || !hasImageData) return;

    setIsCopying(true);
    try {
      await exportToClipboard(stageRef, canvasBounds, compositorSettings, cropRegion);
      toast.success('Copied to clipboard');
    } catch (error) {
      reportError(error, { operation: 'copy to clipboard' });
    } finally {
      setIsCopying(false);
    }
  }, [stageRef, hasImageData, canvasBounds, compositorSettings, cropRegion]);

  /**
   * Save to file (browser toBlob + Tauri writeFile - no IPC serialization).
   */
  const handleSave = useCallback(async () => {
    if (!stageRef.current || !hasImageData) return;

    setIsSaving(true);
    try {
      await saveProjectAnnotations();

      const filePath = await save({
        defaultPath: `capture_${Date.now()}.png`,
        filters: [
          { name: 'PNG', extensions: ['png'] },
          { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
          { name: 'WebP', extensions: ['webp'] },
        ],
      });

      if (filePath) {
        const formatInfo = getSaveImageFormat(filePath);
        await exportToFile(stageRef, canvasBounds, compositorSettings, filePath, {
          format: formatInfo.mime,
          quality: formatInfo.quality,
        }, cropRegion);
        toast.success('Image saved successfully');
      }
    } catch (error) {
      reportError(error, { operation: 'save image' });
    } finally {
      setIsSaving(false);
    }
  }, [stageRef, hasImageData, canvasBounds, compositorSettings, cropRegion, saveProjectAnnotations]);

  /**
   * Save to file with specific format.
   */
  const handleSaveAs = useCallback(
    async (format: 'png' | 'jpg' | 'webp') => {
      if (!stageRef.current || !hasImageData) return;

      setIsSaving(true);
      try {
        const formatInfo = IMAGE_FORMATS[format];

        const filePath = await save({
          defaultPath: `capture_${Date.now()}.${formatInfo.ext}`,
          filters: [{ name: formatInfo.name, extensions: [formatInfo.ext] }],
        });

        if (filePath) {
          await exportToFile(stageRef, canvasBounds, compositorSettings, filePath, {
            format: formatInfo.mime,
            quality: formatInfo.quality,
          }, cropRegion);
          toast.success(`Image saved as ${formatInfo.name}`);
        }
      } catch (error) {
        reportError(error, { operation: 'export image' });
      } finally {
        setIsSaving(false);
      }
    },
    [stageRef, hasImageData, canvasBounds, compositorSettings, cropRegion]
  );

  return {
    isCopying,
    isSaving,
    handleCopy,
    handleSave,
    handleSaveAs,
    saveProjectAnnotations,
  };
}
