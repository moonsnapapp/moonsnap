import { describe, it, expect } from 'vitest';
import {
  calculateRowHeight,
  getCardWidth,
  getColumnsForWidth,
  getGridWidth,
  getScaledCardTargetWidth,
} from './VirtualizedGrid';

describe('VirtualizedGrid', () => {
  describe('getColumnsForWidth', () => {
    it('returns 5 columns for width >= 1600', () => {
      expect(getColumnsForWidth(1600)).toBe(5);
      expect(getColumnsForWidth(1920)).toBe(5);
      expect(getColumnsForWidth(2560)).toBe(5);
    });

    it('returns 4 columns for width >= 1200 and < 1600', () => {
      expect(getColumnsForWidth(1200)).toBe(4);
      expect(getColumnsForWidth(1400)).toBe(4);
      expect(getColumnsForWidth(1599)).toBe(4);
    });

    it('returns 3 columns for width < 1200', () => {
      expect(getColumnsForWidth(800)).toBe(3);
      expect(getColumnsForWidth(1000)).toBe(3);
      expect(getColumnsForWidth(1199)).toBe(3);
    });

    it('fills sidebar columns based on the minimum square tile width', () => {
      expect(getColumnsForWidth(320, 'sidebar', 1, 1)).toBe(2);
      expect(getColumnsForWidth(500, 'sidebar', 1, 1)).toBe(3);
      expect(getColumnsForWidth(1600, 'sidebar', 1, 1)).toBe(8);
    });

    it('allows Ctrl-scroll scale to increase or decrease full-grid columns', () => {
      expect(getColumnsForWidth(1200, 'full', 0.8)).toBe(5);
      expect(getColumnsForWidth(1200, 'full', 1.35)).toBe(3);
    });

    it('uses item-size levels to tune sidebar density', () => {
      expect(getColumnsForWidth(640, 'sidebar', 1, 5)).toBe(1);
      expect(getColumnsForWidth(660, 'sidebar', 1, 1)).toBe(4);
    });

    it('never adds sidebar columns that would violate the minimum card width', () => {
      expect(getColumnsForWidth(384, 'sidebar', 1, 1)).toBe(2);
      expect(getColumnsForWidth(500, 'sidebar', 1, 1)).toBe(3);
      expect(getColumnsForWidth(660, 'sidebar', 1, 1)).toBe(4);
    });
  });

  describe('getCardWidth', () => {
    it('calculates card width to fill available space', () => {
      // At 1200px with 4 cols: (1200 - 64 - 60) / 4 = 269px
      expect(getCardWidth(1200, 4)).toBe(269);
    });

    it('caps card width at MAX_CARD_WIDTH (320px)', () => {
      // At 2560px with 5 cols: (2560 - 64 - 80) / 5 = 483px -> capped to 320
      expect(getCardWidth(2560, 5)).toBe(320);
      expect(getCardWidth(3000, 5)).toBe(320);
    });

    it('allows smaller widths when container is small', () => {
      // At 800px with 3 cols: (800 - 64 - 40) / 3 = 232px
      expect(getCardWidth(800, 3)).toBe(232);
    });

    it('caps sidebar card width', () => {
      expect(getCardWidth(240, 1, 'sidebar')).toBe(216);
      expect(getCardWidth(500, 1, 'sidebar')).toBe(476);
    });

    it('uses the selected sidebar item size to choose columns before filling', () => {
      expect(getCardWidth(500, 3, 'sidebar', 1, 1)).toBe(150);
      expect(getCardWidth(500, 1, 'sidebar', 1, 5)).toBe(476);
    });

    it('splits sidebar width across scaled columns', () => {
      expect(getCardWidth(500, 3, 'sidebar', 0.8, 1)).toBe(150);
    });
  });

  describe('calculateRowHeight', () => {
    it('calculates row height based on a square card plus gap', () => {
      // Card width 269px + gap 20px = 289px
      const height = calculateRowHeight(1200, 4);
      expect(height).toBe(289);
    });

    it('has consistent height when cards are at max width', () => {
      // Card width 320px + gap 20px = 340px
      expect(calculateRowHeight(2560, 5)).toBe(340);
      expect(calculateRowHeight(3000, 5)).toBe(340);
    });

    it('calculates compact sidebar row height', () => {
      // Sidebar card width 216px + gap 12px = 228px
      expect(calculateRowHeight(240, 1, 'sidebar')).toBe(228);
    });
  });

  describe('getGridWidth', () => {
    it('calculates total grid width from columns and card width', () => {
      // At 1200px with 4 cols: cardWidth=269, gridWidth = 4*269 + 3*20 = 1076 + 60 = 1136
      expect(getGridWidth(1200, 4)).toBe(1136);
    });

    it('uses capped card width when calculating grid width', () => {
      // At 2560px with 5 cols: cardWidth=320 (capped), gridWidth = 5*320 + 4*20 = 1600 + 80 = 1680
      expect(getGridWidth(2560, 5)).toBe(1680);
      // Same result for larger container since card width is capped
      expect(getGridWidth(3000, 5)).toBe(1680);
    });

    it('is narrower than container when cards are at max width', () => {
      // At 2560px: available = 2560-64=2496, gridWidth=1680, so grid is centered
      const containerWidth = 2560;
      const cols = 5;
      const gridWidth = getGridWidth(containerWidth, cols);
      const availableWidth = containerWidth - 64; // CONTAINER_PADDING
      expect(gridWidth).toBeLessThan(availableWidth);
    });

    it('matches compact sidebar card width for one-column mode', () => {
      expect(getGridWidth(240, 1, 'sidebar')).toBe(216);
    });
  });

  describe('getScaledCardTargetWidth', () => {
    it('clamps scaled target widths to the supported range', () => {
      expect(getScaledCardTargetWidth(0.25)).toBe(200);
      expect(getScaledCardTargetWidth(1)).toBe(240);
      expect(getScaledCardTargetWidth(2)).toBe(360);
    });
  });
});
