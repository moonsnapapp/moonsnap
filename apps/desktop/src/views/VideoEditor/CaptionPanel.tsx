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
  RotateCcw,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectCaptionSegments,
  selectCaptionSettings,
  selectCancelTranscription,
  selectDownloadModel,
  selectDownloadProgress,
  selectIsCancellingTranscription,
  selectIsDownloadingModel,
  selectIsTranscribing,
  selectLoadWhisperModels,
  selectProject,
  selectRequestSeek,
  selectSelectedModelName,
  selectSelectedTranscriptionLanguage,
  selectSetCaptionSegments,
  selectSetCaptionsEnabled,
  selectSetDownloadProgress,
  selectSetIsPlaying,
  selectSetSelectedModel,
  selectSetSelectedTranscriptionLanguage,
  selectSetTranscriptionProgress,
  selectStartTranscription,
  selectTogglePlayback,
  selectTranscribeCaptionSegment,
  selectTranscriptionError,
  selectTranscriptionMessage,
  selectTranscriptionProgress,
  selectTranscriptionStage,
  selectUpdateCaptionSegment,
  selectUpdateCaptionSettings,
  selectWhisperModels,
} from '../../stores/videoEditor/selectors';
import { TRANSCRIPTION } from '../../constants';
import { isTranscriptionCancelledError } from '../../stores/videoEditor/captionSlice';
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
  CaptionAuditionWatcher,
  CaptionPlaybackTransport,
  SegmentAuditionState,
  WordDragMode,
  WordDragState,
  WordTimingEditor,
} from './components/CaptionPanelWidgets';

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

interface CaptionSnapshot {
  segments: CaptionSegment[];
  settings: CaptionSettings;
}
export function CaptionPanel({ videoPath }: CaptionPanelProps) {
  const project = useVideoEditorStore(selectProject);
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const cancelTranscription = useVideoEditorStore(selectCancelTranscription);
  const isCancellingTranscription = useVideoEditorStore(
    selectIsCancellingTranscription
  );
  const isTranscribing = useVideoEditorStore(selectIsTranscribing);
  const transcriptionMessage = useVideoEditorStore(selectTranscriptionMessage);
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
  const setDownloadProgress = useVideoEditorStore(selectSetDownloadProgress);
  const setTranscriptionProgress = useVideoEditorStore(selectSetTranscriptionProgress);
  const requestSeek = useVideoEditorStore(selectRequestSeek);
  const setIsPlaying = useVideoEditorStore(selectSetIsPlaying);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);

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
        setTranscriptionProgress(
          event.payload.progress,
          event.payload.stage,
          event.payload.message
        );
      }
    );

    const unlistenDownload = listen<DownloadProgress>(
      'whisper-download-progress',
      (event) => {
        setDownloadProgress(event.payload.progress);
      }
    );

    return () => {
      unlistenTranscription.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
    };
  }, [setDownloadProgress, setTranscriptionProgress]);

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
      if (!isTranscriptionCancelledError(error)) {
        videoEditorLogger.error('Transcription failed:', error);
      }
    }
  };

  const handleCancelTranscription = async () => {
    try {
      await cancelTranscription();
    } catch (error) {
      if (!isTranscriptionCancelledError(error)) {
        videoEditorLogger.error('Failed to cancel transcription:', error);
      }
    }
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
    const host = captionPreviewHostRef.current;
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
        setCaptionPreviewDisplayWidth((prev) => (prev === nextWidth ? prev : nextWidth));
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
        selectedTranscriptionLanguage,
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
      if (!isTranscriptionCancelledError(error)) {
        videoEditorLogger.error('Failed to regenerate caption segment:', error);
        setSegmentRegenerateError(
          error instanceof Error ? error.message : String(error)
        );
      }
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
      if (!isTranscriptionCancelledError(error)) {
        videoEditorLogger.error('Failed to regenerate all captions:', error);
        setSegmentRegenerateError(
          error instanceof Error ? error.message : String(error)
        );
      }
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

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Burn Into Export</span>
        <button
          onClick={() =>
            updateCaptionSettings({
              exportWithSubtitles: !captionSettings.exportWithSubtitles,
            })
          }
          className={`relative w-10 h-5 rounded-full transition-colors ${
            captionSettings.exportWithSubtitles
              ? 'bg-[var(--coral-400)]'
              : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              captionSettings.exportWithSubtitles ? 'translate-x-5' : 'translate-x-0'
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

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">Language</span>
            <span className="text-[10px] text-[var(--ink-subtle)]">
              Default is pinned; use auto only if needed
            </span>
          </div>
          <select
            value={selectedTranscriptionLanguage}
            onChange={(event) =>
              setSelectedTranscriptionLanguage(event.target.value)
            }
            className="w-full h-10 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 text-sm text-[var(--ink-dark)]"
          >
            {TRANSCRIPTION.LANGUAGES.map((language) => (
              <option key={`transcription-language-${language.value}`} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
          {selectedTranscriptionLanguage === TRANSCRIPTION.AUTO_LANGUAGE && (
            <p className="mt-1 text-[10px] text-[var(--ink-subtle)]">
              Auto-detect is supported, but explicit language selection is usually more reliable.
            </p>
          )}
        </div>

        {/* Transcribe Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleTranscribe}
            disabled={!videoPath || isTranscribing || isDownloadingModel}
            className="flex-1"
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
                  : isCancellingTranscription
                    ? 'Cancelling...'
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
          {(isTranscribing || isCancellingTranscription) && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelTranscription}
              disabled={isCancellingTranscription}
              className="shrink-0"
            >
              {isCancellingTranscription ? 'Cancelling...' : 'Cancel'}
            </Button>
          )}
        </div>

        {(isTranscribing || isCancellingTranscription) && (
          <div className="mt-2 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 py-2">
            <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
              <span className="capitalize">
                {transcriptionStage.replace(/_/g, ' ')}
              </span>
              <span>{Math.round(transcriptionProgress)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--glass-border)]">
              <div
                className="h-full rounded-full bg-[var(--coral-400)] transition-[width] duration-200"
                style={{ width: `${Math.max(0, Math.min(100, transcriptionProgress))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--ink-subtle)]">
              {transcriptionMessage || 'Working on transcription...'}
            </p>
          </div>
        )}

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
              <CaptionPlaybackTransport
                captionSegments={captionSegments}
                projectDurationSeconds={projectDurationSeconds}
                onTogglePlayback={handleTransportToggle}
                onBeginPlaybackScrub={beginPlaybackScrub}
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

                  <WordTimingEditor
                    timelineSegmentStart={timelineSegmentStart}
                    timelineDuration={timelineDuration}
                    wordCompressionRange={wordCompressionRange}
                    beginLocalTimelineScrub={beginLocalTimelineScrub}
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
                      {(isRegeneratingSegment || isRegeneratingAllSegments) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleCancelTranscription}
                          disabled={isCancellingTranscription}
                        >
                          {isCancellingTranscription ? 'Cancelling...' : 'Cancel'}
                        </Button>
                      )}
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
