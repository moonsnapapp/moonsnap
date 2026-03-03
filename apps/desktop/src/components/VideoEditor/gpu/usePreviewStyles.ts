/**
 * usePreviewStyles - Style calculations for video preview.
 *
 * Extracts complex style computation logic from GPUVideoPreview:
 * - Frame clipping (rounding, border)
 * - Frame shadow (drop-shadow filter)
 * - Contained size calculation (fit within preview area)
 * - Crop-based sizing
 */

import { useMemo } from 'react';
import type { BackgroundConfig, CropConfig, CompositionConfig } from '../../../types';
import { getVideoFrameShadowMetrics } from '@/utils/frameEffects';
import {
  calculateCompositionOutputSize,
  calculateFrameBoundsInComposition,
} from '@/utils/compositionBounds';
import { hasVideoBackgroundFrameStyling } from '@/utils/backgroundFrameStyling';
import { getContentDimensionsFromCrop } from '@/utils/videoContentDimensions';

interface PreviewStylesOptions {
  /** Background configuration */
  backgroundConfig: BackgroundConfig | undefined;
  /** Crop configuration */
  cropConfig: CropConfig | undefined;
  /** Original video dimensions */
  originalWidth: number;
  originalHeight: number;
  /** Container size (video area) */
  containerSize: { width: number; height: number };
  /** Preview area size (outer container) */
  previewAreaSize: { width: number; height: number };
  /** Output composition config (auto/manual) */
  compositionConfig: CompositionConfig | undefined;
}

interface PreviewStylesResult {
  /** Whether frame styling is enabled */
  hasFrameStyling: boolean;
  /** Frame clipping style (rounding, border) */
  frameClipStyle: React.CSSProperties;
  /** Frame shadow style (drop-shadow filter) */
  frameShadowStyle: React.CSSProperties;
  /** Combined frame style for SceneModeRenderer */
  frameStyle: React.CSSProperties;
  /** Preview scale factor */
  previewScale: number;
  /** Composition size including padding */
  compositionSize: { width: number; height: number };
  /** Video frame size inside composition in preview pixels */
  frameDisplaySize: { width: number; height: number };
  /** Video frame offset inside composition in preview pixels */
  frameOffset: { x: number; y: number };
  /** Composite dimensions (content + padding) */
  compositeWidth: number;
  compositeHeight: number;
  /** Video frame render size in export/master coordinates */
  frameRenderSize: { width: number; height: number };
  compositeAspectRatio: number;
  /** Whether crop is enabled and should be applied to frame */
  applyCropToFrame: boolean;
  /** Cropped frame size in parent coordinates */
  croppedFrameSizeInParent: { width: number; height: number } | null;
}

function fitCompositionToArea(
  areaWidth: number,
  areaHeight: number,
  compositionWidth: number,
  compositionHeight: number
): { width: number; height: number; scaleX: number; scaleY: number } {
  if (
    areaWidth <= 0 ||
    areaHeight <= 0 ||
    compositionWidth <= 0 ||
    compositionHeight <= 0
  ) {
    return { width: 0, height: 0, scaleX: 1, scaleY: 1 };
  }

  const fitScale = Math.min(areaWidth / compositionWidth, areaHeight / compositionHeight);
  const width = Math.max(1, Math.min(areaWidth, Math.floor(compositionWidth * fitScale)));
  const height = Math.max(1, Math.min(areaHeight, Math.floor(compositionHeight * fitScale)));
  const scaleX = width / compositionWidth;
  const scaleY = height / compositionHeight;

  return { width, height, scaleX, scaleY };
}

/**
 * Helper to convert hex color to rgba
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Hook for computing video preview styles.
 * Extracts all the complex style calculation logic from GPUVideoPreview.
 */
export function usePreviewStyles(options: PreviewStylesOptions): PreviewStylesResult {
  const {
    backgroundConfig,
    cropConfig,
    originalWidth,
    originalHeight,
    containerSize,
    previewAreaSize,
    compositionConfig,
  } = options;

  // Check if frame styling is enabled (has any visual effect)
  const hasFrameStyling = useMemo(() => {
    return hasVideoBackgroundFrameStyling(backgroundConfig);
  }, [backgroundConfig]);

  // Source video dimensions used by export after crop.
  const { width: contentWidth, height: contentHeight, cropEnabled } =
    getContentDimensionsFromCrop(cropConfig, originalWidth, originalHeight);
  const padding = backgroundConfig?.padding ?? 0;

  // Export-equivalent composition dimensions.
  const compositionOutputSize = useMemo(() => {
    if (!hasFrameStyling) {
      return { width: contentWidth, height: contentHeight };
    }
    return calculateCompositionOutputSize(contentWidth, contentHeight, padding, compositionConfig);
  }, [hasFrameStyling, contentWidth, contentHeight, padding, compositionConfig]);

  // Export-equivalent video frame bounds inside composition.
  const frameOutputBounds = useMemo(() => {
    if (!hasFrameStyling) {
      return { x: 0, y: 0, width: contentWidth, height: contentHeight };
    }
    return calculateFrameBoundsInComposition(
      contentWidth,
      contentHeight,
      padding,
      compositionOutputSize,
      compositionConfig
    );
  }, [hasFrameStyling, contentWidth, contentHeight, padding, compositionOutputSize, compositionConfig]);

  const compositeWidth = compositionOutputSize.width;
  const compositeHeight = compositionOutputSize.height;
  const compositeAspectRatio = compositeWidth / compositeHeight;

  // Check if crop is enabled with background
  const applyCropToFrame = cropEnabled && hasFrameStyling && (backgroundConfig?.padding ?? 0) > 0;

  // Calculate cropped frame size in parent coordinates
  const croppedFrameSizeInParent = useMemo(() => {
    if (!applyCropToFrame || !cropConfig || containerSize.width === 0 || containerSize.height === 0) {
      return null;
    }

    const cropAspect = cropConfig.width / cropConfig.height;
    const containerAspect = containerSize.width / containerSize.height;

    if (containerAspect > cropAspect) {
      return {
        width: containerSize.height * cropAspect,
        height: containerSize.height,
      };
    } else {
      return {
        width: containerSize.width,
        height: containerSize.width / cropAspect,
      };
    }
  }, [applyCropToFrame, cropConfig, containerSize]);

  // Calculate best-fit composition size in the preview area.
  // Cap the effective area so physical pixels never exceed the source composition
  // resolution. On high-DPI displays this avoids rendering more pixels than the
  // source video contains, which is pure waste (no extra detail exists).
  // Example: 1920x1080 source on DPR 2 → max 960x540 CSS = 1920x1080 physical.
  // DPR cap formula here must stay in sync with computeDPRCappedFitScale
  // in compositionBounds.ts (used by the CSS-transform resize fast path).
  const fittedComposition = useMemo(
    () => {
      const dpr = window.devicePixelRatio || 1;
      const maxCSSWidth = Math.ceil(compositeWidth / dpr);
      const maxCSSHeight = Math.ceil(compositeHeight / dpr);
      const effectiveWidth = Math.min(previewAreaSize.width, maxCSSWidth);
      const effectiveHeight = Math.min(previewAreaSize.height, maxCSSHeight);

      return fitCompositionToArea(
        effectiveWidth,
        effectiveHeight,
        compositeWidth,
        compositeHeight
      );
    },
    [previewAreaSize.width, previewAreaSize.height, compositeWidth, compositeHeight]
  );

  const previewScale = Math.min(fittedComposition.scaleX, fittedComposition.scaleY);
  const compositionSize = useMemo(
    () => ({ width: fittedComposition.width, height: fittedComposition.height }),
    [fittedComposition.width, fittedComposition.height]
  );

  const frameRectInPreview = useMemo(() => {
    if (!hasFrameStyling) {
      return {
        x: 0,
        y: 0,
        width: compositionSize.width,
        height: compositionSize.height,
      };
    }

    if (compositionSize.width === 0 || compositionSize.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const clampLeft = (value: number) =>
      Math.min(Math.max(value, 0), Math.max(0, compositionSize.width - 1));
    const clampTop = (value: number) =>
      Math.min(Math.max(value, 0), Math.max(0, compositionSize.height - 1));
    const clampRight = (value: number) => Math.min(Math.max(value, 1), compositionSize.width);
    const clampBottom = (value: number) => Math.min(Math.max(value, 1), compositionSize.height);

    const left = clampLeft(Math.round(frameOutputBounds.x * fittedComposition.scaleX));
    const top = clampTop(Math.round(frameOutputBounds.y * fittedComposition.scaleY));
    const right = clampRight(
      Math.round((frameOutputBounds.x + frameOutputBounds.width) * fittedComposition.scaleX)
    );
    const bottom = clampBottom(
      Math.round((frameOutputBounds.y + frameOutputBounds.height) * fittedComposition.scaleY)
    );

    const safeRight = Math.max(right, left + 1);
    const safeBottom = Math.max(bottom, top + 1);
    const width = Math.max(1, safeRight - left);
    const height = Math.max(1, safeBottom - top);

    return { x: left, y: top, width, height };
  }, [
    hasFrameStyling,
    compositionSize.width,
    compositionSize.height,
    frameOutputBounds.x,
    frameOutputBounds.y,
    frameOutputBounds.width,
    frameOutputBounds.height,
    fittedComposition.scaleX,
    fittedComposition.scaleY,
  ]);

  const frameDisplaySize = useMemo(() => {
    return {
      width: frameRectInPreview.width,
      height: frameRectInPreview.height,
    };
  }, [frameRectInPreview.height, frameRectInPreview.width]);

  const frameOffset = useMemo(() => {
    return {
      x: frameRectInPreview.x,
      y: frameRectInPreview.y,
    };
  }, [frameRectInPreview.x, frameRectInPreview.y]);

  const frameRenderSize = useMemo(
    () => ({
      width: Math.max(1, Math.round(frameOutputBounds.width)),
      height: Math.max(1, Math.round(frameOutputBounds.height)),
    }),
    [frameOutputBounds.width, frameOutputBounds.height]
  );

  // Frame clipping style (rounding, border)
  const frameClipStyle = useMemo((): React.CSSProperties => {
    if (!backgroundConfig) return {};

    const style: React.CSSProperties = {};

    const scaledRounding = backgroundConfig.rounding * previewScale;

    if (scaledRounding > 0) {
      if (backgroundConfig.roundingType === 'squircle') {
        style.clipPath = `inset(0 round ${scaledRounding * 1.2}px / ${scaledRounding}px)`;
        style.borderRadius = `${scaledRounding * 1.2}px / ${scaledRounding}px`;
      } else {
        style.clipPath = `inset(0 round ${scaledRounding}px)`;
        style.borderRadius = scaledRounding;
      }
    }

    if (backgroundConfig.border?.enabled && backgroundConfig.border.opacity > 0) {
      const scaledBorderWidth = backgroundConfig.border.width * previewScale;
      if (scaledBorderWidth <= 0) return style;
      const borderOpacity = backgroundConfig.border.opacity / 100;
      style.border = `${scaledBorderWidth}px solid ${hexToRgba(backgroundConfig.border.color, borderOpacity)}`;
    }

    return style;
  }, [backgroundConfig, previewScale]);

  // Frame shadow style (drop-shadow filter)
  const frameShadowStyle = useMemo((): React.CSSProperties => {
    if (!backgroundConfig?.shadow?.enabled) return {};

    const metrics = getVideoFrameShadowMetrics(
      backgroundConfig.shadow.shadow ?? 50,
      frameDisplaySize.width,
      frameDisplaySize.height
    );

    if (metrics.blurPx <= 0 || metrics.opacity <= 0) return {};

    return {
      filter: `drop-shadow(0 0 ${metrics.blurPx}px rgba(0, 0, 0, ${metrics.opacity}))`,
    };
  }, [
    backgroundConfig?.shadow?.enabled,
    backgroundConfig?.shadow?.shadow,
    frameDisplaySize.width,
    frameDisplaySize.height,
  ]);

  // Combined frame style for SceneModeRenderer
  const frameStyle = useMemo((): React.CSSProperties => {
    return { ...frameClipStyle };
  }, [frameClipStyle]);

  return {
    hasFrameStyling,
    frameClipStyle,
    frameShadowStyle,
    frameStyle,
    previewScale,
    compositionSize,
    frameDisplaySize,
    frameOffset,
    compositeWidth,
    compositeHeight,
    frameRenderSize,
    compositeAspectRatio,
    applyCropToFrame,
    croppedFrameSizeInParent,
  };
}
