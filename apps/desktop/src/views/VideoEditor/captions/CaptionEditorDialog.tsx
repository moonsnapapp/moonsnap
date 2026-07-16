import type { RefObject } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';

import { CaptionOverlay } from '../../../components/VideoEditor/CaptionOverlay';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import type { CaptionSegment } from '../../../types';
import {
  formatTime,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';
import {
  CaptionPlaybackTransport,
  WordTimingEditor,
  type WordDragMode,
  type WordDragState,
} from '../components/CaptionPanelWidgets';
import type { CaptionSnapshot } from './captionTypes';
import {
  TranscriptionLanguageCombobox,
  WhisperModelSelect,
} from './TranscriptionControls';

const CAPTION_PREVIEW_RENDER_WIDTH = 1920;
const CAPTION_PREVIEW_RENDER_HEIGHT = 1080;


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

export interface CaptionEditorDialogProps {
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

export function CaptionEditorDialog({
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
