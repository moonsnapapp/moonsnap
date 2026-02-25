import { clamp } from '@/utils/math';

export interface VideoFrameShadowMetrics {
  blurPx: number;
  opacity: number;
}

export interface EditorShadowLayer {
  blurPx: number;
  offsetY: number;
  opacity: number;
}

const VIDEO_SHADOW_BLUR_SCALE = 0.15;
const VIDEO_SHADOW_OPACITY_SCALE = 0.5;

const EDITOR_SHADOW_LAYER_FACTORS = [
  { blur: 10, offsetY: 2, opacity: 0.15 },
  { blur: 30, offsetY: 8, opacity: 0.25 },
  { blur: 60, offsetY: 16, opacity: 0.35 },
] as const;

/**
 * Matches the compositor shader:
 * - strength = shadowPercent / 100
 * - blur = strength * min(frameSize / 2) * 0.15
 * - opacity = strength * 0.5
 */
export function getVideoFrameShadowMetrics(
  shadowPercent: number,
  frameWidth: number,
  frameHeight: number
): VideoFrameShadowMetrics {
  if (frameWidth <= 0 || frameHeight <= 0) {
    return { blurPx: 0, opacity: 0 };
  }

  const strength = clamp(shadowPercent, 0, 100) / 100;
  const minHalfFrameSize = Math.min(frameWidth, frameHeight) * 0.5;

  return {
    blurPx: strength * minHalfFrameSize * VIDEO_SHADOW_BLUR_SCALE,
    opacity: strength * VIDEO_SHADOW_OPACITY_SCALE,
  };
}

/**
 * Editor shadow layers shared by preview and export.
 */
export function getEditorShadowLayers(intensity: number): EditorShadowLayer[] {
  const clampedIntensity = clamp(intensity, 0, 1);
  if (clampedIntensity <= 0) return [];

  return EDITOR_SHADOW_LAYER_FACTORS.map((layer) => ({
    blurPx: layer.blur * clampedIntensity,
    offsetY: layer.offsetY * clampedIntensity,
    opacity: layer.opacity * clampedIntensity,
  }));
}

export function getEditorShadowCss(layers: EditorShadowLayer[]): string {
  return layers
    .map(
      (layer) =>
        `0 ${layer.offsetY}px ${layer.blurPx}px rgba(0, 0, 0, ${layer.opacity})`
    )
    .join(', ');
}
