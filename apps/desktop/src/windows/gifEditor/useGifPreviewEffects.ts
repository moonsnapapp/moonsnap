import { useEffect, useMemo, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { GifEstimateProgress } from '@/types/generated/GifEstimateProgress';
import { estimateGifPreviewSize, getGifPreviewPlaybackDelay, getNextPreviewFrameIndex } from './previewPlayback';
import {
  renderCropEditingPreviewIfReady,
  renderEditedPreviewIfReady,
  renderExportPreviewFrameIfReady,
} from './previewRenderer';
import type { ExportPreviewState, FrameRow, GifData, UiState } from './types';

interface GifPreviewEffectsOptions {
  rows: FrameRow[];
  selectedIds: Set<string>;
  currentFrameIndex: number;
  cropEditing: boolean;
  gifData: GifData | null;
  ui: UiState;
  exportPreview: ExportPreviewState | null;
  previewFrameIdx: number;
  capturePath: string | null;
  isPlaying: boolean;
  rowsRef: MutableRefObject<FrameRow[]>;
  currentFrameIndexRef: MutableRefObject<number>;
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  previewCanvasInDialogRef: RefObject<HTMLCanvasElement | null>;
  setDelayInput: Dispatch<SetStateAction<string>>;
  setCurrentFrameIndex: Dispatch<SetStateAction<number>>;
  setPreviewFrameIdx: Dispatch<SetStateAction<number>>;
  setEstimatedBytes: Dispatch<SetStateAction<number | null>>;
  setEstimating: Dispatch<SetStateAction<boolean>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
}

export function useGifPreviewEffects(options: GifPreviewEffectsOptions) {
  const {
    rows,
    selectedIds,
    currentFrameIndex,
    cropEditing,
    gifData,
    ui,
    exportPreview,
    previewFrameIdx,
    capturePath,
    isPlaying,
    rowsRef,
    currentFrameIndexRef,
    previewCanvasRef,
    previewCanvasInDialogRef,
    setDelayInput,
    setCurrentFrameIndex,
    setPreviewFrameIdx,
    setEstimatedBytes,
    setEstimating,
    setIsPlaying,
  } = options;

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
  }, [selectedIds, firstSelectedRow, setDelayInput]);

  // Mirror rows into a ref so keyboard handlers can see the latest list.
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows, rowsRef]);

  useEffect(() => {
    currentFrameIndexRef.current = currentFrameIndex;
  }, [currentFrameIndex, currentFrameIndexRef]);

  // Clamp the playhead when the row count changes (delete/duplicate).
  useEffect(() => {
    if (rows.length === 0) {
      setCurrentFrameIndex(0);
      return;
    }
    setCurrentFrameIndex((i) => Math.min(i, rows.length - 1));
  }, [rows.length, setCurrentFrameIndex]);

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
  }, [gifData, rows, currentFrameIndex, cropEditing, previewCanvasRef]);

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
    previewCanvasRef,
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
    previewCanvasInDialogRef,
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
  }, [exportPreview, previewFrameIdx, ui.speed, setPreviewFrameIdx]);

  // Reset the size estimate whenever the dialog closes.
  useEffect(() => {
    if (!exportPreview) {
      setEstimatedBytes(null);
      setEstimating(false);
    }
  }, [exportPreview, setEstimatedBytes, setEstimating]);

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
  }, [exportPreview, setEstimatedBytes]);

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
    setEstimatedBytes,
    setEstimating,
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
  }, [
    isPlaying,
    currentFrameIndex,
    rows,
    ui.speed,
    ui.loopForever,
    setCurrentFrameIndex,
    setIsPlaying,
  ]);
}
