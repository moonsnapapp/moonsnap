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
import { generateSquircleClipPathFromRadius, generateSquircleBorderClipPath } from '@/utils/squircle';

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
  /** Border overlay style for squircle mode (rendered as a separate div on top of content) */
  frameBorderOverlayStyle: React.CSSProperties | null;
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

function hasPositiveDimensions(...values: number[]) {
  return values.every((value) => value > 0);
}

function fitCompositionToArea(
  areaWidth: number,
  areaHeight: number,
  compositionWidth: number,
  compositionHeight: number
): { width: number; height: number; scaleX: number; scaleY: number } {
  if (!hasPositiveDimensions(areaWidth, areaHeight, compositionWidth, compositionHeight)) {
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

function getPreviewCompositionOutputSize(
  hasFrameStyling: boolean,
  contentWidth: number,
  contentHeight: number,
  padding: number,
  compositionConfig: CompositionConfig | undefined,
) {
  if (!hasFrameStyling) {
    return { width: contentWidth, height: contentHeight };
  }

  return calculateCompositionOutputSize(contentWidth, contentHeight, padding, compositionConfig);
}

function getPreviewFrameOutputBounds(
  hasFrameStyling: boolean,
  contentWidth: number,
  contentHeight: number,
  padding: number,
  compositionOutputSize: { width: number; height: number },
  compositionConfig: CompositionConfig | undefined,
) {
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
}

function shouldApplyCropToFrame(
  cropEnabled: boolean,
  hasFrameStyling: boolean,
  backgroundConfig: BackgroundConfig | undefined,
) {
  if (!cropEnabled || !hasFrameStyling) {
    return false;
  }

  return hasBackgroundPadding(backgroundConfig);
}

function hasBackgroundPadding(backgroundConfig: BackgroundConfig | undefined) {
  return (backgroundConfig?.padding ?? 0) > 0;
}

function getCroppedFrameSizeInParent(
  applyCropToFrame: boolean,
  cropConfig: CropConfig | undefined,
  containerSize: { width: number; height: number },
) {
  if (!canCalculateCroppedFrameSize(applyCropToFrame, cropConfig, containerSize)) {
    return null;
  }

  return fitAspectRatioInsideContainer(
    cropConfig.width / cropConfig.height,
    containerSize
  );
}

function canCalculateCroppedFrameSize(
  applyCropToFrame: boolean,
  cropConfig: CropConfig | undefined,
  containerSize: { width: number; height: number },
): cropConfig is CropConfig {
  return Boolean(
    applyCropToFrame &&
    cropConfig &&
    containerSize.width > 0 &&
    containerSize.height > 0
  );
}

function fitAspectRatioInsideContainer(
  cropAspect: number,
  containerSize: { width: number; height: number },
) {
  const containerAspect = containerSize.width / containerSize.height;

  if (containerAspect > cropAspect) {
    return {
      width: containerSize.height * cropAspect,
      height: containerSize.height,
    };
  }

  return {
    width: containerSize.width,
    height: containerSize.width / cropAspect,
  };
}

function getDprCappedFittedComposition(
  previewAreaSize: { width: number; height: number },
  compositeWidth: number,
  compositeHeight: number,
) {
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
}

function clampPreviewFrameRectValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getFrameRectInPreview(
  hasFrameStyling: boolean,
  compositionSize: { width: number; height: number },
  frameOutputBounds: { x: number; y: number; width: number; height: number },
  fittedComposition: { scaleX: number; scaleY: number },
) {
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

  const left = clampPreviewFrameRectValue(
    Math.round(frameOutputBounds.x * fittedComposition.scaleX),
    0,
    Math.max(0, compositionSize.width - 1),
  );
  const top = clampPreviewFrameRectValue(
    Math.round(frameOutputBounds.y * fittedComposition.scaleY),
    0,
    Math.max(0, compositionSize.height - 1),
  );
  const right = clampPreviewFrameRectValue(
    Math.round((frameOutputBounds.x + frameOutputBounds.width) * fittedComposition.scaleX),
    1,
    compositionSize.width,
  );
  const bottom = clampPreviewFrameRectValue(
    Math.round((frameOutputBounds.y + frameOutputBounds.height) * fittedComposition.scaleY),
    1,
    compositionSize.height,
  );

  const safeRight = Math.max(right, left + 1);
  const safeBottom = Math.max(bottom, top + 1);

  return {
    x: left,
    y: top,
    width: Math.max(1, safeRight - left),
    height: Math.max(1, safeBottom - top),
  };
}

function getFrameClipStyle(
  backgroundConfig: BackgroundConfig | undefined,
  previewScale: number,
  frameDisplaySize: { width: number; height: number },
  isSquircle: boolean,
): React.CSSProperties {
  if (!backgroundConfig) return {};

  const style: React.CSSProperties = {};
  applyFrameRoundingClip(style, backgroundConfig, previewScale, frameDisplaySize, isSquircle);
  applyFrameBorderClip(style, backgroundConfig, previewScale, isSquircle);
  return style;
}

function applyFrameRoundingClip(
  style: React.CSSProperties,
  backgroundConfig: BackgroundConfig,
  previewScale: number,
  frameDisplaySize: { width: number; height: number },
  isSquircle: boolean,
) {
  const scaledRounding = backgroundConfig.rounding * previewScale;
  if (!hasVisibleRounding(scaledRounding)) {
    return;
  }

  if (canApplySquircleRoundingClip(isSquircle, frameDisplaySize)) {
    applySquircleRoundingClip(style, scaledRounding, frameDisplaySize);
    return;
  }

  applyInsetRoundingClip(style, scaledRounding);
}

function hasVisibleRounding(scaledRounding: number) {
  return scaledRounding > 0;
}

function canApplySquircleRoundingClip(
  isSquircle: boolean,
  frameDisplaySize: { width: number; height: number },
) {
  return isSquircle && hasPositiveFrameSize(frameDisplaySize);
}

function applySquircleRoundingClip(
  style: React.CSSProperties,
  scaledRounding: number,
  frameDisplaySize: { width: number; height: number },
) {
  style.clipPath = generateSquircleClipPathFromRadius(
    scaledRounding,
    frameDisplaySize.width,
    frameDisplaySize.height
  );
}

function applyInsetRoundingClip(style: React.CSSProperties, scaledRounding: number) {
  style.clipPath = `inset(0 round ${scaledRounding}px)`;
  style.borderRadius = scaledRounding;
}

function applyFrameBorderClip(
  style: React.CSSProperties,
  backgroundConfig: BackgroundConfig,
  previewScale: number,
  isSquircle: boolean,
) {
  const borderStyle = getFrameBorderStyle(backgroundConfig, previewScale, isSquircle);
  if (!borderStyle) return;

  style.border = borderStyle;
}

function getFrameBorderStyle(
  backgroundConfig: BackgroundConfig,
  previewScale: number,
  isSquircle: boolean,
) {
  const border = backgroundConfig.border;
  if (!canApplyFrameBorderClip(border, previewScale, isSquircle)) return null;

  const scaledBorderWidth = getScaledBorderWidth(border.width, previewScale);
  const borderOpacity = border.opacity / 100;
  return `${scaledBorderWidth}px solid ${hexToRgba(border.color, borderOpacity)}`;
}

function getScaledBorderWidth(borderWidth: number, previewScale: number) {
  return borderWidth * previewScale;
}

function canApplyFrameBorderClip(
  border: BackgroundConfig['border'],
  previewScale: number,
  isSquircle: boolean,
) {
  if (!hasVisibleFrameBorder(border)) return false;
  if (isSquircle) return false;

  return getScaledBorderWidth(border.width, previewScale) > 0;
}

function hasVisibleFrameBorder(
  border: BackgroundConfig['border'],
): border is NonNullable<BackgroundConfig['border']> {
  return Boolean(border?.enabled && border.opacity > 0);
}

function hasVisibleBackgroundBorder(backgroundConfig: BackgroundConfig | undefined): boolean {
  return Boolean(
    backgroundConfig?.border?.enabled &&
    (backgroundConfig.border.opacity ?? 0) > 0
  );
}

function hasPositiveFrameSize(frameDisplaySize: { width: number; height: number }): boolean {
  return frameDisplaySize.width > 0 && frameDisplaySize.height > 0;
}

function canRenderSquircleBorderOverlay({
  isSquircle,
  backgroundConfig,
  scaledBorderWidth,
  frameDisplaySize,
}: {
  isSquircle: boolean;
  backgroundConfig: BackgroundConfig | undefined;
  scaledBorderWidth: number;
  frameDisplaySize: { width: number; height: number };
}) {
  return Boolean(
    isSquircle &&
    hasVisibleBackgroundBorder(backgroundConfig) &&
    scaledBorderWidth > 0 &&
    hasPositiveFrameSize(frameDisplaySize)
  );
}

function getSquircleBorderOverlayStyle({
  backgroundConfig,
  previewScale,
  frameDisplaySize,
}: {
  backgroundConfig: BackgroundConfig;
  previewScale: number;
  frameDisplaySize: { width: number; height: number };
}): React.CSSProperties {
  const scaledBorderWidth = backgroundConfig.border.width * previewScale;
  const scaledRounding = backgroundConfig.rounding * previewScale;
  const borderOpacity = backgroundConfig.border.opacity / 100;
  const borderColor = hexToRgba(backgroundConfig.border.color, borderOpacity);
  const overlayWidth = frameDisplaySize.width + 2 * scaledBorderWidth;
  const overlayHeight = frameDisplaySize.height + 2 * scaledBorderWidth;

  return {
    position: 'absolute',
    top: -scaledBorderWidth,
    left: -scaledBorderWidth,
    width: overlayWidth,
    height: overlayHeight,
    pointerEvents: 'none',
    zIndex: -1,
    backgroundColor: borderColor,
    clipPath: generateSquircleBorderClipPath(
      scaledRounding + scaledBorderWidth,
      scaledBorderWidth,
      overlayWidth,
      overlayHeight
    ),
  };
}

function getFrameBorderOverlayStyle({
  isSquircle,
  backgroundConfig,
  previewScale,
  frameDisplaySize,
}: {
  isSquircle: boolean;
  backgroundConfig: BackgroundConfig | undefined;
  previewScale: number;
  frameDisplaySize: { width: number; height: number };
}): React.CSSProperties | null {
  if (!backgroundConfig) return null;

  const scaledBorderWidth = getScaledBorderWidth(backgroundConfig.border.width, previewScale);
  if (!canRenderSquircleBorderOverlay({
    isSquircle,
    backgroundConfig,
    scaledBorderWidth,
    frameDisplaySize,
  })) {
    return null;
  }

  return getSquircleBorderOverlayStyle({
    backgroundConfig,
    previewScale,
    frameDisplaySize,
  });
}

function getFrameShadowStyle(
  backgroundConfig: BackgroundConfig | undefined,
  frameDisplaySize: { width: number; height: number },
): React.CSSProperties {
  if (!canCalculateFrameShadow(backgroundConfig)) return {};

  const metrics = getVideoFrameShadowMetrics(
    backgroundConfig.shadow.shadow ?? 50,
    frameDisplaySize.width,
    frameDisplaySize.height
  );

  if (!hasVisibleFrameShadow(metrics)) return {};

  return {
    filter: `drop-shadow(0 0 ${metrics.blurPx}px rgba(0, 0, 0, ${metrics.opacity}))`,
  };
}

function hasVisibleFrameShadow(metrics: { blurPx: number; opacity: number }) {
  return metrics.blurPx > 0 && metrics.opacity > 0;
}

function canCalculateFrameShadow(
  backgroundConfig: BackgroundConfig | undefined,
): backgroundConfig is BackgroundConfig & { shadow: NonNullable<BackgroundConfig['shadow']> } {
  return Boolean(backgroundConfig?.shadow?.enabled);
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
    return getPreviewCompositionOutputSize(
      hasFrameStyling,
      contentWidth,
      contentHeight,
      padding,
      compositionConfig
    );
  }, [hasFrameStyling, contentWidth, contentHeight, padding, compositionConfig]);

  // Export-equivalent video frame bounds inside composition.
  const frameOutputBounds = useMemo(() => {
    return getPreviewFrameOutputBounds(
      hasFrameStyling,
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
  const applyCropToFrame = shouldApplyCropToFrame(cropEnabled, hasFrameStyling, backgroundConfig);

  // Calculate cropped frame size in parent coordinates
  const croppedFrameSizeInParent = useMemo(() => {
    return getCroppedFrameSizeInParent(applyCropToFrame, cropConfig, containerSize);
  }, [applyCropToFrame, cropConfig, containerSize]);

  // Calculate best-fit composition size in the preview area.
  // Cap the effective area so physical pixels never exceed the source composition
  // resolution. On high-DPI displays this avoids rendering more pixels than the
  // source video contains, which is pure waste (no extra detail exists).
  // Example: 1920x1080 source on DPR 2 → max 960x540 CSS = 1920x1080 physical.
  // DPR cap formula here must stay in sync with computeDPRCappedFitScale
  // in compositionBounds.ts (used by the CSS-transform resize fast path).
  const fittedComposition = useMemo(
    () => getDprCappedFittedComposition(previewAreaSize, compositeWidth, compositeHeight),
    [previewAreaSize, compositeWidth, compositeHeight]
  );

  const previewScale = Math.min(fittedComposition.scaleX, fittedComposition.scaleY);
  const compositionSize = useMemo(
    () => ({ width: fittedComposition.width, height: fittedComposition.height }),
    [fittedComposition.width, fittedComposition.height]
  );

  const frameRectInPreview = useMemo(() => {
    return getFrameRectInPreview(
      hasFrameStyling,
      compositionSize,
      frameOutputBounds,
      fittedComposition
    );
  }, [
    hasFrameStyling,
    compositionSize,
    frameOutputBounds,
    fittedComposition,
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

  const isSquircle = backgroundConfig?.roundingType === 'squircle';

  // Frame clipping style (rounding, border)
  const frameClipStyle = useMemo((): React.CSSProperties => {
    return getFrameClipStyle(backgroundConfig, previewScale, frameDisplaySize, isSquircle);
  }, [backgroundConfig, previewScale, frameDisplaySize, isSquircle]);

  // Squircle border overlay — extends OUTWARD from the video frame. Positioned
  // outside the clipped frame div (in the shadow wrapper) so it isn't clipped.
  // Uses a ring-shaped path(evenodd) where the outer edge is a larger squircle
  // and the inner edge matches the frame's squircle boundary.
  const frameBorderOverlayStyle = useMemo((): React.CSSProperties | null => {
    return getFrameBorderOverlayStyle({
      isSquircle,
      backgroundConfig,
      previewScale,
      frameDisplaySize,
    });
  }, [isSquircle, backgroundConfig, previewScale, frameDisplaySize]);

  // Frame shadow style (drop-shadow filter)
  const frameShadowStyle = useMemo((): React.CSSProperties => {
    return getFrameShadowStyle(backgroundConfig, frameDisplaySize);
  }, [backgroundConfig, frameDisplaySize]);

  // Combined frame style for SceneModeRenderer
  const frameStyle = useMemo((): React.CSSProperties => {
    return { ...frameClipStyle };
  }, [frameClipStyle]);

  return {
    hasFrameStyling,
    frameClipStyle,
    frameShadowStyle,
    frameStyle,
    frameBorderOverlayStyle,
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
