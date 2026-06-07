/**
 * PreviewTopBar - Bar above the video preview with output canvas and crop controls.
 *
 * Always shows the Output Canvas size selector. When crop edit mode is on,
 * adds aspect-ratio presets, lock A/R toggle, Fill, Reset, and a Done button.
 */
import {
  Crop,
  Lock,
  Unlock,
  Maximize2,
  RotateCcw,
  Check,
  Info,
  Download,
} from 'lucide-react';
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
  onExport: () => void;
}

function ExportButton({ onExport }: { onExport: () => void }) {
  return (
    <Button
      onClick={onExport}
      className="btn-accent h-7 px-2.5 rounded-md flex items-center gap-1.5"
    >
      <Download className="w-3 h-3" />
      <span className="text-[11px] font-medium">Export</span>
    </Button>
  );
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

function isCropEnabled(crop: CropConfig) {
  return crop.enabled && crop.width > 0 && crop.height > 0;
}

function getManualCompositionSize(composition: ExportConfig['composition']) {
  switch (composition?.mode) {
    case 'manual':
      return getNullableCompositionSize(composition.width, composition.height);
    default:
      return null;
  }
}

function getNullableCompositionSize(width: number | null, height: number | null) {
  return width && height ? { width, height } : null;
}

function getOutputCanvasValue(project: VideoProject) {
  const manualSize = getManualCompositionSize(project.export.composition);
  return manualSize ? `${manualSize.width}x${manualSize.height}` : 'auto';
}

function getResolvedOutputSize(project: VideoProject, videoWidth: number, videoHeight: number) {
  const bg = project.export.background;
  const { width: contentW, height: contentH } = getContentDimensionsFromCrop(
    project.export.crop,
    videoWidth,
    videoHeight
  );
  const padding = hasVideoBackgroundFrameStyling(bg) ? (bg?.padding ?? 0) : 0;
  return calculateCompositionOutputSize(
    contentW,
    contentH,
    padding,
    project.export.composition
  );
}

function getCompositionFromCanvasValue(value: string): ExportConfig['composition'] {
  if (value === 'auto') {
    return {
      mode: 'auto',
      aspectRatio: null,
      aspectPreset: null,
      width: null,
      height: null,
    };
  }

  const [w, h] = value.split('x').map(Number);
  return { mode: 'manual', aspectRatio: w / h, aspectPreset: value, width: w, height: h };
}

function getCurrentRatioValue(
  crop: CropConfig,
  cropEnabled: boolean,
  videoWidth: number,
  videoHeight: number,
) {
  if (!hasActiveCropRatio(crop, cropEnabled)) return 'free';

  const ratio = crop.width / crop.height;
  if (matchesAspectRatio(ratio, videoWidth / videoHeight)) return 'original';

  return getMatchedAspectPresetValue(ratio) ?? 'free';
}

function hasActiveCropRatio(crop: CropConfig, cropEnabled: boolean) {
  return cropEnabled && crop.width > 0 && crop.height > 0;
}

function matchesAspectRatio(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

function getMatchedAspectPresetValue(ratio: number) {
  const matched = ASPECT_PRESETS.find(
    (preset) => typeof preset.value === 'number' && matchesAspectRatio(preset.value, ratio)
  );
  return matched?.value.toString();
}

function getAspectPresetCrop(
  crop: CropConfig,
  value: string | null,
  videoWidth: number,
  videoHeight: number,
) {
  if (!value || value === 'free') {
    return { ...crop, enabled: true, lockAspectRatio: false, aspectRatio: null };
  }

  if (value === 'original') {
    return {
      ...crop,
      enabled: true,
      lockAspectRatio: true,
      aspectRatio: videoWidth / videoHeight,
      x: 0,
      y: 0,
      width: videoWidth,
      height: videoHeight,
    };
  }

  return getCenteredAspectCrop(crop, parseFloat(value), videoWidth, videoHeight);
}

function getCenteredAspectCrop(
  crop: CropConfig,
  ratio: number,
  videoWidth: number,
  videoHeight: number,
) {
  const videoAspect = videoWidth / videoHeight;
  if (ratio > videoAspect) {
    const height = Math.round(videoWidth / ratio);
    return {
      ...crop,
      enabled: true,
      lockAspectRatio: true,
      aspectRatio: ratio,
      x: 0,
      y: Math.round((videoHeight - height) / 2),
      width: videoWidth,
      height,
    };
  }

  const width = Math.round(videoHeight * ratio);
  return {
    ...crop,
    enabled: true,
    lockAspectRatio: true,
    aspectRatio: ratio,
    x: Math.round((videoWidth - width) / 2),
    y: 0,
    width,
    height: videoHeight,
  };
}

function getFilledCrop(crop: CropConfig, videoWidth: number, videoHeight: number) {
  if (crop.lockAspectRatio && crop.aspectRatio) {
    return getCenteredAspectCrop(crop, crop.aspectRatio, videoWidth, videoHeight);
  }

  return {
    ...crop,
    enabled: true,
    x: 0,
    y: 0,
    width: videoWidth,
    height: videoHeight,
  };
}

interface CropEditingToolbarProps {
  project: VideoProject;
  crop: CropConfig;
  currentRatioValue: string;
  onAspectPreset: (value: string | null) => void;
  onToggleLock: () => void;
  onFill: () => void;
  onResetCrop: () => void;
  onDone: () => void;
  onExport: () => void;
}

function CropEditingToolbar({
  project,
  crop,
  currentRatioValue,
  onAspectPreset,
  onToggleLock,
  onFill,
  onResetCrop,
  onDone,
  onExport,
}: CropEditingToolbarProps) {
  return (
    <>
      <Crop className="h-3.5 w-3.5 text-[var(--accent-500)]" />
      <span className="text-xs font-medium text-[var(--ink-dark)]">Crop</span>

      <div className="mx-1 h-5 w-px bg-[var(--glass-border)]" aria-hidden="true" />

      <ToggleGroup
        type="single"
        value={currentRatioValue}
        onValueChange={onAspectPreset}
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
        onClick={onToggleLock}
        className={`h-7 gap-1 px-2 text-[11px] ${
          crop.lockAspectRatio
            ? 'bg-[var(--accent-100)] text-[var(--accent-500)] border-[var(--accent-300)] hover:bg-[var(--accent-200)]'
            : ''
        }`}
        title={crop.lockAspectRatio ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
      >
        {crop.lockAspectRatio ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onFill}
        className="h-7 gap-1 px-2 text-[11px]"
        title="Fill video"
      >
        <Maximize2 className="h-3 w-3" />
        Fill
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onResetCrop}
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
          onClick={onDone}
          className="h-7 gap-1 px-2 text-[11px]"
        >
          <Check className="h-3 w-3" />
          Done
        </Button>
        <ProjectInfoButton project={project} />
        <ExportButton onExport={onExport} />
      </div>
    </>
  );
}

interface OutputToolbarProps {
  project: VideoProject;
  crop: CropConfig;
  cropEnabled: boolean;
  outputCanvasValue: string;
  resolvedOutput: { width: number; height: number };
  onOutputCanvas: (value: string) => void;
  onStartCrop: () => void;
  onResetCrop: () => void;
  onExport: () => void;
}

function OutputToolbar({
  project,
  crop,
  cropEnabled,
  outputCanvasValue,
  resolvedOutput,
  onOutputCanvas,
  onStartCrop,
  onResetCrop,
  onExport,
}: OutputToolbarProps) {
  return (
    <>
      <span className="text-[11px] text-[var(--ink-muted)]">Output</span>
      <Select value={outputCanvasValue} onValueChange={onOutputCanvas}>
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
        onClick={onStartCrop}
        className={`h-7 gap-1.5 px-2 text-[11px] ${
          cropEnabled ? 'border-[var(--accent-300)] text-[var(--accent-500)]' : ''
        }`}
      >
        <Crop className="h-3 w-3" />
        {cropEnabled ? `Crop (${crop.width}×${crop.height})` : 'Crop'}
      </Button>
      {cropEnabled && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetCrop}
          className="h-7 px-2 text-[11px] text-[var(--ink-muted)] hover:text-[var(--error)]"
          title="Remove crop"
        >
          Clear
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <ProjectInfoButton project={project} />
        <ExportButton onExport={onExport} />
      </div>
    </>
  );
}

export function PreviewTopBar({
  project,
  isCropEditing,
  onSetIsCropEditing,
  onUpdateExportConfig,
  onExport,
}: PreviewTopBarProps) {
  const videoWidth = project.sources.originalWidth;
  const videoHeight = project.sources.originalHeight;
  const crop = project.export.crop ?? defaultCropFor(videoWidth, videoHeight);
  const cropEnabled = isCropEnabled(crop);
  const outputCanvasValue = getOutputCanvasValue(project);

  // Resolve the actual export canvas size so users can see what "Match Source"
  // produces given the current crop + background-padding combination.
  const resolvedOutput = getResolvedOutputSize(project, videoWidth, videoHeight);

  const handleOutputCanvas = (value: string) => {
    onUpdateExportConfig({ composition: getCompositionFromCanvasValue(value) });
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

  const currentRatioValue = getCurrentRatioValue(crop, cropEnabled, videoWidth, videoHeight);

  const handleAspectPreset = (value: string | null) => {
    updateCrop(getAspectPresetCrop(crop, value, videoWidth, videoHeight));
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
    updateCrop(getFilledCrop(crop, videoWidth, videoHeight));
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
        <CropEditingToolbar
          project={project}
          crop={crop}
          currentRatioValue={currentRatioValue}
          onAspectPreset={handleAspectPreset}
          onToggleLock={handleToggleLock}
          onFill={handleFill}
          onResetCrop={handleResetCrop}
          onDone={() => onSetIsCropEditing(false)}
          onExport={onExport}
        />
      ) : (
        <OutputToolbar
          project={project}
          crop={crop}
          cropEnabled={cropEnabled}
          outputCanvasValue={outputCanvasValue}
          resolvedOutput={resolvedOutput}
          onOutputCanvas={handleOutputCanvas}
          onStartCrop={handleStartCrop}
          onResetCrop={handleResetCrop}
          onExport={onExport}
        />
      )}
    </div>
  );
}
