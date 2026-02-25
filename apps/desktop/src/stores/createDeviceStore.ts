import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';

export interface DeviceStoreState<TDevice> {
  devices: TDevice[];
  isLoadingDevices: boolean;
  devicesError: string | null;
  loadDevices: () => Promise<void>;
}

interface CreateDeviceStoreOptions {
  command: string;
  onError: (error: unknown) => void;
}

export function createDeviceStore<TDevice>({
  command,
  onError,
}: CreateDeviceStoreOptions) {
  return create<DeviceStoreState<TDevice>>((set) => ({
    devices: [],
    isLoadingDevices: false,
    devicesError: null,

    loadDevices: async () => {
      set({ isLoadingDevices: true, devicesError: null });
      try {
        const devices = await invoke<TDevice[]>(command);
        set({ devices, isLoadingDevices: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ devicesError: message, isLoadingDevices: false });
        onError(error);
      }
    },
  }));
}
