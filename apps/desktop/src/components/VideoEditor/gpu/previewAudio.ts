import type { AudioTrackSettings } from '../../../types';

export function getSystemPreviewAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return getPreviewAudioVolume(audioConfig?.systemMuted === true, audioConfig?.systemVolume);
}

export function getMicPreviewAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return getPreviewAudioVolume(
    audioConfig?.microphoneMuted === true,
    audioConfig?.microphoneVolume,
  );
}

export function getTypewriterPreviewAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return getSystemPreviewAudioVolume(audioConfig);
}

function getPreviewAudioVolume(isMuted: boolean, volume: number | undefined) {
  return isMuted ? 0 : volume ?? 1;
}
