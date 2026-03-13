/**
 * Text overlay animation defaults and limits.
 */
export const TEXT_ANIMATION = {
  DEFAULT_MODE: 'none',
  DEFAULT_FADE_DURATION_SEC: 0.15,
  DEFAULT_TYPEWRITER_CHARS_PER_SECOND: 16,
  MIN_TYPEWRITER_CHARS_PER_SECOND: 1,
  MAX_TYPEWRITER_CHARS_PER_SECOND: 60,
  TYPEWRITER_SOUND_MIN_TAIL_TRIM_SEC: 0.10,
  TYPEWRITER_SOUND_LOOP_PATH: '/sounds/fast_typing_loop_001.wav',
} as const;

export type TextAnimationConstants = typeof TEXT_ANIMATION;

/**
 * Layout rules for auto-sizing text overlay bounds.
 */
export const TEXT_LAYOUT = {
  BOX_PADDING_FACTOR: 1.4,
  DEFAULT_MAX_WIDTH_RATIO: 0.8,
  MIN_WIDTH_RATIO: 0.06,
  MIN_HEIGHT_RATIO: 0.05,
  MAX_SIZE_RATIO: 0.9,
} as const;

export type TextLayoutConstants = typeof TEXT_LAYOUT;
