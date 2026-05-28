import type { ParsedFrame } from 'gifuct-js';

export type QualityPreset = 'fast' | 'balanced' | 'high';

export interface UiState {
  speed: number;
  outputWidth: number;
  outputHeight: number;
  keepAspect: boolean;
  /** Crop rectangle in source pixel coordinates, or null when crop is off. */
  crop: { x: number; y: number; w: number; h: number } | null;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  loopForever: boolean;
  /** 0..=100, mapped to FFmpeg palette colors + dither on the backend. */
  qualityValue: number;
  /** Drop frames so output FPS does not exceed this cap. */
  limitFps: boolean;
  fpsCap: number;
  /** Clamp each frame's delay to this many seconds. */
  capFrameTime: boolean;
  maxFrameTimeSec: number;
}

export interface FrameRow {
  /** Stable id, unique even across duplicates. */
  id: string;
  /** Original index in the source GIF. */
  sourceIndex: number;
  delayMs: number;
  originalDelayMs: number;
}

export interface GifData {
  width: number;
  height: number;
  frames: ParsedFrame[];
}

/**
 * "Set Frame Delay" dialog state (opened by double-clicking a frame).
 * `rowIds` are the rows that will receive the new delay on OK.
 */
export interface DelayDialogState {
  open: boolean;
  rowIds: string[];
  mode: 'sec' | 'fps';
  value: string;
}

/**
 * "Drop Frames" dialog state. `keepPlaybackSpeed` folds the dropped frames'
 * delays into the kept neighbours so the total duration stays constant.
 */
export interface DropDialogState {
  mode: 'none' | 'even' | 'odd' | 'every-n';
  nValue: number;
  keepPlaybackSpeed: boolean;
}

/**
 * Export-preview dialog state. Holds the snapshot of rows to export (so
 * subsequent UI edits don't change what was previewed) plus a label
 * describing the scope (whole GIF vs selection).
 */
export interface ExportPreviewState {
  rows: FrameRow[];
  scope: 'all' | 'selection';
}

/** Live stats shown in the Drop Frames dialog. */
export interface DropDialogStats {
  keptCount: number;
  total: number;
  sourceDuration: number;
  outDuration: number;
}
