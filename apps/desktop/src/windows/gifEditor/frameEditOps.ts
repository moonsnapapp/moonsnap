import type { GifEditOptions } from '@/types/generated/GifEditOptions';
import type { GifFrameEncodeOptions } from '@/types/generated/GifFrameEncodeOptions';
import type { GifFrameSpec } from '@/types/generated/GifFrameSpec';
import type { GifInfo } from '@/types/generated/GifInfo';
import {
  applyFpsLimit,
  applyMaxFrameTime,
  computeDropKeepMask,
  newRowId,
  qualityNumericToPreset,
} from './frameOps';
import { getGifCropPayload, getGifExplicitOutputSize } from './previewRenderer';
import type { DelayDialogState, DropDialogState, FrameRow, GifData, UiState } from './types';

type GifLoaderData = GifData;
type GifLoaderInfo = GifInfo;

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

export function buildGifFrameEncodeOptions(
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

export function buildGifEditOptions(
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

export function parseGifDelayMs(
  value: string,
  mode: GifDelayInputMode = 'ms'
) {
  const numeric = parsePositiveGifDelayValue(value);
  if (numeric === null) return null;

  const delayMs = GIF_DELAY_CONVERTERS[mode](numeric);
  return isGifDelayInRange(delayMs) ? delayMs : null;
}

export function duplicateSelectedRows(rows: FrameRow[], selectedIds: Set<string>) {
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

export function getDropDialogStats(dropDialog: DropDialogState | null, rows: FrameRow[]) {
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

export function applyDropFrameSelection(
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

export function hasGifFrameEdits(info: GifLoaderInfo | null, rows: FrameRow[]) {
  if (!info) return false;
  if (rows.length !== info.frameCount) return true;
  return rows.some(
    (row, index) => row.sourceIndex !== index || row.delayMs !== row.originalDelayMs,
  );
}
