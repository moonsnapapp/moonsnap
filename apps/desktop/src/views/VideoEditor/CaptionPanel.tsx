/**
 * CaptionPanel - Panel for caption transcription and editing.
 * Provides transcription controls, segment list, and settings.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Download,
  Loader2,
  AlertCircle,
  Check,
  X,
  Play,
  Pause,
  RotateCcw,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Slider } from '../../components/ui/slider';
import { Textarea } from '../../components/ui/textarea';
import { CaptionOverlay } from '../../components/VideoEditor/CaptionOverlay';
import type {
  CaptionSegment,
  CaptionSettings,
  CaptionWord,
  TranscriptionProgress,
  DownloadProgress,
} from '../../types';
import { videoEditorLogger } from '../../utils/logger';

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
const MIN_SEGMENT_DURATION_SECONDS = 0.05;
const MIN_WORD_DURATION_SECONDS = 0.01;

interface EditableCaptionWord {
  text: string;
  start: string;
  end: string;
}

type WordDragMode = 'start' | 'end' | 'move';

interface WordDragState {
  index: number;
  mode: WordDragMode;
  startX: number;
  timelineWidth: number;
  initialStart: number;
  initialEnd: number;
  minStart: number;
  maxEnd: number;
  segmentStart: number;
  segmentEnd: number;
}

interface SegmentAuditionState {
  segmentId: string;
  startMs: number;
  endMs: number;
}

function clamp(value: number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.max(min, Math.min(max, value));
}

function parseEditableWords(words: EditableCaptionWord[]) {
  return words.map((word) => ({
    text: word.text,
    start: Number.parseFloat(word.start),
    end: Number.parseFloat(word.end),
  }));
}

function splitCaptionWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
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
    const relStart = Math.max(0, Math.min(1, (word.start - oldStart) / oldDuration));
    const relEnd = Math.max(0, Math.min(1, (word.end - oldStart) / oldDuration));

    return {
      ...word,
      start: newStart + relStart * newDuration,
      end: newStart + relEnd * newDuration,
    };
  });
}

function distributeCaptionWordTiming(
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

function buildUpdatedWords(
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

function toEditableCaptionWords(words: CaptionWord[]): EditableCaptionWord[] {
  return words.map((word) => ({
    text: word.text,
    start: word.start.toFixed(2),
    end: word.end.toFixed(2),
  }));
}

function buildEditableWordsForSegment(segment: CaptionSegment): EditableCaptionWord[] {
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

function buildWordsFromEditor(
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

function cloneCaptionSegment(segment: CaptionSegment): CaptionSegment {
  return {
    ...segment,
    words: segment.words.map((word) => ({ ...word })),
  };
}

function cloneCaptionSegments(segments: CaptionSegment[]): CaptionSegment[] {
  return segments.map((segment) => cloneCaptionSegment(segment));
}

interface CaptionSnapshot {
  segments: CaptionSegment[];
  settings: CaptionSettings;
}

function numbersApproxEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0005;
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

function segmentMatchesUpdate(
  segment: CaptionSegment,
  update: { start: number; end: number; text: string; words: CaptionWord[] }
): boolean {
  return (
    segment.text === update.text &&
    numbersApproxEqual(segment.start, update.start) &&
    numbersApproxEqual(segment.end, update.end) &&
    wordsEqual(segment.words, update.words)
  );
}

export function CaptionPanel({ videoPath }: CaptionPanelProps) {
  const {
    project,
    captionSegments,
    captionSettings,
    isTranscribing,
    transcriptionProgress,
    transcriptionStage,
    transcriptionError,
    whisperModels,
    selectedModelName,
    isDownloadingModel,
    downloadProgress,
    loadWhisperModels,
    setSelectedModel,
    downloadModel,
    startTranscription,
    transcribeCaptionSegment,
    updateCaptionSettings,
    updateCaptionSegment,
    setCaptionSegments,
    setCaptionsEnabled,
    setTranscriptionProgress,
    currentTimeMs,
    isPlaying,
    requestSeek,
    setIsPlaying,
    togglePlayback,
  } = useVideoEditorStore();

  const [showModelSelector, setShowModelSelector] = useState(false);
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
  const [captionPreviewDisplayWidth, setCaptionPreviewDisplayWidth] = useState(720);

  // Load models on mount
  useEffect(() => {
    loadWhisperModels();
  }, [loadWhisperModels]);

  useEffect(() => {
    if (!whisperModels.some((model) => model.name === regenerateModelName)) {
      setRegenerateModelName(selectedModelName);
    }
  }, [regenerateModelName, selectedModelName, whisperModels]);

  // Listen for progress events
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
        // Download progress is handled via store state
        void event.payload;
      }
    );

    return () => {
      unlistenTranscription.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
    };
  }, [setTranscriptionProgress]);

  const selectedModel = whisperModels.find((m) => m.name === selectedModelName);
  const isModelDownloaded = selectedModel?.downloaded ?? false;
  const regenerateModel = whisperModels.find((m) => m.name === regenerateModelName);
  const isRegenerateModelDownloaded = regenerateModel?.downloaded ?? false;
  const visibleSegments = showAllSegments
    ? captionSegments
    : captionSegments.slice(0, DEFAULT_VISIBLE_SEGMENTS);
  const selectedEditingSegment = editingSegmentId
    ? captionSegments.find((segment) => segment.id === editingSegmentId) ?? null
    : null;
  const projectDurationSeconds = Math.max(
    (project?.timeline.durationMs ?? 0) / 1000,
    captionSegments.reduce((max, segment) => Math.max(max, segment.end), 0),
    1
  );
  const previewSourceWidth = project?.sources.originalWidth ?? 1920;
  const previewSourceHeight = project?.sources.originalHeight ?? 1080;
  const CAPTION_PREVIEW_RENDER_WIDTH = 1920;
  const CAPTION_PREVIEW_RENDER_HEIGHT = 1080;
  const CAPTION_PREVIEW_CROP_HEIGHT = 260;
  const CAPTION_PREVIEW_ZOOM = 1.7;
  const CAPTION_PREVIEW_MAX_CROP_DISPLAY_HEIGHT = 220;
  const captionPreviewScale =
    (captionPreviewDisplayWidth / CAPTION_PREVIEW_RENDER_WIDTH) *
    CAPTION_PREVIEW_ZOOM;
  const captionPreviewScaledWidth = Math.round(
    CAPTION_PREVIEW_RENDER_WIDTH * captionPreviewScale
  );
  const captionPreviewDisplayHeight = Math.round(
    CAPTION_PREVIEW_RENDER_HEIGHT * captionPreviewScale
  );
  const captionPreviewCropDisplayHeight = clamp(
    Math.round(CAPTION_PREVIEW_CROP_HEIGHT * captionPreviewScale),
    72,
    CAPTION_PREVIEW_MAX_CROP_DISPLAY_HEIGHT
  );
  const captionPreviewOffsetX = Math.max(
    0,
    Math.round((captionPreviewScaledWidth - captionPreviewDisplayWidth) / 2)
  );
  const captionPreviewCropOffsetY =
    captionSettings.position === 'top'
      ? 0
      : Math.max(
          0,
          captionPreviewDisplayHeight - captionPreviewCropDisplayHeight
        );

  const handleTranscribe = async () => {
    if (!videoPath) return;

    if (!isModelDownloaded) {
      // Download first
      try {
        await downloadModel(selectedModelName);
      } catch (error) {
        videoEditorLogger.error('Failed to download model:', error);
        return;
      }
    }

    try {
      await startTranscription(videoPath);
    } catch (error) {
      videoEditorLogger.error('Transcription failed:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startEditingSegment = (segment: CaptionSegment) => {
    setOriginalSegmentsById((previous) =>
      previous[segment.id]
        ? previous
        : { ...previous, [segment.id]: cloneCaptionSegment(segment) }
    );
    setEditingSegmentId(segment.id);
    setEditingText(segment.text);
    setEditingStart(segment.start.toFixed(2));
    setEditingEnd(segment.end.toFixed(2));
    setEditingWords(buildEditableWordsForSegment(segment));
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
      setEditingText(resetSegment.text);
      setEditingStart(resetSegment.start.toFixed(2));
      setEditingEnd(resetSegment.end.toFixed(2));
      setEditingWords(buildEditableWordsForSegment(resetSegment));
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
    const parsedStart = Number.parseFloat(editingStart);
    const parsedEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) return;

    const nextStart = Math.max(0, parsedStart);
    const nextEnd = Math.max(nextStart + MIN_SEGMENT_DURATION_SECONDS, parsedEnd);
    setEditingWords(
      toEditableCaptionWords(
        distributeCaptionWordTiming(splitCaptionWords(editingText), nextStart, nextEnd)
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
    const parsedSegmentStart = Number.parseFloat(editingStart);
    const parsedSegmentEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedSegmentStart) || !Number.isFinite(parsedSegmentEnd)) {
      return;
    }

    const segmentStart = Math.max(0, parsedSegmentStart);
    const segmentEnd = Math.max(
      segmentStart + MIN_SEGMENT_DURATION_SECONDS,
      parsedSegmentEnd
    );
    const currentWord = editingWords[index];
    if (!currentWord) return;

    const wordStart = Number.parseFloat(currentWord.start);
    const wordEnd = Number.parseFloat(currentWord.end);
    if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) return;

    const previousEnd = index > 0
      ? Number.parseFloat(editingWords[index - 1]?.end ?? '')
      : segmentStart;
    const nextWordStart = index < editingWords.length - 1
      ? Number.parseFloat(editingWords[index + 1]?.start ?? '')
      : segmentEnd;

    if (!Number.isFinite(previousEnd) || !Number.isFinite(nextWordStart)) return;

    const minStart = Math.max(segmentStart, previousEnd);
    const maxEnd = Math.min(segmentEnd, nextWordStart);

    if (maxEnd - minStart < MIN_WORD_DURATION_SECONDS) return;

    event.preventDefault();
    event.stopPropagation();
    setDidEditWordTiming(true);
    setWordCompressionRange([0, 100]);
    setCompressionBaseWords(null);

    setWordDragState({
      index,
      mode,
      startX: event.clientX,
      timelineWidth: wordTimelineRef.current?.getBoundingClientRect().width ?? 1,
      initialStart: wordStart,
      initialEnd: wordEnd,
      minStart,
      maxEnd,
      segmentStart,
      segmentEnd,
    });
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
    const parsedSegmentStart = Number.parseFloat(editingStart);
    const parsedSegmentEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedSegmentStart) || !Number.isFinite(parsedSegmentEnd)) {
      return;
    }

    const segmentStart = Math.max(0, parsedSegmentStart);
    const segmentEnd = Math.max(
      segmentStart + MIN_SEGMENT_DURATION_SECONDS,
      parsedSegmentEnd
    );
    const baseWords =
      compressionBaseWords ?? parseEditableWords(editingWords);

    if (
      baseWords.length !== editingWords.length ||
      baseWords.length === 0 ||
      baseWords.some((word) => !Number.isFinite(word.start) || !Number.isFinite(word.end))
    ) {
      return;
    }

    if (!compressionBaseWords) {
      setCompressionBaseWords(baseWords);
    }

    const segmentDuration = Math.max(
      segmentEnd - segmentStart,
      MIN_SEGMENT_DURATION_SECONDS
    );
    const minBaseDuration = Math.min(...baseWords.map((word) => word.end - word.start));
    const minScaleFromDuration = minBaseDuration > 0
      ? MIN_WORD_DURATION_SECONDS / minBaseDuration
      : 1;
    const minRangeSpanPercent = clamp(Math.max(minScaleFromDuration * 100, 1), 1, 100);

    const rawStart = clamp(
      Math.min(nextRange[0] ?? 0, nextRange[1] ?? 100),
      0,
      100
    );
    const rawEnd = clamp(
      Math.max(nextRange[0] ?? 0, nextRange[1] ?? 100),
      0,
      100
    );

    let clampedStart = rawStart;
    let clampedEnd = rawEnd;
    if (clampedEnd - clampedStart < minRangeSpanPercent) {
      const startDelta = Math.abs(clampedStart - wordCompressionRange[0]);
      const endDelta = Math.abs(clampedEnd - wordCompressionRange[1]);
      if (startDelta >= endDelta) {
        clampedStart = clamp(clampedEnd - minRangeSpanPercent, 0, clampedEnd);
      } else {
        clampedEnd = clamp(
          clampedStart + minRangeSpanPercent,
          clampedStart,
          100
        );
      }
    }

    const targetStart = segmentStart + (clampedStart / 100) * segmentDuration;
    const targetEnd = segmentStart + (clampedEnd / 100) * segmentDuration;
    const targetDuration = Math.max(
      targetEnd - targetStart,
      MIN_WORD_DURATION_SECONDS
    );

    setDidEditWordTiming(true);
    setEditingWords(() =>
      baseWords.map((word) => ({
        text: word.text,
        start: (
          targetStart +
          clamp((word.start - segmentStart) / segmentDuration, 0, 1) * targetDuration
        ).toFixed(2),
        end: (
          targetStart +
          clamp((word.end - segmentStart) / segmentDuration, 0, 1) * targetDuration
        ).toFixed(2),
      }))
    );
    setWordCompressionRange([clampedStart, clampedEnd]);
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

    const parsedStart = Number.parseFloat(editingStart);
    const parsedEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) return;

    const nextStart = Math.max(0, parsedStart);
    const nextEnd = Math.max(nextStart + MIN_SEGMENT_DURATION_SECONDS, parsedEnd);

    setEditingWords(
      toEditableCaptionWords(
        distributeCaptionWordTiming(splitCaptionWords(editingText), nextStart, nextEnd)
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

    const currentSegment =
      captionSegments.find((segment) => segment.id === editingSegmentId) ?? null;
    if (!currentSegment) return;

    const nextText = editingText.trim();
    if (nextText.length === 0) return;

    const parsedStart = Number.parseFloat(editingStart);
    const parsedEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) return;
    if (parsedStart < 0 || parsedEnd <= parsedStart) return;

    const nextStart = Math.max(0, parsedStart);
    const nextEnd = Math.max(nextStart + MIN_SEGMENT_DURATION_SECONDS, parsedEnd);
    const manualWords = didEditWordTiming
      ? buildWordsFromEditor(editingWords, nextText, nextStart, nextEnd)
      : null;
    if (didEditWordTiming && manualWords === null) return;

    const nextWords =
      manualWords ?? buildUpdatedWords(currentSegment, nextText, nextStart, nextEnd);
    const nextUpdate = {
      start: nextStart,
      end: nextEnd,
      text: nextText,
      words: nextWords,
    };

    if (segmentMatchesUpdate(currentSegment, nextUpdate)) return;
    updateCaptionSegment(editingSegmentId, nextUpdate);
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
      const deltaPx = event.clientX - wordDragState.startX;
      const segmentDuration = Math.max(
        wordDragState.segmentEnd - wordDragState.segmentStart,
        MIN_SEGMENT_DURATION_SECONDS
      );
      const deltaSeconds = (deltaPx / Math.max(wordDragState.timelineWidth, 1)) * segmentDuration;

      let nextStart = wordDragState.initialStart;
      let nextEnd = wordDragState.initialEnd;

      if (wordDragState.mode === 'start') {
        nextStart = clamp(
          wordDragState.initialStart + deltaSeconds,
          wordDragState.minStart,
          wordDragState.initialEnd - MIN_WORD_DURATION_SECONDS
        );
      } else if (wordDragState.mode === 'end') {
        nextEnd = clamp(
          wordDragState.initialEnd + deltaSeconds,
          wordDragState.initialStart + MIN_WORD_DURATION_SECONDS,
          wordDragState.maxEnd
        );
      } else {
        const duration = Math.max(
          wordDragState.initialEnd - wordDragState.initialStart,
          MIN_WORD_DURATION_SECONDS
        );
        const maxStart = wordDragState.maxEnd - duration;
        nextStart = clamp(
          wordDragState.initialStart + deltaSeconds,
          wordDragState.minStart,
          maxStart
        );
        nextEnd = nextStart + duration;
      }

      setEditingWords((previous) =>
        previous.map((word, index) =>
          index === wordDragState.index
            ? {
                ...word,
                start: nextStart.toFixed(2),
                end: nextEnd.toFixed(2),
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

  useEffect(() => {
    if (!segmentAuditionState || !isPlaying) return;
    if (currentTimeMs < segmentAuditionState.endMs) return;

    requestSeek(segmentAuditionState.endMs);
    setIsPlaying(false);
    setSegmentAuditionState(null);
  }, [currentTimeMs, isPlaying, requestSeek, segmentAuditionState, setIsPlaying]);

  useEffect(() => {
    const host = captionPreviewHostRef.current;
    if (!host) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(host.clientWidth);
      if (nextWidth > 0) {
        setCaptionPreviewDisplayWidth(nextWidth);
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(host);

    return () => observer.disconnect();
  }, [isEditorOpen]);

  const parsedEditingStart = Number.parseFloat(editingStart);
  const parsedEditingEnd = Number.parseFloat(editingEnd);
  const hasInvalidSegmentTiming =
    !Number.isFinite(parsedEditingStart) ||
    !Number.isFinite(parsedEditingEnd) ||
    parsedEditingStart < 0 ||
    parsedEditingEnd <= parsedEditingStart;

  const hasInvalidWordTiming =
    didEditWordTiming &&
    !hasInvalidSegmentTiming &&
    buildWordsFromEditor(
      editingWords,
      editingText,
      Math.max(0, parsedEditingStart),
      Math.max(
        Math.max(0, parsedEditingStart) + MIN_SEGMENT_DURATION_SECONDS,
        parsedEditingEnd
      )
    ) === null;

  const isSaveDisabled =
    editingText.trim().length === 0 ||
    hasInvalidSegmentTiming ||
    hasInvalidWordTiming;
  const isRegenerateDisabled =
    !videoPath ||
    !editingSegmentId ||
    hasInvalidSegmentTiming ||
    isRegeneratingSegment ||
    isRegeneratingAllSegments;
  const isRegenerateAllDisabled =
    !videoPath ||
    captionSegments.length === 0 ||
    isRegeneratingSegment ||
    isRegeneratingAllSegments;
  const timelineSegmentStart = hasInvalidSegmentTiming
    ? 0
    : Math.max(0, parsedEditingStart);
  const timelineSegmentEnd = hasInvalidSegmentTiming
    ? 1
    : Math.max(
        Math.max(0, parsedEditingStart) + MIN_SEGMENT_DURATION_SECONDS,
        parsedEditingEnd
      );
  const timelineDuration = Math.max(
    timelineSegmentEnd - timelineSegmentStart,
    MIN_SEGMENT_DURATION_SECONDS
  );
  const segmentCurrentTimeSeconds = currentTimeMs / 1000;
  const localPlayheadSeconds = clamp(
    segmentCurrentTimeSeconds - timelineSegmentStart,
    0,
    timelineDuration
  );
  const localPlayheadPercent = clamp(
    (localPlayheadSeconds / timelineDuration) * 100,
    0,
    100
  );
  const saveEditingSegment = () => {
    if (!editingSegmentId) return;

    const currentSegment = captionSegments.find((s) => s.id === editingSegmentId);
    if (!currentSegment) {
      cancelEditingSegment();
      return;
    }

    const nextText = editingText.trim();
    if (nextText.length === 0) return;
    const parsedStart = Number.parseFloat(editingStart);
    const parsedEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) return;

    const nextStart = Math.max(0, parsedStart);
    const nextEnd = Math.max(
      nextStart + MIN_SEGMENT_DURATION_SECONDS,
      parsedEnd
    );
    const manualWords = didEditWordTiming
      ? buildWordsFromEditor(editingWords, nextText, nextStart, nextEnd)
      : null;
    if (didEditWordTiming && manualWords === null) return;

    updateCaptionSegment(editingSegmentId, {
      start: nextStart,
      end: nextEnd,
      text: nextText,
      words:
        manualWords ??
        buildUpdatedWords(currentSegment, nextText, nextStart, nextEnd),
    });

    const savedWords =
      manualWords ??
      buildUpdatedWords(currentSegment, nextText, nextStart, nextEnd);
    setEditingStart(nextStart.toFixed(2));
    setEditingEnd(nextEnd.toFixed(2));
    setEditingText(nextText);
    setEditingWords(toEditableCaptionWords(savedWords));
    setDidEditWordTiming(false);
  };

  const applyRegeneratedSegment = (
    segmentId: string,
    segmentStart: number,
    segmentEnd: number,
    text: string,
    words: CaptionWord[]
  ) => {
    const regeneratedWords =
      words.length > 0
        ? words
        : distributeCaptionWordTiming(
            splitCaptionWords(text),
            segmentStart,
            segmentEnd
          );

    updateCaptionSegment(segmentId, {
      start: segmentStart,
      end: segmentEnd,
      text,
      words: regeneratedWords,
    });

    if (editingSegmentId === segmentId) {
      setEditingStart(segmentStart.toFixed(2));
      setEditingEnd(segmentEnd.toFixed(2));
      setEditingText(text);
      setEditingWords(toEditableCaptionWords(regeneratedWords));
      setDidEditWordTiming(true);
      setWordDragState(null);
      setWordCompressionRange([0, 100]);
      setCompressionBaseWords(null);
    }
  };

  const createCaptionSnapshot = (): CaptionSnapshot => ({
    segments: cloneCaptionSegments(captionSegments),
    settings: { ...captionSettings },
  });

  const restoreCaptionSnapshot = (snapshot: CaptionSnapshot) => {
    setCaptionSegments(cloneCaptionSegments(snapshot.segments));
    updateCaptionSettings({ ...snapshot.settings });
    setOriginalSegmentsById({});

    if (editingSegmentId) {
      const restored =
        snapshot.segments.find((segment) => segment.id === editingSegmentId) ?? null;
      if (restored) {
        setEditingText(restored.text);
        setEditingStart(restored.start.toFixed(2));
        setEditingEnd(restored.end.toFixed(2));
        setEditingWords(buildEditableWordsForSegment(restored));
        setDidEditWordTiming(false);
        setWordDragState(null);
        setWordCompressionRange([0, 100]);
        setCompressionBaseWords(null);
      }
    }
  };

  const undoLastRegenerate = () => {
    if (!lastRegenSnapshot) return;
    restoreCaptionSnapshot(lastRegenSnapshot);
    setLastRegenSnapshot(null);
    setSegmentRegenerateError(null);
  };

  const regenerateEditingSegment = async () => {
    if (!editingSegmentId || !videoPath) return;

    const parsedStart = Number.parseFloat(editingStart);
    const parsedEnd = Number.parseFloat(editingEnd);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) return;

    const nextStart = Math.max(0, parsedStart);
    const nextEnd = Math.max(
      nextStart + MIN_SEGMENT_DURATION_SECONDS,
      parsedEnd
    );

    const snapshot = createCaptionSnapshot();
    setIsRegeneratingSegment(true);
    setSegmentRegenerateError(null);
    try {
      const regenerated = await transcribeCaptionSegment(
        videoPath,
        nextStart,
        nextEnd,
        'auto',
        regenerateModelName
      );
      applyRegeneratedSegment(
        editingSegmentId,
        nextStart,
        nextEnd,
        regenerated.text,
        regenerated.words
      );
      setLastRegenSnapshot(snapshot);
    } catch (error) {
      videoEditorLogger.error('Failed to regenerate caption segment:', error);
      setSegmentRegenerateError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsRegeneratingSegment(false);
    }
  };

  const regenerateAllSegments = async () => {
    if (!videoPath || captionSegments.length === 0) return;

    const snapshot = createCaptionSnapshot();
    setIsRegeneratingAllSegments(true);
    setSegmentRegenerateError(null);

    const previousModelName = selectedModelName;
    const shouldRestoreModel = previousModelName !== regenerateModelName;

    try {
      if (shouldRestoreModel) {
        setSelectedModel(regenerateModelName);
      }

      if (!isRegenerateModelDownloaded) {
        await downloadModel(regenerateModelName);
      }

      await startTranscription(videoPath);
      setLastRegenSnapshot(snapshot);

      setOriginalSegmentsById({});
      const freshSegments = useVideoEditorStore.getState().captionSegments;
      if (freshSegments.length > 0) {
        startEditingSegment(freshSegments[0]);
      } else {
        cancelEditingSegment();
      }
    } catch (error) {
      videoEditorLogger.error('Failed to regenerate all captions:', error);
      setSegmentRegenerateError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      if (shouldRestoreModel) {
        setSelectedModel(previousModelName);
      }
      setIsRegeneratingAllSegments(false);
    }
  };

  const openEditor = () => {
    if (!editingSegmentId && captionSegments.length > 0) {
      startEditingSegment(captionSegments[0]);
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

  const auditionSegment = (segment: CaptionSegment) => {
    startEditingSegment(segment);
    const startMs = Math.max(0, Math.floor(segment.start * 1000));
    const endMs = Math.max(startMs + 1, Math.floor(segment.end * 1000));
    requestSeek(startMs);
    setSegmentAuditionState({
      segmentId: segment.id,
      startMs,
      endMs,
    });
    setIsPlaying(true);
  };

  const handleTransportToggle = () => {
    setSegmentAuditionState(null);
    togglePlayback();
  };

  return (
    <div className="space-y-4">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Show Captions</span>
        <button
          onClick={() => setCaptionsEnabled(!captionSettings.enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            captionSettings.enabled
              ? 'bg-[var(--coral-400)]'
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

      {/* Transcription Section */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center gap-2 mb-3">
          <Mic className="w-4 h-4 text-[var(--ink-muted)]" />
          <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
            Transcription
          </span>
        </div>

        {/* Model Selector */}
        <div className="mb-3">
          <button
            onClick={() => setShowModelSelector(!showModelSelector)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] hover:bg-[var(--glass-highlight)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <span>{selectedModelName}</span>
              {isModelDownloaded ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Download className="w-3.5 h-3.5 text-[var(--ink-subtle)]" />
              )}
            </span>
            <span className="text-xs text-[var(--ink-subtle)]">
              {MODEL_SIZES[selectedModelName] || ''}
            </span>
          </button>

          {showModelSelector && (
            <div className="mt-1 bg-[var(--glass-surface-dark)] border border-[var(--glass-border)] rounded-md overflow-hidden">
              {whisperModels.map((model) => (
                <button
                  key={model.name}
                  onClick={() => {
                    setSelectedModel(model.name);
                    setShowModelSelector(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--glass-highlight)] transition-colors ${
                    model.name === selectedModelName
                      ? 'bg-[var(--coral-50)] text-[var(--coral-400)]'
                      : 'text-[var(--ink-dark)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>{model.name}</span>
                    {model.downloaded && (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    )}
                  </span>
                  <span className="text-xs text-[var(--ink-subtle)]">
                    {MODEL_SIZES[model.name] || ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transcribe Button */}
        <Button
          onClick={handleTranscribe}
          disabled={!videoPath || isTranscribing || isDownloadingModel}
          className="w-full"
          variant={captionSegments.length > 0 ? 'outline' : 'default'}
        >
          {isDownloadingModel ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Downloading... {Math.round(downloadProgress)}%
            </>
          ) : isTranscribing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {transcriptionStage === 'extracting_audio'
                ? 'Extracting audio...'
                : `Transcribing... ${Math.round(transcriptionProgress)}%`}
            </>
          ) : !isModelDownloaded ? (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download & Transcribe
            </>
          ) : captionSegments.length > 0 ? (
            <>
              <Mic className="w-4 h-4 mr-2" />
              Re-transcribe
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 mr-2" />
              Transcribe Audio
            </>
          )}
        </Button>

        {/* Error Display */}
        {transcriptionError && (
          <div className="mt-2 flex items-start gap-2 p-2 bg-[var(--error-light)] rounded-md">
            <AlertCircle className="w-4 h-4 text-[var(--error)] flex-shrink-0 mt-0.5" />
            <span className="text-xs text-[var(--error)]">
              {transcriptionError}
            </span>
          </div>
        )}
      </div>

      {/* Segments List */}
      {captionSegments.length > 0 && (
        <div className="pt-3 border-t border-[var(--glass-border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
              Segments ({captionSegments.length})
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={openEditor}
            >
              Open Editor
            </Button>
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
                <p className="text-[var(--ink-dark)] break-words line-clamp-2">{segment.text}</p>
              </div>
            ))}
          </div>
          {captionSegments.length > DEFAULT_VISIBLE_SEGMENTS && (
            <button
              onClick={() => setShowAllSegments((prev) => !prev)}
              className="mt-2 w-full px-2 py-1.5 rounded text-xs text-[var(--ink-subtle)] hover:text-[var(--ink-dark)] hover:bg-[var(--polar-mist)] transition-colors"
            >
              {showAllSegments
                ? `Show fewer (first ${DEFAULT_VISIBLE_SEGMENTS})`
                : `Show all ${captionSegments.length} segments`}
            </button>
          )}
        </div>
      )}

      {/* Style Settings */}
      {captionSegments.length > 0 && (
        <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
          <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide block">
            Style
          </span>

          {/* Font Size */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--ink-muted)]">Font Size</span>
              <span className="text-xs text-[var(--ink-dark)] font-mono">
                {captionSettings.size}px
              </span>
            </div>
            <Slider
              value={[captionSettings.size]}
              onValueChange={(values) =>
                updateCaptionSettings({ size: values[0] })
              }
              min={16}
              max={64}
              step={2}
            />
          </div>

          {/* Text Color */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-muted)]">Text Color</span>
            <input
              type="color"
              value={captionSettings.color}
              onChange={(e) => updateCaptionSettings({ color: e.target.value })}
              className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
            />
          </div>

          {/* Highlight Color */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-muted)]">
              Highlight Color
            </span>
            <input
              type="color"
              value={captionSettings.highlightColor}
              onChange={(e) =>
                updateCaptionSettings({ highlightColor: e.target.value })
              }
              className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
            />
          </div>

          {/* Animation Timing */}
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
                  {captionSettings.wordTransitionDuration.toFixed(2)}s
                </span>
              </div>
              <Slider
                value={[Math.round(captionSettings.wordTransitionDuration * 100)]}
                onValueChange={(values) =>
                  updateCaptionSettings({ wordTransitionDuration: values[0] / 100 })
                }
                min={0}
                max={100}
                step={1}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--ink-muted)]">
                  Segment Fade
                </span>
                <span className="text-xs text-[var(--ink-dark)] font-mono">
                  {captionSettings.fadeDuration.toFixed(2)}s
                </span>
              </div>
              <Slider
                value={[Math.round(captionSettings.fadeDuration * 100)]}
                onValueChange={(values) =>
                  updateCaptionSettings({ fadeDuration: values[0] / 100 })
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
                  {captionSettings.lingerDuration.toFixed(2)}s
                </span>
              </div>
              <Slider
                value={[Math.round(captionSettings.lingerDuration * 100)]}
                onValueChange={(values) =>
                  updateCaptionSettings({ lingerDuration: values[0] / 100 })
                }
                min={0}
                max={300}
                step={1}
              />
            </div>
          </div>

          {/* Position */}
          <div>
            <span className="text-xs text-[var(--ink-muted)] block mb-2">
              Position
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => updateCaptionSettings({ position: 'top' })}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  captionSettings.position === 'top'
                    ? 'bg-[var(--coral-100)] text-[var(--coral-400)]'
                    : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] hover:bg-[var(--glass-highlight)]'
                }`}
              >
                Top
              </button>
              <button
                onClick={() => updateCaptionSettings({ position: 'bottom' })}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  captionSettings.position === 'bottom'
                    ? 'bg-[var(--coral-100)] text-[var(--coral-400)]'
                    : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] hover:bg-[var(--glass-highlight)]'
                }`}
              >
                Bottom
              </button>
            </div>
          </div>

          {/* Background Color */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-muted)]">
              Background Color
            </span>
            <input
              type="color"
              value={captionSettings.backgroundColor}
              onChange={(e) =>
                updateCaptionSettings({ backgroundColor: e.target.value })
              }
              className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
            />
          </div>

          {/* Background Opacity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--ink-muted)]">
                Background Opacity
              </span>
              <span className="text-xs text-[var(--ink-dark)] font-mono">
                {captionSettings.backgroundOpacity}%
              </span>
            </div>
            <Slider
              value={[captionSettings.backgroundOpacity]}
              onValueChange={(values) =>
                updateCaptionSettings({ backgroundOpacity: values[0] })
              }
              min={0}
              max={100}
              step={5}
            />
          </div>
        </div>
      )}

      <Dialog open={isEditorOpen} onOpenChange={handleEditorOpenChange}>
        <DialogContent className="w-[96vw] max-w-[1200px] h-[88vh] p-0 gap-0 grid-rows-[auto_minmax(0,1fr)]">
          <DialogHeader className="px-4 py-3 border-b border-[var(--glass-border)]">
            <DialogTitle className="text-base text-[var(--ink-dark)]">
              Caption Editor
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-[280px_minmax(0,1fr)] min-h-0 h-full">
            <div className="border-r border-[var(--glass-border)] p-3 overflow-y-auto space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink-subtle)] mb-1">
                Segments
              </div>
              <p className="text-[10px] text-[var(--ink-subtle)] mb-2">
                Click a segment to audition. Edits auto-apply live; use reset per row to revert.
              </p>
              {captionSegments.map((segment) => {
                const dirty = isSegmentDirty(segment);
                return (
                  <div
                    key={`editor-segment-${segment.id}`}
                    className="flex items-stretch gap-1"
                  >
                    <button
                      type="button"
                      onClick={() => auditionSegment(segment)}
                      className={`flex-1 text-left rounded-md px-2 py-1.5 transition-colors ${
                        editingSegmentId === segment.id
                          ? 'bg-[var(--coral-100)] text-[var(--coral-500)]'
                          : 'bg-[var(--polar-mist)] hover:bg-[var(--glass-highlight)] text-[var(--ink-dark)]'
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
                        resetSegmentToBaseline(segment.id);
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

            <div className="min-w-0 min-h-0 flex flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleTransportToggle}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5 mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Play
                    </>
                  )}
                </Button>
                <span className="text-xs font-mono text-[var(--ink-subtle)]">
                  {formatTime(currentTimeMs / 1000)} / {formatTime(projectDurationSeconds)}
                </span>
              </div>

              <div
                ref={playbackTimelineRef}
                onMouseDown={beginPlaybackScrub}
                className="relative h-16 rounded-md border border-[var(--glass-border)] bg-[var(--glass-surface-dark)]/60 overflow-hidden cursor-ew-resize"
              >
                <div className="absolute inset-0">
                  {captionSegments.map((segment) => {
                    const left = (segment.start / projectDurationSeconds) * 100;
                    const width = Math.max(
                      ((segment.end - segment.start) / projectDurationSeconds) * 100,
                      0.8
                    );
                    return (
                      <div
                        key={`playback-segment-${segment.id}`}
                        className="absolute top-2 bottom-2 rounded bg-[var(--polar-mist)]/80 border border-[var(--glass-border)]"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    );
                  })}
                </div>
                <div
                  className="absolute top-0 bottom-0 w-px bg-[var(--coral-400)]"
                  style={{
                    left: `${clamp(
                      ((currentTimeMs / 1000) / projectDurationSeconds) * 100,
                      0,
                      100
                    )}%`,
                  }}
                />
              </div>

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
                          onChange={(event) => {
                            setEditingStart(event.target.value);
                            setWordCompressionRange([0, 100]);
                            setCompressionBaseWords(null);
                          }}
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
                          onChange={(event) => {
                            setEditingEnd(event.target.value);
                            setWordCompressionRange([0, 100]);
                            setCompressionBaseWords(null);
                          }}
                          className="mt-1 h-8 text-xs font-mono"
                        />
                    </label>
                  </div>

                  <Textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    rows={4}
                    className="min-h-[96px] text-sm"
                  />

                  <div className="rounded-md border border-[var(--glass-border)] bg-[var(--glass-surface-dark)]/60 p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[var(--ink-subtle)] uppercase tracking-wide">
                        Word Timing
                      </span>
                      <button
                        type="button"
                        onClick={syncWordsFromText}
                        className="px-1.5 py-0.5 rounded text-[10px] text-[var(--ink-subtle)] hover:text-[var(--ink-dark)] hover:bg-[var(--glass-highlight)] transition-colors"
                      >
                        Sync Words From Text
                      </button>
                    </div>
                    <div className="rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)]/50 px-2 py-1.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--ink-subtle)]">
                          Segment Timeline
                        </span>
                        <span className="text-[10px] font-mono text-[var(--ink-subtle)]">
                          {localPlayheadSeconds.toFixed(2)}s / {timelineDuration.toFixed(2)}s
                        </span>
                      </div>
                      <div
                        ref={localTimelineRef}
                        onMouseDown={beginLocalTimelineScrub}
                        className="relative h-8 rounded border border-[var(--glass-border)] bg-[var(--glass-surface-dark)]/70 overflow-hidden cursor-ew-resize"
                      >
                        <div
                          className="absolute top-1 bottom-1 rounded-sm border border-[var(--coral-300)]/60 bg-[var(--coral-100)]/30"
                          style={{
                            left: `${wordCompressionRange[0]}%`,
                            width: `${Math.max(wordCompressionRange[1] - wordCompressionRange[0], 0.75)}%`,
                          }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-px bg-[var(--coral-400)]"
                          style={{ left: `${wordCompressionRange[0]}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-px bg-[var(--coral-400)]"
                          style={{ left: `${wordCompressionRange[1]}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-[2px] bg-white"
                          style={{ left: `${localPlayheadPercent}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[var(--ink-subtle)]">
                        Click or drag to scrub within this segment. White line is local playhead.
                      </p>
                    </div>
                    <div className="rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)]/50 px-2 py-1.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--ink-subtle)]">
                          Master Compression (A/B)
                        </span>
                        <span className="text-[10px] font-mono text-[var(--ink-subtle)]">
                          A {wordCompressionRange[0].toFixed(0)}% / B {wordCompressionRange[1].toFixed(0)}%
                        </span>
                      </div>
                      <Slider
                        value={wordCompressionRange}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(values) => applyWordCompressionRange(values)}
                      />
                      <p className="text-[10px] text-[var(--ink-subtle)]">
                        Keep A or B on an endpoint to anchor that side, then drag the other handle to compress toward it.
                      </p>
                    </div>
                    <div
                      ref={wordTimelineRef}
                      className="relative h-12 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)]/50 overflow-hidden"
                    >
                      <div className="absolute inset-0">
                        <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--glass-border)] -translate-y-1/2" />
                      </div>
                      <div
                        className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none z-20"
                        style={{ left: `${localPlayheadPercent}%` }}
                      />
                      {editingWords.map((word, index) => {
                        const wordStart = Number.parseFloat(word.start);
                        const wordEnd = Number.parseFloat(word.end);
                        if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) {
                          return null;
                        }

                        const left = clamp(
                          ((wordStart - timelineSegmentStart) / timelineDuration) * 100,
                          0,
                          100
                        );
                        const right = clamp(
                          ((wordEnd - timelineSegmentStart) / timelineDuration) * 100,
                          0,
                          100
                        );
                        const width = Math.max(right - left, 1.5);
                        const isDragging = wordDragState?.index === index;

                        return (
                          <div
                            key={`timeline-${index}-${word.text}`}
                            className={`absolute top-1 bottom-1 rounded-md border transition-colors ${
                              isDragging
                                ? 'border-[var(--coral-400)] bg-[var(--coral-100)]/80'
                                : 'border-[var(--glass-border)] bg-[var(--card)]/85'
                            } cursor-grab active:cursor-grabbing`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            onMouseDown={(event) => startWordDrag(event, index, 'move')}
                            title={word.text}
                          >
                            <div className="absolute inset-0 flex items-center justify-center px-1">
                              <span className="truncate text-[10px] text-[var(--ink-dark)]">
                                {word.text || `Word ${index + 1}`}
                              </span>
                            </div>
                            <div
                              className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-[var(--coral-300)]/60 hover:bg-[var(--coral-300)]"
                              onMouseDown={(event) => startWordDrag(event, index, 'start')}
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-[var(--coral-300)]/60 hover:bg-[var(--coral-300)]"
                              onMouseDown={(event) => startWordDrag(event, index, 'end')}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-[var(--ink-subtle)]">
                      Drag a word block to move timing, or drag left/right edges to trim.
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {editingWords.map((word, index) => (
                        <div
                          key={`${index}-${word.text}`}
                          className="grid grid-cols-[minmax(0,1fr)_78px_78px] gap-1 items-center"
                        >
                          <span
                            className="truncate text-[11px] text-[var(--ink-dark)]"
                            title={word.text}
                          >
                            {word.text || `Word ${index + 1}`}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={word.start}
                            onChange={(event) =>
                              updateEditingWordTiming(
                                index,
                                'start',
                                event.target.value
                              )
                            }
                            className="h-7 rounded-md px-1.5 text-[10px] font-mono"
                          />
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={word.end}
                            onChange={(event) =>
                              updateEditingWordTiming(
                                index,
                                'end',
                                event.target.value
                              )
                            }
                            className="h-7 rounded-md px-1.5 text-[10px] font-mono"
                          />
                        </div>
                      ))}
                    </div>
                    {hasInvalidWordTiming && (
                      <p className="text-[10px] text-[var(--error)]">
                        Invalid word timings. Ensure each word start/end is valid and ordered.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] uppercase tracking-wide text-[var(--ink-subtle)] whitespace-nowrap">
                        Regen Model
                      </span>
                      <select
                        value={regenerateModelName}
                        onChange={(event) => setRegenerateModelName(event.target.value)}
                        className="h-8 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-xs text-[var(--ink-dark)] min-w-[140px]"
                      >
                        {whisperModels.map((model) => (
                          <option key={`regen-model-${model.name}`} value={model.name}>
                            {model.name}
                            {model.downloaded ? '' : ' (download)'}
                          </option>
                        ))}
                      </select>
                      {!isRegenerateModelDownloaded && (
                        <span className="text-[10px] text-[var(--ink-subtle)] whitespace-nowrap">
                          Downloads on regenerate
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={cancelEditingSegment}
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Clear Selection
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={regenerateEditingSegment}
                        disabled={isRegenerateDisabled}
                      >
                        {isRegeneratingSegment ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                            Regenerating...
                          </>
                        ) : (
                          'Regenerate Segment'
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={regenerateAllSegments}
                        disabled={isRegenerateAllDisabled}
                      >
                        {isRegeneratingAllSegments ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                            Re-transcribing All... {Math.round(transcriptionProgress)}%
                          </>
                        ) : (
                          'Re-transcribe All'
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={undoLastRegenerate}
                        disabled={!lastRegenSnapshot || isRegeneratingSegment || isRegeneratingAllSegments}
                      >
                        Undo Regen
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={saveEditingSegment}
                        disabled={isSaveDisabled}
                      >
                        Save Segment
                      </Button>
                    </div>
                  </div>
                  {segmentRegenerateError && (
                    <p className="text-[10px] text-[var(--error)]">
                      {segmentRegenerateError}
                    </p>
                  )}
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
    </div>
  );
}

