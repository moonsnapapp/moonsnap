export const LICENSE = {
  PURCHASE_URL: 'https://buy.polar.sh/polar_cl_WDZB2ld3wEqqWTOustdiNZHASOHMOz4lxlsZ03VjJfx',
  FREE_MODE_DISABLED_FEATURES: [
    'Video export',
    'GIF export',
    'Webcam overlays',
    'Auto captions',
    'Custom backgrounds',
  ],
} as const;

export type LicenseConstants = typeof LICENSE;
