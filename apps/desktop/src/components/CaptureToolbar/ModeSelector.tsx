/**
 * ModeSelector - Horizontal toggle group for capture mode selection.
 *
 * A connected toggle group where only one mode can be active.
 * Visual style: horizontal segmented control with glass styling.
 */

import React from 'react';
import { Video, ImagePlay, Camera, Lock } from 'lucide-react';
import type { CaptureType } from '../../types';
import { useLicenseStore } from '../../stores/licenseStore';

interface ModeSelectorProps {
  activeMode: CaptureType;
  onModeChange: (mode: CaptureType) => void;
  disabled?: boolean;
  fullWidth?: boolean;
}

const PRO_MODES: Set<CaptureType> = new Set(['video', 'gif']);

const modes: { id: CaptureType; icon: React.ReactNode; label: string }[] = [
  { id: 'video', icon: <Video size={14} strokeWidth={1.5} />, label: 'Video' },
  { id: 'gif', icon: <ImagePlay size={14} strokeWidth={1.5} />, label: 'GIF' },
  { id: 'screenshot', icon: <Camera size={14} strokeWidth={1.5} />, label: 'Photo' },
];

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  activeMode,
  onModeChange,
  disabled = false,
  fullWidth = false,
}) => {
  const isPro = useLicenseStore((s) => s.isPro());

  return (
    <div className={`glass-mode-group ${fullWidth ? 'glass-mode-group--full' : ''} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {modes.map((mode) => {
        const needsPro = !isPro && PRO_MODES.has(mode.id);
        return (
          <button
            key={mode.id}
            onClick={() => onModeChange(mode.id)}
            className={`glass-mode-btn ${activeMode === mode.id ? 'glass-mode-btn--active' : ''}`}
            title={needsPro ? `${mode.label} (Pro)` : mode.label}
            disabled={disabled}
          >
            <span className="glass-mode-icon">{mode.icon}</span>
            <span className="glass-mode-label">{mode.label}</span>
            {needsPro && <Lock size={10} className="ml-0.5 opacity-50" />}
          </button>
        );
      })}
    </div>
  );
};
