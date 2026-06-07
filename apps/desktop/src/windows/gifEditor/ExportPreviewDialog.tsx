import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDuration, formatFileSize, qualityLabel } from './frameOps';
import type { ExportPreviewState, GifData, UiState } from './types';

interface ExportPreviewDialogProps {
  preview: ExportPreviewState | null;
  gifData: GifData | null;
  ui: UiState;
  setUi: React.Dispatch<React.SetStateAction<UiState>>;
  isExporting: boolean;
  estimatedBytes: number | null;
  estimating: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onSave: () => void;
  onClose: () => void;
}

type SetGifUi = React.Dispatch<React.SetStateAction<UiState>>;

function getGifCropWidth(gifData: GifData, ui: UiState) {
  return ui.crop ? ui.crop.w : gifData.width;
}

function getGifCropHeight(gifData: GifData, ui: UiState) {
  return ui.crop ? ui.crop.h : gifData.height;
}

function getGifCropSize(gifData: GifData, ui: UiState) {
  return {
    width: getGifCropWidth(gifData, ui),
    height: getGifCropHeight(gifData, ui),
  };
}

function getGifBaseOutputSize(cropSize: { width: number; height: number }, ui: UiState) {
  const usingExplicit =
    ui.outputWidth !== cropSize.width || ui.outputHeight !== cropSize.height;

  return {
    width: usingExplicit ? ui.outputWidth : cropSize.width,
    height: usingExplicit ? ui.outputHeight : cropSize.height,
  };
}

function getRotatedGifOutputSize(baseSize: { width: number; height: number }, rotation: UiState['rotation']) {
  const shouldSwap = rotation === 90 || rotation === 270;
  return {
    outW: Math.max(1, Math.round(shouldSwap ? baseSize.height : baseSize.width)),
    outH: Math.max(1, Math.round(shouldSwap ? baseSize.width : baseSize.height)),
  };
}

function getPreviewTotalDelayMs(preview: ExportPreviewState, speed: number) {
  const safeSpeed = Math.max(0.05, speed);
  return preview.rows.reduce(
    (acc, row) => acc + Math.max(1, Math.round(row.delayMs / safeSpeed)),
    0,
  );
}

function getExportPreviewStats(
  preview: ExportPreviewState,
  gifData: GifData,
  ui: UiState
) {
  const cropSize = getGifCropSize(gifData, ui);
  const baseSize = getGifBaseOutputSize(cropSize, ui);
  const outputSize = getRotatedGifOutputSize(baseSize, ui.rotation);

  return {
    ...outputSize,
    totalDelayMs: getPreviewTotalDelayMs(preview, ui.speed),
  };
}

interface GifExportStatRow {
  label: string;
  value: React.ReactNode;
  className?: string;
}

function getGifExportFlipLabel(ui: UiState) {
  return [ui.flipH && 'H', ui.flipV && 'V'].filter(Boolean).join(' + ');
}

function getOptionalGifExportStats(ui: UiState): GifExportStatRow[] {
  const flipLabel = getGifExportFlipLabel(ui);
  const rows: Array<GifExportStatRow | null> = [
    ui.rotation !== 0 ? { label: 'Rotation', value: `${ui.rotation} deg` } : null,
    flipLabel ? { label: 'Flip', value: flipLabel } : null,
    ui.speed !== 1 ? { label: 'Speed', value: `${ui.speed.toFixed(2)}x` } : null,
  ];

  return rows.filter((row): row is GifExportStatRow => row !== null);
}

function getGifExportStatRows({
  preview,
  outW,
  outH,
  totalDelayMs,
  ui,
}: {
  preview: ExportPreviewState;
  outW: number;
  outH: number;
  totalDelayMs: number;
  ui: UiState;
}): GifExportStatRow[] {
  return [
    { label: 'Frames', value: preview.rows.length, className: 'tabular-nums' },
    { label: 'Duration', value: formatDuration(totalDelayMs), className: 'tabular-nums' },
    { label: 'Dimensions', value: `${outW} x ${outH}`, className: 'tabular-nums' },
    ...getOptionalGifExportStats(ui),
    { label: 'Loop', value: ui.loopForever ? 'Forever' : 'Once' },
  ];
}

function GifExportStatDefinition({ row }: { row: GifExportStatRow }) {
  return (
    <>
      <dt className="text-(--ink-muted)">{row.label}</dt>
      <dd className={row.className}>{row.value}</dd>
    </>
  );
}

function updateGifFpsCap(setUi: SetGifUi, value: string) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    setUi((p) => ({
      ...p,
      fpsCap: Math.max(1, Math.min(60, Math.round(n))),
    }));
  }
}

function updateGifMaxFrameTime(setUi: SetGifUi, value: string) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    setUi((p) => ({
      ...p,
      maxFrameTimeSec: Math.min(60, n),
    }));
  }
}

function GifExportStats({ preview, gifData, ui }: {
  preview: ExportPreviewState;
  gifData: GifData;
  ui: UiState;
}) {
  const { outW, outH, totalDelayMs } = getExportPreviewStats(preview, gifData, ui);
  const rows = getGifExportStatRows({ preview, outW, outH, totalDelayMs, ui });

  return (
    <dl className="grid grid-cols-2 gap-y-1">
      {rows.map((row) => (
        <GifExportStatDefinition key={row.label} row={row} />
      ))}
    </dl>
  );
}

function GifExportQualityControl({ ui, setUi }: { ui: UiState; setUi: SetGifUi }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Quality</Label>
        <span className="text-xs text-(--ink-muted) tabular-nums">
          {Math.round(ui.qualityValue)}
        </span>
      </div>
      <Slider
        value={[ui.qualityValue]}
        min={1}
        max={100}
        step={1}
        onValueChange={(v) =>
          setUi((p) => ({ ...p, qualityValue: v[0] }))
        }
      />
      <span className="text-[10px] text-(--ink-muted)">
        {qualityLabel(ui.qualityValue)}
      </span>
    </div>
  );
}

function GifExportSizeEstimate({
  estimatedBytes,
  estimating,
}: {
  estimatedBytes: number | null;
  estimating: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 mt-1">
      <Label className="text-xs">Preview size</Label>
      <div className="relative rounded-md border border-(--polar-mist) bg-(--polar-mist)/30 h-7 overflow-hidden">
        {estimating && (
          <div className="absolute inset-0 bg-(--accent-400)/15 animate-pulse" />
        )}
        <div className="relative h-full flex items-center justify-center px-2 text-sm tabular-nums">
          <GifExportSizeEstimateContent
            estimatedBytes={estimatedBytes}
            estimating={estimating}
          />
        </div>
      </div>
    </div>
  );
}

function GifExportSizeEstimateContent({
  estimatedBytes,
  estimating,
}: {
  estimatedBytes: number | null;
  estimating: boolean;
}) {
  if (estimatedBytes !== null) {
    return (
      <span>
        {estimating ? 'Calculating... ' : ''}
        {formatFileSize(estimatedBytes)}
      </span>
    );
  }

  return estimating ? <GifExportSizeCalculating /> : <GifExportSizeUnavailable />;
}

function GifExportSizeCalculating() {
  return (
    <span className="flex items-center gap-2 text-(--ink-muted) text-xs">
      <Loader2 className="w-3 h-3 animate-spin" />
      Calculating...
    </span>
  );
}

function GifExportSizeUnavailable() {
  return <span className="text-xs text-(--ink-muted)">-</span>;
}

function GifExportSizeReductionControls({ ui, setUi }: { ui: UiState; setUi: SetGifUi }) {
  return (
    <div className="flex flex-col gap-2 mt-1 pt-3 border-t border-(--polar-mist)">
      <span className="text-xs uppercase tracking-wide text-(--ink-muted)">
        Make file smaller
      </span>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={ui.limitFps}
            onChange={(e) =>
              setUi((p) => ({ ...p, limitFps: e.target.checked }))
            }
          />
          Limit frames/sec
        </label>
        <div className="flex items-center gap-2 pl-5">
          <Input
            type="number"
            min={1}
            max={60}
            step={1}
            value={ui.fpsCap}
            disabled={!ui.limitFps}
            onChange={(e) => updateGifFpsCap(setUi, e.target.value)}
            className="h-7 text-xs w-20"
          />
          <span className="text-[10px] text-(--ink-muted)">fps</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={ui.capFrameTime}
            onChange={(e) =>
              setUi((p) => ({ ...p, capFrameTime: e.target.checked }))
            }
          />
          Cap frame time
        </label>
        <div className="flex items-center gap-2 pl-5">
          <Input
            type="number"
            min={0.01}
            max={60}
            step={0.1}
            value={ui.maxFrameTimeSec}
            disabled={!ui.capFrameTime}
            onChange={(e) => updateGifMaxFrameTime(setUi, e.target.value)}
            className="h-7 text-xs w-20"
          />
          <span className="text-[10px] text-(--ink-muted)">sec</span>
        </div>
      </div>
    </div>
  );
}

interface GifExportPreviewContentProps {
  preview: ExportPreviewState;
  gifData: GifData;
  ui: UiState;
  setUi: React.Dispatch<React.SetStateAction<UiState>>;
  estimatedBytes: number | null;
  estimating: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

function GifExportPreviewContent({
  preview,
  gifData,
  ui,
  setUi,
  estimatedBytes,
  estimating,
  canvasRef,
}: GifExportPreviewContentProps) {
  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0 flex items-center justify-center bg-(--polar-mist)/40 rounded-md p-3 min-h-[260px]">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-[320px] object-contain shadow-md"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
      <div className="w-56 shrink-0 flex flex-col gap-3 text-sm">
        <GifExportStats preview={preview} gifData={gifData} ui={ui} />
        <GifExportQualityControl ui={ui} setUi={setUi} />
        <GifExportSizeEstimate estimatedBytes={estimatedBytes} estimating={estimating} />
        <GifExportSizeReductionControls ui={ui} setUi={setUi} />
      </div>
    </div>
  );
}

function getExportPreviewDialogTitle(preview: ExportPreviewState | null) {
  return preview?.scope === 'selection' ? 'Export selected frames' : 'Export GIF';
}

function handleExportPreviewOpenChange(
  next: boolean,
  isExporting: boolean,
  onClose: () => void
) {
  if (!next && !isExporting) onClose();
}

interface GifExportPreviewSlotProps extends Omit<GifExportPreviewContentProps, 'preview' | 'gifData'> {
  preview: ExportPreviewState | null;
  gifData: GifData | null;
}

function GifExportPreviewSlot({
  preview,
  gifData,
  ui,
  setUi,
  estimatedBytes,
  estimating,
  canvasRef,
}: GifExportPreviewSlotProps) {
  if (!preview || !gifData) return null;

  return (
    <GifExportPreviewContent
      preview={preview}
      gifData={gifData}
      ui={ui}
      setUi={setUi}
      estimatedBytes={estimatedBytes}
      estimating={estimating}
      canvasRef={canvasRef}
    />
  );
}

function ExportSaveButtonContent({ isExporting }: { isExporting: boolean }) {
  if (isExporting) {
    return (
      <>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Exporting...
      </>
    );
  }

  return (
    <>
      <Download className="w-4 h-4 mr-2" />
      Save...
    </>
  );
}

export const ExportPreviewDialog: React.FC<ExportPreviewDialogProps> = ({
  preview,
  gifData,
  ui,
  setUi,
  isExporting,
  estimatedBytes,
  estimating,
  canvasRef,
  onSave,
  onClose,
}) => (
  <Dialog
    open={!!preview}
    onOpenChange={(next) => handleExportPreviewOpenChange(next, isExporting, onClose)}
  >
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{getExportPreviewDialogTitle(preview)}</DialogTitle>
        <DialogDescription>
          Preview the output before saving. Playback loops at the configured
          speed.
        </DialogDescription>
      </DialogHeader>

      <GifExportPreviewSlot
        preview={preview}
        gifData={gifData}
        ui={ui}
        setUi={setUi}
        estimatedBytes={estimatedBytes}
        estimating={estimating}
        canvasRef={canvasRef}
      />

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={isExporting}>
          <ExportSaveButtonContent isExporting={isExporting} />
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
