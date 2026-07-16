import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';

import type { GifInfo } from '@/types/generated/GifInfo';
import {
  applyPendingCrop,
  getAllFramesExportPreviewState,
  getGifExportRequest,
  getSelectionExportPreviewState,
  hasSelectedFrames,
  runGifExportRequest,
} from './exportService';
import type { ExportPreviewState, FrameRow, GifData, UiState } from './types';

interface GifExportActionsOptions {
  selectedIds: Set<string>;
  rows: FrameRow[];
  cropEditing: boolean;
  applyCrop: () => void;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPreviewFrameIdx: Dispatch<SetStateAction<number>>;
  setExportPreview: Dispatch<SetStateAction<ExportPreviewState | null>>;
  capturePath: string | null;
  info: GifInfo | null;
  exportPreview: ExportPreviewState | null;
  hasFrameEdits: boolean;
  ui: UiState;
  gifData: GifData | null;
  sourceDurationMs: number;
  setIsExporting: Dispatch<SetStateAction<boolean>>;
  exportSelectedRef: MutableRefObject<(() => void) | null>;
  deleteSelectedRef: MutableRefObject<(() => void) | null>;
  handleDeleteSelected: () => void;
}

export function useGifExportActions(options: GifExportActionsOptions) {
  const {
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
  } = options;

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
  }, [
    rows,
    selectedIds,
    cropEditing,
    applyCrop,
    setIsPlaying,
    setPreviewFrameIdx,
    setExportPreview,
  ]);

  useEffect(() => {
    exportSelectedRef.current = () => void handleExportSelectedFrames();
  }, [exportSelectedRef, handleExportSelectedFrames]);

  useEffect(() => {
    deleteSelectedRef.current = () => handleDeleteSelected();
  }, [deleteSelectedRef, handleDeleteSelected]);

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
  }, [
    capturePath,
    info,
    rows,
    cropEditing,
    applyCrop,
    setIsPlaying,
    setPreviewFrameIdx,
    setExportPreview,
  ]);

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
    setIsExporting,
    setExportPreview,
  ]);

  return { handleExportSelectedFrames, handleExport, performExport };
}
