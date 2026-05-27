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
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
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
import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';

import { Titlebar } from '@/components/Titlebar/Titlebar';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
import type { GifInfo } from '@/types/generated/GifInfo';
import type { GifEditOptions } from '@/types/generated/GifEditOptions';
import type { GifFrameEncodeOptions } from '@/types/generated/GifFrameEncodeOptions';
import type { GifFrameSpec } from '@/types/generated/GifFrameSpec';
import type { GifEstimateProgress } from '@/types/generated/GifEstimateProgress';
import type { GifCrop } from '@/types/generated/GifCrop';

type QualityPreset = 'fast' | 'balanced' | 'high';

interface UiState {
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

interface FrameRow {
  /** Stable id, unique even across duplicates. */
  id: string;
  /** Original index in the source GIF. */
  sourceIndex: number;
  delayMs: number;
  originalDelayMs: number;
}

interface GifData {
  width: number;
  height: number;
  frames: ParsedFrame[];
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.00s';
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(2)}s`;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return `${m}m ${s.toFixed(1)}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function deriveDefaultSavePath(sourcePath: string): string {
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
function newRowId(sourceIndex: number): string {
  rowCounter += 1;
  return `f-${sourceIndex}-${rowCounter}`;
}

function qualityNumericToPreset(v: number): QualityPreset {
  if (v < 34) return 'fast';
  if (v < 67) return 'balanced';
  return 'high';
}

function qualityLabel(v: number): string {
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
function applyFpsLimit(manifest: GifFrameSpec[], maxFps: number): GifFrameSpec[] {
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
function applyMaxFrameTime(
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
 * Composite the GIF up to `targetIndex` onto a fresh canvas, honoring the
 * minimal disposal rules we care about (keep / restore-to-background).
 */
function renderFrameTo(
  ctx: CanvasRenderingContext2D,
  data: GifData,
  targetIndex: number,
): void {
  ctx.clearRect(0, 0, data.width, data.height);

  for (let i = 0; i <= targetIndex && i < data.frames.length; i += 1) {
    const frame = data.frames[i];
    const { width, height, top, left } = frame.dims;

    const imageData = new ImageData(
      new Uint8ClampedArray(frame.patch),
      width,
      height,
    );
    // Draw via an offscreen canvas to keep transparency intact when composited.
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    off.getContext('2d')?.putImageData(imageData, 0, 0);
    ctx.drawImage(off, left, top);

    // Disposal 2 = restore to background after rendering. We clear the frame's
    // bbox before drawing the *next* frame.
    if (frame.disposalType === 2 && i < targetIndex) {
      ctx.clearRect(left, top, width, height);
    }
  }
}

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

export const GifEditor: React.FC<GifEditorProps> = ({
  path: pathProp,
  embedded = false,
  onClose,
}) => {
  useTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturePath, setCapturePath] = useState<string | null>(null);
  const [info, setInfo] = useState<GifInfo | null>(null);
  const [gifData, setGifData] = useState<GifData | null>(null);
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

  /**
   * State for the "Set Frame Delay" dialog (opened by double-clicking a frame).
   * `rowIds` are the rows that will receive the new delay on OK.
   */
  const [delayDialog, setDelayDialog] = useState<{
    open: boolean;
    rowIds: string[];
    mode: 'sec' | 'fps';
    value: string;
  } | null>(null);

  /**
   * State for the "Drop Frames" dialog. Open with a mode + N value; OK
   * mutates `rows` to remove the matching frames. `keepPlaybackSpeed`
   * folds the dropped frames' delays into the kept neighbours so the
   * total duration stays constant.
   */
  const [dropDialog, setDropDialog] = useState<{
    mode: 'none' | 'even' | 'odd' | 'every-n';
    nValue: number;
    keepPlaybackSpeed: boolean;
  } | null>(null);

  /**
   * State for the export-preview dialog. Holds the snapshot of rows to export
   * (so subsequent UI edits don't change what was previewed) plus a label
   * describing the scope (whole GIF vs selection).
   */
  const [exportPreview, setExportPreview] = useState<{
    rows: FrameRow[];
    scope: 'all' | 'selection';
  } | null>(null);
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

  const hasLoadedRef = useRef(false);
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
  const dragStateRef = useRef<{
    anchorIndex: number;
    baseSelection: Set<string>;
    additive: boolean;
  } | null>(null);

  // Load info from prop (embedded) or URL param (window mode), then parse the
  // GIF entirely in the browser.
  useEffect(() => {
    if (hasLoadedRef.current) return;
    let path = pathProp;
    if (!path) {
      const urlParams = new URLSearchParams(window.location.search);
      const encodedPath = urlParams.get('path');
      if (encodedPath) {
        path = decodeURIComponent(encodedPath);
      }
    }
    if (!path) {
      setError('No GIF path provided');
      setIsLoading(false);
      return;
    }
    hasLoadedRef.current = true;
    setCapturePath(path);

    (async () => {
      try {
        editorLogger.info('Loading GIF:', path);

        // Probe via Rust just for file size (and a sanity check that ffprobe
        // can read it before the user hits Export).
        const probed = await invoke<GifInfo>('get_gif_info', { path });
        setInfo(probed);

        const response = await fetch(convertFileSrc(path));
        const buf = await response.arrayBuffer();
        const parsed = parseGIF(buf);
        const frames = decompressFrames(parsed, true);

        const data: GifData = {
          width: parsed.lsd.width,
          height: parsed.lsd.height,
          frames,
        };
        setGifData(data);
        setUi((prev) => ({
          ...prev,
          outputWidth: parsed.lsd.width,
          outputHeight: parsed.lsd.height,
        }));

        const initialRows: FrameRow[] = frames.map((f, i) => ({
          id: newRowId(i),
          sourceIndex: i,
          delayMs: f.delay > 0 ? f.delay : 100,
          originalDelayMs: f.delay > 0 ? f.delay : 100,
        }));
        setRows(initialRows);
        setIsLoading(false);
      } catch (err) {
        editorLogger.error('Failed to load GIF:', err);
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    })();
    // The effect only runs once per mount; EmbeddedGifEditor keys this
    // component by path, so a path change always remounts and re-fires.
  }, [pathProp]);

  const closeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    closeRef.current = onClose ?? (() => getCurrentWebviewWindow().close());
  }, [onClose]);

  // Close shortcuts: Esc, Ctrl/Cmd+W (custom titlebar, no native window
  // controls, so we always provide a keyboard exit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (!isEditable && e.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        closeRef.current?.();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'e' || e.key === 'E')
      ) {
        e.preventDefault();
        exportSelectedRef.current?.();
        return;
      }
      if (isEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedRef.current?.();
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(
          Math.max(0, currentFrameIndexRef.current - 1),
        );
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(
          Math.min(rowsRef.current.length - 1, currentFrameIndexRef.current + 1),
        );
      } else if (e.key === 'Home') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(Math.max(0, rowsRef.current.length - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const durationMs = useMemo(
    () => rows.reduce((acc, r) => acc + r.delayMs, 0),
    [rows],
  );
  const sourceDurationMs = info ? info.durationMs : 0;

  const enterCropEditing = useCallback(() => {
    if (!gifData) return;
    setUi((p) => {
      cropEditingPrevRef.current = p.crop;
      if (p.crop) return p;
      // Default crop: centered 80% of source.
      const w = Math.max(16, Math.round(gifData.width * 0.8));
      const h = Math.max(16, Math.round(gifData.height * 0.8));
      const x = Math.round((gifData.width - w) / 2);
      const y = Math.round((gifData.height - h) / 2);
      return { ...p, crop: { x, y, w, h } };
    });
    setCropEditing(true);
  }, [gifData]);

  const applyCrop = useCallback(() => {
    cropEditingPrevRef.current = null;
    setUi((p) => {
      if (!p.crop) return p;
      // Re-baseline the output size to the crop so the W/H inputs, scale
      // slider, and "explicit size" check don't accidentally upscale the
      // crop back to source dimensions.
      return { ...p, outputWidth: p.crop.w, outputHeight: p.crop.h };
    });
    setCropEditing(false);
  }, []);

  const cancelCropEditing = useCallback(() => {
    const previous = cropEditingPrevRef.current;
    cropEditingPrevRef.current = null;
    setUi((p) => {
      const next = { ...p, crop: previous };
      if (gifData) {
        const baselineW = previous?.w ?? gifData.width;
        const baselineH = previous?.h ?? gifData.height;
        next.outputWidth = baselineW;
        next.outputHeight = baselineH;
      }
      return next;
    });
    setCropEditing(false);
  }, [gifData]);

  const removeCrop = useCallback(() => {
    cropEditingPrevRef.current = null;
    setUi((p) => ({
      ...p,
      crop: null,
      outputWidth: gifData?.width ?? p.outputWidth,
      outputHeight: gifData?.height ?? p.outputHeight,
    }));
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
    if (!cropEditing) return;
    if (!gifData || rows.length === 0) return;
    const row = rows[currentFrameIndex];
    if (!row) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== gifData.width) canvas.width = gifData.width;
    if (canvas.height !== gifData.height) canvas.height = gifData.height;
    renderFrameTo(ctx, gifData, row.sourceIndex);
  }, [gifData, rows, currentFrameIndex, cropEditing]);

  useEffect(() => {
    if (cropEditing) return;
    if (!gifData || rows.length === 0) return;
    const row = rows[currentFrameIndex];
    if (!row) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const swap = ui.rotation === 90 || ui.rotation === 270;
    const cropW = ui.crop?.w ?? gifData.width;
    const cropH = ui.crop?.h ?? gifData.height;
    const cropX = ui.crop?.x ?? 0;
    const cropY = ui.crop?.y ?? 0;
    const dstW = swap ? cropH : cropW;
    const dstH = swap ? cropW : cropH;
    if (canvas.width !== dstW) canvas.width = dstW;
    if (canvas.height !== dstH) canvas.height = dstH;

    const off = document.createElement('canvas');
    off.width = gifData.width;
    off.height = gifData.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    renderFrameTo(offCtx, gifData, row.sourceIndex);

    ctx.save();
    ctx.clearRect(0, 0, dstW, dstH);
    ctx.translate(dstW / 2, dstH / 2);
    ctx.rotate((ui.rotation * Math.PI) / 180);
    ctx.scale(ui.flipH ? -1 : 1, ui.flipV ? -1 : 1);
    ctx.drawImage(
      off,
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
    if (!exportPreview || !gifData) return;
    const row = exportPreview.rows[previewFrameIdx];
    if (!row) return;
    const canvas = previewCanvasInDialogRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const swap = ui.rotation === 90 || ui.rotation === 270;
    const cropW = ui.crop ? ui.crop.w : gifData.width;
    const cropH = ui.crop ? ui.crop.h : gifData.height;
    const dstW = swap ? cropH : cropW;
    const dstH = swap ? cropW : cropH;
    if (canvas.width !== dstW) canvas.width = dstW;
    if (canvas.height !== dstH) canvas.height = dstH;

    // Render the full source frame to an offscreen, then draw only the
    // cropped region with rotation + flip applied on the dialog canvas.
    const off = document.createElement('canvas');
    off.width = gifData.width;
    off.height = gifData.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    renderFrameTo(offCtx, gifData, row.sourceIndex);

    ctx.save();
    ctx.clearRect(0, 0, dstW, dstH);
    ctx.translate(dstW / 2, dstH / 2);
    ctx.rotate((ui.rotation * Math.PI) / 180);
    ctx.scale(ui.flipH ? -1 : 1, ui.flipV ? -1 : 1);
    const sx = ui.crop ? ui.crop.x : 0;
    const sy = ui.crop ? ui.crop.y : 0;
    ctx.drawImage(off, sx, sy, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
    ctx.restore();
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
    const speed = Math.max(0.05, ui.speed);
    const wait = Math.max(10, row.delayMs / speed);
    const t = setTimeout(() => {
      setPreviewFrameIdx((idx) =>
        idx + 1 >= exportPreview.rows.length ? 0 : idx + 1,
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
    const timer = setTimeout(async () => {
      setEstimating(true);
      setEstimatedBytes(null);
      const speed = ui.speed > 0 ? ui.speed : 1;
      const manifestBase: GifFrameSpec[] = exportPreview.rows.map((r) => ({
        sourceIndex: r.sourceIndex,
        delayMs: Math.max(1, Math.round(r.delayMs / speed)),
      }));
      let manifest = manifestBase;
      if (ui.capFrameTime) {
        manifest = applyMaxFrameTime(
          manifest,
          Math.max(10, Math.round(ui.maxFrameTimeSec * 1000)),
        );
      }
      if (ui.limitFps) {
        manifest = applyFpsLimit(manifest, ui.fpsCap);
      }
      // Baseline = crop dims if cropped, else source dims. Only send
      // explicit output dims when the user has actually scaled away from
      // that baseline — otherwise FFmpeg would rescale the crop output.
      const baselineW = ui.crop?.w ?? gifData.width;
      const baselineH = ui.crop?.h ?? gifData.height;
      const usingExplicitSize =
        ui.outputWidth !== baselineW || ui.outputHeight !== baselineH;
      const options: GifFrameEncodeOptions = {
        frames: manifest,
        scalePct: 100,
        crop: ui.crop
          ? {
              x: Math.max(0, Math.round(ui.crop.x)),
              y: Math.max(0, Math.round(ui.crop.y)),
              width: Math.max(1, Math.round(ui.crop.w)),
              height: Math.max(1, Math.round(ui.crop.h)),
            }
          : null,
        outputWidth: usingExplicitSize
          ? Math.max(1, Math.round(ui.outputWidth))
          : null,
        outputHeight: usingExplicitSize
          ? Math.max(1, Math.round(ui.outputHeight))
          : null,
        rotationDegrees: ui.rotation,
        flipH: ui.flipH,
        flipV: ui.flipV,
        loopForever: ui.loopForever,
        quality: qualityNumericToPreset(ui.qualityValue),
        qualityValue: Math.round(ui.qualityValue),
      };
      try {
        const size = await invoke<number>('estimate_gif_size_from_frames', {
          inputPath: capturePath,
          options,
        });
        if (!cancelled) setEstimatedBytes(size);
      } catch (err) {
        if (!cancelled) setEstimatedBytes(null);
        editorLogger.warn('GIF size estimate failed:', err);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    exportPreview,
    capturePath,
    gifData,
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

  const handleRowMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return;
      e.preventDefault();

      setIsPlaying(false);
      setCurrentFrameIndex(idx);

      if (e.shiftKey && lastClickedId) {
        const a = rows.findIndex((r) => r.id === lastClickedId);
        if (a >= 0) {
          const [lo, hi] = a < idx ? [a, idx] : [idx, a];
          const next = new Set<string>();
          for (let i = lo; i <= hi; i += 1) next.add(rows[i].id);
          setSelectedIds(next);
          dragStateRef.current = {
            anchorIndex: a,
            baseSelection: new Set(),
            additive: false,
          };
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
        setLastClickedId(id);
        dragStateRef.current = {
          anchorIndex: idx,
          baseSelection: new Set(next),
          additive: true,
        };
        return;
      }

      setSelectedIds(new Set([id]));
      setLastClickedId(id);
      dragStateRef.current = {
        anchorIndex: idx,
        baseSelection: new Set(),
        additive: false,
      };
    },
    [rows, selectedIds, lastClickedId],
  );

  const handleRowMouseEnter = useCallback(
    (id: string, e: React.MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // Primary button must still be held — guards against a dropped mouseup.
      if ((e.buttons & 1) === 0) {
        dragStateRef.current = null;
        return;
      }
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return;
      const [lo, hi] =
        idx < drag.anchorIndex ? [idx, drag.anchorIndex] : [drag.anchorIndex, idx];
      const next = drag.additive ? new Set(drag.baseSelection) : new Set<string>();
      for (let i = lo; i <= hi; i += 1) next.add(rows[i].id);
      setSelectedIds(next);
      setCurrentFrameIndex(idx);
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

  const commitDelayDialog = useCallback(() => {
    if (!delayDialog) return;
    const numeric = Number(delayDialog.value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error('Invalid delay');
      return;
    }
    const delayMs =
      delayDialog.mode === 'fps'
        ? Math.round(1000 / numeric)
        : Math.round(numeric * 1000);
    if (delayMs < 1 || delayMs > 60000) {
      toast.error('Delay must be between 1ms and 60s');
      return;
    }
    const ids = new Set(delayDialog.rowIds);
    setRows((prev) =>
      prev.map((r) => (ids.has(r.id) ? { ...r, delayMs } : r)),
    );
    setDelayDialog(null);
  }, [delayDialog]);

  const handleDelayDialogWheel = useCallback(
    (e: React.WheelEvent) => {
      // Ctrl + wheel for fine-tuned adjustment, matching Honeycam's UX.
      if (!e.ctrlKey || !delayDialog) return;
      e.preventDefault();
      const current = Number(delayDialog.value);
      if (!Number.isFinite(current)) return;
      const step = delayDialog.mode === 'fps' ? 1 : 0.001;
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.max(0.001, current + step * dir);
      setDelayDialog({
        ...delayDialog,
        value: delayDialog.mode === 'fps' ? next.toFixed(0) : next.toFixed(3),
      });
    },
    [delayDialog],
  );

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
      const out: FrameRow[] = [];
      const newIds: string[] = [];
      for (const row of prev) {
        out.push(row);
        if (selectedIds.has(row.id)) {
          const dup: FrameRow = { ...row, id: newRowId(row.sourceIndex) };
          out.push(dup);
          newIds.push(dup.id);
        }
      }
      if (newIds.length > 0) {
        setSelectedIds(new Set(newIds));
        setLastClickedId(newIds[newIds.length - 1]);
      }
      return out;
    });
  }, [selectedIds]);

  const applyDelayToSelection = useCallback(() => {
    const parsed = Number(delayInput);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60000) {
      toast.error('Delay must be between 1 and 60000 ms');
      return;
    }
    setRows((prev) =>
      prev.map((r) => (selectedIds.has(r.id) ? { ...r, delayMs: Math.round(parsed) } : r)),
    );
  }, [delayInput, selectedIds]);

  const applyDelayToAll = useCallback(() => {
    const parsed = Number(delayInput);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60000) {
      toast.error('Delay must be between 1 and 60000 ms');
      return;
    }
    setRows((prev) => prev.map((r) => ({ ...r, delayMs: Math.round(parsed) })));
    toast.success(`All ${rows.length} frames set to ${Math.round(parsed)}ms`);
  }, [delayInput, rows.length]);

  const resetTimings = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, delayMs: r.originalDelayMs })));
  }, []);

  const reverseFrames = useCallback(() => {
    setRows((prev) => prev.slice().reverse());
  }, []);

  /**
   * Decide which 0-indexed rows survive a Drop Frames pass. Frame numbering
   * in the UI is 1-based — "Even frames (2, 4, 6...)" means drop the 2nd,
   * 4th, 6th visible row.
   */
  const computeDropKeepMask = useCallback(
    (
      total: number,
      mode: 'none' | 'even' | 'odd' | 'every-n',
      nValue: number,
    ): boolean[] => {
      const keep = new Array(total).fill(true);
      if (mode === 'none' || total === 0) return keep;
      for (let i = 0; i < total; i += 1) {
        const oneBased = i + 1;
        if (mode === 'even') keep[i] = oneBased % 2 !== 0;
        else if (mode === 'odd') keep[i] = oneBased % 2 === 0;
        else if (mode === 'every-n')
          keep[i] = nValue > 1 ? oneBased % nValue !== 0 : false;
      }
      return keep;
    },
    [],
  );

  /**
   * Live preview stats for the Drop Frames dialog — recomputed from the
   * dialog config so the user can see "341 → 171" before clicking OK.
   */
  const dropDialogStats = useMemo(() => {
    if (!dropDialog) return null;
    const keep = computeDropKeepMask(rows.length, dropDialog.mode, dropDialog.nValue);
    const keptCount = keep.reduce((acc, k) => acc + (k ? 1 : 0), 0);
    const sourceDuration = rows.reduce((acc, r) => acc + r.delayMs, 0);
    const outDuration = dropDialog.keepPlaybackSpeed
      ? sourceDuration
      : keep.reduce((acc, k, i) => acc + (k ? rows[i].delayMs : 0), 0);
    return { keptCount, total: rows.length, sourceDuration, outDuration };
  }, [dropDialog, rows, computeDropKeepMask]);

  const applyDropFrames = useCallback(() => {
    if (!dropDialog) return;
    const { mode, nValue, keepPlaybackSpeed } = dropDialog;
    setRows((prev) => {
      const keep = computeDropKeepMask(prev.length, mode, nValue);
      if (keep.every(Boolean)) return prev;
      if (keep.every((k) => !k)) {
        toast.error('That would drop every frame');
        return prev;
      }
      if (!keepPlaybackSpeed) {
        return prev.filter((_, i) => keep[i]);
      }
      // Fold each dropped frame's delay into the next kept frame, so the
      // total playback duration stays constant.
      const out: FrameRow[] = [];
      let carry = 0;
      for (let i = 0; i < prev.length; i += 1) {
        if (keep[i]) {
          out.push({ ...prev[i], delayMs: prev[i].delayMs + carry });
          carry = 0;
        } else {
          carry += prev[i].delayMs;
        }
      }
      if (carry > 0 && out.length > 0) {
        out[out.length - 1] = {
          ...out[out.length - 1],
          delayMs: out[out.length - 1].delayMs + carry,
        };
      }
      return out;
    });
    setDropDialog(null);
  }, [dropDialog, computeDropKeepMask]);

  const openDropDialog = useCallback(() => {
    setIsPlaying(false);
    setDropDialog({
      mode: 'none',
      nValue: 3,
      keepPlaybackSpeed: true,
    });
  }, []);

  const hasFrameEdits = useMemo(() => {
    if (!info) return false;
    if (rows.length !== info.frameCount) return true;
    return rows.some(
      (r, i) => r.sourceIndex !== i || r.delayMs !== r.originalDelayMs,
    );
  }, [rows, info]);

  /**
   * Snapshot the rows to be exported and open the preview dialog. The actual
   * file dialog + Rust invoke happens after the user clicks "Save" inside the
   * preview.
   */
  const handleExportSelectedFrames = useCallback(() => {
    if (selectedIds.size === 0) {
      toast.error('Select frames to export');
      return;
    }
    const selectedRows = rows.filter((r) => selectedIds.has(r.id));
    if (selectedRows.length === 0) return;
    setIsPlaying(false);
    setPreviewFrameIdx(0);
    setExportPreview({ rows: selectedRows, scope: 'selection' });
  }, [rows, selectedIds]);

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
    if (rows.length === 0) {
      toast.error('No frames to export');
      return;
    }
    setIsPlaying(false);
    setPreviewFrameIdx(0);
    setExportPreview({ rows, scope: 'all' });
  }, [capturePath, info, rows]);

  /**
   * Confirmed export from the preview dialog. Opens the OS save dialog, builds
   * the manifest and calls the appropriate Rust command. Selection scope and
   * "full GIF with structural edits" both use encode_gif_from_frames; only the
   * "full GIF, no structural edits" pristine case uses the fast process_gif
   * path.
   */
  const performExport = useCallback(async () => {
    if (!exportPreview || !capturePath || !info) return;
    const exportRows = exportPreview.rows;
    if (exportRows.length === 0) return;

    const baseSavePath = deriveDefaultSavePath(capturePath);
    const defaultPath =
      exportPreview.scope === 'selection'
        ? baseSavePath.replace(/\.gif$/i, '-selection.gif')
        : baseSavePath;

    try {
      const destination = await saveFileDialog({
        title:
          exportPreview.scope === 'selection'
            ? 'Export selected frames'
            : 'Export GIF',
        defaultPath,
        filters: [{ name: 'GIF', extensions: ['gif'] }],
      });
      if (!destination) return;

      setIsExporting(true);

      const baselineW = ui.crop?.w ?? gifData?.width ?? 0;
      const baselineH = ui.crop?.h ?? gifData?.height ?? 0;
      const usingExplicitSize =
        !!gifData &&
        (ui.outputWidth !== baselineW || ui.outputHeight !== baselineH);
      const outputWidth = usingExplicitSize
        ? Math.max(1, Math.round(ui.outputWidth))
        : null;
      const outputHeight = usingExplicitSize
        ? Math.max(1, Math.round(ui.outputHeight))
        : null;

      // The fast `process_gif` route doesn't honor the manifest-level
      // "limit FPS" / "cap frame time" transforms, so fall back to the
      // manifest encoder whenever either is active.
      const fullScopeNoFrameEdits =
        exportPreview.scope === 'all' &&
        !hasFrameEdits &&
        !ui.limitFps &&
        !ui.capFrameTime;

      const qualityPreset = qualityNumericToPreset(ui.qualityValue);

      const cropPayload: GifCrop | null = ui.crop
        ? {
            x: Math.max(0, Math.round(ui.crop.x)),
            y: Math.max(0, Math.round(ui.crop.y)),
            width: Math.max(1, Math.round(ui.crop.w)),
            height: Math.max(1, Math.round(ui.crop.h)),
          }
        : null;

      if (fullScopeNoFrameEdits) {
        const options: GifEditOptions = {
          trimStartMs: 0,
          trimEndMs: Math.max(1, sourceDurationMs),
          speed: ui.speed,
          scalePct: 100,
          reverse: false,
          loopForever: ui.loopForever,
          fps: null,
          crop: cropPayload,
          outputWidth,
          outputHeight,
          rotationDegrees: ui.rotation,
          flipH: ui.flipH,
          flipV: ui.flipV,
          quality: qualityPreset,
          qualityValue: Math.round(ui.qualityValue),
        };
        await invoke('process_gif', {
          inputPath: capturePath,
          outputPath: destination,
          options,
        });
      } else {
        const speed = ui.speed > 0 ? ui.speed : 1;
        let manifest: GifFrameSpec[] = exportRows.map((r) => ({
          sourceIndex: r.sourceIndex,
          delayMs: Math.max(1, Math.round(r.delayMs / speed)),
        }));
        if (ui.capFrameTime) {
          manifest = applyMaxFrameTime(
            manifest,
            Math.max(10, Math.round(ui.maxFrameTimeSec * 1000)),
          );
        }
        if (ui.limitFps) {
          manifest = applyFpsLimit(manifest, ui.fpsCap);
        }

        const options: GifFrameEncodeOptions = {
          frames: manifest,
          scalePct: 100,
          crop: cropPayload,
          outputWidth,
          outputHeight,
          rotationDegrees: ui.rotation,
          flipH: ui.flipH,
          flipV: ui.flipV,
          loopForever: ui.loopForever,
          quality: qualityPreset,
          qualityValue: Math.round(ui.qualityValue),
        };

        await invoke('encode_gif_from_frames', {
          inputPath: capturePath,
          outputPath: destination,
          options,
        });
      }
      toast.success(
        exportPreview.scope === 'selection'
          ? `Exported ${exportRows.length} frames`
          : 'GIF exported',
      );
      setExportPreview(null);
    } catch (err) {
      reportError(err, { operation: 'gif export' });
      toast.error(
        `Failed to export GIF: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsExporting(false);
    }
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
    if (!capturePath) return 'GIF Editor';
    const parts = capturePath.split(/[/\\]/);
    return parts[parts.length - 1] || 'GIF Editor';
  }, [capturePath]);

  useEffect(() => {
    if (!listRef.current || rows.length === 0) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-row-index="${currentFrameIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentFrameIndex, rows.length]);

  const outerClasses = embedded
    ? 'editor-window flex-1 flex flex-col min-h-0'
    : 'editor-window h-screen w-screen flex flex-col overflow-hidden';

  const renderTitlebar = (detailLabel: string) =>
    embedded ? null : (
      <Titlebar
        title="MoonSnap"
        variant="hud"
        contextLabel="GIF Editor"
        detailLabel={detailLabel}
        showLogo
        showMaximize
      />
    );

  if (isLoading) {
    return (
      <div className={outerClasses}>
        {renderTitlebar('Loading')}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
            <p className="text-sm text-(--ink-muted)">Loading GIF...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={outerClasses}>
        {renderTitlebar('Error')}
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

  const selectedCount = selectedIds.size;

  return (
    <div className={outerClasses}>
      {renderTitlebar(filename)}

      <div className="flex-1 flex min-h-0 bg-[var(--background)]">
        {/* Left: frame list */}
        <aside className="w-[240px] shrink-0 border-r border-(--polar-mist) flex flex-col bg-[var(--card)]">
          <div className="px-3 py-2 border-b border-(--polar-mist) flex items-center justify-between text-xs text-(--ink-muted)">
            <span>Frames {rows.length > 0 ? `(${rows.length})` : ''}</span>
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
                    {rows.map((row, i) => {
                      const isSelected = selectedIds.has(row.id);
                      const isPlayhead = i === currentFrameIndex;
                      const isCustomDelay = row.delayMs !== row.originalDelayMs;
                      return (
                        <tr
                          key={row.id}
                          data-row-id={row.id}
                          data-row-index={i}
                          onMouseDown={(e) => handleRowMouseDown(row.id, e)}
                          onMouseEnter={(e) => handleRowMouseEnter(row.id, e)}
                          onDoubleClick={() => handleRowDoubleClick(row.id)}
                          onContextMenu={() => {
                            // Right-click a row not already in the selection:
                            // select it so the menu acts on the visible target.
                            if (!selectedIds.has(row.id)) {
                              setSelectedIds(new Set([row.id]));
                              setLastClickedId(row.id);
                              setCurrentFrameIndex(i);
                              setIsPlaying(false);
                            }
                          }}
                          className={cn(
                            'cursor-pointer select-none',
                            isSelected
                              ? 'bg-(--accent-400)/20 text-(--ink-black)'
                              : 'hover:bg-(--polar-mist)/40',
                          )}
                        >
                          <td
                            className={cn(
                              'px-3 py-1 tabular-nums border-l-2',
                              isPlayhead
                                ? 'border-(--accent-400)'
                                : 'border-transparent',
                            )}
                          >
                            {i + 1}
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
                    })}
                  </tbody>
                </table>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                disabled={selectedCount === 0}
                onSelect={() => void handleExportSelectedFrames()}
              >
                Export selected frames…
                <ContextMenuShortcut>Ctrl+Shift+E</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                disabled={
                  selectedCount === 0 || rows.length - selectedCount < 1
                }
                onSelect={handleDeleteSelected}
              >
                Delete
                <ContextMenuShortcut>Del</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                disabled={selectedCount === 0}
                onSelect={handleDuplicateSelected}
              >
                Duplicate
              </ContextMenuItem>
              <ContextMenuItem
                disabled={selectedCount === 0}
                onSelect={() =>
                  openDelayDialogFor(Array.from(selectedIds))
                }
              >
                Set frame delay…
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          {/* Frame actions */}
          <div className="p-3 border-t border-(--polar-mist) flex flex-col gap-2">
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={selectedCount === 0}
                title="Delete selected frame(s)"
                className="flex-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDuplicateSelected}
                disabled={selectedCount === 0}
                title="Duplicate selected frame(s)"
                className="flex-1"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetTimings}
                title="Reset all delays to original"
                className="flex-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={openDropDialog}
              disabled={rows.length === 0}
              title="Drop frames in a pattern (even, odd, every Nth)"
              className="text-xs"
            >
              Drop frames…
            </Button>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-(--ink-muted)">Delay (ms)</Label>
              <Input
                type="number"
                min={1}
                max={60000}
                step={1}
                value={delayInput}
                onChange={(e) => setDelayInput(e.target.value)}
                placeholder="e.g. 50"
                className="h-8 text-sm"
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyDelayToSelection}
                  disabled={selectedCount === 0 || delayInput === ''}
                  className="flex-1 text-xs"
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyDelayToAll}
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

        {/* Center: preview + transport */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex items-center justify-center overflow-hidden p-6">
            {gifData && (
              <>
                <canvas
                  ref={previewCanvasRef}
                  className="max-w-full max-h-full object-contain shadow-lg"
                  style={{ imageRendering: 'pixelated' }}
                />
                {cropEditing && ui.crop && (
                  <GifCropOverlay
                    canvasEl={previewCanvasRef.current}
                    sourceWidth={gifData.width}
                    sourceHeight={gifData.height}
                    crop={ui.crop}
                    onChange={(next) => setUi((p) => ({ ...p, crop: next }))}
                  />
                )}
              </>
            )}
          </div>

          {/* Transport bar */}
          <div className="px-6 py-3 flex items-center gap-3 border-t border-(--polar-mist)">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setIsPlaying(false);
                  seekToFrame(0);
                }}
                disabled={rows.length === 0}
                aria-label="First frame"
                title="First frame (Home)"
              >
                <ChevronFirst className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setIsPlaying(false);
                  seekToFrame(Math.max(0, currentFrameIndex - 1));
                }}
                disabled={rows.length === 0 || currentFrameIndex === 0}
                aria-label="Previous frame"
                title="Previous frame (←)"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsPlaying((p) => !p)}
                disabled={rows.length === 0}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setIsPlaying(false);
                  seekToFrame(Math.min(rows.length - 1, currentFrameIndex + 1));
                }}
                disabled={rows.length === 0 || currentFrameIndex >= rows.length - 1}
                aria-label="Next frame"
                title="Next frame (→)"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setIsPlaying(false);
                  seekToFrame(Math.max(0, rows.length - 1));
                }}
                disabled={rows.length === 0}
                aria-label="Last frame"
                title="Last frame (End)"
              >
                <ChevronLast className="w-4 h-4" />
              </Button>
            </div>

            <div className="text-xs tabular-nums text-(--ink-muted) min-w-[60px]">
              {rows.length > 0 ? `${currentFrameIndex + 1}/${rows.length}` : '0/0'}
            </div>

            <div className="flex-1 min-w-0">
              <Slider
                value={[currentFrameIndex]}
                min={0}
                max={Math.max(0, rows.length - 1)}
                step={1}
                onValueChange={(v) => {
                  setIsPlaying(false);
                  seekToFrame(v[0]);
                }}
              />
            </div>

            <div className="text-xs text-(--ink-muted) whitespace-nowrap">
              {formatDuration(durationMs)}
              {hasFrameEdits && (
                <span className="ml-2 text-(--accent-400)">· edited</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: source info + global edits + export */}
        <aside className="w-[320px] shrink-0 border-l border-(--polar-mist) flex flex-col bg-[var(--card)]">
          <div className="p-5 flex flex-col gap-5 overflow-y-auto">
            <section className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wide text-(--ink-muted)">Source</h3>
              <dl className="text-sm grid grid-cols-2 gap-y-1">
                <dt className="text-(--ink-muted)">Dimensions</dt>
                <dd>{info ? `${info.width} × ${info.height}` : '—'}</dd>
                <dt className="text-(--ink-muted)">Duration</dt>
                <dd>{formatDuration(sourceDurationMs)}</dd>
                <dt className="text-(--ink-muted)">Frames</dt>
                <dd>{info?.frameCount ?? '—'}</dd>
                <dt className="text-(--ink-muted)">FPS</dt>
                <dd>{info ? info.fps.toFixed(1) : '—'}</dd>
                <dt className="text-(--ink-muted)">Size</dt>
                <dd>{formatFileSize(fileSize)}</dd>
              </dl>
            </section>

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
                  onValueChange={(v) => setUi((p) => ({ ...p, speed: v[0] }))}
                />
              </div>

              {gifData && (
                (() => {
                  // Size controls operate relative to the *current* baseline:
                  // the crop dims when a crop is applied, else the source
                  // dims. That way scaling never accidentally upsizes a
                  // cropped frame back to source dimensions on export.
                  const baselineW = ui.crop?.w ?? gifData.width;
                  const baselineH = ui.crop?.h ?? gifData.height;
                  const pct =
                    baselineW > 0
                      ? Math.round((ui.outputWidth / baselineW) * 100)
                      : 100;
                  return (
                    <div className="flex flex-col gap-2">
                      <Label className="text-sm">Size</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <span className="text-[10px] uppercase text-(--ink-muted)">W</span>
                          <Input
                            type="number"
                            min={1}
                            max={4096}
                            value={ui.outputWidth || ''}
                            onChange={(e) => {
                              const w = Math.max(1, Math.round(Number(e.target.value) || 0));
                              setUi((p) => {
                                if (p.keepAspect) {
                                  const ratio = baselineH / baselineW;
                                  return {
                                    ...p,
                                    outputWidth: w,
                                    outputHeight: Math.max(1, Math.round(w * ratio)),
                                  };
                                }
                                return { ...p, outputWidth: w };
                              });
                            }}
                            className="h-8 text-sm"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 mt-4"
                          onClick={() =>
                            setUi((p) => ({ ...p, keepAspect: !p.keepAspect }))
                          }
                          title={
                            ui.keepAspect
                              ? 'Aspect ratio locked'
                              : 'Aspect ratio unlocked'
                          }
                          aria-label="Toggle aspect ratio lock"
                        >
                          {ui.keepAspect ? (
                            <LinkIcon className="w-4 h-4" />
                          ) : (
                            <Unlink className="w-4 h-4" />
                          )}
                        </Button>
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <span className="text-[10px] uppercase text-(--ink-muted)">H</span>
                          <Input
                            type="number"
                            min={1}
                            max={4096}
                            value={ui.outputHeight || ''}
                            onChange={(e) => {
                              const h = Math.max(1, Math.round(Number(e.target.value) || 0));
                              setUi((p) => {
                                if (p.keepAspect) {
                                  const ratio = baselineW / baselineH;
                                  return {
                                    ...p,
                                    outputHeight: h,
                                    outputWidth: Math.max(1, Math.round(h * ratio)),
                                  };
                                }
                                return { ...p, outputHeight: h };
                              });
                            }}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Slider
                          className="flex-1"
                          value={[pct]}
                          min={10}
                          max={300}
                          step={1}
                          onValueChange={(v) => {
                            const newPct = v[0];
                            setUi((p) => ({
                              ...p,
                              outputWidth: Math.max(
                                1,
                                Math.round((baselineW * newPct) / 100),
                              ),
                              outputHeight: Math.max(
                                1,
                                Math.round((baselineH * newPct) / 100),
                              ),
                            }));
                          }}
                        />
                        <span className="text-xs text-(--ink-muted) min-w-[44px] text-right tabular-nums">
                          {pct}%
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-(--ink-muted) hover:text-(--accent-400) text-left"
                        onClick={() =>
                          setUi((p) => ({
                            ...p,
                            outputWidth: baselineW,
                            outputHeight: baselineH,
                          }))
                        }
                      >
                        Reset to {baselineW} × {baselineH}
                      </button>
                    </div>
                  );
                })()
              )}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Crop</Label>
                  {ui.crop && (
                    <span className="text-xs text-(--ink-muted) tabular-nums">
                      {ui.crop.w} × {ui.crop.h}
                    </span>
                  )}
                </div>
                {!cropEditing && !ui.crop && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={enterCropEditing}
                  >
                    <Crop className="w-3.5 h-3.5 mr-1" /> Crop
                  </Button>
                )}
                {cropEditing && (
                  <>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={applyCrop}
                      >
                        Apply
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={cancelCropEditing}
                      >
                        Cancel
                      </Button>
                    </div>
                    <p className="text-[10px] text-(--ink-muted) leading-snug">
                      Drag the rectangle on the preview, then click Apply.
                    </p>
                  </>
                )}
                {!cropEditing && ui.crop && (
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={enterCropEditing}
                    >
                      <Crop className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={removeCrop}
                      title="Remove crop"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm">Rotation</Label>
                <div className="flex gap-1">
                  {([
                    { v: 0, label: 'None' },
                    { v: 90, label: '90° CW', icon: <RotateCw className="w-3.5 h-3.5" /> },
                    { v: 180, label: '180°' },
                    { v: 270, label: '90° CCW', icon: <RotateCcw className="w-3.5 h-3.5" /> },
                  ] as const).map((opt) => (
                    <Button
                      key={opt.v}
                      variant={ui.rotation === opt.v ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() =>
                        setUi((p) => ({ ...p, rotation: opt.v as UiState['rotation'] }))
                      }
                    >
                      {'icon' in opt && opt.icon ? opt.icon : opt.label}
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
                    onClick={() => setUi((p) => ({ ...p, flipH: !p.flipH }))}
                    title="Flip horizontally"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5 mr-1" />
                    Horizontal
                  </Button>
                  <Button
                    variant={ui.flipV ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setUi((p) => ({ ...p, flipV: !p.flipV }))}
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
                  onClick={reverseFrames}
                  disabled={rows.length === 0}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reverse
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="loop-switch" className="text-sm">Loop forever</Label>
                <Switch
                  id="loop-switch"
                  checked={ui.loopForever}
                  onCheckedChange={(v) => setUi((p) => ({ ...p, loopForever: v }))}
                />
              </div>
            </section>
          </div>

          <div className="mt-auto p-5 border-t border-(--polar-mist)">
            <Button
              className="w-full"
              onClick={handleExport}
              disabled={isExporting || !info || rows.length === 0}
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
      </div>

      <Dialog
        open={!!delayDialog?.open}
        onOpenChange={(next) => {
          if (!next) setDelayDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set frame delay</DialogTitle>
            <DialogDescription>
              {delayDialog && delayDialog.rowIds.length > 1
                ? `Applies to ${delayDialog.rowIds.length} frames.`
                : 'Applies to the selected frame.'}
            </DialogDescription>
          </DialogHeader>

          {delayDialog && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="delay-mode"
                    checked={delayDialog.mode === 'sec'}
                    onChange={() => {
                      const numeric = Number(delayDialog.value);
                      const newValue = Number.isFinite(numeric) && numeric > 0
                        ? (delayDialog.mode === 'fps' ? 1 / numeric : numeric).toFixed(3)
                        : '0.030';
                      setDelayDialog({ ...delayDialog, mode: 'sec', value: newValue });
                    }}
                  />
                  Seconds
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="delay-mode"
                    checked={delayDialog.mode === 'fps'}
                    onChange={() => {
                      const numeric = Number(delayDialog.value);
                      const newValue = Number.isFinite(numeric) && numeric > 0
                        ? (delayDialog.mode === 'sec' ? 1 / numeric : numeric).toFixed(0)
                        : '30';
                      setDelayDialog({ ...delayDialog, mode: 'fps', value: newValue });
                    }}
                  />
                  FPS
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  autoFocus
                  step={delayDialog.mode === 'fps' ? 1 : 0.001}
                  min={delayDialog.mode === 'fps' ? 1 : 0.001}
                  max={delayDialog.mode === 'fps' ? 1000 : 60}
                  value={delayDialog.value}
                  onChange={(e) =>
                    setDelayDialog({ ...delayDialog, value: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitDelayDialog();
                    }
                  }}
                  onWheel={handleDelayDialogWheel}
                  className="flex-1"
                />
                <span className="text-sm text-(--ink-muted) w-12">
                  {delayDialog.mode === 'fps' ? 'fps' : 'sec'}
                </span>
              </div>

              <p className="text-xs text-(--ink-muted)">
                Hold Ctrl and use the mouse wheel for fine adjustment.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDelayDialog(null)}>
              Cancel
            </Button>
            <Button onClick={commitDelayDialog}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!dropDialog}
        onOpenChange={(next) => {
          if (!next) setDropDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Drop frames</DialogTitle>
            <DialogDescription>
              Pick a pattern. Stats update live.
            </DialogDescription>
          </DialogHeader>

          {dropDialog && dropDialogStats && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-y-1">
                <span className="text-(--ink-muted) text-xs">Frames</span>
                <span className="tabular-nums">
                  {dropDialogStats.total} → {dropDialogStats.keptCount}
                </span>
                <span className="text-(--ink-muted) text-xs">Duration</span>
                <span className="tabular-nums">
                  {formatDuration(dropDialogStats.sourceDuration)} →{' '}
                  {formatDuration(dropDialogStats.outDuration)}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                {(
                  [
                    { v: 'none', label: 'Show original' },
                    { v: 'even', label: 'Even frames (2, 4, 6…)' },
                    { v: 'odd', label: 'Odd frames (1, 3, 5…)' },
                    { v: 'every-n', label: 'Delete every N-th frame' },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.v}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="drop-mode"
                      checked={dropDialog.mode === opt.v}
                      onChange={() =>
                        setDropDialog({ ...dropDialog, mode: opt.v })
                      }
                    />
                    {opt.label}
                  </label>
                ))}
              </div>

              {dropDialog.mode === 'every-n' && (
                <div className="pl-5 flex items-center gap-3">
                  <Slider
                    className="flex-1"
                    value={[dropDialog.nValue]}
                    min={2}
                    max={20}
                    step={1}
                    onValueChange={(v) =>
                      setDropDialog({ ...dropDialog, nValue: v[0] })
                    }
                  />
                  <span className="text-xs text-(--ink-muted) tabular-nums w-6 text-right">
                    {dropDialog.nValue}
                  </span>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1 border-t border-(--polar-mist)">
                <input
                  type="checkbox"
                  checked={dropDialog.keepPlaybackSpeed}
                  onChange={(e) =>
                    setDropDialog({
                      ...dropDialog,
                      keepPlaybackSpeed: e.target.checked,
                    })
                  }
                />
                Keep the playback speed
              </label>
              <p className="text-[10px] text-(--ink-muted) leading-snug -mt-1 pl-5">
                {dropDialog.keepPlaybackSpeed
                  ? 'Dropped frames’ delays fold into the kept frames so total time stays the same.'
                  : 'Each kept frame keeps its original delay — total time shrinks.'}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDropDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={applyDropFrames}
              disabled={!dropDialog || dropDialog.mode === 'none'}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!exportPreview}
        onOpenChange={(next) => {
          if (!next && !isExporting) setExportPreview(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {exportPreview?.scope === 'selection'
                ? 'Export selected frames'
                : 'Export GIF'}
            </DialogTitle>
            <DialogDescription>
              Preview the output before saving. Playback loops at the
              configured speed.
            </DialogDescription>
          </DialogHeader>

          {exportPreview && gifData && (() => {
            const swap = ui.rotation === 90 || ui.rotation === 270;
            const cropW = ui.crop?.w ?? gifData.width;
            const cropH = ui.crop?.h ?? gifData.height;
            const usingExplicit =
              ui.outputWidth !== cropW || ui.outputHeight !== cropH;
            const baseW = usingExplicit ? ui.outputWidth : cropW;
            const baseH = usingExplicit ? ui.outputHeight : cropH;
            const outW = Math.max(1, Math.round(swap ? baseH : baseW));
            const outH = Math.max(1, Math.round(swap ? baseW : baseH));
            const speed = Math.max(0.05, ui.speed);
            const totalDelayMs = exportPreview.rows.reduce(
              (acc, r) => acc + Math.max(1, Math.round(r.delayMs / speed)),
              0,
            );
            return (
              <div className="flex gap-4">
                <div className="flex-1 min-w-0 flex items-center justify-center bg-(--polar-mist)/40 rounded-md p-3 min-h-[260px]">
                  <canvas
                    ref={previewCanvasInDialogRef}
                    className="max-w-full max-h-[320px] object-contain shadow-md"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <div className="w-56 shrink-0 flex flex-col gap-3 text-sm">
                  <dl className="grid grid-cols-2 gap-y-1">
                    <dt className="text-(--ink-muted)">Frames</dt>
                    <dd className="tabular-nums">{exportPreview.rows.length}</dd>
                    <dt className="text-(--ink-muted)">Duration</dt>
                    <dd className="tabular-nums">
                      {formatDuration(totalDelayMs)}
                    </dd>
                    <dt className="text-(--ink-muted)">Dimensions</dt>
                    <dd className="tabular-nums">
                      {outW} × {outH}
                    </dd>
                    {ui.rotation !== 0 && (
                      <>
                        <dt className="text-(--ink-muted)">Rotation</dt>
                        <dd>{ui.rotation}°</dd>
                      </>
                    )}
                    {(ui.flipH || ui.flipV) && (
                      <>
                        <dt className="text-(--ink-muted)">Flip</dt>
                        <dd>
                          {[ui.flipH && 'H', ui.flipV && 'V']
                            .filter(Boolean)
                            .join(' + ')}
                        </dd>
                      </>
                    )}
                    {ui.speed !== 1 && (
                      <>
                        <dt className="text-(--ink-muted)">Speed</dt>
                        <dd>{ui.speed.toFixed(2)}×</dd>
                      </>
                    )}
                    <dt className="text-(--ink-muted)">Loop</dt>
                    <dd>{ui.loopForever ? 'Forever' : 'Once'}</dd>
                  </dl>

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

                  <div className="flex flex-col gap-1 mt-1">
                    <Label className="text-xs">Preview size</Label>
                    <div className="relative rounded-md border border-(--polar-mist) bg-(--polar-mist)/30 h-7 overflow-hidden">
                      {estimating && (
                        <div className="absolute inset-0 bg-(--accent-400)/15 animate-pulse" />
                      )}
                      <div className="relative h-full flex items-center justify-center px-2 text-sm tabular-nums">
                        {estimatedBytes !== null ? (
                          <span>
                            {estimating ? 'Calculating… ' : ''}
                            {formatFileSize(estimatedBytes)}
                          </span>
                        ) : estimating ? (
                          <span className="flex items-center gap-2 text-(--ink-muted) text-xs">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Calculating…
                          </span>
                        ) : (
                          <span className="text-xs text-(--ink-muted)">—</span>
                        )}
                      </div>
                    </div>
                  </div>

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
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n > 0) {
                              setUi((p) => ({
                                ...p,
                                fpsCap: Math.max(1, Math.min(60, Math.round(n))),
                              }));
                            }
                          }}
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
                            setUi((p) => ({
                              ...p,
                              capFrameTime: e.target.checked,
                            }))
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
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n > 0) {
                              setUi((p) => ({
                                ...p,
                                maxFrameTimeSec: Math.min(60, n),
                              }));
                            }
                          }}
                          className="h-7 text-xs w-20"
                        />
                        <span className="text-[10px] text-(--ink-muted)">sec</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExportPreview(null)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button onClick={() => void performExport()} disabled={isExporting}>
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Save…
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/**
 * Default export: the standalone window. Reads the GIF path from the
 * `?path=` query parameter and falls back to closing the OS window on Esc.
 */
const GifEditorWindow: React.FC = () => <GifEditor />;

export default GifEditorWindow;
