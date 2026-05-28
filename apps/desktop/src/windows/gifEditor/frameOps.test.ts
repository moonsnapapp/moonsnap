import { describe, expect, it } from 'vitest';
import type { GifFrameSpec } from '@/types/generated/GifFrameSpec';
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
