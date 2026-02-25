import { audioLogger } from '../utils/logger';
import type { AudioInputDevice } from '../types/generated';
import { createDeviceStore } from './createDeviceStore';

export const useAudioInputStore = createDeviceStore<AudioInputDevice>({
  command: 'list_audio_input_devices',
  onError: (error) => {
    audioLogger.error('Failed to load audio input devices:', error);
  },
});

// Selectors
export const useAudioInputDevices = () =>
  useAudioInputStore((state) => state.devices);
