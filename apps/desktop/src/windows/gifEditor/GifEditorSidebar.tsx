import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Crop,
  Download,
  FlipHorizontal,
  FlipVertical,
  Link as LinkIcon,
  Loader2,
  RotateCcw,
  RotateCw,
  Trash2,
  Unlink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { GifInfo } from '@/types/generated/GifInfo';
import { formatDuration, formatFileSize } from './frameOps';
import {
  getGifBaselineSize,
  getGifScalePercent,
  parseGifOutputDimension,
  resizeGifHeight,
  resizeGifWidth,
  scaleGifOutputSize,
} from './sizeOps';
import type { GifData, UiState } from './types';

type GifLoaderData = GifData;
type GifLoaderInfo = GifInfo;
type SetGifEditorUi = Dispatch<SetStateAction<UiState>>;

interface GifSourceSummaryProps {
  info: GifLoaderInfo | null;
  sourceDurationMs: number;
  fileSize: number;
}
function GifSourceSummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-(--ink-muted)">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function getGifDimensionsLabel(info: GifLoaderInfo | null) {
  return info ? `${info.width} x ${info.height}` : '-';
}

function GifSourceSummary({
  info,
  sourceDurationMs,
  fileSize,
}: GifSourceSummaryProps) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-(--ink-muted)">Source</h3>
      <dl className="text-sm grid grid-cols-2 gap-y-1">
        <GifSourceSummaryRow label="Dimensions" value={getGifDimensionsLabel(info)} />
        <GifSourceSummaryRow label="Duration" value={formatDuration(sourceDurationMs)} />
        <GifSourceSummaryRow label="Frames" value={info?.frameCount ?? '-'} />
        <GifSourceSummaryRow label="FPS" value={info ? info.fps.toFixed(1) : '-'} />
        <GifSourceSummaryRow label="Size" value={formatFileSize(fileSize)} />
      </dl>
    </section>
  );
}

interface GifSizeControlsProps {
  gifData: GifLoaderData;
  ui: UiState;
  setUi: SetGifEditorUi;
}

function GifDimensionInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="text-[10px] uppercase text-(--ink-muted)">{label}</span>
      <Input
        type="number"
        min={1}
        max={4096}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-sm"
      />
    </div>
  );
}

function GifAspectToggle({
  keepAspect,
  onToggle,
}: {
  keepAspect: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 mt-4"
      onClick={onToggle}
      title={keepAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
      aria-label="Toggle aspect ratio lock"
    >
      {keepAspect ? (
        <LinkIcon className="w-4 h-4" />
      ) : (
        <Unlink className="w-4 h-4" />
      )}
    </Button>
  );
}

function GifSizeControls({ gifData, ui, setUi }: GifSizeControlsProps) {
  const baseline = getGifBaselineSize(gifData, ui);
  const pct = getGifScalePercent(ui.outputWidth, baseline.width);

  const updateWidth = (value: string) => {
    const width = parseGifOutputDimension(value);
    setUi((previous) => resizeGifWidth(previous, width, baseline));
  };

  const updateHeight = (value: string) => {
    const height = parseGifOutputDimension(value);
    setUi((previous) => resizeGifHeight(previous, height, baseline));
  };

  const updateScale = (value: number) => {
    setUi((previous) => scaleGifOutputSize(previous, value, baseline));
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm">Size</Label>
      <div className="flex items-center gap-2">
        <GifDimensionInput label="W" value={ui.outputWidth} onChange={updateWidth} />
        <GifAspectToggle
          keepAspect={ui.keepAspect}
          onToggle={() => setUi((previous) => ({
            ...previous,
            keepAspect: !previous.keepAspect,
          }))}
        />
        <GifDimensionInput label="H" value={ui.outputHeight} onChange={updateHeight} />
      </div>
      <div className="flex items-center gap-2">
        <Slider
          className="flex-1"
          value={[pct]}
          min={10}
          max={300}
          step={1}
          onValueChange={(value) => updateScale(value[0])}
        />
        <span className="text-xs text-(--ink-muted) min-w-[44px] text-right tabular-nums">
          {pct}%
        </span>
      </div>
      <button
        type="button"
        className="text-xs text-(--ink-muted) hover:text-(--accent-400) text-left"
        onClick={() =>
          setUi((previous) => ({
            ...previous,
            outputWidth: baseline.width,
            outputHeight: baseline.height,
          }))
        }
      >
        Reset to {baseline.width} × {baseline.height}
      </button>
    </div>
  );
}

interface GifCropControlsProps {
  crop: UiState['crop'];
  cropEditing: boolean;
  onEnterCropEditing: () => void;
  onApplyCrop: () => void;
  onCancelCropEditing: () => void;
  onRemoveCrop: () => void;
}

type GifCropControlsMode = 'empty' | 'editing' | 'applied';

function getGifCropControlsMode(crop: UiState['crop'], cropEditing: boolean): GifCropControlsMode {
  if (cropEditing) return 'editing';
  return crop ? 'applied' : 'empty';
}

function GifCropSummary({ crop }: { crop: UiState['crop'] }) {
  if (!crop) return null;

  return (
    <span className="text-xs text-(--ink-muted) tabular-nums">
      {crop.w} × {crop.h}
    </span>
  );
}

function GifCropControls({
  crop,
  cropEditing,
  onEnterCropEditing,
  onApplyCrop,
  onCancelCropEditing,
  onRemoveCrop,
}: GifCropControlsProps) {
  const contentByMode: Record<GifCropControlsMode, ReactNode> = {
    empty: (
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={onEnterCropEditing}
      >
        <Crop className="w-3.5 h-3.5 mr-1" /> Crop
      </Button>
    ),
    editing: (
      <>
        <div className="flex gap-1">
          <Button size="sm" className="flex-1 text-xs" onClick={onApplyCrop}>
            Apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={onCancelCropEditing}
          >
            Cancel
          </Button>
        </div>
        <p className="text-[10px] text-(--ink-muted) leading-snug">
          Drag the rectangle on the preview, then click Apply.
        </p>
      </>
    ),
    applied: (
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={onEnterCropEditing}
        >
          <Crop className="w-3.5 h-3.5 mr-1" /> Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={onRemoveCrop}
          title="Remove crop"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    ),
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Crop</Label>
        <GifCropSummary crop={crop} />
      </div>
      {contentByMode[getGifCropControlsMode(crop, cropEditing)]}
    </div>
  );
}

interface GifEditControlsProps {
  gifData: GifLoaderData | null;
  ui: UiState;
  setUi: SetGifEditorUi;
  cropEditing: boolean;
  rowsCount: number;
  onEnterCropEditing: () => void;
  onApplyCrop: () => void;
  onCancelCropEditing: () => void;
  onRemoveCrop: () => void;
  onReverseFrames: () => void;
}

function GifEditControls({
  gifData,
  ui,
  setUi,
  cropEditing,
  rowsCount,
  onEnterCropEditing,
  onApplyCrop,
  onCancelCropEditing,
  onRemoveCrop,
  onReverseFrames,
}: GifEditControlsProps) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-wide text-(--ink-muted)">Edits</h3>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <Label className="text-sm">Speed</Label>
          <span className="text-xs text-(--ink-muted)">{ui.speed.toFixed(2)}×</span>
        </div>
        <Slider
          value={[ui.speed]}
          min={0.25}
          max={4}
          step={0.05}
          onValueChange={(value) => setUi((previous) => ({
            ...previous,
            speed: value[0],
          }))}
        />
      </div>

      {gifData && <GifSizeControls gifData={gifData} ui={ui} setUi={setUi} />}

      <GifCropControls
        crop={ui.crop}
        cropEditing={cropEditing}
        onEnterCropEditing={onEnterCropEditing}
        onApplyCrop={onApplyCrop}
        onCancelCropEditing={onCancelCropEditing}
        onRemoveCrop={onRemoveCrop}
      />

      <div className="flex flex-col gap-2">
        <Label className="text-sm">Rotation</Label>
        <div className="flex gap-1">
          {([
            { v: 0, label: 'None' },
            { v: 90, label: '90° CW', icon: <RotateCw className="w-3.5 h-3.5" /> },
            { v: 180, label: '180°' },
            { v: 270, label: '90° CCW', icon: <RotateCcw className="w-3.5 h-3.5" /> },
          ] as const).map((option) => (
            <Button
              key={option.v}
              variant={ui.rotation === option.v ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() =>
                setUi((previous) => ({
                  ...previous,
                  rotation: option.v as UiState['rotation'],
                }))
              }
            >
              {'icon' in option && option.icon ? option.icon : option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm">Flip</Label>
        <div className="flex gap-1">
          <Button
            variant={ui.flipH ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => setUi((previous) => ({
              ...previous,
              flipH: !previous.flipH,
            }))}
            title="Flip horizontally"
          >
            <FlipHorizontal className="w-3.5 h-3.5 mr-1" />
            Horizontal
          </Button>
          <Button
            variant={ui.flipV ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => setUi((previous) => ({
              ...previous,
              flipV: !previous.flipV,
            }))}
            title="Flip vertically"
          >
            <FlipVertical className="w-3.5 h-3.5 mr-1" />
            Vertical
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm">Reverse frames</Label>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={onReverseFrames}
          disabled={rowsCount === 0}
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reverse
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="loop-switch" className="text-sm">Loop forever</Label>
        <Switch
          id="loop-switch"
          checked={ui.loopForever}
          onCheckedChange={(value) => setUi((previous) => ({
            ...previous,
            loopForever: value,
          }))}
        />
      </div>
    </section>
  );
}

interface GifEditorSidebarProps {
  info: GifLoaderInfo | null;
  sourceDurationMs: number;
  fileSize: number;
  gifData: GifLoaderData | null;
  ui: UiState;
  setUi: SetGifEditorUi;
  cropEditing: boolean;
  rowsCount: number;
  isExporting: boolean;
  onEnterCropEditing: () => void;
  onApplyCrop: () => void;
  onCancelCropEditing: () => void;
  onRemoveCrop: () => void;
  onReverseFrames: () => void;
  onExport: () => void;
}

export function GifEditorSidebar({
  info,
  sourceDurationMs,
  fileSize,
  gifData,
  ui,
  setUi,
  cropEditing,
  rowsCount,
  isExporting,
  onEnterCropEditing,
  onApplyCrop,
  onCancelCropEditing,
  onRemoveCrop,
  onReverseFrames,
  onExport,
}: GifEditorSidebarProps) {
  return (
    <aside className="w-[320px] shrink-0 border-l border-(--polar-mist) flex flex-col bg-[var(--card)]">
      <div className="p-5 flex flex-col gap-5 overflow-y-auto">
        <GifSourceSummary
          info={info}
          sourceDurationMs={sourceDurationMs}
          fileSize={fileSize}
        />
        <GifEditControls
          gifData={gifData}
          ui={ui}
          setUi={setUi}
          cropEditing={cropEditing}
          rowsCount={rowsCount}
          onEnterCropEditing={onEnterCropEditing}
          onApplyCrop={onApplyCrop}
          onCancelCropEditing={onCancelCropEditing}
          onRemoveCrop={onRemoveCrop}
          onReverseFrames={onReverseFrames}
        />
      </div>

      <div className="mt-auto p-5 border-t border-(--polar-mist)">
        <Button
          className="w-full"
          onClick={onExport}
          disabled={isExporting || !info || rowsCount === 0}
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Export GIF…
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
