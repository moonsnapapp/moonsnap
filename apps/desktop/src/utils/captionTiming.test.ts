import { describe, expect, it } from 'vitest';
import {
  buildUpdatedWords,
  buildWordsFromEditor,
  clamp,
  cloneCaptionSegment,
  cloneCaptionSegments,
  distributeCaptionWordTiming,
  formatTime,
  parseEditableWords,
  segmentMatchesUpdate,
  type EditableCaptionWord,
} from '@/utils/captionTiming';
import type { CaptionSegment } from '@/types';

function createSegment(overrides?: Partial<CaptionSegment>): CaptionSegment {
  return {
    id: 'seg-1',
    start: 10,
    end: 12,
    text: 'hello world',
    words: [
      { text: 'hello', start: 10, end: 11 },
      { text: 'world', start: 11, end: 12 },
    ],
    ...overrides,
  };
}

describe('captionTiming', () => {
  it('clamps numeric values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });

  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
  });

  it('distributes caption words across a segment duration', () => {
    const words = distributeCaptionWordTiming(['a', 'b', 'c'], 0, 3);
    expect(words).toEqual([
      { text: 'a', start: 0, end: 1 },
      { text: 'b', start: 1, end: 2 },
      { text: 'c', start: 2, end: 3 },
    ]);
  });

  it('remaps existing word timing when text word count is unchanged', () => {
    const updated = buildUpdatedWords(createSegment(), 'hi there', 20, 24);
    expect(updated).toEqual([
      { text: 'hi', start: 20, end: 22 },
      { text: 'there', start: 22, end: 24 },
    ]);
  });

  it('parses editable words and validates editor timing', () => {
    const editable: EditableCaptionWord[] = [
      { text: 'hello', start: '10.00', end: '11.00' },
      { text: 'world', start: '11.00', end: '12.00' },
    ];

    expect(parseEditableWords(editable)).toEqual([
      { text: 'hello', start: 10, end: 11 },
      { text: 'world', start: 11, end: 12 },
    ]);

    expect(buildWordsFromEditor(editable, 'hello world', 10, 12)).toEqual([
      { text: 'hello', start: 10, end: 11 },
      { text: 'world', start: 11, end: 12 },
    ]);

    const invalidOrder: EditableCaptionWord[] = [
      { text: 'hello', start: '10.50', end: '11.50' },
      { text: 'world', start: '11.00', end: '12.00' },
    ];
    expect(buildWordsFromEditor(invalidOrder, 'hello world', 10, 12)).toBeNull();
  });

  it('clones segments deeply and compares updates with tolerance', () => {
    const segment = createSegment();
    const clone = cloneCaptionSegment(segment);
    const clones = cloneCaptionSegments([segment]);

    expect(clone).toEqual(segment);
    expect(clone.words).not.toBe(segment.words);
    expect(clones[0].words).not.toBe(segment.words);

    expect(
      segmentMatchesUpdate(segment, {
        start: 10.0001,
        end: 11.9999,
        text: 'hello world',
        words: [
          { text: 'hello', start: 10.0001, end: 11.0001 },
          { text: 'world', start: 11.0001, end: 12.0001 },
        ],
      })
    ).toBe(true);
  });
});
