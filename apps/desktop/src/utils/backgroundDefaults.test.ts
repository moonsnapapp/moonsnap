import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_DEFAULT_PADDING,
  BACKGROUND_DEFAULT_ROUNDING,
  getEnableFrameDefaultDecision,
  getTypeSwitchFrameDefaultDecision,
} from './backgroundDefaults';

describe('backgroundDefaults', () => {
  it('exposes stable frame defaults', () => {
    expect(BACKGROUND_DEFAULT_PADDING).toBe(40);
    expect(BACKGROUND_DEFAULT_ROUNDING).toBe(12);
  });

  describe('getTypeSwitchFrameDefaultDecision', () => {
    it('applies padding and rounding defaults for wallpaper/image when frame is unset', () => {
      expect(getTypeSwitchFrameDefaultDecision('wallpaper', 0, 0)).toEqual({
        applyPadding: true,
        applyRounding: true,
      });
      expect(getTypeSwitchFrameDefaultDecision('image', 0, 0)).toEqual({
        applyPadding: true,
        applyRounding: true,
      });
    });

    it('does not apply defaults for solid/gradient', () => {
      expect(getTypeSwitchFrameDefaultDecision('solid', 0, 0)).toEqual({
        applyPadding: false,
        applyRounding: false,
      });
      expect(getTypeSwitchFrameDefaultDecision('gradient', 0, 0)).toEqual({
        applyPadding: false,
        applyRounding: false,
      });
    });

    it('does not override existing padding/rounding', () => {
      expect(getTypeSwitchFrameDefaultDecision('wallpaper', 16, 0)).toEqual({
        applyPadding: false,
        applyRounding: false,
      });
      expect(getTypeSwitchFrameDefaultDecision('image', 0, 8)).toEqual({
        applyPadding: true,
        applyRounding: false,
      });
    });
  });

  describe('getEnableFrameDefaultDecision', () => {
    it('applies defaults only when toggling on with empty frame', () => {
      expect(getEnableFrameDefaultDecision(true, 0, 0)).toEqual({
        applyPadding: true,
        applyRounding: true,
      });
    });

    it('does not apply defaults when toggling off', () => {
      expect(getEnableFrameDefaultDecision(false, 0, 0)).toEqual({
        applyPadding: false,
        applyRounding: false,
      });
    });

    it('respects existing values when toggling on', () => {
      expect(getEnableFrameDefaultDecision(true, 24, 10)).toEqual({
        applyPadding: false,
        applyRounding: false,
      });
    });
  });
});
