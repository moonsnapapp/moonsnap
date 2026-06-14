import { audioLogger } from '../utils/logger';
import type { SystemAudioProcess } from '../types/generated/SystemAudioProcess';
import { createDeviceStore } from './createDeviceStore';

export const useSystemAudioProcessStore = createDeviceStore<SystemAudioProcess>({
  command: 'list_system_audio_processes',
  onError: (error) => {
    audioLogger.error('Failed to load system audio processes:', error);
  },
});

export const useSystemAudioProcesses = () =>
  useSystemAudioProcessStore((state) => state.devices);
