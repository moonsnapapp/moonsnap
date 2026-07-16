import {
  buildWordsFromEditor,
  MIN_SEGMENT_DURATION_SECONDS,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';

interface CaptionEditorValidationInput {
  editingText: string;
  editingStart: string;
  editingEnd: string;
  editingWords: EditableCaptionWord[];
  didEditWordTiming: boolean;
}
function hasInvalidCaptionSegmentTiming(parsedStart: number, parsedEnd: number): boolean {
  return (
    !Number.isFinite(parsedStart) ||
    !Number.isFinite(parsedEnd) ||
    parsedStart < 0 ||
    parsedEnd <= parsedStart
  );
}

function getNormalizedCaptionEditWindow(parsedStart: number, parsedEnd: number) {
  const start = Math.max(0, parsedStart);

  return {
    start,
    end: Math.max(start + MIN_SEGMENT_DURATION_SECONDS, parsedEnd),
  };
}

function hasInvalidCaptionWordTiming({
  didEditWordTiming,
  hasInvalidSegmentTiming,
  editingWords,
  editingText,
  normalizedStart,
  normalizedEnd,
}: {
  didEditWordTiming: boolean;
  hasInvalidSegmentTiming: boolean;
  editingWords: EditableCaptionWord[];
  editingText: string;
  normalizedStart: number;
  normalizedEnd: number;
}): boolean {
  return (
    didEditWordTiming &&
    !hasInvalidSegmentTiming &&
    buildWordsFromEditor(
      editingWords,
      editingText,
      normalizedStart,
      normalizedEnd
    ) === null
  );
}

function getCaptionEditorTimelineRange(
  hasInvalidSegmentTiming: boolean,
  normalizedStart: number,
  normalizedEnd: number
) {
  const start = hasInvalidSegmentTiming ? 0 : normalizedStart;
  const end = hasInvalidSegmentTiming ? 1 : normalizedEnd;

  return {
    start,
    end,
    duration: Math.max(end - start, MIN_SEGMENT_DURATION_SECONDS),
  };
}

export function getCaptionEditorValidation({
  editingText,
  editingStart,
  editingEnd,
  editingWords,
  didEditWordTiming,
}: CaptionEditorValidationInput) {
  const parsedStart = Number.parseFloat(editingStart);
  const parsedEnd = Number.parseFloat(editingEnd);
  const hasInvalidSegmentTiming = hasInvalidCaptionSegmentTiming(parsedStart, parsedEnd);
  const { start: normalizedStart, end: normalizedEnd } = getNormalizedCaptionEditWindow(
    parsedStart,
    parsedEnd
  );
  const hasInvalidWordTiming = hasInvalidCaptionWordTiming({
    didEditWordTiming,
    hasInvalidSegmentTiming,
    editingWords,
    editingText,
    normalizedStart,
    normalizedEnd,
  });
  const timeline = getCaptionEditorTimelineRange(
    hasInvalidSegmentTiming,
    normalizedStart,
    normalizedEnd
  );

  return {
    parsedStart,
    parsedEnd,
    hasInvalidSegmentTiming,
    hasInvalidWordTiming,
    isSaveDisabled:
      editingText.trim().length === 0 ||
      hasInvalidSegmentTiming ||
      hasInvalidWordTiming,
    timelineSegmentStart: timeline.start,
    timelineSegmentEnd: timeline.end,
    timelineDuration: timeline.duration,
  };
}
