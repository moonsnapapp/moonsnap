/**
 * SystemAudioToggle - Toggle button for system audio capture
 * 
 * Simple toggle button showing system audio state.
 */

import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';

interface SystemAudioToggleProps {
  disabled?: boolean;
}

function getSystemAudioButtonClassName(isEnabled: boolean) {
  return [
    'glass-device-btn glass-device-btn--toggle',
    isEnabled ? 'glass-device-btn--active' : null,
  ].filter(Boolean).join(' ');
}

function getSystemAudioTitle(isEnabled: boolean) {
  return isEnabled ? 'System audio enabled' : 'System audio disabled';
}

function getSystemAudioLabel(isEnabled: boolean) {
  return isEnabled ? 'System Audio' : 'System Muted';
}

function SystemAudioIcon({ isEnabled }: { isEnabled: boolean }) {
  const Icon = isEnabled ? Volume2 : VolumeX;
  return <Icon size={14} strokeWidth={1.5} />;
}

export const SystemAudioToggle: React.FC<SystemAudioToggleProps> = ({ disabled = false }) => {
  const { settings, updateVideoSettings } = useCaptureSettingsStore();
  const isEnabled = settings.video.captureSystemAudio;

  const handleToggle = () => {
    updateVideoSettings({ captureSystemAudio: !isEnabled });
  };

  return (
    <button
      onClick={handleToggle}
      className={getSystemAudioButtonClassName(isEnabled)}
      disabled={disabled}
      title={getSystemAudioTitle(isEnabled)}
    >
      <SystemAudioIcon isEnabled={isEnabled} />
      <span className="glass-device-label">
        {getSystemAudioLabel(isEnabled)}
      </span>
    </button>
  );
};
