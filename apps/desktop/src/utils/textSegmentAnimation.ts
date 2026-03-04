import { TEXT_ANIMATION } from '@/constants';
import type { TextAnimation, TextSegment } from '@/types';

const LEGACY_TYPEWRITER_MODE = 'typewriter';
const LEGACY_DEFAULT_ANIMATION_MODES = new Set(['fadeIn', 'fadeOut', 'fadeInOut']);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

let graphemeSegmenter: GraphemeSegmenter | null | undefined;

function splitGraphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    const segmenterCtor = (Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: 'grapheme' },
      ) => GraphemeSegmenter;
    }).Segmenter;
    graphemeSegmenter = segmenterCtor
      ? new segmenterCtor(undefined, { granularity: 'grapheme' })
      : null;
  }

  if (!graphemeSegmenter) {
    return Array.from(text);
  }

  return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
}

function getTypewriterTypingWindowSec(segment: TextSegment): number {
  const segmentDuration = Math.max(0, segment.end - segment.start);
  const fadeDuration = Math.max(0, segment.fadeDuration);
  const hasFadeOutWindow = fadeDuration > 0 && segmentDuration > fadeDuration * 2;
  const outroDuration = hasFadeOutWindow ? fadeDuration : 0;
  return Math.max(0, segmentDuration - outroDuration);
}

export function normalizeTextAnimation(
  animation: TextSegment['animation'] | string | null | undefined,
): TextAnimation {
  if (animation === LEGACY_TYPEWRITER_MODE) {
    return 'typeWriter';
  }

  if (typeof animation === 'string' && LEGACY_DEFAULT_ANIMATION_MODES.has(animation)) {
    return 'none';
  }

  if (animation === 'none' || animation === 'typeWriter') {
    return animation;
  }

  return TEXT_ANIMATION.DEFAULT_MODE;
}

export function getTypewriterCharsPerSecond(segment: TextSegment): number {
  const raw = segment.typewriterCharsPerSecond ?? TEXT_ANIMATION.DEFAULT_TYPEWRITER_CHARS_PER_SECOND;
  if (!Number.isFinite(raw)) {
    return TEXT_ANIMATION.DEFAULT_TYPEWRITER_CHARS_PER_SECOND;
  }

  return clamp(
    raw,
    TEXT_ANIMATION.MIN_TYPEWRITER_CHARS_PER_SECOND,
    TEXT_ANIMATION.MAX_TYPEWRITER_CHARS_PER_SECOND,
  );
}

/**
 * Count the characters that the renderer will actually reveal.
 *
 * The canvas text renderer normalises whitespace (collapses runs of
 * whitespace into single spaces, drops leading/trailing whitespace) before
 * word-wrapping and counting graphemes per line.  The sound-timing code
 * must use the same count; otherwise the sound end-time drifts from the
 * visual reveal end-time — especially noticeable on longer texts where
 * more whitespace characters are collapsed.
 */
function countRenderedGraphemes(content: string): number {
  const normalized = content.split(/\s+/).filter(Boolean).join(' ');
  return splitGraphemes(normalized).length;
}

export function getEffectiveTypewriterCharsPerSecond(segment: TextSegment): number {
  const requested = getTypewriterCharsPerSecond(segment);
  const totalChars = countRenderedGraphemes(segment.content ?? '');
  if (totalChars === 0) {
    return requested;
  }

  const typingWindowSec = getTypewriterTypingWindowSec(segment);
  if (typingWindowSec <= 0) {
    return requested;
  }

  const minimumRequired = totalChars / typingWindowSec;
  return Math.max(requested, minimumRequired);
}

export function getAnimatedTextContent(segment: TextSegment, timeSec: number): string {
  const content = segment.content ?? '';
  if (normalizeTextAnimation(segment.animation) !== 'typeWriter') {
    return content;
  }

  const normalized = content.split(/\s+/).filter(Boolean).join(' ');
  const graphemes = splitGraphemes(normalized);
  if (graphemes.length === 0) {
    return '';
  }

  const elapsed = Math.max(0, timeSec - segment.start);
  const charsPerSecond = getEffectiveTypewriterCharsPerSecond(segment);
  const visibleChars = clamp(Math.floor(elapsed * charsPerSecond), 0, graphemes.length);

  return graphemes.slice(0, visibleChars).join('');
}

export function getTypewriterTypingEndSec(segment: TextSegment): number {
  if (normalizeTextAnimation(segment.animation) !== 'typeWriter') {
    return segment.end;
  }

  const totalChars = countRenderedGraphemes(segment.content ?? '');
  if (totalChars === 0) {
    return segment.start;
  }

  const charsPerSecond = getEffectiveTypewriterCharsPerSecond(segment);
  if (!Number.isFinite(charsPerSecond) || charsPerSecond <= 0) {
    return segment.end;
  }

  const typingWindowSec = getTypewriterTypingWindowSec(segment);
  const revealDurationSec = totalChars / charsPerSecond;
  const cappedRevealDurationSec = typingWindowSec > 0
    ? Math.min(revealDurationSec, typingWindowSec)
    : revealDurationSec;
  // Stop sound slightly before reveal completion so it feels tighter.
  // Use at least one keystroke interval, plus a minimum floor for
  // very fast typing where 1/cps becomes too small to hide tails.
  const keystrokeIntervalSec = 1 / charsPerSecond;
  const stopBufferSec = Math.max(
    keystrokeIntervalSec,
    TEXT_ANIMATION.TYPEWRITER_SOUND_MIN_TAIL_TRIM_SEC,
  );
  const adjustedDuration = Math.max(0, cappedRevealDurationSec - stopBufferSec);

  return Math.min(segment.end, segment.start + adjustedDuration);
}

export function isTypewriterSoundEnabled(segment: TextSegment): boolean {
  return normalizeTextAnimation(segment.animation) === 'typeWriter' && segment.typewriterSoundEnabled === true;
}

export function hasActiveTypewriterSound(
  segments: TextSegment[] | undefined,
  timeSec: number,
): boolean {
  if (!segments || segments.length === 0) {
    return false;
  }

  return segments.some((segment) =>
    segment.enabled &&
    isTypewriterSoundEnabled(segment) &&
    timeSec >= segment.start &&
    timeSec < getTypewriterTypingEndSec(segment)
  );
}
