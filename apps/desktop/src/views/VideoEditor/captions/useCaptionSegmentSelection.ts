import type { Dispatch, SetStateAction } from 'react';

import type { CaptionSegment, TrimSegment } from '../../../types';
import {
  buildEditableWordsForSegment,
  cloneCaptionSegment,
  segmentMatchesUpdate,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';
import { remapCaptionSegmentsToTimeline } from '../../../utils/captionTimeline';
import type { WordDragState } from '../components/CaptionPanelWidgets';
import {
  addOriginalCaptionSegmentSnapshot,
  getCaptionEditDisplaySegment,
} from './captionOrchestration';

interface CaptionSegmentSelectionOptions {
  displayCaptionSegmentsById: Map<string, CaptionSegment>;
  editingSegmentId: string | null;
  timelineSegments: TrimSegment[] | undefined;
  originalSegmentsById: Record<string, CaptionSegment>;
  updateCaptionSegment: (segmentId: string, updates: Partial<CaptionSegment>) => void;
  setOriginalSegmentsById: Dispatch<SetStateAction<Record<string, CaptionSegment>>>;
  setEditingSegmentId: Dispatch<SetStateAction<string | null>>;
  setIsEditorOpen: Dispatch<SetStateAction<boolean>>;
  setEditingText: Dispatch<SetStateAction<string>>;
  setEditingStart: Dispatch<SetStateAction<string>>;
  setEditingEnd: Dispatch<SetStateAction<string>>;
  setEditingWords: Dispatch<SetStateAction<EditableCaptionWord[]>>;
  setDidEditWordTiming: Dispatch<SetStateAction<boolean>>;
  setWordDragState: Dispatch<SetStateAction<WordDragState | null>>;
  setWordCompressionRange: Dispatch<SetStateAction<[number, number]>>;
  setCompressionBaseWords: Dispatch<SetStateAction<Array<{ text: string; start: number; end: number }> | null>>;
  setIsRegeneratingSegment: Dispatch<SetStateAction<boolean>>;
  setIsRegeneratingAllSegments: Dispatch<SetStateAction<boolean>>;
  setSegmentRegenerateError: Dispatch<SetStateAction<string | null>>;
}

export function useCaptionSegmentSelection(options: CaptionSegmentSelectionOptions) {
  const {
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
  } = options;

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

  return {
    startEditingSegment,
    cancelEditingSegment,
    resetSegmentToBaseline,
    isSegmentDirty,
  };
}
