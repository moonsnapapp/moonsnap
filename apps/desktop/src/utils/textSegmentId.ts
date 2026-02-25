import type { TextSegment } from '@/types';

const TEXT_SEGMENT_ID_PATTERN = /^text_([0-9.]+)_(\d+)$/;

export interface ParsedTextSegmentId {
  startSec: number;
  index: number;
}

/**
 * Stable text segment ID shared by timeline and overlay selection logic.
 * Format: text_<startSec.toFixed(3)>_<index>
 */
export function createTextSegmentId(startSec: number, index: number): string {
  const normalizedStart = Number.isFinite(startSec) ? startSec : 0;
  const normalizedIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  return `text_${normalizedStart.toFixed(3)}_${normalizedIndex}`;
}

export function parseTextSegmentId(id: string): ParsedTextSegmentId | null {
  const match = TEXT_SEGMENT_ID_PATTERN.exec(id);
  if (!match) return null;

  const startSec = Number.parseFloat(match[1]);
  const index = Number.parseInt(match[2], 10);
  if (!Number.isFinite(startSec) || !Number.isInteger(index) || index < 0) {
    return null;
  }

  return { startSec, index };
}

export function getTextSegmentIndexFromId(id: string): number | null {
  const parsed = parseTextSegmentId(id);
  return parsed ? parsed.index : null;
}

export function findTextSegmentById(
  segments: TextSegment[] | undefined,
  id: string
): TextSegment | null {
  if (!segments || segments.length === 0) {
    return null;
  }

  const index = getTextSegmentIndexFromId(id);
  if (index === null || index < 0 || index >= segments.length) {
    return null;
  }

  return segments[index] ?? null;
}
