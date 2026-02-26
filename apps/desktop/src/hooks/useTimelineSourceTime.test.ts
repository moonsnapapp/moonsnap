import { describe, expect, it } from 'vitest';
import { mapTimelineToSourceTime } from '@/hooks/useTimelineSourceTime';
import type { TrimSegment } from '@/types';

describe('mapTimelineToSourceTime', () => {
  it('returns timeline time when segments are missing', () => {
    expect(mapTimelineToSourceTime(1234, undefined)).toBe(1234);
    expect(mapTimelineToSourceTime(1234, [])).toBe(1234);
  });

  it('maps timeline time through trimmed segments', () => {
    const segments: TrimSegment[] = [
      { id: 'a', sourceStartMs: 0, sourceEndMs: 1000 },
      { id: 'b', sourceStartMs: 2000, sourceEndMs: 3000 },
    ];

    expect(mapTimelineToSourceTime(250, segments)).toBe(250);
    expect(mapTimelineToSourceTime(1000, segments)).toBe(2000);
    expect(mapTimelineToSourceTime(1500, segments)).toBe(2500);
  });

  it('clamps past-end timeline time to last segment end', () => {
    const segments: TrimSegment[] = [
      { id: 'a', sourceStartMs: 100, sourceEndMs: 200 },
      { id: 'b', sourceStartMs: 500, sourceEndMs: 800 },
    ];

    expect(mapTimelineToSourceTime(9999, segments)).toBe(800);
  });
});
