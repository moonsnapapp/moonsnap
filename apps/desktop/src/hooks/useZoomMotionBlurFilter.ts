import { useMemo } from 'react';
import { getZoomStateAt } from './useZoomPreview';
import type { ZoomRegion } from '../types';

/** Matches Rust `ZOOM_MOTION_BLUR_WINDOW_MS` so preview and export agree. */
const ZOOM_MOTION_BLUR_WINDOW_MS = 100;

/**
 * Pick the zoom region driving the motion at `timeMs`. Mirrors
 * `ZoomInterpolator::motion_blur_at` in `crates/moonsnap-render/src/zoom.rs`:
 * prefer the active region, fall back to the most recently ended one (so
 * zoom-out tails inherit the originating region's setting).
 */
function activeRegionMotionBlur(regions: ZoomRegion[], timeMs: number): number {
  const active = regions.find((r) => timeMs > r.startMs && timeMs <= r.endMs);
  if (active) return active.motionBlur ?? 0;

  let recent: ZoomRegion | undefined;
  for (const r of regions) {
    if (r.endMs <= timeMs && (!recent || r.endMs > recent.endMs)) {
      recent = r;
    }
  }
  return recent ? (recent.motionBlur ?? 0) : 0;
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
  return useMemo(() => {
    if (!regions || regions.length === 0) return undefined;
    const a = Math.max(0, Math.min(2, activeRegionMotionBlur(regions, currentTimeMs)));
    if (a <= 0.001) return undefined;

    const prev = getZoomStateAt(regions, Math.max(0, currentTimeMs - ZOOM_MOTION_BLUR_WINDOW_MS));
    const current = getZoomStateAt(regions, currentTimeMs);
    const next = getZoomStateAt(regions, currentTimeMs + ZOOM_MOTION_BLUR_WINDOW_MS);

    const scaleDelta = Math.abs(next.scale - prev.scale);
    const dx = next.centerX - prev.centerX;
    const dy = next.centerY - prev.centerY;
    const centerDistance = Math.sqrt(dx * dx + dy * dy);

    // Mirrors `calculate_zoom_motion_blur` in moonsnap-render. CSS filter is
    // isotropic so we collapse directional + radial into one max() value and
    // halve the result — gaussian blur reads "stronger" than the shader's
    // single-axis smear at the same px count.
    const directionalPx = Math.min(centerDistance * Math.max(1, current.scale) * 150 * a, 35);
    const radialPx = Math.min(scaleDelta * 100 * a, 30);
    const blurPx = Math.max(directionalPx, radialPx) * 0.5;

    if (blurPx < 0.4) return undefined;
    return `blur(${blurPx.toFixed(2)}px)`;
  }, [regions, currentTimeMs]);
}
