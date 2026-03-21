import { useMemo, useEffect, useState } from 'react';
import React from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { createCheckerPattern } from '../utils/canvasGeometry';
import type { CompositorSettings, CanvasBounds } from '../types';

interface BackgroundShape {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
    if (compositorSettings.backgroundType !== 'wallpaper') return;
    if (!compositorSettings.wallpaper) return;
    if (compositorSettings.backgroundImage) {
      failedWallpaperResolveRef.current = null;
      return;
    }
    if (failedWallpaperResolveRef.current === compositorSettings.wallpaper) return;

    let isCancelled = false;
    const [theme, name] = compositorSettings.wallpaper.split('/');
    if (!theme || !name) return;

    void resolveResource(`assets/backgrounds/${theme}/${name}.jpg`)
      .then((resolvedPath) => {
        if (isCancelled) return;
        failedWallpaperResolveRef.current = null;
        setCompositorSettings({ backgroundImage: convertFileSrc(resolvedPath) });
      })
      .catch(() => {
        if (!isCancelled) {
          failedWallpaperResolveRef.current = compositorSettings.wallpaper;
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    compositorSettings.backgroundType,
    compositorSettings.wallpaper,
    compositorSettings.backgroundImage,
    setCompositorSettings,
  ]);

  // Checkerboard pattern for transparency indication (created once, cached)
  const [checkerPatternImage] = useState(() => createCheckerPattern());

  // Check if source image has transparent pixels (only recalculated when image changes).
  const imageHasAlpha = useMemo(() => {
    if (!image) return false;
    const size = 20;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  }, [image]);

  // Detect if the content has ANY transparency (edges or interior).
  // When true, skip shadow/border-radius to avoid the floaty look.
  // Checks both preview bounds (visibleBounds) and export bounds (canvasBounds).
  const hasTransparency = useMemo(() => {
    const bgX = backgroundShape?.x ?? 0;
    const bgY = backgroundShape?.y ?? 0;
    const bgW = backgroundShape?.width ?? (image?.width ?? 0);
    const bgH = backgroundShape?.height ?? (image?.height ?? 0);

    // Helper: do given bounds extend beyond the background shape?
    const extendsBeyondBg = (bx: number, by: number, bw: number, bh: number) =>
      bx < bgX - 0.5 || by < bgY - 0.5 ||
      bx + bw > bgX + bgW + 0.5 || by + bh > bgY + bgH + 0.5;

    // Check 1: preview clip extends beyond background (user sees transparent areas)
    if (visibleBounds && extendsBeyondBg(visibleBounds.x, visibleBounds.y, visibleBounds.width, visibleBounds.height)) {
      return true;
    }

    // Check 2: export bounds extend beyond background (export would have transparency).
    // Must match getContentBounds() in canvasExport.ts for preview/export consistency.
    if (cropRegion && extendsBeyondBg(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height)) {
      return true;
    }
    if (!cropRegion && canvasBounds) {
      const ex = -canvasBounds.imageOffsetX;
      const ey = -canvasBounds.imageOffsetY;
      if (extendsBeyondBg(ex, ey, canvasBounds.width, canvasBounds.height)) {
        return true;
      }
    }

    // Check 3: source image itself has transparent pixels (cached by image identity)
    if (imageHasAlpha) return true;

    return false;
  }, [visibleBounds, cropRegion, canvasBounds, backgroundShape, imageHasAlpha]);

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

    let backgroundColor: string | undefined;
    let backgroundImage: string | undefined;
    let backgroundSize: string = 'cover';

    switch (compositorSettings.backgroundType) {
      case 'solid':
        backgroundColor = compositorSettings.backgroundColor;
        break;
      case 'gradient': {
        backgroundImage = `linear-gradient(${compositorSettings.gradientAngle}deg, ${compositorSettings.gradientStart}, ${compositorSettings.gradientEnd})`;
        break;
      }
      case 'wallpaper':
      case 'image':
        backgroundImage = compositorSettings.backgroundImage
          ? `url(${compositorSettings.backgroundImage})`
          : undefined;
        backgroundColor = compositorSettings.backgroundImage ? undefined : '#1a1a2e';
        // Use 'cover' to match Konva's calculateCoverSize behavior
        backgroundSize = 'cover';
        break;
      default:
        backgroundColor = '#1a1a2e';
    }

    return {
      backgroundColor,
      backgroundImage,
      backgroundSize,
      backgroundPosition: 'center',
    };
  }, [
    compositorSettings.enabled,
    compositorSettings.backgroundType,
    compositorSettings.backgroundColor,
    compositorSettings.backgroundImage,
    compositorSettings.gradientStart,
    compositorSettings.gradientEnd,
    compositorSettings.gradientAngle,
  ]);

  return {
    imageHasAlpha,
    hasTransparency,
    compositionBox,
    baseCompositionSize,
    compositionBackgroundStyle,
    checkerPatternImage,
  };
}
