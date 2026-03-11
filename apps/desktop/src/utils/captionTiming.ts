import type { CaptionSegment, CaptionWord } from '@/types';
import { clampWithFallback } from '@/utils/math';

export const MIN_SEGMENT_DURATION_SECONDS = 0.05;
export const MIN_WORD_DURATION_SECONDS = 0.01;
const CAPTION_COMPARE_EPSILON = 0.0005;

export interface EditableCaptionWord {
  text: string;
  start: string;
  end: string;
}

export interface CaptionSegmentUpdate {
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export function clamp(value: number, min: number, max: number): number {
  return clampWithFallback(value, min, max, 'min');
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseEditableWords(words: EditableCaptionWord[]) {
  return words.map((word) => ({
    text: word.text,
    start: Number.parseFloat(word.start),
    end: Number.parseFloat(word.end),
  }));
}

function isCjkChar(ch: string): boolean {
  const codePoint = ch.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}

function textContainsInlineScript(text: string): boolean {
  return Array.from(text).some(isCjkChar);
}

function isInlinePunctuationChar(ch: string): boolean {
  return !/\s/u.test(ch) && !isCjkChar(ch) && !/[\p{Letter}\p{Number}]/u.test(ch);
}

function flushBufferedToken(tokens: string[], token: string): string {
  if (token.length > 0) {
    tokens.push(token);
  }

  return '';
}

export function shouldInsertSpaceBetweenWords(left: string, right: string): boolean {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const leftChar = leftChars[leftChars.length - 1];
  const rightChar = rightChars[0];

  if (!leftChar || !rightChar) {
    return false;
  }

  return (
    !isCjkChar(leftChar) &&
    !isCjkChar(rightChar) &&
    /[\p{Letter}\p{Number}]/u.test(leftChar) &&
    /[\p{Letter}\p{Number}]/u.test(rightChar)
  );
}

export function joinCaptionWordsForDisplay(words: Array<{ text: string }>): string {
  const filteredWords = words.map((word) => word.text).filter(Boolean);
  if (filteredWords.length === 0) {
    return '';
  }

  const usesInlineJoining = filteredWords.some(textContainsInlineScript);
  if (!usesInlineJoining) {
    return filteredWords.join(' ');
  }

  let text = '';
  for (const word of filteredWords) {
    if (text && shouldInsertSpaceBetweenWords(text, word)) {
      text += ' ';
    }
    text += word;
  }

  return text;
}

export function splitCaptionWords(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (!textContainsInlineScript(trimmed)) {
    return trimmed.split(/\s+/u).filter(Boolean);
  }

  const tokens: string[] = [];
  let currentToken = '';

  for (const ch of Array.from(trimmed)) {
    if (/\s/u.test(ch)) {
      currentToken = flushBufferedToken(tokens, currentToken);
      continue;
    }

    if (isCjkChar(ch)) {
      currentToken = flushBufferedToken(tokens, currentToken);
      tokens.push(ch);
      continue;
    }

    if (isInlinePunctuationChar(ch)) {
      if (currentToken.length > 0) {
        currentToken += ch;
      } else if (tokens.length > 0) {
        tokens[tokens.length - 1] += ch;
      } else {
        tokens.push(ch);
      }
      continue;
    }

    currentToken += ch;
  }

  flushBufferedToken(tokens, currentToken);
  return tokens;
}

function remapWordsToSegmentTiming(
  words: CaptionWord[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number
): CaptionWord[] {
  if (words.length === 0) return [];

  const oldDuration = Math.max(oldEnd - oldStart, MIN_SEGMENT_DURATION_SECONDS);
  const newDuration = Math.max(newEnd - newStart, MIN_SEGMENT_DURATION_SECONDS);

  return words.map((word) => {
    const relStart = clamp((word.start - oldStart) / oldDuration, 0, 1);
    const relEnd = clamp((word.end - oldStart) / oldDuration, 0, 1);

    return {
      ...word,
      start: newStart + relStart * newDuration,
      end: newStart + relEnd * newDuration,
    };
  });
}

export function distributeCaptionWordTiming(
  wordTexts: string[],
  start: number,
  end: number
): CaptionWord[] {
  if (wordTexts.length === 0) return [];

  const duration = Math.max(0, end - start);
  if (duration === 0) {
    return wordTexts.map((text) => ({ text, start, end }));
  }

  const step = duration / wordTexts.length;
  return wordTexts.map((text, index) => ({
    text,
    start: start + step * index,
    end: index === wordTexts.length - 1 ? end : start + step * (index + 1),
  }));
}

export function buildUpdatedWords(
  segment: CaptionSegment,
  text: string,
  nextStart: number,
  nextEnd: number
): CaptionWord[] {
  const wordTexts = splitCaptionWords(text);
  if (wordTexts.length === 0) return [];

  if (segment.words.length === wordTexts.length && segment.words.length > 0) {
    const remapped = remapWordsToSegmentTiming(
      segment.words,
      segment.start,
      segment.end,
      nextStart,
      nextEnd
    );
    return remapped.map((word, index) => ({
      ...word,
      text: wordTexts[index],
    }));
  }

  return distributeCaptionWordTiming(wordTexts, nextStart, nextEnd);
}

export function toEditableCaptionWords(words: CaptionWord[]): EditableCaptionWord[] {
  return words.map((word) => ({
    text: word.text,
    start: word.start.toFixed(2),
    end: word.end.toFixed(2),
  }));
}

export function buildEditableWordsForSegment(segment: CaptionSegment): EditableCaptionWord[] {
  const words =
    segment.words.length > 0
      ? segment.words
      : distributeCaptionWordTiming(
          splitCaptionWords(segment.text),
          segment.start,
          segment.end
        );
  return toEditableCaptionWords(words);
}

export function buildWordsFromEditor(
  editorWords: EditableCaptionWord[],
  text: string,
  segmentStart: number,
  segmentEnd: number
): CaptionWord[] | null {
  const wordTexts = splitCaptionWords(text);
  if (wordTexts.length === 0) return [];

  if (editorWords.length !== wordTexts.length) {
    return distributeCaptionWordTiming(wordTexts, segmentStart, segmentEnd);
  }

  const parsedWords = editorWords.map((word) => ({
    text: word.text,
    start: Number.parseFloat(word.start),
    end: Number.parseFloat(word.end),
  }));

  if (parsedWords.some((word) => !Number.isFinite(word.start) || !Number.isFinite(word.end))) {
    return null;
  }

  let previousEnd = segmentStart;
  const mapped: CaptionWord[] = [];

  for (let index = 0; index < parsedWords.length; index += 1) {
    const parsed = parsedWords[index];
    const start = Math.max(segmentStart, parsed.start);
    const end = Math.min(segmentEnd, parsed.end);

    if (end - start < MIN_WORD_DURATION_SECONDS) {
      return null;
    }

    if (start < previousEnd) {
      return null;
    }

    mapped.push({
      text: wordTexts[index],
      start,
      end,
    });
    previousEnd = end;
  }

  return mapped;
}

export function cloneCaptionSegment(segment: CaptionSegment): CaptionSegment {
  return {
    ...segment,
    words: segment.words.map((word) => ({ ...word })),
  };
}

export function cloneCaptionSegments(segments: CaptionSegment[]): CaptionSegment[] {
  return segments.map((segment) => cloneCaptionSegment(segment));
}

function numbersApproxEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < CAPTION_COMPARE_EPSILON;
}

function wordsEqual(left: CaptionWord[], right: CaptionWord[]): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const leftWord = left[index];
    const rightWord = right[index];
    if (
      leftWord.text !== rightWord.text ||
      !numbersApproxEqual(leftWord.start, rightWord.start) ||
      !numbersApproxEqual(leftWord.end, rightWord.end)
    ) {
      return false;
    }
  }

  return true;
}

export function segmentMatchesUpdate(
  segment: CaptionSegment,
  update: CaptionSegmentUpdate
): boolean {
  return (
    segment.text === update.text &&
    numbersApproxEqual(segment.start, update.start) &&
    numbersApproxEqual(segment.end, update.end) &&
    wordsEqual(segment.words, update.words)
  );
}
