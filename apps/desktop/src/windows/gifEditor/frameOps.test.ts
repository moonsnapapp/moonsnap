import { describe, expect, it } from 'vitest';
import type { GifFrameSpec } from '@/types/generated/GifFrameSpec';
import type { FrameRow, UiState } from './types';
import {
  applyDropFrameSelection,
  buildGifFrameEncodeOptions,
  duplicateSelectedRows,
} from './frameEditOps';
import { canUseFullGifProcessCommand } from './exportService';
import { getGifPreviewDrawBounds } from './previewRenderer';
import { getGifRowRangeSelectionUpdate } from './selectionOps';
import {
  applyFpsLimit,
  applyMaxFrameTime,
  computeDropKeepMask,
  deriveDefaultSavePath,
  formatDuration,
  formatFileSize,
  formatMs,
  newRowId,
  qualityLabel,
  qualityNumericToPreset,
} from './frameOps';

const spec = (sourceIndex: number, delayMs: number): GifFrameSpec => ({
  sourceIndex,
  delayMs,
});

const row = (id: string, sourceIndex: number, delayMs: number): FrameRow => ({
  id,
  sourceIndex,
  delayMs,
  originalDelayMs: delayMs,
});

const ui = (overrides: Partial<UiState> = {}): UiState => ({
  speed: 1,
  outputWidth: 320,
  outputHeight: 180,
  keepAspect: true,
  crop: null,
  rotation: 0,
  flipH: false,
  flipV: false,
  loopForever: true,
  qualityValue: 50,
  limitFps: false,
  fpsCap: 30,
  capFrameTime: false,
  maxFrameTimeSec: 10,
  ...overrides,
});

describe('editor frame operations', () => {
  it('selects the inclusive range from the last clicked row', () => {
    const rows = [row('a', 0, 20), row('b', 1, 30), row('c', 2, 40)];

    expect(getGifRowRangeSelectionUpdate(rows, 2, 'a')).toMatchObject({
      frameIndex: 2,
      selectedIds: new Set(['a', 'b', 'c']),
    });
  });

  it('duplicates selected rows immediately after their source rows', () => {
    const rows = [row('a', 0, 20), row('b', 1, 30)];
    const result = duplicateSelectedRows(rows, new Set(['a']));

    expect(result.rows.map((frame) => frame.sourceIndex)).toEqual([0, 0, 1]);
    expect(result.rows.map((frame) => frame.delayMs)).toEqual([20, 20, 30]);
    expect(result.newIds).toHaveLength(1);
    expect(result.rows[1].id).toBe(result.newIds[0]);
  });

  it('carries dropped frame delays forward and preserves a trailing delay', () => {
    const rows = [row('a', 0, 10), row('b', 1, 20), row('c', 2, 30)];

    expect(
      applyDropFrameSelection(rows, {
        mode: 'even',
        nValue: 2,
        keepPlaybackSpeed: true,
      })?.map((frame) => frame.delayMs)
    ).toEqual([10, 50]);
  });

  it('uses cropped dimensions and swaps them for quarter-turn rotations', () => {
    const gifData = { width: 320, height: 180, frames: [] };

    expect(
      getGifPreviewDrawBounds(gifData, {
        crop: { x: 10, y: 20, w: 120, h: 80 },
        rotation: 90,
        flipH: false,
        flipV: false,
      })
    ).toEqual({ cropX: 10, cropY: 20, cropW: 120, cropH: 80, dstW: 80, dstH: 120 });
  });

  it('uses the full-process command only for an unmodified full export', () => {
    const exportPreview = { rows: [row('a', 0, 20)], scope: 'all' as const };

    expect(canUseFullGifProcessCommand({ exportPreview, hasFrameEdits: false, ui: ui() })).toBe(true);
    expect(canUseFullGifProcessCommand({ exportPreview, hasFrameEdits: true, ui: ui() })).toBe(false);
    expect(
      canUseFullGifProcessCommand({
        exportPreview: { ...exportPreview, scope: 'selection' },
        hasFrameEdits: false,
        ui: ui(),
      })
    ).toBe(false);
    expect(
      canUseFullGifProcessCommand({
        exportPreview,
        hasFrameEdits: false,
        ui: ui({ limitFps: true }),
      })
    ).toBe(false);
  });

  it('builds an edited multi-frame manifest in visible row order', () => {
    const options = buildGifFrameEncodeOptions(
      [row('c', 2, 60), row('a', 0, 40)],
      ui({
        crop: { x: 10, y: 20, w: 120, h: 80 },
        rotation: 90,
        flipH: true,
        qualityValue: 72,
      }),
      { width: 320, height: 180, frames: [] },
    );

    expect(options).toMatchObject({
      frames: [
        { sourceIndex: 2, delayMs: 60 },
        { sourceIndex: 0, delayMs: 40 },
      ],
      crop: { x: 10, y: 20, width: 120, height: 80 },
      rotationDegrees: 90,
      flipH: true,
      quality: 'high',
      qualityValue: 72,
    });
  });
});

describe('formatMs', () => {
  it('clamps non-finite and non-positive values to 0ms', () => {
    expect(formatMs(0)).toBe('0ms');
    expect(formatMs(-5)).toBe('0ms');
    expect(formatMs(NaN)).toBe('0ms');
  });

  it('rounds sub-second values to whole ms', () => {
    expect(formatMs(33.4)).toBe('33ms');
    expect(formatMs(999)).toBe('999ms');
  });

  it('renders >= 1s as fixed seconds', () => {
    expect(formatMs(1500)).toBe('1.50s');
  });
});

describe('formatDuration', () => {
  it('renders sub-minute durations as seconds', () => {
    expect(formatDuration(2500)).toBe('2.50s');
  });

  it('renders minute+ durations as m/s', () => {
    expect(formatDuration(90000)).toBe('1m 30.0s');
  });

  it('guards against negative/NaN', () => {
    expect(formatDuration(-1)).toBe('0.00s');
    expect(formatDuration(NaN)).toBe('0.00s');
  });
});

describe('formatFileSize', () => {
  it('formats bytes, KB, and MB', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('deriveDefaultSavePath', () => {
  it('appends -edited before the extension', () => {
    expect(deriveDefaultSavePath('/home/u/clip.gif')).toBe(
      '/home/u/clip-edited.gif',
    );
  });

  it('normalizes Windows separators', () => {
    expect(deriveDefaultSavePath('C:\\caps\\clip.gif')).toBe(
      'C:/caps/clip-edited.gif',
    );
  });

  it('defaults the extension to .gif when missing', () => {
    expect(deriveDefaultSavePath('clip')).toBe('clip-edited.gif');
  });
});

describe('newRowId', () => {
  it('produces unique ids for the same source index', () => {
    const a = newRowId(3);
    const b = newRowId(3);
    expect(a).not.toBe(b);
    expect(a.startsWith('f-3-')).toBe(true);
  });
});

describe('quality helpers', () => {
  it('maps numeric quality to presets at the 34/67 thresholds', () => {
    expect(qualityNumericToPreset(33)).toBe('fast');
    expect(qualityNumericToPreset(34)).toBe('balanced');
    expect(qualityNumericToPreset(66)).toBe('balanced');
    expect(qualityNumericToPreset(67)).toBe('high');
  });

  it('labels match the preset bands', () => {
    expect(qualityLabel(10)).toBe('Smaller file');
    expect(qualityLabel(50)).toBe('Balanced');
    expect(qualityLabel(90)).toBe('Higher quality');
  });
});

describe('applyFpsLimit', () => {
  it('returns input unchanged for empty manifest or non-positive fps', () => {
    expect(applyFpsLimit([], 20)).toEqual([]);
    const m = [spec(0, 50)];
    expect(applyFpsLimit(m, 0)).toBe(m);
  });

  it('folds dropped frames into the next kept frame, preserving total duration', () => {
    // 100fps cap => minDelay 10ms. Frames at 5ms each should merge in pairs.
    const manifest = [spec(0, 5), spec(1, 5), spec(2, 5), spec(3, 5)];
    const out = applyFpsLimit(manifest, 100);
    const totalIn = manifest.reduce((a, f) => a + f.delayMs, 0);
    const totalOut = out.reduce((a, f) => a + f.delayMs, 0);
    expect(totalOut).toBe(totalIn);
    expect(out.length).toBeLessThan(manifest.length);
  });

  it('always keeps the last frame', () => {
    const manifest = [spec(0, 5), spec(1, 5), spec(2, 5)];
    const out = applyFpsLimit(manifest, 1000); // minDelay 1ms, nothing merges
    expect(out[out.length - 1].sourceIndex).toBe(2);
  });
});

describe('applyMaxFrameTime', () => {
  it('returns input unchanged for non-positive max', () => {
    const m = [spec(0, 5000)];
    expect(applyMaxFrameTime(m, 0)).toBe(m);
  });

  it('clamps each frame delay to the cap', () => {
    const out = applyMaxFrameTime([spec(0, 5000), spec(1, 100)], 2000);
    expect(out[0].delayMs).toBe(2000);
    expect(out[1].delayMs).toBe(100);
  });
});

describe('computeDropKeepMask', () => {
  it('keeps everything for mode none or empty total', () => {
    expect(computeDropKeepMask(3, 'none', 0)).toEqual([true, true, true]);
    expect(computeDropKeepMask(0, 'even', 0)).toEqual([]);
  });

  it('drops 1-based even frames', () => {
    // rows 1..5 -> drop 2nd and 4th
    expect(computeDropKeepMask(5, 'even', 0)).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  it('drops 1-based odd frames', () => {
    expect(computeDropKeepMask(5, 'odd', 0)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('drops every N-th 1-based frame', () => {
    expect(computeDropKeepMask(6, 'every-n', 3)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  it('drops all frames when every-n n<=1', () => {
    expect(computeDropKeepMask(3, 'every-n', 1)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
