/**
 * SystemAudioPopover - System audio device selector using native Tauri menu
 *
 * Shows current system audio status, opens native menu with output device list.
 * Mirrors MicrophonePopover pattern.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, ChevronDown } from 'lucide-react';
import { Menu, MenuItem, PredefinedMenuItem, CheckMenuItem } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { useAudioOutputStore } from '@/stores/audioOutputStore';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { audioLogger } from '@/utils/logger';

interface SystemAudioPopoverProps {
  disabled?: boolean;
}

export const SystemAudioPopover: React.FC<SystemAudioPopoverProps> = ({ disabled = false }) => {
  const { devices, loadDevices } = useAudioOutputStore();
  const { settings, updateVideoSettings } = useCaptureSettingsStore();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isEnabled = settings.video.captureSystemAudio;
  const selectedDeviceId = settings.video.systemAudioDeviceId ?? null;

  // Load devices on mount
  useEffect(() => {
    if (devices.length === 0) {
      loadDevices();
    }
  }, [devices.length, loadDevices]);

  const currentDevice = devices.find((d) => d.id === selectedDeviceId);
  // If no device selected, show the default device name or "System Audio"
  const defaultDevice = devices.find((d) => d.isDefault);
  const displayName = isEnabled
    ? currentDevice?.name || defaultDevice?.name || 'System Audio'
    : 'System Muted';

  // Truncate display name for button
  const truncatedName = displayName.length > 12
    ? displayName.substring(0, 12) + '\u2026'
    : displayName;

  const handleSelectDevice = useCallback((deviceId: string | null) => {
    updateVideoSettings({
      captureSystemAudio: true,
      systemAudioDeviceId: deviceId,
    });
  }, [updateVideoSettings]);

  const handleMute = useCallback(() => {
    updateVideoSettings({ captureSystemAudio: false });
  }, [updateVideoSettings]);

  // Open native menu
  const openMenu = useCallback(async () => {
    if (disabled) return;

    // Refresh devices in background (don't block menu)
    loadDevices();

    try {
      // Determine which device ID is effectively selected
      // null means "use default"
      const effectiveId = selectedDeviceId;

      const items = await Promise.all([
        // Header
        MenuItem.new({
          id: 'header',
          text: 'System Audio',
          enabled: false,
        }),
        PredefinedMenuItem.new({ item: 'Separator' }),
        // Mute option
        CheckMenuItem.new({
          id: 'mute',
          text: 'Mute System Audio',
          checked: !isEnabled,
          action: handleMute,
        }),
        PredefinedMenuItem.new({ item: 'Separator' }),
        // Default device option
        CheckMenuItem.new({
          id: 'default',
          text: 'Default Device',
          checked: isEnabled && effectiveId === null,
          action: () => handleSelectDevice(null),
        }),
        PredefinedMenuItem.new({ item: 'Separator' }),
        // Device list
        ...devices.map((device) =>
          CheckMenuItem.new({
            id: `device-${device.id}`,
            text: device.isDefault
              ? `${device.name} \u2605`
              : device.name,
            checked: isEnabled && effectiveId === device.id,
            action: () => handleSelectDevice(device.id),
          })
        ),
        // Refresh option
        PredefinedMenuItem.new({ item: 'Separator' }),
        MenuItem.new({
          id: 'refresh',
          text: 'Refresh Devices',
          action: loadDevices,
        }),
      ]);

      const menu = await Menu.new({ items });

      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        await menu.popup(new LogicalPosition(rect.left, rect.bottom + 4));
      } else {
        await menu.popup();
      }
    } catch (error) {
      audioLogger.error('Failed to open system audio menu:', error);
    }
  }, [disabled, devices, isEnabled, selectedDeviceId, loadDevices, handleSelectDevice, handleMute]);

  return (
    <button
      ref={buttonRef}
      onClick={openMenu}
      className={`glass-device-btn ${isEnabled ? 'glass-device-btn--active' : ''}`}
      disabled={disabled}
    >
      {isEnabled ? (
        <Volume2 size={14} strokeWidth={1.5} />
      ) : (
        <VolumeX size={14} strokeWidth={1.5} />
      )}
      <span className="glass-device-label">{truncatedName}</span>
      <ChevronDown size={12} className="glass-device-chevron" />
    </button>
  );
};
