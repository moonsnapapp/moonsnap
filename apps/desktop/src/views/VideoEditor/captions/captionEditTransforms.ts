import type { CaptionSegment, TrimSegment } from '../../../types';
import {
  buildUpdatedWords,
  buildWordsFromEditor,
  MIN_SEGMENT_DURATION_SECONDS,
  segmentMatchesUpdate,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';
import { remapCaptionSegmentToSource } from '../../../utils/captionTimeline';

export interface CaptionEditWindow {
  text: string;
  start: number;
  end: number;
}
export interface ParseCaptionEditWindowOptions {
  requireText?: boolean;
  rejectInvalidOrder?: boolean;
}

function getCaptionEditText(editingText: string, requireText: boolean | undefined): string | null {
  const text = editingText.trim();
  if (requireText && text.length === 0) {
    return null;
  }

  return text;
}

function parseCaptionEditTime(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValidCaptionEditOrder(
  start: number,
  end: number,
  rejectInvalidOrder: boolean | undefined
) {
  return !rejectInvalidOrder || (start >= 0 && end > start);
}

function parseCaptionEditWindowTimes(editingStart: string, editingEnd: string) {
  const start = parseCaptionEditTime(editingStart);
  const end = parseCaptionEditTime(editingEnd);

  return start === null || end === null ? null : { start, end };
}

function getParsedCaptionEditWindow(text: string, start: number, end: number): CaptionEditWindow {
  const normalizedStart = Math.max(0, start);
  return {
    text,
    start: normalizedStart,
    end: Math.max(normalizedStart + MIN_SEGMENT_DURATION_SECONDS, end),
  };
}

export function parseCaptionEditWindow(
  editingText: string,
  editingStart: string,
  editingEnd: string,
  options: ParseCaptionEditWindowOptions = {}
): CaptionEditWindow | null {
  const text = getCaptionEditText(editingText, options.requireText);
  if (text === null) return null;

  const times = parseCaptionEditWindowTimes(editingStart, editingEnd);
  if (!times) {
    return null;
  }

  if (!hasValidCaptionEditOrder(times.start, times.end, options.rejectInvalidOrder)) {
    return null;
  }

  return getParsedCaptionEditWindow(text, times.start, times.end);
}

function buildManualCaptionEditWords(
  editWindow: CaptionEditWindow,
  editingWords: EditableCaptionWord[],
  didEditWordTiming: boolean
) {
  return didEditWordTiming
    ? buildWordsFromEditor(
        editingWords,
        editWindow.text,
        editWindow.start,
        editWindow.end
      )
    : null;
}

function buildCaptionEditWords(
  currentSegment: CaptionSegment,
  editWindow: CaptionEditWindow,
  editingWords: EditableCaptionWord[],
  didEditWordTiming: boolean
) {
  const manualWords = buildManualCaptionEditWords(
    editWindow,
    editingWords,
    didEditWordTiming
  );

  if (didEditWordTiming && manualWords === null) {
    return null;
  }

  return manualWords ?? buildUpdatedWords(
    currentSegment,
    editWindow.text,
    editWindow.start,
    editWindow.end
  );
}

function getCaptionSegmentById(
  captionSegments: CaptionSegment[],
  segmentId: string | null
) {
  return segmentId
    ? captionSegments.find((segment) => segment.id === segmentId) ?? null
    : null;
}

function getCaptionSegmentUpdateCandidate({
  currentSegment,
  editingText,
  editingStart,
  editingEnd,
  editingWords,
  didEditWordTiming,
}: {
  currentSegment: CaptionSegment;
  editingText: string;
  editingStart: string;
  editingEnd: string;
  editingWords: EditableCaptionWord[];
  didEditWordTiming: boolean;
}) {
  const editWindow = parseCaptionEditWindow(editingText, editingStart, editingEnd, {
    requireText: true,
    rejectInvalidOrder: true,
  });
  if (!editWindow) return null;

  const words = buildCaptionEditWords(
    currentSegment,
    editWindow,
    editingWords,
    didEditWordTiming
  );
  if (!words) return null;

  return {
    start: editWindow.start,
    end: editWindow.end,
    text: editWindow.text,
    words,
  };
}

function getChangedCaptionSegmentUpdate(
  currentSegment: CaptionSegment,
  update: ReturnType<typeof getCaptionSegmentUpdateCandidate>
) {
  if (!update) return null;
  return segmentMatchesUpdate(currentSegment, update) ? null : update;
}

export function getLiveCaptionSegmentUpdate({
  editingSegmentId,
  captionSegments,
  editingText,
  editingStart,
  editingEnd,
  editingWords,
  didEditWordTiming,
}: {
  editingSegmentId: string | null;
  captionSegments: CaptionSegment[];
  editingText: string;
  editingStart: string;
  editingEnd: string;
  editingWords: EditableCaptionWord[];
  didEditWordTiming: boolean;
}) {
  const currentSegment = getCaptionSegmentById(captionSegments, editingSegmentId);
  if (!currentSegment) return null;

  return getChangedCaptionSegmentUpdate(
    currentSegment,
    getCaptionSegmentUpdateCandidate({
      currentSegment,
      editingText,
      editingStart,
      editingEnd,
      editingWords,
      didEditWordTiming,
    })
  );
}

export function getCaptionSegmentForEdit(
  segmentId: string,
  captionSegments: CaptionSegment[],
  displayCaptionSegmentsById: Map<string, CaptionSegment>
) {
  const rawSegment = captionSegments.find((segment) => segment.id === segmentId);
  const currentSegment = getCurrentCaptionSegmentForEdit(
    segmentId,
    rawSegment,
    displayCaptionSegmentsById
  );

  return rawSegment && currentSegment
    ? { rawSegment, currentSegment }
    : null;
}

function getCurrentCaptionSegmentForEdit(
  segmentId: string,
  rawSegment: CaptionSegment | undefined,
  displayCaptionSegmentsById: Map<string, CaptionSegment>
) {
  return displayCaptionSegmentsById.get(segmentId) ?? rawSegment ?? null;
}

function createTimelineCaptionSegmentUpdate(
  segmentId: string,
  editWindow: CaptionEditWindow,
  words: CaptionSegment['words']
): CaptionSegment {
  return {
    id: segmentId,
    start: editWindow.start,
    end: editWindow.end,
    text: editWindow.text,
    words,
  };
}

function getSourceCaptionSegmentUpdate(
  segmentId: string,
  timelineSegmentUpdate: CaptionSegment,
  displayCaptionSegmentsById: Map<string, CaptionSegment>,
  timelineSegments: TrimSegment[] | undefined
) {
  return displayCaptionSegmentsById.has(segmentId)
    ? remapCaptionSegmentToSource(timelineSegmentUpdate, timelineSegments ?? [])
    : timelineSegmentUpdate;
}

export function getSavedCaptionSegmentUpdate({
  segmentId,
  currentSegment,
  editingText,
  editingStart,
  editingEnd,
  editingWords,
  didEditWordTiming,
  displayCaptionSegmentsById,
  timelineSegments,
}: {
  segmentId: string;
  currentSegment: CaptionSegment;
  editingText: string;
  editingStart: string;
  editingEnd: string;
  editingWords: EditableCaptionWord[];
  didEditWordTiming: boolean;
  displayCaptionSegmentsById: Map<string, CaptionSegment>;
  timelineSegments: TrimSegment[] | undefined;
}) {
  const editWindow = parseCaptionEditWindow(editingText, editingStart, editingEnd, {
    requireText: true,
  });
  if (!editWindow) return null;

  const savedWords = buildCaptionEditWords(
    currentSegment,
    editWindow,
    editingWords,
    didEditWordTiming
  );
  if (!savedWords) return null;

  const timelineSegmentUpdate = createTimelineCaptionSegmentUpdate(
    segmentId,
    editWindow,
    savedWords
  );

  return {
    editWindow,
    savedWords,
    sourceSegmentUpdate: getSourceCaptionSegmentUpdate(
      segmentId,
      timelineSegmentUpdate,
      displayCaptionSegmentsById,
      timelineSegments
    ),
  };
}
