import { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Film, GripVertical } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { WAVEFORM } from '../../../constants';
import type { TrimSegment, AudioWaveform } from '../../../types';
import {
  useVideoEditorStore,
  formatTimeSimple,
  MIN_TRIM_SEGMENT_DURATION_MS,
  getSegmentTimelinePosition,
  getEffectiveDuration,
  DEFAULT_FULL_SEGMENT_ID,
  MAX_TRIM_SEGMENT_SPEED,
} from '../../../stores/videoEditorStore';
import type { SegmentTooltipPlacement } from './BaseTrack';
import {
  selectDeleteTrimSegment,
  selectSelectTrimSegment,
  selectSelectedTrimSegmentId,
  selectSetDraggingZoomRegion,
  selectUpdateTrimSegment,
} from '../../../stores/videoEditor/selectors';
import { audioLogger } from '../../../utils/logger';

interface TrimTrackProps {
  segments: TrimSegment[];
  durationMs: number;
  timelineZoom: number;
  width: number;
  isCutMode?: boolean;
  audioPath?: string;
  tooltipPlacement?: SegmentTooltipPlacement;
}

const WAVEFORM_VISUAL_PERCENTILE = 0.98;
const WAVEFORM_RESPONSE_GAMMA = 0.72;
const WAVEFORM_MIN_VISIBLE_HEIGHT = 0.06;

function shapeWaveformLevel(level: number): number {
  if (level <= 0) {
    return 0;
  }

  const curved = Math.pow(level, WAVEFORM_RESPONSE_GAMMA);
  return WAVEFORM_MIN_VISIBLE_HEIGHT + curved * (1 - WAVEFORM_MIN_VISIBLE_HEIGHT);
}

/**
 * Hook to load waveform data and calculate global visual gain
 */
function useWaveform(audioPath: string | undefined) {
  const [waveform, setWaveform] = useState<AudioWaveform | null>(null);
  const [visualGain, setVisualGain] = useState<number>(1);

  useEffect(() => {
    if (!audioPath) return;

    let cancelled = false;

    async function loadWaveform() {
      try {
        const data = await invoke<AudioWaveform>('extract_audio_waveform', {
          audioPath,
          samplesPerSecond: WAVEFORM.DEFAULT_SAMPLES_PER_SECOND,
        });

        if (!cancelled) {
          const sortedAmplitudes = data.samples
            .map((sample) => Math.abs(sample))
            .sort((a, b) => a - b);
          const percentileIndex = Math.max(
            0,
            Math.min(
              sortedAmplitudes.length - 1,
              Math.floor(sortedAmplitudes.length * WAVEFORM_VISUAL_PERCENTILE)
            )
          );
          const referenceAmplitude = sortedAmplitudes[percentileIndex] ?? 0;
          const gain = referenceAmplitude > 0.01
            ? Math.min(1 / referenceAmplitude, 12)
            : 12;

          setWaveform(data);
          setVisualGain(gain);
        }
      } catch (err) {
        audioLogger.error('Failed to load waveform:', err);
      }
    }

    loadWaveform();

    return () => {
      cancelled = true;
    };
  }, [audioPath]);

  return { waveform, visualGain };
}

// CSS variable names for trim track styling
const TRIM_COLORS = {
  bg: 'var(--coral-100)',
  bgSelected: 'var(--coral-200)',
  border: 'var(--coral-200)',
  borderSelected: 'var(--coral-400)',
  hover: 'var(--coral-300)',
  text: 'var(--coral-400)',
};
const SEGMENT_WAVEFORM_BOTTOM_PADDING_PX = 2;
const SEGMENT_WAVEFORM_TOP_PADDING_PX = 3;
const SEGMENT_WAVEFORM_HEIGHT_PX = 40;
function getSegmentSpeed(segment: TrimSegment): number {
  return typeof segment.speed === 'number' && Number.isFinite(segment.speed)
    ? Math.max(1, Math.min(MAX_TRIM_SEGMENT_SPEED, segment.speed))
    : 1;
}

function getSegmentTimelineDuration(segment: TrimSegment): number {
  return Math.max(0, segment.sourceEndMs - segment.sourceStartMs) / getSegmentSpeed(segment);
}

function drawSegmentWaveform({
  canvas,
  waveform,
  visualGain,
  sourceStartMs,
  sourceEndMs,
  sourceDurationMs,
  width,
  height,
}: {
  canvas: HTMLCanvasElement;
  waveform: AudioWaveform;
  visualGain: number;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceDurationMs: number;
  width: number;
  height: number;
}) {
  if (waveform.samples.length === 0 || width <= 0 || height <= 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  const { samples } = waveform;
  const startRatio = sourceStartMs / sourceDurationMs;
  const endRatio = sourceEndMs / sourceDurationMs;
  const startSample = Math.floor(startRatio * samples.length);
  const endSample = Math.ceil(endRatio * samples.length);
  const segmentSamples = samples.slice(startSample, endSample);

  if (segmentSamples.length === 0) return;

  const baselineY = height - SEGMENT_WAVEFORM_BOTTOM_PADDING_PX;
  const maxAmplitude = Math.max(1, height - SEGMENT_WAVEFORM_TOP_PADDING_PX - SEGMENT_WAVEFORM_BOTTOM_PADDING_PX);
  const samplesPerPixel = segmentSamples.length / width;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(251, 146, 60, 0.55)');
  gradient.addColorStop(0.65, 'rgba(249, 112, 102, 0.4)');
  gradient.addColorStop(1, 'rgba(240, 68, 56, 0.18)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, baselineY);

  for (let x = 0; x < width; x++) {
    const sampleIndex = Math.floor(x * samplesPerPixel);
    const sample = segmentSamples[Math.min(sampleIndex, segmentSamples.length - 1)];
    const normalizedLevel = Math.min(Math.abs(sample) * visualGain, 1);
    const amplitude = shapeWaveformLevel(normalizedLevel) * maxAmplitude;
    ctx.lineTo(x, baselineY - amplitude);
  }

  ctx.lineTo(width, baselineY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(249, 112, 102, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baselineY + 0.5);
  ctx.lineTo(width, baselineY + 0.5);
  ctx.stroke();
}

/**
 * Individual trim segment component with drag handles.
 * Positioned by timeline time (accumulated duration of previous segments).
 */
const TrimSegmentItem = memo(function TrimSegmentItem({
  segment,
  segmentIndex,
  allSegments,
  isSelected,
  timelineZoom,
  sourceDurationMs,
  onSelect,
  onUpdate,
  onDelete,
  onDragStart,
  waveform,
  visualGain,
  isCutMode = false,
  tooltipPlacement = 'below',
  label,
}: {
  segment: TrimSegment;
  segmentIndex: number;
  allSegments: TrimSegment[];
  isSelected: boolean;
  timelineZoom: number;
  sourceDurationMs: number;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<TrimSegment, 'sourceStartMs' | 'sourceEndMs'>>) => void;
  onDelete: (id: string) => void;
  onDragStart: (dragging: boolean, edge?: 'start' | 'end' | 'move') => void;
  waveform: AudioWaveform | null;
  visualGain: number;
  isCutMode?: boolean;
  tooltipPlacement?: SegmentTooltipPlacement;
  label?: string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ sourceStartMs: number; sourceEndMs: number } | null>(null);
  const segmentSpeed = getSegmentSpeed(segment);

  // Calculate timeline position (where this segment starts after rippling)
  const timelinePosition = getSegmentTimelinePosition(segmentIndex, allSegments);

  // Segment duration and width
  const segmentDuration = getSegmentTimelineDuration(segment);
  const segmentWidth = segmentDuration * timelineZoom;
  const left = timelinePosition * timelineZoom;

  const canDelete = allSegments.length > 1;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, edge: 'start' | 'end') => {
      e.preventDefault();
      e.stopPropagation();

      const captureTarget = e.currentTarget as HTMLElement;
      captureTarget.setPointerCapture(e.pointerId);

      onSelect(segment.id);
      onDragStart(true, edge);

      const startX = e.clientX;
      const startSourceStart = segment.sourceStartMs;
      const startSourceEnd = segment.sourceEndMs;

      dragStateRef.current = { sourceStartMs: startSourceStart, sourceEndMs: startSourceEnd };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaMs = deltaX / timelineZoom;

        let newSourceStart = dragStateRef.current!.sourceStartMs;
        let newSourceEnd = dragStateRef.current!.sourceEndMs;

        if (edge === 'start') {
          // Drag left edge - trim the start (expand/contract the source range)
          newSourceStart = Math.max(0, Math.min(startSourceEnd - MIN_TRIM_SEGMENT_DURATION_MS, startSourceStart + deltaMs));
        } else if (edge === 'end') {
          // Drag right edge - trim the end
          newSourceEnd = Math.max(startSourceStart + MIN_TRIM_SEGMENT_DURATION_MS, Math.min(sourceDurationMs, startSourceEnd + deltaMs));
        }

        dragStateRef.current = { sourceStartMs: newSourceStart, sourceEndMs: newSourceEnd };

        // Update DOM directly for smooth dragging
        if (elementRef.current) {
          const newWidth = ((newSourceEnd - newSourceStart) / segmentSpeed) * timelineZoom;
          const renderedWidth = Math.max(newWidth, 20);
          elementRef.current.style.width = `${renderedWidth}px`;

          const waveformCanvas = elementRef.current.querySelector('[data-segment-waveform]') as HTMLCanvasElement | null;
          if (waveformCanvas && waveform) {
            drawSegmentWaveform({
              canvas: waveformCanvas,
              waveform,
              visualGain,
              sourceStartMs: newSourceStart,
              sourceEndMs: newSourceEnd,
              sourceDurationMs,
              width: renderedWidth,
              height: SEGMENT_WAVEFORM_HEIGHT_PX,
            });
          }
        }

        if (tooltipRef.current) {
          const duration = (newSourceEnd - newSourceStart) / segmentSpeed;
          tooltipRef.current.textContent = formatTimeSimple(duration);
        }
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        captureTarget.releasePointerCapture(upEvent.pointerId);

        if (dragStateRef.current) {
          const { sourceStartMs, sourceEndMs } = dragStateRef.current;
          if (sourceStartMs !== segment.sourceStartMs || sourceEndMs !== segment.sourceEndMs) {
            onUpdate(segment.id, { sourceStartMs, sourceEndMs });
          }
        }
        dragStateRef.current = null;
        onDragStart(false);
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    },
    [segment, sourceDurationMs, timelineZoom, onSelect, onUpdate, onDragStart, waveform, visualGain, segmentSpeed]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(segment.id);
    },
    [onSelect, segment.id]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(segment.id);
    },
    [onDelete, segment.id]
  );
  const tooltipClassName = tooltipPlacement === 'above'
    ? 'absolute -top-6 left-1/2 -translate-x-1/2 bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] text-[var(--ink-dark)] text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20 shadow-sm'
    : 'absolute -bottom-6 left-1/2 -translate-x-1/2 bg-[var(--glass-bg-solid)] border border-[var(--glass-border)] text-[var(--ink-dark)] text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-20 shadow-sm';

  return (
    <div
      ref={elementRef}
      data-trim-segment
      data-cut-mode={isCutMode ? 'true' : undefined}
      className={`
        group absolute top-1 bottom-1 rounded-md cursor-pointer
        ${isCutMode ? 'timeline-clip-cut-target' : ''}
        ${isSelected ? 'border-2 shadow-lg' : 'border'}
      `}
      style={{
        left: `${left}px`,
        width: `${Math.max(segmentWidth, 20)}px`,
        backgroundColor: isSelected ? TRIM_COLORS.bgSelected : TRIM_COLORS.bg,
        borderColor: isSelected ? TRIM_COLORS.borderSelected : TRIM_COLORS.border,
      }}
      onClick={handleClick}
    >
      {/* Waveform background */}
      {waveform && (
        <div className="absolute inset-0 overflow-hidden rounded-md pointer-events-none">
          <SegmentWaveform
            waveform={waveform}
            visualGain={visualGain}
            sourceStartMs={segment.sourceStartMs}
            sourceEndMs={segment.sourceEndMs}
            sourceDurationMs={sourceDurationMs}
            width={segmentWidth}
            height={SEGMENT_WAVEFORM_HEIGHT_PX}
          />
        </div>
      )}

      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-md touch-none z-10 bg-[var(--coral-300)]/35 hover:bg-[var(--coral-300)]/75 transition-colors"
        onPointerDown={(e) => handlePointerDown(e, 'start')}
      />

      {/* Center content area */}
      <div className="absolute inset-x-2 top-0 bottom-0 flex items-center justify-center pointer-events-none">
        {segmentWidth > 60 && (
          <div className="flex items-center gap-1" style={{ color: TRIM_COLORS.text }}>
            {label ? <Film className="w-3 h-3" /> : <GripVertical className="w-3 h-3" />}
            {label && (
              <span className="text-[10px] font-medium truncate">
                {label}
              </span>
            )}
            <span className="text-[10px] font-mono">
              {formatTimeSimple(segmentDuration)}
            </span>
            {segmentSpeed > 1.001 && (
              <span className="ml-1 rounded-sm bg-[var(--coral-300)]/25 px-1 text-[9px] font-semibold tabular-nums">
                {segmentSpeed.toFixed(segmentSpeed % 1 === 0 ? 0 : 2)}x
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-md touch-none z-10 bg-[var(--coral-300)]/35 hover:bg-[var(--coral-300)]/75 transition-colors"
        onPointerDown={(e) => handlePointerDown(e, 'end')}
      />

      {/* Delete button (shown when selected or hovering a deletable segment outside cut mode) */}
      {canDelete && !isCutMode && (
        <button
          className={`absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-xs shadow-md z-[70] transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'}`}
          aria-label="Delete trim segment"
          onClick={handleDelete}
        >
          x
        </button>
      )}

      {/* Tooltip showing duration */}
      {isSelected && (
        <div
          ref={tooltipRef}
          className={tooltipClassName}
        >
          {formatTimeSimple(segmentDuration)}
        </div>
      )}
    </div>
  );
});

/**
 * Waveform canvas that renders inside a segment.
 * Uses global visualGain for consistent appearance across all segments.
 */
const SegmentWaveform = memo(function SegmentWaveform({
  waveform,
  visualGain,
  sourceStartMs,
  sourceEndMs,
  sourceDurationMs,
  width,
  height,
}: {
  waveform: AudioWaveform;
  visualGain: number;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceDurationMs: number;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform || waveform.samples.length === 0) return;

    drawSegmentWaveform({
      canvas,
      waveform,
      visualGain,
      sourceStartMs,
      sourceEndMs,
      sourceDurationMs,
      width,
      height,
    });
  }, [waveform, visualGain, sourceStartMs, sourceEndMs, sourceDurationMs, width, height]);

  return (
    <canvas
      ref={canvasRef}
      data-segment-waveform
      className="absolute inset-0 pointer-events-none"
      style={{ width, height }}
    />
  );
});

/**
 * TrimTrackContent - Track content for video trim segments.
 * Shows segments rippled together (no gaps between them).
 */
export const TrimTrackContent = memo(function TrimTrackContent({
  segments,
  durationMs,
  timelineZoom,
  width,
  isCutMode = false,
  audioPath,
  tooltipPlacement = 'below',
}: TrimTrackProps) {
  const selectedTrimSegmentId = useVideoEditorStore(selectSelectedTrimSegmentId);
  const { waveform, visualGain } = useWaveform(audioPath);
  const selectTrimSegment = useVideoEditorStore(selectSelectTrimSegment);
  const updateTrimSegment = useVideoEditorStore(selectUpdateTrimSegment);
  const deleteTrimSegment = useVideoEditorStore(selectDeleteTrimSegment);
  const setDraggingZoomRegion = useVideoEditorStore(selectSetDraggingZoomRegion);

  // Calculate effective duration (total of all segments)
  const effectiveDuration = useMemo(() => {
    return getEffectiveDuration(segments, durationMs);
  }, [segments, durationMs]);

  // Wrapper for onDragStart
  const handleDragStart = useCallback(
    (dragging: boolean) => {
      setDraggingZoomRegion(dragging);
    },
    [setDraggingZoomRegion]
  );

  // If no segments, render the full recording through the same selectable
  // segment path so context-menu actions still work on a fresh timeline.
  if (!segments || segments.length === 0) {
    const fullSegment: TrimSegment = {
      id: DEFAULT_FULL_SEGMENT_ID,
      sourceStartMs: 0,
      sourceEndMs: durationMs,
      speed: 1,
    };

    return (
      <div
        data-trim-track
        data-cut-mode={isCutMode ? 'true' : undefined}
        className="relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)]"
        style={{ width: `${width}px` }}
      >
        <TrimSegmentItem
          segment={fullSegment}
          segmentIndex={0}
          allSegments={[fullSegment]}
          isSelected={fullSegment.id === selectedTrimSegmentId}
          timelineZoom={timelineZoom}
          sourceDurationMs={durationMs}
          onSelect={selectTrimSegment}
          onUpdate={updateTrimSegment}
          onDelete={deleteTrimSegment}
          onDragStart={handleDragStart}
          waveform={waveform}
          visualGain={visualGain}
          isCutMode={isCutMode}
          tooltipPlacement={tooltipPlacement}
          label="Recording"
        />
      </div>
    );
  }

  return (
    <div
      data-trim-track
      data-cut-mode={isCutMode ? 'true' : undefined}
      className="relative h-12 bg-[var(--polar-mist)]/60 border-b border-[var(--glass-border)]"
      style={{ width: `${width}px` }}
    >
      {/* Render segments - positioned by accumulated timeline time */}
      {segments.map((segment, index) => (
        <TrimSegmentItem
          key={segment.id}
          segment={segment}
          segmentIndex={index}
          allSegments={segments}
          isSelected={segment.id === selectedTrimSegmentId}
          timelineZoom={timelineZoom}
          sourceDurationMs={durationMs}
          onSelect={selectTrimSegment}
          onUpdate={updateTrimSegment}
          onDelete={deleteTrimSegment}
          onDragStart={handleDragStart}
          waveform={waveform}
          visualGain={visualGain}
          isCutMode={isCutMode}
          tooltipPlacement={tooltipPlacement}
        />
      ))}

      {/* Show effective duration indicator if different from source */}
      {effectiveDuration < durationMs && (
        <div
          className="absolute top-1 bottom-1 pointer-events-none border-l-2 border-dashed border-[var(--ink-subtle)]/30"
          style={{ left: `${effectiveDuration * timelineZoom}px` }}
        />
      )}
    </div>
  );
});
