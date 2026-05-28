import type { GifFrameSpec } from '@/types/generated/GifFrameSpec';
import type { QualityPreset } from './types';

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.00s';
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(2)}s`;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return `${m}m ${s.toFixed(1)}s`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function deriveDefaultSavePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const dir = idx >= 0 ? normalized.slice(0, idx) : '';
  const name = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '.gif';
  const out = `${base}-edited${ext}`;
  return dir ? `${dir}/${out}` : out;
}

let rowCounter = 0;
export function newRowId(sourceIndex: number): string {
  rowCounter += 1;
  return `f-${sourceIndex}-${rowCounter}`;
}

export function qualityNumericToPreset(v: number): QualityPreset {
  if (v < 34) return 'fast';
  if (v < 67) return 'balanced';
  return 'high';
}

export function qualityLabel(v: number): string {
  if (v < 34) return 'Smaller file';
  if (v < 67) return 'Balanced';
  return 'Higher quality';
}

/**
 * Drop frames so the manifest's effective FPS never exceeds `maxFps`. Skipped
 * frames' delays are folded into the next kept frame, preserving total
 * duration. The last frame is always kept so the encode doesn't lose its
 * tail.
 */
export function applyFpsLimit(
  manifest: GifFrameSpec[],
  maxFps: number,
): GifFrameSpec[] {
  if (manifest.length === 0 || maxFps <= 0) return manifest;
  const minDelay = Math.max(1, Math.round(1000 / maxFps));
  const out: GifFrameSpec[] = [];
  let carry = 0;
  for (let i = 0; i < manifest.length; i += 1) {
    const f = manifest[i];
    const isLast = i === manifest.length - 1;
    const candidate = f.delayMs + carry;
    if (isLast) {
      out.push({ ...f, delayMs: Math.max(1, candidate) });
      break;
    }
    if (candidate >= minDelay) {
      out.push({ ...f, delayMs: candidate });
      carry = 0;
    } else {
      carry = candidate;
    }
  }
  return out;
}

/**
 * Clamp each frame's delay to at most `maxMs`. Mostly useful for stripping a
 * long "title-card" hold at the end of a clip without re-timing every frame.
 */
export function applyMaxFrameTime(
  manifest: GifFrameSpec[],
  maxMs: number,
): GifFrameSpec[] {
  if (maxMs <= 0) return manifest;
  return manifest.map((f) => ({
    ...f,
    delayMs: Math.min(f.delayMs, maxMs),
  }));
}

/**
 * Decide which 0-indexed rows survive a Drop Frames pass. Frame numbering
 * in the UI is 1-based — "Even frames (2, 4, 6...)" means drop the 2nd,
 * 4th, 6th visible row.
 */
export function computeDropKeepMask(
  total: number,
  mode: 'none' | 'even' | 'odd' | 'every-n',
  nValue: number,
): boolean[] {
  const keep = new Array<boolean>(total).fill(true);
  if (mode === 'none' || total === 0) return keep;
  for (let i = 0; i < total; i += 1) {
    const oneBased = i + 1;
    if (mode === 'even') keep[i] = oneBased % 2 !== 0;
    else if (mode === 'odd') keep[i] = oneBased % 2 === 0;
    else if (mode === 'every-n')
      keep[i] = nValue > 1 ? oneBased % nValue !== 0 : false;
  }
  return keep;
}
