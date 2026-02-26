import { describe, expect, it } from 'vitest';
import type { BackgroundConfig } from '@/types';
import { hasVideoBackgroundFrameStyling } from '@/utils/backgroundFrameStyling';

function makeBackground(overrides?: Partial<BackgroundConfig>): BackgroundConfig {
  return {
    enabled: false,
    bgType: 'solid',
    solidColor: '#000000',
    gradientStart: '#000000',
    gradientEnd: '#111111',
    gradientAngle: 135,
    wallpaper: null,
    imagePath: null,
    blur: 0,
    padding: 0,
    inset: 0,
    rounding: 0,
    roundingType: 'rounded',
    shadow: { enabled: false, shadow: 0 },
    border: { enabled: false, width: 2, color: '#ffffff', opacity: 0 },
    ...overrides,
  };
}

describe('hasVideoBackgroundFrameStyling', () => {
  it('returns false for undefined/null/disabled background', () => {
    expect(hasVideoBackgroundFrameStyling(undefined)).toBe(false);
    expect(hasVideoBackgroundFrameStyling(null)).toBe(false);
    expect(hasVideoBackgroundFrameStyling(makeBackground({ enabled: false, padding: 40 }))).toBe(
      false
    );
  });

  it('returns true when enabled with positive padding', () => {
    expect(
      hasVideoBackgroundFrameStyling(makeBackground({ enabled: true, padding: 40 }))
    ).toBe(true);
  });

  it('returns true when enabled with positive rounding', () => {
    expect(
      hasVideoBackgroundFrameStyling(makeBackground({ enabled: true, rounding: 20 }))
    ).toBe(true);
  });

  it('returns true when enabled with shadow or border toggled', () => {
    expect(
      hasVideoBackgroundFrameStyling(
        makeBackground({ enabled: true, shadow: { enabled: true, shadow: 0 } })
      )
    ).toBe(true);
    expect(
      hasVideoBackgroundFrameStyling(
        makeBackground({
          enabled: true,
          border: { enabled: true, width: 2, color: '#ffffff', opacity: 0 },
        })
      )
    ).toBe(true);
  });
});
