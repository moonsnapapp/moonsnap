import { TEXT_ANIMATION } from '@/constants';
import type { TextAnimation, TextSegment } from '@/types';

const LEGACY_TYPEWRITER_MODE = 'typewriter';
const LEGACY_DEFAULT_ANIMATION_MODES = new Set(['fadeIn', 'fadeOut', 'fadeInOut']);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

export function getEffectiveTypewriterCharsPerSecond(segment: TextSegment): number {
  const requested = getTypewriterCharsPerSecond(segment);
  const totalChars = Array.from(segment.content ?? '').length;
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

  const graphemes = Array.from(content);
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

  const totalChars = Array.from(segment.content ?? '').length;
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

  return Math.min(segment.end, segment.start + Math.max(0, cappedRevealDurationSec));
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
