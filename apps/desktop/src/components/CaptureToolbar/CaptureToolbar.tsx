/**
 * CaptureToolbar - Redesigned minimal capture toolbar
 *
 * Layout: Horizontal toolbar with glassmorphism styling
 * [X] | [Display] [Window] [Area] | [Camera ▾] [Mic ▾] [System Audio] | [⚙️]
 * 
 * During recording: Shows timer + controls instead of settings
 */

import React, { useCallback } from 'react';
import { X, Minus, Square, Pause, Circle, Mic, Volume2, FolderOpen } from 'lucide-react';
import type { CaptureType, RecordingFormat } from '../../types';
import { ModeSelector } from './ModeSelector';
import { SourceSelector, type CaptureSource } from './SourceSelector';
import { DimensionSelect } from './DimensionSelect';
import { SourceInfoDisplay } from './SourceInfoDisplay';
import { DevicePopover } from './DevicePopover';
import { MicrophonePopover } from './MicrophonePopover';
import { SystemAudioPopover } from './SystemAudioPopover';
import { SettingsPopover } from './SettingsPopover';
import { AudioLevelMeter } from './AudioLevelMeter';
import { UpdateAvailablePill } from '@/components/Updates/UpdateAvailablePill';
import {
  useCaptureSettingsStore,
  type AreaSelectionBounds,
  type SavedAreaSelection,
} from '@/stores/captureSettingsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRustAudioLevels } from '@/hooks/useRustAudioLevels';
import { useUpdater } from '@/hooks/useUpdater';

export type ToolbarMode = 'selection' | 'starting' | 'recording' | 'paused' | 'processing' | 'error';

export interface RecordingAudioConfig {
  microphoneDeviceIndex: number | null;
  systemAudioEnabled: boolean;
}

interface CaptureToolbarProps {
  /** Toolbar mode */
  mode: ToolbarMode;
  /** Current capture type */
  captureType: CaptureType;
  /** Current capture source */
  captureSource?: CaptureSource;
  /** Region dimensions */
  width: number;
  height: number;
  /** Source type: 'area', 'window', or 'display' */
  sourceType?: 'area' | 'window' | 'display';
  /** Window/app title if sourceType is 'window' */
  sourceTitle?: string | null;
  /** Monitor name if sourceType is 'display' */
  monitorName?: string | null;
  /** Monitor index if sourceType is 'display' */
  monitorIndex?: number | null;
  /** Whether a selection has been confirmed (shows record button) */
  selectionConfirmed?: boolean;
  /** Start recording or take screenshot (based on captureType) */
  onCapture: () => void;
  /** Change capture type */
  onCaptureTypeChange: (type: CaptureType) => void;
  /** Change capture source (for Area selection) */
  onCaptureSourceChange?: (source: CaptureSource) => void;
  /** Reuse the last area selection */
  onSelectLastArea?: () => void;
  /** Reuse a saved area selection */
  onSelectSavedArea?: (selection: SavedAreaSelection) => void;
  /** Delete a saved area selection */
  onDeleteSavedArea?: (id: string) => void;
  /** Called when a capture is completed from Display/Window pickers */
  onCaptureComplete?: () => void;
  /** Redo/redraw the region */
  onRedo: () => void;
  /** Cancel and close */
  onCancel: () => void;
  // Recording mode props
  /** Recording format (mp4/gif/webm) */
  format?: RecordingFormat;
  /** Elapsed recording time in seconds */
  elapsedTime?: number;
  /** GIF encoding progress (0-1) */
  progress?: number;
  /** Error message */
  errorMessage?: string;
  /** Pause recording */
  onPause?: () => void;
  /** Resume recording */
  onResume?: () => void;
  /** Stop recording */
  onStop?: () => void;
  /** Countdown seconds remaining (during starting mode) */
  countdownSeconds?: number;
  /** Callback when user changes dimensions via input */
  onDimensionChange?: (width: number, height: number) => void;
  /** Save the current area selection for reuse */
  onSaveAreaSelection?: () => void;
  /** Current last-used area selection */
  lastAreaSelection?: AreaSelectionBounds | null;
  /** Named reusable area selections */
  savedAreaSelections?: SavedAreaSelection[];
  /** Whether the current area already exists in saved presets */
  isCurrentAreaSaved?: boolean;
  /** Whether saving is blocked because the saved-area limit was reached */
  isAreaSaveDisabled?: boolean;
  /** Open settings modal */
  onOpenSettings?: () => void;
  /** Open capture library */
  onOpenLibrary?: () => void;
  /** Optional owner label for overlay events from picker panels */
  toolbarOwner?: string;
  /** Minimize the toolbar window */
  onMinimizeToolbar?: () => void;
  /** Close the toolbar window */
  onCloseToolbar?: () => void;
  /** Alternate chrome for recording-only surfaces */
  minimalChrome?: 'window' | 'floating';
  /** Show live audio indicators in the recording HUD */
  showRecordingAudioIndicators?: boolean;
  /** Explicit recording audio config for separate HUD windows */
  recordingAudioConfig?: RecordingAudioConfig;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

interface RecordingToolbarProps {
  mode: ToolbarMode;
  minimalChrome: CaptureToolbarProps['minimalChrome'];
  isRecording: boolean;
  isStarting: boolean;
  isProcessing: boolean;
  isError: boolean;
  isPaused: boolean;
  isGif: boolean;
  format: RecordingFormat;
  elapsedTime: number;
  countdownSeconds?: number;
  errorMessage?: string;
  onPauseResume: () => void;
  onStop?: () => void;
  onCancel: () => void;
  shouldShowRecordingAudioIndicators: boolean;
  isMicEnabled: boolean;
  micActive: boolean;
  micLevel: number;
  isSystemAudioEnabled: boolean;
  systemActive: boolean;
  systemLevel: number;
}

function RecordingToolbar({
  minimalChrome,
  isRecording,
  isStarting,
  isProcessing,
  isError,
  isPaused,
  isGif,
  format,
  elapsedTime,
  countdownSeconds,
  errorMessage,
  onPauseResume,
  onStop,
  onCancel,
  shouldShowRecordingAudioIndicators,
  isMicEnabled,
  micActive,
  micLevel,
  isSystemAudioEnabled,
  systemActive,
  systemLevel,
}: RecordingToolbarProps) {
  return (
    <div
      className={`glass-toolbar glass-toolbar--minimal ${
        minimalChrome === 'floating' ? 'glass-toolbar--minimal-floating' : ''
      } pointer-events-auto`}
    >
      {isRecording && (
        <div className="glass-recording-section">
          <div className={`glass-recording-dot ${isPaused ? 'glass-recording-dot--paused' : ''}`} />
          <span className="glass-text glass-text--mono text-sm font-medium">
            {formatTime(elapsedTime)}
          </span>
          <div className={`glass-badge glass-recording-format-badge uppercase select-none ${
            isGif ? 'glass-badge--purple' : 'glass-badge--blue'
          }`}>
            {format}
          </div>
        </div>
      )}

      {isStarting && (
        <div className="glass-countdown-section">
          {countdownSeconds !== undefined && countdownSeconds > 0 ? (
            <div className="glass-countdown-large select-none">
              {countdownSeconds}
            </div>
          ) : (
            <div className="glass-spinner-large" />
          )}
        </div>
      )}

      {isProcessing && (
        <div className="glass-processing-section">
          <div className="glass-spinner" />
          <span className="glass-text--muted text-xs select-none">
            Saving...
          </span>
        </div>
      )}

      {isError && (
        <div className="glass-error-section">
          <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
          <span className="text-red-400 text-[10px] select-none">
            {errorMessage || 'Failed'}
          </span>
        </div>
      )}

      {shouldShowRecordingAudioIndicators && (
        <>
          <div className="glass-divider-vertical" />
          <div className="glass-recording-audio-section">
            <RecordingAudioIndicator
              enabled={isMicEnabled}
              active={micActive}
              level={micLevel}
              disabledTitle="Microphone disabled"
              activeTitle="Microphone level"
              idleTitle="Microphone idle"
              icon={<Mic size={12} strokeWidth={2} />}
            />
            <RecordingAudioIndicator
              enabled={isSystemAudioEnabled}
              active={systemActive}
              level={systemLevel}
              disabledTitle="System audio disabled"
              activeTitle="System audio level"
              idleTitle="System audio idle"
              icon={<Volume2 size={12} strokeWidth={2} />}
            />
          </div>
        </>
      )}

      <div className="glass-divider-vertical" />

      <div className="glass-controls-section">
        {isRecording && (
          <button
            type="button"
            onClick={onPauseResume}
            className="glass-btn glass-btn--md"
            aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
            title={isPaused ? 'Resume' : 'Pause'}
          >
            {isPaused ? (
              <Circle size={14} className="text-red-400" fill="currentColor" />
            ) : (
              <Pause size={14} className="text-amber-400" fill="currentColor" />
            )}
          </button>
        )}

        {isRecording && (
          <button
            type="button"
            onClick={onStop}
            className="glass-btn glass-btn--md"
            aria-label="Stop and save recording"
            title="Stop and save"
          >
            <Square size={14} className="glass-recording-stop-icon" fill="currentColor" />
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="glass-btn glass-btn--md glass-btn--danger"
          aria-label="Cancel recording"
          title="Cancel"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function RecordingAudioIndicator({
  enabled,
  active,
  level,
  disabledTitle,
  activeTitle,
  idleTitle,
  icon,
}: {
  enabled: boolean;
  active: boolean;
  level: number;
  disabledTitle: string;
  activeTitle: string;
  idleTitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={`glass-recording-audio-indicator ${
        !enabled || !active ? 'glass-recording-audio-indicator--inactive' : ''
      }`}
      title={!enabled ? disabledTitle : active ? activeTitle : idleTitle}
    >
      {icon}
      <AudioLevelMeter
        enabled={enabled}
        level={enabled ? level : 0}
        className="glass-audio-meter--recording"
      />
    </div>
  );
}

function FloatingToolbarHeader({
  onMinimizeToolbar,
  onCloseToolbar,
  onCancel,
}: {
  onMinimizeToolbar?: () => void;
  onCloseToolbar?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="glass-toolbar-top-strip">
      <div className="glass-toolbar-top-strip-spacer" aria-hidden="true" />

      <div className="glass-toolbar-brand" aria-hidden="true">
        <span className="glass-toolbar-brand-wordmark">MoonSnap</span>
      </div>

      <div className="glass-toolbar-window-controls">
        {onMinimizeToolbar && (
          <button
            type="button"
            onClick={onMinimizeToolbar}
            className="glass-btn glass-btn--md glass-toolbar-action-btn glass-toolbar-window-control"
            aria-label="Minimize capture toolbar"
            title="Minimize capture toolbar"
          >
            <Minus size={14} strokeWidth={2.5} />
          </button>
        )}

        <button
          type="button"
          onClick={onCloseToolbar ?? onCancel}
          className="glass-btn glass-btn--md glass-toolbar-action-btn glass-toolbar-action-btn--close glass-toolbar-window-control"
          aria-label="Close capture toolbar"
          title="Close capture toolbar"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function CaptureTargetControl({
  selectionConfirmed,
  sourceType,
  sourceTitle,
  monitorName,
  monitorIndex,
  width,
  height,
  captureType,
  onRedo,
  onDimensionChange,
  onSaveAreaSelection,
  isCurrentAreaSaved,
  isAreaSaveDisabled,
  onSelectLastArea,
  onSelectSavedArea,
  onDeleteSavedArea,
  onCaptureComplete,
  lastAreaSelection,
  savedAreaSelections,
  toolbarOwner,
  disabled,
  onSourceChange,
}: {
  selectionConfirmed: boolean;
  sourceType?: 'area' | 'window' | 'display';
  sourceTitle?: string | null;
  monitorName?: string | null;
  monitorIndex?: number | null;
  width: number;
  height: number;
  captureType: CaptureType;
  onRedo: () => void;
  onDimensionChange?: (width: number, height: number) => void;
  onSaveAreaSelection?: () => void;
  isCurrentAreaSaved: boolean;
  isAreaSaveDisabled: boolean;
  onSelectLastArea?: () => void;
  onSelectSavedArea?: (selection: SavedAreaSelection) => void;
  onDeleteSavedArea?: (id: string) => void;
  onCaptureComplete?: () => void;
  lastAreaSelection?: AreaSelectionBounds | null;
  savedAreaSelections: SavedAreaSelection[];
  toolbarOwner?: string;
  disabled: boolean;
  onSourceChange: (source: CaptureSource) => void;
}) {
  if (selectionConfirmed) {
    if (sourceType === 'window' || sourceType === 'display') {
      return (
        <SourceInfoDisplay
          sourceType={sourceType}
          sourceTitle={sourceTitle}
          monitorName={monitorName}
          monitorIndex={monitorIndex}
          onBack={onRedo}
          disabled={disabled}
        />
      );
    }

    return (
      <DimensionSelect
        width={width}
        height={height}
        onDimensionChange={onDimensionChange}
        onBack={onRedo}
        onSaveArea={onSaveAreaSelection}
        isAreaSaved={isCurrentAreaSaved}
        isAreaSaveDisabled={isAreaSaveDisabled}
        saveAreaTitle="Save this area"
        disabled={disabled}
      />
    );
  }

  return (
    <SourceSelector
      onSelectArea={() => onSourceChange('area')}
      onSelectLastArea={onSelectLastArea}
      onSelectSavedArea={onSelectSavedArea}
      onDeleteSavedArea={onDeleteSavedArea}
      captureType={captureType}
      onCaptureComplete={onCaptureComplete}
      lastAreaSelection={lastAreaSelection}
      savedAreaSelections={savedAreaSelections}
      toolbarOwner={toolbarOwner}
      disabled={disabled}
    />
  );
}

function CaptureDeviceControls({
  isVideoMode,
  isBusy,
  isMicEnabled,
  micLevel,
  isSystemAudioEnabled,
  systemLevel,
}: {
  isVideoMode: boolean;
  isBusy: boolean;
  isMicEnabled: boolean;
  micLevel: number;
  isSystemAudioEnabled: boolean;
  systemLevel: number;
}) {
  return (
    <div className={`glass-devices-section ${!isVideoMode ? 'glass-devices-section--disabled' : ''}`}>
      <div className="glass-device-column">
        <DevicePopover disabled={!isVideoMode || isBusy} />
        <div className="glass-audio-meter--column-spacer" />
      </div>

      <div className="glass-device-column">
        <MicrophonePopover disabled={!isVideoMode || isBusy} />
        <AudioLevelMeter
          enabled
          level={isMicEnabled && isVideoMode ? micLevel : 0}
          className="glass-audio-meter--column"
        />
      </div>

      <div className="glass-device-column">
        <SystemAudioPopover disabled={!isVideoMode || isBusy} />
        <AudioLevelMeter
          enabled
          level={isSystemAudioEnabled && isVideoMode ? systemLevel : 0}
          className="glass-audio-meter--column"
        />
      </div>
    </div>
  );
}

function ToolbarActions({
  onOpenLibrary,
  minimalChrome,
  onMinimizeToolbar,
  onCloseToolbar,
  onCancel,
}: {
  onOpenLibrary?: () => void;
  minimalChrome: CaptureToolbarProps['minimalChrome'];
  onMinimizeToolbar?: () => void;
  onCloseToolbar?: () => void;
  onCancel: () => void;
}) {
  if (!onOpenLibrary && minimalChrome === 'floating') {
    return null;
  }

  return (
    <div className="glass-toolbar-actions">
      {onOpenLibrary && (
        <button
          type="button"
          onClick={onOpenLibrary}
          className="glass-btn glass-btn--md glass-toolbar-action-btn"
          aria-label="Open library"
          title="Open library"
        >
          <FolderOpen size={14} strokeWidth={2.2} />
        </button>
      )}

      {minimalChrome !== 'floating' && onMinimizeToolbar && (
        <button
          type="button"
          onClick={onMinimizeToolbar}
          className="glass-btn glass-btn--md glass-toolbar-action-btn"
          aria-label="Minimize capture toolbar"
          title="Minimize capture toolbar"
        >
          <Minus size={14} strokeWidth={2.5} />
        </button>
      )}

      {minimalChrome !== 'floating' && (
        <button
          type="button"
          onClick={onCloseToolbar ?? onCancel}
          className="glass-btn glass-btn--md glass-toolbar-action-btn glass-toolbar-action-btn--close"
          aria-label="Close capture toolbar"
          title="Close capture toolbar"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

function CaptureActionButton({
  captureType,
  selectionConfirmed,
  onCapture,
}: {
  captureType: CaptureType;
  selectionConfirmed: boolean;
  onCapture: () => void;
}) {
  const label = captureType === 'screenshot' ? 'Take screenshot' : 'Start recording';

  return (
    <button
      type="button"
      onClick={onCapture}
      className="glass-capture-btn-hardware"
      aria-label={label}
      title={label}
      disabled={!selectionConfirmed}
    >
      <Circle size={14} fill="currentColor" strokeWidth={0} />
    </button>
  );
}

function getCaptureToolbarState(
  mode: ToolbarMode,
  captureType: CaptureType,
  format: RecordingFormat
) {
  const isGif = captureType === 'gif' || format === 'gif';
  const isRecording = mode === 'recording' || mode === 'paused';
  const isStarting = mode === 'starting';
  const isProcessing = mode === 'processing';
  const isError = mode === 'error';
  const isBusy = isRecording || isStarting || isProcessing;

  return {
    isGif,
    isRecording,
    isStarting,
    isProcessing,
    isError,
    isPaused: mode === 'paused',
    isVideoMode: captureType === 'video',
    supportsRecordingAudio: captureType === 'video' && !isGif,
    isBusy,
    showsRecordingToolbar: isRecording || isStarting || isProcessing || isError,
  };
}

function getCaptureAudioState({
  recordingAudioConfig,
  settings,
  showRecordingAudioIndicators,
  isRecording,
  supportsRecordingAudio,
}: {
  recordingAudioConfig: CaptureToolbarProps['recordingAudioConfig'];
  settings: ReturnType<typeof useCaptureSettingsStore.getState>['settings'];
  showRecordingAudioIndicators: boolean;
  isRecording: boolean;
  supportsRecordingAudio: boolean;
}) {
  const micDeviceIndex = recordingAudioConfig?.microphoneDeviceIndex ?? settings.video.microphoneDeviceIndex;
  const isMicEnabled = micDeviceIndex !== null;
  const isSystemAudioEnabled = recordingAudioConfig?.systemAudioEnabled ?? settings.video.captureSystemAudio;
  const shouldShowRecordingAudioIndicators = Boolean(
    showRecordingAudioIndicators &&
    isRecording &&
    supportsRecordingAudio
  );

  return {
    micDeviceIndex,
    isMicEnabled,
    isSystemAudioEnabled,
    shouldShowRecordingAudioIndicators,
  };
}

export const CaptureToolbar: React.FC<CaptureToolbarProps> = ({
  mode,
  captureType,
  width,
  height,
  sourceType,
  sourceTitle,
  monitorName,
  monitorIndex,
  selectionConfirmed = false,
  onCapture,
  onCaptureTypeChange,
  onCaptureSourceChange,
  onSelectLastArea,
  onSelectSavedArea,
  onDeleteSavedArea,
  onCaptureComplete,
  onRedo,
  onCancel,
  format = 'mp4',
  elapsedTime = 0,
  errorMessage,
  onPause,
  onResume,
  onStop,
  countdownSeconds,
  onDimensionChange,
  onSaveAreaSelection,
  lastAreaSelection,
  savedAreaSelections = [],
  isCurrentAreaSaved = false,
  isAreaSaveDisabled = false,
  onOpenSettings,
  onOpenLibrary,
  toolbarOwner,
  onMinimizeToolbar,
  onCloseToolbar,
  minimalChrome = 'window',
  showRecordingAudioIndicators = false,
  recordingAudioConfig,
}) => {
  const toolbarState = getCaptureToolbarState(mode, captureType, format);
  const updateChannel = useSettingsStore((s) => s.settings.general.updateChannel);
  useUpdater(true, updateChannel);

  // Get audio settings for level meters
  const { settings } = useCaptureSettingsStore();
  const audioState = getCaptureAudioState({
    recordingAudioConfig,
    settings,
    showRecordingAudioIndicators,
    isRecording: toolbarState.isRecording,
    supportsRecordingAudio: toolbarState.supportsRecordingAudio,
  });

  // Use Rust WASAPI audio monitoring for both mic and system audio
  // This provides accurate levels from the same sources used during recording
  const { micLevel, systemLevel, micActive, systemActive } = useRustAudioLevels({
    micDeviceIndex: audioState.isMicEnabled ? audioState.micDeviceIndex : null,
    monitorSystemAudio: audioState.isSystemAudioEnabled,
    systemAudioScope: settings.video.systemAudioScope,
    enabled: toolbarState.supportsRecordingAudio && (!toolbarState.isBusy || audioState.shouldShowRecordingAudioIndicators),
  });

  // Handle pause/resume toggle
  const handlePauseResume = useCallback(() => {
    if (mode === 'paused') {
      onResume?.();
    } else {
      onPause?.();
    }
  }, [mode, onPause, onResume]);

  // Disable mode changes during recording
  const handleModeChange = useCallback((newMode: CaptureType) => {
    if (!toolbarState.isBusy) {
      onCaptureTypeChange(newMode);
    }
  }, [onCaptureTypeChange, toolbarState.isBusy]);

  // Handle source change
  const handleSourceChange = useCallback((source: CaptureSource) => {
    if (!toolbarState.isBusy) {
      onCaptureSourceChange?.(source);
    }
  }, [onCaptureSourceChange, toolbarState.isBusy]);

  // Render recording UI
  if (toolbarState.showsRecordingToolbar) {
    return (
      <RecordingToolbar
        mode={mode}
        minimalChrome={minimalChrome}
        isRecording={toolbarState.isRecording}
        isStarting={toolbarState.isStarting}
        isProcessing={toolbarState.isProcessing}
        isError={toolbarState.isError}
        isPaused={toolbarState.isPaused}
        isGif={toolbarState.isGif}
        format={format}
        elapsedTime={elapsedTime}
        countdownSeconds={countdownSeconds}
        errorMessage={errorMessage}
        onPauseResume={handlePauseResume}
        onStop={onStop}
        onCancel={onCancel}
        shouldShowRecordingAudioIndicators={audioState.shouldShowRecordingAudioIndicators}
        isMicEnabled={audioState.isMicEnabled}
        micActive={micActive}
        micLevel={micLevel}
        isSystemAudioEnabled={audioState.isSystemAudioEnabled}
        systemActive={systemActive}
        systemLevel={systemLevel}
      />
    );
  }

  // Render selection UI (default state)
  return (
    <div
      className={`glass-toolbar glass-toolbar--two-row ${
        minimalChrome === 'floating' ? 'glass-toolbar--capture-floating' : ''
      } pointer-events-auto`}
    >
      {minimalChrome === 'floating' && (
        <FloatingToolbarHeader
          onMinimizeToolbar={onMinimizeToolbar}
          onCloseToolbar={onCloseToolbar}
          onCancel={onCancel}
        />
      )}

      {/* Row 1: Mode selector (Video/GIF/Screenshot) - full width */}
      <div className="glass-toolbar-row glass-toolbar-row--capture-primary">
        <ModeSelector
          activeMode={captureType}
          onModeChange={handleModeChange}
          disabled={toolbarState.isBusy}
          fullWidth
        />
      </div>

      {/* Row 2: Source selector OR dimensions/info, devices, settings */}
      <div className="glass-toolbar-row glass-toolbar-row--capture-secondary">
        {/* Show source info based on selection type, or source selector if no selection */}
        <CaptureTargetControl
          selectionConfirmed={selectionConfirmed}
          sourceType={sourceType}
          sourceTitle={sourceTitle}
          monitorName={monitorName}
          monitorIndex={monitorIndex}
          width={width}
          height={height}
          captureType={captureType}
          onRedo={onRedo}
          onDimensionChange={onDimensionChange}
          onSaveAreaSelection={onSaveAreaSelection}
          isCurrentAreaSaved={isCurrentAreaSaved}
          isAreaSaveDisabled={isAreaSaveDisabled}
          onSelectLastArea={onSelectLastArea}
          onSelectSavedArea={onSelectSavedArea}
          onDeleteSavedArea={onDeleteSavedArea}
          onCaptureComplete={onCaptureComplete}
          lastAreaSelection={lastAreaSelection}
          savedAreaSelections={savedAreaSelections}
          toolbarOwner={toolbarOwner}
          disabled={toolbarState.isBusy}
          onSourceChange={handleSourceChange}
        />

        {/* Device selectors - always visible, disabled when not in video mode */}
        <div className="glass-divider-vertical" />

        <CaptureDeviceControls
          isVideoMode={toolbarState.isVideoMode}
          isBusy={toolbarState.isBusy}
          isMicEnabled={audioState.isMicEnabled}
          micLevel={micLevel}
          isSystemAudioEnabled={audioState.isSystemAudioEnabled}
          systemLevel={systemLevel}
        />

        <div className="glass-divider-vertical" />

        <SettingsPopover
          mode={captureType}
          disabled={toolbarState.isBusy}
          onOpenSettings={onOpenSettings}
        />

        <UpdateAvailablePill variant="toolbar" />

        <ToolbarActions
          onOpenLibrary={onOpenLibrary}
          minimalChrome={minimalChrome}
          onMinimizeToolbar={onMinimizeToolbar}
          onCloseToolbar={onCloseToolbar}
          onCancel={onCancel}
        />

        <CaptureActionButton
          captureType={captureType}
          selectionConfirmed={selectionConfirmed}
          onCapture={onCapture}
        />
      </div>
    </div>
  );
};
