/**
 * GifEditorWindow - Dedicated window for editing GIFs.
 *
 * The display pipeline parses the GIF entirely in the browser with gifuct-js
 * (no disk roundtrip, no Rust IPC per frame). The Rust backend is only used
 * on Export to re-encode the final GIF through FFmpeg.
 *
 * Layout (Honeycam-inspired):
 *   ┌──────────┬─────────────────────┬──────────┐
 *   │  Frames  │   Preview (canvas)  │  Source  │
 *   │  #1 30ms │                     │  Edits   │
 *   │  ...     │                     │  Export  │
 *   └──────────┴─────────────────────┴──────────┘
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Download,
  FlipHorizontal,
  FlipVertical,
  Link as LinkIcon,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trash2,
  Unlink,
} from 'lucide-react';
import { toast } from 'sonner';

import { HudTitlebar } from '@/components/Titlebar/Titlebar';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useTheme } from '@/hooks/useTheme';
import { GifCropOverlay } from '@/components/Editor/GifCropOverlay';
import { reportError } from '@/utils/errorReporting';
import { editorLogger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import type { GifEditOptions } from '@/types/generated/GifEditOptions';
import type { GifFrameEncodeOptions } from '@/types/generated/GifFrameEncodeOptions';
import type { GifFrameSpec } from '@/types/generated/GifFrameSpec';
import type { GifEstimateProgress } from '@/types/generated/GifEstimateProgress';
import type { GifCrop } from '@/types/generated/GifCrop';
import type {
  UiState,
  FrameRow,
  DelayDialogState,
  DropDialogState,
  ExportPreviewState,
} from './gifEditor/types';
import { DelayDialog } from './gifEditor/DelayDialog';
import { DropFramesDialog } from './gifEditor/DropFramesDialog';
import { ExportPreviewDialog } from './gifEditor/ExportPreviewDialog';
import { useGifKeyboardShortcuts } from './gifEditor/useGifKeyboardShortcuts';
import { useGifLoader } from './gifEditor/useGifLoader';
import {
  applyFpsLimit,
  applyMaxFrameTime,
  computeDropKeepMask,
  deriveDefaultSavePath,
  formatDuration,
  formatFileSize,
  formatMs,
  newRowId,
  qualityNumericToPreset,
} from './gifEditor/frameOps';
import { renderFrameTo } from './gifEditor/renderFrame';

export interface GifEditorProps {
  /**
   * Path to the GIF file. If omitted, the path is read from the
   * `?path=` query parameter (window mode).
   */
  path?: string;
  /**
   * When true, hides the editor's own Titlebar (the parent window already
   * provides one) and uses a flex container that grows into its parent
   * instead of taking over the viewport.
   */
  embedded?: boolean;
  /** Called when the user wants to leave the editor (Esc, Ctrl+W, etc). */
  onClose?: () => void;
}

type GifLoaderData = NonNullable<ReturnType<typeof useGifLoader>['gifData']>;
type GifLoaderInfo = NonNullable<ReturnType<typeof useGifLoader>['info']>;
type SetGifEditorUi = React.Dispatch<React.SetStateAction<UiState>>;

interface GifBaselineSize {
  width: number;
  height: number;
}

interface GifFrameDragState {
  anchorIndex: number;
  baseSelection: Set<string>;
  additive: boolean;
}

interface GifRowSelectionUpdate {
  frameIndex: number;
  selectedIds: Set<string>;
  lastClickedId?: string;
  dragState: GifFrameDragState;
}

function getActiveGifBounds(gifData: GifLoaderData, ui: UiState) {
  return ui.crop ?? { w: gifData.width, h: gifData.height };
}

function getGifBaselineSize(gifData: GifLoaderData, ui: UiState): GifBaselineSize {
  const bounds = getActiveGifBounds(gifData, ui);
  return {
    width: bounds.w,
    height: bounds.h,
  };
}

function parseGifOutputDimension(value: string): number {
  return Math.max(1, Math.round(Number(value) || 0));
}

function getGifScalePercent(outputWidth: number, baselineWidth: number): number {
  return baselineWidth > 0 ? Math.round((outputWidth / baselineWidth) * 100) : 100;
}

function resizeGifWidth(
  previous: UiState,
  width: number,
  baseline: GifBaselineSize
): UiState {
  if (!previous.keepAspect) return { ...previous, outputWidth: width };

  return {
    ...previous,
    outputWidth: width,
    outputHeight: Math.max(1, Math.round(width * (baseline.height / baseline.width))),
  };
}

function resizeGifHeight(
  previous: UiState,
  height: number,
  baseline: GifBaselineSize
): UiState {
  if (!previous.keepAspect) return { ...previous, outputHeight: height };

  return {
    ...previous,
    outputHeight: height,
    outputWidth: Math.max(1, Math.round(height * (baseline.width / baseline.height))),
  };
}

function scaleGifOutputSize(previous: UiState, value: number, baseline: GifBaselineSize): UiState {
  return {
    ...previous,
    outputWidth: Math.max(1, Math.round((baseline.width * value) / 100)),
    outputHeight: Math.max(1, Math.round((baseline.height * value) / 100)),
  };
}

function getGifRowRangeSelectionUpdate(
  rows: FrameRow[],
  frameIndex: number,
  lastClickedId: string | null
): GifRowSelectionUpdate | null {
  if (!lastClickedId) {
    return null;
  }

  const anchorIndex = rows.findIndex((row) => row.id === lastClickedId);
  if (anchorIndex < 0) {
    return null;
  }

  const [lo, hi] = getGifRowRangeBounds(anchorIndex, frameIndex);
  const next = new Set<string>();
  for (let i = lo; i <= hi; i += 1) next.add(rows[i].id);

  return {
    frameIndex,
    selectedIds: next,
    dragState: {
      anchorIndex,
      baseSelection: new Set(),
      additive: false,
    },
  };
}

function getGifRowRangeBounds(anchorIndex: number, frameIndex: number): [number, number] {
  return anchorIndex < frameIndex ? [anchorIndex, frameIndex] : [frameIndex, anchorIndex];
}

function getGifRowToggleSelectionUpdate(
  id: string,
  frameIndex: number,
  selectedIds: Set<string>
): GifRowSelectionUpdate {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);

  return {
    frameIndex,
    selectedIds: next,
    lastClickedId: id,
    dragState: {
      anchorIndex: frameIndex,
      baseSelection: new Set(next),
      additive: true,
    },
  };
}

function getGifRowSingleSelectionUpdate(id: string, frameIndex: number): GifRowSelectionUpdate {
  return {
    frameIndex,
    selectedIds: new Set([id]),
    lastClickedId: id,
    dragState: {
      anchorIndex: frameIndex,
      baseSelection: new Set(),
      additive: false,
    },
  };
}

function getGifRowIndex(rows: FrameRow[], id: string): number | null {
  const idx = rows.findIndex((row) => row.id === id);
  return idx >= 0 ? idx : null;
}

function isRangeSelectionMouseDown(event: React.MouseEvent, lastClickedId: string | null) {
  return event.shiftKey && lastClickedId !== null;
}

function isToggleSelectionMouseDown(event: React.MouseEvent) {
  return event.ctrlKey || event.metaKey;
}

function getRowMouseDownSelectionMode(event: React.MouseEvent, lastClickedId: string | null) {
  if (isRangeSelectionMouseDown(event, lastClickedId)) {
    return 'range' as const;
  }

  if (isToggleSelectionMouseDown(event)) {
    return 'toggle' as const;
  }

  return 'single' as const;
}

function getSelectionUpdateForMouseMode({
  id,
  mode,
  rows,
  frameIndex,
  selectedIds,
  lastClickedId,
}: {
  id: string;
  mode: ReturnType<typeof getRowMouseDownSelectionMode>;
  rows: FrameRow[];
  frameIndex: number;
  selectedIds: Set<string>;
  lastClickedId: string | null;
}): GifRowSelectionUpdate | null {
  if (mode === 'range' && lastClickedId) {
    return getGifRowRangeSelectionUpdate(rows, frameIndex, lastClickedId);
  }

  if (mode === 'toggle') {
    return getGifRowToggleSelectionUpdate(id, frameIndex, selectedIds);
  }

  return getGifRowSingleSelectionUpdate(id, frameIndex);
}

function getRowMouseDownSelectionUpdate({
  id,
  event,
  rows,
  selectedIds,
  lastClickedId,
}: {
  id: string;
  event: React.MouseEvent;
  rows: FrameRow[];
  selectedIds: Set<string>;
  lastClickedId: string | null;
}): GifRowSelectionUpdate | null {
  if (event.button !== 0) return null;
  const frameIndex = getGifRowIndex(rows, id);
  if (frameIndex === null) return null;

  return getSelectionUpdateForMouseMode({
    id,
    mode: getRowMouseDownSelectionMode(event, lastClickedId),
    rows,
    frameIndex,
    selectedIds,
    lastClickedId,
  });
}

function getGifDragRangeSelection(
  rows: FrameRow[],
  frameIndex: number,
  drag: GifFrameDragState
): Set<string> {
  const [lo, hi] =
    frameIndex < drag.anchorIndex ? [frameIndex, drag.anchorIndex] : [drag.anchorIndex, frameIndex];
  const next = drag.additive ? new Set(drag.baseSelection) : new Set<string>();

  for (let i = lo; i <= hi; i += 1) next.add(rows[i].id);

  return next;
}

function getRowDragSelectionUpdate({
  id,
  event,
  rows,
  drag,
}: {
  id: string;
  event: React.MouseEvent;
  rows: FrameRow[];
  drag: GifFrameDragState;
}) {
  if ((event.buttons & 1) === 0) {
    return { released: true as const };
  }

  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  return {
    frameIndex: idx,
    selectedIds: getGifDragRangeSelection(rows, idx, drag),
  };
}

interface GifSourceSummaryProps {
  info: GifLoaderInfo | null;
  sourceDurationMs: number;
  fileSize: number;
}

function GifSourceSummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
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
  const contentByMode: Record<GifCropControlsMode, React.ReactNode> = {
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

function GifEditorSidebar({
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

function getGifCropPayload(crop: UiState['crop']): GifCrop | null {
  return crop
    ? {
        x: Math.max(0, Math.round(crop.x)),
        y: Math.max(0, Math.round(crop.y)),
        width: Math.max(1, Math.round(crop.w)),
        height: Math.max(1, Math.round(crop.h)),
      }
    : null;
}

function getGifOutputBaseline(ui: UiState, gifData: GifLoaderData | null) {
  if (ui.crop) {
    return {
      width: ui.crop.w,
      height: ui.crop.h,
    };
  }

  if (gifData) {
    return {
      width: gifData.width,
      height: gifData.height,
    };
  }

  return {
    width: 0,
    height: 0,
  };
}

function hasExplicitGifOutputSize(ui: UiState, gifData: GifLoaderData | null) {
  const baseline = getGifOutputBaseline(ui, gifData);
  return !!gifData && (ui.outputWidth !== baseline.width || ui.outputHeight !== baseline.height);
}

function normalizeExplicitGifSize(value: number) {
  return Math.max(1, Math.round(value));
}

function getGifExplicitOutputSize(ui: UiState, gifData: GifLoaderData | null) {
  if (!hasExplicitGifOutputSize(ui, gifData)) {
    return { outputWidth: null, outputHeight: null };
  }

  return {
    outputWidth: normalizeExplicitGifSize(ui.outputWidth),
    outputHeight: normalizeExplicitGifSize(ui.outputHeight),
  };
}

interface GifPreviewTransform {
  crop: UiState['crop'];
  rotation: UiState['rotation'];
  flipH: UiState['flipH'];
  flipV: UiState['flipV'];
}

function getGifPreviewCropBounds(gifData: GifLoaderData, crop: UiState['crop']) {
  if (!crop) {
    return {
      cropX: 0,
      cropY: 0,
      cropW: gifData.width,
      cropH: gifData.height,
    };
  }

  return {
    cropX: crop.x,
    cropY: crop.y,
    cropW: crop.w,
    cropH: crop.h,
  };
}

function getRotatedGifPreviewSize(width: number, height: number, rotation: UiState['rotation']) {
  if (rotation === 90 || rotation === 270) {
    return { dstW: height, dstH: width };
  }

  return { dstW: width, dstH: height };
}

function getGifPreviewDrawBounds(gifData: GifLoaderData, transform: GifPreviewTransform) {
  const cropBounds = getGifPreviewCropBounds(gifData, transform.crop);
  const previewSize = getRotatedGifPreviewSize(
    cropBounds.cropW,
    cropBounds.cropH,
    transform.rotation
  );

  return {
    ...cropBounds,
    ...previewSize,
  };
}

function resizeGifPreviewCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function getGifCanvasContext(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d');
}

function renderGifFrameToOffscreen(gifData: GifLoaderData, row: FrameRow) {
  const offscreen = document.createElement('canvas');
  offscreen.width = gifData.width;
  offscreen.height = gifData.height;
  const offscreenCtx = getGifCanvasContext(offscreen);
  if (!offscreenCtx) return null;

  renderFrameTo(offscreenCtx, gifData, row.sourceIndex);
  return offscreen;
}

function renderCropEditingPreviewFrame(
  canvas: HTMLCanvasElement,
  gifData: GifLoaderData,
  row: FrameRow
) {
  const ctx = getGifCanvasContext(canvas);
  if (!ctx) return;

  resizeGifPreviewCanvas(canvas, gifData.width, gifData.height);
  renderFrameTo(ctx, gifData, row.sourceIndex);
}

function drawTransformedGifPreviewFrame({
  ctx,
  offscreen,
  bounds,
  transform,
}: {
  ctx: CanvasRenderingContext2D;
  offscreen: HTMLCanvasElement;
  bounds: ReturnType<typeof getGifPreviewDrawBounds>;
  transform: GifPreviewTransform;
}) {
  const { cropX, cropY, cropW, cropH, dstW, dstH } = bounds;

  ctx.save();
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.translate(dstW / 2, dstH / 2);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
  ctx.drawImage(
    offscreen,
    cropX,
    cropY,
    cropW,
    cropH,
    -cropW / 2,
    -cropH / 2,
    cropW,
    cropH,
  );
  ctx.restore();
}

function renderEditedGifPreviewFrame(
  canvas: HTMLCanvasElement,
  gifData: GifLoaderData,
  row: FrameRow,
  transform: GifPreviewTransform
) {
  const ctx = getGifCanvasContext(canvas);
  if (!ctx) return;

  const bounds = getGifPreviewDrawBounds(gifData, transform);
  const { dstW, dstH } = bounds;
  resizeGifPreviewCanvas(canvas, dstW, dstH);
  const offscreen = renderGifFrameToOffscreen(gifData, row);
  if (!offscreen) return;

  drawTransformedGifPreviewFrame({ ctx, offscreen, bounds, transform });
}

function renderEditedPreviewIfReady({
  canvas,
  gifData,
  row,
  transform,
}: {
  canvas: HTMLCanvasElement | null;
  gifData: GifLoaderData | null;
  row: FrameRow | undefined;
  transform: GifPreviewTransform;
}): void {
  if (!canvas || !gifData || !row) {
    return;
  }

  renderEditedGifPreviewFrame(canvas, gifData, row, transform);
}

function renderCropEditingPreviewIfReady({
  canvas,
  gifData,
  row,
}: {
  canvas: HTMLCanvasElement | null;
  gifData: GifLoaderData | null;
  row: FrameRow | undefined;
}) {
  if (!canvas || !gifData || !row) {
    return;
  }

  renderCropEditingPreviewFrame(canvas, gifData, row);
}

function renderExportPreviewFrameIfReady({
  canvas,
  exportPreview,
  previewFrameIdx,
  gifData,
  transform,
}: {
  canvas: HTMLCanvasElement | null;
  exportPreview: ExportPreviewState | null;
  previewFrameIdx: number;
  gifData: GifLoaderData | null;
  transform: GifPreviewTransform;
}) {
  if (!exportPreview || !gifData) {
    return;
  }

  renderEditedPreviewIfReady({
    canvas,
    gifData,
    row: exportPreview.rows[previewFrameIdx],
    transform,
  });
}

function getGifPreviewPlaybackDelay(row: FrameRow, speed: number) {
  return Math.max(10, row.delayMs / Math.max(0.05, speed));
}

function getNextPreviewFrameIndex(index: number, rowCount: number) {
  return index + 1 >= rowCount ? 0 : index + 1;
}

function setGifEstimateIfActive(
  cancelled: boolean,
  setEstimatedBytes: React.Dispatch<React.SetStateAction<number | null>>,
  value: number | null
) {
  if (!cancelled) {
    setEstimatedBytes(value);
  }
}

async function estimateGifPreviewSize({
  exportPreview,
  capturePath,
  ui,
  gifData,
  isCancelled,
  setEstimatedBytes,
  setEstimating,
}: {
  exportPreview: ExportPreviewState;
  capturePath: string;
  ui: UiState;
  gifData: GifLoaderData;
  isCancelled: () => boolean;
  setEstimatedBytes: React.Dispatch<React.SetStateAction<number | null>>;
  setEstimating: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  setEstimating(true);
  setEstimatedBytes(null);
  const options = buildGifFrameEncodeOptions(exportPreview.rows, ui, gifData);

  try {
    const size = await invoke<number>('estimate_gif_size_from_frames', {
      inputPath: capturePath,
      options,
    });
    setGifEstimateIfActive(isCancelled(), setEstimatedBytes, size);
  } catch (err) {
    setGifEstimateIfActive(isCancelled(), setEstimatedBytes, null);
    editorLogger.warn('GIF size estimate failed:', err);
  } finally {
    if (!isCancelled()) {
      setEstimating(false);
    }
  }
}

function buildGifFrameManifest(rows: FrameRow[], ui: UiState): GifFrameSpec[] {
  const speed = ui.speed > 0 ? ui.speed : 1;
  let manifest: GifFrameSpec[] = rows.map((row) => ({
    sourceIndex: row.sourceIndex,
    delayMs: Math.max(1, Math.round(row.delayMs / speed)),
  }));

  if (ui.capFrameTime) {
    manifest = applyMaxFrameTime(
      manifest,
      Math.max(10, Math.round(ui.maxFrameTimeSec * 1000))
    );
  }
  if (ui.limitFps) {
    manifest = applyFpsLimit(manifest, ui.fpsCap);
  }

  return manifest;
}

function buildGifFrameEncodeOptions(
  rows: FrameRow[],
  ui: UiState,
  gifData: GifLoaderData | null
): GifFrameEncodeOptions {
  const { outputWidth, outputHeight } = getGifExplicitOutputSize(ui, gifData);
  return {
    frames: buildGifFrameManifest(rows, ui),
    scalePct: 100,
    crop: getGifCropPayload(ui.crop),
    outputWidth,
    outputHeight,
    rotationDegrees: ui.rotation,
    flipH: ui.flipH,
    flipV: ui.flipV,
    loopForever: ui.loopForever,
    quality: qualityNumericToPreset(ui.qualityValue),
    qualityValue: Math.round(ui.qualityValue),
  };
}

function buildGifEditOptions(
  ui: UiState,
  gifData: GifLoaderData | null,
  sourceDurationMs: number
): GifEditOptions {
  const { outputWidth, outputHeight } = getGifExplicitOutputSize(ui, gifData);
  return {
    trimStartMs: 0,
    trimEndMs: Math.max(1, sourceDurationMs),
    speed: ui.speed,
    scalePct: 100,
    reverse: false,
    loopForever: ui.loopForever,
    fps: null,
    crop: getGifCropPayload(ui.crop),
    outputWidth,
    outputHeight,
    rotationDegrees: ui.rotation,
    flipH: ui.flipH,
    flipV: ui.flipV,
    quality: qualityNumericToPreset(ui.qualityValue),
    qualityValue: Math.round(ui.qualityValue),
  };
}

type GifDelayInputMode = DelayDialogState['mode'] | 'ms';

const GIF_DELAY_CONVERTERS: Record<GifDelayInputMode, (value: number) => number> = {
  fps: (value) => Math.round(1000 / value),
  sec: (value) => Math.round(value * 1000),
  ms: Math.round,
};

function parsePositiveGifDelayValue(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 0) return null;
  return numeric;
}

function isGifDelayInRange(delayMs: number) {
  return delayMs >= 1 && delayMs <= 60000;
}

function parseGifDelayMs(
  value: string,
  mode: GifDelayInputMode = 'ms'
) {
  const numeric = parsePositiveGifDelayValue(value);
  if (numeric === null) return null;

  const delayMs = GIF_DELAY_CONVERTERS[mode](numeric);
  return isGifDelayInRange(delayMs) ? delayMs : null;
}

function duplicateSelectedRows(rows: FrameRow[], selectedIds: Set<string>) {
  const out: FrameRow[] = [];
  const newIds: string[] = [];
  for (const row of rows) {
    out.push(row);
    if (selectedIds.has(row.id)) {
      const duplicate: FrameRow = { ...row, id: newRowId(row.sourceIndex) };
      out.push(duplicate);
      newIds.push(duplicate.id);
    }
  }
  return { rows: out, newIds };
}

function getDropDialogStats(dropDialog: DropDialogState | null, rows: FrameRow[]) {
  if (!dropDialog) return null;
  const keep = computeDropKeepMask(rows.length, dropDialog.mode, dropDialog.nValue);
  const keptCount = keep.reduce((acc, keepFrame) => acc + (keepFrame ? 1 : 0), 0);
  const sourceDuration = rows.reduce((acc, row) => acc + row.delayMs, 0);
  const outDuration = dropDialog.keepPlaybackSpeed
    ? sourceDuration
    : keep.reduce((acc, keepFrame, index) => acc + (keepFrame ? rows[index].delayMs : 0), 0);
  return { keptCount, total: rows.length, sourceDuration, outDuration };
}

function getDropKeepState(keep: boolean[]) {
  if (keep.every(Boolean)) return 'all' as const;
  if (keep.every((keepFrame) => !keepFrame)) return 'none' as const;
  return 'some' as const;
}

function appendTrailingDroppedDelay(rows: FrameRow[], carry: number): FrameRow[] {
  if (carry <= 0 || rows.length === 0) {
    return rows;
  }

  const out = [...rows];
  out[out.length - 1] = {
    ...out[out.length - 1],
    delayMs: out[out.length - 1].delayMs + carry,
  };
  return out;
}

function keepRowsWithPlaybackSpeed(rows: FrameRow[], keep: boolean[]) {
  const out: FrameRow[] = [];
  let carry = 0;

  for (let index = 0; index < rows.length; index += 1) {
    if (keep[index]) {
      out.push({ ...rows[index], delayMs: rows[index].delayMs + carry });
      carry = 0;
    } else {
      carry += rows[index].delayMs;
    }
  }

  return appendTrailingDroppedDelay(out, carry);
}

function applyDropFrameSelection(
  rows: FrameRow[],
  dropDialog: DropDialogState
) {
  const keep = computeDropKeepMask(rows.length, dropDialog.mode, dropDialog.nValue);
  const keepState = getDropKeepState(keep);
  if (keepState === 'all') return rows;
  if (keepState === 'none') return null;
  if (!dropDialog.keepPlaybackSpeed) return rows.filter((_, index) => keep[index]);

  return keepRowsWithPlaybackSpeed(rows, keep);
}

function hasGifFrameEdits(info: GifLoaderInfo | null, rows: FrameRow[]) {
  if (!info) return false;
  if (rows.length !== info.frameCount) return true;
  return rows.some(
    (row, index) => row.sourceIndex !== index || row.delayMs !== row.originalDelayMs,
  );
}

function getGifEditorFilename(capturePath: string | null) {
  if (!capturePath) return 'GIF Editor';
  const parts = capturePath.split(/[/\\]/);
  return parts[parts.length - 1] || 'GIF Editor';
}

function getExportDialogOptions(exportPreview: ExportPreviewState, capturePath: string) {
  const baseSavePath = deriveDefaultSavePath(capturePath);
  return {
    title: exportPreview.scope === 'selection'
      ? 'Export selected frames'
      : 'Export GIF',
    defaultPath: exportPreview.scope === 'selection'
      ? baseSavePath.replace(/\.gif$/i, '-selection.gif')
      : baseSavePath,
    filters: [{ name: 'GIF', extensions: ['gif'] }],
  };
}

function getSelectedExportRows(rows: FrameRow[], selectedIds: Set<string>) {
  return rows.filter((row) => selectedIds.has(row.id));
}

function getSelectionExportPreviewState(
  rows: FrameRow[],
  selectedIds: Set<string>
): ExportPreviewState | null {
  const selectedRows = getSelectedExportRows(rows, selectedIds);
  return selectedRows.length > 0
    ? { rows: selectedRows, scope: 'selection' }
    : null;
}

function getAllFramesExportPreviewState(rows: FrameRow[]): ExportPreviewState | null {
  return rows.length > 0 ? { rows, scope: 'all' } : null;
}

function hasSelectedFrames(selectedIds: Set<string>) {
  return selectedIds.size > 0;
}

function applyPendingCrop(cropEditing: boolean, applyCrop: () => void) {
  if (cropEditing) {
    applyCrop();
  }
}

function canUseFullGifProcessCommand({
  exportPreview,
  hasFrameEdits,
  ui,
}: {
  exportPreview: ExportPreviewState;
  hasFrameEdits: boolean;
  ui: UiState;
}): boolean {
  return exportPreview.scope === 'all' && !hasFrameEdits && !ui.limitFps && !ui.capFrameTime;
}

async function invokeGifExportCommand({
  useFullProcess,
  capturePath,
  destination,
  exportRows,
  ui,
  gifData,
  sourceDurationMs,
}: {
  useFullProcess: boolean;
  capturePath: string;
  destination: string;
  exportRows: FrameRow[];
  ui: UiState;
  gifData: GifLoaderData | null;
  sourceDurationMs: number;
}) {
  if (useFullProcess) {
    await invoke('process_gif', {
      inputPath: capturePath,
      outputPath: destination,
      options: buildGifEditOptions(ui, gifData, sourceDurationMs),
    });
    return;
  }

  await invoke('encode_gif_from_frames', {
    inputPath: capturePath,
    outputPath: destination,
    options: buildGifFrameEncodeOptions(exportRows, ui, gifData),
  });
}

async function exportGifFromPreview({
  exportPreview,
  capturePath,
  exportRows,
  hasFrameEdits,
  ui,
  gifData,
  sourceDurationMs,
}: {
  exportPreview: ExportPreviewState;
  capturePath: string;
  exportRows: FrameRow[];
  hasFrameEdits: boolean;
  ui: UiState;
  gifData: GifLoaderData | null;
  sourceDurationMs: number;
}) {
  const destination = await saveFileDialog(getExportDialogOptions(exportPreview, capturePath));
  if (!destination) return false;

  await invokeGifExportCommand({
    useFullProcess: canUseFullGifProcessCommand({ exportPreview, hasFrameEdits, ui }),
    capturePath,
    destination,
    exportRows,
    ui,
    gifData,
    sourceDurationMs,
  });

  return true;
}

interface GifExportRequest {
  exportPreview: ExportPreviewState;
  capturePath: string;
  exportRows: FrameRow[];
}

function hasExportableGifRows(exportPreview: ExportPreviewState | null): exportPreview is ExportPreviewState {
  return Boolean(exportPreview && exportPreview.rows.length > 0);
}

function hasGifExportSource(
  capturePath: string | null,
  info: GifLoaderInfo | null
): capturePath is string {
  return Boolean(capturePath && info);
}

function getGifExportRequest({
  exportPreview,
  capturePath,
  info,
}: {
  exportPreview: ExportPreviewState | null;
  capturePath: string | null;
  info: GifLoaderInfo | null;
}): GifExportRequest | null {
  if (!hasExportableGifRows(exportPreview) || !hasGifExportSource(capturePath, info)) {
    return null;
  }

  return {
    exportPreview,
    capturePath,
    exportRows: exportPreview.rows,
  };
}

async function runGifExportRequest({
  request,
  hasFrameEdits,
  ui,
  gifData,
  sourceDurationMs,
  setIsExporting,
  setExportPreview,
}: {
  request: GifExportRequest;
  hasFrameEdits: boolean;
  ui: UiState;
  gifData: GifLoaderData | null;
  sourceDurationMs: number;
  setIsExporting: React.Dispatch<React.SetStateAction<boolean>>;
  setExportPreview: React.Dispatch<React.SetStateAction<ExportPreviewState | null>>;
}) {
  try {
    setIsExporting(true);
    const didExport = await exportGifFromPreview({
      exportPreview: request.exportPreview,
      capturePath: request.capturePath,
      exportRows: request.exportRows,
      hasFrameEdits,
      ui,
      gifData,
      sourceDurationMs,
    });

    if (didExport) {
      toast.success(getGifExportSuccessMessage(request.exportPreview, request.exportRows.length));
      setExportPreview(null);
    }
  } catch (err) {
    reportError(err, { operation: 'gif export' });
    toast.error(getGifExportErrorMessage(err));
  } finally {
    setIsExporting(false);
  }
}

function getGifExportSuccessMessage(
  exportPreview: ExportPreviewState,
  exportedFrameCount: number
) {
  return exportPreview.scope === 'selection'
    ? `Exported ${exportedFrameCount} frames`
    : 'GIF exported';
}

function getGifExportErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return `Failed to export GIF: ${message}`;
}

function getCropEditingStartState(previous: UiState, gifData: GifLoaderData) {
  if (previous.crop) return previous;

  const width = Math.max(16, Math.round(gifData.width * 0.8));
  const height = Math.max(16, Math.round(gifData.height * 0.8));
  return {
    ...previous,
    crop: {
      x: Math.round((gifData.width - width) / 2),
      y: Math.round((gifData.height - height) / 2),
      w: width,
      h: height,
    },
  };
}

function getAppliedCropState(previous: UiState) {
  return previous.crop
    ? { ...previous, outputWidth: previous.crop.w, outputHeight: previous.crop.h }
    : previous;
}

function getCancelledCropDimension(
  cropDimension: number | undefined,
  gifDimension: number | undefined,
  previousDimension: number
): number {
  if (cropDimension !== undefined) {
    return cropDimension;
  }

  return gifDimension !== undefined ? gifDimension : previousDimension;
}

function getGifDataOutputSize(gifData: GifLoaderData | null, previous: UiState) {
  if (!gifData) {
    return {
      outputWidth: previous.outputWidth,
      outputHeight: previous.outputHeight,
    };
  }

  return {
    outputWidth: gifData.width,
    outputHeight: gifData.height,
  };
}

function getCancelledCropOutputSize(
  priorCrop: UiState['crop'],
  gifData: GifLoaderData | null,
  previous: UiState
) {
  const gifOutputSize = getGifDataOutputSize(gifData, previous);
  return {
    outputWidth: getCancelledCropDimension(priorCrop?.w, gifOutputSize.outputWidth, previous.outputWidth),
    outputHeight: getCancelledCropDimension(priorCrop?.h, gifOutputSize.outputHeight, previous.outputHeight),
  };
}

function getCancelledCropState(
  previous: UiState,
  priorCrop: UiState['crop'],
  gifData: GifLoaderData | null
) {
  const next = { ...previous, crop: priorCrop };
  if (!gifData) return next;

  const outputSize = getCancelledCropOutputSize(priorCrop, gifData, previous);
  next.outputWidth = outputSize.outputWidth;
  next.outputHeight = outputSize.outputHeight;
  return next;
}

function getRemovedCropState(previous: UiState, gifData: GifLoaderData | null) {
  return {
    ...previous,
    crop: null,
    ...getGifDataOutputSize(gifData, previous),
  };
}

function getGifEditorOuterClasses(embedded: boolean) {
  return embedded
    ? 'editor-window flex-1 flex flex-col min-h-0'
    : 'editor-window h-screen w-screen flex flex-col overflow-hidden';
}

function renderGifEditorTitlebar(embedded: boolean, detailLabel: string) {
  return embedded ? null : (
    <HudTitlebar
      title="MoonSnap"
      contextLabel="GIF Editor"
      detailLabel={detailLabel}
      showMaximize
    />
  );
}

function renderGifEditorStatusView({
  isLoading,
  error,
  capturePath,
  outerClasses,
  embedded,
}: {
  isLoading: boolean;
  error: string | null;
  capturePath: string | null;
  outerClasses: string;
  embedded: boolean;
}) {
  if (isLoading) {
    return (
      <div className={outerClasses}>
        {renderGifEditorTitlebar(embedded, 'Loading')}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
            <p className="text-sm text-(--ink-muted)">Loading GIF...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className={outerClasses}>
      {renderGifEditorTitlebar(embedded, 'Error')}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-(--error-light) flex items-center justify-center">
            <span className="text-2xl">!</span>
          </div>
          <p className="text-sm text-(--error)">{error}</p>
          {capturePath && (
            <p className="text-xs text-(--ink-muted) break-all">{capturePath}</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface GifFrameListPaneProps {
  rows: FrameRow[];
  selectedIds: Set<string>;
  selectedCount: number;
  currentFrameIndex: number;
  delayInput: string;
  listRef: React.RefObject<HTMLDivElement | null>;
  onRowMouseDown: (id: string, event: React.MouseEvent) => void;
  onRowMouseEnter: (id: string, event: React.MouseEvent) => void;
  onRowDoubleClick: (id: string) => void;
  onRowContextMenu: (row: FrameRow, index: number) => void;
  onExportSelectedFrames: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onOpenDelayDialog: (rowIds: string[]) => void;
  onResetTimings: () => void;
  onOpenDropDialog: () => void;
  onDelayInputChange: (value: string) => void;
  onApplyDelayToSelection: () => void;
  onApplyDelayToAll: () => void;
}

function getGifFrameHeaderLabel(rowCount: number) {
  return rowCount > 0 ? `Frames (${rowCount})` : 'Frames';
}

function GifFrameRow({
  row,
  index,
  selectedIds,
  currentFrameIndex,
  onRowMouseDown,
  onRowMouseEnter,
  onRowDoubleClick,
  onRowContextMenu,
}: {
  row: FrameRow;
  index: number;
  selectedIds: Set<string>;
  currentFrameIndex: number;
  onRowMouseDown: (id: string, event: React.MouseEvent) => void;
  onRowMouseEnter: (id: string, event: React.MouseEvent) => void;
  onRowDoubleClick: (id: string) => void;
  onRowContextMenu: (row: FrameRow, index: number) => void;
}) {
  const isSelected = selectedIds.has(row.id);
  const isPlayhead = index === currentFrameIndex;
  const isCustomDelay = row.delayMs !== row.originalDelayMs;

  return (
    <tr
      key={row.id}
      data-row-id={row.id}
      data-row-index={index}
      onMouseDown={(event) => onRowMouseDown(row.id, event)}
      onMouseEnter={(event) => onRowMouseEnter(row.id, event)}
      onDoubleClick={() => onRowDoubleClick(row.id)}
      onContextMenu={() => onRowContextMenu(row, index)}
      className={cn(
        'cursor-pointer select-none',
        isSelected ? 'bg-(--accent-400)/20 text-(--ink-black)' : 'hover:bg-(--polar-mist)/40',
      )}
    >
      <td
        className={cn(
          'px-3 py-1 tabular-nums border-l-2',
          isPlayhead ? 'border-(--accent-400)' : 'border-transparent',
        )}
      >
        {index + 1}
      </td>
      <td
        className={cn(
          'px-3 py-1 tabular-nums',
          isCustomDelay && 'text-(--accent-400)',
        )}
      >
        {formatMs(row.delayMs)}
      </td>
    </tr>
  );
}

function GifFrameListPane({
  rows,
  selectedIds,
  selectedCount,
  currentFrameIndex,
  delayInput,
  listRef,
  onRowMouseDown,
  onRowMouseEnter,
  onRowDoubleClick,
  onRowContextMenu,
  onExportSelectedFrames,
  onDeleteSelected,
  onDuplicateSelected,
  onOpenDelayDialog,
  onResetTimings,
  onOpenDropDialog,
  onDelayInputChange,
  onApplyDelayToSelection,
  onApplyDelayToAll,
}: GifFrameListPaneProps) {
  return (
    <aside className="w-[240px] shrink-0 border-r border-(--polar-mist) flex flex-col bg-[var(--card)]">
      <div className="px-3 py-2 border-b border-(--polar-mist) flex items-center justify-between text-xs text-(--ink-muted)">
        <span>{getGifFrameHeaderLabel(rows.length)}</span>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto"
            tabIndex={0}
          >
            <table className="w-full text-sm border-collapse">
              <thead className="text-xs text-(--ink-muted)">
                <tr>
                  <th className="sticky top-0 z-10 bg-[var(--card)] text-left px-3 py-1 font-medium w-12 border-b border-(--polar-mist)">
                    No.
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--card)] text-left px-3 py-1 font-medium border-b border-(--polar-mist)">
                    Delay
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <GifFrameRow
                    key={row.id}
                    row={row}
                    index={index}
                    selectedIds={selectedIds}
                    currentFrameIndex={currentFrameIndex}
                    onRowMouseDown={onRowMouseDown}
                    onRowMouseEnter={onRowMouseEnter}
                    onRowDoubleClick={onRowDoubleClick}
                    onRowContextMenu={onRowContextMenu}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={selectedCount === 0}
            onSelect={() => void onExportSelectedFrames()}
          >
            Export selected framesâ€¦
            <ContextMenuShortcut>Ctrl+Shift+E</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedCount === 0 || rows.length - selectedCount < 1}
            onSelect={onDeleteSelected}
          >
            Delete
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedCount === 0}
            onSelect={onDuplicateSelected}
          >
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedCount === 0}
            onSelect={() => onOpenDelayDialog(Array.from(selectedIds))}
          >
            Set frame delayâ€¦
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div className="p-3 border-t border-(--polar-mist) flex flex-col gap-2">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            title="Delete selected frame(s)"
            className="flex-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicateSelected}
            disabled={selectedCount === 0}
            title="Duplicate selected frame(s)"
            className="flex-1"
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onResetTimings}
            title="Reset all delays to original"
            className="flex-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenDropDialog}
          disabled={rows.length === 0}
          title="Drop frames in a pattern (even, odd, every Nth)"
          className="text-xs"
        >
          Drop framesâ€¦
        </Button>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-(--ink-muted)">Delay (ms)</Label>
          <Input
            type="number"
            min={1}
            max={60000}
            step={1}
            value={delayInput}
            onChange={(e) => onDelayInputChange(e.target.value)}
            placeholder="e.g. 50"
            className="h-8 text-sm"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={onApplyDelayToSelection}
              disabled={selectedCount === 0 || delayInput === ''}
              className="flex-1 text-xs"
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onApplyDelayToAll}
              disabled={delayInput === '' || rows.length === 0}
              className="flex-1 text-xs"
            >
              Apply to all
            </Button>
          </div>
          <p className="text-[10px] text-(--ink-muted) leading-snug">
            Click to select. Shift/Ctrl for multi-select.
          </p>
        </div>
      </div>
    </aside>
  );
}

interface GifPreviewPanelProps {
  gifData: GifLoaderData | null;
  cropEditing: boolean;
  crop: UiState['crop'];
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  rowsCount: number;
  currentFrameIndex: number;
  isPlaying: boolean;
  durationMs: number;
  hasFrameEdits: boolean;
  onCropChange: (crop: NonNullable<UiState['crop']>) => void;
  onTogglePlay: () => void;
  onSeekToFrame: (index: number) => void;
}

function getFramePositionLabel(rowsCount: number, currentFrameIndex: number) {
  return rowsCount > 0 ? `${currentFrameIndex + 1}/${rowsCount}` : '0/0';
}

function GifTransportButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
    >
      {children}
    </Button>
  );
}

function getFirstGifTransportButton(hasRows: boolean, onSeekToFrame: (index: number) => void) {
  return {
    key: 'first',
    label: 'First frame',
    title: 'First frame (Home)',
    disabled: !hasRows,
    onClick: () => onSeekToFrame(0),
    icon: ChevronFirst,
  };
}

function getPreviousGifTransportButton(
  hasRows: boolean,
  currentFrameIndex: number,
  onSeekToFrame: (index: number) => void
) {
  return {
    key: 'previous',
    label: 'Previous frame',
    title: 'Previous frame',
    disabled: !hasRows || currentFrameIndex === 0,
    onClick: () => onSeekToFrame(Math.max(0, currentFrameIndex - 1)),
    icon: ChevronLeft,
  };
}

function getPlayGifTransportButton(
  hasRows: boolean,
  isPlaying: boolean,
  onTogglePlay: () => void
) {
  return {
    key: 'play',
    label: isPlaying ? 'Pause' : 'Play',
    title: isPlaying ? 'Pause (Space)' : 'Play (Space)',
    disabled: !hasRows,
    onClick: onTogglePlay,
    icon: isPlaying ? Pause : Play,
  };
}

function getNextGifTransportButton(
  hasRows: boolean,
  rowsCount: number,
  currentFrameIndex: number,
  onSeekToFrame: (index: number) => void
) {
  return {
    key: 'next',
    label: 'Next frame',
    title: 'Next frame',
    disabled: !hasRows || currentFrameIndex >= rowsCount - 1,
    onClick: () => onSeekToFrame(Math.min(rowsCount - 1, currentFrameIndex + 1)),
    icon: ChevronRight,
  };
}

function getLastGifTransportButton(
  hasRows: boolean,
  rowsCount: number,
  onSeekToFrame: (index: number) => void
) {
  return {
    key: 'last',
    label: 'Last frame',
    title: 'Last frame (End)',
    disabled: !hasRows,
    onClick: () => onSeekToFrame(Math.max(0, rowsCount - 1)),
    icon: ChevronLast,
  };
}

function getGifTransportButtons({
  rowsCount,
  currentFrameIndex,
  isPlaying,
  hasRows,
  onTogglePlay,
  onSeekToFrame,
}: {
  rowsCount: number;
  currentFrameIndex: number;
  isPlaying: boolean;
  hasRows: boolean;
  onTogglePlay: () => void;
  onSeekToFrame: (index: number) => void;
}) {
  return [
    getFirstGifTransportButton(hasRows, onSeekToFrame),
    getPreviousGifTransportButton(hasRows, currentFrameIndex, onSeekToFrame),
    getPlayGifTransportButton(hasRows, isPlaying, onTogglePlay),
    getNextGifTransportButton(hasRows, rowsCount, currentFrameIndex, onSeekToFrame),
    getLastGifTransportButton(hasRows, rowsCount, onSeekToFrame),
  ];
}

function GifTransportControls({
  rowsCount,
  currentFrameIndex,
  isPlaying,
  onTogglePlay,
  onSeekToFrame,
}: Pick<
  GifPreviewPanelProps,
  'rowsCount' | 'currentFrameIndex' | 'isPlaying' | 'onTogglePlay' | 'onSeekToFrame'
>) {
  const hasRows = rowsCount > 0;
  const transportButtons = getGifTransportButtons({
    rowsCount,
    currentFrameIndex,
    isPlaying,
    hasRows,
    onTogglePlay,
    onSeekToFrame,
  });

  return (
    <div className="flex items-center gap-0.5">
      {transportButtons.map(({ key, icon: Icon, ...button }) => (
        <GifTransportButton key={key} {...button}>
          <Icon className="w-4 h-4" />
        </GifTransportButton>
      ))}
    </div>
  );
}

function GifTransportStatus({
  durationMs,
  hasFrameEdits,
}: Pick<GifPreviewPanelProps, 'durationMs' | 'hasFrameEdits'>) {
  return (
    <div className="text-xs text-(--ink-muted) whitespace-nowrap">
      {formatDuration(durationMs)}
      {hasFrameEdits && <span className="ml-2 text-(--accent-400)">edited</span>}
    </div>
  );
}

function GifTransportBar({
  rowsCount,
  currentFrameIndex,
  isPlaying,
  durationMs,
  hasFrameEdits,
  onTogglePlay,
  onSeekToFrame,
}: Omit<GifPreviewPanelProps, 'gifData' | 'cropEditing' | 'crop' | 'previewCanvasRef' | 'onCropChange'>) {
  return (
    <div className="px-6 py-3 flex items-center gap-3 border-t border-(--polar-mist)">
      <GifTransportControls
        rowsCount={rowsCount}
        currentFrameIndex={currentFrameIndex}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onSeekToFrame={onSeekToFrame}
      />

      <div className="text-xs tabular-nums text-(--ink-muted) min-w-[60px]">
        {getFramePositionLabel(rowsCount, currentFrameIndex)}
      </div>

      <div className="flex-1 min-w-0">
        <Slider
          value={[currentFrameIndex]}
          min={0}
          max={Math.max(0, rowsCount - 1)}
          step={1}
          onValueChange={(value) => onSeekToFrame(value[0])}
        />
      </div>

      <GifTransportStatus durationMs={durationMs} hasFrameEdits={hasFrameEdits} />
    </div>
  );
}
function GifPreviewPanel({
  gifData,
  cropEditing,
  crop,
  previewCanvasRef,
  rowsCount,
  currentFrameIndex,
  isPlaying,
  durationMs,
  hasFrameEdits,
  onCropChange,
  onTogglePlay,
  onSeekToFrame,
}: GifPreviewPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 flex items-center justify-center overflow-hidden p-6">
        {gifData && (
          <>
            <canvas
              ref={previewCanvasRef}
              className="max-w-full max-h-full object-contain shadow-lg"
              style={{ imageRendering: 'pixelated' }}
            />
            {cropEditing && crop && (
              <GifCropOverlay
                canvasEl={previewCanvasRef.current}
                sourceWidth={gifData.width}
                sourceHeight={gifData.height}
                crop={crop}
                onChange={onCropChange}
              />
            )}
          </>
        )}
      </div>

      <GifTransportBar
        rowsCount={rowsCount}
        currentFrameIndex={currentFrameIndex}
        isPlaying={isPlaying}
        durationMs={durationMs}
        hasFrameEdits={hasFrameEdits}
        onTogglePlay={onTogglePlay}
        onSeekToFrame={onSeekToFrame}
      />
    </div>
  );
}

export const GifEditor: React.FC<GifEditorProps> = ({
  path: pathProp,
  embedded = false,
  onClose,
}) => {
  useTheme();

  const [rows, setRows] = useState<FrameRow[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [delayInput, setDelayInput] = useState<string>('');
  /**
   * Whether the user is currently editing the crop (overlay visible, preview
   * shows full source). When false, the preview shows the cropped result.
   */
  const [cropEditing, setCropEditing] = useState(false);
  /**
   * Snapshot of `ui.crop` taken when crop editing starts, used to restore
   * the prior crop if the user clicks Cancel.
   */
  const cropEditingPrevRef = useRef<UiState['crop']>(null);

  const [delayDialog, setDelayDialog] = useState<DelayDialogState | null>(null);
  const [dropDialog, setDropDialog] = useState<DropDialogState | null>(null);
  const [exportPreview, setExportPreview] = useState<ExportPreviewState | null>(
    null,
  );
  const [previewFrameIdx, setPreviewFrameIdx] = useState(0);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const previewCanvasInDialogRef = useRef<HTMLCanvasElement | null>(null);

  const [ui, setUi] = useState<UiState>({
    speed: 1,
    outputWidth: 0,
    outputHeight: 0,
    keepAspect: true,
    crop: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    loopForever: true,
    qualityValue: 70,
    limitFps: false,
    fpsCap: 20,
    capFrameTime: false,
    maxFrameTimeSec: 2,
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowsRef = useRef<FrameRow[]>([]);
  const currentFrameIndexRef = useRef(0);
  const seekToFrameRef = useRef<((idx: number) => void) | null>(null);
  const exportSelectedRef = useRef<(() => void) | null>(null);
  const deleteSelectedRef = useRef<(() => void) | null>(null);
  /**
   * Active paint-select gesture. Set on mousedown over a row, cleared on the
   * next window-level mouseup. When set, onMouseEnter on rows extends the
   * selection.
   */
  const dragStateRef = useRef<GifFrameDragState | null>(null);

  // Load info from prop (embedded) or URL param (window mode), then parse the
  // GIF entirely in the browser.
  const { isLoading, error, capturePath, info, gifData } = useGifLoader({
    pathProp,
    setRows,
    setUi,
  });

  const closeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    closeRef.current = onClose ?? (() => getCurrentWebviewWindow().close());
  }, [onClose]);

  // Close shortcuts: Esc, Ctrl/Cmd+W (custom titlebar, no native window
  // controls, so we always provide a keyboard exit).
  useGifKeyboardShortcuts({
    closeRef,
    exportSelectedRef,
    deleteSelectedRef,
    seekToFrameRef,
    currentFrameIndexRef,
    rowsRef,
    setIsPlaying,
  });

  const durationMs = useMemo(
    () => rows.reduce((acc, r) => acc + r.delayMs, 0),
    [rows],
  );
  const sourceDurationMs = info ? info.durationMs : 0;

  const enterCropEditing = useCallback(() => {
    if (!gifData) return;
    setUi((p) => {
      cropEditingPrevRef.current = p.crop;
      return getCropEditingStartState(p, gifData);
    });
    setCropEditing(true);
  }, [gifData]);

  const applyCrop = useCallback(() => {
    cropEditingPrevRef.current = null;
    setUi(getAppliedCropState);
    setCropEditing(false);
  }, []);

  const cancelCropEditing = useCallback(() => {
    const previous = cropEditingPrevRef.current;
    cropEditingPrevRef.current = null;
    setUi((p) => getCancelledCropState(p, previous, gifData));
    setCropEditing(false);
  }, [gifData]);

  const removeCrop = useCallback(() => {
    cropEditingPrevRef.current = null;
    setUi((p) => getRemovedCropState(p, gifData));
    setCropEditing(false);
  }, [gifData]);
  const fileSize = info ? info.fileSizeBytes : 0;

  const firstSelectedRow = useMemo(() => {
    if (selectedIds.size === 0) return null;
    return rows.find((r) => selectedIds.has(r.id)) ?? null;
  }, [rows, selectedIds]);

  // Sync the delay input field with the (first) selected row.
  useEffect(() => {
    if (selectedIds.size === 1 && firstSelectedRow) {
      setDelayInput(String(firstSelectedRow.delayMs));
    } else if (selectedIds.size === 0) {
      setDelayInput('');
    }
  }, [selectedIds, firstSelectedRow]);

  // Mirror rows into a ref so keyboard handlers can see the latest list.
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    currentFrameIndexRef.current = currentFrameIndex;
  }, [currentFrameIndex]);

  // Clamp the playhead when the row count changes (delete/duplicate).
  useEffect(() => {
    if (rows.length === 0) {
      setCurrentFrameIndex(0);
      return;
    }
    setCurrentFrameIndex((i) => Math.min(i, rows.length - 1));
  }, [rows.length]);

  // Paint the current frame to the preview canvas.
  //   - While cropEditing: render full source at 1:1 (no rotation/flip), so
  //     the overlay's pointer events map cleanly to source pixels.
  //   - When a crop is applied: render only the cropped region with full
  //     rotation + flip transforms — the user sees the same image the
  //     exporter will produce.
  //   - No crop: render full source with rotation + flip.
  //
  // The two branches are split into separate effects so that dragging the
  // crop gizmo (which mutates ui.crop on every pointermove) does NOT trigger
  // an expensive `renderFrameTo` pass — the cropEditing branch doesn't use
  // ui.crop / rotation / flip at all.
  useEffect(() => {
    if (!cropEditing || !gifData) return;
    renderCropEditingPreviewIfReady({
      canvas: previewCanvasRef.current,
      gifData,
      row: rows[currentFrameIndex],
    });
  }, [gifData, rows, currentFrameIndex, cropEditing]);

  useEffect(() => {
    if (cropEditing) return;
    renderEditedPreviewIfReady({
      canvas: previewCanvasRef.current,
      gifData,
      row: rows[currentFrameIndex],
      transform: {
        crop: ui.crop,
        rotation: ui.rotation,
        flipH: ui.flipH,
        flipV: ui.flipV,
      },
    });
  }, [
    gifData,
    rows,
    currentFrameIndex,
    ui.rotation,
    ui.flipH,
    ui.flipV,
    ui.crop,
    cropEditing,
  ]);

  // Render the current preview-dialog frame to the dialog's canvas (with the
  // same rotation/flip transforms the export will apply).
  useEffect(() => {
    renderExportPreviewFrameIfReady({
      canvas: previewCanvasInDialogRef.current,
      exportPreview,
      previewFrameIdx,
      gifData,
      transform: {
        crop: ui.crop,
        rotation: ui.rotation,
        flipH: ui.flipH,
        flipV: ui.flipV,
      },
    });
  }, [
    exportPreview,
    previewFrameIdx,
    gifData,
    ui.rotation,
    ui.flipH,
    ui.flipV,
    ui.crop,
  ]);

  // Auto-loop the preview dialog playback using the rows' own delays + speed.
  useEffect(() => {
    if (!exportPreview) return;
    const row = exportPreview.rows[previewFrameIdx];
    if (!row) return;
    const wait = getGifPreviewPlaybackDelay(row, ui.speed);
    const t = setTimeout(() => {
      setPreviewFrameIdx((idx) =>
        getNextPreviewFrameIndex(idx, exportPreview.rows.length),
      );
    }, wait);
    return () => clearTimeout(t);
  }, [exportPreview, previewFrameIdx, ui.speed]);

  // Reset the size estimate whenever the dialog closes.
  useEffect(() => {
    if (!exportPreview) {
      setEstimatedBytes(null);
      setEstimating(false);
    }
  }, [exportPreview]);

  // While the export-preview dialog is open, listen for streaming size
  // updates from the running ffmpeg process and update the live readout.
  useEffect(() => {
    if (!exportPreview) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<GifEstimateProgress>('gif-estimate-progress', (event) => {
      if (cancelled) return;
      setEstimatedBytes(event.payload.totalSize);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [exportPreview]);

  // Compute an actual encoded size for the current export options, debounced.
  // We render to a temp GIF in Rust and report its byte length, then delete
  // the temp file — same code path as the real export, so the number reflects
  // exactly what the user would see on disk.
  useEffect(() => {
    if (!exportPreview || !capturePath || !gifData) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void estimateGifPreviewSize({
        exportPreview,
        capturePath,
        ui,
        gifData,
        isCancelled: () => cancelled,
        setEstimatedBytes,
        setEstimating,
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    exportPreview,
    capturePath,
    gifData,
    ui,
    ui.speed,
    ui.rotation,
    ui.flipH,
    ui.flipV,
    ui.outputWidth,
    ui.outputHeight,
    ui.loopForever,
    ui.qualityValue,
    ui.limitFps,
    ui.fpsCap,
    ui.capFrameTime,
    ui.maxFrameTimeSec,
    ui.crop,
  ]);

  // Frame-by-frame playback loop driven by each row's delay.
  useEffect(() => {
    if (!isPlaying || rows.length === 0) return;
    const row = rows[currentFrameIndex];
    if (!row) return;
    const speed = Math.max(0.05, ui.speed);
    const wait = Math.max(10, row.delayMs / speed);
    const t = setTimeout(() => {
      setCurrentFrameIndex((idx) => {
        const next = idx + 1;
        if (next >= rows.length) {
          if (!ui.loopForever) {
            setIsPlaying(false);
            return idx;
          }
          return 0;
        }
        return next;
      });
    }, wait);
    return () => clearTimeout(t);
  }, [isPlaying, currentFrameIndex, rows, ui.speed, ui.loopForever]);

  /**
   * Move the playhead to `idx` and replace the list selection with just that
   * row. Used by scrubbing, nav buttons, and plain row clicks — any explicit
   * "go to this frame" action. Playback auto-advance does NOT call this, so a
   * multi-selection survives pressing play.
   */
  const seekToFrame = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= rows.length) return;
      setCurrentFrameIndex(idx);
      const id = rows[idx].id;
      setSelectedIds(new Set([id]));
      setLastClickedId(id);
    },
    [rows],
  );

  useEffect(() => {
    seekToFrameRef.current = seekToFrame;
  }, [seekToFrame]);

  const handleTransportSeek = useCallback(
    (index: number) => {
      setIsPlaying(false);
      seekToFrame(index);
    },
    [seekToFrame],
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((playing) => !playing);
  }, []);

  const handleCropPreviewChange = useCallback((next: NonNullable<UiState['crop']>) => {
    setUi((p) => ({ ...p, crop: next }));
  }, []);

  const handleRowMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      const selectionUpdate = getRowMouseDownSelectionUpdate({
        id,
        event: e,
        rows,
        selectedIds,
        lastClickedId,
      });
      if (!selectionUpdate) return;
      e.preventDefault();

      setIsPlaying(false);
      setCurrentFrameIndex(selectionUpdate.frameIndex);
      setSelectedIds(selectionUpdate.selectedIds);
      if (selectionUpdate.lastClickedId) {
        setLastClickedId(selectionUpdate.lastClickedId);
      }
      dragStateRef.current = selectionUpdate.dragState;
    },
    [rows, selectedIds, lastClickedId],
  );

  const handleRowMouseEnter = useCallback(
    (id: string, e: React.MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;

      const selectionUpdate = getRowDragSelectionUpdate({
        id,
        event: e,
        rows,
        drag,
      });
      if (!selectionUpdate) return;
      if ('released' in selectionUpdate) {
        dragStateRef.current = null;
        return;
      }

      setSelectedIds(selectionUpdate.selectedIds);
      setCurrentFrameIndex(selectionUpdate.frameIndex);
    },
    [rows],
  );
  // End any paint-select gesture when the user releases the mouse anywhere.
  useEffect(() => {
    const onUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const openDelayDialogFor = useCallback(
    (rowIds: string[]) => {
      if (rowIds.length === 0) return;
      const firstRow = rows.find((r) => r.id === rowIds[0]);
      if (!firstRow) return;
      setIsPlaying(false);
      setDelayDialog({
        open: true,
        rowIds,
        mode: 'sec',
        value: (firstRow.delayMs / 1000).toFixed(3),
      });
    },
    [rows],
  );

  const handleRowDoubleClick = useCallback(
    (id: string) => {
      // Apply to the whole selection if the dbl-clicked row is part of it,
      // otherwise just to the clicked row.
      const targetIds = selectedIds.has(id)
        ? Array.from(selectedIds)
        : [id];
      openDelayDialogFor(targetIds);
    },
    [selectedIds, openDelayDialogFor],
  );

  const handleRowContextMenu = useCallback(
    (row: FrameRow, index: number) => {
      if (selectedIds.has(row.id)) return;
      setSelectedIds(new Set([row.id]));
      setLastClickedId(row.id);
      setCurrentFrameIndex(index);
      setIsPlaying(false);
    },
    [selectedIds],
  );

  const commitDelayDialog = useCallback(() => {
    if (!delayDialog) return;
    const delayMs = parseGifDelayMs(delayDialog.value, delayDialog.mode);
    if (delayMs === null) {
      toast.error('Delay must be between 1ms and 60s');
      return;
    }
    const ids = new Set(delayDialog.rowIds);
    setRows((prev) =>
      prev.map((r) => (ids.has(r.id) ? { ...r, delayMs } : r)),
    );
    setDelayDialog(null);
  }, [delayDialog]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (rows.length - selectedIds.size < 1) {
      toast.error('Cannot delete every frame');
      return;
    }
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    setLastClickedId(null);
  }, [rows.length, selectedIds]);

  const handleDuplicateSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setRows((prev) => {
      const { rows: nextRows, newIds } = duplicateSelectedRows(prev, selectedIds);
      if (newIds.length > 0) {
        setSelectedIds(new Set(newIds));
        setLastClickedId(newIds[newIds.length - 1]);
      }
      return nextRows;
    });
  }, [selectedIds]);

  const applyDelayToSelection = useCallback(() => {
    const delayMs = parseGifDelayMs(delayInput);
    if (delayMs === null) {
      toast.error('Delay must be between 1 and 60000 ms');
      return;
    }
    setRows((prev) =>
      prev.map((r) => (selectedIds.has(r.id) ? { ...r, delayMs } : r)),
    );
  }, [delayInput, selectedIds]);

  const applyDelayToAll = useCallback(() => {
    const delayMs = parseGifDelayMs(delayInput);
    if (delayMs === null) {
      toast.error('Delay must be between 1 and 60000 ms');
      return;
    }
    setRows((prev) => prev.map((r) => ({ ...r, delayMs })));
    toast.success(`All ${rows.length} frames set to ${delayMs}ms`);
  }, [delayInput, rows.length]);

  const resetTimings = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, delayMs: r.originalDelayMs })));
  }, []);

  const reverseFrames = useCallback(() => {
    setRows((prev) => prev.slice().reverse());
  }, []);

  /**
   * Live preview stats for the Drop Frames dialog — recomputed from the
   * dialog config so the user can see "341 → 171" before clicking OK.
   */
  const dropDialogStats = useMemo(() => {
    return getDropDialogStats(dropDialog, rows);
  }, [dropDialog, rows]);

  const applyDropFrames = useCallback(() => {
    if (!dropDialog) return;
    const { mode, nValue, keepPlaybackSpeed } = dropDialog;
    setRows((prev) => {
      const nextRows = applyDropFrameSelection(prev, { mode, nValue, keepPlaybackSpeed });
      if (nextRows === null) {
        toast.error('That would drop every frame');
        return prev;
      }
      return nextRows;
    });
    setDropDialog(null);
  }, [dropDialog]);

  const openDropDialog = useCallback(() => {
    setIsPlaying(false);
    setDropDialog({
      mode: 'none',
      nValue: 3,
      keepPlaybackSpeed: true,
    });
  }, []);

  const hasFrameEdits = useMemo(() => {
    return hasGifFrameEdits(info, rows);
  }, [rows, info]);

  /**
   * Snapshot the rows to be exported and open the preview dialog. The actual
   * file dialog + Rust invoke happens after the user clicks "Save" inside the
   * preview.
   */
  const handleExportSelectedFrames = useCallback(() => {
    if (!hasSelectedFrames(selectedIds)) {
      toast.error('Select frames to export');
      return;
    }
    const nextExportPreview = getSelectionExportPreviewState(rows, selectedIds);
    if (!nextExportPreview) return;
    // Commit any in-progress crop so the output baseline matches the crop
    // dims; otherwise the export would scale the cropped region back up to
    // the source dimensions and distort the aspect ratio.
    applyPendingCrop(cropEditing, applyCrop);
    setIsPlaying(false);
    setPreviewFrameIdx(0);
    setExportPreview(nextExportPreview);
  }, [rows, selectedIds, cropEditing, applyCrop]);

  useEffect(() => {
    exportSelectedRef.current = () => void handleExportSelectedFrames();
  }, [handleExportSelectedFrames]);

  useEffect(() => {
    deleteSelectedRef.current = () => handleDeleteSelected();
  }, [handleDeleteSelected]);

  /**
   * Opens the export preview dialog with the full row list. Save happens from
   * inside the dialog (via performExport).
   */
  const handleExport = useCallback(() => {
    if (!capturePath || !info) return;
    const nextExportPreview = getAllFramesExportPreviewState(rows);
    if (!nextExportPreview) {
      toast.error('No frames to export');
      return;
    }
    // Commit any in-progress crop so the output baseline matches the crop
    // dims; otherwise the export would scale the cropped region back up to
    // the source dimensions and distort the aspect ratio.
    applyPendingCrop(cropEditing, applyCrop);
    setIsPlaying(false);
    setPreviewFrameIdx(0);
    setExportPreview(nextExportPreview);
  }, [capturePath, info, rows, cropEditing, applyCrop]);

  /**
   * Confirmed export from the preview dialog. Opens the OS save dialog, builds
   * the manifest and calls the appropriate Rust command. Selection scope and
   * "full GIF with structural edits" both use encode_gif_from_frames; only the
   * "full GIF, no structural edits" pristine case uses the fast process_gif
   * path.
   */
  const performExport = useCallback(async () => {
    const request = getGifExportRequest({ exportPreview, capturePath, info });
    if (!request) return;

    await runGifExportRequest({
      request,
      hasFrameEdits,
      ui,
      gifData,
      sourceDurationMs,
      setIsExporting,
      setExportPreview,
    });
  }, [
    exportPreview,
    capturePath,
    info,
    ui,
    gifData,
    hasFrameEdits,
    sourceDurationMs,
  ]);

  const filename = useMemo(() => {
    return getGifEditorFilename(capturePath);
  }, [capturePath]);

  useEffect(() => {
    if (!listRef.current || rows.length === 0) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-row-index="${currentFrameIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentFrameIndex, rows.length]);

  const outerClasses = getGifEditorOuterClasses(embedded);
  const statusView = renderGifEditorStatusView({
    isLoading,
    error,
    capturePath,
    outerClasses,
    embedded,
  });
  if (statusView) return statusView;

  const selectedCount = selectedIds.size;

  return (
    <div className={outerClasses}>
      {renderGifEditorTitlebar(embedded, filename)}

      <div className="flex-1 flex min-h-0 bg-[var(--background)]">
        <GifFrameListPane
          rows={rows}
          selectedIds={selectedIds}
          selectedCount={selectedCount}
          currentFrameIndex={currentFrameIndex}
          delayInput={delayInput}
          listRef={listRef}
          onRowMouseDown={handleRowMouseDown}
          onRowMouseEnter={handleRowMouseEnter}
          onRowDoubleClick={handleRowDoubleClick}
          onRowContextMenu={handleRowContextMenu}
          onExportSelectedFrames={handleExportSelectedFrames}
          onDeleteSelected={handleDeleteSelected}
          onDuplicateSelected={handleDuplicateSelected}
          onOpenDelayDialog={openDelayDialogFor}
          onResetTimings={resetTimings}
          onOpenDropDialog={openDropDialog}
          onDelayInputChange={setDelayInput}
          onApplyDelayToSelection={applyDelayToSelection}
          onApplyDelayToAll={applyDelayToAll}
        />

        <GifPreviewPanel
          gifData={gifData}
          cropEditing={cropEditing}
          crop={ui.crop}
          previewCanvasRef={previewCanvasRef}
          rowsCount={rows.length}
          currentFrameIndex={currentFrameIndex}
          isPlaying={isPlaying}
          durationMs={durationMs}
          hasFrameEdits={hasFrameEdits}
          onCropChange={handleCropPreviewChange}
          onTogglePlay={handleTogglePlay}
          onSeekToFrame={handleTransportSeek}
        />

        <GifEditorSidebar
          info={info}
          sourceDurationMs={sourceDurationMs}
          fileSize={fileSize}
          gifData={gifData}
          ui={ui}
          setUi={setUi}
          cropEditing={cropEditing}
          rowsCount={rows.length}
          isExporting={isExporting}
          onEnterCropEditing={enterCropEditing}
          onApplyCrop={applyCrop}
          onCancelCropEditing={cancelCropEditing}
          onRemoveCrop={removeCrop}
          onReverseFrames={reverseFrames}
          onExport={handleExport}
        />
      </div>

      <DelayDialog
        dialog={delayDialog}
        onChange={setDelayDialog}
        onCommit={commitDelayDialog}
        onClose={() => setDelayDialog(null)}
      />

      <DropFramesDialog
        dialog={dropDialog}
        stats={dropDialogStats}
        onChange={setDropDialog}
        onApply={applyDropFrames}
        onClose={() => setDropDialog(null)}
      />

      <ExportPreviewDialog
        preview={exportPreview}
        gifData={gifData}
        ui={ui}
        setUi={setUi}
        isExporting={isExporting}
        estimatedBytes={estimatedBytes}
        estimating={estimating}
        canvasRef={previewCanvasInDialogRef}
        onSave={() => void performExport()}
        onClose={() => setExportPreview(null)}
      />
    </div>
  );
};

/**
 * Default export: the standalone window. Reads the GIF path from the
 * `?path=` query parameter and falls back to closing the OS window on Esc.
 */
const GifEditorWindow: React.FC = () => <GifEditor />;

export default GifEditorWindow;
