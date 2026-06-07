import { useMemo } from 'react';
import { getZoomStateAt } from './useZoomPreview';
import type { ZoomRegion } from '../types';

/** Matches Rust `ZOOM_MOTION_BLUR_WINDOW_MS` so preview and export agree. */
const ZOOM_MOTION_BLUR_WINDOW_MS = 100;

function isRegionActiveAt(region: ZoomRegion, timeMs: number) {
  return timeMs > region.startMs && timeMs <= region.endMs;
}

function getLaterRegion(left: ZoomRegion | undefined, right: ZoomRegion) {
  return !left || right.endMs > left.endMs ? right : left;
}

function getRecentlyEndedRegion(regions: ZoomRegion[], timeMs: number) {
  return regions
    .filter((region) => region.endMs <= timeMs)
    .reduce<ZoomRegion | undefined>(getLaterRegion, undefined);
}

function getRegionMotionBlur(region: ZoomRegion | undefined) {
  return region?.motionBlur ?? 0;
}

/**
 * Pick the zoom region driving the motion at `timeMs`. Mirrors
 * `ZoomInterpolator::motion_blur_at` in `crates/moonsnap-render/src/zoom.rs`:
 * prefer the active region, fall back to the most recently ended one (so
 * zoom-out tails inherit the originating region's setting).
 */
function activeRegionMotionBlur(regions: ZoomRegion[], timeMs: number): number {
  const active = regions.find((region) => isRegionActiveAt(region, timeMs));
  return getRegionMotionBlur(active ?? getRecentlyEndedRegion(regions, timeMs));
}

function clampMotionBlurAmount(amount: number) {
  return Math.max(0, Math.min(2, amount));
}

function hasVisibleMotionBlurAmount(amount: number) {
  return amount > 0.001;
}

function getZoomMotionBlurSamples(regions: ZoomRegion[], currentTimeMs: number) {
  return {
    prev: getZoomStateAt(regions, Math.max(0, currentTimeMs - ZOOM_MOTION_BLUR_WINDOW_MS)),
    current: getZoomStateAt(regions, currentTimeMs),
    next: getZoomStateAt(regions, currentTimeMs + ZOOM_MOTION_BLUR_WINDOW_MS),
  };
}

function getZoomCenterDistance(
  prev: { centerX: number; centerY: number },
  next: { centerX: number; centerY: number },
) {
  const dx = next.centerX - prev.centerX;
  const dy = next.centerY - prev.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getZoomMotionBlurPx(regions: ZoomRegion[], currentTimeMs: number, amount: number) {
  const { prev, current, next } = getZoomMotionBlurSamples(regions, currentTimeMs);
  const scaleDelta = Math.abs(next.scale - prev.scale);
  const centerDistance = getZoomCenterDistance(prev, next);

  // Mirrors `calculate_zoom_motion_blur` in moonsnap-render. CSS filter is
  // isotropic so we collapse directional + radial into one max() value and
  // halve the result - gaussian blur reads stronger than the shader's
  // single-axis smear at the same px count.
  const directionalPx = Math.min(centerDistance * Math.max(1, current.scale) * 150 * amount, 35);
  const radialPx = Math.min(scaleDelta * 100 * amount, 30);
  return Math.max(directionalPx, radialPx) * 0.5;
}

function formatZoomMotionBlurFilter(blurPx: number) {
  return blurPx < 0.4 ? undefined : `blur(${blurPx.toFixed(2)}px)`;
}

function calculateZoomMotionBlurFilter(
  regions: ZoomRegion[] | undefined,
  currentTimeMs: number,
) {
  if (!regions || regions.length === 0) return undefined;

  const amount = clampMotionBlurAmount(activeRegionMotionBlur(regions, currentTimeMs));
  if (!hasVisibleMotionBlurAmount(amount)) return undefined;

  return formatZoomMotionBlurFilter(getZoomMotionBlurPx(regions, currentTimeMs, amount));
}

/**
 * Returns a CSS `filter` value (e.g. `blur(3px)`) that mirrors the GPU
 * shader's zoom motion blur for the JS-rendered live preview.
 *
 * CSS blur is isotropic where the shader is directional, but for fast zoom
 * transitions the visual cue (soft edges during the ease) lines up well
 * enough to let users tune the slider without exporting.
 */
export function useZoomMotionBlurFilter(
  regions: ZoomRegion[] | undefined,
  currentTimeMs: number
): string | undefined {
  return useMemo(
    () => calculateZoomMotionBlurFilter(regions, currentTimeMs),
    [regions, currentTimeMs]
  );
}
