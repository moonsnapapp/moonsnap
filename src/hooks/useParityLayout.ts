/**
 * useParityLayout - Consumes parity constants from Rust for CSS preview.
 *
 * This hook ensures CSS preview uses the exact same layout values as GPU export.
 * All magic numbers flow from Rust's parity module - never hardcode layout values in React.
 */

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import type { ParityLayout } from '@/types/generated/ParityLayout';
import type { CompositionBounds } from '@/types/generated/CompositionBounds';
import type { FontMetrics } from '@/types/generated/FontMetrics';

// Cached layout - loaded once at app startup
let cachedLayout: ParityLayout | null = null;

/**
 * Initialize parity layout from Rust.
 * Call this once at app startup before any components render.
 */
export async function initParityLayout(): Promise<ParityLayout> {
  if (cachedLayout) return cachedLayout;
  cachedLayout = await invoke<ParityLayout>('get_parity_layout');
  return cachedLayout;
}

/**
 * Get the cached parity layout.
 * Throws if initParityLayout hasn't been called yet.
 */
export function getParityLayout(): ParityLayout {
  if (!cachedLayout) {
    throw new Error('Parity layout not initialized. Call initParityLayout() at app startup.');
  }
  return cachedLayout;
}

/**
 * Hook to get parity layout constants.
 * Returns null until layout is loaded.
 */
export function useParityLayout(): ParityLayout | null {
  const [layout, setLayout] = useState<ParityLayout | null>(cachedLayout);

  useEffect(() => {
    if (!cachedLayout) {
      initParityLayout().then(setLayout);
    }
  }, []);

  return layout;
}

/**
 * Hook to get scaled layout values for a given container height.
 * All caption/background values scale relative to 1080p reference.
 */
export function useScaledLayout(containerHeight: number) {
  const layout = useParityLayout();

  return useMemo(() => {
    if (!layout || containerHeight === 0) {
      return null;
    }

    const scale = containerHeight / layout.referenceHeight;

    return {
      scale,
      captionPadding: layout.captionPadding * scale,
      captionBgPaddingH: layout.captionBgPaddingH * scale,
      captionBgPaddingV: layout.captionBgPaddingV * scale,
      captionCornerRadius: layout.captionCornerRadius * scale,
      lineHeightMultiplier: layout.lineHeightMultiplier,
      defaultBgPadding: layout.defaultBgPadding * scale,
      defaultBgRounding: layout.defaultBgRounding * scale,
    };
  }, [layout, containerHeight]);
}

// Font metrics cache
const fontMetricsCache = new Map<string, FontMetrics>();

/**
 * Get font metrics for a given font family and size.
 * Results are cached to avoid repeated Tauri calls.
 */
export async function getFontMetrics(
  family: string,
  size: number,
  weight: number = 400
): Promise<FontMetrics> {
  const cacheKey = `${family}:${size}:${weight}`;

  if (fontMetricsCache.has(cacheKey)) {
    return fontMetricsCache.get(cacheKey)!;
  }

  const metrics = await invoke<FontMetrics>('get_font_metrics', {
    family,
    size,
    weight,
  });

  fontMetricsCache.set(cacheKey, metrics);
  return metrics;
}

/**
 * Hook to get composition bounds from Rust.
 * Ensures preview uses identical frame positioning as export.
 */
export function useCompositionBounds(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  manualWidth?: number,
  manualHeight?: number
) {
  const [bounds, setBounds] = useState<CompositionBounds | null>(null);

  useEffect(() => {
    if (videoWidth === 0 || videoHeight === 0) {
      setBounds(null);
      return;
    }

    invoke<CompositionBounds>('get_composition_bounds', {
      videoWidth,
      videoHeight,
      padding,
      manualWidth: manualWidth ?? null,
      manualHeight: manualHeight ?? null,
    }).then(setBounds);
  }, [videoWidth, videoHeight, padding, manualWidth, manualHeight]);

  return bounds;
}

/**
 * Sync version of composition bounds calculation for use in useMemo.
 * Only use when you need synchronous calculation and already have layout.
 */
export function calculateCompositionBoundsSync(
  _layout: ParityLayout,
  videoWidth: number,
  videoHeight: number,
  padding: number,
  manualOutput?: { width: number; height: number }
): CompositionBounds {
  const videoAspect = videoWidth / videoHeight;

  if (!manualOutput) {
    // Auto mode
    return {
      outputWidth: videoWidth + padding * 2,
      outputHeight: videoHeight + padding * 2,
      frameX: padding,
      frameY: padding,
      frameWidth: videoWidth,
      frameHeight: videoHeight,
      effectivePadding: padding,
    };
  }

  // Manual mode
  const { width: fixedW, height: fixedH } = manualOutput;
  const availableW = Math.max(1, fixedW - padding * 2);
  const availableH = Math.max(1, fixedH - padding * 2);
  const availableAspect = availableW / availableH;

  let frameW: number;
  let frameH: number;

  if (videoAspect > availableAspect) {
    frameW = availableW;
    frameH = availableW / videoAspect;
  } else {
    frameH = availableH;
    frameW = availableH * videoAspect;
  }

  return {
    outputWidth: fixedW,
    outputHeight: fixedH,
    frameX: (fixedW - frameW) / 2,
    frameY: (fixedH - frameH) / 2,
    frameWidth: frameW,
    frameHeight: frameH,
    effectivePadding: padding,
  };
}
