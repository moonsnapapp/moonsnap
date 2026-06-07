/**
 * ZoomRegionConfig - Configuration panel for zoom regions following Cap's UI pattern.
 * Shows video thumbnail with draggable focus point in manual mode.
 */
import { useRef, useEffect } from 'react';
import { useWebCodecsPreview } from '../../hooks/useWebCodecsPreview';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { Slider } from '../../components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { EasingFunction, ZoomRegion } from '../../types';

const DEFAULT_ZOOM_TRANSITION = {
  durationInMs: 1200,
  durationOutMs: 900,
  easing: 'easeInOut' as EasingFunction,
};

export interface ZoomRegionConfigProps {
  region: ZoomRegion;
  videoSrc: string;
  canUseAuto: boolean;
  onUpdate: (updates: Partial<ZoomRegion>) => void;
  onDelete: () => void;
  onDone: () => void;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampMotionBlur(value: number | undefined) {
  return Math.max(0, Math.min(2, value ?? 0));
}

function resizeZoomPreviewCanvas(
  canvas: HTMLCanvasElement,
  dimensions: { width: number; height: number }
) {
  if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
  if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
}

function getZoomPreviewCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  return canvasRef.current;
}

function hasDrawnZoomPreviewTime(
  lastDrawnTimeRef: React.MutableRefObject<number | null>,
  currentTimeMs: number
) {
  return lastDrawnTimeRef.current === currentTimeMs;
}

function getZoomPreviewFrame(
  currentTimeMs: number,
  getFrame: (timestampMs: number) => ImageBitmap | null,
  prefetchAround: (timestampMs: number) => void
) {
  const frame = getFrame(currentTimeMs);
  if (!frame) {
    prefetchAround(currentTimeMs);
  }
  return frame;
}

function drawFrameToZoomPreviewCanvas(canvas: HTMLCanvasElement, frame: ImageBitmap) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(frame, 0, 0);
  return true;
}

function getZoomPreviewDrawTarget({
  canvasRef,
  lastDrawnTimeRef,
  dimensions,
  currentTimeMs,
  getFrame,
  prefetchAround,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  lastDrawnTimeRef: React.MutableRefObject<number | null>;
  dimensions: { width: number; height: number };
  currentTimeMs: number;
  getFrame: (timestampMs: number) => ImageBitmap | null;
  prefetchAround: (timestampMs: number) => void;
}) {
  const canvas = getZoomPreviewCanvas(canvasRef);
  if (!canvas) return null;

  resizeZoomPreviewCanvas(canvas, dimensions);
  if (hasDrawnZoomPreviewTime(lastDrawnTimeRef, currentTimeMs)) return null;

  const frame = getZoomPreviewFrame(currentTimeMs, getFrame, prefetchAround);
  return frame ? { canvas, frame } : null;
}

function drawZoomPreviewFrame({
  canvasRef,
  lastDrawnTimeRef,
  dimensions,
  currentTimeMs,
  getFrame,
  prefetchAround,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  lastDrawnTimeRef: React.MutableRefObject<number | null>;
  dimensions: { width: number; height: number };
  currentTimeMs: number;
  getFrame: (timestampMs: number) => ImageBitmap | null;
  prefetchAround: (timestampMs: number) => void;
}) {
  const target = getZoomPreviewDrawTarget({
    canvasRef,
    lastDrawnTimeRef,
    dimensions,
    currentTimeMs,
    getFrame,
    prefetchAround,
  });
  if (target && drawFrameToZoomPreviewCanvas(target.canvas, target.frame)) {
    lastDrawnTimeRef.current = currentTimeMs;
  }
}

function useZoomPreviewCanvas(videoSrc: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDrawnTimeRef = useRef<number | null>(null);
  const { getFrame, prefetchAround, isReady, dimensions } = useWebCodecsPreview(videoSrc);
  const currentTimeMs = usePreviewOrPlaybackTime();

  useEffect(() => {
    if (!isReady || !dimensions) return;
    drawZoomPreviewFrame({
      canvasRef,
      lastDrawnTimeRef,
      dimensions,
      currentTimeMs,
      getFrame,
      prefetchAround,
    });
  }, [isReady, dimensions, currentTimeMs, getFrame, prefetchAround]);

  return { canvasRef, isLoaded: isReady && dimensions !== null };
}

function ZoomTransitionSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[var(--ink-muted)]">{label}</span>
        <span className="text-xs text-[var(--ink-dark)] font-mono">{value}ms</span>
      </div>
      <Slider
        value={[value]}
        min={200}
        max={2000}
        step={50}
        onValueChange={(values) => onChange(values[0])}
      />
    </div>
  );
}

function ZoomFocusPicker({
  region,
  canvasRef,
  isLoaded,
  onUpdate,
}: {
  region: ZoomRegion;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isLoaded: boolean;
  onUpdate: (updates: Partial<ZoomRegion>) => void;
}) {
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();

    const updatePosition = (clientX: number, clientY: number) => {
      onUpdate({
        targetX: clampUnit((clientX - rect.left) / rect.width),
        targetY: clampUnit((clientY - rect.top) / rect.height),
      });
    };

    updatePosition(e.clientX, e.clientY);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updatePosition(moveEvent.clientX, moveEvent.clientY);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (region.mode === 'auto') return null;

  return (
    <div
      className="relative w-full cursor-crosshair"
      onMouseDown={handleMouseDown}
    >
      <div
        className="absolute z-20 w-6 h-6 rounded-full border-2 border-[var(--ink-dark)] -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center bg-[var(--glass-bg)]"
        style={{
          left: `${region.targetX * 100}%`,
          top: `${region.targetY * 100}%`,
        }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--ink-dark)]" />
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--glass-border)] bg-[var(--polar-mist)]">
        <canvas
          ref={canvasRef}
          className={`w-full h-auto transition-opacity duration-200 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--polar-mist)]">
            <span className="text-xs text-[var(--ink-subtle)]">Loading preview...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ZoomRegionHeader({
  onDelete,
  onDone,
}: {
  onDelete: ZoomRegionConfigProps['onDelete'];
  onDone: ZoomRegionConfigProps['onDone'];
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={onDone}
          className="h-7 px-2.5 bg-[var(--accent-100)] hover:bg-[var(--accent-200)] text-[var(--accent-400)] text-xs font-medium rounded-md transition-colors"
        >
          Done
        </button>
        <span className="text-xs text-[var(--ink-subtle)]">Zoom region</span>
      </div>
      <button
        onClick={onDelete}
        className="h-7 px-2.5 bg-[var(--error-light)] hover:bg-[rgba(239,68,68,0.2)] text-[var(--error)] text-xs rounded-md transition-colors"
      >
        Delete
      </button>
    </div>
  );
}

function getZoomModeButtonClassName(isActive: boolean, canSelect = true) {
  if (isActive) return 'text-[var(--ink-black)]';
  return canSelect
    ? 'text-[var(--ink-subtle)] hover:text-[var(--ink-dark)]'
    : 'text-[var(--ink-faint)] cursor-not-allowed';
}

function ZoomModeSelector({
  region,
  canUseAuto,
  onUpdate,
}: {
  region: ZoomRegion;
  canUseAuto: boolean;
  onUpdate: ZoomRegionConfigProps['onUpdate'];
}) {
  return (
    <div>
      <span className="text-xs text-[var(--ink-muted)] block mb-2">Zoom Mode</span>
      <div className="relative flex rounded-lg border border-[var(--glass-border)] overflow-hidden">
        <div
          className="absolute top-0 bottom-0 w-1/2 bg-[var(--polar-frost)] transition-transform duration-200"
          style={{ transform: region.mode === 'auto' ? 'translateX(0)' : 'translateX(100%)' }}
        />
        <button
          onClick={() => canUseAuto && onUpdate({ mode: 'auto' })}
          disabled={!canUseAuto}
          className={`relative z-10 flex-1 py-2 text-xs font-medium transition-colors ${getZoomModeButtonClassName(region.mode === 'auto', canUseAuto)}`}
        >
          Auto
        </button>
        <button
          onClick={() => onUpdate({ mode: 'manual' })}
          className={`relative z-10 flex-1 py-2 text-xs font-medium transition-colors ${getZoomModeButtonClassName(region.mode !== 'auto')}`}
        >
          Manual
        </button>
      </div>
      {!canUseAuto && (
        <p className="text-[10px] text-[var(--ink-faint)] mt-1">
          No cursor data for auto mode
        </p>
      )}
    </div>
  );
}

function ZoomTransitionSettings({
  region,
  onUpdate,
}: {
  region: ZoomRegion;
  onUpdate: ZoomRegionConfigProps['onUpdate'];
}) {
  const transition = region.transition ?? DEFAULT_ZOOM_TRANSITION;
  const motionBlur = clampMotionBlur(region.motionBlur);

  return (
    <div className="space-y-3">
      <ZoomTransitionSlider
        label="Zoom In"
        value={transition.durationInMs}
        onChange={(durationInMs) => onUpdate({
          transition: { ...transition, durationInMs },
        })}
      />

      <ZoomTransitionSlider
        label="Zoom Out"
        value={transition.durationOutMs}
        onChange={(durationOutMs) => onUpdate({
          transition: { ...transition, durationOutMs },
        })}
      />

      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Curve</span>
        <Select
          value={transition.easing}
          onValueChange={(value) => onUpdate({
            transition: { ...transition, easing: value as EasingFunction },
          })}
        >
          <SelectTrigger className="h-8 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
            <SelectItem value="easeInOut">Cinematic</SelectItem>
            <SelectItem value="snappy">Snappy</SelectItem>
            <SelectItem value="smooth">Smooth</SelectItem>
            <SelectItem value="easeOut">Ease Out</SelectItem>
            <SelectItem value="linear">Linear</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[var(--ink-muted)]">Motion Blur</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {Math.round(motionBlur * 100)}%
          </span>
        </div>
        <Slider
          value={[motionBlur * 100]}
          min={0}
          max={200}
          step={5}
          onValueChange={(values) => onUpdate({ motionBlur: values[0] / 100 })}
        />
      </div>
    </div>
  );
}

export function ZoomRegionConfig({ region, videoSrc, canUseAuto, onUpdate, onDelete, onDone }: ZoomRegionConfigProps) {
  const { canvasRef, isLoaded } = useZoomPreviewCanvas(videoSrc);

  if (!region) return null;

  return (
    <div className="space-y-4">
      <ZoomRegionHeader onDelete={onDelete} onDone={onDone} />

      {/* Zoom Amount */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[var(--ink-muted)]">Zoom</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">{region.scale.toFixed(1)}x</span>
        </div>
        <Slider
          value={[region.scale]}
          min={1}
          max={4}
          step={0.1}
          onValueChange={(values) => onUpdate({ scale: values[0] })}
        />
      </div>

      <ZoomModeSelector region={region} canUseAuto={canUseAuto} onUpdate={onUpdate} />

      <ZoomTransitionSettings region={region} onUpdate={onUpdate} />

      <ZoomFocusPicker
        region={region}
        canvasRef={canvasRef}
        isLoaded={isLoaded}
        onUpdate={onUpdate}
      />
    </div>
  );
}
