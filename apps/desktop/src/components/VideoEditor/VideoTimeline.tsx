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
  Video,
  EyeOff,
  Scissors,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useVideoEditorStore, formatTimeSimple, getEffectiveDuration, TRACK_LABEL_WIDTH, getFitZoom } from '../../stores/videoEditorStore';
import {
  selectExportInPointMs,
  selectExportOutPointMs,
  selectFitTimelineToWindow,
  selectIsDraggingPlayhead,
  selectIsPlaying,
  selectPreviewTimeMs,
  selectProject,
  selectSetIsPlaying,
  selectSplitAtTimelineTime,
  selectSplitMode,
  selectSetDraggingPlayhead,
  selectSetExportInPoint,
  selectSetExportOutPoint,
  selectSetPreviewTime,
  selectSetSplitMode,
  selectSetTimelineContainerWidth,
  selectSetTimelineScrollLeft,
  selectSetTimelineZoom,
  selectTimelineZoom,
  selectTogglePlayback,
  selectTrackVisibility,
} from '../../stores/videoEditor/selectors';
import { usePlaybackTime, usePlaybackControls, getPlaybackState } from '../../hooks/usePlaybackEngine';
import { TimelineRuler } from './TimelineRuler';
import { ZoomTrackContent, SceneTrackContent, MaskTrackContent, TextTrackContent, TrimTrackContent } from './tracks';
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

/**
 * Preview scrubber - ghost playhead that follows mouse when not playing.
 */
const PreviewScrubber = memo(function PreviewScrubber({
  previewTimeMs,
  timelineZoom,
  trackLabelWidth,
  isCutMode,
}: {
  previewTimeMs: number;
  timelineZoom: number;
  trackLabelWidth: number;
  isCutMode: boolean;
}) {
  const position = previewTimeMs * timelineZoom + trackLabelWidth;
  const scrubberColor = isCutMode ? CUT_SCRUBBER_COLOR : 'var(--ink-muted)';

  return (
    <div
      data-preview-scrubber
      data-cut-mode={isCutMode}
      className="absolute top-0 bottom-0 w-0.5 z-20 pointer-events-none"
      style={{ left: `${position}px`, backgroundColor: scrubberColor }}
    >
      {/* Scrubber handle */}
      <div
        className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-4 rounded-b-sm"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)',
          backgroundColor: scrubberColor,
        }}
      />
      {/* Time tooltip */}
      <div
        className="absolute top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] rounded text-[10px] font-mono text-[var(--ink-dark)] whitespace-nowrap shadow-lg"
      >
        {formatTimeSimple(previewTimeMs)}
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
  const currentTimeMs = usePlaybackTime();

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
}: {
  timelineZoom: number;
  trackLabelWidth: number;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const currentTimeMs = usePlaybackTime();
  const playheadPosition = currentTimeMs * timelineZoom + trackLabelWidth;

  return (
    <div
      data-timeline-control
      className={`
        absolute top-0 bottom-0 w-0.5 z-30 pointer-events-auto
        ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
      `}
      style={{ 
        left: `${playheadPosition}px`,
        backgroundColor: PLAYHEAD_COLOR,
      }}
      onMouseDown={onMouseDown}
    >
      {/* Playhead handle */}
      <div 
        className={`
          absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-4 rounded-b-sm
          shadow-lg
          ${isDragging ? 'scale-110' : 'hover:scale-105'}
          transition-transform
        `}
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)',
          backgroundColor: PLAYHEAD_COLOR,
          boxShadow: `0 10px 15px -3px ${PLAYHEAD_GLOW}`,
        }}
      />
      
      {/* Time indicator (shown when dragging) */}
      {isDragging && (
        <PlayheadTimeIndicator />
      )}
    </div>
  );
});

/**
 * Separate component for the time indicator to minimize re-renders.
 */
const PlayheadTimeIndicator = memo(function PlayheadTimeIndicator() {
  const currentTimeMs = usePlaybackTime();
  
  return (
    <div 
      className="absolute top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-[var(--polar-ice)] rounded text-[10px] font-mono whitespace-nowrap shadow-lg"
      style={{ 
        borderColor: PLAYHEAD_BORDER,
        borderWidth: '1px',
        color: PLAYHEAD_COLOR,
      }}
    >
      {Math.floor(currentTimeMs / 60000)}:{String(Math.floor((currentTimeMs % 60000) / 1000)).padStart(2, '0')}
    </div>
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
}: {
  timeMs: number;
  label: 'I' | 'O';
  timelineZoom: number;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const position = timeMs * timelineZoom;

  return (
    <div
      className="absolute top-0 h-8 w-0.5 z-25 pointer-events-none"
      style={{
        left: `${position}px`,
        backgroundColor: IO_MARKER_LINE_COLOR,
      }}
    >
      {/* Draggable label handle */}
      <div
        data-timeline-control
        className={`absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-b-sm flex items-center justify-center text-[9px] font-bold text-white pointer-events-auto ${isDragging ? 'cursor-grabbing scale-110' : 'cursor-grab hover:scale-105'} transition-transform`}
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
          className="absolute top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap shadow-lg pointer-events-none"
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
 * IO Region Overlay - dims areas outside the IO range with a semi-transparent overlay.
 */
const IORegionOverlay = memo(function IORegionOverlay({
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
  const totalWidth = effectiveDurationMs * timelineZoom;

  return (
    <>
      {/* Dim region before in point */}
      {effectiveIn > 0 && (
        <div
          className="absolute top-0 bottom-0 z-15 pointer-events-none"
          style={{
            left: 0,
            width: `${inPosition}px`,
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
          }}
        />
      )}
      {/* Dim region after out point */}
      {effectiveOut < effectiveDurationMs && (
        <div
          className="absolute top-0 bottom-0 z-15 pointer-events-none"
          style={{
            left: `${outPosition}px`,
            width: `${Math.max(0, totalWidth - outPosition)}px`,
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
          }}
        />
      )}
    </>
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
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const trackVisibility = useVideoEditorStore(selectTrackVisibility);
  const exportInPointMs = useVideoEditorStore(selectExportInPointMs);
  const exportOutPointMs = useVideoEditorStore(selectExportOutPointMs);
  const splitAtTimelineTime = useVideoEditorStore(selectSplitAtTimelineTime);
  const setTimelineScrollLeft = useVideoEditorStore(selectSetTimelineScrollLeft);
  const setTimelineContainerWidth = useVideoEditorStore(selectSetTimelineContainerWidth);
  const setDraggingPlayhead = useVideoEditorStore(selectSetDraggingPlayhead);
  const setTimelineZoom = useVideoEditorStore(selectSetTimelineZoom);
  const setPreviewTime = useVideoEditorStore(selectSetPreviewTime);
  const setSplitMode = useVideoEditorStore(selectSetSplitMode);
  const setIsPlaying = useVideoEditorStore(selectSetIsPlaying);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);
  const fitTimelineToWindow = useVideoEditorStore(selectFitTimelineToWindow);
  const setExportInPoint = useVideoEditorStore(selectSetExportInPoint);
  const setExportOutPoint = useVideoEditorStore(selectSetExportOutPoint);

  const [draggingIOMarker, setDraggingIOMarker] = useState<'in' | 'out' | null>(null);

  const controls = usePlaybackControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressNextClickRef = useRef(false);
  const previewRafRef = useRef<number | null>(null);
  const pendingPreviewTimeRef = useRef<number | null>(null);
  const lastPreviewTimeRef = useRef<number | null>(null);
  const lastHoverPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoverPreviewResumeAtRef = useRef<number>(performance.now() + HOVER_PREVIEW_RESUME_AFTER_RESIZE_MS);
  const hasMeasuredTimelineRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);

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
  }, [setTimelineContainerWidth]);

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
  const effectiveDurationMs = getEffectiveDuration(segments ?? [], sourceDurationMs);
  const durationWidth = effectiveDurationMs * timelineZoom;
  const timelineWidth = Math.max(durationWidth, containerWidth - TRACK_LABEL_WIDTH);

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
    setDraggingIOMarker(marker);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;

      const rect = scrollContainer.getBoundingClientRect();
      const scrollLeft = scrollContainer.scrollLeft;
      const x = moveEvent.clientX - rect.left + scrollLeft;
      const rawTimeMs = Math.max(0, Math.min(effectiveDurationMs, x / timelineZoom));

      // Read the latest marker positions from the store directly
      const { exportInPointMs: currentIn, exportOutPointMs: currentOut } = useVideoEditorStore.getState();

      if (marker === 'in') {
        // Clamp: can't go past the out point
        const maxMs = currentOut !== null ? currentOut - 1 : effectiveDurationMs;
        const clampedMs = Math.min(rawTimeMs, maxMs);
        setExportInPoint(Math.max(0, clampedMs));
      } else {
        // Clamp: can't go before the in point
        const minMs = currentIn !== null ? currentIn + 1 : 0;
        const clampedMs = Math.max(rawTimeMs, minMs);
        setExportOutPoint(Math.min(effectiveDurationMs, clampedMs));
      }
    };

    const handleMouseUp = () => {
      setDraggingIOMarker(null);
      // Suppress the click event that fires after mouseup to prevent playhead seek
      suppressNextClickRef.current = true;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [effectiveDurationMs, timelineZoom, setExportInPoint, setExportOutPoint]);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setTimelineScrollLeft(e.currentTarget.scrollLeft);
  }, [setTimelineScrollLeft]);

  // Playback controls
  const handleGoToStart = useCallback(() => {
    controls.seek(0);
  }, [controls]);

  const handleGoToEnd = useCallback(() => {
    controls.seek(effectiveDurationMs);
  }, [controls, effectiveDurationMs]);

  const handleSkipBack = useCallback(() => {
    const { currentTimeMs } = getPlaybackState();
    controls.seek(Math.max(0, currentTimeMs - 5000));
  }, [controls]);

  const handleSkipForward = useCallback(() => {
    const { currentTimeMs } = getPlaybackState();
    controls.seek(Math.min(effectiveDurationMs, currentTimeMs + 5000));
  }, [controls, effectiveDurationMs]);

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

            {/* Reset button - restore full video */}
            {onResetTrimSegments && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onResetTrimSegments}
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
                        className="glass-btn h-8 px-2 text-[11px] font-semibold"
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
                        className="glass-btn h-8 px-2 text-[11px] font-semibold"
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
                  <button onClick={handleGoToStart} className="glass-btn h-8 w-8">
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
                  <button onClick={handleSkipBack} className="glass-btn h-8 w-8">
                    <SkipBack className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Skip Back 5s</span>
                    <kbd className="kbd text-[10px] px-1.5 py-0.5">←</kbd>
                  </div>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={togglePlayback}
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
                  <button onClick={handleSkipForward} className="glass-btn h-8 w-8">
                    <SkipForward className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">Skip Forward 5s</span>
                    <kbd className="kbd text-[10px] px-1.5 py-0.5">→</kbd>
                  </div>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleGoToEnd} className="glass-btn h-8 w-8">
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
                  <button onClick={handleZoomOut} className="glass-btn h-7 w-7">
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
                  <button onClick={handleZoomIn} className="glass-btn h-7 w-7">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Zoom In Timeline</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={fitTimelineToWindow} className="glass-btn h-7 w-7">
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
                  <span className="text-xs font-medium">Export</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="flex items-center gap-2">
                  <span className="text-xs">Export Video</span>
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
          {trackVisibility.video && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Film className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Video</span>
              </div>
            </div>
          )}

          {/* Text label */}
          {project && trackVisibility.text && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Type className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Text</span>
              </div>
            </div>
          )}

          {/* Zoom label */}
          {project && trackVisibility.zoom && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Zoom</span>
              </div>
            </div>
          )}

          {/* Scene label */}
          {project && project.sources.webcamVideo && trackVisibility.scene && (
            <div className="h-12 border-b border-[var(--glass-border)] flex items-center justify-center">
              <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
                <Video className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Scene</span>
              </div>
            </div>
          )}

          {/* Mask label */}
          {project && trackVisibility.mask && (
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
          className={`flex-1 min-w-0 overflow-x-auto overflow-y-auto ${splitMode ? 'cursor-crosshair' : ''}`}
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
            {trackVisibility.video && project && (
              <TrimTrackContent
                segments={project.timeline.segments}
                durationMs={sourceDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
                audioPath={
                  project.sources.systemAudio ??
                  project.sources.microphoneAudio ??
                  project.sources.screenVideo ??
                  undefined
                }
              />
            )}

            {/* Text Track Content */}
            {project && trackVisibility.text && (
              <TextTrackContent
                segments={project.text.segments}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
              />
            )}

            {/* Zoom Track Content */}
            {project && trackVisibility.zoom && (
              <ZoomTrackContent
                regions={project.zoom.regions}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
              />
            )}

            {/* Scene Track Content */}
            {project && project.sources.webcamVideo && trackVisibility.scene && (
              <SceneTrackContent
                segments={project.scene.segments}
                defaultMode={project.scene.defaultMode}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
              />
            )}

            {/* Mask Track Content */}
            {project && trackVisibility.mask && (
              <MaskTrackContent
                segments={project.mask.segments}
                durationMs={effectiveDurationMs}
                timelineZoom={timelineZoom}
                width={timelineWidth}
              />
            )}

            {/* IO Region Overlay - dims areas outside export range */}
            {(exportInPointMs !== null || exportOutPointMs !== null) && (
              <IORegionOverlay
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
                isDragging={draggingIOMarker === 'in'}
                onMouseDown={(e) => handleIOMarkerMouseDown('in', e)}
              />
            )}
            {exportOutPointMs !== null && (
              <IOMarker
                timeMs={exportOutPointMs}
                label="O"
                timelineZoom={timelineZoom}
                isDragging={draggingIOMarker === 'out'}
                onMouseDown={(e) => handleIOMarkerMouseDown('out', e)}
              />
            )}

            {/* Preview Scrubber - only when not playing */}
            {!isPlaying && previewTimeMs !== null && (
              <PreviewScrubber
                previewTimeMs={previewTimeMs}
                timelineZoom={timelineZoom}
                trackLabelWidth={0}
                isCutMode={splitMode}
              />
            )}

            {/* Playhead */}
            <Playhead
              timelineZoom={timelineZoom}
              trackLabelWidth={0}
              isDragging={isDraggingPlayhead}
              onMouseDown={handlePlayheadMouseDown}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
