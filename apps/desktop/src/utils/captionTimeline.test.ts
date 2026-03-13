import { describe, expect, it } from 'vitest';
import type { CaptionSegment, TrimSegment } from '@/types';
import {
  remapCaptionSegmentToSource,
  remapCaptionSegmentsToTimeline,
} from '@/utils/captionTimeline';

function createCaption(overrides: Partial<CaptionSegment> = {}): CaptionSegment {
  return {
    id: 'caption-1',
    start: 1.5,
    end: 3.5,
    text: 'alpha beta gamma',
    words: [
      { text: 'alpha', start: 1.6, end: 1.9 },
      { text: 'beta', start: 2.1, end: 2.4 },
      { text: 'gamma', start: 3.1, end: 3.4 },
    ],
    ...overrides,
  };
}

describe('remapCaptionSegmentsToTimeline', () => {
  it('returns cloned captions when no trim segments are present', () => {
    const captions = [createCaption()];

    const remapped = remapCaptionSegmentsToTimeline(captions, []);

    expect(remapped).toEqual(captions);
    expect(remapped[0]).not.toBe(captions[0]);
    expect(remapped[0].words[0]).not.toBe(captions[0].words[0]);
  });

  it('drops captions that fall entirely inside deleted regions', () => {
    const captions = [createCaption({ start: 2.1, end: 2.4, words: [] })];
    const segments: TrimSegment[] = [
      { id: 'trim-1', sourceStartMs: 0, sourceEndMs: 2000 },
      { id: 'trim-2', sourceStartMs: 3000, sourceEndMs: 4000 },
    ];

    const remapped = remapCaptionSegmentsToTimeline(captions, segments);

    expect(remapped).toEqual([]);
  });

  it('collapses a caption across trimmed joins into one timeline segment', () => {
    const captions = [createCaption()];
    const segments: TrimSegment[] = [
      { id: 'trim-1', sourceStartMs: 1000, sourceEndMs: 2000 },
      { id: 'trim-2', sourceStartMs: 3000, sourceEndMs: 4000 },
    ];

    const remapped = remapCaptionSegmentsToTimeline(captions, segments);

    expect(remapped).toHaveLength(1);
    expect(remapped[0].id).toBe('caption-1');
    expect(remapped[0].start).toBeCloseTo(0.5, 4);
    expect(remapped[0].end).toBeCloseTo(1.5, 4);
    expect(remapped[0].text).toBe('alpha gamma');
    expect(remapped[0].words).toEqual([
      { text: 'alpha', start: 0.6, end: 0.9 },
      { text: 'gamma', start: 1.1, end: 1.4 },
    ]);
  });

  it('merges adjacent slices for a word that crosses a cut boundary', () => {
    const captions = [createCaption({
      start: 1.8,
      end: 3.2,
      text: 'stretch',
      words: [{ text: 'stretch', start: 1.8, end: 3.2 }],
    })];
    const segments: TrimSegment[] = [
      { id: 'trim-1', sourceStartMs: 1000, sourceEndMs: 2000 },
      { id: 'trim-2', sourceStartMs: 3000, sourceEndMs: 4000 },
    ];

    const remapped = remapCaptionSegmentsToTimeline(captions, segments);

    expect(remapped).toHaveLength(1);
    expect(remapped[0].start).toBeCloseTo(0.8, 4);
    expect(remapped[0].end).toBeCloseTo(1.2, 4);
    expect(remapped[0].words).toEqual([
      { text: 'stretch', start: 0.8, end: 1.2 },
    ]);
  });

  it('keeps original text when there are no word timings to trim', () => {
    const captions = [createCaption({
      text: 'manual caption text',
      words: [],
    })];
    const segments: TrimSegment[] = [
      { id: 'trim-1', sourceStartMs: 1000, sourceEndMs: 2000 },
      { id: 'trim-2', sourceStartMs: 3000, sourceEndMs: 4000 },
    ];

    const remapped = remapCaptionSegmentsToTimeline(captions, segments);

    expect(remapped).toHaveLength(1);
    expect(remapped[0].text).toBe('manual caption text');
    expect(remapped[0].start).toBeCloseTo(0.5, 4);
    expect(remapped[0].end).toBeCloseTo(1.5, 4);
  });

  it('maps a timeline-space caption back to source time', () => {
    const timelineCaption = createCaption({
      start: 0.5,
      end: 1.5,
      text: 'alpha gamma',
      words: [
        { text: 'alpha', start: 0.6, end: 0.9 },
        { text: 'gamma', start: 1.1, end: 1.4 },
      ],
    });
    const segments: TrimSegment[] = [
      { id: 'trim-1', sourceStartMs: 1000, sourceEndMs: 2000 },
      { id: 'trim-2', sourceStartMs: 3000, sourceEndMs: 4000 },
    ];

    const sourceCaption = remapCaptionSegmentToSource(timelineCaption, segments);

    expect(sourceCaption.start).toBeCloseTo(1.5, 4);
    expect(sourceCaption.end).toBeCloseTo(3.5, 4);
    expect(sourceCaption.words).toEqual([
      { text: 'alpha', start: 1.6, end: 1.9 },
      { text: 'gamma', start: 3.1, end: 3.4 },
    ]);
  });
});
