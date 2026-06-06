import { useCallback, useRef, useState, useEffect } from 'react';
import { TIMING } from '@/constants';
import {
  useVideoEditorStore,
  getEffectiveDuration,
  TRACK_LABEL_WIDTH,
  getFitZoom,
  getTimelineContentDuration,
  DEFAULT_FULL_SEGMENT_ID,
} from '../../stores/videoEditorStore';
import {
  selectExportInPointMs,
  selectExportOutPointMs,
  selectDeleteSelectedTimelineItem,
  selectFitTimelineToWindow,
  selectIsDraggingPlayhead,
  selectIsIOLoopEnabled,
  selectIsPlaying,
  selectNudgeSelectedTimelineItem,
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
import { usePlaybackControls, getPlaybackState } from '../../hooks/usePlaybackEngine';
import { Timeline, type TimelineCompositionContextValue } from './VideoTimelineComposition';

function quantizeTimeMs(timeMs: number, stepMs: number): number {
  if (stepMs <= 1) return timeMs;
  return Math.round(timeMs / stepMs) * stepMs;
}

const HOVER_PREVIEW_MIN_POINTER_DELTA_PX = 2;
const HOVER_PREVIEW_RESUME_AFTER_RESIZE_MS = TIMING.RESIZE_DEBOUNCE_MS * 2;
const TIMELINE_NUDGE_STEP_MS = 100;
const TIMELINE_NUDGE_LARGE_STEP_MS = 1000;

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.closest('[contenteditable="true"]') !== null
  );
}

function hasSelectedTimelineItem(): boolean {
  const state = useVideoEditorStore.getState();
  return Boolean(
    state.selectedZoomRegionId ||
    state.selectedTextSegmentId ||
    state.selectedAnnotationSegmentId ||
    state.selectedMaskSegmentId ||
    state.selectedSceneSegmentId ||
    state.selectedWebcamSegmentIndex !== null
  );
}

interface VideoTimelineProps {
  onResetTrimSegments?: () => void;
  onSetInPoint?: () => void;
  onSetOutPoint?: () => void;
  onClearExportRange?: () => void;
}

/**
 * VideoTimeline - Main timeline component with ruler, tracks, and playhead.
 * Optimized to prevent re-renders during playback.
 */
export function VideoTimeline({ onResetTrimSegments, onSetInPoint, onSetOutPoint, onClearExportRange }: VideoTimelineProps) {
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
  const deleteSelectedTimelineItem = useVideoEditorStore(selectDeleteSelectedTimelineItem);
  const nudgeSelectedTimelineItem = useVideoEditorStore(selectNudgeSelectedTimelineItem);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!hasSelectedTimelineItem()) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        deleteSelectedTimelineItem();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        const stepMs = event.shiftKey ? TIMELINE_NUDGE_LARGE_STEP_MS : TIMELINE_NUDGE_STEP_MS;
        nudgeSelectedTimelineItem(event.key === 'ArrowLeft' ? -stepMs : stepMs);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedTimelineItem, nudgeSelectedTimelineItem]);

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
  const contentDurationMs = project ? getTimelineContentDuration(project) : effectiveDurationMs;
  const durationWidth = contentDurationMs * timelineZoom;
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
    if (isPlaying) {
      setIsPlaying(false);
    }
    setSplitMode(!splitMode);
  }, [isPlaying, setIsPlaying, setSplitMode, splitMode]);

  const handleToggleSpeedPopover = useCallback(() => {
    if (!canSetSelectedTrimSegmentSpeed) return;
    setIsSpeedPopoverOpen((isOpen) => !isOpen);
  }, [canSetSelectedTrimSegmentSpeed]);

  const handleSpeedInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTrimSegmentId) return;
    updateTrimSegmentSpeed(selectedTrimSegmentId, Number(event.target.value));
  }, [selectedTrimSegmentId, updateTrimSegmentSpeed]);

  const timelineComposition: TimelineCompositionContextValue = {
    project,
    sourceDurationMs,
    effectiveDurationMs,
    timelineZoom,
    timelineWidth,
    zoomPercent,
    isDraggingPlayhead,
    isPlaying,
    splitMode,
    previewTimeMs,
    exportInPointMs,
    exportOutPointMs,
    draggingIOMarker,
    isSpeedPopoverOpen,
    selectedTrimSegmentSpeed,
    canSetSelectedTrimSegmentSpeed,
    canReplayIO,
    isIOLoopEnabled,
    hasVideoTrack,
    hasTextTrack,
    hasAnnotationTrack,
    hasZoomTrack,
    hasSceneTrack,
    hasMaskTrack,
    lastVisibleTrack,
    shouldShowPrimaryPlayhead,
    speedControlRef,
    scrollRef,
    onResetTrimSegments,
    onSetInPoint,
    onSetOutPoint,
    onClearExportRange,
    onToggleCutMode: handleToggleCutMode,
    onToggleSpeedPopover: handleToggleSpeedPopover,
    onSpeedInput: handleSpeedInput,
    onGoToStart: handleGoToStart,
    onSkipBack: handleSkipBack,
    onTogglePlayback: handleTogglePlayback,
    onReplayIO: handleReplayIO,
    onSkipForward: handleSkipForward,
    onGoToEnd: handleGoToEnd,
    onZoomOut: handleZoomOut,
    onZoomIn: handleZoomIn,
    onFitTimelineToWindow: fitTimelineToWindow,
    onScroll: handleScroll,
    onTimelineMouseMove: handleTimelineMouseMove,
    onTimelineMouseLeave: handleTimelineMouseLeave,
    onTimelineCutClickCapture: handleTimelineCutClickCapture,
    onTimelineClick: handleTimelineClick,
    onRulerMouseDown: handleRulerMouseDown,
    onIOMarkerMouseDown: handleIOMarkerMouseDown,
    onPlayheadMouseDown: handlePlayheadMouseDown,
  };

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col bg-[var(--polar-ice)] border-t border-[var(--glass-border)]/50 select-none"
    >
      <Timeline.Provider value={timelineComposition}>
        <Timeline.Toolbar />
        <Timeline.Frame />
      </Timeline.Provider>
    </div>
  );
}
