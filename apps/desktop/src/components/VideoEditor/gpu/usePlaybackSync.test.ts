import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackSync } from './usePlaybackSync';

const {
  mockControls,
  mockState,
  mockUseVideoEditorStore,
} = vi.hoisted(() => {
  const state = {
    currentTimeMs: 4200,
    previewTimeMs: null as number | null,
    isPlaying: true,
    lastSeekToken: 0,
    hoveredTrack: null as string | null,
    project: {
      timeline: {
        durationMs: 10000,
        segments: [] as unknown[],
      },
    },
    exportInPointMs: null as number | null,
    exportOutPointMs: null as number | null,
    setCurrentTime: vi.fn(),
    setIsPlaying: vi.fn(),
  };

  const controls = {
    setVideoElement: vi.fn(),
    setDuration: vi.fn(),
    startRAFLoop: vi.fn(),
    stopRAFLoop: vi.fn(),
    toggle: vi.fn(),
  };

  const useStore = Object.assign(
    (selector: (store: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
      setState: (partial: Partial<typeof state>) => Object.assign(state, partial),
    }
  );

  return {
    mockControls: controls,
    mockState: state,
    mockUseVideoEditorStore: useStore,
  };
});

vi.mock('../../../hooks/usePlaybackEngine', () => ({
  usePlaybackControls: () => mockControls,
  initPlaybackEngine: vi.fn(),
}));

vi.mock('../../../hooks/useTimelineSourceTime', () => ({
  useTimelineToSourceTime: () => (timelineTimeMs: number) => timelineTimeMs,
}));

vi.mock('../../../stores/videoEditorStore', () => ({
  useVideoEditorStore: mockUseVideoEditorStore,
  findSegmentAtSourceTime: vi.fn(() => null),
  getEffectiveDuration: vi.fn(() => 10000),
  sourceToTimeline: vi.fn((sourceTimeMs: number) => sourceTimeMs),
}));

vi.mock('../../../utils/logger', () => ({
  videoEditorLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function setWindowState(hasFocus: boolean, visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  });
  documentHasFocusMock.mockReturnValue(hasFocus);
}

function createMediaElement<T extends HTMLMediaElement>() {
  const element = document.createElement('video') as T;
  let paused = true;

  Object.defineProperty(element, 'paused', {
    configurable: true,
    get: () => paused,
  });

  Object.defineProperty(element, 'duration', {
    configurable: true,
    writable: true,
    value: 10,
  });

  element.currentTime = 0;
  element.play = vi.fn().mockImplementation(async () => {
    paused = false;
  });
  element.pause = vi.fn().mockImplementation(() => {
    paused = true;
  });

  return {
    element,
    setPaused: (value: boolean) => {
      paused = value;
    },
  };
}

const documentHasFocusMock = vi.fn<() => boolean>(() => true);

describe('usePlaybackSync playback interruption handling', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: documentHasFocusMock,
    });
    setWindowState(true, 'visible');

    mockState.currentTimeMs = 4200;
    mockState.previewTimeMs = null;
    mockState.isPlaying = true;
    mockState.lastSeekToken = 0;
    mockState.hoveredTrack = null;
    mockState.project = {
      timeline: {
        durationMs: 10000,
        segments: [],
      },
    };
    mockState.setCurrentTime.mockReset();
    mockState.setIsPlaying.mockReset();
    mockState.setCurrentTime.mockImplementation((timeMs: number) => {
      mockState.currentTimeMs = timeMs;
    });
    mockState.setIsPlaying.mockImplementation((isPlaying: boolean) => {
      mockState.isPlaying = isPlaying;
    });

    mockControls.setVideoElement.mockReset();
    mockControls.setDuration.mockReset();
    mockControls.startRAFLoop.mockReset();
    mockControls.stopRAFLoop.mockReset();
    mockControls.toggle.mockReset();
  });

  it('does not pause playback when the document becomes hidden by itself', async () => {
    const video = createMediaElement<HTMLVideoElement>();
    const systemAudio = createMediaElement<HTMLAudioElement>();
    const micAudio = createMediaElement<HTMLAudioElement>();

    renderHook(() =>
      usePlaybackSync({
        videoRef: { current: video.element },
        systemAudioRef: { current: systemAudio.element },
        micAudioRef: { current: micAudio.element },
        videoSrc: '/video.mp4',
        systemAudioSrc: '/system.wav',
        micAudioSrc: '/mic.wav',
        audioConfig: {
          systemMuted: false,
          systemVolume: 1,
          microphoneMuted: false,
          microphoneVolume: 1,
        },
        durationMs: 10000,
        isPlaying: true,
        previewTimeMs: null,
        currentTimeMs: 4200,
        onVideoError: vi.fn(),
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    mockState.setIsPlaying.mockClear();
    mockControls.stopRAFLoop.mockClear();
    (video.element.pause as ReturnType<typeof vi.fn>).mockClear();
    (systemAudio.element.pause as ReturnType<typeof vi.fn>).mockClear();
    (micAudio.element.pause as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      setWindowState(false, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockControls.stopRAFLoop).not.toHaveBeenCalled();
    expect(mockState.setIsPlaying).not.toHaveBeenCalledWith(false);
    expect(video.element.pause).not.toHaveBeenCalled();
    expect(systemAudio.element.pause).not.toHaveBeenCalled();
    expect(micAudio.element.pause).not.toHaveBeenCalled();
  });

  it('does not pause playback when the window loses focus by itself', async () => {
    const video = createMediaElement<HTMLVideoElement>();
    const systemAudio = createMediaElement<HTMLAudioElement>();
    const micAudio = createMediaElement<HTMLAudioElement>();

    video.setPaused(false);
    systemAudio.setPaused(false);
    micAudio.setPaused(false);
    video.element.currentTime = 7.25;
    systemAudio.element.currentTime = 7.25;
    micAudio.element.currentTime = 7.25;

    renderHook(() =>
      usePlaybackSync({
        videoRef: { current: video.element },
        systemAudioRef: { current: systemAudio.element },
        micAudioRef: { current: micAudio.element },
        videoSrc: '/video.mp4',
        systemAudioSrc: '/system.wav',
        micAudioSrc: '/mic.wav',
        audioConfig: {
          systemMuted: false,
          systemVolume: 1,
          microphoneMuted: false,
          microphoneVolume: 1,
        },
        durationMs: 10000,
        isPlaying: true,
        previewTimeMs: null,
        currentTimeMs: 4200,
        onVideoError: vi.fn(),
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    mockState.setIsPlaying.mockClear();
    mockControls.stopRAFLoop.mockClear();
    (video.element.pause as ReturnType<typeof vi.fn>).mockClear();
    (systemAudio.element.pause as ReturnType<typeof vi.fn>).mockClear();
    (micAudio.element.pause as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(mockState.setIsPlaying).not.toHaveBeenCalledWith(false);
    expect(mockControls.stopRAFLoop).not.toHaveBeenCalled();
    expect(video.element.pause).not.toHaveBeenCalled();
    expect(systemAudio.element.pause).not.toHaveBeenCalled();
    expect(micAudio.element.pause).not.toHaveBeenCalled();
  });

  it('clears playback state when the video pauses unexpectedly while the window stays visible', async () => {
    const video = createMediaElement<HTMLVideoElement>();
    const systemAudio = createMediaElement<HTMLAudioElement>();
    const micAudio = createMediaElement<HTMLAudioElement>();

    renderHook(() =>
      usePlaybackSync({
        videoRef: { current: video.element },
        systemAudioRef: { current: systemAudio.element },
        micAudioRef: { current: micAudio.element },
        videoSrc: '/video.mp4',
        systemAudioSrc: '/system.wav',
        micAudioSrc: '/mic.wav',
        audioConfig: {
          systemMuted: false,
          systemVolume: 1,
          microphoneMuted: false,
          microphoneVolume: 1,
        },
        durationMs: 10000,
        isPlaying: true,
        previewTimeMs: null,
        currentTimeMs: 4200,
        onVideoError: vi.fn(),
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    setWindowState(true, 'visible');
    video.setPaused(true);
    systemAudio.setPaused(false);
    micAudio.setPaused(false);
    mockState.setIsPlaying.mockClear();
    mockControls.stopRAFLoop.mockClear();
    (systemAudio.element.pause as ReturnType<typeof vi.fn>).mockClear();
    (micAudio.element.pause as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      video.element.dispatchEvent(new Event('pause'));
    });

    expect(mockState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(mockControls.stopRAFLoop).toHaveBeenCalled();
    expect(systemAudio.element.pause).toHaveBeenCalled();
    expect(micAudio.element.pause).toHaveBeenCalled();
  });

  it('ignores duplicate pause cleanup once playback has already been cleared', async () => {
    const video = createMediaElement<HTMLVideoElement>();
    const systemAudio = createMediaElement<HTMLAudioElement>();
    const micAudio = createMediaElement<HTMLAudioElement>();

    renderHook(() =>
      usePlaybackSync({
        videoRef: { current: video.element },
        systemAudioRef: { current: systemAudio.element },
        micAudioRef: { current: micAudio.element },
        videoSrc: '/video.mp4',
        systemAudioSrc: '/system.wav',
        micAudioSrc: '/mic.wav',
        audioConfig: {
          systemMuted: false,
          systemVolume: 1,
          microphoneMuted: false,
          microphoneVolume: 1,
        },
        durationMs: 10000,
        isPlaying: true,
        previewTimeMs: null,
        currentTimeMs: 4200,
        onVideoError: vi.fn(),
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    mockState.setIsPlaying.mockClear();
    mockControls.stopRAFLoop.mockClear();

    act(() => {
      video.element.dispatchEvent(new Event('pause'));
      video.element.dispatchEvent(new Event('pause'));
    });

    expect(mockState.setIsPlaying).toHaveBeenCalledTimes(1);
    expect(mockState.setIsPlaying).toHaveBeenCalledWith(false);
    expect(mockControls.stopRAFLoop).toHaveBeenCalledTimes(1);
  });
});
