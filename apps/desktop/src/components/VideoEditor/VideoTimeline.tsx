import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { TIMING } from '@/constants';
import {
  Film,
  Download,
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
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useVideoEditorStore,
  formatTimeSimple,
  getEffectiveDuration,
  TRACK_LABEL_WIDTH,
  getFitZoom,
  DEFAULT_FULL_SEGMENT_ID,
  MIN_TRIM_SEGMENT_SPEED,
  MAX_TRIM_SEGMENT_SPEED,
} from '../../stores/videoEditorStore';
import {
  selectExportInPointMs,
  selectExportOutPointMs,
  selectFitTimelineToWindow,
  selectIsDraggingPlayhead,
  selectIsIOLoopEnabled,
  selectIsPlaying,
  selectPreviewTimeMs,
  selectProject,
  selectSetIsPlaying,
  selectSplitAtTimelineTime,
  selectSplitMode,
  selectSetDraggingPlayhead,
  selectSetIOLoopEnabled,
  selectSetExportInPoint,
  selectSetExportOutPoint,
  selectSetPreviewTime,
  selectSetSplitMode,
  selectSetTimelineContainerWidth,
  selectSetTimelineScrollLeft,
  selectSetTimelineZoom,
  selectSelectedTrimSegmentId,
  selectTimelineZoom,
  selectTogglePlayback,
  selectTrackVisibility,
  selectUpdateTrimSegmentSpeed,
} from '../../stores/videoEditor/selectors';
import { usePlaybackTime, usePlaybackControls, getPlaybackState } from '../../hooks/usePlaybackEngine';
import { usePlaybackTimeThrottled } from '../../hooks/usePlaybackTimeThrottled';
import { getVideoPrimaryActionLabel } from '../../utils/videoExportMode';
import { TimelineRuler } from './TimelineRuler';
import { ZoomTrackContent, AnnotationTrackContent, SceneTrackContent, MaskTrackContent, TextTrackContent, TrimTrackContent } from './tracks';
import { TrackManager } from './TrackManager';

function quantizeTimeMs(timeMs: number, stepMs: number): number {
  if (stepMs <= 1) return timeMs;
  return Math.round(timeMs / stepMs) * stepMs;
}

const IO_MARKER_LINE_COLOR = 'var(--coral-300, #FDA4A0)';
const IO_MARKER_HANDLE_BG = 'linear-gradient(135deg, var(--coral-400) 0%, var(--coral-500) 100%)';
const IO_MARKER_TOOLTIP_BG = 'var(--glass-bg-solid)';
const IO_MARKER_TOOLTIP_BORDER = 'var(--coral-400, #F97066)';
const IO_MARKER_TOOLTIP_TEXT = 'var(--coral-300, #FDA4A0)';
const PLAYHEAD_COLOR = 'var(--warning, #F59E0B)';
const PLAYHEAD_GLOW = 'rgba(245, 158, 11, 0.35)';
const PLAYHEAD_BORDER = 'rgba(245, 158, 11, 0.55)';
const CUT_SCRUBBER_COLOR = 'var(--coral-500, #F04438)';
const HOVER_PREVIEW_MIN_POINTER_DELTA_PX = 2;
const HOVER_PREVIEW_RESUME_AFTER_RESIZE_MS = TIMING.RESIZE_DEBOUNCE_MS * 2;
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

interface VideoTimelineProps {
  onExport: () => void;
  onResetTrimSegments?: () => void;
  onSetInPoint?: () => void;
  onSetOutPoint?: () => void;
  onClearExportRange?: () => void;
}

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
          boxShadow: `0 10px 15px -3px ${PLAYHEAD_GLOW}`,
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
        background: 'linear-gradient(90deg, var(--coral-400) 0%, var(--coral-500) 100%)',
        filter: 'drop-shadow(0 0 3px rgba(249, 112, 102, 0.35))',
      }}
    />
  );
});

/**
 * VideoTimeline - Main timeline component with ruler, tracks, and playhead.
 * Optimized to prevent re-renders during playback.
 */
export function VideoTimeline({ onExport, onResetTrimSegments, onSetInPoint, onSetOutPoint, onClearExportRange }: VideoTimelineProps) {
  const project = useVideoEditorStore(selectProject);
  const timelineZoom = useVideoEditorStore(selectTimelineZoom);
  const isDraggingPlayhead = useVideoEditorStore(selectIsDraggingPlayhead);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const splitMode = useVideoEditorStore(selectSplitMode);
  const selectedTrimSegmentId = useVideoEditorStore(selectSelectedTrimSegmentId);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const trackVisibility = useVideoEditorStore(selectTrackVisibility);
  const exportInPointMs = useVideoEditorStore(selectExportInPointMs);
  const exportOutPointMs = useVideoEditorStore(selectExportOutPointMs);
  const splitAtTimelineTime = useVideoEditorStore(selectSplitAtTimelineTime);
  const setTimelineScrollLeft = useVideoEditorStore(selectSetTimelineScrollLeft);
  const setTimelineContainerWidth = useVideoEditorStore(selectSetTimelineContainerWidth);
  const setDraggingPlayhead = useVideoEditorStore(selectSetDraggingPlayhead);
  const setTimelineZoom = useVideoEditorStore(selectSetTimelineZoom);
  const updateTrimSegmentSpeed = useVideoEditorStore(selectUpdateTrimSegmentSpeed);
  const setPreviewTime = useVideoEditorStore(selectSetPreviewTime);
  const setSplitMode = useVideoEditorStore(selectSetSplitMode);
  const setIsPlaying = useVideoEditorStore(selectSetIsPlaying);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);
  const fitTimelineToWindow = useVideoEditorStore(selectFitTimelineToWindow);
  const setExportInPoint = useVideoEditorStore(selectSetExportInPoint);
  const setExportOutPoint = useVideoEditorStore(selectSetExportOutPoint);
  const exportActionLabel = getVideoPrimaryActionLabel(project);

  const [draggingIOMarker, setDraggingIOMarker] = useState<'in' | 'out' | null>(null);
  const [isSpeedPopoverOpen, setIsSpeedPopoverOpen] = useState(false);
  const isIOLoopEnabled = useVideoEditorStore(selectIsIOLoopEnabled);

  const controls = usePlaybackControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speedControlRef = useRef<HTMLDivElement>(null);
  const suppressNextClickRef = useRef(false);
  const previewRafRef = useRef<number | null>(null);
  const pendingPreviewTimeRef = useRef<number | null>(null);
  const lastPreviewTimeRef = useRef<number | null>(null);
  const lastHoverPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoverPreviewResumeAtRef = useRef<number>(performance.now() + HOVER_PREVIEW_RESUME_AFTER_RESIZE_MS);
  const hasMeasuredTimelineRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const setIOLoopEnabled = useVideoEditorStore(selectSetIOLoopEnabled);

  // Measure container width and sync to store (debounced to avoid resize lag)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const updateWidth = (width: number) => {
      setContainerWidth(width);
      setTimelineContainerWidth(width);
      hoverPreviewResumeAtRef.current = performance.now() + HOVER_PREVIEW_RESUME_AFTER_RESIZE_MS;
      if (hasMeasuredTimelineRef.current) {
        pendingPreviewTimeRef.current = null;
        lastPreviewTimeRef.current = null;
        lastHoverPointerRef.current = null;
        if (useVideoEditorStore.getState().previewTimeMs !== null) {
          setPreviewTime(null);
        }
      } else {
        hasMeasuredTimelineRef.current = true;
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => updateWidth(width), TIMING.RESIZE_DEBOUNCE_MS);
      }
    });

    observer.observe(container);
    // Set initial width without debounce
    const initialWidth = container.clientWidth;
    updateWidth(initialWidth);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [setPreviewTime, setTimelineContainerWidth]);

  // Fit timeline to window when project loads and container is measured
  const projectId = project?.id;
  const hasContainerWidth = containerWidth > 0;
  useEffect(() => {
    if (projectId && hasContainerWidth) {
      fitTimelineToWindow();
    }
  }, [projectId, hasContainerWidth, fitTimelineToWindow]);

  // Clear preview time when playback starts
  useEffect(() => {
    if (isPlaying) {
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
        previewRafRef.current = null;
      }
      pendingPreviewTimeRef.current = null;
      lastPreviewTimeRef.current = null;
      setPreviewTime(null);
    }
  }, [isPlaying, setPreviewTime]);

  useEffect(() => {
    if (!isSpeedPopoverOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (speedControlRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsSpeedPopoverOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSpeedPopoverOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSpeedPopoverOpen]);

  useEffect(() => {
    return () => {
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
      }
    };
  }, []);

  // Calculate timeline dimensions - extend to fill container width at minimum
  // sourceDurationMs is the original video duration (needed for TrimTrack segment boundaries)
  // effectiveDurationMs is the timeline duration after cuts (used for UI constraints)
  const sourceDurationMs = project?.timeline.durationMs ?? 60000;
  const segments = project?.timeline.segments;
  const selectedTrimSegment = segments?.find((segment) => segment.id === selectedTrimSegmentId) ?? null;
  const isDefaultFullSegmentSelected = selectedTrimSegmentId === DEFAULT_FULL_SEGMENT_ID && (!segments || segments.length === 0);
  const selectedTrimSegmentSpeed = selectedTrimSegment?.speed ?? (isDefaultFullSegmentSelected ? 1 : null);
  const canSetSelectedTrimSegmentSpeed = selectedTrimSegmentSpeed !== null && !splitMode;
  const effectiveDurationMs = getEffectiveDuration(segments ?? [], sourceDurationMs);
  const durationWidth = effectiveDurationMs * timelineZoom;
  const timelineWidth = Math.max(durationWidth, containerWidth - TRACK_LABEL_WIDTH);
  const hasVideoTrack = trackVisibility.video;
  const hasTextTrack = !!project && trackVisibility.text;
  const hasAnnotationTrack = !!project && trackVisibility.annotation;
  const hasZoomTrack = !!project && trackVisibility.zoom;
  const hasSceneTrack = !!project && !!project.sources.webcamVideo && trackVisibility.scene;
  const hasMaskTrack = !!project && trackVisibility.mask;
  const shouldShowPrimaryPlayhead = draggingIOMarker === null && (!splitMode || previewTimeMs === null || isDraggingPlayhead);
  const lastVisibleTrack =
    ([
      hasVideoTrack ? 'video' : null,
      hasTextTrack ? 'text' : null,
      hasAnnotationTrack ? 'annotation' : null,
      hasZoomTrack ? 'zoom' : null,
      hasSceneTrack ? 'scene' : null,
      hasMaskTrack ? 'mask' : null,
    ].filter(Boolean).at(-1) ?? null) as 'video' | 'text' | 'annotation' | 'zoom' | 'scene' | 'mask' | null;

  useEffect(() => {
    if (!canSetSelectedTrimSegmentSpeed) {
      setIsSpeedPopoverOpen(false);
    }
  }, [canSetSelectedTrimSegmentSpeed]);

  // Zoom % relative to fit-to-window (100% = timeline fills viewport)
  const fitZoom = getFitZoom(project, containerWidth);
  const zoomPercent = fitZoom ? Math.round((timelineZoom / fitZoom) * 100) : 100;

  const getTimelineClickTimeMs = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return quantizeTimeMs(
      Math.max(0, Math.min(effectiveDurationMs, x / timelineZoom)),
      TIMING.SCRUB_SEEK_STEP_MS
    );
  }, [effectiveDurationMs, timelineZoom]);

  // Capture clicks first in cut mode so segment click handlers do not swallow them.
  const handleTimelineCutClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!splitMode) return;

    // Skip cut if an IO marker drag just finished (mouseup fires click)
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.stopPropagation();
      return;
    }

    const target = e.target as HTMLElement;
    if (target.closest('[data-timeline-control]')) {
      return;
    }

    // Only cut when clicking in the trim track/segments.
    if (!target.closest('[data-trim-track]') && !target.closest('[data-trim-segment]')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    splitAtTimelineTime(getTimelineClickTimeMs(e));
  }, [getTimelineClickTimeMs, splitAtTimelineTime, splitMode]);

  // Handle clicking on timeline to seek (event is on content div which moves with scroll)
  // Keep any selected segments - user can click empty track area to deselect
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Skip seek if an IO marker drag just finished (mouseup fires click)
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (splitMode) {
      return;
    }
    controls.seek(getTimelineClickTimeMs(e));
  }, [controls, getTimelineClickTimeMs, splitMode]);

  // Handle mouse move for preview scrubber (on scroll container to catch moves outside content)
  const handleTimelineMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isPlaying || isDraggingPlayhead || draggingIOMarker !== null) {
      if (useVideoEditorStore.getState().previewTimeMs !== null) {
        setPreviewTime(null);
      }
      return;
    }

    if (performance.now() < hoverPreviewResumeAtRef.current) {
      return;
    }

    const pointer = { x: e.clientX, y: e.clientY };
    const lastPointer = lastHoverPointerRef.current;
    lastHoverPointerRef.current = pointer;
    const nativeEvent = e.nativeEvent as MouseEvent;
    const movementMagnitude = Math.max(
      Math.abs(nativeEvent.movementX ?? 0),
      Math.abs(nativeEvent.movementY ?? 0)
    );

    // Ignore the first hover event and any zero-delta event caused by the
    // timeline mounting underneath a stationary pointer. Those synthetic hover
    // updates were triggering expensive seeks during editor startup.
    if (
      lastPointer === null ||
      (
        movementMagnitude < HOVER_PREVIEW_MIN_POINTER_DELTA_PX &&
        Math.abs(lastPointer.x - pointer.x) < HOVER_PREVIEW_MIN_POINTER_DELTA_PX &&
        Math.abs(lastPointer.y - pointer.y) < HOVER_PREVIEW_MIN_POINTER_DELTA_PX
      )
    ) {
      return;
    }

    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();
    const scrollLeft = scrollContainer.scrollLeft;
    // Calculate x position relative to timeline content (account for scroll)
    const x = e.clientX - rect.left + scrollLeft;
    // Clamp to valid range (0 to effectiveDurationMs) - don't hide when outside bounds
    const timeMs = quantizeTimeMs(
      Math.max(0, Math.min(effectiveDurationMs, x / timelineZoom)),
      TIMING.SCRUB_PREVIEW_STEP_MS
    );
    pendingPreviewTimeRef.current = timeMs;

    if (previewRafRef.current === null) {
      previewRafRef.current = requestAnimationFrame(() => {
        previewRafRef.current = null;
        const nextPreviewTimeMs = pendingPreviewTimeRef.current;
        if (nextPreviewTimeMs === null || nextPreviewTimeMs === lastPreviewTimeRef.current) {
          return;
        }
        lastPreviewTimeRef.current = nextPreviewTimeMs;
        setPreviewTime(nextPreviewTimeMs);
      });
    }
  }, [isPlaying, isDraggingPlayhead, draggingIOMarker, effectiveDurationMs, timelineZoom, setPreviewTime]);

  // Clear preview on mouse leave (only when leaving the scroll container entirely)
  const handleTimelineMouseLeave = useCallback(() => {
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    pendingPreviewTimeRef.current = null;
    lastPreviewTimeRef.current = null;
    lastHoverPointerRef.current = null;
    setPreviewTime(null);
  }, [setPreviewTime]);

  // Handle dragging on the ruler to scrub playhead position continuously.
  const handleRulerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-timeline-control]')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (isPlaying) {
      setIsPlaying(false);
    }
    setDraggingPlayhead(true);
    setPreviewTime(null);

    let dragRafId: number | null = null;
    let pendingSeekTime: number | null = null;
    let lastSeekTime: number | null = null;

    const getTimeFromClientX = (clientX: number): number | null => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return null;

      const rect = scrollContainer.getBoundingClientRect();
      const scrollLeft = scrollContainer.scrollLeft;
      const x = clientX - rect.left + scrollLeft;
      return quantizeTimeMs(
        Math.max(0, Math.min(effectiveDurationMs, x / timelineZoom)),
        TIMING.SCRUB_SEEK_STEP_MS
      );
    };

    const flushSeek = () => {
      if (pendingSeekTime === null || pendingSeekTime === lastSeekTime) {
        return;
      }
      lastSeekTime = pendingSeekTime;
      controls.seek(pendingSeekTime);
    };

    const initialSeekTime = getTimeFromClientX(e.clientX);
    if (initialSeekTime !== null) {
      pendingSeekTime = initialSeekTime;
      flushSeek();
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pendingSeekTime = getTimeFromClientX(moveEvent.clientX);

      if (dragRafId === null) {
        dragRafId = requestAnimationFrame(() => {
          dragRafId = null;
          flushSeek();
        });
      }
    };

    const handleMouseUp = () => {
      if (dragRafId !== null) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      flushSeek();
      setDraggingPlayhead(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [effectiveDurationMs, timelineZoom, controls, isPlaying, setDraggingPlayhead, setIsPlaying, setPreviewTime]);

  // Handle playhead dragging (content area, account for label column offset)
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingPlayhead(true);
    let dragRafId: number | null = null;
    let pendingSeekTime: number | null = null;
    let lastSeekTime: number | null = null;

    const flushSeek = () => {
      if (pendingSeekTime === null || pendingSeekTime === lastSeekTime) {
        return;
      }
      lastSeekTime = pendingSeekTime;
      controls.seek(pendingSeekTime);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;

      const rect = scrollContainer.getBoundingClientRect();
      const scrollLeft = scrollContainer.scrollLeft;
      const x = moveEvent.clientX - rect.left + scrollLeft;
      pendingSeekTime = quantizeTimeMs(
        Math.max(0, Math.min(effectiveDurationMs, x / timelineZoom)),
        TIMING.SCRUB_SEEK_STEP_MS
      );

      if (dragRafId === null) {
        dragRafId = requestAnimationFrame(() => {
          dragRafId = null;
          flushSeek();
        });
      }
    };

    const handleMouseUp = () => {
      if (dragRafId !== null) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      flushSeek();
      setDraggingPlayhead(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [effectiveDurationMs, timelineZoom, controls, setDraggingPlayhead]);

  // Handle IO marker dragging
  const handleIOMarkerMouseDown = useCallback((marker: 'in' | 'out', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPlaying) {
      setIsPlaying(false);
    }
    setDraggingIOMarker(marker);
    setDraggingPlayhead(true);
    pendingPreviewTimeRef.current = null;
    lastPreviewTimeRef.current = null;
    lastHoverPointerRef.current = null;
    if (useVideoEditorStore.getState().previewTimeMs !== null) {
      setPreviewTime(null);
    }

    let dragRafId: number | null = null;
    let pendingMarkerTime: number | null = null;
    let lastSeekTime: number | null = null;

    const applyMarkerTime = () => {
      if (pendingMarkerTime === null || pendingMarkerTime === lastSeekTime) {
        return;
      }

      lastSeekTime = pendingMarkerTime;
      if (marker === 'in') {
        setExportInPoint(pendingMarkerTime);
      } else {
        setExportOutPoint(pendingMarkerTime);
      }
      controls.seek(pendingMarkerTime);
    };

    const updateMarkerFromClientX = (clientX: number) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;

      const rect = scrollContainer.getBoundingClientRect();
      const scrollLeft = scrollContainer.scrollLeft;
      const x = clientX - rect.left + scrollLeft;
      const rawTimeMs = Math.max(0, Math.min(effectiveDurationMs, x / timelineZoom));

      // Read the latest marker positions from the store directly
      const { exportInPointMs: currentIn, exportOutPointMs: currentOut } = useVideoEditorStore.getState();

      if (marker === 'in') {
        // Clamp: can't go past the out point
        const maxMs = currentOut !== null ? currentOut - 1 : effectiveDurationMs;
        const clampedMs = Math.min(rawTimeMs, maxMs);
        pendingMarkerTime = Math.max(0, clampedMs);
      } else {
        // Clamp: can't go before the in point
        const minMs = currentIn !== null ? currentIn + 1 : 0;
        const clampedMs = Math.max(rawTimeMs, minMs);
        pendingMarkerTime = Math.min(effectiveDurationMs, clampedMs);
      }

      if (dragRafId === null) {
        dragRafId = requestAnimationFrame(() => {
          dragRafId = null;
          applyMarkerTime();
        });
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateMarkerFromClientX(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      if (dragRafId !== null) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      applyMarkerTime();
      setDraggingIOMarker(null);
      setDraggingPlayhead(false);
      // Suppress the click event that fires after mouseup to prevent playhead seek
      suppressNextClickRef.current = true;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [controls, effectiveDurationMs, isPlaying, setDraggingPlayhead, setExportInPoint, setExportOutPoint, setIsPlaying, setPreviewTime, timelineZoom]);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setTimelineScrollLeft(e.currentTarget.scrollLeft);
  }, [setTimelineScrollLeft]);

  const hasIORange = exportInPointMs !== null || exportOutPointMs !== null;
  const replayIOStartMs = exportInPointMs ?? 0;
  const replayIOEndMs = exportOutPointMs ?? effectiveDurationMs;
  const canReplayIO = hasIORange && replayIOEndMs > replayIOStartMs;
  const getCurrentIOLoopBounds = useCallback(() => {
    const state = useVideoEditorStore.getState();
    const projectDurationMs = state.project?.timeline.durationMs ?? sourceDurationMs;
    const projectSegments = state.project?.timeline.segments ?? [];
    const currentEffectiveDurationMs = getEffectiveDuration(projectSegments, projectDurationMs);
    const startMs = state.exportInPointMs ?? 0;
    const endMs = state.exportOutPointMs ?? currentEffectiveDurationMs;

    if (state.exportInPointMs === null && state.exportOutPointMs === null) {
      return null;
    }

    if (endMs <= startMs) {
      return null;
    }

    return { startMs, endMs };
  }, [sourceDurationMs]);

  // Playback controls
  const handleGoToStart = useCallback(() => {
    controls.seek(isIOLoopEnabled && canReplayIO ? replayIOStartMs : 0);
  }, [canReplayIO, controls, isIOLoopEnabled, replayIOStartMs]);

  const handleGoToEnd = useCallback(() => {
    controls.seek(isIOLoopEnabled && canReplayIO ? replayIOEndMs : effectiveDurationMs);
  }, [canReplayIO, controls, effectiveDurationMs, isIOLoopEnabled, replayIOEndMs]);

  const handleSkipBack = useCallback(() => {
    const { currentTimeMs } = getPlaybackState();
    const minTimeMs = isIOLoopEnabled && canReplayIO ? replayIOStartMs : 0;
    controls.seek(Math.max(minTimeMs, currentTimeMs - 1000));
  }, [canReplayIO, controls, isIOLoopEnabled, replayIOStartMs]);

  const handleSkipForward = useCallback(() => {
    const { currentTimeMs } = getPlaybackState();
    const maxTimeMs = isIOLoopEnabled && canReplayIO ? replayIOEndMs : effectiveDurationMs;
    controls.seek(Math.min(maxTimeMs, currentTimeMs + 1000));
  }, [canReplayIO, controls, effectiveDurationMs, isIOLoopEnabled, replayIOEndMs]);

  const handleTogglePlayback = useCallback(() => {
    togglePlayback();
  }, [togglePlayback]);

  const handleReplayIO = useCallback(() => {
    const loopBounds = getCurrentIOLoopBounds();
    if (!loopBounds) return;

    const nextEnabled = !isIOLoopEnabled;
    setIOLoopEnabled(nextEnabled);
    if (!nextEnabled) return;

    const { currentTimeMs, isPlaying: isCurrentlyPlaying } = useVideoEditorStore.getState();
    const isInsideLoopRange = currentTimeMs >= loopBounds.startMs && currentTimeMs < loopBounds.endMs;
    if (isCurrentlyPlaying && isInsideLoopRange) {
      return;
    }

    controls.seek(loopBounds.startMs);
    if (!isCurrentlyPlaying) {
      setIsPlaying(true);
    }
  }, [controls, getCurrentIOLoopBounds, isIOLoopEnabled, setIOLoopEnabled, setIsPlaying]);

  useEffect(() => {
    if (!getCurrentIOLoopBounds() && isIOLoopEnabled) {
      setIOLoopEnabled(false);
    }
  }, [getCurrentIOLoopBounds, isIOLoopEnabled, setIOLoopEnabled]);

  // Timeline zoom controls
  const handleZoomIn = useCallback(() => {
    setTimelineZoom(timelineZoom * 1.5);
  }, [timelineZoom, setTimelineZoom]);

  const handleZoomOut = useCallback(() => {
    setTimelineZoom(timelineZoom / 1.5);
  }, [timelineZoom, setTimelineZoom]);

  // Mouse wheel: horizontal scroll (default), Ctrl+scroll to zoom, Shift+scroll for vertical
  // Uses a ref so the listener doesn't re-attach on every zoom change
  const timelineZoomRef = useRef(timelineZoom);
  useEffect(() => { timelineZoomRef.current = timelineZoom; }, [timelineZoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const zoomFactor = 1.15;
        const current = timelineZoomRef.current;
        setTimelineZoom(e.deltaY < 0 ? current * zoomFactor : current / zoomFactor);
        return;
      }

      // Shift+scroll: let browser handle vertical scroll naturally
      if (e.shiftKey) return;

      // Default scroll: convert vertical to horizontal
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setTimelineZoom]);

  const handleToggleCutMode = useCallback(() => {
    setSplitMode(!splitMode);
  }, [setSplitMode, splitMode]);

  const handleToggleSpeedPopover = useCallback(() => {
    if (!canSetSelectedTrimSegmentSpeed) return;
    setIsSpeedPopoverOpen((isOpen) => !isOpen);
  }, [canSetSelectedTrimSegmentSpeed]);

  const handleSpeedInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrimSegmentId) return;
    updateTrimSegmentSpeed(selectedTrimSegmentId, Number(event.target.value));
  }, [selectedTrimSegmentId, updateTrimSegmentSpeed]);

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col bg-[var(--polar-ice)] border-t border-[var(--glass-border)]/50 select-none"
    >
      {/* Timeline Header with Controls */}
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center h-11 px-3 bg-[var(--glass-surface-dark)] border-b border-[var(--glass-border)]">
          {/* Left Section */}
          <div className="flex items-center gap-2">
            {/* Track Manager */}
            <TrackManager />

            {/* Scissors button - toggle cut mode */}
            <div className="w-px h-5 bg-[var(--glass-border)]" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-cut-mode-toggle
                  aria-pressed={splitMode}
                  aria-label="Toggle cut mode"
                  onClick={handleToggleCutMode}
                  className={`glass-btn h-8 w-8 timeline-cut-toggle ${splitMode ? 'timeline-cut-toggle--active' : ''}`}
                >
                  <Scissors className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span className="text-xs">Cut Mode</span>
                  <kbd className="kbd text-[10px] px-1.5 py-0.5">S</kbd>
                </div>
              </TooltipContent>
            </Tooltip>

            <div ref={speedControlRef} className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Set selected segment speed"
                    aria-expanded={isSpeedPopoverOpen}
                    aria-disabled={!canSetSelectedTrimSegmentSpeed}
                    onClick={handleToggleSpeedPopover}
                    className={`glass-btn h-8 w-8 ${!canSetSelectedTrimSegmentSpeed ? 'opacity-40 cursor-not-allowed' : ''} ${isSpeedPopoverOpen ? 'active' : ''}`}
                  >
                    <Gauge className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span className="text-xs">Segment Speed</span>
                </TooltipContent>
              </Tooltip>

              {isSpeedPopoverOpen && selectedTrimSegmentSpeed !== null && (
                <div
                  className="timeline-speed-popover absolute left-0 top-10 z-[90] w-56 rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-solid)] p-3 text-[11px] text-[var(--ink-dark)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">Speed</span>
                    <span className="font-mono text-[var(--coral-400)]">
                      {selectedTrimSegmentSpeed.toFixed(0)}x
                    </span>
                  </div>
                  <input
                    aria-label="Segment speed"
                    className="timeline-speed-slider w-full"
                    type="range"
                    min={MIN_TRIM_SEGMENT_SPEED}
                    max={MAX_TRIM_SEGMENT_SPEED}
                    step="1"
                    value={selectedTrimSegmentSpeed}
                    onChange={handleSpeedInput}
                  />
                </div>
              )}
            </div>

            {/* Reset button - restore full video */}
            {onResetTrimSegments && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onResetTrimSegments}
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

            {/* IO marker buttons */}
            {(onSetInPoint || onSetOutPoint) && (
              <>
                <div className="w-px h-5 bg-[var(--glass-border)]" />

                {onSetInPoint && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onSetInPoint}
                        aria-label="Set in point"
                        className="glass-btn h-8 w-8 flex items-center justify-center text-[11px] font-semibold leading-none"
                        style={exportInPointMs !== null
                          ? {
                              color: IO_MARKER_TOOLTIP_TEXT,
                              backgroundColor: 'var(--coral-subtle)',
                              borderColor: IO_MARKER_TOOLTIP_BORDER,
                            }
                          : undefined}
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

                {onSetOutPoint && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onSetOutPoint}
                        aria-label="Set out point"
                        className="glass-btn h-8 w-8 flex items-center justify-center text-[11px] font-semibold leading-none"
                        style={exportOutPointMs !== null
                          ? {
                              color: IO_MARKER_TOOLTIP_TEXT,
                              backgroundColor: 'var(--coral-subtle)',
                              borderColor: IO_MARKER_TOOLTIP_BORDER,
                            }
                          : undefined}
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

                {onClearExportRange && (exportInPointMs !== null || exportOutPointMs !== null) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onClearExportRange}
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
            )}
          </div>

          {/* Center Section - Playback Controls */}
          <div className="flex-1 flex items-center justify-center gap-1">
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleGoToStart} aria-label="Go to start" className="glass-btn h-8 w-8">
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
                  <button onClick={handleSkipBack} aria-label="Skip back 1 second" className="glass-btn h-8 w-8">
                    <SkipBack className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Skip Back 1s</span>
                    <kbd className="kbd text-[10px] px-1.5 py-0.5">←</kbd>
                  </div>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleTogglePlayback}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    className="tool-button h-9 w-9 active"
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4 relative z-10" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5 relative z-10" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{isPlaying ? 'Pause' : 'Play'}</span>
                    <kbd className="kbd text-[10px] px-1.5 py-0.5">Space</kbd>
                  </div>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleReplayIO}
                    aria-label={isIOLoopEnabled ? 'Disable IO loop' : 'Enable IO loop'}
                    aria-pressed={isIOLoopEnabled}
                    aria-disabled={!canReplayIO}
                    data-io-loop-active={isIOLoopEnabled ? 'true' : undefined}
                    className={`glass-btn h-8 w-8 timeline-io-loop-toggle ${!canReplayIO ? 'opacity-40 cursor-not-allowed' : ''} ${isIOLoopEnabled ? 'timeline-io-loop-toggle--active' : ''}`}
                  >
                    <Repeat2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span className="text-xs">{isIOLoopEnabled ? 'Disable IO Loop' : 'Loop IO Range'}</span>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleSkipForward} aria-label="Skip forward 1 second" className="glass-btn h-8 w-8">
                    <SkipForward className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Skip Forward 1s</span>
                    <kbd className="kbd text-[10px] px-1.5 py-0.5">→</kbd>
                  </div>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleGoToEnd} aria-label="Go to end" className="glass-btn h-8 w-8">
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

            <TimeDisplay durationMs={effectiveDurationMs} />
          </div>

          {/* Right Section */}
          <div className="flex items-center gap-2">
            {/* Timeline Zoom Controls */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleZoomOut} aria-label="Zoom out timeline" className="glass-btn h-7 w-7">
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Zoom Out Timeline</p>
                </TooltipContent>
              </Tooltip>

              <span className="text-[10px] text-[var(--ink-subtle)] font-mono w-12 text-center">
                {zoomPercent}%
              </span>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleZoomIn} aria-label="Zoom in timeline" className="glass-btn h-7 w-7">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Zoom In Timeline</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={fitTimelineToWindow} aria-label="Fit timeline to window" className="glass-btn h-7 w-7">
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

            <div className="w-px h-5 bg-[var(--glass-border)]" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onExport}
                  className="btn-coral h-8 px-3 rounded-md flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">{exportActionLabel}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span className="text-xs">{exportActionLabel}</span>
                  <kbd className="kbd text-[10px] px-1.5 py-0.5">Ctrl+E</kbd>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Two-Column Timeline Layout */}
      <div className="flex-1 flex min-h-0 min-w-0">
        {/* Fixed Track Labels Column */}
        <div className="flex-shrink-0 w-20 bg-[var(--polar-mist)] border-r border-[var(--glass-border)] z-20">
          {/* Ruler spacer */}
          <div className="h-8 border-b border-[var(--glass-border)]" />

          {/* Video label */}
          {hasVideoTrack && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Film className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Video</span>
              </div>
            </div>
          )}

          {/* Text label */}
          {hasTextTrack && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Type className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Text</span>
              </div>
            </div>
          )}

          {/* Annotation label */}
          {hasAnnotationTrack && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Highlighter className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Annotate</span>
              </div>
            </div>
          )}

          {/* Zoom label */}
          {hasZoomTrack && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Zoom</span>
              </div>
            </div>
          )}

          {/* Scene label */}
          {hasSceneTrack && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Video className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Scene</span>
              </div>
            </div>
          )}

          {/* Mask label */}
          {hasMaskTrack && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <EyeOff className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Mask</span>
              </div>
            </div>
          )}
        </div>

        {/* Scrollable Timeline Content */}
        <div
          ref={scrollRef}
          className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden ${splitMode ? 'timeline-cut-cursor' : ''}`}
          onScroll={handleScroll}
          onMouseMove={handleTimelineMouseMove}
          onMouseLeave={handleTimelineMouseLeave}
        >
          <div
            className="relative"
            style={{ width: `${timelineWidth}px` }}
            onClickCapture={handleTimelineCutClickCapture}
            onClick={handleTimelineClick}
          >
            {/* Time Ruler */}
            <TimelineRuler
              durationMs={effectiveDurationMs}
              timelineZoom={timelineZoom}
              width={timelineWidth}
              onMouseDown={handleRulerMouseDown}
            />

            {/* Video Track Content (Trim Segments) */}
            {hasVideoTrack && project && (
              <TrimTrackContent
                segments={project.timeline.segments}
                durationMs={sourceDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                isCutMode={splitMode}
                tooltipPlacement={lastVisibleTrack === 'video' ? 'above' : 'below'}
                audioPath={
                  project.sources.systemAudio ??
                  project.sources.microphoneAudio ??
                  project.sources.screenVideo ??
                  undefined
                }
              />
            )}

            {/* Text Track Content */}
            {hasTextTrack && project && (
              <TextTrackContent
                segments={project.text.segments}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                tooltipPlacement={lastVisibleTrack === 'text' ? 'above' : 'below'}
              />
            )}

            {/* Annotation Track Content */}
            {hasAnnotationTrack && project && (
              <AnnotationTrackContent
                segments={project.annotations?.segments ?? []}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                tooltipPlacement={lastVisibleTrack === 'annotation' ? 'above' : 'below'}
              />
            )}

            {/* Zoom Track Content */}
            {hasZoomTrack && project && (
              <ZoomTrackContent
                regions={project.zoom.regions}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                tooltipPlacement={lastVisibleTrack === 'zoom' ? 'above' : 'below'}
              />
            )}

            {/* Scene Track Content */}
            {hasSceneTrack && project && (
              <SceneTrackContent
                segments={project.scene.segments}
                defaultMode={project.scene.defaultMode}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                tooltipPlacement={lastVisibleTrack === 'scene' ? 'above' : 'below'}
              />
            )}

            {/* Mask Track Content */}
            {hasMaskTrack && project && (
              <MaskTrackContent
                segments={project.mask.segments}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                tooltipPlacement={lastVisibleTrack === 'mask' ? 'above' : 'below'}
              />
            )}

            {/* IO range bar - shown just above the ruler bottom edge */}
            {(exportInPointMs !== null || exportOutPointMs !== null) && (
              <IORangeBar
                inPointMs={exportInPointMs}
                outPointMs={exportOutPointMs}
                effectiveDurationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
              />
            )}

            {/* IO Markers */}
            {exportInPointMs !== null && (
              <IOMarker
                timeMs={exportInPointMs}
                label="I"
                timelineZoom={timelineZoom}
                width={timelineWidth}
                isDragging={draggingIOMarker === 'in'}
                onMouseDown={(e) => handleIOMarkerMouseDown('in', e)}
              />
            )}
            {exportOutPointMs !== null && (
              <IOMarker
                timeMs={exportOutPointMs}
                label="O"
                timelineZoom={timelineZoom}
                width={timelineWidth}
                isDragging={draggingIOMarker === 'out'}
                onMouseDown={(e) => handleIOMarkerMouseDown('out', e)}
              />
            )}

            {/* Preview Scrubber - only when not playing */}
            {!isPlaying && draggingIOMarker === null && previewTimeMs !== null && (
              <PreviewScrubber
                previewTimeMs={previewTimeMs}
                timelineZoom={timelineZoom}
                trackLabelWidth={0}
                isCutMode={splitMode}
                width={timelineWidth}
              />
            )}

            {/* Playhead */}
            <Playhead
              timelineZoom={timelineZoom}
              trackLabelWidth={0}
              width={timelineWidth}
              visible={shouldShowPrimaryPlayhead}
              isDragging={isDraggingPlayhead}
              onMouseDown={handlePlayheadMouseDown}
            />

            {/* Top-level time labels so controls cannot cover them */}
            {!isPlaying && draggingIOMarker === null && previewTimeMs !== null && (
              <TimelineTimeLabel
                timeMs={previewTimeMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                lineWidthPx={splitMode ? CUT_PREVIEW_LINE_WIDTH_PX : TIMELINE_MARKER_LINE_WIDTH_PX}
              />
            )}
            {isDraggingPlayhead && (
              <PlayheadTimeLabel
                timelineZoom={timelineZoom}
                width={timelineWidth}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
