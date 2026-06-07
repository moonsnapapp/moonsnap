/**
 * AudioControlsPanel - System/mic audio volume and mute controls.
 */
import { Slider } from '../../../components/ui/slider';
import type { VideoProject, AudioTrackSettings } from '../../../types';

export interface AudioControlsPanelProps {
  project: VideoProject;
  onUpdateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
}

const AUDIO_ICON_PATHS = {
  microphone: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
  system: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  volume: 'M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z',
};

function AudioIcon({ icon }: { icon: keyof typeof AUDIO_ICON_PATHS }) {
  return (
    <svg className="w-3.5 h-3.5 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={AUDIO_ICON_PATHS[icon]} />
    </svg>
  );
}

function formatVolumeLabel(volume: number, muted: boolean) {
  return muted ? 'Muted' : `${Math.round(volume * 100)}%`;
}

function MuteToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        enabled
          ? 'bg-[var(--accent-400)]'
          : 'bg-[var(--polar-frost)]'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
        enabled ? 'translate-x-5' : ''
      }`} />
    </button>
  );
}

function AudioVolumeRow({
  icon,
  label,
  volume,
  muted,
  onChange,
}: {
  icon: keyof typeof AUDIO_ICON_PATHS;
  label: string;
  volume: number;
  muted: boolean;
  onChange: (volume: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <AudioIcon icon={icon} />
          <span className="min-w-0 truncate text-xs text-[var(--ink-muted)]">{label}</span>
        </div>
        <span className="shrink-0 font-mono text-xs text-[var(--ink-dark)]">
          {formatVolumeLabel(volume, muted)}
        </span>
      </div>
      <Slider
        value={[volume * 100]}
        onValueChange={(values) => onChange(values[0] / 100)}
        min={0}
        max={100}
        step={1}
      />
    </div>
  );
}

function hasSystemAudioSource(systemAudio: string | null) {
  return Boolean(systemAudio);
}

function getSystemAudioLabel(systemAudio: string | null) {
  return hasSystemAudioSource(systemAudio) ? 'System Audio' : 'Volume';
}

function getSystemAudioIcon(systemAudio: string | null): keyof typeof AUDIO_ICON_PATHS {
  return hasSystemAudioSource(systemAudio) ? 'system' : 'volume';
}

export function AudioControlsPanel({ project, onUpdateAudioConfig }: AudioControlsPanelProps) {
  const allMuted = project.audio.systemMuted && project.audio.microphoneMuted;

  return (
    <div className="min-w-0 space-y-3">
      {/* Mute All Audio */}
      <div className="flex min-w-0 items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Mute Audio</span>
        <MuteToggle
          enabled={allMuted}
          onToggle={() => {
            onUpdateAudioConfig({
              systemMuted: !allMuted,
              microphoneMuted: !allMuted
            });
          }}
        />
      </div>

      {/* Microphone Volume - only show when separate mic audio exists */}
      {project.sources.microphoneAudio && (
        <AudioVolumeRow
          icon="microphone"
          label="Microphone"
          volume={project.audio.microphoneVolume}
          muted={project.audio.microphoneMuted}
          onChange={(microphoneVolume) => onUpdateAudioConfig({
            microphoneVolume,
            microphoneMuted: false
          })}
        />
      )}

      {/* System Audio / Volume - label changes based on whether separate audio exists */}
      <AudioVolumeRow
        icon={getSystemAudioIcon(project.sources.systemAudio)}
        label={getSystemAudioLabel(project.sources.systemAudio)}
        volume={project.audio.systemVolume}
        muted={project.audio.systemMuted}
        onChange={(systemVolume) => onUpdateAudioConfig({
            systemVolume,
            systemMuted: false
          })}
      />
    </div>
  );
}
