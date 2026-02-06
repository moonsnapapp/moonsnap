import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { audioLogger } from '../utils/logger';
import type { AudioOutputDevice } from '../types/generated';

interface AudioOutputState {
  // State
  devices: AudioOutputDevice[];
  isLoadingDevices: boolean;
  devicesError: string | null;

  // Actions
  loadDevices: () => Promise<void>;
}

export const useAudioOutputStore = create<AudioOutputState>((set) => ({
  devices: [],
  isLoadingDevices: false,
  devicesError: null,

  loadDevices: async () => {
    set({ isLoadingDevices: true, devicesError: null });
    try {
      const devices = await invoke<AudioOutputDevice[]>('list_audio_output_devices');
      set({ devices, isLoadingDevices: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ devicesError: message, isLoadingDevices: false });
      audioLogger.error('Failed to load audio output devices:', error);
    }
  },
}));

// Selectors
export const useAudioOutputDevices = () =>
  useAudioOutputStore((state) => state.devices);
