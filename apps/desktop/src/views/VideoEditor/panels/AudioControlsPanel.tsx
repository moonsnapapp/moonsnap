/**
 * AudioControlsPanel - System/mic audio volume and mute controls.
 */
import { Slider } from '../../../components/ui/slider';
import type { VideoProject, AudioTrackSettings } from '../../../types';

export interface AudioControlsPanelProps {
  project: VideoProject;
  onUpdateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
}

export function AudioControlsPanel({ project, onUpdateAudioConfig }: AudioControlsPanelProps) {
  const allMuted = project.audio.systemMuted && project.audio.microphoneMuted;

  return (
    <div className="space-y-3 pt-2 border-t border-[var(--glass-border)]">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
        <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">Audio Controls</span>
      </div>

      {/* Mute All Audio */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Mute Audio</span>
        <button
          onClick={() => {
            onUpdateAudioConfig({
              systemMuted: !allMuted,
              microphoneMuted: !allMuted
            });
          }}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            allMuted
              ? 'bg-[var(--coral-400)]'
              : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            allMuted ? 'translate-x-5' : ''
          }`} />
        </button>
      </div>

      {/* Microphone Volume - only show when separate mic audio exists */}
      {project.sources.microphoneAudio && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-xs text-[var(--ink-muted)]">Microphone</span>
            </div>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {project.audio.microphoneMuted ? 'Muted' : `${Math.round(project.audio.microphoneVolume * 100)}%`}
            </span>
          </div>
          <Slider
            value={[project.audio.microphoneVolume * 100]}
            onValueChange={(values) => onUpdateAudioConfig({
              microphoneVolume: values[0] / 100,
              microphoneMuted: false
            })}
            min={0}
            max={100}
            step={1}
          />
        </div>
      )}

      {/* System Audio / Volume - label changes based on whether separate audio exists */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {project.sources.systemAudio ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
            <span className="text-xs text-[var(--ink-muted)]">
              {project.sources.systemAudio ? 'System Audio' : 'Volume'}
            </span>
          </div>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {project.audio.systemMuted ? 'Muted' : `${Math.round(project.audio.systemVolume * 100)}%`}
          </span>
        </div>
        <Slider
          value={[project.audio.systemVolume * 100]}
          onValueChange={(values) => onUpdateAudioConfig({
            systemVolume: values[0] / 100,
            systemMuted: false
          })}
          min={0}
          max={100}
          step={1}
        />
      </div>
    </div>
  );
}
