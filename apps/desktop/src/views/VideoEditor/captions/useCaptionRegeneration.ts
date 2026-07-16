import type { Dispatch, SetStateAction } from 'react';

import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import type { CaptionSegment, CaptionSettings, TrimSegment } from '../../../types';
import {
  buildEditableWordsForSegment,
  cloneCaptionSegments,
  distributeCaptionWordTiming,
  splitCaptionWords,
  toEditableCaptionWords,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';
import { remapCaptionSegmentsToTimeline } from '../../../utils/captionTimeline';
import { videoEditorLogger } from '../../../utils/logger';
import type { WordDragState } from '../components/CaptionPanelWidgets';
import {
  getCaptionErrorMessage,
  getRegenerateEditingSegmentRequest,
} from './captionOrchestration';
import type { CaptionSnapshot } from './captionTypes';

interface CaptionRegenerationOptions {
  captionSegments: CaptionSegment[];
  captionSettings: CaptionSettings;
  editingSegmentId: string | null;
  videoPath: string | null;
  editingText: string;
  editingStart: string;
  editingEnd: string;
  displayCaptionSegmentsById: Map<string, CaptionSegment>;
  timelineSegments: TrimSegment[] | undefined;
  selectedTranscriptionLanguage: string;
  regenerateModelName: string;
  selectedModelName: string;
  isRegenerateModelDownloaded: boolean;
  transcribeCaptionSegment: (videoPath: string, start: number, end: number, language: string, modelName: string) => Promise<CaptionSegment>;
  updateCaptionSegment: (segmentId: string, updates: Partial<CaptionSegment>) => void;
  setCaptionSegments: (segments: CaptionSegment[]) => void;
  updateCaptionSettings: (updates: Partial<CaptionSettings>) => void;
  setSelectedModel: (modelName: string) => void;
  downloadModel: (modelName: string) => Promise<void>;
  startTranscription: (videoPath: string) => Promise<void>;
  startEditingSegment: (segment: CaptionSegment) => void;
  cancelEditingSegment: () => void;
  setOriginalSegmentsById: Dispatch<SetStateAction<Record<string, CaptionSegment>>>;
  setEditingText: Dispatch<SetStateAction<string>>;
  setEditingStart: Dispatch<SetStateAction<string>>;
  setEditingEnd: Dispatch<SetStateAction<string>>;
  setEditingWords: Dispatch<SetStateAction<EditableCaptionWord[]>>;
  setDidEditWordTiming: Dispatch<SetStateAction<boolean>>;
  setWordDragState: Dispatch<SetStateAction<WordDragState | null>>;
  setWordCompressionRange: Dispatch<SetStateAction<[number, number]>>;
  setCompressionBaseWords: Dispatch<SetStateAction<Array<{ text: string; start: number; end: number }> | null>>;
  lastRegenSnapshot: CaptionSnapshot | null;
  setLastRegenSnapshot: Dispatch<SetStateAction<CaptionSnapshot | null>>;
  setIsRegeneratingSegment: Dispatch<SetStateAction<boolean>>;
  setIsRegeneratingAllSegments: Dispatch<SetStateAction<boolean>>;
  setSegmentRegenerateError: Dispatch<SetStateAction<string | null>>;
}

export function useCaptionRegeneration(options: CaptionRegenerationOptions) {
  const {
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
  } = options;

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

  return {
    regenerateEditingSegment,
    regenerateAllSegments,
    undoLastRegenerate,
  };
}
