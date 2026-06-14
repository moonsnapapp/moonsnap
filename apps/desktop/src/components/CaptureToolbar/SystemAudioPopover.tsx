/**
 * SystemAudioPopover - System audio device selector using native Tauri menu
 *
 * Shows current system audio status, opens native menu with output device list.
 * Mirrors MicrophonePopover pattern.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, ChevronDown } from 'lucide-react';
import { Menu, MenuItem, PredefinedMenuItem, CheckMenuItem, Submenu } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { useAudioOutputStore } from '@/stores/audioOutputStore';
import { useSystemAudioProcessStore } from '@/stores/systemAudioProcessStore';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { DEFAULT_SYSTEM_AUDIO_SCOPE } from '@/constants/recording';
import { audioLogger } from '@/utils/logger';
import type { SystemAudioProcess } from '@/types/generated/SystemAudioProcess';
import type { SystemAudioProcessTarget } from '@/types/generated/SystemAudioProcessTarget';
import type { SystemAudioScopeMode } from '@/types/generated/SystemAudioScopeMode';

interface SystemAudioPopoverProps {
  disabled?: boolean;
}

export const SystemAudioPopover: React.FC<SystemAudioPopoverProps> = ({ disabled = false }) => {
  const { devices, loadDevices } = useAudioOutputStore();
  const { devices: processes, loadDevices: loadProcesses } = useSystemAudioProcessStore();
  const { settings, updateVideoSettings } = useCaptureSettingsStore();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isEnabled = settings.video.captureSystemAudio;
  const selectedDeviceId = settings.video.systemAudioDeviceId ?? null;
  const audioScope = settings.video.systemAudioScope ?? DEFAULT_SYSTEM_AUDIO_SCOPE;
  const selectedProcess = audioScope.targets[0] ?? null;

  // Load devices on mount
  useEffect(() => {
    if (devices.length === 0) {
      loadDevices();
    }
    if (processes.length === 0) {
      loadProcesses();
    }
  }, [devices.length, loadDevices, loadProcesses, processes.length]);

  const currentDevice = devices.find((d) => d.id === selectedDeviceId);
  // If no device selected, show the default device name or "System Audio"
  const defaultDevice = devices.find((d) => d.isDefault);
  const displayName = getDisplayName(
    isEnabled,
    audioScope.mode,
    selectedProcess,
    currentDevice?.name || defaultDevice?.name || 'System Audio'
  );

  // Truncate display name for button
  const truncatedName = displayName.length > 12
    ? displayName.substring(0, 12) + '\u2026'
    : displayName;

  const handleSelectDevice = useCallback((deviceId: string | null) => {
    updateVideoSettings({
      captureSystemAudio: true,
      systemAudioDeviceId: deviceId,
      systemAudioScope: DEFAULT_SYSTEM_AUDIO_SCOPE,
    });
  }, [updateVideoSettings]);

  const handleMute = useCallback(() => {
    updateVideoSettings({ captureSystemAudio: false });
  }, [updateVideoSettings]);

  const handleSelectAllAudio = useCallback(() => {
    updateVideoSettings({
      captureSystemAudio: true,
      systemAudioScope: DEFAULT_SYSTEM_AUDIO_SCOPE,
    });
  }, [updateVideoSettings]);

  const handleSelectProcess = useCallback((mode: Exclude<SystemAudioScopeMode, 'all'>, process: SystemAudioProcess) => {
    updateVideoSettings({
      captureSystemAudio: true,
      systemAudioScope: {
        mode,
        targets: [toProcessTarget(process)],
      },
    });
  }, [updateVideoSettings]);

  // Open native menu
  const openMenu = useCallback(async () => {
    if (disabled) return;

    try {
      const supportsProcessAudio = await invoke<boolean>('is_process_audio_capture_supported')
        .catch((error) => {
          audioLogger.error('Failed to check process audio support:', error);
          return false;
        });

      await Promise.all([
        loadDevices(),
        supportsProcessAudio ? loadProcesses() : Promise.resolve(),
      ]);
      const freshDevices = useAudioOutputStore.getState().devices;
      const freshProcesses = supportsProcessAudio
        ? useSystemAudioProcessStore.getState().devices
        : [];
      const effectiveAudioScope = supportsProcessAudio ? audioScope : DEFAULT_SYSTEM_AUDIO_SCOPE;

      if (!supportsProcessAudio && audioScope.mode !== 'all') {
        updateVideoSettings({
          captureSystemAudio: true,
          systemAudioScope: DEFAULT_SYSTEM_AUDIO_SCOPE,
        });
      }

      // Determine which device ID is effectively selected
      // null means "use default"
      const effectiveId = selectedDeviceId;

      const outputDeviceItems = await Promise.all([
        CheckMenuItem.new({
          id: 'default',
          text: 'Default Device',
            checked: isEnabled && effectiveAudioScope.mode === 'all' && effectiveId === null,
          action: () => handleSelectDevice(null),
        }),
        ...freshDevices.map((device) =>
          CheckMenuItem.new({
            id: `device-${device.id}`,
            text: device.isDefault
              ? `${device.name} \u2605`
              : device.name,
            checked: isEnabled && effectiveAudioScope.mode === 'all' && effectiveId === device.id,
            action: () => handleSelectDevice(device.id),
          })
        ),
      ]);

      const includeProcessItems = await createProcessItems({
        idPrefix: 'include-process',
        mode: 'includeProcesses',
        processes: freshProcesses,
        selectedProcess,
        selectedMode: effectiveAudioScope.mode,
        onSelect: handleSelectProcess,
        unsupported: !supportsProcessAudio,
      });

      const excludeProcessItems = await createProcessItems({
        idPrefix: 'exclude-process',
        mode: 'excludeProcesses',
        processes: freshProcesses,
        selectedProcess,
        selectedMode: effectiveAudioScope.mode,
        onSelect: handleSelectProcess,
        unsupported: !supportsProcessAudio,
      });

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
        // Capture scope
        CheckMenuItem.new({
          id: 'all-system-audio',
          text: 'All System Audio',
          checked: isEnabled && effectiveAudioScope.mode === 'all',
          action: handleSelectAllAudio,
        }),
        Submenu.new({
          id: 'output-device-submenu',
          text: 'Output Device',
          items: outputDeviceItems,
          enabled: isEnabled && effectiveAudioScope.mode === 'all',
        }),
        Submenu.new({
          id: 'include-process-submenu',
          text: 'Only App',
          items: includeProcessItems,
          enabled: freshProcesses.length > 0,
        }),
        Submenu.new({
          id: 'exclude-process-submenu',
          text: 'Exclude App',
          items: excludeProcessItems,
          enabled: freshProcesses.length > 0,
        }),
        // Refresh option
        PredefinedMenuItem.new({ item: 'Separator' }),
        MenuItem.new({
          id: 'refresh',
          text: 'Refresh Devices and Apps',
          action: () => {
            loadDevices();
            loadProcesses();
          },
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
  }, [
    audioScope,
    disabled,
    handleMute,
    handleSelectAllAudio,
    handleSelectDevice,
    handleSelectProcess,
    isEnabled,
    loadDevices,
    loadProcesses,
    selectedDeviceId,
    selectedProcess,
    updateVideoSettings,
  ]);

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

function toProcessTarget(process: SystemAudioProcess): SystemAudioProcessTarget {
  return {
    processId: process.processId,
    processName: process.processName,
    windowTitle: process.windowTitle,
  };
}

function getProcessLabel(process: SystemAudioProcessTarget): string {
  return process.windowTitle || process.processName || `Process ${process.processId}`;
}

function getDisplayName(
  isEnabled: boolean,
  mode: SystemAudioScopeMode,
  selectedProcess: SystemAudioProcessTarget | null,
  allAudioLabel: string
) {
  if (!isEnabled) {
    return 'System Muted';
  }

  if (mode === 'includeProcesses' && selectedProcess) {
    return `${getProcessLabel(selectedProcess)} only`;
  }

  if (mode === 'excludeProcesses' && selectedProcess) {
    return `Exclude ${getProcessLabel(selectedProcess)}`;
  }

  return allAudioLabel;
}

async function createProcessItems({
  idPrefix,
  mode,
  processes,
  selectedProcess,
  selectedMode,
  onSelect,
  unsupported,
}: {
  idPrefix: string;
  mode: Exclude<SystemAudioScopeMode, 'all'>;
  processes: SystemAudioProcess[];
  selectedProcess: SystemAudioProcessTarget | null;
  selectedMode: SystemAudioScopeMode;
  onSelect: (mode: Exclude<SystemAudioScopeMode, 'all'>, process: SystemAudioProcess) => void;
  unsupported: boolean;
}) {
  if (unsupported) {
    return [
      await MenuItem.new({
        id: `${idPrefix}-unsupported`,
        text: 'Requires Windows 11',
        enabled: false,
      }),
    ];
  }

  if (processes.length === 0) {
    return [
      await MenuItem.new({
        id: `${idPrefix}-empty`,
        text: 'No apps found',
        enabled: false,
      }),
    ];
  }

  return Promise.all(
    processes.map((process) =>
      CheckMenuItem.new({
        id: `${idPrefix}-${process.processId}`,
        text: process.windowTitle
          ? `${process.processName} - ${process.windowTitle}`
          : process.processName,
        checked: selectedMode === mode && selectedProcess?.processId === process.processId,
        action: () => onSelect(mode, process),
      })
    )
  );
}
