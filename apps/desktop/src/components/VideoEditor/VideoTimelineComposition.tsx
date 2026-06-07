/* eslint-disable react-refresh/only-export-components */
import { createContext, memo, use } from 'react';
import {
  Film,
  ZoomIn,
  ZoomOut,
  Maximize2,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Type,
  Highlighter,
  Video,
  EyeOff,
  Gauge,
  Scissors,
  RotateCcw,
  Repeat2,
  X,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  formatTimeSimple,
  MAX_TRIM_SEGMENT_SPEED,
  MIN_TRIM_SEGMENT_SPEED,
  useVideoEditorStore,
} from '../../stores/videoEditorStore';
import { usePlaybackTime } from '../../hooks/usePlaybackEngine';
import { usePlaybackTimeThrottled } from '../../hooks/usePlaybackTimeThrottled';
import { TimelineRuler } from './TimelineRuler';
import { ZoomTrackContent, AnnotationTrackContent, SceneTrackContent, MaskTrackContent, TextTrackContent, TrimTrackContent } from './tracks';
import { TrackManager } from './TrackManager';

const IO_MARKER_LINE_COLOR = 'var(--accent-300, #C8CCD3)';
const IO_MARKER_HANDLE_BG = 'linear-gradient(135deg, var(--accent-400) 0%, var(--accent-500) 100%)';
const IO_MARKER_TOOLTIP_BG = 'var(--glass-bg-solid)';
const IO_MARKER_TOOLTIP_BORDER = 'var(--accent-400, #9CA3AF)';
const IO_MARKER_TOOLTIP_TEXT = 'var(--accent-300, #C8CCD3)';
const PLAYHEAD_COLOR = 'var(--warning, #F59E0B)';
const PLAYHEAD_GLOW = 'rgba(245, 158, 11, 0.35)';
const PLAYHEAD_BORDER = 'rgba(245, 158, 11, 0.55)';
const CUT_SCRUBBER_COLOR = 'var(--accent-500, #6B7280)';
const TIMELINE_MARKER_LINE_WIDTH_PX = 2;
const TIMELINE_MARKER_HANDLE_WIDTH_PX = 12;
const CUT_PREVIEW_LINE_WIDTH_PX = 1;
const TIMELINE_RULER_HEIGHT_PX = 32;
const IO_RANGE_BAR_HEIGHT_PX = 3;
const IO_RANGE_BAR_BOTTOM_OFFSET_PX = 2;

type TimelineMarkerEdge = 'start' | 'center' | 'end';

function snapToDevicePixel(positionPx: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.round(positionPx * dpr) / dpr;
}

function getMarkerLayout(positionPx: number, widthPx: number, lineWidthPx = TIMELINE_MARKER_LINE_WIDTH_PX) {
  const snappedPositionPx = snapToDevicePixel(positionPx);
  const clampedLeft = Math.max(
    0,
    Math.min(snappedPositionPx, Math.max(0, widthPx - lineWidthPx)),
  );

  const halfHandleWidth = TIMELINE_MARKER_HANDLE_WIDTH_PX / 2;
  let edge: TimelineMarkerEdge = 'center';

  if (snappedPositionPx <= halfHandleWidth) {
    edge = 'start';
  } else if (snappedPositionPx >= widthPx - halfHandleWidth) {
    edge = 'end';
  }

  return { clampedLeft, edge };
}

function getMarkerAnchorClass(edge: TimelineMarkerEdge): string {
  if (edge === 'start') return 'left-0 translate-x-0';
  if (edge === 'end') return 'right-0 translate-x-0';
  return 'left-1/2 -translate-x-1/2';
}

/** Triangle tip must always align with the line center, even at edges. */
const MARKER_HANDLE_CENTER_CLASS = 'left-1/2 -translate-x-1/2';

/**
 * Preview scrubber - ghost playhead that follows mouse when not playing.
 */
const PreviewScrubber = memo(function PreviewScrubber({
  previewTimeMs,
  timelineZoom,
  trackLabelWidth,
  isCutMode,
  width,
}: {
  previewTimeMs: number;
  timelineZoom: number;
  trackLabelWidth: number;
  isCutMode: boolean;
  width: number;
}) {
  const position = previewTimeMs * timelineZoom + trackLabelWidth;
  const lineWidthPx = isCutMode ? CUT_PREVIEW_LINE_WIDTH_PX : TIMELINE_MARKER_LINE_WIDTH_PX;
  const { clampedLeft } = getMarkerLayout(position, width, lineWidthPx);
  const scrubberColor = isCutMode ? CUT_SCRUBBER_COLOR : 'var(--ink-muted)';

  return (
    <div
      data-preview-scrubber
      data-cut-mode={isCutMode}
      className="absolute top-0 bottom-0 z-40 pointer-events-none"
      style={{ left: `${clampedLeft}px`, width: `${lineWidthPx}px`, backgroundColor: scrubberColor }}
    >
      {/* Scrubber handle */}
      <div
        className={`absolute -top-1 ${MARKER_HANDLE_CENTER_CLASS} w-3 h-4 rounded-b-sm`}
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)',
          backgroundColor: scrubberColor,
        }}
      />
    </div>
  );
});

const TimelineTimeLabel = memo(function TimelineTimeLabel({
  timeMs,
  timelineZoom,
  width,
  lineWidthPx = TIMELINE_MARKER_LINE_WIDTH_PX,
  variant = 'preview',
}: {
  timeMs: number;
  timelineZoom: number;
  width: number;
  lineWidthPx?: number;
  variant?: 'preview' | 'playhead';
}) {
  const position = timeMs * timelineZoom;
  const { clampedLeft, edge } = getMarkerLayout(position, width, lineWidthPx);
  const isPlayhead = variant === 'playhead';

  return (
    <div
      data-timeline-time-label={variant}
      className="absolute top-0 bottom-0 z-[80] pointer-events-none"
      style={{ left: `${clampedLeft}px`, width: `${lineWidthPx}px` }}
    >
      <div
        className={`absolute top-5 ${getMarkerAnchorClass(edge)} px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap shadow-lg ${
          isPlayhead
            ? 'bg-[var(--polar-ice)]'
            : 'bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] text-[var(--ink-dark)]'
        }`}
        style={isPlayhead
          ? {
              borderColor: PLAYHEAD_BORDER,
              borderWidth: '1px',
              color: PLAYHEAD_COLOR,
            }
          : undefined}
      >
        {formatTimeSimple(timeMs)}
      </div>
    </div>
  );
});

/**
 * Time display component - uses usePlaybackTime for smooth updates.
 */
const TimeDisplay = memo(function TimeDisplay({ durationMs }: { durationMs: number }) {
  const currentTimeMs = usePlaybackTimeThrottled(10);

  return (
    <div className="px-2 py-0.5 bg-[var(--polar-mist)]/60 rounded text-xs font-mono text-[var(--ink-dark)] tabular-nums">
      {formatTimeSimple(currentTimeMs)}
      <span className="text-[var(--ink-subtle)] mx-1">/</span>
      <span className="text-[var(--ink-subtle)]">{formatTimeSimple(durationMs)}</span>
    </div>
  );
});

/**
 * Memoized playhead component - only re-renders when position changes.
 * Uses usePlaybackTime for 60fps updates without triggering parent re-renders.
 */
const Playhead = memo(function Playhead({
  timelineZoom,
  trackLabelWidth,
  isDragging,
  onMouseDown,
  width,
  visible,
}: {
  timelineZoom: number;
  trackLabelWidth: number;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  width: number;
  visible: boolean;
}) {
  const currentTimeMs = usePlaybackTime();
  const playheadPosition = currentTimeMs * timelineZoom + trackLabelWidth;
  const { clampedLeft } = getMarkerLayout(playheadPosition, width);

  return (
    <div
      data-playhead
      className={`
        absolute top-0 bottom-0 w-0.5 z-30 pointer-events-none transition-opacity
      `}
      style={{ 
        left: `${clampedLeft}px`,
        backgroundColor: PLAYHEAD_COLOR,
        opacity: visible ? 1 : 0,
      }}
    >
      {/* Playhead handle */}
      <div
        className={`
          absolute -top-1 ${MARKER_HANDLE_CENTER_CLASS} w-3 h-4
          ${visible ? 'pointer-events-auto' : 'pointer-events-none'}
          rounded-b-sm
          shadow-lg
          ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
          ${isDragging ? 'scale-110' : 'hover:scale-105'}
          transition-transform
        `}
        data-timeline-control
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)',
          backgroundColor: PLAYHEAD_COLOR,
          boxShadow: `0 10px 15px -3px ${PLAYHEAD_GLOW}`, // tauri-shadow-allow
        }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
});

const PlayheadTimeLabel = memo(function PlayheadTimeLabel({
  timelineZoom,
  width,
}: {
  timelineZoom: number;
  width: number;
}) {
  const currentTimeMs = usePlaybackTime();

  return (
    <TimelineTimeLabel
      timeMs={currentTimeMs}
      timelineZoom={timelineZoom}
      width={width}
      variant="playhead"
    />
  );
});

/**
 * IO Marker - teal vertical line confined to the ruler area with "I" or "O" label.
 * Draggable: grab the label handle to reposition.
 */
const IOMarker = memo(function IOMarker({
  timeMs,
  label,
  timelineZoom,
  isDragging,
  onMouseDown,
  width,
}: {
  timeMs: number;
  label: 'I' | 'O';
  timelineZoom: number;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  width: number;
}) {
  const position = timeMs * timelineZoom;
  const { clampedLeft, edge } = getMarkerLayout(position, width);

  return (
    <div
      className="absolute top-0 h-8 w-0.5 z-50 pointer-events-none"
      style={{
        left: `${clampedLeft}px`,
        backgroundColor: IO_MARKER_LINE_COLOR,
      }}
    >
      {/* Draggable label handle */}
      <div
        data-timeline-control
        data-io-marker={label === 'I' ? 'in' : 'out'}
        className={`absolute top-0 ${getMarkerAnchorClass(edge)} w-4 h-4 rounded-b-sm flex items-center justify-center text-[9px] font-bold text-white pointer-events-auto ${isDragging ? 'cursor-grabbing scale-110' : 'cursor-grab hover:scale-105'} transition-transform`}
        style={{
          background: IO_MARKER_HANDLE_BG,
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: '1px',
        }}
        onMouseDown={onMouseDown}
      >
        {label}
      </div>
      {/* Time tooltip while dragging */}
      {isDragging && (
        <div
          className={`absolute top-5 ${getMarkerAnchorClass(edge)} px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap shadow-lg pointer-events-none`}
          style={{
            backgroundColor: IO_MARKER_TOOLTIP_BG,
            color: IO_MARKER_TOOLTIP_TEXT,
            borderColor: IO_MARKER_TOOLTIP_BORDER,
            borderWidth: '1px',
          }}
        >
          {formatTimeSimple(timeMs)}
        </div>
      )}
    </div>
  );
});

/**
 * IO range bar - shows the export range as a slim strip near the ruler baseline.
 */
const IORangeBar = memo(function IORangeBar({
  inPointMs,
  outPointMs,
  effectiveDurationMs,
  timelineZoom,
}: {
  inPointMs: number | null;
  outPointMs: number | null;
  effectiveDurationMs: number;
  timelineZoom: number;
}) {
  const effectiveIn = inPointMs ?? 0;
  const effectiveOut = outPointMs ?? effectiveDurationMs;

  const inPosition = effectiveIn * timelineZoom;
  const outPosition = effectiveOut * timelineZoom;
  const width = Math.max(IO_RANGE_BAR_HEIGHT_PX, outPosition - inPosition);
  const top = TIMELINE_RULER_HEIGHT_PX - IO_RANGE_BAR_HEIGHT_PX - IO_RANGE_BAR_BOTTOM_OFFSET_PX;

  return (
    <div
      data-io-range-bar
      className="absolute z-25 pointer-events-none rounded-full"
      style={{
        top: `${top}px`,
        left: `${inPosition}px`,
        width: `${width}px`,
        height: `${IO_RANGE_BAR_HEIGHT_PX}px`,
        background: 'linear-gradient(90deg, var(--accent-400) 0%, var(--accent-500) 100%)',
        filter: 'drop-shadow(0 0 3px rgba(156, 163, 175, 0.35))',
      }}
    />
  );
});

type TimelineTrackType = 'video' | 'text' | 'annotation' | 'zoom' | 'scene' | 'mask';
type TimelineProject = ReturnType<typeof useVideoEditorStore.getState>['project'];

export interface TimelineCompositionContextValue {
  project: TimelineProject;
  sourceDurationMs: number;
  effectiveDurationMs: number;
  timelineZoom: number;
  timelineWidth: number;
  zoomPercent: number;
  isDraggingPlayhead: boolean;
  isPlaying: boolean;
  splitMode: boolean;
  previewTimeMs: number | null;
  exportInPointMs: number | null;
  exportOutPointMs: number | null;
  draggingIOMarker: 'in' | 'out' | null;
  isSpeedPopoverOpen: boolean;
  selectedTrimSegmentSpeed: number | null;
  canSetSelectedTrimSegmentSpeed: boolean;
  canReplayIO: boolean;
  isIOLoopEnabled: boolean;
  hasVideoTrack: boolean;
  hasTextTrack: boolean;
  hasAnnotationTrack: boolean;
  hasZoomTrack: boolean;
  hasSceneTrack: boolean;
  hasMaskTrack: boolean;
  lastVisibleTrack: TimelineTrackType | null;
  shouldShowPrimaryPlayhead: boolean;
  speedControlRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onResetTrimSegments?: () => void;
  onSetInPoint?: () => void;
  onSetOutPoint?: () => void;
  onClearExportRange?: () => void;
  onToggleCutMode: () => void;
  onToggleSpeedPopover: () => void;
  onSpeedInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onGoToStart: () => void;
  onSkipBack: () => void;
  onTogglePlayback: () => void;
  onReplayIO: () => void;
  onSkipForward: () => void;
  onGoToEnd: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitTimelineToWindow: () => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onTimelineMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
  onTimelineMouseLeave: () => void;
  onTimelineCutClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onTimelineClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onRulerMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onIOMarkerMouseDown: (marker: 'in' | 'out', event: React.MouseEvent) => void;
  onPlayheadMouseDown: (event: React.MouseEvent) => void;
}

const TimelineCompositionContext = createContext<TimelineCompositionContextValue | null>(null);

function useTimelineComposition() {
  const context = use(TimelineCompositionContext);
  if (!context) {
    throw new Error('Timeline composition components must be rendered inside Timeline.Provider');
  }
  return context;
}

function TimelineProvider({
  value,
  children,
}: {
  value: TimelineCompositionContextValue;
  children: React.ReactNode;
}) {
  return (
    <TimelineCompositionContext value={value}>
      {children}
    </TimelineCompositionContext>
  );
}

function TimelineEditControls() {
  const timeline = useTimelineComposition();

  return (
    <div className="flex items-center gap-2">
      <TrackManager />

      <div className="w-px h-5 bg-[var(--glass-border)]" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-cut-mode-toggle
            aria-pressed={timeline.splitMode}
            aria-label="Toggle cut mode"
            onClick={timeline.onToggleCutMode}
            className={`glass-btn h-8 w-8 timeline-cut-toggle ${timeline.splitMode ? 'timeline-cut-toggle--active' : ''}`}
          >
            <Scissors className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="flex items-center gap-2">
            <span className="text-xs">Cut Mode</span>
            <kbd className="kbd text-[10px] px-1.5 py-0.5">C</kbd>
          </div>
        </TooltipContent>
      </Tooltip>

      <TimelineSpeedControl />

      {timeline.onResetTrimSegments && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={timeline.onResetTrimSegments}
              aria-label="Reset trim segments"
              className="glass-btn h-8 w-8"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="text-xs">Reset Trims</span>
          </TooltipContent>
        </Tooltip>
      )}

      <TimelineIOControls />
    </div>
  );
}

function TimelineSpeedControl() {
  const timeline = useTimelineComposition();

  return (
    <div ref={timeline.speedControlRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Set selected segment speed"
            aria-expanded={timeline.isSpeedPopoverOpen}
            aria-disabled={!timeline.canSetSelectedTrimSegmentSpeed}
            onClick={timeline.onToggleSpeedPopover}
            className={`glass-btn h-8 w-8 ${!timeline.canSetSelectedTrimSegmentSpeed ? 'opacity-40 cursor-not-allowed' : ''} ${timeline.isSpeedPopoverOpen ? 'active' : ''}`}
          >
            <Gauge className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="text-xs">Segment Speed</span>
        </TooltipContent>
      </Tooltip>

      {timeline.isSpeedPopoverOpen && timeline.selectedTrimSegmentSpeed !== null && (
        <div
          className="timeline-speed-popover absolute left-0 top-10 z-[90] w-56 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-solid)] p-3 text-[11px] text-[var(--ink-dark)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">Speed</span>
            <span className="font-mono text-[var(--accent-400)]">
              {timeline.selectedTrimSegmentSpeed.toFixed(0)}x
            </span>
          </div>
          <input
            aria-label="Segment speed"
            className="timeline-speed-slider w-full"
            type="range"
            min={MIN_TRIM_SEGMENT_SPEED}
            max={MAX_TRIM_SEGMENT_SPEED}
            step="1"
            value={timeline.selectedTrimSegmentSpeed}
            onChange={timeline.onSpeedInput}
          />
        </div>
      )}
    </div>
  );
}

function TimelineIOControls() {
  const timeline = useTimelineComposition();
  if (!timeline.onSetInPoint && !timeline.onSetOutPoint) {
    return null;
  }

  const activeInStyle = timeline.exportInPointMs !== null
    ? {
        color: IO_MARKER_TOOLTIP_TEXT,
        backgroundColor: 'var(--accent-subtle)',
        borderColor: IO_MARKER_TOOLTIP_BORDER,
      }
    : undefined;
  const activeOutStyle = timeline.exportOutPointMs !== null
    ? {
        color: IO_MARKER_TOOLTIP_TEXT,
        backgroundColor: 'var(--accent-subtle)',
        borderColor: IO_MARKER_TOOLTIP_BORDER,
      }
    : undefined;

  return (
    <>
      <div className="w-px h-5 bg-[var(--glass-border)]" />

      {timeline.onSetInPoint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={timeline.onSetInPoint}
              aria-label="Set in point"
              className="glass-btn h-8 w-8 flex items-center justify-center text-[11px] font-semibold leading-none"
              style={activeInStyle}
            >
              I
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Set In Point</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">I</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {timeline.onSetOutPoint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={timeline.onSetOutPoint}
              aria-label="Set out point"
              className="glass-btn h-8 w-8 flex items-center justify-center text-[11px] font-semibold leading-none"
              style={activeOutStyle}
            >
              O
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Set Out Point</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">O</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {timeline.onClearExportRange && (timeline.exportInPointMs !== null || timeline.exportOutPointMs !== null) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={timeline.onClearExportRange}
              aria-label="Clear export range"
              className="glass-btn h-8 w-8"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="text-xs">Clear IO Range</span>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

function TimelineTransportControls() {
  const timeline = useTimelineComposition();

  return (
    <div className="flex-1 flex items-center justify-center gap-1">
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onGoToStart} aria-label="Go to start" className="glass-btn h-8 w-8">
              <SkipBack className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Go to Start</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Home</kbd>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onSkipBack} aria-label="Skip back 1 second" className="glass-btn h-8 w-8">
              <SkipBack className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Skip Back 1s</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Left</kbd>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={timeline.onTogglePlayback}
              aria-label={timeline.isPlaying ? 'Pause' : 'Play'}
              className="tool-button h-9 w-9 active"
            >
              {timeline.isPlaying ? (
                <Pause className="w-4 h-4 relative z-10" />
              ) : (
                <Play className="w-4 h-4 ml-0.5 relative z-10" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">{timeline.isPlaying ? 'Pause' : 'Play'}</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Space</kbd>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={timeline.onReplayIO}
              aria-label={timeline.isIOLoopEnabled ? 'Disable IO loop' : 'Enable IO loop'}
              aria-pressed={timeline.isIOLoopEnabled}
              aria-disabled={!timeline.canReplayIO}
              data-io-loop-active={timeline.isIOLoopEnabled ? 'true' : undefined}
              className={`glass-btn h-8 w-8 timeline-io-loop-toggle ${!timeline.canReplayIO ? 'opacity-40 cursor-not-allowed' : ''} ${timeline.isIOLoopEnabled ? 'timeline-io-loop-toggle--active' : ''}`}
            >
              <Repeat2 className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="text-xs">{timeline.isIOLoopEnabled ? 'Disable IO Loop' : 'Loop IO Range'}</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onSkipForward} aria-label="Skip forward 1 second" className="glass-btn h-8 w-8">
              <SkipForward className="w-3 h-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Skip Forward 1s</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Right</kbd>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onGoToEnd} aria-label="Go to end" className="glass-btn h-8 w-8">
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Go to End</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">End</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      <TimeDisplay durationMs={timeline.effectiveDurationMs} />
    </div>
  );
}

function TimelineZoomControls() {
  const timeline = useTimelineComposition();

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onZoomOut} aria-label="Zoom out timeline" className="glass-btn h-7 w-7">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Zoom Out Timeline</p>
          </TooltipContent>
        </Tooltip>

        <span className="text-[10px] text-[var(--ink-subtle)] font-mono w-12 text-center">
          {timeline.zoomPercent}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onZoomIn} aria-label="Zoom in timeline" className="glass-btn h-7 w-7">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Zoom In Timeline</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={timeline.onFitTimelineToWindow} aria-label="Fit timeline to window" className="glass-btn h-7 w-7">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <span className="text-xs">Fit Timeline to Window</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Z</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function TimelineToolbar() {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center h-11 px-3 bg-[var(--glass-surface-dark)] border-b border-[var(--glass-border)]">
        <TimelineEditControls />
        <TimelineTransportControls />
        <TimelineZoomControls />
      </div>
    </TooltipProvider>
  );
}
function TrackLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
      <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
    </div>
  );
}

function TimelineTrackLabels() {
  const timeline = useTimelineComposition();

  return (
    <div className="flex-shrink-0 w-20 bg-[var(--polar-mist)] border-r border-[var(--glass-border)] z-20">
      <div className="h-8 border-b border-[var(--glass-border)]" />

      {timeline.hasVideoTrack && <TrackLabel icon={<Film className="w-3.5 h-3.5" />} label="Video" />}
      {timeline.hasTextTrack && <TrackLabel icon={<Type className="w-3.5 h-3.5" />} label="Text" />}
      {timeline.hasAnnotationTrack && <TrackLabel icon={<Highlighter className="w-3.5 h-3.5" />} label="Annotate" />}
      {timeline.hasZoomTrack && <TrackLabel icon={<ZoomIn className="w-3.5 h-3.5" />} label="Zoom" />}
      {timeline.hasSceneTrack && <TrackLabel icon={<Video className="w-3.5 h-3.5" />} label="Scene" />}
      {timeline.hasMaskTrack && <TrackLabel icon={<EyeOff className="w-3.5 h-3.5" />} label="Mask" />}
    </div>
  );
}

function VideoTrackSection() {
  const timeline = useTimelineComposition();
  const project = timeline.project;
  if (!timeline.hasVideoTrack || !project) return null;

  return (
    <TrimTrackContent
      segments={project.timeline.segments}
      durationMs={timeline.sourceDurationMs}
      timelineZoom={timeline.timelineZoom}
      width={timeline.timelineWidth}
      isCutMode={timeline.splitMode}
      tooltipPlacement={timeline.lastVisibleTrack === 'video' ? 'above' : 'below'}
      audioPath={
        project.sources.systemAudio ??
        project.sources.microphoneAudio ??
        project.sources.screenVideo ??
        undefined
      }
    />
  );
}

function TextTrackSection() {
  const timeline = useTimelineComposition();
  const project = timeline.project;
  if (!timeline.hasTextTrack || !project) return null;

  return (
    <TextTrackContent
      segments={project.text.segments}
      durationMs={timeline.effectiveDurationMs}
      timelineZoom={timeline.timelineZoom}
      width={timeline.timelineWidth}
      tooltipPlacement={timeline.lastVisibleTrack === 'text' ? 'above' : 'below'}
    />
  );
}

function AnnotationTrackSection() {
  const timeline = useTimelineComposition();
  const project = timeline.project;
  if (!timeline.hasAnnotationTrack || !project) return null;

  return (
    <AnnotationTrackContent
      segments={project.annotations?.segments ?? []}
      durationMs={timeline.effectiveDurationMs}
      timelineZoom={timeline.timelineZoom}
      width={timeline.timelineWidth}
      tooltipPlacement={timeline.lastVisibleTrack === 'annotation' ? 'above' : 'below'}
    />
  );
}

function ZoomTrackSection() {
  const timeline = useTimelineComposition();
  const project = timeline.project;
  if (!timeline.hasZoomTrack || !project) return null;

  return (
    <ZoomTrackContent
      regions={project.zoom.regions}
      durationMs={timeline.effectiveDurationMs}
      timelineZoom={timeline.timelineZoom}
      width={timeline.timelineWidth}
      tooltipPlacement={timeline.lastVisibleTrack === 'zoom' ? 'above' : 'below'}
    />
  );
}

function SceneTrackSection() {
  const timeline = useTimelineComposition();
  const project = timeline.project;
  if (!timeline.hasSceneTrack || !project) return null;

  return (
    <SceneTrackContent
      segments={project.scene.segments}
      defaultMode={project.scene.defaultMode}
      durationMs={timeline.effectiveDurationMs}
      timelineZoom={timeline.timelineZoom}
      width={timeline.timelineWidth}
      tooltipPlacement={timeline.lastVisibleTrack === 'scene' ? 'above' : 'below'}
    />
  );
}

function MaskTrackSection() {
  const timeline = useTimelineComposition();
  const project = timeline.project;
  if (!timeline.hasMaskTrack || !project) return null;

  return (
    <MaskTrackContent
      segments={project.mask.segments}
      durationMs={timeline.effectiveDurationMs}
      timelineZoom={timeline.timelineZoom}
      width={timeline.timelineWidth}
      tooltipPlacement={timeline.lastVisibleTrack === 'mask' ? 'above' : 'below'}
    />
  );
}

function TimelineTracks() {
  const timeline = useTimelineComposition();

  return (
    <>
      <TimelineRuler
        durationMs={timeline.effectiveDurationMs}
        timelineZoom={timeline.timelineZoom}
        width={timeline.timelineWidth}
        onMouseDown={timeline.onRulerMouseDown}
      />

      <VideoTrackSection />
      <TextTrackSection />
      <AnnotationTrackSection />
      <ZoomTrackSection />
      <SceneTrackSection />
      <MaskTrackSection />
    </>
  );
}

function TimelineMarkers() {
  const timeline = useTimelineComposition();

  return (
    <>
      {(timeline.exportInPointMs !== null || timeline.exportOutPointMs !== null) && (
        <IORangeBar
          inPointMs={timeline.exportInPointMs}
          outPointMs={timeline.exportOutPointMs}
          effectiveDurationMs={timeline.effectiveDurationMs}
          timelineZoom={timeline.timelineZoom}
        />
      )}

      {timeline.exportInPointMs !== null && (
        <IOMarker
          timeMs={timeline.exportInPointMs}
          label="I"
          timelineZoom={timeline.timelineZoom}
          width={timeline.timelineWidth}
          isDragging={timeline.draggingIOMarker === 'in'}
          onMouseDown={(event) => timeline.onIOMarkerMouseDown('in', event)}
        />
      )}
      {timeline.exportOutPointMs !== null && (
        <IOMarker
          timeMs={timeline.exportOutPointMs}
          label="O"
          timelineZoom={timeline.timelineZoom}
          width={timeline.timelineWidth}
          isDragging={timeline.draggingIOMarker === 'out'}
          onMouseDown={(event) => timeline.onIOMarkerMouseDown('out', event)}
        />
      )}

      {!timeline.isPlaying && timeline.draggingIOMarker === null && timeline.previewTimeMs !== null && (
        <PreviewScrubber
          previewTimeMs={timeline.previewTimeMs}
          timelineZoom={timeline.timelineZoom}
          trackLabelWidth={0}
          isCutMode={timeline.splitMode}
          width={timeline.timelineWidth}
        />
      )}

      <Playhead
        timelineZoom={timeline.timelineZoom}
        trackLabelWidth={0}
        width={timeline.timelineWidth}
        visible={timeline.shouldShowPrimaryPlayhead}
        isDragging={timeline.isDraggingPlayhead}
        onMouseDown={timeline.onPlayheadMouseDown}
      />

      {!timeline.isPlaying && timeline.draggingIOMarker === null && timeline.previewTimeMs !== null && (
        <TimelineTimeLabel
          timeMs={timeline.previewTimeMs}
          timelineZoom={timeline.timelineZoom}
          width={timeline.timelineWidth}
          lineWidthPx={timeline.splitMode ? CUT_PREVIEW_LINE_WIDTH_PX : TIMELINE_MARKER_LINE_WIDTH_PX}
        />
      )}
      {timeline.isDraggingPlayhead && (
        <PlayheadTimeLabel
          timelineZoom={timeline.timelineZoom}
          width={timeline.timelineWidth}
        />
      )}
    </>
  );
}

function TimelineContent() {
  const timeline = useTimelineComposition();

  return (
    <div
      ref={timeline.scrollRef}
      className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden ${timeline.splitMode ? 'timeline-cut-cursor' : ''}`}
      onScroll={timeline.onScroll}
      onMouseMove={timeline.onTimelineMouseMove}
      onMouseLeave={timeline.onTimelineMouseLeave}
    >
      <div
        className="relative"
        style={{ width: `${timeline.timelineWidth}px` }}
        onClickCapture={timeline.onTimelineCutClickCapture}
        onClick={timeline.onTimelineClick}
      >
        <TimelineTracks />
        <TimelineMarkers />
      </div>
    </div>
  );
}

function TimelineFrame() {
  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      <Timeline.TrackLabels />
      <Timeline.Content />
    </div>
  );
}

export const Timeline = {
  Provider: TimelineProvider,
  Toolbar: TimelineToolbar,
  Frame: TimelineFrame,
  TrackLabels: TimelineTrackLabels,
  Content: TimelineContent,
  Tracks: TimelineTracks,
  Markers: TimelineMarkers,
};
