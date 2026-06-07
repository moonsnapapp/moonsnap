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
import {
  selectExportInPointMs,
  selectExportOutPointMs,
  selectIsIOLoopEnabled,
  selectLastSeekToken,
} from '../../../stores/videoEditor/selectors';
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

type PlaybackControls = ReturnType<typeof usePlaybackControls>;
type VideoEditorState = ReturnType<typeof useVideoEditorStore.getState>;
type VideoEditorProject = NonNullable<VideoEditorState['project']>;
type TimelineSegments = VideoEditorProject['timeline']['segments'];
type PlaybackSeekedHandler = () => void;

interface PlaybackStartState {
  cancelled: boolean;
  seekedHandler: PlaybackSeekedHandler | null;
  fallbackTimerId: ReturnType<typeof setTimeout> | null;
  hasStartedPlayback: boolean;
}

// Keep playback smooth without audible "rewind" artifacts from backward seeks.
const PLAYBACK_AUDIO_RESYNC_THRESHOLD_SEC = 0.5;
const PLAYBACK_SEEK_START_FALLBACK_MS = 250;
const IO_LOOP_WRAP_LOOKAHEAD_MS = 35;

function clampPlaybackSpeed(speed: number | undefined): number {
  return typeof speed === 'number' && Number.isFinite(speed)
    ? Math.max(1, Math.min(10, speed))
    : 1;
}

function getSourceTimeForPlaybackSpeed(
  timelineTimeMs: number,
  segments: TimelineSegments,
) {
  return segments.length > 0
    ? timelineToSource(timelineTimeMs, segments) ?? timelineTimeMs
    : timelineTimeMs;
}

function getTimelinePlaybackSpeed(
  timelineTimeMs: number,
  project: VideoEditorProject,
) {
  const sourceTimeMs = getSourceTimeForPlaybackSpeed(timelineTimeMs, project.timeline.segments);
  const segment = findSegmentAtSourceTime(sourceTimeMs, project.timeline.segments);
  return segment?.speed ?? project.timeline.speed;
}

function getPlaybackSpeedForTimelineTime(timelineTimeMs: number): number {
  const project = useVideoEditorStore.getState().project;
  if (!project) {
    return 1;
  }

  return clampPlaybackSpeed(getTimelinePlaybackSpeed(timelineTimeMs, project));
}

function applyPitchPreservingPlaybackRate(media: HTMLMediaElement | null, speed: number) {
  if (!media) {
    return;
  }
  media.playbackRate = speed;
  media.preservesPitch = true;
}

function getPreviewTimelineTime(
  isPlaying: boolean,
  previewTimeMs: number | null,
  currentTimeMs: number,
) {
  return !isPlaying && previewTimeMs !== null ? previewTimeMs : currentTimeMs;
}

function shouldSkipPreviewAudioSeek(
  isPlaying: boolean,
  previewTimeMs: number | null,
  seekTokenChanged: boolean,
) {
  if (isPlaying || previewTimeMs === null || seekTokenChanged) {
    return false;
  }

  return useVideoEditorStore.getState().hoveredTrack !== null;
}

function syncVideoForSeekToken(
  video: HTMLVideoElement | null,
  sourceTimeSec: number,
  seekTokenChanged: boolean,
) {
  if (video && seekTokenChanged) {
    video.currentTime = sourceTimeSec;
  }
}

function syncAudioForTimelineSeek(
  audio: HTMLAudioElement | null,
  sourceTimeSec: number,
  isPlaying: boolean,
  seekTokenChanged: boolean,
) {
  if (audio && (!isPlaying || seekTokenChanged)) {
    audio.currentTime = sourceTimeSec;
  }
}

function clearPlaybackFallbackTimer(state: PlaybackStartState): void {
  if (state.fallbackTimerId !== null) {
    clearTimeout(state.fallbackTimerId);
    state.fallbackTimerId = null;
  }
}

function removePlaybackSeekedHandler(
  video: HTMLVideoElement,
  state: PlaybackStartState,
): void {
  if (state.seekedHandler) {
    video.removeEventListener('seeked', state.seekedHandler);
    state.seekedHandler = null;
  }
}

function handlePlayFailure(error: { name?: string }): void {
  if (error.name === 'AbortError') return;

  videoEditorLogger.error('Play failed:', error);
  useVideoEditorStore.getState().setIsPlaying(false);
}

function playVideoIfPaused(video: HTMLVideoElement, controls: PlaybackControls): void {
  if (!video.paused) return;

  video.play().catch(error => {
    handlePlayFailure(error);
    controls.stopRAFLoop();
  });
}

function startSyncedPlayback(
  video: HTMLVideoElement,
  controls: PlaybackControls,
  state: PlaybackStartState,
): void {
  if (state.cancelled || state.hasStartedPlayback) return;

  state.hasStartedPlayback = true;
  clearPlaybackFallbackTimer(state);
  playVideoIfPaused(video, controls);
  controls.startRAFLoop();
}

function isVideoAtTargetTime(video: HTMLVideoElement, targetTimeSec: number): boolean {
  return Math.abs(video.currentTime - targetTimeSec) <= 0.001;
}

function startPlaybackAfterSeek({
  video,
  targetTimeSec,
  state,
  startPlayback,
}: {
  video: HTMLVideoElement;
  targetTimeSec: number;
  state: PlaybackStartState;
  startPlayback: () => void;
}): void {
  state.seekedHandler = () => {
    state.seekedHandler = null;
    startPlayback();
  };
  video.addEventListener('seeked', state.seekedHandler, { once: true });
  video.currentTime = targetTimeSec;
  state.fallbackTimerId = setTimeout(() => {
    if (!state.cancelled) {
      startPlayback();
    }
  }, PLAYBACK_SEEK_START_FALLBACK_MS);

  if (isVideoAtTargetTime(video, targetTimeSec)) {
    removePlaybackSeekedHandler(video, state);
    startPlayback();
  }
}

function pauseSyncedPlayback(video: HTMLVideoElement, controls: PlaybackControls): void {
  if (!video.paused) {
    video.pause();
  }
  controls.stopRAFLoop();
}

function cleanupPlaybackStart(video: HTMLVideoElement, state: PlaybackStartState): void {
  state.cancelled = true;
  clearPlaybackFallbackTimer(state);
  removePlaybackSeekedHandler(video, state);
}

function getOtherAudioTrack(
  masterAudio: HTMLAudioElement,
  systemAudio: HTMLAudioElement | null,
  micAudio: HTMLAudioElement | null,
): HTMLAudioElement | null {
  return masterAudio === systemAudio ? micAudio : systemAudio;
}

function syncAudioToVideoIfInValidSegment({
  video,
  masterAudio,
  systemAudio,
  micAudio,
}: {
  video: HTMLVideoElement;
  masterAudio: HTMLAudioElement;
  systemAudio: HTMLAudioElement | null;
  micAudio: HTMLAudioElement | null;
}): boolean {
  const segments = useVideoEditorStore.getState().project?.timeline.segments;
  const videoInValidSegment = segments
    ? findSegmentAtSourceTime(video.currentTime * 1000, segments)
    : null;

  if (!videoInValidSegment) {
    return false;
  }

  masterAudio.currentTime = video.currentTime;
  const otherAudio = getOtherAudioTrack(masterAudio, systemAudio, micAudio);
  if (otherAudio) {
    otherAudio.currentTime = video.currentTime;
  }
  return true;
}

function shouldSkipPausedVideoSeek(previewTimeMs: number | null): boolean {
  return previewTimeMs !== null && useVideoEditorStore.getState().hoveredTrack !== null;
}

function canSeekPausedVideo(
  video: HTMLVideoElement | null,
  isPlaying: boolean,
  previewTimeMs: number | null,
): video is HTMLVideoElement {
  if (!video || isPlaying) {
    return false;
  }

  return !shouldSkipPausedVideoSeek(previewTimeMs);
}

function getPausedVideoTargetTimeSec(
  previewTimeMs: number | null,
  currentTimeMs: number,
  getSourceTime: (timelineTimeMs: number) => number,
): number {
  const timelineTime = previewTimeMs !== null ? previewTimeMs : currentTimeMs;
  return getSourceTime(timelineTime) / 1000;
}

function seekVideoIfNeeded(video: HTMLVideoElement, targetSec: number): void {
  if (Math.abs(video.currentTime - targetSec) < 0.001) return;

  video.currentTime = targetSec;
}

function shouldSkipTimelineSeekWhileDragging(isPlaying: boolean) {
  return !isPlaying && useVideoEditorStore.getState().isDraggingPlayhead;
}

function getTimelineSeekState({
  previewTimeMs,
  currentTimeMs,
  isPlaying,
  getSourceTime,
  lastSeekToken,
  lastSeekTokenRef,
}: {
  previewTimeMs: number | null;
  currentTimeMs: number;
  isPlaying: boolean;
  getSourceTime: (timelineTimeMs: number) => number;
  lastSeekToken: number;
  lastSeekTokenRef: React.MutableRefObject<number>;
}) {
  const timelineTime = getPreviewTimelineTime(isPlaying, previewTimeMs, currentTimeMs);
  const sourceTimeSec = getSourceTime(timelineTime) / 1000;
  const seekTokenChanged = lastSeekTokenRef.current !== lastSeekToken;
  if (seekTokenChanged) {
    lastSeekTokenRef.current = lastSeekToken;
  }

  return { sourceTimeSec, seekTokenChanged };
}

function applyMediaTimelineSeek({
  refs,
  sourceTimeSec,
  isPlaying,
  seekTokenChanged,
}: {
  refs: Pick<PlaybackSyncOptions, 'videoRef' | 'systemAudioRef' | 'micAudioRef'>;
  sourceTimeSec: number;
  isPlaying: boolean;
  seekTokenChanged: boolean;
}) {
  syncVideoForSeekToken(refs.videoRef.current, sourceTimeSec, seekTokenChanged);
  syncAudioForTimelineSeek(refs.systemAudioRef.current, sourceTimeSec, isPlaying, seekTokenChanged);
  syncAudioForTimelineSeek(refs.micAudioRef.current, sourceTimeSec, isPlaying, seekTokenChanged);
}

function syncMediaForTimelineSeek({
  previewTimeMs,
  currentTimeMs,
  isPlaying,
  getSourceTime,
  lastSeekToken,
  lastSeekTokenRef,
  refs,
}: {
  previewTimeMs: number | null;
  currentTimeMs: number;
  isPlaying: boolean;
  getSourceTime: (timelineTimeMs: number) => number;
  lastSeekToken: number;
  lastSeekTokenRef: React.MutableRefObject<number>;
  refs: Pick<PlaybackSyncOptions, 'videoRef' | 'systemAudioRef' | 'micAudioRef'>;
}) {
  if (shouldSkipTimelineSeekWhileDragging(isPlaying)) return;

  const { sourceTimeSec, seekTokenChanged } = getTimelineSeekState({
    previewTimeMs,
    currentTimeMs,
    isPlaying,
    getSourceTime,
    lastSeekToken,
    lastSeekTokenRef,
  });

  if (shouldSkipPreviewAudioSeek(isPlaying, previewTimeMs, seekTokenChanged)) return;

  applyMediaTimelineSeek({ refs, sourceTimeSec, isPlaying, seekTokenChanged });
}

function syncVideoClockToAudioMaster({
  video,
  masterAudio,
  systemAudio,
  micAudio,
}: {
  video: HTMLVideoElement;
  masterAudio: HTMLAudioElement;
  systemAudio: HTMLAudioElement | null;
  micAudio: HTMLAudioElement | null;
}) {
  const driftSec = masterAudio.currentTime - video.currentTime;
  if (Math.abs(driftSec) <= PLAYBACK_AUDIO_RESYNC_THRESHOLD_SEC) return;

  const syncedAudioToVideo = syncAudioToVideoIfInValidSegment({
    video,
    masterAudio,
    systemAudio,
    micAudio,
  });
  if (syncedAudioToVideo) return;

  video.currentTime = masterAudio.currentTime;
}

function startAudioMasterClockSync({
  video,
  masterAudio,
  refs,
}: {
  video: HTMLVideoElement;
  masterAudio: HTMLAudioElement;
  refs: Pick<PlaybackSyncOptions, 'systemAudioRef' | 'micAudioRef'>;
}) {
  const handleTimeUpdate = () => {
    syncVideoClockToAudioMaster({
      video,
      masterAudio,
      systemAudio: refs.systemAudioRef.current,
      micAudio: refs.micAudioRef.current,
    });
  };

  masterAudio.addEventListener('timeupdate', handleTimeUpdate);
  return () => masterAudio.removeEventListener('timeupdate', handleTimeUpdate);
}

function getAudioMasterSyncElements({
  isPlaying,
  video,
  systemAudio,
  micAudio,
}: {
  isPlaying: boolean;
  video: HTMLVideoElement | null;
  systemAudio: HTMLAudioElement | null;
  micAudio: HTMLAudioElement | null;
}) {
  if (!canSyncToAudioMaster(isPlaying, video)) return null;

  const masterAudio = getMasterAudioElement(systemAudio, micAudio);
  return masterAudio ? { video, masterAudio } : null;
}

function canSyncToAudioMaster(
  isPlaying: boolean,
  video: HTMLVideoElement | null,
): video is HTMLVideoElement {
  return isPlaying && video !== null;
}

function getMasterAudioElement(
  systemAudio: HTMLAudioElement | null,
  micAudio: HTMLAudioElement | null,
) {
  return systemAudio ?? micAudio;
}

function clampNullableTime(timeMs: number | null, maxTimeMs: number) {
  return timeMs === null ? null : Math.min(timeMs, maxTimeMs);
}

function getDurationReconciledExportRange(
  state: VideoEditorState,
  effectiveDurationMs: number
) {
  const exportInPointMs = clampNullableTime(state.exportInPointMs, effectiveDurationMs);
  const exportOutPointMs = state.exportOutPointMs === null
    ? null
    : Math.max(
        exportInPointMs ?? 0,
        Math.min(state.exportOutPointMs, effectiveDurationMs),
      );

  return { exportInPointMs, exportOutPointMs };
}

function getDurationReconciledState(state: VideoEditorState, actualDurationMs: number) {
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
  const exportRange = getDurationReconciledExportRange(state, effectiveDurationMs);

  return {
    project: nextProject,
    currentTimeMs: Math.min(state.currentTimeMs, effectiveDurationMs),
    previewTimeMs: clampNullableTime(state.previewTimeMs, effectiveDurationMs),
    exportInPointMs: exportRange.exportInPointMs,
    exportOutPointMs: exportRange.exportOutPointMs,
  };
}

function getIOLoopBounds({
  project,
  exportInPointMs,
  exportOutPointMs,
}: {
  project: VideoEditorProject;
  exportInPointMs: number | null;
  exportOutPointMs: number | null;
}) {
  const effectiveDurationMs = getProjectEffectiveLoopDuration(project);
  const loopStartMs = exportInPointMs ?? 0;
  const loopEndMs = exportOutPointMs ?? effectiveDurationMs;
  return hasValidIOLoopBounds(loopStartMs, loopEndMs) ? { loopStartMs, loopEndMs } : null;
}

function getProjectEffectiveLoopDuration(project: VideoEditorProject) {
  return getEffectiveDuration(project.timeline.segments ?? [], project.timeline.durationMs);
}

function hasValidIOLoopBounds(loopStartMs: number, loopEndMs: number) {
  return loopEndMs > loopStartMs;
}

function getActiveIOLoopBounds(
  exportInPointMs: number | null,
  exportOutPointMs: number | null,
) {
  const project = useVideoEditorStore.getState().project;
  return project ? getIOLoopBounds({ project, exportInPointMs, exportOutPointMs }) : null;
}

function getEmbeddedVideoVolume(audioConfig: AudioTrackSettings) {
  return audioConfig.systemMuted ? 0 : audioConfig.systemVolume;
}

function applyMainVideoVolume({
  video,
  audioConfig,
  hasSeparateAudio,
}: {
  video: HTMLVideoElement | null;
  audioConfig: AudioTrackSettings | undefined;
  hasSeparateAudio: boolean;
}) {
  if (!video || !audioConfig) return;

  if (hasSeparateAudio) {
    video.volume = 0;
    videoEditorLogger.debug(`[Audio] Main video muted (using separate audio files)`);
    return;
  }

  const newVolume = getEmbeddedVideoVolume(audioConfig);
  video.volume = newVolume;
  videoEditorLogger.debug(`[Audio] Main video volume set to ${newVolume} (embedded audio)`);
}

function applyAudioElementVolume({
  audio,
  audioConfig,
  label,
}: {
  audio: HTMLAudioElement | null;
  audioConfig: AudioTrackSettings | undefined;
  label: string;
}) {
  if (!audio || !audioConfig) return;

  const newVolume = audioConfig.systemMuted ? 0 : audioConfig.systemVolume;
  audio.volume = newVolume;
  videoEditorLogger.debug(`[Audio] ${label} audio volume set to ${newVolume}`);
}

function applyMicAudioElementVolume({
  audio,
  audioConfig,
}: {
  audio: HTMLAudioElement | null;
  audioConfig: AudioTrackSettings | undefined;
}) {
  if (!audio || !audioConfig) return;

  const newVolume = audioConfig.microphoneMuted ? 0 : audioConfig.microphoneVolume;
  audio.volume = newVolume;
  videoEditorLogger.debug(`[Audio] Mic audio volume set to ${newVolume}`);
}

function setMediaSourceTime(
  sourceTimeSec: number,
  refs: Pick<PlaybackSyncOptions, 'videoRef' | 'systemAudioRef' | 'micAudioRef'>,
) {
  const mediaElements = [
    refs.videoRef.current,
    refs.systemAudioRef.current,
    refs.micAudioRef.current,
  ];

  for (const media of mediaElements) {
    if (!media) continue;
    media.currentTime = sourceTimeSec;
  }
}

function isVideoAtNaturalEnd(video: HTMLVideoElement) {
  const atDuration = Number.isFinite(video.duration)
    && video.duration > 0
    && video.currentTime >= video.duration - 0.05;

  return video.ended || atDuration;
}

function playAudioAtSourceTime(audio: HTMLAudioElement, sourceTimeSec: number) {
  audio.currentTime = sourceTimeSec;
  audio.play().catch(e => {
    // AbortError is expected when pause() interrupts a pending play()
    if (e.name !== 'AbortError') {
      videoEditorLogger.warn('Audio play failed:', e);
    }
  });
}

function syncAudioPlaybackState({
  isPlaying,
  sourceTimeSec,
  systemAudio,
  micAudio,
}: {
  isPlaying: boolean;
  sourceTimeSec: number;
  systemAudio: HTMLAudioElement | null;
  micAudio: HTMLAudioElement | null;
}) {
  const audioElements = [systemAudio, micAudio].filter(
    (audio): audio is HTMLAudioElement => audio !== null
  );
  audioElements.forEach((audio) => syncSingleAudioPlaybackState(audio, isPlaying, sourceTimeSec));
}

function syncSingleAudioPlaybackState(
  audio: HTMLAudioElement,
  isPlaying: boolean,
  sourceTimeSec: number
) {
  if (isPlaying) {
    playAudioAtSourceTime(audio, sourceTimeSec);
    return;
  }

  audio.pause();
}

function shouldWrapIOLoop(currentTimeMs: number, loopEndMs: number) {
  return currentTimeMs >= loopEndMs - IO_LOOP_WRAP_LOOKAHEAD_MS;
}

function wrapIOLoopPlayback({
  loopStartMs,
  setCurrentTime,
  getSourceTime,
  refs,
}: {
  loopStartMs: number;
  setCurrentTime: (timeMs: number) => void;
  getSourceTime: (timelineTimeMs: number) => number;
  refs: Pick<PlaybackSyncOptions, 'videoRef' | 'systemAudioRef' | 'micAudioRef'>;
}) {
  const loopStartSourceSec = getSourceTime(loopStartMs) / 1000;
  setMediaSourceTime(loopStartSourceSec, refs);
  setCurrentTime(loopStartMs);
}

function startIOLoopBoundaryWatcher({
  loopBounds,
  getSourceTime,
  refs,
}: {
  loopBounds: { loopStartMs: number; loopEndMs: number };
  getSourceTime: (timelineTimeMs: number) => number;
  refs: Pick<PlaybackSyncOptions, 'videoRef' | 'systemAudioRef' | 'micAudioRef'>;
}) {
  let rafId: number | null = null;

  const tick = () => {
    const { currentTimeMs, setCurrentTime } = useVideoEditorStore.getState();
    if (shouldWrapIOLoop(currentTimeMs, loopBounds.loopEndMs)) {
      wrapIOLoopPlayback({
        loopStartMs: loopBounds.loopStartMs,
        setCurrentTime,
        getSourceTime,
        refs,
      });
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  };
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
  const isIOLoopEnabled = useVideoEditorStore(selectIsIOLoopEnabled);
  const exportInPointMs = useVideoEditorStore(selectExportInPointMs);
  const exportOutPointMs = useVideoEditorStore(selectExportOutPointMs);
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

      useVideoEditorStore.setState((state) => getDurationReconciledState(state, actualDurationMs));
    };

    const snapToEnd = () => {
      controls.stopRAFLoop();
      const state = useVideoEditorStore.getState();
      const segments = state.project?.timeline.segments;
      const sourceDuration = state.project?.timeline.durationMs ?? 0;
      const endTime = segments && segments.length > 0
        ? getEffectiveDuration(segments, sourceDuration)
        : sourceDuration;
      state.setCurrentTime(endTime);
      state.setIsPlaying(false);
    };

    const onEnded = () => {
      // Snap playhead to the exact end — the browser fires `ended` before the
      // next RAF callback, so the RAF loop never reads the final position.
      snapToEnd();
    };

    // Safety net: if the video naturally stops at end (e.g. `ended` didn't
    // fire because the element was muted alongside separate audio tracks),
    // make sure the store still flips isPlaying → false so the play button
    // resets and clicking it restarts from the start. We can't require
    // `video.ended` here because some builds pause at duration without
    // setting that flag — fall back to a position-based check.
    const onPause = () => {
      if (!useVideoEditorStore.getState().isPlaying) return;
      if (!isVideoAtNaturalEnd(video)) return;
      snapToEnd();
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
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);
    video.addEventListener('loadeddata', onLoadedData);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadeddata', onLoadedData);
    };
  }, [controls, audioConfig, hasSeparateAudio, onVideoError, videoRef]);

  // Sync play/pause state from store to video element and RAF loop
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playbackStartState: PlaybackStartState = {
      cancelled: false,
      seekedHandler: null,
      fallbackTimerId: null,
      hasStartedPlayback: false,
    };
    const startPlayback = () => startSyncedPlayback(video, controls, playbackStartState);

    if (isPlaying) {
      const playheadTime = useVideoEditorStore.getState().currentTimeMs;
      const sourceTime = getSourceTime(playheadTime);
      const targetTimeSec = sourceTime / 1000;
      const needsSeek = Math.abs(video.currentTime - targetTimeSec) > 0.001;

      if (needsSeek) {
        startPlaybackAfterSeek({ video, targetTimeSec, state: playbackStartState, startPlayback });
      } else {
        startPlayback();
      }
    } else {
      pauseSyncedPlayback(video, controls);
    }

    return () => cleanupPlaybackStart(video, playbackStartState);
  }, [isPlaying, controls, getSourceTime, videoRef]);

  // Apply volume settings to main video element
  useEffect(() => {
    applyMainVideoVolume({
      video: videoRef.current,
      audioConfig,
      hasSeparateAudio,
    });
  }, [audioConfig, hasSeparateAudio, videoRef]);

  // Apply volume settings to system audio element
  useEffect(() => {
    applyAudioElementVolume({
      audio: systemAudioRef.current,
      audioConfig,
      label: 'System',
    });
  }, [audioConfig, systemAudioRef]);

  // Apply volume settings to microphone audio element
  useEffect(() => {
    applyMicAudioElementVolume({
      audio: micAudioRef.current,
      audioConfig,
    });
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
    const playheadTime = useVideoEditorStore.getState().currentTimeMs;
    const sourceTimeSec = getSourceTime(playheadTime) / 1000;
    syncAudioPlaybackState({ isPlaying, sourceTimeSec, systemAudio, micAudio });
  }, [isPlaying, getSourceTime, micAudioRef, systemAudioRef]);

  // Seek audio when preview time or current time changes.
  // Skip seeking when hovering over tracks (hoveredTrack !== null) since that's
  // just for segment preview indicators — only seek when scrubbing the ruler.
  // Also skip during playhead drag to avoid scrub lag from repeated audio seeks.
  useEffect(() => {
    // Skip audio seeking during playhead drag — it's the main source of scrub lag.
    syncMediaForTimelineSeek({
      previewTimeMs,
      currentTimeMs,
      isPlaying,
      getSourceTime,
      lastSeekToken,
      lastSeekTokenRef,
      refs: { videoRef, systemAudioRef, micAudioRef },
    });
  }, [previewTimeMs, currentTimeMs, isPlaying, getSourceTime, lastSeekToken, micAudioRef, systemAudioRef, videoRef]);

  // While playing, keep video clock aligned to audio (audio is master).
  useEffect(() => {
    const syncElements = getAudioMasterSyncElements({
      isPlaying,
      video: videoRef.current,
      systemAudio: systemAudioRef.current,
      micAudio: micAudioRef.current,
    });
    if (!syncElements) return;

    return startAudioMasterClockSync({
      video: syncElements.video,
      masterAudio: syncElements.masterAudio,
      refs: { systemAudioRef, micAudioRef },
    });
  }, [isPlaying, systemAudioRef, micAudioRef, videoRef]);

  // Loop IO ranges directly on media elements to avoid an audio stutter from
  // routing every boundary wrap through the heavier request-seek path.
  useEffect(() => {
    if (!isPlaying || !isIOLoopEnabled) return;

    const loopBounds = getActiveIOLoopBounds(exportInPointMs, exportOutPointMs);
    if (!loopBounds) return;

    return startIOLoopBoundaryWatcher({
      loopBounds,
      getSourceTime,
      refs: { videoRef, systemAudioRef, micAudioRef },
    });
  }, [
    exportInPointMs,
    exportOutPointMs,
    getSourceTime,
    isIOLoopEnabled,
    isPlaying,
    micAudioRef,
    systemAudioRef,
    videoRef,
  ]);

  // Seek video when preview time or current time changes.
  // Skip seeking when hovering over tracks — only seek for ruler scrubbing or playhead changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!canSeekPausedVideo(video, isPlaying, previewTimeMs)) return;

    const targetSec = getPausedVideoTargetTimeSec(previewTimeMs, currentTimeMs, getSourceTime);
    seekVideoIfNeeded(video, targetSec);
  }, [previewTimeMs, currentTimeMs, isPlaying, getSourceTime, videoRef]);

  const handleVideoClick = useCallback(() => {
    controls.toggle();
  }, [controls]);

  return {
    controls,
    handleVideoClick,
  };
}
