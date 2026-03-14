/**
 * CaptureToolbar - Redesigned minimal capture toolbar
 *
 * Layout: Horizontal toolbar with glassmorphism styling
 * [X] | [Display] [Window] [Area] | [Camera ▾] [Mic ▾] [System Audio] | [⚙️]
 * 
 * During recording: Shows timer + controls instead of settings
 */

import React, { useCallback } from 'react';
import { X, Square, Pause, Circle, Mic, Volume2, FolderOpen } from 'lucide-react';
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
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { useRustAudioLevels } from '@/hooks/useRustAudioLevels';

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
  /** Open settings modal */
  onOpenSettings?: () => void;
  /** Open capture library */
  onOpenLibrary?: () => void;
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
  onOpenSettings,
  onOpenLibrary,
  onCloseToolbar,
  minimalChrome = 'window',
  showRecordingAudioIndicators = false,
  recordingAudioConfig,
}) => {
  const isGif = captureType === 'gif' || format === 'gif';
  const isRecording = mode === 'recording' || mode === 'paused';
  const isStarting = mode === 'starting';
  const isProcessing = mode === 'processing';
  const isError = mode === 'error';
  const isPaused = mode === 'paused';
  const isVideoMode = captureType === 'video'; // Selection UI: only video supports webcam/audio
  const supportsRecordingAudio = isVideoMode && !isGif;
  const isBusy = isRecording || isStarting || isProcessing; // Disable controls during capture

  // Get audio settings for level meters
  const { settings } = useCaptureSettingsStore();
  const micDeviceIndex = recordingAudioConfig?.microphoneDeviceIndex ?? settings.video.microphoneDeviceIndex;
  const isMicEnabled = micDeviceIndex !== null;
  const isSystemAudioEnabled = recordingAudioConfig?.systemAudioEnabled ?? settings.video.captureSystemAudio;

  const shouldShowRecordingAudioIndicators = Boolean(
    showRecordingAudioIndicators &&
    isRecording &&
    supportsRecordingAudio
  );

  // Use Rust WASAPI audio monitoring for both mic and system audio
  // This provides accurate levels from the same sources used during recording
  const { micLevel, systemLevel, micActive, systemActive } = useRustAudioLevels({
    micDeviceIndex: isMicEnabled ? micDeviceIndex : null,
    monitorSystemAudio: isSystemAudioEnabled,
    enabled: supportsRecordingAudio && (!isBusy || shouldShowRecordingAudioIndicators),
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
    if (!isBusy) {
      onCaptureTypeChange(newMode);
    }
  }, [isBusy, onCaptureTypeChange]);

  // Handle source change
  const handleSourceChange = useCallback((source: CaptureSource) => {
    if (!isBusy) {
      onCaptureSourceChange?.(source);
    }
  }, [isBusy, onCaptureSourceChange]);

  // Render recording UI
  if (isRecording || isStarting || isProcessing || isError) {
    return (
      <div
        className={`glass-toolbar glass-toolbar--minimal ${
          minimalChrome === 'floating' ? 'glass-toolbar--minimal-floating' : ''
        } pointer-events-auto`}
      >
        {/* Recording status */}
        {isRecording && (
          <div className="glass-recording-section">
            <div className={`glass-recording-dot ${isPaused ? 'glass-recording-dot--paused' : ''}`} />
            <span className="glass-text glass-text--mono text-sm font-medium">
              {formatTime(elapsedTime)}
            </span>
            <div className={`glass-badge px-2 py-0.5 text-[9px] uppercase tracking-wider select-none ${
              isGif ? 'glass-badge--purple' : 'glass-badge--blue'
            }`}>
              {format}
            </div>
          </div>
        )}

        {/* Countdown */}
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

        {/* Processing */}
        {isProcessing && (
          <div className="glass-processing-section">
            <div className="glass-spinner" />
            <span className="glass-text--muted text-xs select-none">
              Saving...
            </span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="glass-error-section">
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
            <span className="text-red-400 text-[10px] select-none">
              {errorMessage || 'Failed'}
            </span>
          </div>
        )}

        {/* Divider */}
        {shouldShowRecordingAudioIndicators && (
          <>
            <div className="glass-divider-vertical" />
            <div className="glass-recording-audio-section">
              <div
                className={`glass-recording-audio-indicator ${
                  !isMicEnabled || !micActive ? 'glass-recording-audio-indicator--inactive' : ''
                }`}
                title={
                  !isMicEnabled
                    ? 'Microphone disabled'
                    : micActive
                      ? 'Microphone level'
                      : 'Microphone idle'
                }
              >
                <Mic size={12} strokeWidth={2} />
                <AudioLevelMeter
                  enabled={isMicEnabled}
                  level={isMicEnabled ? micLevel : 0}
                  className="glass-audio-meter--recording"
                />
              </div>

              <div
                className={`glass-recording-audio-indicator ${
                  !isSystemAudioEnabled || !systemActive ? 'glass-recording-audio-indicator--inactive' : ''
                }`}
                title={
                  !isSystemAudioEnabled
                    ? 'System audio disabled'
                    : systemActive
                      ? 'System audio level'
                      : 'System audio idle'
                }
              >
                <Volume2 size={12} strokeWidth={2} />
                <AudioLevelMeter
                  enabled={isSystemAudioEnabled}
                  level={isSystemAudioEnabled ? systemLevel : 0}
                  className="glass-audio-meter--recording"
                />
              </div>
            </div>
          </>
        )}

        <div className="glass-divider-vertical" />

        {/* Controls */}
        <div className="glass-controls-section">
          {/* Pause/Resume button */}
          {isRecording && (
            <button
              type="button"
              onClick={handlePauseResume}
              className="glass-btn glass-btn--md"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? (
                <Circle size={14} className="text-red-400" fill="currentColor" />
              ) : (
                <Pause size={14} className="text-amber-400" fill="currentColor" />
              )}
            </button>
          )}

          {/* Stop button */}
          {isRecording && (
            <button
              type="button"
              onClick={onStop}
              className="glass-btn glass-btn--md"
              title="Stop and save"
            >
              <Square size={14} className="glass-recording-stop-icon" fill="currentColor" />
            </button>
          )}

          {/* Cancel button */}
          <button
            type="button"
            onClick={onCancel}
            className="glass-btn glass-btn--md glass-btn--danger"
            title="Cancel"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
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
        <div className="glass-toolbar-brand" aria-hidden="true">
          <span className="glass-toolbar-brand-wordmark">MoonSnap</span>
          <span className="glass-toolbar-brand-badge">PRO</span>
        </div>
      )}

      {/* Row 1: Mode selector (Video/GIF/Screenshot) - full width */}
      <div className="glass-toolbar-row glass-toolbar-row--capture-primary">
        <ModeSelector
          activeMode={captureType}
          onModeChange={handleModeChange}
          disabled={isBusy}
          fullWidth
        />
      </div>

      {/* Row 2: Source selector OR dimensions/info, devices, settings */}
      <div className="glass-toolbar-row glass-toolbar-row--capture-secondary">
        {/* Show source info based on selection type, or source selector if no selection */}
        {selectionConfirmed ? (
          // Selection confirmed - show appropriate info based on source type
          sourceType === 'window' || sourceType === 'display' ? (
            <SourceInfoDisplay
              sourceType={sourceType}
              sourceTitle={sourceTitle}
              monitorName={monitorName}
              monitorIndex={monitorIndex}
              onBack={onRedo}
              disabled={isBusy}
            />
          ) : (
            // Area selection - show dimension selector
            <DimensionSelect
              width={width}
              height={height}
              onDimensionChange={onDimensionChange}
              onBack={onRedo}
              disabled={isBusy}
            />
          )
        ) : (
          // No selection - show source selector
          <SourceSelector
            onSelectArea={() => handleSourceChange('area')}
            captureType={captureType}
            onCaptureComplete={onCaptureComplete}
            disabled={isBusy}
          />
        )}

        {/* Device selectors - always visible, disabled when not in video mode */}
        <div className="glass-divider-vertical" />

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

        <div className="glass-divider-vertical" />

        <SettingsPopover
          mode={captureType}
          disabled={isBusy}
          onOpenSettings={onOpenSettings}
        />

        <div className="glass-toolbar-actions">
          {onOpenLibrary && (
            <button
              type="button"
              onClick={onOpenLibrary}
              className="glass-btn glass-btn--md glass-toolbar-action-btn"
              title="Open library"
            >
              <FolderOpen size={14} strokeWidth={2.2} />
            </button>
          )}

          <button
            type="button"
            onClick={onCloseToolbar ?? onCancel}
            className="glass-btn glass-btn--md glass-toolbar-action-btn glass-toolbar-action-btn--close"
            title="Close capture toolbar"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        <button
          type="button"
          onClick={onCapture}
          className="glass-capture-btn-hardware"
          title={captureType === 'screenshot' ? 'Take screenshot' : 'Start recording'}
          disabled={!selectionConfirmed}
        >
          <Circle size={14} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
};
