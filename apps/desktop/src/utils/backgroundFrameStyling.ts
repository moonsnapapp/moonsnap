import type { BackgroundConfig } from '@/types';

/**
 * Whether video background frame styling should be applied.
 * Styling is active only when background is enabled and at least one
 * frame-related effect is present.
 */
export function hasVideoBackgroundFrameStyling(
  background: BackgroundConfig | undefined | null
): boolean {
  if (!background?.enabled) return false;

  return Boolean(
    background.padding > 0 ||
      background.rounding > 0 ||
      background.shadow?.enabled ||
      background.border?.enabled
  );
}
