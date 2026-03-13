/**
 * Webcam overlay motion tuning for screen zoom interactions.
 */
export const WEBCAM = {
  ZOOM_SHRINK_PER_SCALE_UNIT: 0.2,
  MIN_ZOOM_SIZE_FACTOR: 0.72,
} as const;

export type WebcamConstants = typeof WEBCAM;
