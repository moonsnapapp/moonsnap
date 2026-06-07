/**
 * CaptionPanel - Panel for caption transcription and editing.
 * Provides transcription controls, segment list, and settings.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Mic,
  Download,
  Loader2,
  AlertCircle,
  Check,
  ChevronsUpDown,
  X,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { TRANSCRIPTION_LANGUAGE_OPTIONS } from '../../constants';
import { getEffectiveDuration, useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectCaptionSegments,
  selectCaptionSettings,
  selectClearCaptions,
  selectDownloadModel,
  selectDownloadProgress,
  selectIsDownloadingModel,
  selectIsTranscribing,
  selectLoadWhisperModels,
  selectProject,
  selectRequestSeek,
  selectSelectedModelName,
  selectSelectedTranscriptionLanguage,
  selectSetCaptionSegments,
  selectSetCaptionsEnabled,
  selectSetIsPlaying,
  selectSetSelectedModel,
  selectSetSelectedTranscriptionLanguage,
  selectSetTranscriptionProgress,
  selectStartTranscription,
  selectTogglePlayback,
  selectTimelineSegments,
  selectTranscribeCaptionSegment,
  selectTranscriptionError,
  selectTranscriptionProgress,
  selectTranscriptionStage,
  selectUpdateCaptionSegment,
  selectUpdateCaptionSettings,
  selectWhisperModels,
} from '../../stores/videoEditor/selectors';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Slider } from '../../components/ui/slider';
import { Textarea } from '../../components/ui/textarea';
import { CaptionOverlay } from '../../components/VideoEditor/CaptionOverlay';
import type {
  CaptionSegment,
  CaptionSettings,
  TrimSegment,
  TranscriptionProgress,
  DownloadProgress,
} from '../../types';
import { videoEditorLogger } from '../../utils/logger';
import {
  buildEditableWordsForSegment,
  buildUpdatedWords,
  buildWordsFromEditor,
  clamp,
  cloneCaptionSegment,
  cloneCaptionSegments,
  distributeCaptionWordTiming,
  formatTime,
  MIN_SEGMENT_DURATION_SECONDS,
  MIN_WORD_DURATION_SECONDS,
  parseEditableWords,
  segmentMatchesUpdate,
  splitCaptionWords,
  toEditableCaptionWords,
  type EditableCaptionWord,
} from '../../utils/captionTiming';
import {
  remapCaptionSegmentToSource,
  remapCaptionSegmentsToTimeline,
} from '../../utils/captionTimeline';
import {
  CaptionAuditionWatcher,
  CaptionPlaybackTransport,
  SegmentAuditionState,
  WordDragMode,
  WordDragState,
  WordTimingEditor,
} from './components/CaptionPanelWidgets';
import { cn } from '../../lib/utils';

interface CaptionPanelProps {
  videoPath: string | null;
}

const MODEL_SIZES: Record<string, string> = {
  tiny: '~75 MB',
  base: '~140 MB',
  small: '~460 MB',
  medium: '~1.5 GB',
  'large-v3': '~3 GB',
};

const DEFAULT_VISIBLE_SEGMENTS = 20;
const CAPTION_PREVIEW_RENDER_WIDTH = 1920;
const CAPTION_PREVIEW_RENDER_HEIGHT = 1080;
const CAPTION_PREVIEW_CROP_HEIGHT = 260;
const CAPTION_PREVIEW_ZOOM = 1.7;
const CAPTION_PREVIEW_MAX_CROP_DISPLAY_HEIGHT = 220;
const SORTED_TRANSCRIPTION_LANGUAGE_OPTIONS = [...TRANSCRIPTION_LANGUAGE_OPTIONS].sort(
  (left, right) => {
    if (left.value === 'auto') return -1;
    if (right.value === 'auto') return 1;
    return left.label.localeCompare(right.label);
  }
);

interface CaptionSnapshot {
  segments: CaptionSegment[];
  settings: CaptionSettings;
}

interface CaptionEditWindow {
  text: string;
  start: number;
  end: number;
}

interface ParseCaptionEditWindowOptions {
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

function parseCaptionEditWindow(
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

function getLiveCaptionSegmentUpdate({
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

function getCaptionSegmentForEdit(
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

function getSavedCaptionSegmentUpdate({
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

function getCaptionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getDraggedWordTiming(
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

function createWordDragState({
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

function useCaptionPanelModelEffects({
  loadWhisperModels,
  whisperModels,
  regenerateModelName,
  selectedModelName,
  setRegenerateModelName,
  setTranscriptionProgress,
}: {
  loadWhisperModels: () => void;
  whisperModels: Array<{ name: string }>;
  regenerateModelName: string;
  selectedModelName: string;
  setRegenerateModelName: (modelName: string) => void;
  setTranscriptionProgress: (progress: number, stage: string) => void;
}) {
  useEffect(() => {
    loadWhisperModels();
  }, [loadWhisperModels]);

  useEffect(() => {
    if (!whisperModels.some((model) => model.name === regenerateModelName)) {
      setRegenerateModelName(selectedModelName);
    }
  }, [regenerateModelName, selectedModelName, setRegenerateModelName, whisperModels]);

  useEffect(() => {
    const unlistenTranscription = listen<TranscriptionProgress>(
      'transcription-progress',
      (event) => {
        setTranscriptionProgress(event.payload.progress, event.payload.stage);
      }
    );

    const unlistenDownload = listen<DownloadProgress>(
      'whisper-download-progress',
      (event) => {
        void event.payload;
      }
    );

    return () => {
      unlistenTranscription.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
    };
  }, [setTranscriptionProgress]);
}

function getDownloadedModelState(models: Array<{ name: string; downloaded: boolean }>, modelName: string) {
  return models.find((model) => model.name === modelName)?.downloaded ?? false;
}

function getVisibleCaptionSegments(
  showAllSegments: boolean,
  displayCaptionSegments: CaptionSegment[]
) {
  return showAllSegments
    ? displayCaptionSegments
    : displayCaptionSegments.slice(0, DEFAULT_VISIBLE_SEGMENTS);
}

function getCaptionPreviewSourceSize(project: ReturnType<typeof selectProject>) {
  return {
    width: project?.sources.originalWidth ?? 1920,
    height: project?.sources.originalHeight ?? 1080,
  };
}

function getCaptionEditDisplaySegment(
  displayCaptionSegmentsById: Map<string, CaptionSegment>,
  segment: CaptionSegment
) {
  return displayCaptionSegmentsById.get(segment.id) ?? segment;
}

function addOriginalCaptionSegmentSnapshot(
  previous: Record<string, CaptionSegment>,
  segment: CaptionSegment
) {
  if (previous[segment.id]) return previous;
  return { ...previous, [segment.id]: cloneCaptionSegment(segment) };
}

function getCompressedWordTimings(
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

function getWordCompressionUpdate({
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

function getRegenerateEditingSegmentRequest({
  editingSegmentId,
  videoPath,
  editingText,
  editingStart,
  editingEnd,
  displayCaptionSegmentsById,
  timelineSegments,
}: {
  editingSegmentId: string | null;
  videoPath: string | null;
  editingText: string;
  editingStart: string;
  editingEnd: string;
  displayCaptionSegmentsById: Map<string, CaptionSegment>;
  timelineSegments: TrimSegment[] | undefined;
}) {
  const requestTarget = getRegenerateRequestTarget(editingSegmentId, videoPath);
  if (!requestTarget) return null;

  const editWindow = parseCaptionEditWindow(editingText, editingStart, editingEnd);
  if (!editWindow) return null;

  const timelineWindow: CaptionSegment = {
    id: requestTarget.editingSegmentId,
    start: editWindow.start,
    end: editWindow.end,
    text: '',
    words: [],
  };

  return {
    editingSegmentId: requestTarget.editingSegmentId,
    videoPath: requestTarget.videoPath,
    sourceWindow: displayCaptionSegmentsById.has(requestTarget.editingSegmentId)
      ? remapCaptionSegmentToSource(timelineWindow, timelineSegments)
      : timelineWindow,
  };
}

function getRegenerateRequestTarget(
  editingSegmentId: string | null,
  videoPath: string | null
) {
  return editingSegmentId && videoPath ? { editingSegmentId, videoPath } : null;
}

interface TranscribeRequest {
  videoPath: string | null;
  isModelDownloaded: boolean;
  selectedModelName: string;
  downloadModel: (modelName: string) => Promise<void>;
  startTranscription: (videoPath: string) => Promise<void>;
}

async function transcribeWithDownloadedModel({
  videoPath,
  isModelDownloaded,
  selectedModelName,
  downloadModel,
  startTranscription,
}: TranscribeRequest) {
  if (!videoPath) return;

  const hasModel = await ensureTranscriptionModelDownloaded({
    isModelDownloaded,
    selectedModelName,
    downloadModel,
  });
  if (!hasModel) return;

  try {
    await startTranscription(videoPath);
  } catch (error) {
    videoEditorLogger.error('Transcription failed:', error);
  }
}

async function ensureTranscriptionModelDownloaded({
  isModelDownloaded,
  selectedModelName,
  downloadModel,
}: Pick<TranscribeRequest, 'isModelDownloaded' | 'selectedModelName' | 'downloadModel'>) {
  if (isModelDownloaded) return true;

  try {
    await downloadModel(selectedModelName);
    return true;
  } catch (error) {
    videoEditorLogger.error('Failed to download model:', error);
    return false;
  }
}

function getInitialEditorSegment(
  editingSegmentId: string | null,
  displayCaptionSegments: CaptionSegment[],
  captionSegments: CaptionSegment[]
) {
  if (editingSegmentId) {
    return null;
  }

  const firstVisibleSegmentId = displayCaptionSegments[0]?.id;
  return getCaptionSegmentByOptionalId(captionSegments, firstVisibleSegmentId) ??
    getFirstCaptionSegment(captionSegments);
}

function getCaptionSegmentByOptionalId(
  captionSegments: CaptionSegment[],
  segmentId: string | undefined
) {
  return segmentId ? captionSegments.find((segment) => segment.id === segmentId) ?? null : null;
}

function getFirstCaptionSegment(captionSegments: CaptionSegment[]) {
  return captionSegments[0] ?? null;
}

interface SegmentAuditionTiming {
  rawSegment: CaptionSegment;
  state: SegmentAuditionState;
}

function getSegmentAuditionTiming(
  segmentId: string,
  captionSegments: CaptionSegment[],
  displayCaptionSegmentsById: Map<string, CaptionSegment>
): SegmentAuditionTiming | null {
  const rawSegment = captionSegments.find((segment) => segment.id === segmentId);
  const timelineSegment = displayCaptionSegmentsById.get(segmentId);
  if (!rawSegment || !timelineSegment) {
    return null;
  }

  const startMs = Math.max(0, Math.floor(timelineSegment.start * 1000));
  return {
    rawSegment,
    state: {
      segmentId,
      startMs,
      endMs: Math.max(startMs + 1, Math.floor(timelineSegment.end * 1000)),
    },
  };
}

function getSelectedEditingSegment(
  editingSegmentId: string | null,
  displayCaptionSegmentsById: Map<string, CaptionSegment>,
  captionSegments: CaptionSegment[]
) {
  if (!editingSegmentId) {
    return null;
  }

  return (
    displayCaptionSegmentsById.get(editingSegmentId) ??
    captionSegments.find((segment) => segment.id === editingSegmentId) ??
    null
  );
}

function getProjectDurationSeconds(
  project: ReturnType<typeof selectProject>,
  timelineSegments: ReturnType<typeof selectTimelineSegments>,
  displayCaptionSegments: CaptionSegment[]
) {
  const timelineDurationMs = project
    ? getEffectiveDuration(timelineSegments ?? [], project.timeline.durationMs)
    : 0;
  const captionDurationSeconds = displayCaptionSegments.reduce(
    (max, segment) => Math.max(max, segment.end),
    0
  );

  return Math.max(timelineDurationMs / 1000, captionDurationSeconds, 1);
}

interface RegenerateDisabledInput {
  videoPath: string | null;
  editingSegmentId: string | null;
  captionSegments: CaptionSegment[];
  hasInvalidSegmentTiming: boolean;
  isRegeneratingSegment: boolean;
  isRegeneratingAllSegments: boolean;
}

function hasCaptionVideoPath(videoPath: string | null) {
  return Boolean(videoPath);
}

function isCaptionRegenerationBusy({
  isRegeneratingSegment,
  isRegeneratingAllSegments,
}: Pick<RegenerateDisabledInput, 'isRegeneratingSegment' | 'isRegeneratingAllSegments'>) {
  return isRegeneratingSegment || isRegeneratingAllSegments;
}

function canRegenerateCaptionSegment({
  videoPath,
  editingSegmentId,
  hasInvalidSegmentTiming,
  isBusy,
}: {
  videoPath: string | null;
  editingSegmentId: string | null;
  hasInvalidSegmentTiming: boolean;
  isBusy: boolean;
}) {
  return Boolean(videoPath && editingSegmentId && !hasInvalidSegmentTiming && !isBusy);
}

function canRegenerateAllCaptionSegments({
  videoPath,
  captionSegments,
  isBusy,
}: {
  videoPath: string | null;
  captionSegments: CaptionSegment[];
  isBusy: boolean;
}) {
  return hasCaptionVideoPath(videoPath) && captionSegments.length > 0 && !isBusy;
}

function getRegenerateDisabledState({
  videoPath,
  editingSegmentId,
  captionSegments,
  hasInvalidSegmentTiming,
  isRegeneratingSegment,
  isRegeneratingAllSegments,
}: RegenerateDisabledInput) {
  const isBusy = isCaptionRegenerationBusy({
    isRegeneratingSegment,
    isRegeneratingAllSegments,
  });

  return {
    isRegenerateDisabled: !canRegenerateCaptionSegment({
      videoPath,
      editingSegmentId,
      hasInvalidSegmentTiming,
      isBusy,
    }),
    isRegenerateAllDisabled: !canRegenerateAllCaptionSegments({
      videoPath,
      captionSegments,
      isBusy,
    }),
  };
}

function getCaptionPreviewLayout(
  displayWidth: number,
  position: CaptionSettings['position']
) {
  const scale =
    (displayWidth / CAPTION_PREVIEW_RENDER_WIDTH) *
    CAPTION_PREVIEW_ZOOM;
  const scaledWidth = Math.round(CAPTION_PREVIEW_RENDER_WIDTH * scale);
  const displayHeight = Math.round(CAPTION_PREVIEW_RENDER_HEIGHT * scale);
  const cropDisplayHeight = clamp(
    Math.round(CAPTION_PREVIEW_CROP_HEIGHT * scale),
    72,
    CAPTION_PREVIEW_MAX_CROP_DISPLAY_HEIGHT
  );
  const offsetX = Math.max(0, Math.round((scaledWidth - displayWidth) / 2));
  const cropOffsetY =
    position === 'top'
      ? 0
      : Math.max(0, displayHeight - cropDisplayHeight);

  return {
    scale,
    scaledWidth,
    displayHeight,
    cropDisplayHeight,
    offsetX,
    cropOffsetY,
  };
}

function useObservedCaptionPreviewWidth(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  const [displayWidth, setDisplayWidth] = useState(720);

  useEffect(() => {
    if (!enabled) return;

    const host = hostRef.current;
    if (!host) return;

    const THROTTLE_MS = 100;
    let rafId: number | null = null;
    let trailingId: ReturnType<typeof setTimeout> | null = null;
    let lastFlushTime = 0;

    const updateWidth = () => {
      rafId = null;
      lastFlushTime = performance.now();
      const nextWidth = Math.floor(host.clientWidth);
      if (nextWidth > 0) {
        setDisplayWidth((prev) => (prev === nextWidth ? prev : nextWidth));
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      if (rafId !== null || trailingId !== null) return;
      const elapsed = performance.now() - lastFlushTime;
      if (elapsed >= THROTTLE_MS) {
        rafId = requestAnimationFrame(updateWidth);
      } else {
        trailingId = setTimeout(() => {
          trailingId = null;
          rafId = requestAnimationFrame(updateWidth);
        }, THROTTLE_MS - elapsed);
      }
    });
    observer.observe(host);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (trailingId !== null) clearTimeout(trailingId);
      observer.disconnect();
    };
  }, [enabled, hostRef]);

  return displayWidth;
}

interface TranscriptionLanguageComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

function TranscriptionLanguageCombobox({
  value,
  onChange,
  className,
  placeholder = 'Select language',
}: TranscriptionLanguageComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = SORTED_TRANSCRIPTION_LANGUAGE_OPTIONS.find(
    (option) => option.value === value
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 text-left text-sm text-[var(--ink-dark)] transition-colors hover:bg-[var(--glass-highlight)]',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-[var(--ink-subtle)]" />
        </button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] border-[var(--glass-border)] bg-[var(--glass-surface-dark)] p-0"
        >
          <Command className="bg-transparent text-[var(--ink-dark)]">
            <CommandInput placeholder="Search languages..." className="h-9" />
            <CommandList className="max-h-[260px]">
              <CommandEmpty>No language found.</CommandEmpty>
              <CommandGroup>
                {SORTED_TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => (
                  <CommandItem
                    key={`transcription-language-${option.value}`}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="text-sm"
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === option.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      )}
    </Popover>
  );
}

interface WhisperModelSelectProps {
  value: string;
  models: Array<{ name: string; downloaded: boolean }>;
  onChange: (value: string) => void;
  className?: string;
}

function WhisperModelSelect({
  value,
  models,
  onChange,
  className,
}: WhisperModelSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          'h-9 border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 text-sm text-[var(--ink-dark)]',
          className
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
        {models.map((model) => (
          <SelectItem key={model.name} value={model.name}>
            {`${model.name}${MODEL_SIZES[model.name] ? ` (${MODEL_SIZES[model.name]})` : ''}${
              model.downloaded ? '' : ' - download'
            }`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface TranscriptionControlsProps {
  videoPath: string | null;
  selectedModelName: string;
  whisperModels: Array<{ name: string; downloaded: boolean }>;
  isModelDownloaded: boolean;
  selectedTranscriptionLanguage: string;
  isDownloadingModel: boolean;
  downloadProgress: number;
  isTranscribing: boolean;
  transcriptionStage: string | null;
  transcriptionProgress: number;
  transcriptionError: string | null;
  hasCaptionSegments: boolean;
  onSelectModel: (value: string) => void;
  onSelectLanguage: (value: string) => void;
  onTranscribe: () => void;
  onClearCaptions: () => void;
}

function TranscriptionActionContent({
  isDownloadingModel,
  downloadProgress,
  isTranscribing,
  transcriptionStage,
  transcriptionProgress,
  isModelDownloaded,
  hasCaptionSegments,
}: Pick<
  TranscriptionControlsProps,
  | 'isDownloadingModel'
  | 'downloadProgress'
  | 'isTranscribing'
  | 'transcriptionStage'
  | 'transcriptionProgress'
  | 'isModelDownloaded'
  | 'hasCaptionSegments'
>) {
  const action = getTranscriptionActionState({
    isDownloadingModel,
    downloadProgress,
    isTranscribing,
    transcriptionStage,
    transcriptionProgress,
    isModelDownloaded,
    hasCaptionSegments,
  });

  if (action.icon === 'loading') {
    return (
      <>
        <Loader2 className="w-4 h-4 animate-spin" />
        {action.label}
      </>
    );
  }

  if (action.icon === 'download') {
    return (
      <>
        <Download className="w-4 h-4" />
        {action.label}
      </>
    );
  }

  return (
    <>
      <Mic className="w-4 h-4" />
      {action.label}
    </>
  );
}

function getTranscriptionActionState({
  isDownloadingModel,
  downloadProgress,
  isTranscribing,
  transcriptionStage,
  transcriptionProgress,
  isModelDownloaded,
  hasCaptionSegments,
}: Pick<
  TranscriptionControlsProps,
  | 'isDownloadingModel'
  | 'downloadProgress'
  | 'isTranscribing'
  | 'transcriptionStage'
  | 'transcriptionProgress'
  | 'isModelDownloaded'
  | 'hasCaptionSegments'
>) {
  if (isDownloadingModel) {
    return {
      icon: 'loading' as const,
      label: `Downloading... ${Math.round(downloadProgress)}%`,
    };
  }

  if (isTranscribing) {
    return {
      icon: 'loading' as const,
      label: getTranscriptionProgressLabel(transcriptionStage, transcriptionProgress),
    };
  }

  if (!isModelDownloaded) {
    return { icon: 'download' as const, label: 'Download & Transcribe' };
  }

  return {
    icon: 'mic' as const,
    label: getTranscribeActionLabel(hasCaptionSegments),
  };
}

function getTranscriptionProgressLabel(stage: string | null, progress: number) {
  return stage === 'extracting_audio'
    ? 'Extracting audio...'
    : `Transcribing... ${Math.round(progress)}%`;
}

function getTranscribeActionLabel(hasCaptionSegments: boolean) {
  return hasCaptionSegments ? 'Re-transcribe' : 'Transcribe Audio';
}

function getModelDownloadStatusLabel(isModelDownloaded: boolean) {
  return isModelDownloaded ? 'Model downloaded' : 'Downloads on transcribe';
}

function ClearCaptionsButton({
  hasCaptionSegments,
  isBusy,
  onClearCaptions,
}: Pick<TranscriptionControlsProps, 'hasCaptionSegments' | 'onClearCaptions'> & {
  isBusy: boolean;
}) {
  if (!hasCaptionSegments) return null;

  return (
    <button
      type="button"
      onClick={onClearCaptions}
      disabled={isBusy}
      className="editor-choice-pill flex items-center justify-center gap-2 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Trash2 className="w-4 h-4" />
      Clear
    </button>
  );
}

function TranscriptionErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="mt-2 flex items-start gap-2 p-2 bg-[var(--error-light)] rounded-md">
      <AlertCircle className="w-4 h-4 text-[var(--error)] flex-shrink-0 mt-0.5" />
      <span className="text-xs text-[var(--error)]">{error}</span>
    </div>
  );
}

function TranscriptionControls({
  videoPath,
  selectedModelName,
  whisperModels,
  isModelDownloaded,
  selectedTranscriptionLanguage,
  isDownloadingModel,
  downloadProgress,
  isTranscribing,
  transcriptionStage,
  transcriptionProgress,
  transcriptionError,
  hasCaptionSegments,
  onSelectModel,
  onSelectLanguage,
  onTranscribe,
  onClearCaptions,
}: TranscriptionControlsProps) {
  const isBusy = isTranscribing || isDownloadingModel;

  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center gap-2 mb-3">
        <Mic className="w-4 h-4 text-[var(--ink-muted)]" />
        <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
          Transcription
        </span>
      </div>

      <div className="mb-3">
        <WhisperModelSelect
          value={selectedModelName}
          models={whisperModels}
          onChange={onSelectModel}
          className="w-full"
        />
        <div className="mt-1 text-[10px] text-[var(--ink-subtle)]">
          {getModelDownloadStatusLabel(isModelDownloaded)}
        </div>
      </div>

      <div className="mb-3">
        <label className="text-xs text-[var(--ink-muted)] block mb-1">
          Language
        </label>
        <TranscriptionLanguageCombobox
          value={selectedTranscriptionLanguage}
          onChange={onSelectLanguage}
        />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={onTranscribe}
          disabled={!videoPath || isBusy}
          className="editor-choice-pill editor-choice-pill--active flex-1 flex items-center justify-center gap-2 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <TranscriptionActionContent
            isDownloadingModel={isDownloadingModel}
            downloadProgress={downloadProgress}
            isTranscribing={isTranscribing}
            transcriptionStage={transcriptionStage}
            transcriptionProgress={transcriptionProgress}
            isModelDownloaded={isModelDownloaded}
            hasCaptionSegments={hasCaptionSegments}
          />
        </button>
        <ClearCaptionsButton
          hasCaptionSegments={hasCaptionSegments}
          isBusy={isBusy}
          onClearCaptions={onClearCaptions}
        />
      </div>

      <TranscriptionErrorMessage error={transcriptionError} />
    </div>
  );
}

interface CaptionSegmentsListProps {
  segments: CaptionSegment[];
  visibleSegments: CaptionSegment[];
  showAllSegments: boolean;
  onToggleShowAllSegments: () => void;
  onOpenEditor: () => void;
}

function CaptionSegmentsList({
  segments,
  visibleSegments,
  showAllSegments,
  onToggleShowAllSegments,
  onOpenEditor,
}: CaptionSegmentsListProps) {
  if (segments.length === 0) return null;

  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
          Segments ({segments.length})
        </span>
        <button
          type="button"
          onClick={onOpenEditor}
          className="editor-choice-pill editor-choice-pill--active px-2 py-1 text-[10px]"
        >
          Open Editor
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {visibleSegments.map((segment) => (
          <div
            key={segment.id}
            className="px-2 py-1.5 bg-[var(--polar-mist)] rounded text-xs"
          >
            <div className="mb-0.5 text-[var(--ink-subtle)] font-mono">
              {formatTime(segment.start)} - {formatTime(segment.end)}
            </div>
            <p className="text-[var(--ink-dark)] break-words line-clamp-2">
              {segment.text}
            </p>
          </div>
        ))}
      </div>
      {segments.length > DEFAULT_VISIBLE_SEGMENTS && (
        <button
          onClick={onToggleShowAllSegments}
          className="mt-2 w-full px-2 py-1.5 rounded text-xs text-[var(--ink-subtle)] hover:text-[var(--ink-dark)] hover:bg-[var(--polar-mist)] transition-colors"
        >
          {showAllSegments
            ? `Show fewer (first ${DEFAULT_VISIBLE_SEGMENTS})`
            : `Show all ${segments.length} segments`}
        </button>
      )}
    </div>
  );
}

interface CaptionStyleSettingsProps {
  settings: CaptionSettings;
  onUpdateSettings: (updates: Partial<CaptionSettings>) => void;
}

function CaptionStyleSettings({
  settings,
  onUpdateSettings,
}: CaptionStyleSettingsProps) {
  return (
    <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
      <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide block">
        Style
      </span>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--ink-muted)]">Font Size</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {settings.size}px
          </span>
        </div>
        <Slider
          value={[settings.size]}
          onValueChange={(values) => onUpdateSettings({ size: values[0] })}
          min={16}
          max={64}
          step={2}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Text Color</span>
        <input
          type="color"
          value={settings.color}
          onChange={(event) => onUpdateSettings({ color: event.target.value })}
          className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Highlight Color</span>
        <input
          type="color"
          value={settings.highlightColor}
          onChange={(event) =>
            onUpdateSettings({ highlightColor: event.target.value })
          }
          className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
        />
      </div>

      <div className="space-y-2">
        <span className="text-xs text-[var(--ink-muted)] block">
          Animation Timing
        </span>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">
              Word Transition
            </span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {settings.wordTransitionDuration.toFixed(2)}s
            </span>
          </div>
          <Slider
            value={[Math.round(settings.wordTransitionDuration * 100)]}
            onValueChange={(values) =>
              onUpdateSettings({ wordTransitionDuration: values[0] / 100 })
            }
            min={0}
            max={100}
            step={1}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">Segment Fade</span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {settings.fadeDuration.toFixed(2)}s
            </span>
          </div>
          <Slider
            value={[Math.round(settings.fadeDuration * 100)]}
            onValueChange={(values) =>
              onUpdateSettings({ fadeDuration: values[0] / 100 })
            }
            min={0}
            max={150}
            step={1}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">
              Linger After Segment
            </span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {settings.lingerDuration.toFixed(2)}s
            </span>
          </div>
          <Slider
            value={[Math.round(settings.lingerDuration * 100)]}
            onValueChange={(values) =>
              onUpdateSettings({ lingerDuration: values[0] / 100 })
            }
            min={0}
            max={300}
            step={1}
          />
        </div>
      </div>

      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">
          Position
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => onUpdateSettings({ position: 'top' })}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs ${
              settings.position === 'top' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Top
          </button>
          <button
            onClick={() => onUpdateSettings({ position: 'bottom' })}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs ${
              settings.position === 'bottom' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Bottom
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">
          Background Color
        </span>
        <input
          type="color"
          value={settings.backgroundColor}
          onChange={(event) =>
            onUpdateSettings({ backgroundColor: event.target.value })
          }
          className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--ink-muted)]">
            Background Opacity
          </span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {settings.backgroundOpacity}%
          </span>
        </div>
        <Slider
          value={[settings.backgroundOpacity]}
          onValueChange={(values) =>
            onUpdateSettings({ backgroundOpacity: values[0] })
          }
          min={0}
          max={100}
          step={5}
        />
      </div>
    </div>
  );
}

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

function getCaptionEditorValidation({
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

interface CaptionEditorSegmentListProps {
  displaySegments: CaptionSegment[];
  captionSegments: CaptionSegment[];
  editingSegmentId: string | null;
  isSegmentDirty: (segment: CaptionSegment) => boolean;
  onAuditionSegment: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
}

function CaptionEditorSegmentList({
  displaySegments,
  captionSegments,
  editingSegmentId,
  isSegmentDirty,
  onAuditionSegment,
  onResetSegment,
}: CaptionEditorSegmentListProps) {
  return (
    <div className="border-r border-[var(--glass-border)] p-3 overflow-y-auto space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ink-subtle)] mb-1">
        Segments
      </div>
      <p className="text-[10px] text-[var(--ink-subtle)] mb-2">
        Click a segment to audition. Edits auto-apply live; use reset per row to
        revert.
      </p>
      {displaySegments.map((segment) => {
        const rawSegment = captionSegments.find((entry) => entry.id === segment.id);
        const dirty = rawSegment ? isSegmentDirty(rawSegment) : false;

        return (
          <div key={`editor-segment-${segment.id}`} className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => onAuditionSegment(segment.id)}
              className={`editor-choice-pill flex-1 text-left px-2 py-1.5 ${
                editingSegmentId === segment.id ? 'editor-choice-pill--active' : ''
              }`}
            >
              <div className="text-[10px] font-mono text-[var(--ink-subtle)]">
                {formatTime(segment.start)} - {formatTime(segment.end)}
              </div>
              <div className="text-xs truncate">{segment.text}</div>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onResetSegment(segment.id);
              }}
              disabled={!dirty}
              className="w-7 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] text-[var(--ink-subtle)] hover:bg-[var(--glass-highlight)] hover:text-[var(--ink-dark)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={dirty ? 'Reset this segment' : 'No changes to reset'}
            >
              <RotateCcw className="w-3.5 h-3.5 mx-auto" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface CaptionEditorDialogProps {
  isEditorOpen: boolean;
  onOpenChange: (open: boolean) => void;
  displayCaptionSegments: CaptionSegment[];
  captionSegments: CaptionSegment[];
  editingSegmentId: string | null;
  isSegmentDirty: (segment: CaptionSegment) => boolean;
  onAuditionSegment: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  projectDurationSeconds: number;
  onTogglePlayback: () => void;
  onBeginPlaybackScrub: (event: React.MouseEvent<HTMLDivElement>) => void;
  playbackTimelineRef: RefObject<HTMLDivElement | null>;
  captionPreviewHostRef: RefObject<HTMLDivElement | null>;
  captionPreviewDisplayWidth: number;
  captionPreviewCropDisplayHeight: number;
  captionPreviewOffsetX: number;
  captionPreviewScaledWidth: number;
  captionPreviewDisplayHeight: number;
  captionPreviewCropOffsetY: number;
  captionPreviewScale: number;
  previewSourceWidth: number;
  previewSourceHeight: number;
  selectedEditingSegment: CaptionSegment | null;
  editingStart: string;
  editingEnd: string;
  editingText: string;
  onEditingStartChange: (value: string) => void;
  onEditingEndChange: (value: string) => void;
  onEditingTextChange: (value: string) => void;
  timelineSegmentStart: number;
  timelineDuration: number;
  wordCompressionRange: [number, number];
  onBeginLocalTimelineScrub: (event: React.MouseEvent<HTMLDivElement>) => void;
  localTimelineRef: RefObject<HTMLDivElement | null>;
  applyWordCompressionRange: (nextRange: number[]) => void;
  wordTimelineRef: RefObject<HTMLDivElement | null>;
  editingWords: EditableCaptionWord[];
  wordDragState: WordDragState | null;
  startWordDrag: (
    event: {
      clientX: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    },
    index: number,
    mode: WordDragMode
  ) => void;
  updateEditingWordTiming: (index: number, field: 'start' | 'end', value: string) => void;
  syncWordsFromText: () => void;
  hasInvalidWordTiming: boolean;
  regenerateModelName: string;
  whisperModels: Array<{ name: string; downloaded: boolean }>;
  onRegenerateModelChange: (value: string) => void;
  isRegenerateModelDownloaded: boolean;
  selectedTranscriptionLanguage: string;
  onSelectedTranscriptionLanguageChange: (value: string) => void;
  onCancelEditingSegment: () => void;
  onRegenerateEditingSegment: () => void;
  isRegenerateDisabled: boolean;
  isRegeneratingSegment: boolean;
  onRegenerateAllSegments: () => void;
  isRegenerateAllDisabled: boolean;
  isRegeneratingAllSegments: boolean;
  transcriptionProgress: number;
  onUndoLastRegenerate: () => void;
  lastRegenSnapshot: CaptionSnapshot | null;
  onSaveEditingSegment: () => void;
  isSaveDisabled: boolean;
  segmentRegenerateError: string | null;
}

function RegenerateModelDownloadNote({
  isDownloaded,
}: {
  isDownloaded: boolean;
}) {
  if (isDownloaded) {
    return null;
  }

  return (
    <span className="text-[10px] text-[var(--ink-subtle)] whitespace-nowrap">
      Downloads on regenerate
    </span>
  );
}

function RegenerateSegmentButtonContent({
  isRegenerating,
}: {
  isRegenerating: boolean;
}) {
  if (!isRegenerating) {
    return 'Regenerate Segment';
  }

  return (
    <>
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      Regenerating...
    </>
  );
}

function RegenerateAllButtonContent({
  isRegenerating,
  transcriptionProgress,
}: {
  isRegenerating: boolean;
  transcriptionProgress: number;
}) {
  if (!isRegenerating) {
    return 'Re-transcribe All';
  }

  return (
    <>
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      Re-transcribing All... {Math.round(transcriptionProgress)}%
    </>
  );
}

function SegmentRegenerateError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return <p className="text-[10px] text-[var(--error)]">{error}</p>;
}

function CaptionEditorDialog({
  isEditorOpen,
  onOpenChange,
  displayCaptionSegments,
  captionSegments,
  editingSegmentId,
  isSegmentDirty,
  onAuditionSegment,
  onResetSegment,
  projectDurationSeconds,
  onTogglePlayback,
  onBeginPlaybackScrub,
  playbackTimelineRef,
  captionPreviewHostRef,
  captionPreviewDisplayWidth,
  captionPreviewCropDisplayHeight,
  captionPreviewOffsetX,
  captionPreviewScaledWidth,
  captionPreviewDisplayHeight,
  captionPreviewCropOffsetY,
  captionPreviewScale,
  previewSourceWidth,
  previewSourceHeight,
  selectedEditingSegment,
  editingStart,
  editingEnd,
  editingText,
  onEditingStartChange,
  onEditingEndChange,
  onEditingTextChange,
  timelineSegmentStart,
  timelineDuration,
  wordCompressionRange,
  onBeginLocalTimelineScrub,
  localTimelineRef,
  applyWordCompressionRange,
  wordTimelineRef,
  editingWords,
  wordDragState,
  startWordDrag,
  updateEditingWordTiming,
  syncWordsFromText,
  hasInvalidWordTiming,
  regenerateModelName,
  whisperModels,
  onRegenerateModelChange,
  isRegenerateModelDownloaded,
  selectedTranscriptionLanguage,
  onSelectedTranscriptionLanguageChange,
  onCancelEditingSegment,
  onRegenerateEditingSegment,
  isRegenerateDisabled,
  isRegeneratingSegment,
  onRegenerateAllSegments,
  isRegenerateAllDisabled,
  isRegeneratingAllSegments,
  transcriptionProgress,
  onUndoLastRegenerate,
  lastRegenSnapshot,
  onSaveEditingSegment,
  isSaveDisabled,
  segmentRegenerateError,
}: CaptionEditorDialogProps) {
  return (
    <Dialog open={isEditorOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[1200px] h-[88vh] p-0 gap-0 grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader className="px-4 py-3 border-b border-[var(--glass-border)]">
          <DialogTitle className="text-base text-[var(--ink-dark)]">
            Caption Editor
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[280px_minmax(0,1fr)] min-h-0 h-full">
          <CaptionEditorSegmentList
            displaySegments={displayCaptionSegments}
            captionSegments={captionSegments}
            editingSegmentId={editingSegmentId}
            isSegmentDirty={isSegmentDirty}
            onAuditionSegment={onAuditionSegment}
            onResetSegment={onResetSegment}
          />

          <div className="min-w-0 min-h-0 flex flex-col p-4 gap-3 overflow-hidden">
            <CaptionPlaybackTransport
              captionSegments={displayCaptionSegments}
              projectDurationSeconds={projectDurationSeconds}
              onTogglePlayback={onTogglePlayback}
              onBeginPlaybackScrub={onBeginPlaybackScrub}
              playbackTimelineRef={playbackTimelineRef}
            />

            <div className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-surface-dark)]/60 p-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-subtle)] mb-2">
                Caption Preview
              </div>
              <div ref={captionPreviewHostRef} className="w-full">
                <div
                  className="relative rounded-md overflow-hidden border border-[var(--glass-border)] bg-[var(--polar-mist)]/40"
                  style={{
                    width: `${captionPreviewDisplayWidth}px`,
                    height: `${captionPreviewCropDisplayHeight}px`,
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      left: `-${captionPreviewOffsetX}px`,
                      width: `${captionPreviewScaledWidth}px`,
                      height: `${captionPreviewDisplayHeight}px`,
                      top: `-${captionPreviewCropOffsetY}px`,
                    }}
                  >
                    <div
                      className="absolute left-0 top-0"
                      style={{
                        width: `${CAPTION_PREVIEW_RENDER_WIDTH}px`,
                        height: `${CAPTION_PREVIEW_RENDER_HEIGHT}px`,
                        transform: `scale(${captionPreviewScale})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      <CaptionOverlay
                        containerWidth={CAPTION_PREVIEW_RENDER_WIDTH}
                        containerHeight={CAPTION_PREVIEW_RENDER_HEIGHT}
                        videoWidth={previewSourceWidth}
                        videoHeight={previewSourceHeight}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {selectedEditingSegment ? (
              <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-[var(--ink-subtle)]">
                    Start (s)
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingStart}
                      onChange={(event) => onEditingStartChange(event.target.value)}
                      className="mt-1 h-8 text-xs font-mono"
                    />
                  </label>
                  <label className="text-[11px] text-[var(--ink-subtle)]">
                    End (s)
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingEnd}
                      onChange={(event) => onEditingEndChange(event.target.value)}
                      className="mt-1 h-8 text-xs font-mono"
                    />
                  </label>
                </div>

                <Textarea
                  value={editingText}
                  onChange={(event) => onEditingTextChange(event.target.value)}
                  rows={4}
                  className="min-h-[96px] text-sm"
                />

                <WordTimingEditor
                  timelineSegmentStart={timelineSegmentStart}
                  timelineDuration={timelineDuration}
                  wordCompressionRange={wordCompressionRange}
                  beginLocalTimelineScrub={onBeginLocalTimelineScrub}
                  localTimelineRef={localTimelineRef}
                  applyWordCompressionRange={applyWordCompressionRange}
                  wordTimelineRef={wordTimelineRef}
                  editingWords={editingWords}
                  wordDragState={wordDragState}
                  startWordDrag={startWordDrag}
                  updateEditingWordTiming={updateEditingWordTiming}
                  syncWordsFromText={syncWordsFromText}
                  hasInvalidWordTiming={hasInvalidWordTiming}
                />

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--ink-subtle)] whitespace-nowrap">
                      Regen Model
                    </span>
                    <WhisperModelSelect
                      value={regenerateModelName}
                      models={whisperModels}
                      onChange={onRegenerateModelChange}
                      className="h-8 min-w-[140px] text-xs"
                    />
                    <RegenerateModelDownloadNote isDownloaded={isRegenerateModelDownloaded} />
                    <span className="text-[10px] uppercase tracking-wide text-[var(--ink-subtle)] whitespace-nowrap">
                      Language
                    </span>
                    <TranscriptionLanguageCombobox
                      value={selectedTranscriptionLanguage}
                      onChange={onSelectedTranscriptionLanguageChange}
                      className="min-w-[160px] text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={onCancelEditingSegment}
                      className="editor-choice-pill flex items-center gap-1 px-2 py-1.5 text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                      Clear Selection
                    </button>
                    <button
                      type="button"
                      onClick={onRegenerateEditingSegment}
                      disabled={isRegenerateDisabled}
                      className="editor-choice-pill flex items-center gap-1 px-2 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RegenerateSegmentButtonContent isRegenerating={isRegeneratingSegment} />
                    </button>
                    <button
                      type="button"
                      onClick={onRegenerateAllSegments}
                      disabled={isRegenerateAllDisabled}
                      className="editor-choice-pill flex items-center gap-1 px-2 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RegenerateAllButtonContent
                        isRegenerating={isRegeneratingAllSegments}
                        transcriptionProgress={transcriptionProgress}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={onUndoLastRegenerate}
                      disabled={!lastRegenSnapshot || isRegeneratingSegment || isRegeneratingAllSegments}
                      className="editor-choice-pill px-2 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Undo Regen
                    </button>
                    <button
                      type="button"
                      onClick={onSaveEditingSegment}
                      disabled={isSaveDisabled}
                      className="editor-choice-pill editor-choice-pill--active px-2 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Segment
                    </button>
                  </div>
                </div>
                <SegmentRegenerateError error={segmentRegenerateError} />
              </div>
            ) : (
              <div className="flex-1 rounded-md border border-dashed border-[var(--glass-border)] text-[var(--ink-subtle)] text-sm grid place-items-center">
                Select a segment from the left to edit timing and words.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CaptionPanel({ videoPath }: CaptionPanelProps) {
  const project = useVideoEditorStore(selectProject);
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const clearCaptions = useVideoEditorStore(selectClearCaptions);
  const timelineSegments = useVideoEditorStore(selectTimelineSegments);
  const isTranscribing = useVideoEditorStore(selectIsTranscribing);
  const transcriptionProgress = useVideoEditorStore(selectTranscriptionProgress);
  const transcriptionStage = useVideoEditorStore(selectTranscriptionStage);
  const transcriptionError = useVideoEditorStore(selectTranscriptionError);
  const whisperModels = useVideoEditorStore(selectWhisperModels);
  const selectedModelName = useVideoEditorStore(selectSelectedModelName);
  const selectedTranscriptionLanguage = useVideoEditorStore(
    selectSelectedTranscriptionLanguage
  );
  const isDownloadingModel = useVideoEditorStore(selectIsDownloadingModel);
  const downloadProgress = useVideoEditorStore(selectDownloadProgress);
  const loadWhisperModels = useVideoEditorStore(selectLoadWhisperModels);
  const setSelectedModel = useVideoEditorStore(selectSetSelectedModel);
  const setSelectedTranscriptionLanguage = useVideoEditorStore(
    selectSetSelectedTranscriptionLanguage
  );
  const downloadModel = useVideoEditorStore(selectDownloadModel);
  const startTranscription = useVideoEditorStore(selectStartTranscription);
  const transcribeCaptionSegment = useVideoEditorStore(selectTranscribeCaptionSegment);
  const updateCaptionSettings = useVideoEditorStore(selectUpdateCaptionSettings);
  const updateCaptionSegment = useVideoEditorStore(selectUpdateCaptionSegment);
  const setCaptionSegments = useVideoEditorStore(selectSetCaptionSegments);
  const setCaptionsEnabled = useVideoEditorStore(selectSetCaptionsEnabled);
  const setTranscriptionProgress = useVideoEditorStore(selectSetTranscriptionProgress);
  const requestSeek = useVideoEditorStore(selectRequestSeek);
  const setIsPlaying = useVideoEditorStore(selectSetIsPlaying);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);

  const [showAllSegments, setShowAllSegments] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingStart, setEditingStart] = useState('');
  const [editingEnd, setEditingEnd] = useState('');
  const [editingWords, setEditingWords] = useState<EditableCaptionWord[]>([]);
  const [didEditWordTiming, setDidEditWordTiming] = useState(false);
  const [wordDragState, setWordDragState] = useState<WordDragState | null>(null);
  const [wordCompressionRange, setWordCompressionRange] = useState<[number, number]>([0, 100]);
  const [compressionBaseWords, setCompressionBaseWords] = useState<Array<{ text: string; start: number; end: number }> | null>(null);
  const [originalSegmentsById, setOriginalSegmentsById] = useState<Record<string, CaptionSegment>>({});
  const [isRegeneratingSegment, setIsRegeneratingSegment] = useState(false);
  const [isRegeneratingAllSegments, setIsRegeneratingAllSegments] = useState(false);
  const [segmentRegenerateError, setSegmentRegenerateError] = useState<string | null>(null);
  const [regenerateModelName, setRegenerateModelName] = useState(selectedModelName);
  const [lastRegenSnapshot, setLastRegenSnapshot] = useState<CaptionSnapshot | null>(null);
  const [segmentAuditionState, setSegmentAuditionState] = useState<SegmentAuditionState | null>(null);
  const wordTimelineRef = useRef<HTMLDivElement | null>(null);
  const localTimelineRef = useRef<HTMLDivElement | null>(null);
  const playbackTimelineRef = useRef<HTMLDivElement | null>(null);
  const captionPreviewHostRef = useRef<HTMLDivElement | null>(null);
  const captionPreviewDisplayWidth = useObservedCaptionPreviewWidth(
    captionPreviewHostRef,
    isEditorOpen
  );

  useCaptionPanelModelEffects({
    loadWhisperModels,
    whisperModels,
    regenerateModelName,
    selectedModelName,
    setRegenerateModelName,
    setTranscriptionProgress,
  });

  const isModelDownloaded = getDownloadedModelState(whisperModels, selectedModelName);
  const isRegenerateModelDownloaded = getDownloadedModelState(whisperModels, regenerateModelName);
  const displayCaptionSegments = useMemo(
    () => remapCaptionSegmentsToTimeline(captionSegments, timelineSegments),
    [captionSegments, timelineSegments]
  );
  const displayCaptionSegmentsById = useMemo(
    () => new Map(displayCaptionSegments.map((segment) => [segment.id, segment])),
    [displayCaptionSegments]
  );
  const visibleSegments = getVisibleCaptionSegments(showAllSegments, displayCaptionSegments);
  const selectedEditingSegment = getSelectedEditingSegment(
    editingSegmentId,
    displayCaptionSegmentsById,
    captionSegments
  );
  const projectDurationSeconds = getProjectDurationSeconds(
    project,
    timelineSegments,
    displayCaptionSegments
  );
  const previewSourceSize = getCaptionPreviewSourceSize(project);
  const {
    scale: captionPreviewScale,
    scaledWidth: captionPreviewScaledWidth,
    displayHeight: captionPreviewDisplayHeight,
    cropDisplayHeight: captionPreviewCropDisplayHeight,
    offsetX: captionPreviewOffsetX,
    cropOffsetY: captionPreviewCropOffsetY,
  } = getCaptionPreviewLayout(captionPreviewDisplayWidth, captionSettings.position);

  const handleTranscribe = async () => {
    await transcribeWithDownloadedModel({
      videoPath,
      isModelDownloaded,
      selectedModelName,
      downloadModel,
      startTranscription,
    });
  };

  const handleClearCaptions = () => {
    clearCaptions();
    setCaptionsEnabled(false);
    setSegmentAuditionState(null);
    setOriginalSegmentsById({});
    setLastRegenSnapshot(null);
    setIsEditorOpen(false);
    cancelEditingSegment();
  };

  const startEditingSegment = (segment: CaptionSegment) => {
    const displaySegment = getCaptionEditDisplaySegment(displayCaptionSegmentsById, segment);

    setOriginalSegmentsById((previous) =>
      addOriginalCaptionSegmentSnapshot(previous, segment)
    );
    setEditingSegmentId(segment.id);
    setEditingText(displaySegment.text);
    setEditingStart(displaySegment.start.toFixed(2));
    setEditingEnd(displaySegment.end.toFixed(2));
    setEditingWords(buildEditableWordsForSegment(displaySegment));
    setDidEditWordTiming(false);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
    setIsEditorOpen(true);
  };

  const cancelEditingSegment = () => {
    setEditingSegmentId(null);
    setEditingText('');
    setEditingStart('');
    setEditingEnd('');
    setEditingWords([]);
    setDidEditWordTiming(false);
    setWordDragState(null);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
    setIsRegeneratingSegment(false);
    setIsRegeneratingAllSegments(false);
    setSegmentRegenerateError(null);
  };

  const resetSegmentToBaseline = (segmentId: string) => {
    const baseline = originalSegmentsById[segmentId];
    if (!baseline) return;

    const resetSegment = cloneCaptionSegment(baseline);
    updateCaptionSegment(segmentId, {
      start: resetSegment.start,
      end: resetSegment.end,
      text: resetSegment.text,
      words: resetSegment.words,
    });

    if (editingSegmentId === segmentId) {
      const resetDisplaySegment =
        remapCaptionSegmentsToTimeline([resetSegment], timelineSegments)[0] ?? resetSegment;
      setEditingText(resetDisplaySegment.text);
      setEditingStart(resetDisplaySegment.start.toFixed(2));
      setEditingEnd(resetDisplaySegment.end.toFixed(2));
      setEditingWords(buildEditableWordsForSegment(resetDisplaySegment));
      setDidEditWordTiming(false);
      setWordDragState(null);
      setWordCompressionRange([0, 100]);
      setCompressionBaseWords(null);
    }
  };

  const isSegmentDirty = (segment: CaptionSegment): boolean => {
    const baseline = originalSegmentsById[segment.id];
    if (!baseline) return false;
    return !segmentMatchesUpdate(segment, {
      start: baseline.start,
      end: baseline.end,
      text: baseline.text,
      words: baseline.words,
    });
  };

  const syncWordsFromText = () => {
    const editWindow = parseCaptionEditWindow(editingText, editingStart, editingEnd);
    if (!editWindow) return;

    setEditingWords(
      toEditableCaptionWords(
        distributeCaptionWordTiming(
          splitCaptionWords(editWindow.text),
          editWindow.start,
          editWindow.end
        )
      )
    );
    setDidEditWordTiming(false);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
  };

  const updateEditingWordTiming = (
    index: number,
    field: 'start' | 'end',
    value: string
  ) => {
    setDidEditWordTiming(true);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
    setEditingWords((previous) =>
      previous.map((word, wordIndex) =>
        wordIndex === index ? { ...word, [field]: value } : word
      )
    );
  };

  const startWordDrag = (
    event: {
      clientX: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    },
    index: number,
    mode: WordDragMode
  ) => {
    const nextWordDragState = createWordDragState({
      clientX: event.clientX,
      index,
      mode,
      editingStart,
      editingEnd,
      editingWords,
      timelineWidth: wordTimelineRef.current?.getBoundingClientRect().width ?? 1,
    });
    if (!nextWordDragState) return;

    event.preventDefault();
    event.stopPropagation();
    setDidEditWordTiming(true);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);

    setWordDragState(nextWordDragState);
  };

  const seekFromPlaybackTimeline = (clientX: number) => {
    const rect = playbackTimelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    requestSeek(ratio * projectDurationSeconds * 1000);
  };

  const seekFromLocalTimeline = (clientX: number) => {
    const rect = localTimelineRef.current?.getBoundingClientRect();
    if (!rect) return;

    const parsedStart = Number.parseFloat(editingStart);
    const parsedEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) return;

    const segmentStart = Math.max(0, parsedStart);
    const segmentEnd = Math.max(
      segmentStart + MIN_SEGMENT_DURATION_SECONDS,
      parsedEnd
    );
    const segmentDuration = Math.max(
      segmentEnd - segmentStart,
      MIN_SEGMENT_DURATION_SECONDS
    );
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    requestSeek((segmentStart + ratio * segmentDuration) * 1000);
  };

  const applyWordCompressionRange = (nextRange: number[]) => {
    const update = getWordCompressionUpdate({
      compressionBaseWords,
      editingWords,
      nextRange,
      wordCompressionRange,
      editingStart,
      editingEnd,
    });
    if (!update) return;

    if (!compressionBaseWords) {
      setCompressionBaseWords(update.baseWords);
    }

    setDidEditWordTiming(true);
    setEditingWords(update.compressedWords.words);
    setWordCompressionRange(update.compressedWords.range);
  };

  const beginPlaybackScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    seekFromPlaybackTimeline(event.clientX);

    const handleMove = (moveEvent: MouseEvent) => {
      seekFromPlaybackTimeline(moveEvent.clientX);
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  };

  const beginLocalTimelineScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    seekFromLocalTimeline(event.clientX);

    const handleMove = (moveEvent: MouseEvent) => {
      seekFromLocalTimeline(moveEvent.clientX);
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  };

  useEffect(() => {
    if (!editingSegmentId || didEditWordTiming) return;

    const editWindow = parseCaptionEditWindow(editingText, editingStart, editingEnd);
    if (!editWindow) return;

    setEditingWords(
      toEditableCaptionWords(
        distributeCaptionWordTiming(
          splitCaptionWords(editWindow.text),
          editWindow.start,
          editWindow.end
        )
      )
    );
  }, [didEditWordTiming, editingEnd, editingSegmentId, editingStart, editingText]);

  useEffect(() => {
    if (!isEditorOpen) return;

    setOriginalSegmentsById((previous) => {
      let didChange = false;
      const next = { ...previous };
      for (const segment of captionSegments) {
        if (!next[segment.id]) {
          next[segment.id] = cloneCaptionSegment(segment);
          didChange = true;
        }
      }
      return didChange ? next : previous;
    });
  }, [captionSegments, isEditorOpen]);

  useEffect(() => {
    if (!editingSegmentId) return;

    const nextUpdate = getLiveCaptionSegmentUpdate({
      editingSegmentId,
      captionSegments,
      editingText,
      editingStart,
      editingEnd,
      editingWords,
      didEditWordTiming,
    });
    if (nextUpdate) {
      updateCaptionSegment(editingSegmentId, nextUpdate);
    }
  }, [
    captionSegments,
    didEditWordTiming,
    editingEnd,
    editingSegmentId,
    editingStart,
    editingText,
    editingWords,
    updateCaptionSegment,
  ]);

  useEffect(() => {
    if (!wordDragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextTiming = getDraggedWordTiming(wordDragState, event.clientX);

      setEditingWords((previous) =>
        previous.map((word, index) =>
          index === wordDragState.index
            ? {
                ...word,
                start: nextTiming.start.toFixed(2),
                end: nextTiming.end.toFixed(2),
              }
            : word
        )
      );
    };

    const handleMouseUp = () => {
      setWordDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = wordDragState.mode === 'move' ? 'grabbing' : 'ew-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [wordDragState]);

  const {
    hasInvalidSegmentTiming,
    hasInvalidWordTiming,
    isSaveDisabled,
    timelineSegmentStart,
    timelineDuration,
  } = getCaptionEditorValidation({
    editingText,
    editingStart,
    editingEnd,
    editingWords,
    didEditWordTiming,
  });
  const {
    isRegenerateDisabled,
    isRegenerateAllDisabled,
  } = getRegenerateDisabledState({
    videoPath,
    editingSegmentId,
    captionSegments,
    hasInvalidSegmentTiming,
    isRegeneratingSegment,
    isRegeneratingAllSegments,
  });
  const saveEditingSegment = () => {
    if (!editingSegmentId) return;

    const editSegment = getCaptionSegmentForEdit(
      editingSegmentId,
      captionSegments,
      displayCaptionSegmentsById
    );
    if (!editSegment) {
      cancelEditingSegment();
      return;
    }

    const savedUpdate = getSavedCaptionSegmentUpdate({
      segmentId: editingSegmentId,
      currentSegment: editSegment.currentSegment,
      editingText,
      editingStart,
      editingEnd,
      editingWords,
      didEditWordTiming,
      displayCaptionSegmentsById,
      timelineSegments,
    });
    if (!savedUpdate) return;

    updateCaptionSegment(editingSegmentId, {
      start: savedUpdate.sourceSegmentUpdate.start,
      end: savedUpdate.sourceSegmentUpdate.end,
      text: savedUpdate.sourceSegmentUpdate.text,
      words: savedUpdate.sourceSegmentUpdate.words,
    });

    setEditingStart(savedUpdate.editWindow.start.toFixed(2));
    setEditingEnd(savedUpdate.editWindow.end.toFixed(2));
    setEditingText(savedUpdate.editWindow.text);
    setEditingWords(toEditableCaptionWords(savedUpdate.savedWords));
    setDidEditWordTiming(false);
  };

  const applyRegeneratedSegment = (segmentId: string, segment: CaptionSegment) => {
    const regeneratedWords =
      segment.words.length > 0
        ? segment.words
        : distributeCaptionWordTiming(
            splitCaptionWords(segment.text),
            segment.start,
            segment.end
          );

    updateCaptionSegment(segmentId, {
      start: segment.start,
      end: segment.end,
      text: segment.text,
      words: regeneratedWords,
    });

    if (editingSegmentId === segmentId) {
      const displaySegment =
        remapCaptionSegmentsToTimeline([{
          ...segment,
          words: regeneratedWords,
        }], timelineSegments)[0] ?? {
          ...segment,
          words: regeneratedWords,
        };
      setEditingStart(displaySegment.start.toFixed(2));
      setEditingEnd(displaySegment.end.toFixed(2));
      setEditingText(displaySegment.text);
      setEditingWords(toEditableCaptionWords(displaySegment.words));
      setDidEditWordTiming(true);
      setWordDragState(null);
      setWordCompressionRange([0, 100]);
      setCompressionBaseWords(null);
    }
  };

  const prepareRegenerateAllModel = async () => {
    if (selectedModelName !== regenerateModelName) {
      setSelectedModel(regenerateModelName);
    }

    if (!isRegenerateModelDownloaded) {
      await downloadModel(regenerateModelName);
    }
  };

  const updateEditorAfterRegenerateAll = () => {
    setOriginalSegmentsById({});
    const freshSegments = useVideoEditorStore.getState().captionSegments;
    const firstSegment = freshSegments[0];
    if (firstSegment) {
      startEditingSegment(firstSegment);
      return;
    }
    cancelEditingSegment();
  };

  const createCaptionSnapshot = (): CaptionSnapshot => ({
    segments: cloneCaptionSegments(captionSegments),
    settings: { ...captionSettings },
  });

  const restoreEditingSnapshotSegment = (snapshot: CaptionSnapshot) => {
    const restoredDisplaySegment = getRestoredEditingDisplaySegment(
      snapshot,
      editingSegmentId,
      timelineSegments
    );
    if (!restoredDisplaySegment) return;

    setEditingText(restoredDisplaySegment.text);
    setEditingStart(restoredDisplaySegment.start.toFixed(2));
    setEditingEnd(restoredDisplaySegment.end.toFixed(2));
    setEditingWords(buildEditableWordsForSegment(restoredDisplaySegment));
    setDidEditWordTiming(false);
    setWordDragState(null);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
  };

  const getRestoredEditingDisplaySegment = (
    snapshot: CaptionSnapshot,
    segmentId: string | null,
    trimSegments: TrimSegment[] | undefined
  ) => {
    const restored = getRestoredEditingSegment(snapshot, segmentId);
    return restored ? getDisplayCaptionSegment(restored, trimSegments) : null;
  };

  const getRestoredEditingSegment = (
    snapshot: CaptionSnapshot,
    segmentId: string | null
  ) => {
    return segmentId
      ? snapshot.segments.find((segment) => segment.id === segmentId) ?? null
      : null;
  };

  const getDisplayCaptionSegment = (
    segment: CaptionSegment,
    trimSegments: TrimSegment[] | undefined
  ) => remapCaptionSegmentsToTimeline([segment], trimSegments)[0] ?? segment;

  const restoreCaptionSnapshot = (snapshot: CaptionSnapshot) => {
    setCaptionSegments(cloneCaptionSegments(snapshot.segments));
    updateCaptionSettings({ ...snapshot.settings });
    setOriginalSegmentsById({});
    restoreEditingSnapshotSegment(snapshot);
  };

  const undoLastRegenerate = () => {
    if (!lastRegenSnapshot) return;
    restoreCaptionSnapshot(lastRegenSnapshot);
    setLastRegenSnapshot(null);
    setSegmentRegenerateError(null);
  };

  const regenerateEditingSegment = async () => {
    const request = getRegenerateEditingSegmentRequest({
      editingSegmentId,
      videoPath,
      editingText,
      editingStart,
      editingEnd,
      displayCaptionSegmentsById,
      timelineSegments,
    });
    if (!request) return;

    const snapshot = createCaptionSnapshot();
    setIsRegeneratingSegment(true);
    setSegmentRegenerateError(null);
    try {
      const regenerated = await transcribeCaptionSegment(
        request.videoPath,
        request.sourceWindow.start,
        request.sourceWindow.end,
        selectedTranscriptionLanguage,
        regenerateModelName
      );
      applyRegeneratedSegment(request.editingSegmentId, regenerated);
      setLastRegenSnapshot(snapshot);
    } catch (error) {
      videoEditorLogger.error('Failed to regenerate caption segment:', error);
      setSegmentRegenerateError(getCaptionErrorMessage(error));
    } finally {
      setIsRegeneratingSegment(false);
    }
  };

  const getRegenerateAllTarget = () =>
    videoPath && captionSegments.length > 0 ? videoPath : null;

  const restorePreviousModelAfterRegenerateAll = (previousModelName: string) => {
    if (previousModelName !== regenerateModelName) {
      setSelectedModel(previousModelName);
    }
  };

  const regenerateAllSegments = async () => {
    const targetVideoPath = getRegenerateAllTarget();
    if (!targetVideoPath) return;

    const snapshot = createCaptionSnapshot();
    setIsRegeneratingAllSegments(true);
    setSegmentRegenerateError(null);

    const previousModelName = selectedModelName;

    try {
      await prepareRegenerateAllModel();
      await startTranscription(targetVideoPath);
      setLastRegenSnapshot(snapshot);
      updateEditorAfterRegenerateAll();
    } catch (error) {
      videoEditorLogger.error('Failed to regenerate all captions:', error);
      setSegmentRegenerateError(getCaptionErrorMessage(error));
    } finally {
      restorePreviousModelAfterRegenerateAll(previousModelName);
      setIsRegeneratingAllSegments(false);
    }
  };

  const openEditor = () => {
    const initialSegment = getInitialEditorSegment(
      editingSegmentId,
      displayCaptionSegments,
      captionSegments
    );
    if (initialSegment) {
      startEditingSegment(initialSegment);
      return;
    }

    setIsEditorOpen(true);
  };

  const handleEditorOpenChange = (open: boolean) => {
    setIsEditorOpen(open);
    if (!open) {
      setSegmentAuditionState(null);
      setOriginalSegmentsById({});
      setLastRegenSnapshot(null);
      cancelEditingSegment();
    }
  };

  const auditionSegment = (segmentId: string) => {
    const auditionTiming = getSegmentAuditionTiming(
      segmentId,
      captionSegments,
      displayCaptionSegmentsById
    );
    if (!auditionTiming) return;

    startEditingSegment(auditionTiming.rawSegment);
    requestSeek(auditionTiming.state.startMs);
    setSegmentAuditionState(auditionTiming.state);
    setIsPlaying(true);
  };

  const handleTransportToggle = () => {
    setSegmentAuditionState(null);
    togglePlayback();
  };

  const handleEditingStartChange = (value: string) => {
    setEditingStart(value);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
  };

  const handleEditingEndChange = (value: string) => {
    setEditingEnd(value);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);
  };

  return (
    <div className="space-y-4">
      <CaptionAuditionWatcher
        segmentAuditionState={segmentAuditionState}
        requestSeek={requestSeek}
        setIsPlaying={setIsPlaying}
        clearSegmentAuditionState={() => setSegmentAuditionState(null)}
      />

      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Show Captions</span>
        <button
          onClick={() => setCaptionsEnabled(!captionSettings.enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            captionSettings.enabled
              ? 'bg-[var(--accent-400)]'
              : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              captionSettings.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <TranscriptionControls
        videoPath={videoPath}
        selectedModelName={selectedModelName}
        whisperModels={whisperModels}
        isModelDownloaded={isModelDownloaded}
        selectedTranscriptionLanguage={selectedTranscriptionLanguage}
        isDownloadingModel={isDownloadingModel}
        downloadProgress={downloadProgress}
        isTranscribing={isTranscribing}
        transcriptionStage={transcriptionStage}
        transcriptionProgress={transcriptionProgress}
        transcriptionError={transcriptionError}
        hasCaptionSegments={captionSegments.length > 0}
        onSelectModel={setSelectedModel}
        onSelectLanguage={setSelectedTranscriptionLanguage}
        onTranscribe={handleTranscribe}
        onClearCaptions={handleClearCaptions}
      />

      <CaptionSegmentsList
        segments={displayCaptionSegments}
        visibleSegments={visibleSegments}
        showAllSegments={showAllSegments}
        onToggleShowAllSegments={() => setShowAllSegments((prev) => !prev)}
        onOpenEditor={openEditor}
      />

      {captionSegments.length > 0 && (
        <CaptionStyleSettings
          settings={captionSettings}
          onUpdateSettings={updateCaptionSettings}
        />
      )}

      <CaptionEditorDialog
        isEditorOpen={isEditorOpen}
        onOpenChange={handleEditorOpenChange}
        displayCaptionSegments={displayCaptionSegments}
        captionSegments={captionSegments}
        editingSegmentId={editingSegmentId}
        isSegmentDirty={isSegmentDirty}
        onAuditionSegment={auditionSegment}
        onResetSegment={resetSegmentToBaseline}
        projectDurationSeconds={projectDurationSeconds}
        onTogglePlayback={handleTransportToggle}
        onBeginPlaybackScrub={beginPlaybackScrub}
        playbackTimelineRef={playbackTimelineRef}
        captionPreviewHostRef={captionPreviewHostRef}
        captionPreviewDisplayWidth={captionPreviewDisplayWidth}
        captionPreviewCropDisplayHeight={captionPreviewCropDisplayHeight}
        captionPreviewOffsetX={captionPreviewOffsetX}
        captionPreviewScaledWidth={captionPreviewScaledWidth}
        captionPreviewDisplayHeight={captionPreviewDisplayHeight}
        captionPreviewCropOffsetY={captionPreviewCropOffsetY}
        captionPreviewScale={captionPreviewScale}
        previewSourceWidth={previewSourceSize.width}
        previewSourceHeight={previewSourceSize.height}
        selectedEditingSegment={selectedEditingSegment}
        editingStart={editingStart}
        editingEnd={editingEnd}
        editingText={editingText}
        onEditingStartChange={handleEditingStartChange}
        onEditingEndChange={handleEditingEndChange}
        onEditingTextChange={setEditingText}
        timelineSegmentStart={timelineSegmentStart}
        timelineDuration={timelineDuration}
        wordCompressionRange={wordCompressionRange}
        onBeginLocalTimelineScrub={beginLocalTimelineScrub}
        localTimelineRef={localTimelineRef}
        applyWordCompressionRange={applyWordCompressionRange}
        wordTimelineRef={wordTimelineRef}
        editingWords={editingWords}
        wordDragState={wordDragState}
        startWordDrag={startWordDrag}
        updateEditingWordTiming={updateEditingWordTiming}
        syncWordsFromText={syncWordsFromText}
        hasInvalidWordTiming={hasInvalidWordTiming}
        regenerateModelName={regenerateModelName}
        whisperModels={whisperModels}
        onRegenerateModelChange={setRegenerateModelName}
        isRegenerateModelDownloaded={isRegenerateModelDownloaded}
        selectedTranscriptionLanguage={selectedTranscriptionLanguage}
        onSelectedTranscriptionLanguageChange={setSelectedTranscriptionLanguage}
        onCancelEditingSegment={cancelEditingSegment}
        onRegenerateEditingSegment={regenerateEditingSegment}
        isRegenerateDisabled={isRegenerateDisabled}
        isRegeneratingSegment={isRegeneratingSegment}
        onRegenerateAllSegments={regenerateAllSegments}
        isRegenerateAllDisabled={isRegenerateAllDisabled}
        isRegeneratingAllSegments={isRegeneratingAllSegments}
        transcriptionProgress={transcriptionProgress}
        onUndoLastRegenerate={undoLastRegenerate}
        lastRegenSnapshot={lastRegenSnapshot}
        onSaveEditingSegment={saveEditingSegment}
        isSaveDisabled={isSaveDisabled}
        segmentRegenerateError={segmentRegenerateError}
      />
    </div>
  );
}
