import { describe, it, expect } from 'vitest';
import {
  timelineToSource,
  sourceToTimeline,
  getEffectiveDuration,
  getSegmentTimelinePosition,
  findSegmentAtSourceTime,
  findSegmentIndexAtTimelineTime,
  clipSegmentsToTimelineRange,
  pushTrimHistory,
  type TimelineHistoryEntry,
} from './trimSlice';
import type { TrimSegment } from '../../types';
import type { OverlaySnapshot } from './overlayAdjustment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seg(
  sourceStartMs: number,
  sourceEndMs: number,
  speed = 1,
  id = `${sourceStartMs}-${sourceEndMs}`
): TrimSegment {
  return { id, sourceStartMs, sourceEndMs, speed };
}

const emptyOverlays: OverlaySnapshot = {
  zoomRegions: [],
  annotationSegments: [],
  maskSegments: [],
  sceneSegments: [],
  textSegments: [],
  webcamVisibilitySegments: [],
};

function historyEntry(selectedId: string): TimelineHistoryEntry {
  return { segments: [], selectedId, overlays: emptyOverlays };
}

// ---------------------------------------------------------------------------
// timelineToSource
// ---------------------------------------------------------------------------

describe('timelineToSource', () => {
  it('returns the input unchanged when there are no segments', () => {
    expect(timelineToSource(1234, [])).toBe(1234);
  });

  it('maps within a single 1x segment by adding the source offset', () => {
    const segments = [seg(1000, 5000)]; // timeline duration 4000
    expect(timelineToSource(0, segments)).toBe(1000);
    expect(timelineToSource(2000, segments)).toBe(3000);
    expect(timelineToSource(3999, segments)).toBe(4999);
  });

  it('clamps to the last segment source end when timeline time is at/after the end', () => {
    const segments = [seg(1000, 5000)];
    expect(timelineToSource(4000, segments)).toBe(5000); // exactly at end
    expect(timelineToSource(10000, segments)).toBe(5000); // beyond end
  });

  it('scales the offset by speed for a sped-up segment', () => {
    const segments = [seg(0, 4000, 2)]; // timeline duration 2000
    expect(timelineToSource(0, segments)).toBe(0);
    expect(timelineToSource(1000, segments)).toBe(2000);
    expect(timelineToSource(1999, segments)).toBe(3998);
    expect(timelineToSource(2000, segments)).toBe(4000); // clamps to source end
  });

  it('ripples across a cut between two segments', () => {
    // seg1 timeline [0,2000), seg2 timeline [2000,4000); source gap 2000..5000 removed
    const segments = [seg(0, 2000), seg(5000, 7000)];
    expect(timelineToSource(1500, segments)).toBe(1500);
    expect(timelineToSource(2000, segments)).toBe(5000); // first instant of seg2
    expect(timelineToSource(2500, segments)).toBe(5500);
    expect(timelineToSource(4000, segments)).toBe(7000); // clamps to last source end
  });

  it('handles mixed-speed segments', () => {
    // seg1 4000ms @2x -> 2000ms timeline; seg2 2000ms @1x -> 2000ms timeline
    const segments = [seg(0, 4000, 2), seg(4000, 6000, 1)];
    expect(timelineToSource(1000, segments)).toBe(2000); // inside seg1: 1000*2
    expect(timelineToSource(2000, segments)).toBe(4000); // first instant of seg2
    expect(timelineToSource(3000, segments)).toBe(5000); // 1000 into seg2 @1x
  });
});

// ---------------------------------------------------------------------------
// sourceToTimeline
// ---------------------------------------------------------------------------

describe('sourceToTimeline', () => {
  it('returns the input unchanged when there are no segments', () => {
    expect(sourceToTimeline(1234, [])).toBe(1234);
  });

  it('maps within a single 1x segment by subtracting the source start', () => {
    const segments = [seg(1000, 5000)];
    expect(sourceToTimeline(1000, segments)).toBe(0);
    expect(sourceToTimeline(3000, segments)).toBe(2000);
    expect(sourceToTimeline(4999, segments)).toBe(3999);
  });

  it('clamps source time before the first segment to the segment start (timeline 0)', () => {
    const segments = [seg(1000, 5000)];
    expect(sourceToTimeline(500, segments)).toBe(0);
  });

  it('clamps source time at/after the last segment end to the effective duration', () => {
    const segments = [seg(1000, 5000)]; // timeline duration 4000
    expect(sourceToTimeline(5000, segments)).toBe(4000); // exactly at end
    expect(sourceToTimeline(10000, segments)).toBe(4000); // beyond end
  });

  it('divides the offset by speed for a sped-up segment', () => {
    const segments = [seg(0, 4000, 2)]; // timeline duration 2000
    expect(sourceToTimeline(2000, segments)).toBe(1000);
    expect(sourceToTimeline(4000, segments)).toBe(2000); // at end -> effective duration
  });

  it('maps a source time inside a deleted gap to the next segment boundary', () => {
    // Source 2000..5000 is cut out; seg2 starts at timeline 2000
    const segments = [seg(0, 2000), seg(5000, 7000)];
    expect(sourceToTimeline(1000, segments)).toBe(1000);
    expect(sourceToTimeline(3000, segments)).toBe(2000); // in the gap -> seg2 start
    expect(sourceToTimeline(6000, segments)).toBe(3000); // 1000 into seg2
    expect(sourceToTimeline(8000, segments)).toBe(4000); // beyond all -> total
  });
});

// ---------------------------------------------------------------------------
// Round-trip property: source inside an included region survives both maps
// ---------------------------------------------------------------------------

describe('timelineToSource / sourceToTimeline round-trip', () => {
  it('is an identity for timeline points inside included regions', () => {
    const segments = [seg(0, 4000, 2), seg(6000, 8000, 1)];
    for (const t of [0, 500, 1000, 1999, 2000, 2500, 3500]) {
      const source = timelineToSource(t, segments);
      expect(sourceToTimeline(source, segments)).toBeCloseTo(t, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// getEffectiveDuration
// ---------------------------------------------------------------------------

describe('getEffectiveDuration', () => {
  it('returns the original duration when there are no segments', () => {
    expect(getEffectiveDuration([], 60000)).toBe(60000);
  });

  it('sums the timeline durations of all segments, accounting for speed', () => {
    // 2000ms @1x + 2000ms @2x(=1000ms timeline)
    const segments = [seg(0, 2000, 1), seg(5000, 7000, 2)];
    expect(getEffectiveDuration(segments, 99999)).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// getSegmentTimelinePosition
// ---------------------------------------------------------------------------

describe('getSegmentTimelinePosition', () => {
  const segments = [seg(0, 2000, 1), seg(5000, 7000, 2), seg(8000, 9000, 1)];

  it('returns 0 for the first segment', () => {
    expect(getSegmentTimelinePosition(0, segments)).toBe(0);
  });

  it('accumulates preceding timeline durations', () => {
    expect(getSegmentTimelinePosition(1, segments)).toBe(2000); // after seg1 (2000)
    expect(getSegmentTimelinePosition(2, segments)).toBe(3000); // + seg2 @2x (1000)
  });

  it('returns 0 for out-of-range indices', () => {
    expect(getSegmentTimelinePosition(-1, segments)).toBe(0);
    expect(getSegmentTimelinePosition(99, segments)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findSegmentAtSourceTime
// ---------------------------------------------------------------------------

describe('findSegmentAtSourceTime', () => {
  const segments = [seg(0, 2000), seg(5000, 7000)];

  it('finds the segment whose source range contains the time (end-exclusive)', () => {
    expect(findSegmentAtSourceTime(1000, segments)?.id).toBe('0-2000');
    expect(findSegmentAtSourceTime(0, segments)?.id).toBe('0-2000');
    expect(findSegmentAtSourceTime(6000, segments)?.id).toBe('5000-7000');
  });

  it('returns null in a deleted gap or past the end', () => {
    expect(findSegmentAtSourceTime(2000, segments)).toBeNull(); // end-exclusive boundary
    expect(findSegmentAtSourceTime(3000, segments)).toBeNull(); // gap
    expect(findSegmentAtSourceTime(9999, segments)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findSegmentIndexAtTimelineTime
// ---------------------------------------------------------------------------

describe('findSegmentIndexAtTimelineTime', () => {
  const segments = [seg(0, 2000), seg(5000, 7000)]; // timeline [0,2000),[2000,4000)

  it('returns -1 when there are no segments', () => {
    expect(findSegmentIndexAtTimelineTime(0, [])).toBe(-1);
  });

  it('returns the index of the segment containing the timeline time', () => {
    expect(findSegmentIndexAtTimelineTime(500, segments)).toBe(0);
    expect(findSegmentIndexAtTimelineTime(2000, segments)).toBe(1); // boundary -> next
    expect(findSegmentIndexAtTimelineTime(3500, segments)).toBe(1);
  });

  it('clamps to the last segment when the time is at/after the end', () => {
    expect(findSegmentIndexAtTimelineTime(4000, segments)).toBe(1);
    expect(findSegmentIndexAtTimelineTime(99999, segments)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clipSegmentsToTimelineRange
// ---------------------------------------------------------------------------

describe('clipSegmentsToTimelineRange', () => {
  it('creates a single segment for the IO range when there are no segments', () => {
    const result = clipSegmentsToTimelineRange([], 1000, 5000, 10000);
    expect(result).toHaveLength(1);
    expect(result[0].sourceStartMs).toBe(1000);
    expect(result[0].sourceEndMs).toBe(5000);
    expect(result[0].speed).toBe(1);
  });

  it('clamps a null out-point to the total duration when there are no segments', () => {
    const result = clipSegmentsToTimelineRange([], 0, null, 8000);
    expect(result[0].sourceStartMs).toBe(0);
    expect(result[0].sourceEndMs).toBe(8000);
  });

  it('clips existing segments to the timeline window and maps back to source', () => {
    const segments = [seg(0, 2000, 1), seg(2000, 4000, 1)]; // timeline [0,2000),[2000,4000)
    const result = clipSegmentsToTimelineRange(segments, 1000, 3000, 10000);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ sourceStartMs: 1000, sourceEndMs: 2000, speed: 1 });
    expect(result[1]).toMatchObject({ sourceStartMs: 2000, sourceEndMs: 3000, speed: 1 });
  });

  it('drops segments fully outside the window', () => {
    const segments = [seg(0, 2000, 1), seg(2000, 4000, 1)];
    // Window [0,1500) only overlaps the first segment
    const result = clipSegmentsToTimelineRange(segments, 0, 1500, 10000);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceStartMs: 0, sourceEndMs: 1500 });
  });

  it('scales clipped source offsets by segment speed', () => {
    const segments = [seg(0, 4000, 2)]; // 4000ms source @2x -> timeline [0,2000)
    const result = clipSegmentsToTimelineRange(segments, 500, 1500, 10000);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceStartMs: 1000, sourceEndMs: 3000, speed: 2 });
  });

  it('preserves segment ids when clipping existing segments', () => {
    const segments = [seg(0, 2000, 1, 'keep-me')];
    const result = clipSegmentsToTimelineRange(segments, 0, 1000, 10000);
    expect(result[0].id).toBe('keep-me');
  });
});

// ---------------------------------------------------------------------------
// pushTrimHistory
// ---------------------------------------------------------------------------

describe('pushTrimHistory', () => {
  it('appends an entry and points the index at it', () => {
    const { history, index } = pushTrimHistory([], -1, historyEntry('a'));
    expect(history).toHaveLength(1);
    expect(index).toBe(0);
    expect(history[0].selectedId).toBe('a');
  });

  it('drops the redo stack when pushing after an undo', () => {
    const base = [historyEntry('a'), historyEntry('b'), historyEntry('c')];
    // Pretend we undid back to index 0 ('a'), then push a new entry 'd'
    const { history, index } = pushTrimHistory(base, 0, historyEntry('d'));
    expect(history.map((e) => e.selectedId)).toEqual(['a', 'd']);
    expect(index).toBe(1);
  });

  it('caps history at the maximum size, dropping the oldest entries', () => {
    let history: TimelineHistoryEntry[] = [];
    let index = -1;
    for (let i = 0; i < 60; i++) {
      const r = pushTrimHistory(history, index, historyEntry(String(i)));
      history = r.history;
      index = r.index;
    }
    expect(history).toHaveLength(50);
    expect(index).toBe(49);
    // Oldest surviving entry is #10 (entries 0-9 were shifted out), newest is #59
    expect(history[0].selectedId).toBe('10');
    expect(history[history.length - 1].selectedId).toBe('59');
  });
});
