/**
 * CaptureToolbarWindow - Unified toolbar for screen capture.
 *
 * Architecture:
 * - Frontend creates window via App.tsx listener
 * - Frontend measures content, calculates position (with multi-monitor support)
 * - Frontend calls Rust to set bounds and show window
 *
 * Hooks handle the complexity:
 * - useToolbarPositioning: Window sizing and multi-monitor placement
 * - useRecordingEvents: Recording state machine
 * - useSelectionEvents: Selection bounds updates
 * - useWebcamCoordination: Webcam preview lifecycle
 */

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { availableMonitors, type Monitor } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { motion, useReducedMotion, type Transition } from 'motion/react';
import { CaptureToolbar, type ToolbarMode } from '../components/CaptureToolbar/CaptureToolbar';
import type { CaptureSource } from '../components/CaptureToolbar/SourceSelector';
import {
  useCaptureSettingsStore,
  type AreaSelectionBounds,
  type CaptureSourceMode,
  type AfterRecordingAction,
  type SavedAreaSelection,
  MAX_SAVED_AREA_SELECTIONS,
  isSameAreaSelection,
  normalizeAreaSelection,
} from '../stores/captureSettingsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useFocusedShortcutDispatch } from '../hooks/useFocusedShortcutDispatch';
import { useTheme } from '../hooks/useTheme';
import { useRecordingEvents } from '../hooks/useRecordingEvents';
import { repositionToolbar, useSelectionEvents, type SelectionBounds } from '../hooks/useSelectionEvents';
import { useWebcamCoordination } from '../hooks/useWebcamCoordination';
import { useToolbarPositioning } from '../hooks/useToolbarPositioning';
import type { CaptureType } from '../types';
import { toolbarLogger } from '../utils/logger';
import {
  isAutoStartRecordingSession,
  shouldSuppressToolbarUntilRecording,
} from './captureToolbarFlow';
import {
  getSelectionMonitor,
  getSnappedRecordingHudAnchor,
  type RecordingHudAnchor,
} from './recordingHudAnchor';
import { startRecordingCaptureFlow } from './recordingStartFlow';

interface StartupToolbarContext {
  captureType?: CaptureType;
  sourceMode?: CaptureSourceMode;
  autoStartAreaSelection?: boolean;
}

interface RecordingModeSelectedPayload {
  x: number;
  y: number;
  action: AfterRecordingAction;
  remember: boolean;
  owner?: string;
}

interface RecordingModeChooserBackPayload {
  x: number;
  y: number;
  owner?: string;
}

interface NativeSelectionHudCapturePayload extends SelectionBounds {
  owner?: string;
}

interface NativeSelectionHudDeleteSavedAreaPayload {
  owner?: string;
  id: string;
}

const RECORDING_CAPTURE_TYPES: CaptureType[] = ['video', 'gif'];
const AUTO_START_CLEAR_MODES: ToolbarMode[] = ['recording', 'paused', 'error'];
const RECORDING_CONTROLS_VISIBLE_MODES: ToolbarMode[] = ['recording', 'paused', 'processing'];
const RECORDING_CONTROLS_ACTIVE_MODES: ToolbarMode[] = [
  'starting',
  'recording',
  'paused',
  'processing',
];
const TOOLBAR_SHELL_INITIAL = {
  opacity: 0,
  transform: 'translateY(6px) scale(0.985)',
};
const TOOLBAR_SHELL_ANIMATE = {
  opacity: 1,
  transform: 'translateY(0px) scale(1)',
};
const TOOLBAR_SHELL_TRANSITION = {
  duration: 0.18,
  ease: [0.23, 1, 0.32, 1],
} satisfies Transition;
const TOOLBAR_SHELL_REDUCED_TRANSITION = {
  duration: 0,
} satisfies Transition;

type CaptureSettingsState = ReturnType<typeof useCaptureSettingsStore.getState>;
type CurrentWebviewWindow = ReturnType<typeof getCurrentWebviewWindow>;

const MIN_REUSABLE_AREA_SIZE = 20;
const STARTUP_RESTORE_STATE_FLUSH_MS = 50;

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

function hasReusableAreaDimensions(width: number, height: number) {
  return width >= MIN_REUSABLE_AREA_SIZE && height >= MIN_REUSABLE_AREA_SIZE;
}

function clampToRange(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function getClampedAreaSelectionToMonitor(
  selection: AreaSelectionBounds,
  monitor: Monitor
): AreaSelectionBounds | null {
  if (!hasReusableAreaDimensions(monitor.size.width, monitor.size.height)) {
    return null;
  }

  const width = Math.min(selection.width, monitor.size.width);
  const height = Math.min(selection.height, monitor.size.height);
  if (!hasReusableAreaDimensions(width, height)) {
    return null;
  }

  return {
    x: clampToRange(selection.x, monitor.position.x, monitor.position.x + monitor.size.width - width),
    y: clampToRange(selection.y, monitor.position.y, monitor.position.y + monitor.size.height - height),
    width,
    height,
  };
}

function clampAreaSelectionToVisibleMonitor(
  selection: AreaSelectionBounds,
  monitors: Monitor[]
): AreaSelectionBounds | null {
  const normalizedSelection = normalizeAreaSelection(selection);
  if (!normalizedSelection) {
    return null;
  }

  if (monitors.length === 0) {
    return normalizedSelection;
  }

  const monitor = getBestMonitorForArea(normalizedSelection, monitors);
  if (!monitor) {
    return null;
  }

  return getClampedAreaSelectionToMonitor(normalizedSelection, monitor);
}

function getOverlayCaptureType(captureType: CaptureType): 'screenshot' | 'gif' | 'video' {
  if (captureType === 'screenshot') return 'screenshot';
  return captureType === 'gif' ? 'gif' : 'video';
}

function isCaptureToolbarOwner(owner: string | undefined): boolean {
  return !owner || owner === 'capture-toolbar';
}

function isRecordingCaptureType(captureType: CaptureType) {
  return RECORDING_CAPTURE_TYPES.includes(captureType);
}

function isPendingSelectionMode(mode: ToolbarMode, selectionConfirmed: boolean) {
  return mode === 'selection' && !selectionConfirmed;
}

function shouldStartAreaSelectionFromContext({
  shouldAutoStart,
  isInitialized,
  mode,
  selectionConfirmed,
  captureSource,
  captureType,
}: {
  shouldAutoStart: boolean;
  isInitialized: boolean;
  mode: ToolbarMode;
  selectionConfirmed: boolean;
  captureSource: CaptureSourceMode;
  captureType: CaptureType;
}) {
  return [
    shouldAutoStart,
    isInitialized,
    isPendingSelectionMode(mode, selectionConfirmed),
    captureSource === 'area',
    isRecordingCaptureType(captureType),
  ].every(Boolean);
}

function getSelectionAutoStartRecording(
  selectionConfirmed: boolean,
  selectionBounds: SelectionBounds
) {
  return selectionConfirmed ? selectionBounds.autoStartRecording : false;
}

function getConfirmedAreaSelection(
  selectionConfirmed: boolean,
  selectionBounds: SelectionBounds
) {
  return selectionConfirmed ? getCurrentAreaSelection(selectionBounds) : null;
}

function isNativeSelectionHudVisible({
  selectionConfirmed,
  selectionBounds,
  mode,
}: {
  selectionConfirmed: boolean;
  selectionBounds: SelectionBounds;
  mode: ToolbarMode;
}) {
  return Boolean(
    selectionConfirmed &&
    selectionBounds.nativeControls &&
    selectionBounds.sourceType === 'area' &&
    mode === 'selection'
  );
}

function isSavedAreaSelection(
  currentAreaSelection: AreaSelectionBounds | null,
  savedAreaSelections: SavedAreaSelection[]
) {
  return Boolean(
    currentAreaSelection &&
    savedAreaSelections.some((savedArea) => isSameAreaSelection(savedArea, currentAreaSelection))
  );
}

function isPrimaryToolbarRecordingMode(mode: ToolbarMode) {
  return mode === 'starting' ||
    mode === 'recording' ||
    mode === 'paused' ||
    mode === 'processing';
}

function hasSuppressionFlag(flags: boolean[]) {
  return flags.some(Boolean);
}

function isPrimaryToolbarSuppressedDuringRecording({
  selectionConfirmed,
  isRecordingHudActive,
  mode,
}: {
  selectionConfirmed: boolean;
  isRecordingHudActive: boolean;
  mode: ToolbarMode;
}) {
  if (!selectionConfirmed) return false;
  return isRecordingHudActive || isPrimaryToolbarRecordingMode(mode);
}

function shouldHideToolbarChrome({
  suppressToolbarUntilRecording,
  isNativeSelectionHudActive,
  isModeChooserVisible,
  isRecordingControlsPending,
  isRecordingHudActive,
}: {
  suppressToolbarUntilRecording: boolean;
  isNativeSelectionHudActive: boolean;
  isModeChooserVisible: boolean;
  isRecordingControlsPending: boolean;
  isRecordingHudActive: boolean;
}) {
  return hasSuppressionFlag([
    suppressToolbarUntilRecording,
    isNativeSelectionHudActive,
    isModeChooserVisible,
    isRecordingControlsPending,
    isRecordingHudActive,
  ]);
}

function shouldSuppressWindowShow({
  suppressToolbarUntilRecording,
  isNativeSelectionHudActive,
  suppressPrimaryToolbarDuringRecording,
  isModeChooserVisible,
  isRecordingControlsPending,
  isRestoringToolbarFromChooser,
}: {
  suppressToolbarUntilRecording: boolean;
  isNativeSelectionHudActive: boolean;
  suppressPrimaryToolbarDuringRecording: boolean;
  isModeChooserVisible: boolean;
  isRecordingControlsPending: boolean;
  isRestoringToolbarFromChooser: boolean;
}) {
  return hasSuppressionFlag([
    suppressToolbarUntilRecording,
    isNativeSelectionHudActive,
    suppressPrimaryToolbarDuringRecording,
    isModeChooserVisible,
    isRecordingControlsPending,
    isRestoringToolbarFromChooser,
  ]);
}

function getToolbarChromeStyle(shouldHidePrimaryToolbarChrome: boolean) {
  return shouldHidePrimaryToolbarChrome
    ? { visibility: 'hidden' as const, pointerEvents: 'none' as const }
    : undefined;
}

function selectionCaptureTypeMatches(
  selectionCaptureType: CaptureType | null | undefined,
  captureType: CaptureType
) {
  return selectionCaptureType == null || selectionCaptureType === captureType;
}

function shouldAutoStartConfirmedRecording({
  autoStartRecording,
  hasTriggered,
  selectionConfirmed,
  mode,
  captureType,
  selectionCaptureType,
}: {
  autoStartRecording: boolean;
  hasTriggered: boolean;
  selectionConfirmed: boolean;
  mode: ToolbarMode;
  captureType: CaptureType;
  selectionCaptureType?: CaptureType | null;
}) {
  return [
    autoStartRecording,
    !hasTriggered,
    canUseConfirmedSelection(selectionConfirmed, mode),
    isRecordingCaptureType(captureType),
    selectionCaptureTypeMatches(selectionCaptureType, captureType),
  ].every(Boolean);
}

function shouldClearSelectionAutoStartRecording(
  autoStartRecording: boolean,
  mode: ToolbarMode,
) {
  return autoStartRecording && AUTO_START_CLEAR_MODES.includes(mode);
}

function shouldShowRecordingControlsForMode(
  selectionConfirmed: boolean,
  mode: ToolbarMode,
) {
  return selectionConfirmed && RECORDING_CONTROLS_VISIBLE_MODES.includes(mode);
}

function shouldCloseRecordingControlsForMode(mode: ToolbarMode) {
  return !RECORDING_CONTROLS_ACTIVE_MODES.includes(mode);
}

function canUseConfirmedSelection(selectionConfirmed: boolean, mode: ToolbarMode) {
  return selectionConfirmed && mode === 'selection';
}

type CaptureRoute = 'unconfirmed' | 'screenshot' | 'modeChooser' | 'recording';

function getCaptureRoute({
  selectionConfirmed,
  captureType,
  skipModePrompt,
  promptRecordingMode,
}: {
  selectionConfirmed: boolean;
  captureType: CaptureType;
  skipModePrompt: boolean;
  promptRecordingMode: boolean;
}): CaptureRoute {
  if (!selectionConfirmed) return 'unconfirmed';
  if (captureType === 'screenshot') return 'screenshot';
  if (shouldOpenRecordingModeChooser(captureType, skipModePrompt, promptRecordingMode)) {
    return 'modeChooser';
  }
  return 'recording';
}

function shouldOpenRecordingModeChooser(
  captureType: CaptureType,
  skipModePrompt: boolean,
  promptRecordingMode: boolean
) {
  return captureType === 'video' && !skipModePrompt && promptRecordingMode;
}

function willReplaceOldestSavedArea(isCurrentAreaSaved: boolean, savedAreaCount: number) {
  return !isCurrentAreaSaved && savedAreaCount >= MAX_SAVED_AREA_SELECTIONS;
}

function getSavedAreaFeedbackMessage(replacedOldest: boolean) {
  return replacedOldest ? 'Replaced Oldest Area' : 'Saved New Area';
}

function showNativeSavedAreaFeedback(replacedOldest: boolean) {
  return invoke('capture_overlay_show_selection_hud_feedback', {
    message: getSavedAreaFeedbackMessage(replacedOldest),
  }).catch((error) => {
    toolbarLogger.warn('Failed to show native saved-area feedback:', error);
  });
}

interface RecordingModeChooserStateControls {
  chooserSelectionHandledRef: React.MutableRefObject<boolean>;
  recordingStartupInProgressRef: React.MutableRefObject<boolean>;
  chooserRestorePositionRef: React.MutableRefObject<RecordingModeChooserBackPayload | null>;
  chooserAnchorPositionRef: React.MutableRefObject<{ x: number; y: number } | null>;
  skipModePromptRef: React.MutableRefObject<boolean>;
  setIsModeChooserVisible: (value: boolean) => void;
  setIsRecordingControlsPending: (value: boolean) => void;
  setIsRecordingHudActive: (value: boolean) => void;
  setIsRestoringToolbarFromChooser: (value: boolean) => void;
}

function resetRecordingModeChooserState({
  chooserSelectionHandledRef,
  recordingStartupInProgressRef,
  chooserRestorePositionRef,
  chooserAnchorPositionRef,
  skipModePromptRef,
  setIsModeChooserVisible,
  setIsRecordingControlsPending,
  setIsRecordingHudActive,
  setIsRestoringToolbarFromChooser,
}: RecordingModeChooserStateControls) {
  chooserSelectionHandledRef.current = false;
  recordingStartupInProgressRef.current = false;
  chooserRestorePositionRef.current = null;
  chooserAnchorPositionRef.current = null;
  skipModePromptRef.current = false;
  setIsModeChooserVisible(false);
  setIsRecordingControlsPending(false);
  setIsRecordingHudActive(false);
  setIsRestoringToolbarFromChooser(false);
}

function handleRecordingModeSelection({
  payload,
  chooserSelectionHandledRef,
  chooserAnchorPositionRef,
  skipModePromptRef,
  handleCaptureRef,
}: {
  payload: RecordingModeSelectedPayload;
  chooserSelectionHandledRef: React.MutableRefObject<boolean>;
  chooserAnchorPositionRef: React.MutableRefObject<{ x: number; y: number } | null>;
  skipModePromptRef: React.MutableRefObject<boolean>;
  handleCaptureRef: React.MutableRefObject<() => void>;
}) {
  if (chooserSelectionHandledRef.current) {
    return;
  }

  chooserSelectionHandledRef.current = true;
  chooserAnchorPositionRef.current = null;
  const store = useCaptureSettingsStore.getState();
  store.setAfterRecordingAction(payload.action);
  if (payload.remember) {
    store.setPromptRecordingMode(false);
  }

  skipModePromptRef.current = true;
  window.setTimeout(() => {
    handleCaptureRef.current();
  }, 50);
}

async function cancelRecordingModeChooserToStartup(
  restoreStartupToolbarWindow: () => Promise<void>
) {
  try {
    await invoke('capture_overlay_cancel_to_startup');
  } catch (error) {
    toolbarLogger.error('Failed to cancel selection from recording mode chooser back:', error);
  }

  await emit('reset-to-startup', null).catch(() => {});
  await restoreStartupToolbarWindow();
}

async function cancelOverlayAndRestoreStartup(
  restoreStartupToolbarWindow: () => Promise<void>
) {
  try {
    await invoke('capture_overlay_cancel_to_startup');
  } catch {
    // Overlay may already be closed.
  }

  await emit('reset-to-startup', null);
  await restoreStartupToolbarWindow();
}

function shouldRestoreStartupFromCancel({
  mode,
  selectionConfirmed,
  areaSelectionFlowActive,
}: {
  mode: ToolbarMode;
  selectionConfirmed: boolean;
  areaSelectionFlowActive: boolean;
}) {
  return mode === 'selection' && (selectionConfirmed || areaSelectionFlowActive);
}

function isStartupEscapeKey(event: KeyboardEvent, mode: ToolbarMode) {
  return event.key === 'Escape' && mode === 'selection' && !event.repeat;
}

function consumeKeyboardEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

async function captureFullscreenToEditor(
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>
) {
  const result = await invoke<{ file_path: string; width: number; height: number }>(
    'capture_fullscreen_fast'
  );
  await invoke('open_editor_fast', {
    filePath: result.file_path,
    width: result.width,
    height: result.height,
  });
  await currentWindow.close();
}

async function startUnconfirmedSourceCapture({
  source,
  captureType,
  currentWindow,
}: {
  source: CaptureSource;
  captureType: CaptureType;
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>;
}) {
  await currentWindow.hide();

  if (source === 'display' && captureType === 'screenshot') {
    await captureFullscreenToEditor(currentWindow);
    return;
  }

  await invoke('show_overlay', { captureType: getOverlayCaptureType(captureType) });
}

async function captureAreaSelectionToEditor({
  selection,
  currentWindow,
}: {
  selection: AreaSelectionBounds;
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>;
}) {
  const result = await invoke<{ file_path: string; width: number; height: number }>(
    'capture_screen_region_fast',
    { selection }
  );
  await invoke('open_editor_fast', {
    filePath: result.file_path,
    width: result.width,
    height: result.height,
  });
  await currentWindow.close();
}

async function showReusableAreaOverlay({
  selection,
  captureType,
}: {
  selection: AreaSelectionBounds;
  captureType: CaptureType;
}) {
  await invoke('show_capture_overlay', {
    captureType: getOverlayCaptureType(captureType),
    sourceMode: 'area',
    preselectArea: selection,
  });
}

function getRecordingControlsSettings(
  captureType: CaptureType,
  settings: CaptureSettingsState['settings'],
): {
  microphoneDeviceIndex: number | null;
  systemAudioEnabled: boolean;
  recordingFormat: 'gif' | 'mp4';
} {
  return {
    microphoneDeviceIndex: captureType === 'video'
      ? settings.video.microphoneDeviceIndex
      : null,
    systemAudioEnabled: captureType === 'video'
      ? settings.video.captureSystemAudio
      : false,
    recordingFormat: captureType === 'gif' ? 'gif' : 'mp4',
  };
}

async function getCurrentWindowHudAnchor(
  currentWindow: CurrentWebviewWindow
): Promise<RecordingHudAnchor> {
  const [position, size] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.outerSize(),
  ]);

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

async function getSelectionHudAnchor(selectionBounds: SelectionBounds) {
  const monitors = await availableMonitors().catch(() => []);
  const selectionMonitor =
    monitors.length > 0
      ? getSelectionMonitor(monitors, selectionBounds) ?? monitors[0]
      : undefined;

  return getSnappedRecordingHudAnchor(selectionBounds, selectionMonitor);
}

async function getRecordingControlsHudAnchor({
  currentWindow,
  snapToolbarToSelection,
  selectionConfirmed,
  selectionBounds,
}: {
  currentWindow: CurrentWebviewWindow;
  snapToolbarToSelection: boolean;
  selectionConfirmed: boolean;
  selectionBounds: SelectionBounds;
}) {
  if (snapToolbarToSelection && selectionConfirmed) {
    return getSelectionHudAnchor(selectionBounds);
  }

  return getCurrentWindowHudAnchor(currentWindow);
}

async function showRecordingControls({
  hudAnchor,
  includeInCapture,
  microphoneDeviceIndex,
  systemAudioEnabled,
  recordingFormat,
}: {
  hudAnchor: RecordingHudAnchor;
  includeInCapture: boolean;
  microphoneDeviceIndex: number | null;
  systemAudioEnabled: boolean;
  recordingFormat: 'gif' | 'mp4';
}) {
  await invoke('show_recording_controls', {
    x: hudAnchor.x,
    y: hudAnchor.y,
    width: hudAnchor.width,
    height: hudAnchor.height,
    includeInCapture,
    microphoneDeviceIndex,
    systemAudioEnabled,
    recordingFormat,
  });
}

const CaptureToolbarWindow: React.FC = () => {
  useTheme();
  useFocusedShortcutDispatch();
  const shouldReduceMotion = useReducedMotion();

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const {
    activeMode: captureType,
    sourceMode: captureSource,
    isInitialized,
    loadSettings,
    setActiveMode: setCaptureType,
    setSourceMode: setCaptureSource,
    promptRecordingMode,
    lastAreaSelection,
    savedAreaSelections,
    setLastAreaSelection,
    saveAreaSelection,
    deleteAreaSelection,
  } = useCaptureSettingsStore();
  useEffect(() => {
    if (!isInitialized) {
      loadSettings();
    }
  }, [isInitialized, loadSettings]);

  useEffect(() => {
    const unlisten = listen('capture-settings-changed', () => {
      void loadSettings();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [loadSettings]);

  useEffect(() => {
    invoke('prewarm_capture').catch((e) => {
      toolbarLogger.warn('Failed to pre-warm capture:', e);
    });
  }, []);

  const { closeWebcamPreview, openWebcamPreviewIfEnabled } = useWebcamCoordination();

  const closeWindowOnCompleteRef = useRef(false);

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

  const [isModeChooserVisible, setIsModeChooserVisible] = useState(false);
  const [isRecordingControlsPending, setIsRecordingControlsPending] = useState(false);
  const [isRecordingHudActive, setIsRecordingHudActive] = useState(false);
  const [isRestoringToolbarFromChooser, setIsRestoringToolbarFromChooser] = useState(false);
  const [isStartupContextReady, setIsStartupContextReady] = useState(false);
  const skipModePromptRef = useRef(false);
  const suppressStartupRestoreRef = useRef(false);
  const handleCaptureRef = useRef<() => void>(() => {});
  const recordingStartupInProgressRef = useRef(false);
  const chooserSelectionHandledRef = useRef(false);
  const chooserRestorePositionRef = useRef<RecordingModeChooserBackPayload | null>(null);
  const chooserAnchorPositionRef = useRef<{ x: number; y: number } | null>(null);

  const pendingStartupContextRef = useRef<StartupToolbarContext | null>(null);
  const shouldAutoStartAreaSelectionRef = useRef(false);
  const autoStartRecordingTriggeredRef = useRef(false);
  const areaSelectionFlowActiveRef = useRef(false);

  const {
    selectionBounds,
    selectionBoundsRef,
    selectionConfirmed,
    autoStartRecording,
    clearSelectionAutoStartRecording,
    resetSelectionToStartup,
  } = useSelectionEvents();

  const currentAreaSelection = useMemo(
    () => getConfirmedAreaSelection(selectionConfirmed, selectionBounds),
    [selectionBounds, selectionConfirmed]
  );
  const isNativeSelectionHudActive = isNativeSelectionHudVisible({
    selectionConfirmed,
    selectionBounds,
    mode,
  });
  const isCurrentAreaSaved = useMemo(
    () => isSavedAreaSelection(currentAreaSelection, savedAreaSelections),
    [currentAreaSelection, savedAreaSelections]
  );
  const isAreaSaveDisabled = false;

  // Keep lastAreaSelection in sync when dimensions change after confirmation
  // (e.g., preset selection, manual dimension input)
  useEffect(() => {
    if (currentAreaSelection) {
      setLastAreaSelection(currentAreaSelection);
    }
  }, [currentAreaSelection, setLastAreaSelection]);

  useEffect(() => {
    invoke('capture_toolbar_ready').catch((e) => {
      toolbarLogger.warn('Failed to notify capture toolbar readiness:', e);
    });
  }, []);

  const showToolbarInRecording = useCaptureSettingsStore(
    (s) => s.showToolbarInRecording
  );
  const snapToolbarToSelection = useCaptureSettingsStore(
    (s) => s.snapToolbarToSelection
  );

  useEffect(() => {
    invoke('set_toolbar_recording_visibility', {
      show: showToolbarInRecording,
    }).catch((e) => {
      toolbarLogger.warn('Failed to set toolbar recording visibility:', e);
    });
  }, [showToolbarInRecording]);

  const suppressToolbarUntilRecording = shouldSuppressToolbarUntilRecording({
    autoStartRecording,
    selectionAutoStartRecording: getSelectionAutoStartRecording(
      selectionConfirmed,
      selectionBounds
    ),
    mode,
  });

  const suppressPrimaryToolbarDuringRecording = isPrimaryToolbarSuppressedDuringRecording({
    selectionConfirmed,
    isRecordingHudActive,
    mode,
  });

  const shouldHidePrimaryToolbarChrome = shouldHideToolbarChrome({
    suppressToolbarUntilRecording,
    isNativeSelectionHudActive,
    isModeChooserVisible,
    isRecordingControlsPending,
    isRecordingHudActive,
  });

  const bringStartupToolbarToFront = useCallback(async () => {
    try {
      await invoke('bring_startup_toolbar_to_front', { focus: true });
    } catch (error) {
      toolbarLogger.warn('Failed to bring startup toolbar to front:', error);

      const currentWindow = getCurrentWebviewWindow();
      await currentWindow.show().catch((showError) => {
        toolbarLogger.warn('Failed to show startup toolbar fallback:', showError);
      });
      await currentWindow.setFocus().catch(() => {});
    }
  }, []);

  // The Rust foreground dance (bring_startup_toolbar_to_front) reveals the
  // window regardless of size, so it must wait until the toolbar has measured
  // and resized itself to fit its content. Otherwise it flashes the fallback
  // bounds and clips the toolbar (most visible in dev mode). We defer the
  // front-bring until `useToolbarPositioning` reports the first content-derived
  // size, with a safety timeout so a missed measurement can't trap it hidden.
  const hasSizedToContentRef = useRef(false);
  const pendingFrontBringRef = useRef(false);

  const handleContentSized = useCallback(() => {
    hasSizedToContentRef.current = true;
    if (pendingFrontBringRef.current) {
      pendingFrontBringRef.current = false;
      void bringStartupToolbarToFront();
    }
  }, [bringStartupToolbarToFront]);

  const requestStartupFrontBring = useCallback(() => {
    if (hasSizedToContentRef.current) {
      void bringStartupToolbarToFront();
      return;
    }
    pendingFrontBringRef.current = true;
    // Safety net: reveal even if a content measurement never arrives.
    window.setTimeout(() => {
      if (!pendingFrontBringRef.current) return;
      pendingFrontBringRef.current = false;
      void bringStartupToolbarToFront();
    }, 600);
  }, [bringStartupToolbarToFront]);

  useToolbarPositioning({
    containerRef,
    contentRef,
    selectionConfirmed,
    mode,
    windowReadyToShow: Boolean(selectionConfirmed || isStartupContextReady),
    suppressWindowShow: shouldSuppressWindowShow({
      suppressToolbarUntilRecording,
      isNativeSelectionHudActive,
      suppressPrimaryToolbarDuringRecording,
      isModeChooserVisible,
      isRecordingControlsPending,
      isRestoringToolbarFromChooser,
    }),
    onContentSized: handleContentSized,
  });

  useEffect(() => {
    if (captureType === 'video') {
      openWebcamPreviewIfEnabled();
    } else {
      closeWebcamPreview();
    }
  }, [captureType, openWebcamPreviewIfEnabled, closeWebcamPreview]);

  useEffect(() => {
    if (!autoStartRecording) {
      autoStartRecordingTriggeredRef.current = false;
    }
  }, [autoStartRecording]);

  useEffect(() => {
    closeWindowOnCompleteRef.current = isAutoStartRecordingSession(
      getSelectionAutoStartRecording(selectionConfirmed, selectionBounds)
    );
  }, [selectionBounds, selectionConfirmed]);

  useEffect(() => {
    const handleBlur = () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  const escHandledRef = useRef(false);

  const suppressStartupEscapeBriefly = useCallback(() => {
    escHandledRef.current = true;
    window.setTimeout(() => {
      escHandledRef.current = false;
    }, 500);
  }, []);


  const restoreStartupToolbarWindow = useCallback(async () => {
    suppressStartupEscapeBriefly();

    areaSelectionFlowActiveRef.current = false;
    chooserSelectionHandledRef.current = false;
    recordingStartupInProgressRef.current = false;
    chooserRestorePositionRef.current = null;
    chooserAnchorPositionRef.current = null;
    skipModePromptRef.current = false;
    recordingInitiatedRef.current = false;
    closeWindowOnCompleteRef.current = false;

    setIsModeChooserVisible(false);
    setIsRecordingControlsPending(false);
    setIsRecordingHudActive(false);
    setIsRestoringToolbarFromChooser(false);
    setIsStartupContextReady(true);
    setMode('selection');
    resetSelectionToStartup();
    clearSelectionAutoStartRecording();
    await new Promise((resolve) => window.setTimeout(resolve, STARTUP_RESTORE_STATE_FLUSH_MS));
    await bringStartupToolbarToFront();
  }, [
    bringStartupToolbarToFront,
    clearSelectionAutoStartRecording,
    recordingInitiatedRef,
    resetSelectionToStartup,
    setMode,
    suppressStartupEscapeBriefly,
  ]);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!isStartupEscapeKey(e, mode)) {
        return;
      }

      consumeKeyboardEvent(e);

      if (escHandledRef.current) return;

      await closeWebcamPreview();

      if (!shouldRestoreStartupFromCancel({
        mode,
        selectionConfirmed,
        areaSelectionFlowActive: areaSelectionFlowActiveRef.current,
      })) {
        return;
      }

      escHandledRef.current = true;
      await cancelOverlayAndRestoreStartup(restoreStartupToolbarWindow);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectionConfirmed, closeWebcamPreview, restoreStartupToolbarWindow]);

  const showRecordingControlsWindow = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    const {
      showToolbarInRecording: showToolbarInCapture,
      settings,
    } = useCaptureSettingsStore.getState();
    const hudAnchor = await getRecordingControlsHudAnchor({
      currentWindow,
      snapToolbarToSelection,
      selectionConfirmed,
      selectionBounds: selectionBoundsRef.current,
    });
    await showRecordingControls({
      hudAnchor,
      includeInCapture: showToolbarInCapture,
      ...getRecordingControlsSettings(captureType, settings),
    });
    await currentWindow.hide();
  }, [captureType, selectionBoundsRef, selectionConfirmed, snapToolbarToSelection]);

  const startUnconfirmedCaptureFlow = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    areaSelectionFlowActiveRef.current = captureSource === 'area';
    await currentWindow.hide();

    if (captureSource === 'display' && captureType === 'screenshot') {
      await captureFullscreenToEditor(currentWindow);
      return;
    }

    await invoke('show_overlay', { captureType: getOverlayCaptureType(captureType) });
  }, [captureSource, captureType]);

  const showRecordingModeChooser = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    chooserSelectionHandledRef.current = false;

    if (snapToolbarToSelection) {
      try {
        await repositionToolbar(selectionBoundsRef.current);
      } catch (error) {
        toolbarLogger.warn('Failed to reposition toolbar before showing recording mode chooser:', error);
      }
    }

    const position = await currentWindow.outerPosition();
    const selection = selectionBoundsRef.current;
    chooserAnchorPositionRef.current = {
      x: position.x,
      y: position.y,
    };

    setIsModeChooserVisible(true);
    await currentWindow.hide().catch(() => {});

    try {
      await invoke('show_recording_mode_chooser', {
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
        owner: 'capture-toolbar',
        allowDrag: selection.sourceType === 'area',
      });
    } catch (error) {
      setIsModeChooserVisible(false);
      await currentWindow.show().catch(() => {});
      throw error;
    }
  }, [selectionBoundsRef, snapToolbarToSelection]);

  const getRecordingHudAnchor = useCallback(async (
    currentWindow: ReturnType<typeof getCurrentWebviewWindow>
  ): Promise<RecordingHudAnchor> => {
    const [position, size] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
    ]);

    if (!snapToolbarToSelection) {
      return {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      };
    }

    const monitors = await availableMonitors().catch(() => []);
    const selectionMonitor =
      monitors.length > 0
        ? getSelectionMonitor(monitors, selectionBoundsRef.current) ?? monitors[0]
        : undefined;

    return getSnappedRecordingHudAnchor(selectionBoundsRef.current, selectionMonitor);
  }, [selectionBoundsRef, snapToolbarToSelection]);

  const startConfirmedRecordingFlow = useCallback(async () => {
    if (captureType === 'screenshot') {
      return;
    }

    if (recordingStartupInProgressRef.current) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    recordingStartupInProgressRef.current = true;
    setIsModeChooserVisible(false);
    setIsRecordingHudActive(true);
    setIsRecordingControlsPending(true);

    recordingInitiatedRef.current = true;
    const hudAnchor = await getRecordingHudAnchor(currentWindow);

    await startRecordingCaptureFlow({
      captureType,
      selection: selectionBoundsRef.current,
      hudAnchor,
      onBeforeOverlayConfirm: async () => {
        await currentWindow.hide().catch(() => {});
      },
    });

    setIsRecordingControlsPending(false);
  }, [captureType, getRecordingHudAnchor, recordingInitiatedRef, selectionBoundsRef]);

  const resetFailedCaptureState = useCallback(() => {
    areaSelectionFlowActiveRef.current = false;
    recordingInitiatedRef.current = false;
    recordingStartupInProgressRef.current = false;
    chooserSelectionHandledRef.current = false;
    chooserRestorePositionRef.current = null;
    chooserAnchorPositionRef.current = null;
    skipModePromptRef.current = false;
    setIsModeChooserVisible(false);
    setIsRecordingControlsPending(false);
    setIsRecordingHudActive(false);
    setIsRestoringToolbarFromChooser(false);
    invoke('close_recording_controls').catch(() => {});
    clearSelectionAutoStartRecording();
    setMode('selection');
  }, [clearSelectionAutoStartRecording, recordingInitiatedRef, setMode]);

  const handleCapture = useCallback(async () => {
    try {
      const route = getCaptureRoute({
        selectionConfirmed,
        captureType,
        skipModePrompt: skipModePromptRef.current,
        promptRecordingMode,
      });
      const routeActions: Record<CaptureRoute, () => Promise<void>> = {
        unconfirmed: startUnconfirmedCaptureFlow,
        screenshot: () => invoke('capture_overlay_confirm', { action: 'screenshot' }),
        modeChooser: showRecordingModeChooser,
        recording: startConfirmedRecordingFlow,
      };

      await routeActions[route]();
    } catch (e) {
      toolbarLogger.error('Failed to capture:', e);
      resetFailedCaptureState();
    }
  }, [
    captureType,
    promptRecordingMode,
    resetFailedCaptureState,
    selectionConfirmed,
    showRecordingModeChooser,
    startConfirmedRecordingFlow,
    startUnconfirmedCaptureFlow,
  ]);

  useEffect(() => {
    handleCaptureRef.current = () => {
      void handleCapture();
    };
  }, [handleCapture]);

  useEffect(() => {
    const unlisten = listen<NativeSelectionHudCapturePayload>(
      'native-selection-hud-capture',
      (event) => {
        if (!isCaptureToolbarOwner(event.payload.owner)) {
          return;
        }

        window.setTimeout(() => {
          handleCaptureRef.current();
        }, 30);
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Wrapper for the trivial "invoke one command, log on failure" handlers.
  // Keeps the simple recording/window commands consistent; multi-step handlers
  // (redo, cancel, capture) keep their own bespoke logic below.
  const runToolbarCommand = useCallback(
    async (command: string, failureMessage: string, args?: Record<string, unknown>): Promise<void> => {
      try {
        await invoke(command, args);
      } catch (e) {
        toolbarLogger.error(failureMessage, e);
      }
    },
    []
  );

  const handleRedo = useCallback(async () => {
    try {
      await cancelOverlayAndRestoreStartup(restoreStartupToolbarWindow);
    } catch (e) {
      toolbarLogger.error('Failed to go back:', e);
    }
  }, [restoreStartupToolbarWindow]);

  const handleCancel = useCallback(async () => {
    try {
      await closeWebcamPreview();

      if (mode !== 'selection') {
        await invoke('cancel_recording');
      } else if (shouldRestoreStartupFromCancel({
        mode,
        selectionConfirmed,
        areaSelectionFlowActive: areaSelectionFlowActiveRef.current,
      })) {
        await cancelOverlayAndRestoreStartup(restoreStartupToolbarWindow);
      } else {
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.close();
      }
    } catch (e) {
      toolbarLogger.error('Failed to cancel:', e);
    }
  }, [mode, selectionConfirmed, closeWebcamPreview, restoreStartupToolbarWindow]);

  const handlePause = useCallback(
    () => runToolbarCommand('pause_recording', 'Failed to pause:'),
    [runToolbarCommand]
  );

  const handleResume = useCallback(
    () => runToolbarCommand('resume_recording', 'Failed to resume:'),
    [runToolbarCommand]
  );

  const handleStop = useCallback(
    () => runToolbarCommand('stop_recording', 'Failed to stop:'),
    [runToolbarCommand]
  );

  const handleDimensionChange = useCallback(
    (width: number, height: number) =>
      runToolbarCommand('capture_overlay_set_dimensions', 'Failed to set dimensions:', { width, height }),
    [runToolbarCommand]
  );

  const handleCaptureSourceChange = useCallback(async (source: CaptureSource) => {
    setCaptureSource(source);

    if (!selectionConfirmed) {
      const currentWindow = getCurrentWebviewWindow();

      try {
        areaSelectionFlowActiveRef.current = source === 'area';
        await startUnconfirmedSourceCapture({ source, captureType, currentWindow });
      } catch (e) {
        toolbarLogger.error('Failed to trigger capture:', e);
        areaSelectionFlowActiveRef.current = false;
        await currentWindow.show();
      }
    }
  }, [selectionConfirmed, captureType, setCaptureSource]);

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
  }, [captureType, setLastAreaSelection]);

  const handleSelectLastArea = useCallback(() => {
    if (!lastAreaSelection) {
      return;
    }

    void reuseAreaSelection(lastAreaSelection);
  }, [lastAreaSelection, reuseAreaSelection]);

  const handleSelectSavedArea = useCallback((selection: SavedAreaSelection) => {
    void reuseAreaSelection(selection);
  }, [reuseAreaSelection]);

  const handleDeleteSavedArea = useCallback((id: string) => {
    deleteAreaSelection(id);
  }, [deleteAreaSelection]);

  const handleSaveCurrentArea = useCallback(() => {
    if (!currentAreaSelection) {
      return;
    }

    const replacedOldest = willReplaceOldestSavedArea(
      isCurrentAreaSaved,
      savedAreaSelections.length
    );
    const savedArea = saveAreaSelection(currentAreaSelection);
    if (!savedArea) {
      return;
    }

    if (isNativeSelectionHudActive) {
      void showNativeSavedAreaFeedback(replacedOldest);
    }
  }, [
    currentAreaSelection,
    isCurrentAreaSaved,
    isNativeSelectionHudActive,
    saveAreaSelection,
    savedAreaSelections.length,
  ]);

  useEffect(() => {
    if (!isNativeSelectionHudActive) {
      return;
    }

    void invoke('capture_overlay_set_saved_areas', {
      lastArea: lastAreaSelection,
      savedAreas: savedAreaSelections,
      canSaveCurrent: Boolean(currentAreaSelection),
    }).catch((error) => {
      toolbarLogger.warn('Failed to sync native saved-area menu state:', error);
    });
  }, [
    currentAreaSelection,
    isNativeSelectionHudActive,
    lastAreaSelection,
    savedAreaSelections,
  ]);

  useEffect(() => {
    const unlisten = listen<NativeSelectionHudCapturePayload>(
      'native-selection-hud-save-area',
      (event) => {
        if (!isCaptureToolbarOwner(event.payload.owner)) {
          return;
        }

        handleSaveCurrentArea();
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [handleSaveCurrentArea]);

  useEffect(() => {
    const unlistenConfirm = listen('confirm-selection', () => {
      areaSelectionFlowActiveRef.current = false;
    });

    const unlistenReset = listen('reset-to-startup', () => {
      areaSelectionFlowActiveRef.current = false;
    });

    return () => {
      unlistenConfirm.then((fn) => fn()).catch(() => {});
      unlistenReset.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<NativeSelectionHudDeleteSavedAreaPayload>(
      'native-selection-hud-delete-saved-area',
      (event) => {
        if (!isCaptureToolbarOwner(event.payload.owner)) {
          return;
        }

        deleteAreaSelection(event.payload.id);
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [deleteAreaSelection]);

  useEffect(() => {
    const unlisten = listen('capture-overlay-cancelled-to-startup', () => {
      if (suppressStartupRestoreRef.current) {
        return;
      }

      void restoreStartupToolbarWindow();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [restoreStartupToolbarWindow]);

  useEffect(() => {
    const unlisten = listen('capture-overlay-reselecting', () => {
      resetRecordingModeChooserState({
        chooserSelectionHandledRef,
        recordingStartupInProgressRef,
        chooserRestorePositionRef,
        chooserAnchorPositionRef,
        skipModePromptRef,
        setIsModeChooserVisible,
        setIsRecordingControlsPending,
        setIsRecordingHudActive,
        setIsRestoringToolbarFromChooser,
      });
      recordingInitiatedRef.current = false;
      closeWindowOnCompleteRef.current = false;

      setIsStartupContextReady(false);
      setMode('selection');
      resetSelectionToStartup();
      clearSelectionAutoStartRecording();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [
    clearSelectionAutoStartRecording,
    recordingInitiatedRef,
    resetSelectionToStartup,
    setMode,
  ]);

  const handleOpenSettings = useCallback(() => {
    useSettingsStore.getState().openSettingsModal();
  }, []);

  const handleCaptureComplete = useCallback(async () => {
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.close();
  }, []);

  const handleModeChange = useCallback((newMode: typeof captureType) => {
    if (mode === 'selection') {
      setCaptureType(newMode);
    }
  }, [mode, setCaptureType]);

  const applyStartupToolbarContext = useCallback((context: StartupToolbarContext) => {
    areaSelectionFlowActiveRef.current = false;
    setMode('selection');
    resetSelectionToStartup();
    setIsModeChooserVisible(false);
    setIsRecordingControlsPending(false);
    setIsRecordingHudActive(false);
    setIsRestoringToolbarFromChooser(false);

    if (context.captureType) {
      setCaptureType(context.captureType);
    }

    if (context.sourceMode) {
      setCaptureSource(context.sourceMode);
    }

    shouldAutoStartAreaSelectionRef.current = Boolean(
      context.autoStartAreaSelection && context.sourceMode === 'area'
    );
  }, [resetSelectionToStartup, setCaptureSource, setCaptureType, setMode]);

  const bringStartupToolbarToFrontAfterContext = useCallback(
    (context: StartupToolbarContext) => {
      if (context.autoStartAreaSelection) {
        return;
      }

      // Wait for the toolbar to size itself to content before revealing it,
      // instead of a fixed delay that races slow (dev-mode) layout.
      requestStartupFrontBring();
    },
    [requestStartupFrontBring]
  );

  useEffect(() => {
    const unlisten = listen<StartupToolbarContext>('startup-toolbar-context', (event) => {
      setIsStartupContextReady(true);

      if (!isInitialized) {
        pendingStartupContextRef.current = event.payload;
        return;
      }

      applyStartupToolbarContext(event.payload);
      bringStartupToolbarToFrontAfterContext(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [applyStartupToolbarContext, bringStartupToolbarToFrontAfterContext, isInitialized]);

  useEffect(() => {
    if (!isInitialized || !pendingStartupContextRef.current) {
      return;
    }

    setIsStartupContextReady(true);
    applyStartupToolbarContext(pendingStartupContextRef.current);
    bringStartupToolbarToFrontAfterContext(pendingStartupContextRef.current);
    pendingStartupContextRef.current = null;
  }, [applyStartupToolbarContext, bringStartupToolbarToFrontAfterContext, isInitialized]);

  useEffect(() => {
    if (!shouldStartAreaSelectionFromContext({
      shouldAutoStart: shouldAutoStartAreaSelectionRef.current,
      isInitialized,
      mode,
      selectionConfirmed,
      captureSource,
      captureType,
    })) {
      return;
    }

    shouldAutoStartAreaSelectionRef.current = false;
    void handleCaptureSourceChange('area');
  }, [
    captureSource,
    captureType,
    handleCaptureSourceChange,
    isInitialized,
    mode,
    selectionConfirmed,
  ]);

  useEffect(() => {
    const unlistenSelected = listen<RecordingModeSelectedPayload>('recording-mode-selected', (event) => {
      if (!isCaptureToolbarOwner(event.payload.owner)) {
        return;
      }

      handleRecordingModeSelection({
        payload: event.payload,
        chooserSelectionHandledRef,
        chooserAnchorPositionRef,
        skipModePromptRef,
        handleCaptureRef,
      });
    });

    const unlistenBack = listen<RecordingModeChooserBackPayload>('recording-mode-chooser-back', (event) => {
      if (!isCaptureToolbarOwner(event.payload.owner)) {
        return;
      }

      resetRecordingModeChooserState({
        chooserSelectionHandledRef,
        recordingStartupInProgressRef,
        chooserRestorePositionRef,
        chooserAnchorPositionRef,
        skipModePromptRef,
        setIsModeChooserVisible,
        setIsRecordingControlsPending,
        setIsRecordingHudActive,
        setIsRestoringToolbarFromChooser,
      });
      clearSelectionAutoStartRecording();
      void cancelRecordingModeChooserToStartup(restoreStartupToolbarWindow);
    });

    return () => {
      unlistenSelected.then((fn) => fn()).catch(() => {});
      unlistenBack.then((fn) => fn()).catch(() => {});
    };
  }, [clearSelectionAutoStartRecording, restoreStartupToolbarWindow]);

  useEffect(() => {
    if (!shouldAutoStartConfirmedRecording({
      autoStartRecording,
      hasTriggered: autoStartRecordingTriggeredRef.current,
      selectionConfirmed,
      mode,
      captureType,
      selectionCaptureType: selectionBounds.captureType,
    })) {
      return;
    }

    autoStartRecordingTriggeredRef.current = true;
    void handleCapture();
  }, [
    autoStartRecording,
    captureType,
    handleCapture,
    mode,
    selectionBounds.captureType,
    selectionConfirmed,
  ]);

  useEffect(() => {
    if (shouldClearSelectionAutoStartRecording(autoStartRecording, mode)) {
      clearSelectionAutoStartRecording();
    }
  }, [autoStartRecording, clearSelectionAutoStartRecording, mode]);

  useEffect(() => {
    if (mode === 'selection') {
      chooserSelectionHandledRef.current = false;
      recordingStartupInProgressRef.current = false;
      chooserAnchorPositionRef.current = null;
      skipModePromptRef.current = false;
      setIsRecordingControlsPending(false);
      setIsRecordingHudActive(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!isRestoringToolbarFromChooser) {
      return;
    }

    const restorePosition = chooserRestorePositionRef.current;
    chooserRestorePositionRef.current = null;

    if (!restorePosition) {
      setIsRestoringToolbarFromChooser(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await invoke('set_capture_toolbar_position', {
          x: restorePosition.x,
          y: restorePosition.y,
        });
      } catch (error) {
        toolbarLogger.warn('Failed to restore capture toolbar position from mode chooser:', error);
      }

      if (cancelled) {
        return;
      }

      setIsRestoringToolbarFromChooser(false);

      window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        invoke('bring_capture_toolbar_to_front', { focus: true }).catch((error) => {
          toolbarLogger.error('Failed to restore capture toolbar after mode chooser:', error);
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [isRestoringToolbarFromChooser]);

  useEffect(() => {
    if (!shouldShowRecordingControlsForMode(selectionConfirmed, mode)) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        await showRecordingControlsWindow();
      } catch (e) {
        toolbarLogger.error('Failed to swap to recording controls window:', e);
      }
    }, 80);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [mode, selectionConfirmed, showRecordingControlsWindow]);

  useEffect(() => {
    if (!shouldCloseRecordingControlsForMode(mode)) {
      return;
    }

    invoke('close_recording_controls').catch((e) => {
      toolbarLogger.error('Failed to close recording controls window after recording:', e);
    });
  }, [mode]);

  const handleOpenLibrary = useCallback(
    () => runToolbarCommand('show_library_window', 'Failed to open library:'),
    [runToolbarCommand]
  );

  const handleCloseToolbar = useCallback(async () => {
    suppressStartupRestoreRef.current = true;
    try {
      await invoke('capture_overlay_cancel');
    } catch {
      // Overlay may not be running.
    }

    await closeWebcamPreview();
    await getCurrentWebviewWindow().close();
  }, [closeWebcamPreview]);

  const handleMinimizeToolbar = useCallback(async () => {
    try {
      await getCurrentWebviewWindow().minimize();
    } catch (e) {
      toolbarLogger.error('Failed to minimize capture toolbar:', e);
    }
  }, []);

  const handleToolbarMouseDown = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button, input, textarea, select, [role="button"], [data-no-window-drag], [contenteditable="true"]'
      )
    ) {
      return;
    }

    try {
      await getCurrentWebviewWindow().startDragging();
    } catch {
      // Dragging is best-effort only.
    }
  }, []);

  return (
    <div ref={containerRef} className="app-container">
      <div
        aria-hidden={shouldHidePrimaryToolbarChrome}
        style={getToolbarChromeStyle(shouldHidePrimaryToolbarChrome)}
      >
        <div className="toolbar-container">
          <motion.div
            className="toolbar-animated-wrapper capture-toolbar-shell"
            initial={shouldReduceMotion ? false : TOOLBAR_SHELL_INITIAL}
            animate={
              shouldHidePrimaryToolbarChrome && !shouldReduceMotion
                ? TOOLBAR_SHELL_INITIAL
                : TOOLBAR_SHELL_ANIMATE
            }
            transition={
              shouldReduceMotion
                ? TOOLBAR_SHELL_REDUCED_TRANSITION
                : TOOLBAR_SHELL_TRANSITION
            }
            onMouseDown={handleToolbarMouseDown}
          >
            <div ref={contentRef} className="toolbar-content-measure">
              <CaptureToolbar
                mode={mode}
                captureType={captureType}
                captureSource={captureSource}
                width={selectionBounds.width}
                height={selectionBounds.height}
                sourceType={selectionBounds.sourceType}
                sourceTitle={selectionBounds.sourceTitle}
                monitorName={selectionBounds.monitorName}
                monitorIndex={selectionBounds.monitorIndex}
                selectionConfirmed={selectionConfirmed}
                onCapture={handleCapture}
                onCaptureTypeChange={handleModeChange}
                onCaptureSourceChange={handleCaptureSourceChange}
                onSelectLastArea={handleSelectLastArea}
                onSelectSavedArea={handleSelectSavedArea}
                onDeleteSavedArea={handleDeleteSavedArea}
                onCaptureComplete={handleCaptureComplete}
                onRedo={handleRedo}
                onCancel={handleCancel}
                format={format}
                elapsedTime={elapsedTime}
                progress={progress}
                errorMessage={errorMessage}
                onPause={handlePause}
                onResume={handleResume}
                onStop={handleStop}
                countdownSeconds={countdownSeconds}
                onDimensionChange={handleDimensionChange}
                onSaveAreaSelection={handleSaveCurrentArea}
                lastAreaSelection={lastAreaSelection}
                savedAreaSelections={savedAreaSelections}
                isCurrentAreaSaved={isCurrentAreaSaved}
                isAreaSaveDisabled={isAreaSaveDisabled}
                onOpenSettings={handleOpenSettings}
                onOpenLibrary={handleOpenLibrary}
                onMinimizeToolbar={handleMinimizeToolbar}
                onCloseToolbar={handleCloseToolbar}
                minimalChrome="floating"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default CaptureToolbarWindow;
