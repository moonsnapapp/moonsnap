export type InvalidRangeFallback = 'min' | 'midpoint';

/**
 * Clamp a value between min and max when range is valid.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp with explicit behavior for invalid ranges.
 */
export function clampWithFallback(
  value: number,
  min: number,
  max: number,
  fallback: InvalidRangeFallback = 'min'
): number {
  if (min <= max) {
    return clamp(value, min, max);
  }

  return fallback === 'midpoint' ? (min + max) / 2 : min;
}
