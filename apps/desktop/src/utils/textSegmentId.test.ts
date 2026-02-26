import { describe, expect, it } from 'vitest';
import {
  createTextSegmentId,
  findTextSegmentById,
  getTextSegmentIndexFromId,
  parseTextSegmentId,
} from '@/utils/textSegmentId';
import type { TextSegment } from '@/types';

describe('textSegmentId', () => {
  it('creates IDs with normalized precision and index', () => {
    expect(createTextSegmentId(1.23456, 2)).toBe('text_1.235_2');
  });

  it('parses valid IDs', () => {
    expect(parseTextSegmentId('text_12.340_5')).toEqual({
      startSec: 12.34,
      index: 5,
    });
  });

  it('rejects invalid IDs', () => {
    expect(parseTextSegmentId('text_bad')).toBeNull();
    expect(parseTextSegmentId('zoom_1.000_0')).toBeNull();
  });

  it('extracts index from ID', () => {
    expect(getTextSegmentIndexFromId('text_0.500_3')).toBe(3);
    expect(getTextSegmentIndexFromId('bad')).toBeNull();
  });

  it('finds a segment by encoded index', () => {
    const segments: TextSegment[] = [
      {
        start: 0,
        end: 1,
        enabled: true,
        content: 'A',
        center: { x: 0.5, y: 0.5 },
        size: { x: 0.4, y: 0.2 },
        fontFamily: 'sans-serif',
        fontSize: 24,
        fontWeight: 700,
        italic: false,
        color: '#ffffff',
        fadeDuration: 0.15,
      },
      {
        start: 1,
        end: 2,
        enabled: true,
        content: 'B',
        center: { x: 0.5, y: 0.6 },
        size: { x: 0.4, y: 0.2 },
        fontFamily: 'sans-serif',
        fontSize: 24,
        fontWeight: 700,
        italic: false,
        color: '#ffffff',
        fadeDuration: 0.15,
      },
    ];

    expect(findTextSegmentById(segments, 'text_1.000_1')).toBe(segments[1]);
    expect(findTextSegmentById(segments, 'text_1.000_2')).toBeNull();
  });
});
