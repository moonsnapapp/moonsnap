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
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { toast } from 'sonner';

import { useTheme } from '@/hooks/useTheme';
import type {
  UiState,
  FrameRow,
  DelayDialogState,
  DropDialogState,
  ExportPreviewState,
} from './types';
import { DelayDialog } from './DelayDialog';
import { DropFramesDialog } from './DropFramesDialog';
import { ExportPreviewDialog } from './ExportPreviewDialog';
import { useGifKeyboardShortcuts } from './useGifKeyboardShortcuts';
import { useGifLoader } from './useGifLoader';
import {
  getRowDragSelectionUpdate,
  getRowMouseDownSelectionUpdate,
  type GifFrameDragState,
} from './selectionOps';
import { GifEditorSidebar } from './GifEditorSidebar';
import {
  applyDropFrameSelection,
  duplicateSelectedRows,
  getDropDialogStats,
  hasGifFrameEdits,
  parseGifDelayMs,
} from './frameEditOps';
import { getGifEditorFilename } from './exportService';
import {
  getAppliedCropState,
  getCancelledCropState,
  getCropEditingStartState,
  getGifEditorOuterClasses,
  getRemovedCropState,
  renderGifEditorStatusView,
  renderGifEditorTitlebar,
} from './windowHelpers';
import { GifFrameListPane } from './GifFrameListPane';
import { GifPreviewPanel } from './GifPreviewPanel';
import { useGifPreviewEffects } from './useGifPreviewEffects';
import { useGifExportActions } from './useGifExportActions';

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

  useGifPreviewEffects({
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
  });

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
  const {
    handleExportSelectedFrames,
    handleExport,
    performExport,
  } = useGifExportActions({
    selectedIds,
    rows,
    cropEditing,
    applyCrop,
    setIsPlaying,
    setPreviewFrameIdx,
    setExportPreview,
    capturePath,
    info,
    exportPreview,
    hasFrameEdits,
    ui,
    gifData,
    sourceDurationMs,
    setIsExporting,
    exportSelectedRef,
    deleteSelectedRef,
    handleDeleteSelected,
  });

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
