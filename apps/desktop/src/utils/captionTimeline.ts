import type { CaptionSegment, CaptionWord, TrimSegment } from '@/types';

const CAPTION_TIMELINE_EPSILON = 0.0005;

function cloneWord(word: CaptionWord): CaptionWord {
  return { ...word };
}

function wordsAreAdjacent(left: CaptionWord, right: CaptionWord): boolean {
  return left.text === right.text && Math.abs(left.end - right.start) < CAPTION_TIMELINE_EPSILON;
}

function mergeAdjacentWordSlices(words: CaptionWord[]): CaptionWord[] {
  if (words.length <= 1) {
    return words.map(cloneWord);
  }

  const merged: CaptionWord[] = [];

  for (const word of words) {
    const previous = merged[merged.length - 1];
    if (previous && wordsAreAdjacent(previous, word)) {
      previous.end = word.end;
      continue;
    }

    merged.push(cloneWord(word));
  }

  return merged;
}

function remapWordIntoSegment(
  word: CaptionWord,
  segment: TrimSegment,
  timelineOffsetMs: number
): CaptionWord | null {
  const wordStartMs = word.start * 1000;
  const wordEndMs = word.end * 1000;

  if (wordEndMs <= segment.sourceStartMs || wordStartMs >= segment.sourceEndMs) {
    return null;
  }

  const clippedStartMs = Math.max(wordStartMs, segment.sourceStartMs);
  const clippedEndMs = Math.min(wordEndMs, segment.sourceEndMs);
  if (clippedEndMs <= clippedStartMs) {
    return null;
  }

  return {
    text: word.text,
    start: (timelineOffsetMs + (clippedStartMs - segment.sourceStartMs)) / 1000,
    end: (timelineOffsetMs + (clippedEndMs - segment.sourceStartMs)) / 1000,
  };
}

function cloneSegment(segment: CaptionSegment): CaptionSegment {
  return {
    ...segment,
    words: segment.words.map(cloneWord),
  };
}

function timelineMsToSourceMs(
  timelineMs: number,
  segments: TrimSegment[] | undefined
): number {
  if (!segments || segments.length === 0) {
    return timelineMs;
  }

  let accumulatedTimeline = 0;

  for (const segment of segments) {
    const segmentDuration = segment.sourceEndMs - segment.sourceStartMs;

    if (timelineMs < accumulatedTimeline + segmentDuration) {
      return segment.sourceStartMs + (timelineMs - accumulatedTimeline);
    }

    accumulatedTimeline += segmentDuration;
  }

  return segments[segments.length - 1].sourceEndMs;
}

interface CaptionSegmentOverlap {
  segment: TrimSegment;
  timelineOffsetMs: number;
  start: number;
  end: number;
}

function getTrimSegmentDuration(segment: TrimSegment): number {
  return segment.sourceEndMs - segment.sourceStartMs;
}

function getCaptionSegmentOverlap(
  captionStartMs: number,
  captionEndMs: number,
  segment: TrimSegment,
  timelineOffsetMs: number
): CaptionSegmentOverlap | null {
  const overlapStartMs = Math.max(captionStartMs, segment.sourceStartMs);
  const overlapEndMs = Math.min(captionEndMs, segment.sourceEndMs);

  if (overlapEndMs <= overlapStartMs) {
    return null;
  }

  return {
    segment,
    timelineOffsetMs,
    start: (timelineOffsetMs + (overlapStartMs - segment.sourceStartMs)) / 1000,
    end: (timelineOffsetMs + (overlapEndMs - segment.sourceStartMs)) / 1000,
  };
}

function remapWordsIntoOverlap(
  words: CaptionWord[],
  overlap: CaptionSegmentOverlap
): CaptionWord[] {
  return words.flatMap((word) => {
    const remappedWord = remapWordIntoSegment(
      word,
      overlap.segment,
      overlap.timelineOffsetMs
    );

    return remappedWord ? [remappedWord] : [];
  });
}

function getCaptionTimelineText(caption: CaptionSegment, words: CaptionWord[]): string {
  return words.length > 0
    ? words.map((word) => word.text).join(' ')
    : caption.text;
}

function remapCaptionSegmentToTimeline(
  caption: CaptionSegment,
  segments: TrimSegment[]
): CaptionSegment[] {
  const captionStartMs = caption.start * 1000;
  const captionEndMs = caption.end * 1000;
  let timelineOffsetMs = 0;
  let remappedStart: number | null = null;
  let remappedEnd: number | null = null;
  const remappedWords: CaptionWord[] = [];

  for (const segment of segments) {
    const overlap = getCaptionSegmentOverlap(
      captionStartMs,
      captionEndMs,
      segment,
      timelineOffsetMs
    );

    if (overlap) {
      remappedStart ??= overlap.start;
      remappedEnd = overlap.end;
      remappedWords.push(...remapWordsIntoOverlap(caption.words, overlap));
    }

    timelineOffsetMs += getTrimSegmentDuration(segment);
  }

  if (remappedStart === null || remappedEnd === null || remappedEnd <= remappedStart) {
    return [];
  }

  const mergedWords = mergeAdjacentWordSlices(remappedWords);

  return [{
    id: caption.id,
    start: remappedStart,
    end: remappedEnd,
    text: getCaptionTimelineText(caption, mergedWords),
    words: mergedWords,
  }];
}

export function remapCaptionSegmentsToTimeline(
  captions: CaptionSegment[],
  segments: TrimSegment[] | undefined
): CaptionSegment[] {
  if (!segments || segments.length === 0) {
    return captions.map(cloneSegment);
  }

  return captions.flatMap((caption) => remapCaptionSegmentToTimeline(caption, segments));
}

export function remapCaptionSegmentToSource(
  caption: CaptionSegment,
  segments: TrimSegment[] | undefined
): CaptionSegment {
  return {
    ...caption,
    start: timelineMsToSourceMs(caption.start * 1000, segments) / 1000,
    end: timelineMsToSourceMs(caption.end * 1000, segments) / 1000,
    words: caption.words.map((word) => ({
      ...word,
      start: timelineMsToSourceMs(word.start * 1000, segments) / 1000,
      end: timelineMsToSourceMs(word.end * 1000, segments) / 1000,
    })),
  };
}
