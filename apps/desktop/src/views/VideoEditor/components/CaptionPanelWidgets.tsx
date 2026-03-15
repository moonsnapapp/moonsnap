import { Pause, Play } from 'lucide-react';
import { useEffect, type MouseEvent, type MutableRefObject } from 'react';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import { selectCurrentTimeMs, selectIsPlaying } from '../../../stores/videoEditor/selectors';
import { Input } from '../../../components/ui/input';
import { Slider } from '../../../components/ui/slider';
import type { CaptionSegment } from '../../../types';
import {
  clamp,
  formatTime,
  type EditableCaptionWord,
} from '../../../utils/captionTiming';

export type WordDragMode = 'start' | 'end' | 'move';

export interface WordDragState {
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

export interface SegmentAuditionState {
  segmentId: string;
  startMs: number;
  endMs: number;
}

interface CaptionAuditionWatcherProps {
  segmentAuditionState: SegmentAuditionState | null;
  requestSeek: (timeMs: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  clearSegmentAuditionState: () => void;
}

export function CaptionAuditionWatcher({
  segmentAuditionState,
  requestSeek,
  setIsPlaying,
  clearSegmentAuditionState,
}: CaptionAuditionWatcherProps) {
  const currentTimeMs = useVideoEditorStore(selectCurrentTimeMs);
  const isPlaying = useVideoEditorStore(selectIsPlaying);

  useEffect(() => {
    if (!segmentAuditionState || !isPlaying) return;
    if (currentTimeMs < segmentAuditionState.endMs) return;

    requestSeek(segmentAuditionState.endMs);
    setIsPlaying(false);
    clearSegmentAuditionState();
  }, [
    clearSegmentAuditionState,
    currentTimeMs,
    isPlaying,
    requestSeek,
    segmentAuditionState,
    setIsPlaying,
  ]);

  return null;
}

interface CaptionPlaybackTransportProps {
  captionSegments: CaptionSegment[];
  projectDurationSeconds: number;
  onTogglePlayback: () => void;
  onBeginPlaybackScrub: (event: MouseEvent<HTMLDivElement>) => void;
  playbackTimelineRef: MutableRefObject<HTMLDivElement | null>;
}

export function CaptionPlaybackTransport({
  captionSegments,
  projectDurationSeconds,
  onTogglePlayback,
  onBeginPlaybackScrub,
  playbackTimelineRef,
}: CaptionPlaybackTransportProps) {
  const currentTimeMs = useVideoEditorStore(selectCurrentTimeMs);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const playbackPositionPercent = clamp(
    ((currentTimeMs / 1000) / projectDurationSeconds) * 100,
    0,
    100
  );

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlayback}
          className="editor-choice-pill editor-choice-pill--active flex items-center gap-1 px-2 py-1.5 text-xs"
        >
          {isPlaying ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              Pause
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Play
            </>
          )}
        </button>
        <span className="text-xs font-mono text-[var(--ink-subtle)]">
          {formatTime(currentTimeMs / 1000)} / {formatTime(projectDurationSeconds)}
        </span>
      </div>

      <div
        ref={playbackTimelineRef}
        onMouseDown={onBeginPlaybackScrub}
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
          style={{ left: `${playbackPositionPercent}%` }}
        />
      </div>
    </>
  );
}

interface WordTimingEditorProps {
  timelineSegmentStart: number;
  timelineDuration: number;
  wordCompressionRange: [number, number];
  beginLocalTimelineScrub: (event: MouseEvent<HTMLDivElement>) => void;
  localTimelineRef: MutableRefObject<HTMLDivElement | null>;
  applyWordCompressionRange: (nextRange: number[]) => void;
  wordTimelineRef: MutableRefObject<HTMLDivElement | null>;
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
  updateEditingWordTiming: (
    index: number,
    field: 'start' | 'end',
    value: string
  ) => void;
  syncWordsFromText: () => void;
  hasInvalidWordTiming: boolean;
}

export function WordTimingEditor({
  timelineSegmentStart,
  timelineDuration,
  wordCompressionRange,
  beginLocalTimelineScrub,
  localTimelineRef,
  applyWordCompressionRange,
  wordTimelineRef,
  editingWords,
  wordDragState,
  startWordDrag,
  updateEditingWordTiming,
  syncWordsFromText,
  hasInvalidWordTiming,
}: WordTimingEditorProps) {
  const currentTimeMs = useVideoEditorStore(selectCurrentTimeMs);
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

  return (
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
  );
}
