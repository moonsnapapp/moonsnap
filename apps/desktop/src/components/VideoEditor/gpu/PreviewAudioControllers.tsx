import { memo, useEffect, useMemo } from 'react';
import { usePreviewOrPlaybackTimeThrottled } from '../../../hooks/usePlaybackTimeThrottled';
import { selectCurrentTimeMs, selectPreviewTimeMs } from '../../../stores/videoEditor/selectors';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import type { AudioTrackSettings, TextSegment } from '../../../types';
import { hasActiveTypewriterSound } from '../../../utils/textSegmentAnimation';
import { videoEditorLogger } from '../../../utils/logger';
import {
  getMicPreviewAudioVolume,
  getSystemPreviewAudioVolume,
  getTypewriterPreviewAudioVolume,
} from './previewAudio';
import { usePlaybackSync } from './usePlaybackSync';

export const PlaybackSyncController = memo(function PlaybackSyncController({
  videoRef,
  systemAudioRef,
  micAudioRef,
  videoSrc,
  systemAudioSrc,
  micAudioSrc,
  audioConfig,
  durationMs,
  isPlaying,
  onVideoError,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  systemAudioRef: React.RefObject<HTMLAudioElement | null>;
  micAudioRef: React.RefObject<HTMLAudioElement | null>;
  videoSrc: string | null;
  systemAudioSrc: string | null;
  micAudioSrc: string | null;
  audioConfig: AudioTrackSettings | undefined;
  durationMs: number | undefined;
  isPlaying: boolean;
  onVideoError: (message: string) => void;
}) {
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const currentTimeMs = useVideoEditorStore(selectCurrentTimeMs);

  usePlaybackSync({
    videoRef,
    systemAudioRef,
    micAudioRef,
    videoSrc,
    systemAudioSrc,
    micAudioSrc,
    audioConfig,
    durationMs,
    isPlaying,
    previewTimeMs,
    currentTimeMs,
    onVideoError,
  });

  return null;
});

function syncTypewriterAudioPlayback(audio: HTMLAudioElement, shouldPlay: boolean) {
  const syncAudio = shouldPlay ? playTypewriterAudio : resetTypewriterAudio;
  syncAudio(audio);
}

function playTypewriterAudio(audio: HTMLAudioElement) {
  if (!audio.paused) return;

  audio.play().catch((error) => {
    videoEditorLogger.warn('Typewriter audio play failed:', error);
  });
}

function resetTypewriterAudio(audio: HTMLAudioElement) {
  pauseTypewriterAudio(audio);
  rewindTypewriterAudio(audio);
}

function pauseTypewriterAudio(audio: HTMLAudioElement) {
  if (audio.paused) return;
  audio.pause();
}

function rewindTypewriterAudio(audio: HTMLAudioElement) {
  if (audio.currentTime !== 0) {
    audio.currentTime = 0;
  }
}

function applyTypewriterAudioVolume(
  audio: HTMLAudioElement | null,
  isActive: boolean,
  audioConfig: AudioTrackSettings | undefined,
): void {
  if (!audio) {
    return;
  }

  if (!isActive) {
    return;
  }

  audio.volume = getTypewriterAudioVolume(audioConfig);
}

function getTypewriterAudioVolume(audioConfig: AudioTrackSettings | undefined): number {
  return isSystemAudioMuted(audioConfig) ? 0 : getConfiguredSystemAudioVolume(audioConfig);
}

function isSystemAudioMuted(audioConfig: AudioTrackSettings | undefined) {
  return audioConfig?.systemMuted === true;
}

function getConfiguredSystemAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return audioConfig?.systemVolume ?? 1;
}

export const TypewriterAudioController = memo(function TypewriterAudioController({
  typewriterAudioRef,
  isActive,
  isPlaying,
  audioConfig,
  textSegments,
}: {
  typewriterAudioRef: React.RefObject<HTMLAudioElement | null>;
  isActive: boolean;
  isPlaying: boolean;
  audioConfig: AudioTrackSettings | undefined;
  textSegments: TextSegment[] | undefined;
}) {
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(20);
  const shouldPlayTypewriterAudio = useMemo(
    () => hasActiveTypewriterSound(textSegments, currentTimeMs / 1000),
    [textSegments, currentTimeMs]
  );

  useEffect(() => {
    const audio = typewriterAudioRef.current;
    applyTypewriterAudioVolume(audio, isActive, audioConfig);
  }, [audioConfig, audioConfig?.systemMuted, audioConfig?.systemVolume, isActive, typewriterAudioRef]);

  useEffect(() => {
    const audio = typewriterAudioRef.current;
    if (!audio || !isActive) {
      return;
    }

    syncTypewriterAudioPlayback(audio, isPlaying && shouldPlayTypewriterAudio);
  }, [isPlaying, isActive, shouldPlayTypewriterAudio, typewriterAudioRef]);

  return null;
});


export const HiddenPreviewAudioElements = memo(function HiddenPreviewAudioElements({
  isActive,
  systemAudioSrc,
  micAudioSrc,
  typewriterAudioSrc,
  systemAudioRef,
  micAudioRef,
  typewriterAudioRef,
  audioConfig,
}: {
  isActive: boolean;
  systemAudioSrc: string | null;
  micAudioSrc: string | null;
  typewriterAudioSrc: string;
  systemAudioRef: React.RefObject<HTMLAudioElement | null>;
  micAudioRef: React.RefObject<HTMLAudioElement | null>;
  typewriterAudioRef: React.RefObject<HTMLAudioElement | null>;
  audioConfig: AudioTrackSettings | undefined;
}) {
  return (
    <>
      <HiddenPreviewAudio
        isActive={isActive}
        audioRef={systemAudioRef}
        src={systemAudioSrc}
        volume={getSystemPreviewAudioVolume(audioConfig)}
      />
      <HiddenPreviewAudio
        isActive={isActive}
        audioRef={micAudioRef}
        src={micAudioSrc}
        volume={getMicPreviewAudioVolume(audioConfig)}
      />
      <HiddenPreviewAudio
        isActive={isActive}
        audioRef={typewriterAudioRef}
        src={typewriterAudioSrc}
        volume={getTypewriterPreviewAudioVolume(audioConfig)}
        loop
      />
    </>
  );
});

function HiddenPreviewAudio({
  isActive,
  audioRef,
  src,
  volume,
  loop = false,
}: {
  isActive: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  src: string | null;
  volume: number;
  loop?: boolean;
}) {
  if (!isActive || !src) return null;

  return (
    <audio
      ref={audioRef}
      src={src}
      preload="auto"
      loop={loop}
      style={{ display: 'none' }}
      onLoadedData={(e) => {
        e.currentTarget.volume = volume;
      }}
    />
  );
}
