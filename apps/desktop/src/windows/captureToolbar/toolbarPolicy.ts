import type { Monitor } from '@tauri-apps/api/window';
import type { Transition } from 'motion/react';
import type { ToolbarMode } from '../../components/CaptureToolbar/CaptureToolbar';
import {
  MAX_SAVED_AREA_SELECTIONS,
  isSameAreaSelection,
  normalizeAreaSelection,
  type AfterRecordingAction,
  type AreaSelectionBounds,
  type CaptureSourceMode,
  type SavedAreaSelection,
} from '../../stores/captureSettingsStore';
import type { SelectionBounds } from '../../hooks/useSelectionEvents';
import type { CaptureType } from '../../types';

export interface StartupToolbarContext {
  captureType?: CaptureType;
  sourceMode?: CaptureSourceMode;
  autoStartAreaSelection?: boolean;
}

export interface RecordingModeSelectedPayload {
  x: number;
  y: number;
  action: AfterRecordingAction;
  remember: boolean;
  owner?: string;
}

export interface RecordingModeChooserBackPayload {
  x: number;
  y: number;
  owner?: string;
}

export interface NativeSelectionHudCapturePayload extends SelectionBounds {
  owner?: string;
}

export interface NativeSelectionHudDeleteSavedAreaPayload {
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
export const TOOLBAR_SHELL_INITIAL = {
  opacity: 0,
  transform: 'translateY(6px) scale(0.985)',
};
export const TOOLBAR_SHELL_ANIMATE = {
  opacity: 1,
  transform: 'translateY(0px) scale(1)',
};
export const TOOLBAR_SHELL_TRANSITION = {
  duration: 0.18,
  ease: [0.23, 1, 0.32, 1],
} satisfies Transition;
export const TOOLBAR_SHELL_REDUCED_TRANSITION = {
  duration: 0,
} satisfies Transition;

const MIN_REUSABLE_AREA_SIZE = 20;
export const STARTUP_RESTORE_STATE_FLUSH_MS = 50;

export function getCurrentAreaSelection(selection: SelectionBounds): AreaSelectionBounds | null {
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

export function hasReusableAreaDimensions(width: number, height: number) {
  return width >= MIN_REUSABLE_AREA_SIZE && height >= MIN_REUSABLE_AREA_SIZE;
}

export function clampToRange(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getMonitorIntersectionArea(selection: AreaSelectionBounds, monitor: Monitor) {
  const left = Math.max(selection.x, monitor.position.x);
  const top = Math.max(selection.y, monitor.position.y);
  const right = Math.min(selection.x + selection.width, monitor.position.x + monitor.size.width);
  const bottom = Math.min(selection.y + selection.height, monitor.position.y + monitor.size.height);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function getSquaredDistanceToMonitor(selection: AreaSelectionBounds, monitor: Monitor) {
  const selectionCenterX = selection.x + selection.width / 2;
  const selectionCenterY = selection.y + selection.height / 2;
  const monitorCenterX = monitor.position.x + monitor.size.width / 2;
  const monitorCenterY = monitor.position.y + monitor.size.height / 2;
  const dx = selectionCenterX - monitorCenterX;
  const dy = selectionCenterY - monitorCenterY;

  return dx * dx + dy * dy;
}

export function getBestMonitorForArea(selection: AreaSelectionBounds, monitors: Monitor[]) {
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

export function getClampedAreaSelectionToMonitor(
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

export function clampAreaSelectionToVisibleMonitor(
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

export function getOverlayCaptureType(captureType: CaptureType): 'screenshot' | 'gif' | 'video' {
  if (captureType === 'screenshot') return 'screenshot';
  return captureType === 'gif' ? 'gif' : 'video';
}

export function isCaptureToolbarOwner(owner: string | undefined): boolean {
  return !owner || owner === 'capture-toolbar';
}

export function isRecordingCaptureType(captureType: CaptureType) {
  return RECORDING_CAPTURE_TYPES.includes(captureType);
}

export function isPendingSelectionMode(mode: ToolbarMode, selectionConfirmed: boolean) {
  return mode === 'selection' && !selectionConfirmed;
}

export function shouldStartAreaSelectionFromContext({
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

export function getSelectionAutoStartRecording(
  selectionConfirmed: boolean,
  selectionBounds: SelectionBounds
) {
  return selectionConfirmed ? selectionBounds.autoStartRecording : false;
}

export function getConfirmedAreaSelection(
  selectionConfirmed: boolean,
  selectionBounds: SelectionBounds
) {
  return selectionConfirmed ? getCurrentAreaSelection(selectionBounds) : null;
}

export function isNativeSelectionHudVisible({
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

export function isSavedAreaSelection(
  currentAreaSelection: AreaSelectionBounds | null,
  savedAreaSelections: SavedAreaSelection[]
) {
  return Boolean(
    currentAreaSelection &&
    savedAreaSelections.some((savedArea) => isSameAreaSelection(savedArea, currentAreaSelection))
  );
}

export function isPrimaryToolbarRecordingMode(mode: ToolbarMode) {
  return mode === 'starting' ||
    mode === 'recording' ||
    mode === 'paused' ||
    mode === 'processing';
}

export function hasSuppressionFlag(flags: boolean[]) {
  return flags.some(Boolean);
}

export function isPrimaryToolbarSuppressedDuringRecording({
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

export function shouldHideToolbarChrome({
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

export function shouldSuppressWindowShow({
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

export function getToolbarChromeStyle(shouldHidePrimaryToolbarChrome: boolean) {
  return shouldHidePrimaryToolbarChrome
    ? { visibility: 'hidden' as const, pointerEvents: 'none' as const }
    : undefined;
}

export function selectionCaptureTypeMatches(
  selectionCaptureType: CaptureType | null | undefined,
  captureType: CaptureType
) {
  return selectionCaptureType == null || selectionCaptureType === captureType;
}

export function shouldAutoStartConfirmedRecording({
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

export function shouldClearSelectionAutoStartRecording(
  autoStartRecording: boolean,
  mode: ToolbarMode,
) {
  return autoStartRecording && AUTO_START_CLEAR_MODES.includes(mode);
}

export function shouldShowRecordingControlsForMode(
  selectionConfirmed: boolean,
  mode: ToolbarMode,
) {
  return selectionConfirmed && RECORDING_CONTROLS_VISIBLE_MODES.includes(mode);
}

export function shouldCloseRecordingControlsForMode(mode: ToolbarMode) {
  return !RECORDING_CONTROLS_ACTIVE_MODES.includes(mode);
}

export function canUseConfirmedSelection(selectionConfirmed: boolean, mode: ToolbarMode) {
  return selectionConfirmed && mode === 'selection';
}

export type CaptureRoute = 'unconfirmed' | 'screenshot' | 'modeChooser' | 'recording';

export function getCaptureRoute({
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

export function shouldOpenRecordingModeChooser(
  captureType: CaptureType,
  skipModePrompt: boolean,
  promptRecordingMode: boolean
) {
  return captureType === 'video' && !skipModePrompt && promptRecordingMode;
}

export function willReplaceOldestSavedArea(isCurrentAreaSaved: boolean, savedAreaCount: number) {
  return !isCurrentAreaSaved && savedAreaCount >= MAX_SAVED_AREA_SELECTIONS;
}

export function getSavedAreaFeedbackMessage(replacedOldest: boolean) {
  return replacedOldest ? 'Replaced Oldest Area' : 'Saved New Area';
}
