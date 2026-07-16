/**
 * CaptionPanel - Panel for caption transcription and editing.
 * Provides transcription controls, segment list, and settings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CaptionSegment } from '../../../types';
import {
  cloneCaptionSegment,
  distributeCaptionWordTiming,
  splitCaptionWords,
  toEditableCaptionWords,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';
import { remapCaptionSegmentsToTimeline } from '../../../utils/captionTimeline';
import {
  CaptionAuditionWatcher,
  type SegmentAuditionState,
  type WordDragMode,
  type WordDragState,
} from '../components/CaptionPanelWidgets';
import { CaptionEditorDialog } from './CaptionEditorDialog';
import { CaptionSegmentsList } from './CaptionSegmentsList';
import { CaptionStyleSettings } from './CaptionStyleSettings';
import { TranscriptionControls } from './TranscriptionControls';
import {
  getCaptionSegmentForEdit,
  getLiveCaptionSegmentUpdate,
  getSavedCaptionSegmentUpdate,
  parseCaptionEditWindow,
} from './captionEditTransforms';
import { getCaptionEditorValidation } from './captionEditorValidation';
import {
  getCaptionPreviewLayout,
  getCaptionPreviewSourceSize,
  getDownloadedModelState,
  getInitialEditorSegment,
  getProjectDurationSeconds,
  getRegenerateDisabledState,
  getSegmentAuditionTiming,
  getSelectedEditingSegment,
  getVisibleCaptionSegments,
  transcribeWithDownloadedModel,
  useCaptionPanelModelEffects,
  useObservedCaptionPreviewWidth,
} from './captionOrchestration';
import type { CaptionSnapshot } from './captionTypes';
import {
  createWordDragState,
  getDraggedWordTiming,
  getWordCompressionUpdate,
} from './captionWordTiming';
import { useCaptionPanelStoreState } from './useCaptionPanelStoreState';
import { useCaptionRegeneration } from './useCaptionRegeneration';
import { useCaptionSegmentSelection } from './useCaptionSegmentSelection';
import { useCaptionTimelineScrubbing } from './useCaptionTimelineScrubbing';

export interface CaptionPanelProps {
  videoPath: string | null;
}

export function CaptionPanelContent({ videoPath }: CaptionPanelProps) {
  const {
    project,
    captionSegments,
    captionSettings,
    clearCaptions,
    timelineSegments,
    isTranscribing,
    transcriptionProgress,
    transcriptionStage,
    transcriptionError,
    whisperModels,
    selectedModelName,
    selectedTranscriptionLanguage,
    isDownloadingModel,
    downloadProgress,
    loadWhisperModels,
    setSelectedModel,
    setSelectedTranscriptionLanguage,
    downloadModel,
    startTranscription,
    transcribeCaptionSegment,
    updateCaptionSettings,
    updateCaptionSegment,
    setCaptionSegments,
    setCaptionsEnabled,
    setTranscriptionProgress,
    requestSeek,
    setIsPlaying,
    togglePlayback,
  } = useCaptionPanelStoreState();

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

  const {
    startEditingSegment,
    cancelEditingSegment,
    resetSegmentToBaseline,
    isSegmentDirty,
  } = useCaptionSegmentSelection({
    displayCaptionSegmentsById,
    editingSegmentId,
    timelineSegments,
    originalSegmentsById,
    updateCaptionSegment,
    setOriginalSegmentsById,
    setEditingSegmentId,
    setIsEditorOpen,
    setEditingText,
    setEditingStart,
    setEditingEnd,
    setEditingWords,
    setDidEditWordTiming,
    setWordDragState,
    setWordCompressionRange,
    setCompressionBaseWords,
    setIsRegeneratingSegment,
    setIsRegeneratingAllSegments,
    setSegmentRegenerateError,
  });

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

  const { beginPlaybackScrub, beginLocalTimelineScrub } = useCaptionTimelineScrubbing({
    playbackTimelineRef,
    localTimelineRef,
    projectDurationSeconds,
    editingStartSeconds: editingStart,
    editingEndSeconds: editingEnd,
    requestSeek,
  });

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

  const {
    regenerateEditingSegment,
    regenerateAllSegments,
    undoLastRegenerate,
  } = useCaptionRegeneration({
    captionSegments,
    captionSettings,
    editingSegmentId,
    videoPath,
    editingText,
    editingStart,
    editingEnd,
    displayCaptionSegmentsById,
    timelineSegments,
    selectedTranscriptionLanguage,
    regenerateModelName,
    selectedModelName,
    isRegenerateModelDownloaded,
    transcribeCaptionSegment,
    updateCaptionSegment,
    setCaptionSegments,
    updateCaptionSettings,
    setSelectedModel,
    downloadModel,
    startTranscription,
    startEditingSegment,
    cancelEditingSegment,
    setOriginalSegmentsById,
    setEditingText,
    setEditingStart,
    setEditingEnd,
    setEditingWords,
    setDidEditWordTiming,
    setWordDragState,
    setWordCompressionRange,
    setCompressionBaseWords,
    lastRegenSnapshot,
    setLastRegenSnapshot,
    setIsRegeneratingSegment,
    setIsRegeneratingAllSegments,
    setSegmentRegenerateError,
  });

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
