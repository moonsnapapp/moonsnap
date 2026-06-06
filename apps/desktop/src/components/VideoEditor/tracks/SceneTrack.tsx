import { memo, useCallback, useMemo } from 'react';
import { Camera, Monitor, Video, Plus } from 'lucide-react';
import type { SceneSegment, SceneMode } from '../../../types';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import {
  selectAddSceneSegment,
  selectDeleteSceneSegment,
  selectHoveredTrack,
  selectIsDraggingAnySegment,
  selectIsPlaying,
  selectPreviewTimeMs,
  selectSelectSceneSegment,
  selectSelectedSceneSegmentId,
  selectSetDraggingSceneSegment,
  selectSetHoveredTrack,
  selectUpdateSceneSegment,
} from '../../../stores/videoEditor/selectors';
import {
  BaseSegmentItem,
  BaseSegmentLabel,
  BaseSegmentWidthGate,
  type BaseSegmentAppearance,
  type SegmentTooltipPlacement,
} from './BaseTrack';

interface SceneTrackProps {
  segments: SceneSegment[];
  defaultMode: SceneMode;
  durationMs: number;
  timelineZoom: number;
  width?: number;
  tooltipPlacement?: SegmentTooltipPlacement;
}

// Generate unique IDs for segments
let segmentIdCounter = 0;
const generateSegmentId = () => `scene-${Date.now()}-${++segmentIdCounter}`;

// Default segment duration when adding new segments (3 seconds)
const DEFAULT_SEGMENT_DURATION_MS = 3000;
// Minimum duration to allow adding a segment (500ms)
const MIN_SEGMENT_DURATION_MS = 500;

// CSS variable keys for different scene modes (theme-aware)
const SCENE_MODE_APPEARANCE: Record<SceneMode, BaseSegmentAppearance> = {
  default: {
    backgroundColor: 'var(--track-scene-default-bg)',
    selectedBackgroundColor: 'var(--track-scene-default-bg)',
    borderColor: 'var(--track-scene-default-border)',
    selectedBorderColor: 'var(--track-scene-default-border)',
    hoverColor: 'var(--track-scene-default-bg)',
    textColor: 'var(--track-scene-default-text)',
  },
  cameraOnly: {
    backgroundColor: 'var(--track-scene-camera-bg)',
    selectedBackgroundColor: 'var(--track-scene-camera-bg)',
    borderColor: 'var(--track-scene-camera-border)',
    selectedBorderColor: 'var(--track-scene-camera-border)',
    hoverColor: 'var(--track-scene-camera-bg)',
    textColor: 'var(--track-scene-camera-text)',
  },
  screenOnly: {
    backgroundColor: 'var(--track-scene-default-bg)',
    selectedBackgroundColor: 'var(--track-scene-default-bg)',
    borderColor: 'var(--track-scene-default-border)',
    selectedBorderColor: 'var(--track-scene-default-border)',
    hoverColor: 'var(--track-scene-default-bg)',
    textColor: 'var(--track-scene-default-text)',
  },
};

const SCENE_MODE_ICONS: Record<SceneMode, typeof Camera> = {
  default: Video,
  cameraOnly: Camera,
  screenOnly: Monitor,
};

const SCENE_MODE_LABELS: Record<SceneMode, string | null> = {
  default: null,
  cameraOnly: 'Camera Only',
  screenOnly: 'Screen Only',
};

const SceneSegmentItem = memo(function SceneSegmentItem({
  segment,
  isSelected,
  timelineZoom,
  durationMs,
  onSelect,
  onUpdate,
  onDelete,
  onDragStart,
  tooltipPlacement = 'below',
}: {
  segment: SceneSegment;
  isSelected: boolean;
  timelineZoom: number;
  durationMs: number;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<SceneSegment>) => void;
  onDelete: (id: string) => void;
  onDragStart: (dragging: boolean) => void;
  tooltipPlacement?: SegmentTooltipPlacement;
}) {
  const Icon = SCENE_MODE_ICONS[segment.mode];
  const modeLabel = SCENE_MODE_LABELS[segment.mode];

  return (
    <BaseSegmentItem<SceneSegment>
      segment={segment}
      isSelected={isSelected}
      timelineZoom={timelineZoom}
      durationMs={durationMs}
      minDurationMs={MIN_SEGMENT_DURATION_MS}
      onSelect={onSelect}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onDragStart={onDragStart}
      appearance={SCENE_MODE_APPEARANCE[segment.mode]}
      tooltipPlacement={tooltipPlacement}
    >
      <BaseSegmentLabel icon={<Icon className="w-3 h-3" />}>
        {modeLabel && (
          <BaseSegmentWidthGate minWidth={100}>
            <span className="truncate text-[10px] font-medium leading-none">
              {modeLabel}
            </span>
          </BaseSegmentWidthGate>
        )}
      </BaseSegmentLabel>
    </BaseSegmentItem>
  );
});

/**
 * Preview segment shown when hovering over empty track space.
 */
const PreviewSegment = memo(function PreviewSegment({
  startMs,
  endMs,
  mode,
  timelineZoom,
}: {
  startMs: number;
  endMs: number;
  mode: SceneMode;
  timelineZoom: number;
}) {
  const left = startMs * timelineZoom;
  const width = (endMs - startMs) * timelineZoom;
  const appearance = SCENE_MODE_APPEARANCE[mode];

  return (
    <div
      className="absolute top-1 bottom-1 rounded-md border-2 border-dashed pointer-events-none opacity-70"
      style={{
        left,
        width: Math.max(width, 40),
        backgroundColor: appearance.backgroundColor,
        borderColor: appearance.borderColor,
      }}
    >
      <div className="flex items-center justify-center h-full" style={{ color: appearance.textColor }}>
        <Plus className="h-4 w-4" />
      </div>
    </div>
  );
});

/**
 * Hook for scene track preview segment calculation.
 * Shared between SceneTrack and SceneTrackContent.
 */
function useScenePreviewSegment(
  segments: SceneSegment[],
  defaultMode: SceneMode,
  durationMs: number,
  hoveredTrack: string | null,
  previewTimeMs: number | null,
  isPlaying: boolean,
  isDraggingAny: boolean
) {
  return useMemo(() => {
    // Only show preview when hovering over this track, not playing, and not dragging
    if (hoveredTrack !== 'scene' || previewTimeMs === null || isPlaying || isDraggingAny) {
      return null;
    }

    // Check if hovering over an existing segment
    const isOnSegment = segments.some(
      (seg) => previewTimeMs >= seg.startMs && previewTimeMs <= seg.endMs
    );

    if (isOnSegment) {
      return null;
    }

    // Calculate preview segment bounds - left edge at playhead
    const startMs = previewTimeMs;
    const endMs = Math.min(durationMs, startMs + DEFAULT_SEGMENT_DURATION_MS);

    // Don't allow if there's not enough space for minimum duration
    if (endMs - startMs < MIN_SEGMENT_DURATION_MS) {
      return null;
    }

    // Check for collisions with existing segments and adjust
    for (const seg of segments) {
      // If preview would overlap with an existing segment, don't show it
      if (startMs < seg.endMs && endMs > seg.startMs) {
        return null;
      }
    }

    // Determine the mode for new segment (opposite of default for visibility)
    const newMode: SceneMode = defaultMode === 'default' ? 'cameraOnly' : 'default';

    return { startMs, endMs, mode: newMode };
  }, [hoveredTrack, previewTimeMs, isPlaying, isDraggingAny, segments, durationMs, defaultMode]);
}

/**
 * SceneTrack component for displaying and editing scene mode segments.
 *
 * Scene modes control how the video is displayed:
 * - Default: Screen with webcam overlay
 * - Camera Only: Fullscreen webcam
 * - Screen Only: Hide webcam
 */
export const SceneTrack = memo(function SceneTrack({
  segments,
  defaultMode,
  durationMs,
  timelineZoom,
  tooltipPlacement = 'below',
}: SceneTrackProps) {
  const selectSceneSegment = useVideoEditorStore(selectSelectSceneSegment);
  const addSceneSegment = useVideoEditorStore(selectAddSceneSegment);
  const updateSceneSegment = useVideoEditorStore(selectUpdateSceneSegment);
  const deleteSceneSegment = useVideoEditorStore(selectDeleteSceneSegment);
  const setDraggingSceneSegment = useVideoEditorStore(selectSetDraggingSceneSegment);
  const selectedSceneSegmentId = useVideoEditorStore(selectSelectedSceneSegmentId);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const hoveredTrack = useVideoEditorStore(selectHoveredTrack);
  const setHoveredTrack = useVideoEditorStore(selectSetHoveredTrack);
  const isPlaying = useVideoEditorStore(selectIsPlaying);

  const totalWidth = durationMs * timelineZoom;

  // Check if any segment is being dragged
  const isDraggingAny = useVideoEditorStore(selectIsDraggingAnySegment);

  const previewSegmentDetails = useScenePreviewSegment(
    segments, defaultMode, durationMs, hoveredTrack, previewTimeMs, isPlaying, isDraggingAny
  );

  // Handle track hover
  const handleMouseEnter = useCallback(() => {
    setHoveredTrack('scene');
  }, [setHoveredTrack]);

  const handleMouseLeave = useCallback(() => {
    setHoveredTrack(null);
  }, [setHoveredTrack]);

  // Handle click to add segment
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    // Only add if we have a valid preview segment
    if (!previewSegmentDetails) return;

    // Don't add if clicking on a segment
    if ((e.target as HTMLElement).closest('[data-segment]')) return;

    const newSegment: SceneSegment = {
      id: generateSegmentId(),
      startMs: previewSegmentDetails.startMs,
      endMs: previewSegmentDetails.endMs,
      mode: previewSegmentDetails.mode,
    };

    addSceneSegment(newSegment);
  }, [previewSegmentDetails, addSceneSegment]);

  return (
    <div className="h-full flex items-stretch border-b border-[var(--glass-border)]">
      {/* Track label - sticky to stay visible during horizontal scroll */}
      <div className="sticky left-0 flex-shrink-0 w-20 h-full bg-[var(--polar-mist)] border-r border-[var(--glass-border)] flex items-center justify-center z-10">
        <div className="flex items-center gap-1.5 text-[var(--ink-dark)]">
          <Video className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">Scene</span>
        </div>
      </div>

      {/* Scene Segments */}
      <div
        className={`flex-1 relative bg-[var(--polar-mist)]/60 transition-colors ${
          hoveredTrack === 'scene' && previewSegmentDetails ? 'cursor-pointer' : ''
        }`}
        style={{ width: totalWidth }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleTrackClick}
      >
          {/* Render segments */}
        {segments.map((segment) => (
          <SceneSegmentItem
            key={segment.id}
            segment={segment}
            isSelected={selectedSceneSegmentId === segment.id}
            timelineZoom={timelineZoom}
            durationMs={durationMs}
            onSelect={selectSceneSegment}
            onUpdate={updateSceneSegment}
            onDelete={deleteSceneSegment}
            onDragStart={setDraggingSceneSegment}
            tooltipPlacement={tooltipPlacement}
          />
        ))}

        {/* Preview segment (ghost) when hovering over empty space */}
        {previewSegmentDetails && (
          <PreviewSegment
            startMs={previewSegmentDetails.startMs}
            endMs={previewSegmentDetails.endMs}
            mode={previewSegmentDetails.mode}
            timelineZoom={timelineZoom}
          />
        )}

        {/* Empty state hint */}
        {segments.length === 0 && !previewSegmentDetails && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] text-[var(--ink-subtle)]">
              Hover to add scene modes
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * SceneTrackContent - Track content without label for two-column layout.
 */
export const SceneTrackContent = memo(function SceneTrackContent({
  segments,
  defaultMode,
  durationMs,
  timelineZoom,
  width,
  tooltipPlacement = 'below',
}: SceneTrackProps) {
  const selectSceneSegment = useVideoEditorStore(selectSelectSceneSegment);
  const addSceneSegment = useVideoEditorStore(selectAddSceneSegment);
  const updateSceneSegment = useVideoEditorStore(selectUpdateSceneSegment);
  const deleteSceneSegment = useVideoEditorStore(selectDeleteSceneSegment);
  const setDraggingSceneSegment = useVideoEditorStore(selectSetDraggingSceneSegment);
  const selectedSceneSegmentId = useVideoEditorStore(selectSelectedSceneSegmentId);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const hoveredTrack = useVideoEditorStore(selectHoveredTrack);
  const setHoveredTrack = useVideoEditorStore(selectSetHoveredTrack);
  const isPlaying = useVideoEditorStore(selectIsPlaying);

  // Check if any segment is being dragged
  const isDraggingAny = useVideoEditorStore(selectIsDraggingAnySegment);

  const previewSegmentDetails = useScenePreviewSegment(
    segments, defaultMode, durationMs, hoveredTrack, previewTimeMs, isPlaying, isDraggingAny
  );

  // Handle track hover
  const handleMouseEnter = useCallback(() => {
    setHoveredTrack('scene');
  }, [setHoveredTrack]);

  const handleMouseLeave = useCallback(() => {
    setHoveredTrack(null);
  }, [setHoveredTrack]);

  // Handle click to add segment
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    // Only add if we have a valid preview segment
    if (!previewSegmentDetails) return;

    // Don't add if clicking on a segment
    if ((e.target as HTMLElement).closest('[data-segment]')) return;

    const newSegment: SceneSegment = {
      id: generateSegmentId(),
      startMs: previewSegmentDetails.startMs,
      endMs: previewSegmentDetails.endMs,
      mode: previewSegmentDetails.mode,
    };

    addSceneSegment(newSegment);
  }, [previewSegmentDetails, addSceneSegment]);

  return (
    <div
      className={`relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)] ${
        hoveredTrack === 'scene' && previewSegmentDetails ? 'cursor-pointer' : ''
      }`}
      style={{ width: width ? `${width}px` : undefined }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleTrackClick}
    >
      {segments.map((segment) => (
        <SceneSegmentItem
          key={segment.id}
          segment={segment}
          isSelected={selectedSceneSegmentId === segment.id}
          timelineZoom={timelineZoom}
          durationMs={durationMs}
          onSelect={selectSceneSegment}
          onUpdate={updateSceneSegment}
          onDelete={deleteSceneSegment}
          onDragStart={setDraggingSceneSegment}
          tooltipPlacement={tooltipPlacement}
        />
      ))}

      {/* Preview segment (ghost) when hovering over empty space */}
      {previewSegmentDetails && (
        <PreviewSegment
          startMs={previewSegmentDetails.startMs}
          endMs={previewSegmentDetails.endMs}
          mode={previewSegmentDetails.mode}
          timelineZoom={timelineZoom}
        />
      )}

      {/* Empty state hint */}
      {segments.length === 0 && !previewSegmentDetails && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] text-[var(--ink-subtle)]">
            Hover to add scene modes
          </span>
        </div>
      )}
    </div>
  );
});
