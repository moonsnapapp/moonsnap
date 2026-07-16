import type { Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';

import { reportError } from '@/utils/errorReporting';
import type { GifInfo } from '@/types/generated/GifInfo';
import { deriveDefaultSavePath } from './frameOps';
import { buildGifEditOptions, buildGifFrameEncodeOptions } from './frameEditOps';
import type { ExportPreviewState, FrameRow, GifData, UiState } from './types';

type GifLoaderData = GifData;
type GifLoaderInfo = GifInfo;

export function getGifEditorFilename(capturePath: string | null) {
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

export function getSelectionExportPreviewState(
  rows: FrameRow[],
  selectedIds: Set<string>
): ExportPreviewState | null {
  const selectedRows = getSelectedExportRows(rows, selectedIds);
  return selectedRows.length > 0
    ? { rows: selectedRows, scope: 'selection' }
    : null;
}

export function getAllFramesExportPreviewState(rows: FrameRow[]): ExportPreviewState | null {
  return rows.length > 0 ? { rows, scope: 'all' } : null;
}

export function hasSelectedFrames(selectedIds: Set<string>) {
  return selectedIds.size > 0;
}

export function applyPendingCrop(cropEditing: boolean, applyCrop: () => void) {
  if (cropEditing) {
    applyCrop();
  }
}

export function canUseFullGifProcessCommand({
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

export interface GifExportRequest {
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

export function getGifExportRequest({
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

export async function runGifExportRequest({
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
  setIsExporting: Dispatch<SetStateAction<boolean>>;
  setExportPreview: Dispatch<SetStateAction<ExportPreviewState | null>>;
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
