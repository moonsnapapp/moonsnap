import {
  clamp,
  MIN_SEGMENT_DURATION_SECONDS,
  MIN_WORD_DURATION_SECONDS,
  parseEditableWords,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';
import type {
  WordDragMode,
  WordDragState,
} from '../components/CaptionPanelWidgets';
import {
  parseCaptionEditWindow,
  type CaptionEditWindow,
} from './captionEditTransforms';

export function getDraggedWordTiming(
  wordDragState: WordDragState,
  clientX: number
) {
  const deltaPx = clientX - wordDragState.startX;
  const segmentDuration = Math.max(
    wordDragState.segmentEnd - wordDragState.segmentStart,
    MIN_SEGMENT_DURATION_SECONDS
  );
  const deltaSeconds = (deltaPx / Math.max(wordDragState.timelineWidth, 1)) * segmentDuration;

  if (wordDragState.mode === 'start') {
    return {
      start: clamp(
        wordDragState.initialStart + deltaSeconds,
        wordDragState.minStart,
        wordDragState.initialEnd - MIN_WORD_DURATION_SECONDS
      ),
      end: wordDragState.initialEnd,
    };
  }

  if (wordDragState.mode === 'end') {
    return {
      start: wordDragState.initialStart,
      end: clamp(
        wordDragState.initialEnd + deltaSeconds,
        wordDragState.initialStart + MIN_WORD_DURATION_SECONDS,
        wordDragState.maxEnd
      ),
    };
  }

  const duration = Math.max(
    wordDragState.initialEnd - wordDragState.initialStart,
    MIN_WORD_DURATION_SECONDS
  );
  const start = clamp(
    wordDragState.initialStart + deltaSeconds,
    wordDragState.minStart,
    wordDragState.maxEnd - duration
  );

  return {
    start,
    end: start + duration,
  };
}

interface WordDragStateInput {
  clientX: number;
  index: number;
  mode: WordDragMode;
  editingStart: string;
  editingEnd: string;
  editingWords: EditableCaptionWord[];
  timelineWidth: number;
}

function parseFiniteSeconds(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCaptionWordTiming(word: EditableCaptionWord | undefined) {
  if (!word) return null;
  const start = parseFiniteSeconds(word.start);
  const end = parseFiniteSeconds(word.end);
  return start === null || end === null ? null : { start, end };
}

function getPreviousWordEnd(
  editWindow: CaptionEditWindow,
  editingWords: EditableCaptionWord[],
  index: number
): number | null {
  if (index <= 0) {
    return editWindow.start;
  }

  return parseFiniteSeconds(editingWords[index - 1]?.end ?? '');
}

function getNextWordStart(
  editWindow: CaptionEditWindow,
  editingWords: EditableCaptionWord[],
  index: number
): number | null {
  if (index >= editingWords.length - 1) {
    return editWindow.end;
  }

  return parseFiniteSeconds(editingWords[index + 1]?.start ?? '');
}

function hasEnoughWordDragRoom(minStart: number, maxEnd: number): boolean {
  return maxEnd - minStart >= MIN_WORD_DURATION_SECONDS;
}

function getWordDragLimits(
  editWindow: CaptionEditWindow,
  editingWords: EditableCaptionWord[],
  index: number
) {
  const previousEnd = getPreviousWordEnd(editWindow, editingWords, index);
  const nextWordStart = getNextWordStart(editWindow, editingWords, index);

  if (previousEnd === null || nextWordStart === null) return null;

  const minStart = Math.max(editWindow.start, previousEnd);
  const maxEnd = Math.min(editWindow.end, nextWordStart);
  return hasEnoughWordDragRoom(minStart, maxEnd) ? { minStart, maxEnd } : null;
}

function getWordDragStateParts({
  editingStart,
  editingEnd,
  editingWords,
  index,
}: Pick<WordDragStateInput, 'editingStart' | 'editingEnd' | 'editingWords' | 'index'>) {
  const editWindow = parseCaptionEditWindow('', editingStart, editingEnd);
  const currentWord = editingWords[index];
  const target = getWordDragStateTarget(editWindow, currentWord);
  if (!target) return null;

  const timing = getCaptionWordTiming(target.currentWord);
  const limits = getWordDragLimits(target.editWindow, editingWords, index);
  return createWordDragStateParts(target.editWindow, timing, limits);
}

function getWordDragStateTarget(
  editWindow: CaptionEditWindow | null,
  currentWord: EditableCaptionWord | undefined
) {
  return editWindow && currentWord ? { editWindow, currentWord } : null;
}

function createWordDragStateParts(
  editWindow: CaptionEditWindow,
  timing: { start: number; end: number } | null,
  limits: { minStart: number; maxEnd: number } | null
) {
  return timing && limits ? { editWindow, timing, limits } : null;
}

export function createWordDragState({
  clientX,
  index,
  mode,
  editingStart,
  editingEnd,
  editingWords,
  timelineWidth,
}: WordDragStateInput): WordDragState | null {
  const parts = getWordDragStateParts({ editingStart, editingEnd, editingWords, index });
  if (!parts) return null;

  return {
    index,
    mode,
    startX: clientX,
    timelineWidth,
    initialStart: parts.timing.start,
    initialEnd: parts.timing.end,
    minStart: parts.limits.minStart,
    maxEnd: parts.limits.maxEnd,
    segmentStart: parts.editWindow.start,
    segmentEnd: parts.editWindow.end,
  };
}

interface WordCompressionResult {
  range: [number, number];
  words: EditableCaptionWord[];
}

function hasValidWordTiming(baseWords: Array<{ start: number; end: number }>) {
  return baseWords.every((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
}

function getMinWordRangeSpanPercent(baseWords: Array<{ start: number; end: number }>) {
  const minBaseDuration = Math.min(...baseWords.map((word) => word.end - word.start));
  const minScaleFromDuration = minBaseDuration > 0
    ? MIN_WORD_DURATION_SECONDS / minBaseDuration
    : 1;
  return clamp(Math.max(minScaleFromDuration * 100, 1), 1, 100);
}

function getCompressionRangeValue(nextRange: number[], index: number, fallback: number) {
  return nextRange[index] ?? fallback;
}

function getSortedCompressionRange(nextRange: number[]) {
  const first = getCompressionRangeValue(nextRange, 0, 0);
  const second = getCompressionRangeValue(nextRange, 1, 100);
  const start = clamp(Math.min(first, second), 0, 100);
  const end = clamp(Math.max(first, second), 0, 100);
  return [start, end] as [number, number];
}

function clampCompressionRangeSpan(
  range: [number, number],
  previousRange: [number, number],
  minRangeSpanPercent: number
): [number, number] {
  const [start, end] = range;
  if (end - start >= minRangeSpanPercent) {
    return range;
  }

  const startDelta = Math.abs(start - previousRange[0]);
  const endDelta = Math.abs(end - previousRange[1]);
  if (startDelta >= endDelta) {
    return [clamp(end - minRangeSpanPercent, 0, end), end];
  }

  return [start, clamp(start + minRangeSpanPercent, start, 100)];
}

function getWordCompressionTargetWindow(
  editWindow: { start: number; end: number },
  range: [number, number]
) {
  const segmentDuration = Math.max(
    editWindow.end - editWindow.start,
    MIN_SEGMENT_DURATION_SECONDS
  );
  const targetStart = editWindow.start + (range[0] / 100) * segmentDuration;
  const targetEnd = editWindow.start + (range[1] / 100) * segmentDuration;

  return {
    segmentDuration,
    targetStart,
    targetDuration: Math.max(targetEnd - targetStart, MIN_WORD_DURATION_SECONDS),
  };
}

function compressWordTimingsToTargetWindow(
  baseWords: Array<{ text: string; start: number; end: number }>,
  editWindowStart: number,
  segmentDuration: number,
  targetStart: number,
  targetDuration: number
): EditableCaptionWord[] {
  return baseWords.map((word) => ({
    text: word.text,
    start: (
      targetStart +
      clamp((word.start - editWindowStart) / segmentDuration, 0, 1) * targetDuration
    ).toFixed(2),
    end: (
      targetStart +
      clamp((word.end - editWindowStart) / segmentDuration, 0, 1) * targetDuration
    ).toFixed(2),
  }));
}

export function getCompressedWordTimings(
  nextRange: number[],
  previousRange: [number, number],
  editingStart: string,
  editingEnd: string,
  baseWords: Array<{ text: string; start: number; end: number }>
): WordCompressionResult | null {
  const editWindow = parseCaptionEditWindow('', editingStart, editingEnd);
  if (!editWindow || baseWords.length === 0) {
    return null;
  }

  if (!hasValidWordTiming(baseWords)) {
    return null;
  }

  const range = clampCompressionRangeSpan(
    getSortedCompressionRange(nextRange),
    previousRange,
    getMinWordRangeSpanPercent(baseWords)
  );
  const { segmentDuration, targetStart, targetDuration } = getWordCompressionTargetWindow(
    editWindow,
    range
  );

  return {
    range,
    words: compressWordTimingsToTargetWindow(
      baseWords,
      editWindow.start,
      segmentDuration,
      targetStart,
      targetDuration
    ),
  };
}

export function getWordCompressionUpdate({
  compressionBaseWords,
  editingWords,
  nextRange,
  wordCompressionRange,
  editingStart,
  editingEnd,
}: {
  compressionBaseWords: Array<{ text: string; start: number; end: number }> | null;
  editingWords: EditableCaptionWord[];
  nextRange: number[];
  wordCompressionRange: [number, number];
  editingStart: string;
  editingEnd: string;
}) {
  const baseWords = getWordCompressionBaseWords(compressionBaseWords, editingWords);
  if (!canCompressEditingWords(baseWords, editingWords)) return null;

  const compressedWords = getCompressedWordTimings(
    nextRange,
    wordCompressionRange,
    editingStart,
    editingEnd,
    baseWords
  );
  if (!compressedWords) return null;

  return { baseWords, compressedWords };
}

function getWordCompressionBaseWords(
  compressionBaseWords: Array<{ text: string; start: number; end: number }> | null,
  editingWords: EditableCaptionWord[]
) {
  return compressionBaseWords ?? parseEditableWords(editingWords);
}

function canCompressEditingWords(
  baseWords: Array<{ text: string; start: number; end: number }>,
  editingWords: EditableCaptionWord[]
) {
  return baseWords.length === editingWords.length && baseWords.length > 0;
}
