import { describe, it, expect } from 'vitest';
import {
  adjustOverlaySegmentsForDeletion,
  adjustTextSegmentsForDeletion,
  MIN_OVERLAY_DURATION_MS,
} from './overlayAdjustment';

// Helper to create a minimal ms-based segment
function seg(startMs: number, endMs: number, id: string = 'seg') {
  return { id, startMs, endMs, scale: 2.0 };
}

describe('adjustOverlaySegmentsForDeletion', () => {
  describe('six overlap cases', () => {
    // Deletion range: [1000, 2000] (1 second deleted)

    it('Case 1: entirely before deletion — no change', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(0, 500, 'a')],
        1000, 2000
      );
      expect(result).toEqual([seg(0, 500, 'a')]);
    });

    it('Case 1: segment end exactly at deletion start — no change', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(0, 1000, 'a')],
        1000, 2000
      );
      expect(result).toEqual([seg(0, 1000, 'a')]);
    });

    it('Case 2: entirely after deletion — shift left', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(3000, 4000, 'a')],
        1000, 2000
      );
      expect(result).toEqual([{ id: 'a', startMs: 2000, endMs: 3000, scale: 2.0 }]);
    });

    it('Case 2: segment start exactly at deletion end — shift left', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(2000, 3000, 'a')],
        1000, 2000
      );
      expect(result).toEqual([{ id: 'a', startMs: 1000, endMs: 2000, scale: 2.0 }]);
    });

    it('Case 3: entirely within deletion — remove', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(1200, 1800, 'a')],
        1000, 2000
      );
      expect(result).toEqual([]);
    });

    it('Case 3: exactly matching deletion range — remove', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(1000, 2000, 'a')],
        1000, 2000
      );
      expect(result).toEqual([]);
    });

    it('Case 4: overlaps start of deletion — trim end', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(500, 1500, 'a')],
        1000, 2000
      );
      expect(result).toEqual([{ id: 'a', startMs: 500, endMs: 1000, scale: 2.0 }]);
    });

    it('Case 5: overlaps end of deletion — shift to delStart', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(1500, 3000, 'a')],
        1000, 2000
      );
      // newStart = 1000, newEnd = 1000 + (3000 - 2000) = 2000
      expect(result).toEqual([{ id: 'a', startMs: 1000, endMs: 2000, scale: 2.0 }]);
    });

    it('Case 6: encloses deletion — shrink', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(500, 3000, 'a')],
        1000, 2000
      );
      // endMs = 3000 - 1000 = 2000
      expect(result).toEqual([{ id: 'a', startMs: 500, endMs: 2000, scale: 2.0 }]);
    });
  });

  describe('min duration filtering', () => {
    it('removes segments that become too short after Case 4 trim', () => {
      // Segment 900-1010, deletion 1000-2000 → trimmed to 900-1000 = 100ms
      const result = adjustOverlaySegmentsForDeletion(
        [seg(990, 1500, 'a')],
        1000, 2000,
        MIN_OVERLAY_DURATION_MS
      );
      // 990-1000 = 10ms < 50ms minimum → removed
      expect(result).toEqual([]);
    });

    it('removes segments that become too short after Case 5 trim', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(1980, 2020, 'a')],
        1000, 2000,
        MIN_OVERLAY_DURATION_MS
      );
      // newStart = 1000, newEnd = 1000 + (2020 - 2000) = 1020, duration = 20ms < 50ms → removed
      expect(result).toEqual([]);
    });

    it('keeps segments at exactly min duration', () => {
      const result = adjustOverlaySegmentsForDeletion(
        [seg(950, 1500, 'a')],
        1000, 2000,
        MIN_OVERLAY_DURATION_MS
      );
      // Trimmed to 950-1000 = 50ms = exactly MIN_OVERLAY_DURATION_MS → kept
      expect(result).toEqual([{ id: 'a', startMs: 950, endMs: 1000, scale: 2.0 }]);
    });
  });

  describe('edge cases', () => {
    it('handles empty segment array', () => {
      const result = adjustOverlaySegmentsForDeletion([], 1000, 2000);
      expect(result).toEqual([]);
    });

    it('handles zero-duration deletion (no-op)', () => {
      const segments = [seg(0, 1000, 'a'), seg(2000, 3000, 'b')];
      const result = adjustOverlaySegmentsForDeletion(segments, 1000, 1000);
      expect(result).toEqual(segments);
    });

    it('handles multiple segments across all cases', () => {
      const segments = [
        seg(0, 500, 'before'),         // Case 1: before
        seg(800, 1300, 'overlap-start'), // Case 4: overlaps start
        seg(1200, 1800, 'within'),      // Case 3: within
        seg(1700, 2500, 'overlap-end'),  // Case 5: overlaps end
        seg(3000, 4000, 'after'),       // Case 2: after
      ];

      const result = adjustOverlaySegmentsForDeletion(segments, 1000, 2000);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ id: 'before', startMs: 0, endMs: 500, scale: 2.0 });
      expect(result[1]).toEqual({ id: 'overlap-start', startMs: 800, endMs: 1000, scale: 2.0 });
      // overlap-end: newStart=1000, newEnd=1000+(2500-2000)=1500
      expect(result[2]).toEqual({ id: 'overlap-end', startMs: 1000, endMs: 1500, scale: 2.0 });
      // after: shifted by 1000
      expect(result[3]).toEqual({ id: 'after', startMs: 2000, endMs: 3000, scale: 2.0 });
    });

    it('preserves all extra properties on segments', () => {
      const segment = {
        id: 'zoom-1',
        startMs: 3000,
        endMs: 5000,
        scale: 2.5,
        targetX: 0.3,
        targetY: 0.7,
      };

      const result = adjustOverlaySegmentsForDeletion([segment], 1000, 2000);

      expect(result[0]).toEqual({
        id: 'zoom-1',
        startMs: 2000,
        endMs: 4000,
        scale: 2.5,
        targetX: 0.3,
        targetY: 0.7,
      });
    });

    it('handles deletion at timeline start (delStart=0)', () => {
      const segments = [
        seg(0, 500, 'a'),
        seg(1000, 2000, 'b'),
      ];
      const result = adjustOverlaySegmentsForDeletion(segments, 0, 500);
      // a: entirely within → removed
      // b: shift left by 500
      expect(result).toEqual([{ id: 'b', startMs: 500, endMs: 1500, scale: 2.0 }]);
    });

    it('handles deletion at timeline end', () => {
      const segments = [
        seg(0, 500, 'a'),
        seg(800, 1200, 'b'),
      ];
      const result = adjustOverlaySegmentsForDeletion(segments, 1000, 2000);
      // a: entirely before → no change
      // b: overlaps start → trim to 1000
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(seg(0, 500, 'a'));
      expect(result[1]).toEqual({ id: 'b', startMs: 800, endMs: 1000, scale: 2.0 });
    });
  });
});

describe('adjustTextSegmentsForDeletion', () => {
  // Helper to create a minimal text segment in seconds
  function textSeg(start: number, end: number): {
    start: number;
    end: number;
    enabled: boolean;
    content: string;
    center: { x: number; y: number };
    size: { x: number; y: number };
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    italic: boolean;
    color: string;
    fadeDuration: number;
  } {
    return {
      start,
      end,
      enabled: true,
      content: 'Hello',
      center: { x: 0.5, y: 0.5 },
      size: { x: 0.3, y: 0.1 },
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 400,
      italic: false,
      color: '#ffffff',
      fadeDuration: 0.2,
    };
  }

  it('converts seconds to ms, applies adjustment, converts back', () => {
    // Segment at 3.0s-5.0s, deletion at 1000ms-2000ms (1.0s-2.0s)
    const result = adjustTextSegmentsForDeletion(
      [textSeg(3.0, 5.0)],
      1000, 2000
    );
    // Case 2: entirely after → shift left by 1s
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(2);
    expect(result[0].end).toBe(4);
  });

  it('rounds to 3 decimal places', () => {
    // Segment at 1.5s-3.333s, deletion at 0-500ms
    const result = adjustTextSegmentsForDeletion(
      [textSeg(1.5, 3.333)],
      0, 500
    );
    // Shift left by 0.5s
    expect(result[0].start).toBe(1);
    expect(result[0].end).toBe(2.833);
  });

  it('removes text segments within deletion', () => {
    const result = adjustTextSegmentsForDeletion(
      [textSeg(1.0, 1.5)],
      1000, 2000
    );
    expect(result).toEqual([]);
  });

  it('trims text segment overlapping start of deletion', () => {
    // Segment 0.5s-1.5s, deletion 1000ms-2000ms
    const result = adjustTextSegmentsForDeletion(
      [textSeg(0.5, 1.5)],
      1000, 2000
    );
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0.5);
    expect(result[0].end).toBe(1);
  });

  it('preserves all text segment properties', () => {
    const original = textSeg(3.0, 5.0);
    original.content = 'Custom text';
    original.fontSize = 48;
    original.italic = true;

    const result = adjustTextSegmentsForDeletion([original], 1000, 2000);

    expect(result[0].content).toBe('Custom text');
    expect(result[0].fontSize).toBe(48);
    expect(result[0].italic).toBe(true);
    expect(result[0].start).toBe(2);
    expect(result[0].end).toBe(4);
  });

  it('handles empty array', () => {
    const result = adjustTextSegmentsForDeletion([], 1000, 2000);
    expect(result).toEqual([]);
  });
});
