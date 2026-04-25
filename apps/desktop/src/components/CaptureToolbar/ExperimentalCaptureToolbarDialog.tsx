import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { CaptureToolbar } from './CaptureToolbar';
import type { CaptureSource } from './SourceSelector';
import {
  useCaptureSettingsStore,
  type AreaSelectionBounds,
  type SavedAreaSelection,
} from '@/stores/captureSettingsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { captureLogger } from '@/utils/logger';
import type { CaptureType } from '@/types';

interface ExperimentalCaptureToolbarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function toOverlayCaptureType(captureType: CaptureType): string {
  return captureType === 'gif' ? 'gif' : captureType === 'screenshot' ? 'screenshot' : 'video';
}

export function ExperimentalCaptureToolbarDialog({
  open,
  onOpenChange,
}: ExperimentalCaptureToolbarDialogProps) {
  const {
    activeMode,
    isInitialized,
    lastAreaSelection,
    savedAreaSelections,
    loadSettings,
    setActiveMode,
    setSourceMode,
    deleteAreaSelection,
  } = useCaptureSettingsStore();

  useEffect(() => {
    if (open && !isInitialized) {
      void loadSettings();
    }
  }, [isInitialized, loadSettings, open]);

  const closeDialog = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const startAreaSelection = useCallback(async () => {
    try {
      await invoke('show_capture_overlay', {
        captureType: toOverlayCaptureType(activeMode),
        sourceMode: 'area',
      });
    } catch (error) {
      captureLogger.error('Failed to start area capture from experimental modal:', error);
    }
  }, [activeMode]);

  const reuseAreaSelection = useCallback(async (selection: AreaSelectionBounds) => {
    try {
      if (activeMode === 'screenshot') {
        const result = await invoke<{ file_path: string; width: number; height: number }>(
          'capture_screen_region_fast',
          { selection }
        );

        await invoke('open_editor_fast', {
          filePath: result.file_path,
          width: result.width,
          height: result.height,
        });
        return;
      }

      await invoke('show_capture_overlay', {
        captureType: toOverlayCaptureType(activeMode),
        sourceMode: 'area',
        preselectArea: selection,
      });
    } catch (error) {
      captureLogger.error('Failed to reuse area selection from experimental modal:', error);
    }
  }, [activeMode]);

  const handleCaptureSourceChange = useCallback((source: CaptureSource) => {
    setSourceMode(source);

    if (source === 'area') {
      void startAreaSelection();
    }
  }, [setSourceMode, startAreaSelection]);

  const handleSelectLastArea = useCallback(() => {
    if (lastAreaSelection) {
      void reuseAreaSelection(lastAreaSelection);
    }
  }, [lastAreaSelection, reuseAreaSelection]);

  const handleSelectSavedArea = useCallback((selection: SavedAreaSelection) => {
    void reuseAreaSelection(selection);
  }, [reuseAreaSelection]);

  const handleOpenSettings = useCallback(() => {
    closeDialog();
    useSettingsStore.getState().openSettingsModal();
  }, [closeDialog]);

  const handleCaptureComplete = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        overlayClassName="top-[46px]"
        className="w-[min(calc(100vw-32px),760px)] max-w-none border-0 bg-transparent p-0 shadow-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Experimental capture toolbar</DialogTitle>
        <DialogDescription className="sr-only">
          Experimental modal version of the MoonSnap capture toolbar.
        </DialogDescription>
        <div className="pointer-events-auto">
          <CaptureToolbar
            mode="selection"
            captureType={activeMode}
            captureSource="area"
            width={0}
            height={0}
            selectionConfirmed={false}
            onCapture={() => {}}
            onCaptureTypeChange={setActiveMode}
            onCaptureSourceChange={handleCaptureSourceChange}
            onSelectLastArea={handleSelectLastArea}
            onSelectSavedArea={handleSelectSavedArea}
            onDeleteSavedArea={deleteAreaSelection}
            onCaptureComplete={handleCaptureComplete}
            onRedo={() => {}}
            onCancel={closeDialog}
            onOpenSettings={handleOpenSettings}
            onCloseToolbar={closeDialog}
            lastAreaSelection={lastAreaSelection}
            savedAreaSelections={savedAreaSelections}
            minimalChrome="floating"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
