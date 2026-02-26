import { audioLogger } from '../utils/logger';
import type { AudioOutputDevice } from '../types/generated';
import { createDeviceStore } from './createDeviceStore';

export const useAudioOutputStore = createDeviceStore<AudioOutputDevice>({
  command: 'list_audio_output_devices',
  onError: (error) => {
    audioLogger.error('Failed to load audio output devices:', error);
  },
});

// Selectors
export const useAudioOutputDevices = () =>
  useAudioOutputStore((state) => state.devices);
