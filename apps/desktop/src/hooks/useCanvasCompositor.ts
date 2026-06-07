import { useMemo, useEffect, useState } from 'react';
import React from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { createCheckerPattern } from '../utils/canvasGeometry';
import type { CompositorSettings, CanvasBounds, BackgroundType } from '../types';

interface BackgroundShape {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface BackgroundBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseCanvasCompositorProps {
  image: HTMLImageElement | undefined;
  compositorSettings: CompositorSettings;
  setCompositorSettings: (settings: Partial<CompositorSettings>) => void;
  visibleBounds: { x: number; y: number; width: number; height: number } | null;
  cropRegion: { x: number; y: number; width: number; height: number } | null;
  canvasBounds: CanvasBounds | null;
  backgroundShape: BackgroundShape | undefined;
  renderBounds: { x: number; y: number; width: number; height: number } | null;
  navigation: {
    zoom: number;
    position: { x: number; y: number };
  };
}

interface UseCanvasCompositorReturn {
  imageHasAlpha: boolean;
  hasTransparency: boolean;
  compositionBox: { width: number; height: number; left: number; top: number } | null;
  baseCompositionSize: { width: number; height: number };
  compositionBackgroundStyle: React.CSSProperties;
  checkerPatternImage: HTMLImageElement | null;
}

const FALLBACK_BACKGROUND_COLOR = '#1a1a2e';
const CENTERED_BACKGROUND_STYLE = {
  backgroundPosition: 'center',
} satisfies React.CSSProperties;

type BackgroundStyleRenderer = (settings: CompositorSettings) => React.CSSProperties;

function getImageBackgroundStyle(settings: CompositorSettings): React.CSSProperties {
  return {
    backgroundColor: settings.backgroundImage ? undefined : FALLBACK_BACKGROUND_COLOR,
    backgroundImage: settings.backgroundImage ? `url(${settings.backgroundImage})` : undefined,
    backgroundSize: 'cover',
    ...CENTERED_BACKGROUND_STYLE,
  };
}

const BACKGROUND_STYLE_RENDERERS: Record<BackgroundType, BackgroundStyleRenderer> = {
  solid: (settings) => ({
    backgroundColor: settings.backgroundColor,
    ...CENTERED_BACKGROUND_STYLE,
  }),
  gradient: (settings) => ({
    backgroundImage: `linear-gradient(${settings.gradientAngle}deg, ${settings.gradientStart}, ${settings.gradientEnd})`,
    backgroundSize: 'cover',
    ...CENTERED_BACKGROUND_STYLE,
  }),
  wallpaper: getImageBackgroundStyle,
  image: getImageBackgroundStyle,
};

function getBackgroundBounds(
  backgroundShape: BackgroundShape | undefined,
  imageSize: { width: number; height: number }
): BackgroundBounds {
  if (!backgroundShape) {
    return {
      x: 0,
      y: 0,
      width: imageSize.width,
      height: imageSize.height,
    };
  }

  const {
    x = 0,
    y = 0,
    width = imageSize.width,
    height = imageSize.height,
  } = backgroundShape;

  return {
    x,
    y,
    width,
    height,
  };
}

function getCompositionBackgroundStyle(
  compositorSettings: CompositorSettings
): React.CSSProperties {
  return BACKGROUND_STYLE_RENDERERS[compositorSettings.backgroundType](compositorSettings);
}

function contentExtendsBeyondBackground(
  bounds: ContentBounds,
  background: BackgroundBounds
) {
  return (
    bounds.x < background.x - 0.5 ||
    bounds.y < background.y - 0.5 ||
    bounds.x + bounds.width > background.x + background.width + 0.5 ||
    bounds.y + bounds.height > background.y + background.height + 0.5
  );
}

function getExportContentBounds(
  cropRegion: ContentBounds | null,
  canvasBounds: CanvasBounds | null
): ContentBounds | null {
  if (cropRegion) {
    return cropRegion;
  }

  if (!canvasBounds) {
    return null;
  }

  return {
    x: -canvasBounds.imageOffsetX,
    y: -canvasBounds.imageOffsetY,
    width: canvasBounds.width,
    height: canvasBounds.height,
  };
}

function hasTransparentContent({
  visibleBounds,
  cropRegion,
  canvasBounds,
  background,
  imageHasAlpha,
}: {
  visibleBounds: ContentBounds | null;
  cropRegion: ContentBounds | null;
  canvasBounds: CanvasBounds | null;
  background: BackgroundBounds;
  imageHasAlpha: boolean;
}) {
  const exportBounds = getExportContentBounds(cropRegion, canvasBounds);
  const visibleContentOverflows =
    visibleBounds !== null && contentExtendsBeyondBackground(visibleBounds, background);
  const exportContentOverflows =
    exportBounds !== null && contentExtendsBeyondBackground(exportBounds, background);

  return [
    imageHasAlpha,
    visibleContentOverflows,
    exportContentOverflows,
  ].some(Boolean);
}

function sampleImageAlpha(image: HTMLImageElement, sampleSize: number) {
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.drawImage(image, 0, 0, sampleSize, sampleSize);
  return ctx.getImageData(0, 0, sampleSize, sampleSize).data;
}

function hasAlphaPixel(data: Uint8ClampedArray) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }

  return false;
}

function imageContainsAlpha(image: HTMLImageElement | null | undefined) {
  if (!image) {
    return false;
  }

  const data = sampleImageAlpha(image, 20);
  return data ? hasAlphaPixel(data) : false;
}

function getImageSizeForBackground(image: HTMLImageElement | null | undefined) {
  if (!image) {
    return { width: 0, height: 0 };
  }

  return {
    width: image.width,
    height: image.height,
  };
}

interface WallpaperResolveRequest {
  wallpaper: string;
  resourcePath: string;
}

function getPendingWallpaperName(
  compositorSettings: CompositorSettings,
  failedWallpaper: string | null
): string | null {
  const canResolve = [
    compositorSettings.backgroundType === 'wallpaper',
    Boolean(compositorSettings.wallpaper),
    !compositorSettings.backgroundImage,
    failedWallpaper !== compositorSettings.wallpaper,
  ].every(Boolean);

  return canResolve ? compositorSettings.wallpaper : null;
}

function getWallpaperResourcePath(wallpaper: string) {
  const [theme, name] = wallpaper.split('/');
  const hasThemeAndName = [theme, name].every(Boolean);
  return hasThemeAndName ? `assets/backgrounds/${theme}/${name}.jpg` : null;
}

function getWallpaperResolveRequest(
  compositorSettings: CompositorSettings,
  failedWallpaper: string | null
): WallpaperResolveRequest | null {
  const wallpaper = getPendingWallpaperName(compositorSettings, failedWallpaper);
  if (!wallpaper) return null;

  const resourcePath = getWallpaperResourcePath(wallpaper);
  if (!resourcePath) return null;

  return {
    wallpaper,
    resourcePath,
  };
}

function startWallpaperBackgroundResolution({
  compositorSettings,
  failedWallpaperResolveRef,
  setCompositorSettings,
}: {
  compositorSettings: CompositorSettings;
  failedWallpaperResolveRef: React.MutableRefObject<string | null>;
  setCompositorSettings: (settings: Partial<CompositorSettings>) => void;
}) {
  if (compositorSettings.backgroundType !== 'wallpaper') return undefined;

  if (compositorSettings.backgroundImage) {
    failedWallpaperResolveRef.current = null;
  }

  const request = getWallpaperResolveRequest(
    compositorSettings,
    failedWallpaperResolveRef.current
  );
  if (!request) return undefined;

  let isCancelled = false;

  void resolveResource(request.resourcePath)
    .then((resolvedPath) => {
      if (isCancelled) return;
      failedWallpaperResolveRef.current = null;
      setCompositorSettings({ backgroundImage: convertFileSrc(resolvedPath) });
    })
    .catch(() => {
      if (!isCancelled) {
        failedWallpaperResolveRef.current = request.wallpaper;
      }
    });

  return () => {
    isCancelled = true;
  };
}

export function useCanvasCompositor({
  image,
  compositorSettings,
  setCompositorSettings,
  visibleBounds,
  cropRegion,
  canvasBounds,
  backgroundShape,
  renderBounds,
  navigation,
}: UseCanvasCompositorProps): UseCanvasCompositorReturn {
  const failedWallpaperResolveRef = React.useRef<string | null>(null);

  // Auto-resolve wallpaper URL so default/loaded wallpaper backgrounds initialize
  // without requiring a manual wallpaper click in the Style tab.
  useEffect(() => {
    return startWallpaperBackgroundResolution({
      compositorSettings,
      failedWallpaperResolveRef,
      setCompositorSettings,
    });
  }, [
    compositorSettings,
    setCompositorSettings,
  ]);

  // Checkerboard pattern for transparency indication (created once, cached)
  const [checkerPatternImage] = useState(() => createCheckerPattern());

  // Check if source image has transparent pixels (only recalculated when image changes).
  const imageHasAlpha = useMemo(() => {
    return imageContainsAlpha(image);
  }, [image]);

  // Detect if the content has ANY transparency (edges or interior).
  // When true, skip shadow/border-radius to avoid the floaty look.
  // Checks both preview bounds (visibleBounds) and export bounds (canvasBounds).
  const hasTransparency = useMemo(() => {
    return hasTransparentContent({
      visibleBounds,
      cropRegion,
      canvasBounds,
      background: getBackgroundBounds(backgroundShape, getImageSizeForBackground(image)),
      imageHasAlpha,
    });
  }, [visibleBounds, cropRegion, canvasBounds, backgroundShape, image, imageHasAlpha]);

  // Composition box dimensions (for CSS preview background)
  // Simple calculation: content size + padding on each side, scaled by zoom
  const compositionBox = useMemo(() => {
    if (!compositorSettings.enabled || !renderBounds) return null;

    const padding = compositorSettings.padding * navigation.zoom;
    const contentWidth = renderBounds.width * navigation.zoom;
    const contentHeight = renderBounds.height * navigation.zoom;

    // Position: content position in screen space, offset by padding
    const left = navigation.position.x + renderBounds.x * navigation.zoom - padding;
    const top = navigation.position.y + renderBounds.y * navigation.zoom - padding;
    const width = contentWidth + padding * 2;
    const height = contentHeight + padding * 2;

    return { width, height, left, top };
  }, [compositorSettings.enabled, compositorSettings.padding, renderBounds, navigation.zoom, navigation.position]);

  // Base composition size for consistent background scaling
  const baseCompositionSize = useMemo(() => {
    if (!renderBounds) return { width: 0, height: 0 };

    const padding = compositorSettings.padding;

    return {
      width: renderBounds.width + padding * 2,
      height: renderBounds.height + padding * 2,
    };
  }, [renderBounds, compositorSettings.padding]);

  // Background style for composition box
  const compositionBackgroundStyle = useMemo((): React.CSSProperties => {
    if (!compositorSettings.enabled) return {};

    return getCompositionBackgroundStyle(compositorSettings);
  }, [compositorSettings]);

  return {
    imageHasAlpha,
    hasTransparency,
    compositionBox,
    baseCompositionSize,
    compositionBackgroundStyle,
    checkerPatternImage,
  };
}
