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
  /** Video aspect ratio */
  aspectRatio: number;
  /** Crop aspect ratio (if crop enabled) */
  cropAspectRatio: number | null;
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
  /** Contained size for outer wrapper */
  containedSize: { width: number; height: number } | null;
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
  compositeAspectRatio: number;
  /** Whether crop is enabled and should be applied to frame */
  applyCropToFrame: boolean;
  /** Cropped frame size in parent coordinates */
  croppedFrameSizeInParent: { width: number; height: number } | null;
}

function toEven(value: number): number {
  return Math.floor(value / 2) * 2;
}

function calculateCompositionOutputSize(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  compositionConfig: CompositionConfig | undefined
): { width: number; height: number } {
  if (!compositionConfig || compositionConfig.mode === 'auto') {
    return {
      width: toEven(videoWidth + padding * 2),
      height: toEven(videoHeight + padding * 2),
    };
  }

  if (compositionConfig.width && compositionConfig.height) {
    return {
      width: toEven(compositionConfig.width),
      height: toEven(compositionConfig.height),
    };
  }

  if (compositionConfig.aspectRatio) {
    const videoRatio = videoWidth / videoHeight;
    const targetRatio = compositionConfig.aspectRatio;

    if (targetRatio > videoRatio) {
      const h = videoHeight + padding * 2;
      return { width: toEven(h * targetRatio), height: toEven(h) };
    }

    const w = videoWidth + padding * 2;
    return { width: toEven(w), height: toEven(w / targetRatio) };
  }

  return {
    width: toEven(videoWidth + padding * 2),
    height: toEven(videoHeight + padding * 2),
  };
}

function calculateFrameBounds(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  compositionSize: { width: number; height: number },
  compositionConfig: CompositionConfig | undefined
): { x: number; y: number; width: number; height: number } {
  const manualMode = compositionConfig?.mode === 'manual';

  if (!manualMode) {
    return {
      x: padding,
      y: padding,
      width: videoWidth,
      height: videoHeight,
    };
  }

  const availableW = Math.max(1, compositionSize.width - padding * 2);
  const availableH = Math.max(1, compositionSize.height - padding * 2);
  const videoAspect = videoWidth / videoHeight;
  const availableAspect = availableW / availableH;

  let frameWidth: number;
  let frameHeight: number;
  if (videoAspect > availableAspect) {
    frameWidth = availableW;
    frameHeight = availableW / videoAspect;
  } else {
    frameHeight = availableH;
    frameWidth = availableH * videoAspect;
  }

  return {
    x: (compositionSize.width - frameWidth) / 2,
    y: (compositionSize.height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
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
    aspectRatio,
    cropAspectRatio,
    compositionConfig,
  } = options;

  // Check if frame styling is enabled (has any visual effect)
  const hasFrameStyling = useMemo(() => {
    if (!backgroundConfig) return false;
    return Boolean(
      backgroundConfig.padding > 0 ||
      backgroundConfig.rounding > 0 ||
      backgroundConfig.shadow?.enabled ||
      backgroundConfig.border?.enabled
    );
  }, [backgroundConfig]);

  // Source video dimensions used by export after crop.
  const contentWidth = cropConfig?.enabled && cropConfig.width > 0 ? cropConfig.width : originalWidth;
  const contentHeight = cropConfig?.enabled && cropConfig.height > 0 ? cropConfig.height : originalHeight;
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
    return calculateFrameBounds(
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
  const cropEnabled = Boolean(cropConfig?.enabled && cropConfig.width > 0 && cropConfig.height > 0);
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

  // Calculate "contain" size - fit composition within preview area maintaining aspect ratio
  const containedSize = useMemo(() => {
    if (previewAreaSize.width === 0 || previewAreaSize.height === 0) {
      return null;
    }

    const targetAspect = hasFrameStyling ? compositeAspectRatio : (cropAspectRatio ?? aspectRatio);
    const areaAspect = previewAreaSize.width / previewAreaSize.height;

    if (areaAspect > targetAspect) {
      return {
        width: previewAreaSize.height * targetAspect,
        height: previewAreaSize.height,
      };
    } else {
      return {
        width: previewAreaSize.width,
        height: previewAreaSize.width / targetAspect,
      };
    }
  }, [previewAreaSize, hasFrameStyling, compositeAspectRatio, cropAspectRatio, aspectRatio]);

  // Calculate composition display scale in preview area
  const previewScale = useMemo(() => {
    if (previewAreaSize.width === 0 || previewAreaSize.height === 0) {
      return 1;
    }
    const scaleX = previewAreaSize.width / Math.max(1, compositeWidth);
    const scaleY = previewAreaSize.height / Math.max(1, compositeHeight);
    return Math.min(scaleX, scaleY);
  }, [previewAreaSize.width, previewAreaSize.height, compositeWidth, compositeHeight]);

  // Calculate composition and frame size/offset in preview coordinates
  const compositionSize = useMemo(() => {
    if (!hasFrameStyling) {
      return {
        width: containerSize.width,
        height: containerSize.height,
      };
    }

    return {
      width: Math.max(1, Math.round(compositeWidth * previewScale)),
      height: Math.max(1, Math.round(compositeHeight * previewScale)),
    };
  }, [hasFrameStyling, containerSize.width, containerSize.height, compositeWidth, compositeHeight, previewScale]);

  const frameDisplaySize = useMemo(() => {
    if (!hasFrameStyling) {
      return {
        width: containerSize.width,
        height: containerSize.height,
      };
    }
    return {
      width: Math.max(1, Math.round(frameOutputBounds.width * previewScale)),
      height: Math.max(1, Math.round(frameOutputBounds.height * previewScale)),
    };
  }, [hasFrameStyling, containerSize.width, containerSize.height, frameOutputBounds.width, frameOutputBounds.height, previewScale]);

  const frameOffset = useMemo(() => {
    if (!hasFrameStyling) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.round(frameOutputBounds.x * previewScale),
      y: Math.round(frameOutputBounds.y * previewScale),
    };
  }, [hasFrameStyling, frameOutputBounds.x, frameOutputBounds.y, previewScale]);

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

    if (backgroundConfig.border?.enabled) {
      const scaledBorderWidth = Math.max(1, backgroundConfig.border.width * previewScale);
      const borderOpacity = backgroundConfig.border.opacity / 100;
      style.border = `${scaledBorderWidth}px solid ${hexToRgba(backgroundConfig.border.color, borderOpacity)}`;
    }

    return style;
  }, [backgroundConfig, previewScale]);

  // Frame shadow style (drop-shadow filter)
  const frameShadowStyle = useMemo((): React.CSSProperties => {
    if (!backgroundConfig?.shadow?.enabled || containerSize.width === 0) return {};

    const minFrameSize = Math.min(containerSize.width, containerSize.height);
    const strength = (backgroundConfig.shadow.shadow ?? 50) / 100;
    const shadowBlur = strength * minFrameSize * 0.15;
    const shadowOpacity = strength * 0.5;

    return {
      filter: `drop-shadow(0 0 ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity}))`,
    };
  }, [backgroundConfig, containerSize]);

  // Combined frame style for SceneModeRenderer
  const frameStyle = useMemo((): React.CSSProperties => {
    return { ...frameClipStyle };
  }, [frameClipStyle]);

  return {
    hasFrameStyling,
    frameClipStyle,
    frameShadowStyle,
    frameStyle,
    containedSize,
    previewScale,
    compositionSize,
    frameDisplaySize,
    frameOffset,
    compositeWidth,
    compositeHeight,
    compositeAspectRatio,
    applyCropToFrame,
    croppedFrameSizeInParent,
  };
}
