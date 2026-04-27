/**
 * usePlaybackSync - Playback synchronization for video preview.
 *
 * Extracts playback-related effects from GPUVideoPreview:
 * - Video/audio sync on play/pause
 * - Audio element volume management
 * - Seeking on timeline scrub/click
 */

import { useEffect, useCallback, useRef } from 'react';
import { useVideoEditorStore, findSegmentAtSourceTime, getEffectiveDuration, timelineToSource } from '../../../stores/videoEditorStore';
import { selectLastSeekToken } from '../../../stores/videoEditor/selectors';
import { usePlaybackControls, initPlaybackEngine } from '../../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../../hooks/useTimelineSourceTime';
import { videoEditorLogger } from '../../../utils/logger';
import type { AudioTrackSettings } from '../../../types';
import { reconcileProjectDuration } from '../../../stores/videoEditor/projectSlice';

interface PlaybackSyncOptions {
  /** Main video element ref */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** System audio element ref */
  systemAudioRef: React.RefObject<HTMLAudioElement | null>;
  /** Microphone audio element ref */
  micAudioRef: React.RefObject<HTMLAudioElement | null>;
  /** Video source URL */
  videoSrc: string | null;
  /** System audio source URL */
  systemAudioSrc: string | null;
  /** Microphone audio source URL */
  micAudioSrc: string | null;
  /** Audio configuration from project */
  audioConfig: AudioTrackSettings | undefined;
  /** Timeline duration in ms */
  durationMs: number | undefined;
  /** Whether currently playing */
  isPlaying: boolean;
  /** Preview time in ms (when hovering timeline) */
  previewTimeMs: number | null;
  /** Current playhead time in ms */
  currentTimeMs: number;
  /** Callback when video error occurs */
  onVideoError: (message: string) => void;
}

interface PlaybackSyncResult {
  /** Playback controls */
  controls: ReturnType<typeof usePlaybackControls>;
  /** Handle video click (toggle play/pause) */
  handleVideoClick: () => void;
}

// Keep playback smooth without audible "rewind" artifacts from backward seeks.
const PLAYBACK_AUDIO_RESYNC_THRESHOLD_SEC = 0.5;
const PLAYBACK_SEEK_START_FALLBACK_MS = 250;

function getPlaybackSpeedForTimelineTime(timelineTimeMs: number): number {
  const state = useVideoEditorStore.getState();
  const project = state.project;
  if (!project) {
    return 1;
  }

  const sourceTimeMs = project.timeline.segments.length > 0
    ? timelineToSource(timelineTimeMs, project.timeline.segments)
    : timelineTimeMs;
  const segment = findSegmentAtSourceTime(sourceTimeMs ?? timelineTimeMs, project.timeline.segments);
  const speed = segment?.speed ?? project.timeline.speed ?? 1;
  return Number.isFinite(speed) ? Math.max(1, Math.min(10, speed)) : 1;
}

function applyPitchPreservingPlaybackRate(media: HTMLMediaElement | null, speed: number) {
  if (!media) {
    return;
  }
  media.playbackRate = speed;
  media.preservesPitch = true;
}

/**
 * Hook for managing playback synchronization between video and audio elements.
 * Extracts complex playback sync logic from GPUVideoPreview.
 */
export function usePlaybackSync(options: PlaybackSyncOptions): PlaybackSyncResult {
  const {
    videoRef,
    systemAudioRef,
    micAudioRef,
    systemAudioSrc,
    micAudioSrc,
    audioConfig,
    durationMs,
    isPlaying,
    previewTimeMs,
    currentTimeMs,
    onVideoError,
  } = options;

  const controls = usePlaybackControls();
  const hasSeparateAudio = Boolean(systemAudioSrc || micAudioSrc);
  const lastSeekToken = useVideoEditorStore(selectLastSeekToken);
  const lastSeekTokenRef = useRef(lastSeekToken);

  const getSourceTime = useTimelineToSourceTime();

  // Initialize playback engine once when project first loads.
  // Must NOT re-run on duration changes (e.g. reconcileProjectDuration from
  // loadedmetadata) because initPlaybackEngine resets currentTimeMs to 0,
  // which would discard the user's scrub position.
  const hasInitRef = useRef(false);
  useEffect(() => {
    if (durationMs && !hasInitRef.current) {
      hasInitRef.current = true;
      initPlaybackEngine(durationMs);
    }
  }, [durationMs]);

  // Keep playback engine video element in sync with the actual mounted <video>.
  // This must update on mount/unmount transitions (for example when editor view is inactive).
  useEffect(() => {
    controls.setVideoElement(videoRef.current);
    return () => {
      controls.setVideoElement(null);
    };
  });

  // Set duration when project loads
  useEffect(() => {
    if (durationMs) {
      controls.setDuration(durationMs);
    }
  }, [durationMs, controls]);

  // Handle video element events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }

      const actualDurationMs = Math.round(video.duration * 1000);

      useVideoEditorStore.setState((state) => {
        if (!state.project) {
          return state;
        }

        const nextProject = reconcileProjectDuration(state.project, actualDurationMs);
        if (nextProject === state.project) {
          return state;
        }

        const effectiveDurationMs = getEffectiveDuration(
          nextProject.timeline.segments ?? [],
          nextProject.timeline.durationMs,
        );
        const nextPreviewTimeMs = state.previewTimeMs === null
          ? null
          : Math.min(state.previewTimeMs, effectiveDurationMs);
        const nextCurrentTimeMs = Math.min(state.currentTimeMs, effectiveDurationMs);
        const nextExportInPointMs = state.exportInPointMs === null
          ? null
          : Math.min(state.exportInPointMs, effectiveDurationMs);
        const nextExportOutPointMs = state.exportOutPointMs === null
          ? null
          : Math.max(
              nextExportInPointMs ?? 0,
              Math.min(state.exportOutPointMs, effectiveDurationMs),
            );

        return {
          project: nextProject,
          currentTimeMs: nextCurrentTimeMs,
          previewTimeMs: nextPreviewTimeMs,
          exportInPointMs: nextExportInPointMs,
          exportOutPointMs: nextExportOutPointMs,
        };
      });
    };

    const onEnded = () => {
      controls.stopRAFLoop();
      // Snap playhead to the exact end — the browser fires `ended` before the
      // next RAF callback, so the RAF loop never reads the final position.
      const state = useVideoEditorStore.getState();
      const segments = state.project?.timeline.segments;
      const sourceDuration = state.project?.timeline.durationMs ?? 0;
      const endTime = segments && segments.length > 0
        ? getEffectiveDuration(segments, sourceDuration)
        : sourceDuration;
      state.setCurrentTime(endTime);
      state.setIsPlaying(false);
    };

    const onError = (e: Event) => {
      const videoEl = e.target as HTMLVideoElement;
      const error = videoEl.error;
      videoEditorLogger.error('Video error:', error);
      onVideoError(error?.message || 'Failed to load video');
    };

    const onLoadedData = () => {
      onVideoError(''); // Clear any previous error
      // Mute video if we have separate audio files (editor flow)
      if (hasSeparateAudio) {
        video.volume = 0;
        videoEditorLogger.debug(`[Audio] Video loaded, muted (using separate audio files)`);
      } else if (audioConfig) {
        video.volume = audioConfig.systemMuted ? 0 : audioConfig.systemVolume;
        videoEditorLogger.debug(`[Audio] Video loaded, volume set to ${video.volume} (embedded audio)`);
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('loadeddata', onLoadedData);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadeddata', onLoadedData);
    };
  }, [controls, audioConfig, hasSeparateAudio, onVideoError, videoRef]);

  // Sync play/pause state from store to video element and RAF loop
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let seekedHandler: (() => void) | null = null;
    let fallbackTimerId: ReturnType<typeof setTimeout> | null = null;
    let hasStartedPlayback = false;

    const startPlayback = () => {
      if (cancelled || hasStartedPlayback) return;
      hasStartedPlayback = true;
      if (fallbackTimerId !== null) {
        clearTimeout(fallbackTimerId);
        fallbackTimerId = null;
      }
      if (video.paused) {
        video.play().catch(e => {
          if (e.name === 'AbortError') return;
          videoEditorLogger.error('Play failed:', e);
          controls.stopRAFLoop();
          useVideoEditorStore.getState().setIsPlaying(false);
        });
      }
      controls.startRAFLoop();
    };

    if (isPlaying) {
      const playheadTime = useVideoEditorStore.getState().currentTimeMs;
      const sourceTime = getSourceTime(playheadTime);
      const targetTimeSec = sourceTime / 1000;
      const needsSeek = Math.abs(video.currentTime - targetTimeSec) > 0.001;

      if (needsSeek) {
        seekedHandler = () => {
          seekedHandler = null;
          startPlayback();
        };
        video.addEventListener('seeked', seekedHandler, { once: true });
        video.currentTime = targetTimeSec;
        fallbackTimerId = setTimeout(() => {
          if (!cancelled) {
            startPlayback();
          }
        }, PLAYBACK_SEEK_START_FALLBACK_MS);

        // Some browsers apply currentTime immediately and may not dispatch seeked.
        if (Math.abs(video.currentTime - targetTimeSec) <= 0.001) {
          if (seekedHandler) {
            video.removeEventListener('seeked', seekedHandler);
            seekedHandler = null;
          }
          startPlayback();
        }
      } else {
        startPlayback();
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
      controls.stopRAFLoop();
    }

    return () => {
      cancelled = true;
      if (fallbackTimerId !== null) {
        clearTimeout(fallbackTimerId);
      }
      if (seekedHandler) {
        video.removeEventListener('seeked', seekedHandler);
      }
    };
  }, [isPlaying, controls, getSourceTime, videoRef]);

  // Apply volume settings to main video element
  useEffect(() => {
    const video = videoRef.current;
    if (video && audioConfig) {
      if (hasSeparateAudio) {
        video.volume = 0;
        videoEditorLogger.debug(`[Audio] Main video muted (using separate audio files)`);
      } else {
        const newVolume = audioConfig.systemMuted ? 0 : audioConfig.systemVolume;
        video.volume = newVolume;
        videoEditorLogger.debug(`[Audio] Main video volume set to ${newVolume} (embedded audio)`);
      }
    }
  }, [audioConfig, hasSeparateAudio, videoRef]);

  // Apply volume settings to system audio element
  useEffect(() => {
    const audio = systemAudioRef.current;
    if (audio && audioConfig) {
      const newVolume = audioConfig.systemMuted ? 0 : audioConfig.systemVolume;
      audio.volume = newVolume;
      videoEditorLogger.debug(`[Audio] System audio volume set to ${newVolume}`);
    }
  }, [audioConfig, systemAudioRef]);

  // Apply volume settings to microphone audio element
  useEffect(() => {
    const audio = micAudioRef.current;
    if (audio && audioConfig) {
      const newVolume = audioConfig.microphoneMuted ? 0 : audioConfig.microphoneVolume;
      audio.volume = newVolume;
      videoEditorLogger.debug(`[Audio] Mic audio volume set to ${newVolume}`);
    }
  }, [audioConfig, micAudioRef]);

  // Keep video and separate audio rates aligned for sped-up trim segments.
  useEffect(() => {
    const timelineTime = !isPlaying && previewTimeMs !== null ? previewTimeMs : currentTimeMs;
    const speed = getPlaybackSpeedForTimelineTime(timelineTime);
    applyPitchPreservingPlaybackRate(videoRef.current, speed);
    applyPitchPreservingPlaybackRate(systemAudioRef.current, speed);
    applyPitchPreservingPlaybackRate(micAudioRef.current, speed);
  }, [currentTimeMs, isPlaying, micAudioRef, previewTimeMs, systemAudioRef, videoRef]);

  // Sync audio playback with video playback
  useEffect(() => {
    const systemAudio = systemAudioRef.current;
    const micAudio = micAudioRef.current;

    if (isPlaying) {
      const playheadTime = useVideoEditorStore.getState().currentTimeMs;
      const sourceTimeSec = getSourceTime(playheadTime) / 1000;

      const playAudio = (audio: HTMLAudioElement) => {
        audio.currentTime = sourceTimeSec;
        audio.play().catch(e => {
          // AbortError is expected when pause() interrupts a pending play()
          if (e.name !== 'AbortError') {
            videoEditorLogger.warn('Audio play failed:', e);
          }
        });
      };
      if (systemAudio) playAudio(systemAudio);
      if (micAudio) playAudio(micAudio);
    } else {
      if (systemAudio) systemAudio.pause();
      if (micAudio) micAudio.pause();
    }
  }, [isPlaying, getSourceTime, micAudioRef, systemAudioRef]);

  // Seek audio when preview time or current time changes.
  // Skip seeking when hovering over tracks (hoveredTrack !== null) since that's
  // just for segment preview indicators — only seek when scrubbing the ruler.
  // Also skip during playhead drag to avoid scrub lag from repeated audio seeks.
  useEffect(() => {
    // Skip audio seeking during playhead drag — it's the main source of scrub lag.
    if (!isPlaying && useVideoEditorStore.getState().isDraggingPlayhead) {
      return;
    }

    const timelineTime = !isPlaying && previewTimeMs !== null ? previewTimeMs : currentTimeMs;
    const sourceTime = getSourceTime(timelineTime);
    const seekTokenChanged = lastSeekTokenRef.current !== lastSeekToken;
    if (seekTokenChanged) {
      lastSeekTokenRef.current = lastSeekToken;
    }

    // When previewTimeMs is set from track hover (not ruler), skip expensive audio seeking
    if (!isPlaying && previewTimeMs !== null && !seekTokenChanged) {
      const hoveredTrack = useVideoEditorStore.getState().hoveredTrack;
      if (hoveredTrack !== null) return;
    }

    const syncAudio = (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      if (!isPlaying || seekTokenChanged) {
        audio.currentTime = sourceTime / 1000;
      }
    };

    syncAudio(systemAudioRef.current);
    syncAudio(micAudioRef.current);
  }, [previewTimeMs, currentTimeMs, isPlaying, getSourceTime, lastSeekToken, micAudioRef, systemAudioRef]);

  // While playing, keep video clock aligned to audio (audio is master).
  useEffect(() => {
    if (!isPlaying) return;

    const video = videoRef.current;
    const masterAudio = systemAudioRef.current ?? micAudioRef.current;
    if (!video || !masterAudio) return;

    const handleTimeUpdate = () => {
      const driftSec = masterAudio.currentTime - video.currentTime;
      if (Math.abs(driftSec) > PLAYBACK_AUDIO_RESYNC_THRESHOLD_SEC) {
        // Check if video is in a valid segment (e.g. RAF loop just jumped over a deleted region).
        // If so, sync audio TO video instead of pulling video back into deleted content.
        const segments = useVideoEditorStore.getState().project?.timeline.segments;
        if (segments && segments.length > 0) {
          const videoInValidSegment = findSegmentAtSourceTime(video.currentTime * 1000, segments);
          if (videoInValidSegment) {
            masterAudio.currentTime = video.currentTime;
            const otherAudio = masterAudio === systemAudioRef.current
              ? micAudioRef.current
              : systemAudioRef.current;
            if (otherAudio) {
              otherAudio.currentTime = video.currentTime;
            }
            return;
          }
        }
        video.currentTime = masterAudio.currentTime;
      }
    };

    masterAudio.addEventListener('timeupdate', handleTimeUpdate);
    return () => masterAudio.removeEventListener('timeupdate', handleTimeUpdate);
  }, [isPlaying, systemAudioRef, micAudioRef, videoRef]);

  // Seek video when preview time or current time changes.
  // Skip seeking when hovering over tracks — only seek for ruler scrubbing or playhead changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    // When previewTimeMs comes from track hover, skip expensive video seeking
    if (previewTimeMs !== null) {
      const hoveredTrack = useVideoEditorStore.getState().hoveredTrack;
      if (hoveredTrack !== null) return;
    }

    const timelineTime = previewTimeMs !== null ? previewTimeMs : currentTimeMs;
    const sourceTime = getSourceTime(timelineTime);
    const targetSec = sourceTime / 1000;
    // Skip if video is already at the target position (avoids double-seek
    // when controls.seek() already set video.currentTime directly).
    if (Math.abs(video.currentTime - targetSec) < 0.001) return;
    video.currentTime = targetSec;
  }, [previewTimeMs, currentTimeMs, isPlaying, getSourceTime, videoRef]);

  const handleVideoClick = useCallback(() => {
    controls.toggle();
  }, [controls]);

  return {
    controls,
    handleVideoClick,
  };
}
