import { useCallback, type MutableRefObject } from 'react';
import { availableMonitors } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { AreaSelectionBounds, SavedAreaSelection } from '../../stores/captureSettingsStore';
import type { CaptureType } from '../../types';
import { toolbarLogger } from '../../utils/logger';
import { captureAreaSelectionToEditor, showNativeSavedAreaFeedback, showReusableAreaOverlay } from './toolbarOperations';
import { clampAreaSelectionToVisibleMonitor, willReplaceOldestSavedArea } from './toolbarPolicy';

interface SavedAreaActionsOptions {
  captureType: CaptureType;
  lastAreaSelection: AreaSelectionBounds | null;
  currentAreaSelection: AreaSelectionBounds | null;
  isCurrentAreaSaved: boolean;
  isNativeSelectionHudActive: boolean;
  savedAreaSelections: SavedAreaSelection[];
  setLastAreaSelection: (selection: AreaSelectionBounds) => void;
  saveAreaSelection: (selection: AreaSelectionBounds) => SavedAreaSelection | null;
  deleteAreaSelection: (id: string) => void;
  areaSelectionFlowActiveRef: MutableRefObject<boolean>;
}

export function useSavedAreaActions(options: SavedAreaActionsOptions) {
  const { captureType, lastAreaSelection, currentAreaSelection, isCurrentAreaSaved,
    isNativeSelectionHudActive, savedAreaSelections, setLastAreaSelection,
    saveAreaSelection, deleteAreaSelection, areaSelectionFlowActiveRef } = options;

  const reuseAreaSelection = useCallback(async (selection: AreaSelectionBounds) => {
    const currentWindow = getCurrentWebviewWindow();
    try {
      const monitors = await availableMonitors().catch(() => []);
      const reusableSelection = clampAreaSelectionToVisibleMonitor(selection, monitors);
      if (!reusableSelection) {
        toolbarLogger.warn('Skipping reusable area because it no longer fits the current desktop');
        return;
      }
      setLastAreaSelection(reusableSelection);
      areaSelectionFlowActiveRef.current = true;
      await currentWindow.hide();
      if (captureType === 'screenshot') {
        await captureAreaSelectionToEditor({ selection: reusableSelection, currentWindow });
        return;
      }
      await showReusableAreaOverlay({ selection: reusableSelection, captureType });
    } catch (error) {
      toolbarLogger.error('Failed to reuse saved area:', error);
      areaSelectionFlowActiveRef.current = false;
      await currentWindow.show().catch(() => {});
    }
  }, [areaSelectionFlowActiveRef, captureType, setLastAreaSelection]);

  const handleSelectLastArea = useCallback(() => {
    if (lastAreaSelection) void reuseAreaSelection(lastAreaSelection);
  }, [lastAreaSelection, reuseAreaSelection]);
  const handleSelectSavedArea = useCallback((selection: SavedAreaSelection) => {
    void reuseAreaSelection(selection);
  }, [reuseAreaSelection]);
  const handleDeleteSavedArea = useCallback((id: string) => deleteAreaSelection(id), [deleteAreaSelection]);
  const handleSaveCurrentArea = useCallback(() => {
    if (!currentAreaSelection) return;
    const replacedOldest = willReplaceOldestSavedArea(isCurrentAreaSaved, savedAreaSelections.length);
    const savedArea = saveAreaSelection(currentAreaSelection);
    if (savedArea && isNativeSelectionHudActive) void showNativeSavedAreaFeedback(replacedOldest);
  }, [currentAreaSelection, isCurrentAreaSaved, isNativeSelectionHudActive, saveAreaSelection, savedAreaSelections.length]);

  return { handleSelectLastArea, handleSelectSavedArea, handleDeleteSavedArea, handleSaveCurrentArea };
}
