import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors, type Monitor } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { CaptureToolbar } from './CaptureToolbar';
import type { CaptureSource } from './SourceSelector';
import {
  isSameAreaSelection,
  normalizeAreaSelection,
  useCaptureSettingsStore,
  type AreaSelectionBounds,
  type SavedAreaSelection,
} from '@/stores/captureSettingsStore';
import { useRecordingEvents } from '@/hooks/useRecordingEvents';
import { useSelectionEvents, type SelectionBounds } from '@/hooks/useSelectionEvents';
import { useWebcamCoordination } from '@/hooks/useWebcamCoordination';
import { captureLogger, toolbarLogger } from '@/utils/logger';
import type { CaptureType } from '@/types';
import { getSelectionMonitor, getSnappedRecordingHudAnchor } from '@/windows/recordingHudAnchor';
import { startRecordingCaptureFlow } from '@/windows/recordingStartFlow';

interface ExperimentalCaptureToolbarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface OverlaySelectionResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

type RecordingCaptureType = Extract<CaptureType, 'video' | 'gif'>;

const TOOLBAR_OWNER = 'library';
const MIN_REUSABLE_AREA_SIZE = 20;

function toOverlayCaptureType(captureType: CaptureType): string {
  return captureType === 'gif' ? 'gif' : captureType === 'screenshot' ? 'screenshot' : 'video';
}

function getCurrentAreaSelection(selection: SelectionBounds): AreaSelectionBounds | null {
  if (selection.sourceType !== 'area') {
    return null;
  }

  return normalizeAreaSelection({
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  });
}

function hasReusableAreaDimensions(width: number, height: number): boolean {
  return width >= MIN_REUSABLE_AREA_SIZE && height >= MIN_REUSABLE_AREA_SIZE;
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getReusableAreaSize(
  selection: AreaSelectionBounds,
  monitor: Monitor
): Pick<AreaSelectionBounds, 'width' | 'height'> | null {
  if (!hasReusableAreaDimensions(monitor.size.width, monitor.size.height)) {
    return null;
  }

  const width = Math.min(selection.width, monitor.size.width);
  const height = Math.min(selection.height, monitor.size.height);
  if (!hasReusableAreaDimensions(width, height)) {
    return null;
  }

  return { width, height };
}

function clampAreaSelectionToVisibleMonitor(
  selection: AreaSelectionBounds,
  monitors: Monitor[]
): AreaSelectionBounds | null {
  const normalizedSelection = normalizeAreaSelection(selection);
  if (!normalizedSelection) return null;

  return monitors.length === 0
    ? normalizedSelection
    : clampNormalizedAreaSelectionToMonitors(normalizedSelection, monitors);
}

function clampNormalizedAreaSelectionToMonitors(
  selection: AreaSelectionBounds,
  monitors: Monitor[]
): AreaSelectionBounds | null {
  const monitor = getBestMonitorForArea(selection, monitors);
  if (!monitor) return null;

  const size = getReusableAreaSize(selection, monitor);
  if (!size) return null;

  const { width, height } = size;
  return {
    x: clampToRange(selection.x, monitor.position.x, monitor.position.x + monitor.size.width - width),
    y: clampToRange(selection.y, monitor.position.y, monitor.position.y + monitor.size.height - height),
    width,
    height,
  };
}

function getBestMonitorForArea(selection: AreaSelectionBounds, monitors: Monitor[]) {
  return monitors
    .map((monitor) => ({
      monitor,
      intersectionArea: getMonitorIntersectionArea(selection, monitor),
      distance: getSquaredDistanceToMonitor(selection, monitor),
    }))
    .sort((left, right) =>
      right.intersectionArea - left.intersectionArea || left.distance - right.distance
    )[0]?.monitor;
}

function getMonitorIntersectionArea(selection: AreaSelectionBounds, monitor: Monitor) {
  const left = Math.max(selection.x, monitor.position.x);
  const top = Math.max(selection.y, monitor.position.y);
  const right = Math.min(selection.x + selection.width, monitor.position.x + monitor.size.width);
  const bottom = Math.min(selection.y + selection.height, monitor.position.y + monitor.size.height);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function getSquaredDistanceToMonitor(selection: AreaSelectionBounds, monitor: Monitor) {
  const selectionCenterX = selection.x + selection.width / 2;
  const selectionCenterY = selection.y + selection.height / 2;
  const monitorCenterX = monitor.position.x + monitor.size.width / 2;
  const monitorCenterY = monitor.position.y + monitor.size.height / 2;
  const dx = selectionCenterX - monitorCenterX;
  const dy = selectionCenterY - monitorCenterY;

  return dx * dx + dy * dy;
}

async function captureOverlayResult(result: OverlaySelectionResult) {
  const capture = await invoke<{ file_path: string; width: number; height: number }>(
    'capture_screen_region_fast',
    {
      selection: {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      },
    }
  );

  await invoke('open_editor_fast', {
    filePath: capture.file_path,
    width: capture.width,
    height: capture.height,
  });
}

async function getRecordingHudAnchor(selection: SelectionBounds) {
  const monitors = await availableMonitors().catch(() => []);
  const selectionMonitor =
    monitors.length > 0
      ? getSelectionMonitor(monitors, selection) ?? monitors[0]
      : undefined;

  return getSnappedRecordingHudAnchor(selection, selectionMonitor);
}

async function startExperimentalRecordingCapture({
  activeMode,
  selection,
  recordingStartupInProgressRef,
  recordingInitiatedRef,
  setMode,
}: {
  activeMode: RecordingCaptureType;
  selection: SelectionBounds;
  recordingStartupInProgressRef: MutableRefObject<boolean>;
  recordingInitiatedRef: MutableRefObject<boolean>;
  setMode: (mode: 'selection' | 'starting') => void;
}) {
  if (recordingStartupInProgressRef.current) {
    return;
  }

  recordingStartupInProgressRef.current = true;
  recordingInitiatedRef.current = true;
  setMode('starting');

  const hudAnchor = await getRecordingHudAnchor(selection);
  await startRecordingCaptureFlow({
    captureType: activeMode,
    selection,
    hudAnchor: {
      ...hudAnchor,
      centerOnSelection: true,
    },
  });
}

async function showReusableAreaOverlay({
  activeMode,
  reusableSelection,
}: {
  activeMode: CaptureType;
  reusableSelection: AreaSelectionBounds;
}) {
  return invoke<OverlaySelectionResult | null>('show_capture_overlay', {
    captureType: toOverlayCaptureType(activeMode),
    sourceMode: 'area',
    preselectArea: reusableSelection,
    toolbarOwner: TOOLBAR_OWNER,
  });
}

async function captureReusableScreenshotIfNeeded(
  activeMode: CaptureType,
  result: OverlaySelectionResult | null
) {
  if (activeMode === 'screenshot' && result) {
    await captureOverlayResult(result);
  }
}

async function handleConfirmedCapture({
  activeMode,
  selection,
  recordingStartupInProgressRef,
  recordingInitiatedRef,
  setMode,
}: {
  activeMode: CaptureType;
  selection: SelectionBounds;
  recordingStartupInProgressRef: MutableRefObject<boolean>;
  recordingInitiatedRef: MutableRefObject<boolean>;
  setMode: (mode: 'selection' | 'starting') => void;
}) {
  if (activeMode === 'screenshot') {
    await invoke('capture_overlay_confirm', { action: 'screenshot' });
    return;
  }

  await startExperimentalRecordingCapture({
    activeMode,
    selection,
    recordingStartupInProgressRef,
    recordingInitiatedRef,
    setMode,
  });
}

export function ExperimentalCaptureToolbarDialog({
  open,
  onOpenChange,
}: ExperimentalCaptureToolbarDialogProps) {
  const closeWindowOnCompleteRef = useRef(false);
  const recordingStartupInProgressRef = useRef(false);
  const {
    activeMode,
    sourceMode,
    isInitialized,
    lastAreaSelection,
    savedAreaSelections,
    loadSettings,
    setActiveMode,
    setSourceMode,
    setLastAreaSelection,
    saveAreaSelection,
    deleteAreaSelection,
  } = useCaptureSettingsStore();
  const { closeWebcamPreview, openWebcamPreviewIfEnabled } = useWebcamCoordination();
  const {
    mode,
    setMode,
    format,
    elapsedTime,
    progress,
    errorMessage,
    countdownSeconds,
    recordingInitiatedRef,
  } = useRecordingEvents({ closeWindowOnCompleteRef });
  const {
    selectionBounds,
    selectionBoundsRef,
    selectionConfirmed,
    clearSelectionAutoStartRecording,
  } = useSelectionEvents();

  const currentAreaSelection = useMemo(
    () => (selectionConfirmed ? getCurrentAreaSelection(selectionBounds) : null),
    [selectionBounds, selectionConfirmed]
  );
  const isCurrentAreaSaved = useMemo(
    () =>
      currentAreaSelection !== null &&
      savedAreaSelections.some((savedArea) => isSameAreaSelection(savedArea, currentAreaSelection)),
    [currentAreaSelection, savedAreaSelections]
  );
  const isAreaSaveDisabled = false;

  useEffect(() => {
    if (open && !isInitialized) {
      void loadSettings();
    }
  }, [isInitialized, loadSettings, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const unlisten = listen('capture-settings-changed', () => {
      void loadSettings();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [loadSettings, open]);

  useEffect(() => {
    if (!open || !currentAreaSelection) {
      return;
    }

    setLastAreaSelection(currentAreaSelection);
  }, [currentAreaSelection, open, setLastAreaSelection]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (activeMode === 'video') {
      openWebcamPreviewIfEnabled();
    } else {
      closeWebcamPreview();
    }
  }, [activeMode, closeWebcamPreview, open, openWebcamPreviewIfEnabled]);

  const closeDialog = useCallback(async () => {
    await closeWebcamPreview();
    await invoke('capture_overlay_cancel').catch(() => {});
    await getCurrentWebviewWindow().emit('reset-to-startup', null);
    onOpenChange(false);
  }, [closeWebcamPreview, onOpenChange]);

  const startAreaSelection = useCallback(async () => {
    try {
      const result = await invoke<OverlaySelectionResult | null>('show_capture_overlay', {
        captureType: toOverlayCaptureType(activeMode),
        sourceMode: 'area',
        toolbarOwner: TOOLBAR_OWNER,
      });

      if (activeMode === 'screenshot' && result) {
        await captureOverlayResult(result);
      }
    } catch (error) {
      captureLogger.error('Failed to start area capture from experimental modal:', error);
    }
  }, [activeMode]);

  const reuseAreaSelection = useCallback(async (selection: AreaSelectionBounds) => {
    try {
      const monitors = await availableMonitors().catch(() => []);
      const reusableSelection = clampAreaSelectionToVisibleMonitor(selection, monitors);
      if (!reusableSelection) {
        captureLogger.warn('Skipping reusable area because it no longer fits the current desktop');
        return;
      }

      setLastAreaSelection(reusableSelection);
      const result = await showReusableAreaOverlay({
        activeMode,
        reusableSelection,
      });
      await captureReusableScreenshotIfNeeded(activeMode, result);
    } catch (error) {
      captureLogger.error('Failed to reuse area selection from experimental modal:', error);
    }
  }, [activeMode, setLastAreaSelection]);

  const handleCapture = useCallback(async () => {
    try {
      if (!selectionConfirmed) {
        await startAreaSelection();
        return;
      }

      await handleConfirmedCapture({
        activeMode,
        selection: selectionBoundsRef.current,
        recordingStartupInProgressRef,
        recordingInitiatedRef,
        setMode,
      });
    } catch (error) {
      toolbarLogger.error('Failed to capture from experimental modal:', error);
      recordingStartupInProgressRef.current = false;
      recordingInitiatedRef.current = false;
      clearSelectionAutoStartRecording();
      setMode('selection');
    }
  }, [
    activeMode,
    clearSelectionAutoStartRecording,
    recordingInitiatedRef,
    selectionBoundsRef,
    selectionConfirmed,
    setMode,
    startAreaSelection,
  ]);

  const handleCaptureSourceChange = useCallback((source: CaptureSource) => {
    setSourceMode(source);

    if (source === 'area' && !selectionConfirmed) {
      void startAreaSelection();
    }
  }, [selectionConfirmed, setSourceMode, startAreaSelection]);

  const handleRedo = useCallback(async () => {
    try {
      await invoke('capture_overlay_reselect');
      await getCurrentWebviewWindow().emit('reset-to-startup', null);
    } catch (error) {
      captureLogger.error('Failed to reselect area from experimental modal:', error);
    }
  }, []);

  const handleSaveCurrentArea = useCallback(() => {
    if (!currentAreaSelection) {
      return;
    }

    saveAreaSelection(currentAreaSelection);
  }, [currentAreaSelection, saveAreaSelection]);

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
            mode={mode}
            captureType={activeMode}
            captureSource={sourceMode}
            width={selectionBounds.width}
            height={selectionBounds.height}
            sourceType={selectionBounds.sourceType}
            sourceTitle={selectionBounds.sourceTitle}
            monitorName={selectionBounds.monitorName}
            monitorIndex={selectionBounds.monitorIndex}
            selectionConfirmed={selectionConfirmed}
            onCapture={handleCapture}
            onCaptureTypeChange={setActiveMode}
            onCaptureSourceChange={handleCaptureSourceChange}
            onSelectLastArea={() => {
              if (lastAreaSelection) {
                void reuseAreaSelection(lastAreaSelection);
              }
            }}
            onSelectSavedArea={(selection: SavedAreaSelection) => {
              void reuseAreaSelection(selection);
            }}
            onDeleteSavedArea={deleteAreaSelection}
            onCaptureComplete={() => {}}
            onRedo={handleRedo}
            onCancel={() => {
              void closeDialog();
            }}
            format={format}
            elapsedTime={elapsedTime}
            progress={progress}
            errorMessage={errorMessage}
            countdownSeconds={countdownSeconds}
            onDimensionChange={(width, height) => {
              void invoke('capture_overlay_set_dimensions', { width, height });
            }}
            onSaveAreaSelection={handleSaveCurrentArea}
            lastAreaSelection={lastAreaSelection}
            savedAreaSelections={savedAreaSelections}
            isCurrentAreaSaved={isCurrentAreaSaved}
            isAreaSaveDisabled={isAreaSaveDisabled}
            onOpenSettings={() => {
              void invoke('show_settings_window');
            }}
            onCloseToolbar={() => {
              void closeDialog();
            }}
            minimalChrome="floating"
            toolbarOwner={TOOLBAR_OWNER}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
