/**
 * PreviewTopBar - Bar above the video preview with output canvas and crop controls.
 *
 * Always shows the Output Canvas size selector. When crop edit mode is on,
 * adds aspect-ratio presets, lock A/R toggle, Fill, Reset, and a Done button.
 */
import { Crop, Lock, Unlock, Maximize2, RotateCcw, Check, Info } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { calculateCompositionOutputSize } from '@/utils/compositionBounds';
import { hasVideoBackgroundFrameStyling } from '@/utils/backgroundFrameStyling';
import { getContentDimensionsFromCrop } from '@/utils/videoContentDimensions';
import { ProjectInfoPanel } from './panels/ProjectInfoPanel';
import type { CropConfig, VideoProject, ExportConfig } from '../../types';

function ProjectInfoButton({ project }: { project: VideoProject }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Project info"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:text-[var(--ink-dark)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64">
        <ProjectInfoPanel project={project} />
      </PopoverContent>
    </Popover>
  );
}

interface PreviewTopBarProps {
  project: VideoProject;
  isCropEditing: boolean;
  onSetIsCropEditing: (enabled: boolean) => void;
  onUpdateExportConfig: (updates: Partial<ExportConfig>) => void;
}

const ASPECT_PRESETS: Array<{ label: string; value: 'free' | 'original' | number }> = [
  { label: 'Free', value: 'free' },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: 'Original', value: 'original' },
];

function defaultCropFor(videoWidth: number, videoHeight: number): CropConfig {
  return {
    enabled: true,
    x: 0,
    y: 0,
    width: videoWidth,
    height: videoHeight,
    lockAspectRatio: false,
    aspectRatio: null,
  };
}

export function PreviewTopBar({
  project,
  isCropEditing,
  onSetIsCropEditing,
  onUpdateExportConfig,
}: PreviewTopBarProps) {
  const videoWidth = project.sources.originalWidth;
  const videoHeight = project.sources.originalHeight;
  const crop = project.export.crop ?? defaultCropFor(videoWidth, videoHeight);
  const cropEnabled = crop.enabled && (crop.width > 0 && crop.height > 0);

  const compositionMode = project.export.composition?.mode;
  const compositionWidth = project.export.composition?.width;
  const compositionHeight = project.export.composition?.height;
  const outputCanvasValue =
    compositionMode === 'manual' && compositionWidth && compositionHeight
      ? `${compositionWidth}x${compositionHeight}`
      : 'auto';

  // Resolve the actual export canvas size so users can see what "Match Source"
  // produces given the current crop + background-padding combination.
  const bg = project.export.background;
  const { width: contentW, height: contentH } = getContentDimensionsFromCrop(
    project.export.crop,
    videoWidth,
    videoHeight
  );
  const padding = hasVideoBackgroundFrameStyling(bg) ? (bg?.padding ?? 0) : 0;
  const resolvedOutput = calculateCompositionOutputSize(
    contentW,
    contentH,
    padding,
    project.export.composition
  );

  const handleOutputCanvas = (value: string) => {
    if (value === 'auto') {
      onUpdateExportConfig({
        composition: {
          mode: 'auto',
          aspectRatio: null,
          aspectPreset: null,
          width: null,
          height: null,
        },
      });
    } else {
      const [w, h] = value.split('x').map(Number);
      onUpdateExportConfig({
        composition: { mode: 'manual', aspectRatio: w / h, aspectPreset: value, width: w, height: h },
      });
    }
  };

  const updateCrop = (next: CropConfig) => {
    onUpdateExportConfig({ crop: next });
  };

  const handleStartCrop = () => {
    // Initialize crop to full video if not yet enabled.
    if (!cropEnabled) {
      updateCrop(defaultCropFor(videoWidth, videoHeight));
    }
    onSetIsCropEditing(true);
  };

  const currentRatioValue = (() => {
    if (!cropEnabled || crop.width <= 0 || crop.height <= 0) return 'free';
    const ratio = crop.width / crop.height;
    const originalAspect = videoWidth / videoHeight;
    if (Math.abs(ratio - originalAspect) < 0.01) return 'original';
    const matched = ASPECT_PRESETS.find(
      (p) => typeof p.value === 'number' && Math.abs(p.value - ratio) < 0.01
    );
    return matched ? matched.value.toString() : 'free';
  })();

  const handleAspectPreset = (value: string | null) => {
    if (!value || value === 'free') {
      updateCrop({ ...crop, enabled: true, lockAspectRatio: false, aspectRatio: null });
      return;
    }

    if (value === 'original') {
      updateCrop({
        ...crop,
        enabled: true,
        lockAspectRatio: true,
        aspectRatio: videoWidth / videoHeight,
        x: 0,
        y: 0,
        width: videoWidth,
        height: videoHeight,
      });
      return;
    }

    const ratio = parseFloat(value);
    const videoAspect = videoWidth / videoHeight;
    let w: number;
    let h: number;
    let x: number;
    let y: number;

    if (ratio > videoAspect) {
      w = videoWidth;
      h = Math.round(videoWidth / ratio);
      x = 0;
      y = Math.round((videoHeight - h) / 2);
    } else {
      h = videoHeight;
      w = Math.round(videoHeight * ratio);
      x = Math.round((videoWidth - w) / 2);
      y = 0;
    }

    updateCrop({
      ...crop,
      enabled: true,
      lockAspectRatio: true,
      aspectRatio: ratio,
      x,
      y,
      width: w,
      height: h,
    });
  };

  const handleToggleLock = () => {
    updateCrop({
      ...crop,
      enabled: true,
      lockAspectRatio: !crop.lockAspectRatio,
      aspectRatio: crop.lockAspectRatio ? null : crop.width / crop.height,
    });
  };

  const handleFill = () => {
    if (crop.lockAspectRatio && crop.aspectRatio) {
      const videoAspect = videoWidth / videoHeight;
      if (crop.aspectRatio > videoAspect) {
        const newHeight = Math.round(videoWidth / crop.aspectRatio);
        updateCrop({
          ...crop,
          enabled: true,
          x: 0,
          y: Math.round((videoHeight - newHeight) / 2),
          width: videoWidth,
          height: newHeight,
        });
      } else {
        const newWidth = Math.round(videoHeight * crop.aspectRatio);
        updateCrop({
          ...crop,
          enabled: true,
          x: Math.round((videoWidth - newWidth) / 2),
          y: 0,
          width: newWidth,
          height: videoHeight,
        });
      }
    } else {
      updateCrop({
        ...crop,
        enabled: true,
        x: 0,
        y: 0,
        width: videoWidth,
        height: videoHeight,
      });
    }
  };

  const handleResetCrop = () => {
    updateCrop({
      enabled: false,
      x: 0,
      y: 0,
      width: videoWidth,
      height: videoHeight,
      lockAspectRatio: false,
      aspectRatio: null,
    });
    onSetIsCropEditing(false);
  };

  return (
    <div className="flex h-10 items-center gap-2 border-b border-[var(--glass-border)] bg-[var(--polar-mist)] px-3">
      {isCropEditing ? (
        <>
          <Crop className="h-3.5 w-3.5 text-[var(--coral-500)]" />
          <span className="text-xs font-medium text-[var(--ink-dark)]">Crop</span>

          <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden="true" />

          <ToggleGroup
            type="single"
            value={currentRatioValue}
            onValueChange={handleAspectPreset}
            className="flex-wrap"
          >
            {ASPECT_PRESETS.map((preset) => (
              <ToggleGroupItem
                key={preset.label}
                value={preset.value.toString()}
                className="h-7 px-2 text-[11px]"
              >
                {preset.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden="true" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleLock}
            className={`h-7 gap-1 px-2 text-[11px] ${
              crop.lockAspectRatio
                ? 'bg-[var(--coral-100)] text-[var(--coral-500)] border-[var(--coral-300)] hover:bg-[var(--coral-200)]'
                : ''
            }`}
            title={crop.lockAspectRatio ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
          >
            {crop.lockAspectRatio ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFill}
            className="h-7 gap-1 px-2 text-[11px]"
            title="Fill video"
          >
            <Maximize2 className="h-3 w-3" />
            Fill
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetCrop}
            className="h-7 gap-1 px-2 text-[11px]"
            title="Remove crop"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--ink-muted)]">
              {crop.width} × {crop.height}
            </span>
            <Button
              size="sm"
              onClick={() => onSetIsCropEditing(false)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Check className="h-3 w-3" />
              Done
            </Button>
            <ProjectInfoButton project={project} />
          </div>
        </>
      ) : (
        <>
          <span className="text-[11px] text-[var(--ink-muted)]">Output</span>
          <Select value={outputCanvasValue} onValueChange={handleOutputCanvas}>
            <SelectTrigger className="h-7 w-[160px] border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-xs text-[var(--ink-dark)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
              <SelectItem value="auto">Match Source</SelectItem>
              <SelectItem value="3840x2160">4K (3840×2160)</SelectItem>
              <SelectItem value="1920x1080">1080p (1920×1080)</SelectItem>
              <SelectItem value="1280x720">720p (1280×720)</SelectItem>
              <SelectItem value="1080x1920">Portrait (1080×1920)</SelectItem>
              <SelectItem value="1080x1080">Square (1080×1080)</SelectItem>
            </SelectContent>
          </Select>
          <span className="font-mono text-[11px] text-[var(--ink-muted)] tabular-nums">
            {resolvedOutput.width}×{resolvedOutput.height}
          </span>

          <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden="true" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleStartCrop}
            className={`h-7 gap-1.5 px-2 text-[11px] ${
              cropEnabled ? 'border-[var(--coral-300)] text-[var(--coral-500)]' : ''
            }`}
          >
            <Crop className="h-3 w-3" />
            {cropEnabled ? `Crop (${crop.width}×${crop.height})` : 'Crop'}
          </Button>
          {cropEnabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetCrop}
              className="h-7 px-2 text-[11px] text-[var(--ink-muted)] hover:text-[var(--error)]"
              title="Remove crop"
            >
              Clear
            </Button>
          )}

          <div className="ml-auto">
            <ProjectInfoButton project={project} />
          </div>
        </>
      )}
    </div>
  );
}
