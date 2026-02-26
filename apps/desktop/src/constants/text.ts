/**
 * Text overlay animation defaults and limits.
 */
export const TEXT_ANIMATION = {
  DEFAULT_MODE: 'none',
  DEFAULT_FADE_DURATION_SEC: 0.15,
  DEFAULT_TYPEWRITER_CHARS_PER_SECOND: 16,
  MIN_TYPEWRITER_CHARS_PER_SECOND: 1,
  MAX_TYPEWRITER_CHARS_PER_SECOND: 60,
  TYPEWRITER_SOUND_LOOP_PATH: '/sounds/fast_typing_loop_001.wav',
} as const;

export type TextAnimationConstants = typeof TEXT_ANIMATION;
