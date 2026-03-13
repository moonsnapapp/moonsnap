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

export function remapCaptionSegmentsToTimeline(
  captions: CaptionSegment[],
  segments: TrimSegment[] | undefined
): CaptionSegment[] {
  if (!segments || segments.length === 0) {
    return captions.map(cloneSegment);
  }

  return captions.flatMap((caption) => {
    const captionStartMs = caption.start * 1000;
    const captionEndMs = caption.end * 1000;

    let timelineOffsetMs = 0;
    let remappedStart: number | null = null;
    let remappedEnd: number | null = null;
    const remappedWords: CaptionWord[] = [];

    for (const segment of segments) {
      const overlapStartMs = Math.max(captionStartMs, segment.sourceStartMs);
      const overlapEndMs = Math.min(captionEndMs, segment.sourceEndMs);

      if (overlapEndMs > overlapStartMs) {
        const timelineStart =
          (timelineOffsetMs + (overlapStartMs - segment.sourceStartMs)) / 1000;
        const timelineEnd =
          (timelineOffsetMs + (overlapEndMs - segment.sourceStartMs)) / 1000;

        if (remappedStart === null) {
          remappedStart = timelineStart;
        }
        remappedEnd = timelineEnd;

        for (const word of caption.words) {
          const remappedWord = remapWordIntoSegment(word, segment, timelineOffsetMs);
          if (remappedWord) {
            remappedWords.push(remappedWord);
          }
        }
      }

      timelineOffsetMs += segment.sourceEndMs - segment.sourceStartMs;
    }

    if (remappedStart === null || remappedEnd === null || remappedEnd <= remappedStart) {
      return [];
    }

    const mergedWords = mergeAdjacentWordSlices(remappedWords);

    return [{
      id: caption.id,
      start: remappedStart,
      end: remappedEnd,
      text:
        mergedWords.length > 0
          ? mergedWords.map((word) => word.text).join(' ')
          : caption.text,
      words: mergedWords,
    }];
  });
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
