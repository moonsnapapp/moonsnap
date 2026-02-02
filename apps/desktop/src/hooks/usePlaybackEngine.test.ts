import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  usePlaybackControls,
  usePlaybackTime,
  usePreviewOrPlaybackTime,
  initPlaybackEngine,
  resetPlaybackEngine,
  getPlaybackState,
} from './usePlaybackEngine';
import { useVideoEditorStore } from '../stores/videoEditorStore';
import type { VideoProject } from '../types';

// Helper to create a minimal test project
function createTestProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: 'test-project-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Test Project',
    sources: {
      screenVideo: '/path/to/video.mp4',
      originalWidth: 1920,
      originalHeight: 1080,
      webcamVideo: null,
      cursorData: null,
      audioFile: null,
    },
    timeline: {
      durationMs: 10000, // 10 seconds
      inPoint: 0,
      outPoint: 10000,
      speed: 1.0,
    },
    zoom: {
      enabled: false,
      regions: [],
      autoZoom: null,
    },
    cursor: {
      visible: true,
      scale: 1.0,
      highlightClicks: false,
      clickRingColor: '#ff0000',
      clickRingOpacity: 0.8,
      clickRingSize: 40,
      clickRingDuration: 300,
      smoothing: 0.5,
    },
    webcam: {
      enabled: false,
      position: 'bottom-right',
      size: 25,
      shape: 'circle',
      borderWidth: 3,
      borderColor: '#ffffff',
      shadowEnabled: true,
      visibilitySegments: [],
    },
    audio: {
      screenVolume: 1.0,
      micVolume: 1.0,
      masterVolume: 1.0,
      muted: false,
    },
    export: {
      preset: 'high',
      format: 'mp4',
      resolution: '1080p',
      frameRate: 30,
      customWidth: null,
      customHeight: null,
    },
    scene: {
      segments: [],
    },
    text: {
      segments: [],
    },
    mask: {
      segments: [],
    },
    ...overrides,
  };
}

// Get initial state for reset
const getInitialPlaybackState = () => ({
  currentTimeMs: 0,
  currentFrame: 0,
  isPlaying: false,
  renderedFrame: null,
  previewTimeMs: null,
});

describe('usePlaybackEngine', () => {
  beforeEach(() => {
    // Reset store state before each test
    useVideoEditorStore.setState({
      ...getInitialPlaybackState(),
      project: null,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('usePlaybackTime', () => {
    it('should return current time from store', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project, currentTimeMs: 5000 });

      const { result } = renderHook(() => usePlaybackTime());
      expect(result.current).toBe(5000);
    });

    it('should update when store changes', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project, currentTimeMs: 0 });

      const { result } = renderHook(() => usePlaybackTime());
      expect(result.current).toBe(0);

      act(() => {
        useVideoEditorStore.getState().setCurrentTime(3000);
      });

      expect(result.current).toBe(3000);
    });
  });

  describe('usePreviewOrPlaybackTime', () => {
    it('should return current time when no preview', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({
        project,
        currentTimeMs: 5000,
        previewTimeMs: null,
      });

      const { result } = renderHook(() => usePreviewOrPlaybackTime());
      expect(result.current).toBe(5000);
    });

    it('should return preview time when set', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({
        project,
        currentTimeMs: 5000,
        previewTimeMs: 2000,
      });

      const { result } = renderHook(() => usePreviewOrPlaybackTime());
      expect(result.current).toBe(2000);
    });
  });

  describe('usePlaybackControls', () => {
    it('should provide stable function references', () => {
      const { result, rerender } = renderHook(() => usePlaybackControls());

      const firstPlay = result.current.play;
      const firstPause = result.current.pause;
      const firstSeek = result.current.seek;
      const firstToggle = result.current.toggle;

      rerender();

      expect(result.current.play).toBe(firstPlay);
      expect(result.current.pause).toBe(firstPause);
      expect(result.current.seek).toBe(firstSeek);
      expect(result.current.toggle).toBe(firstToggle);
    });

    describe('play', () => {
      it('should set isPlaying to true in store', () => {
        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.play();
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(true);
      });

      it('should not double-play if already playing', () => {
        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.play();
          result.current.play(); // Second call should be no-op
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(true);
      });
    });

    describe('pause', () => {
      it('should set isPlaying to false in store', () => {
        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.play();
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(true);

        act(() => {
          result.current.pause();
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(false);
      });

      it('should not double-pause if already paused', () => {
        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.pause(); // Already paused, should be no-op
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(false);
      });
    });

    describe('toggle', () => {
      it('should toggle from paused to playing', () => {
        const { result } = renderHook(() => usePlaybackControls());

        expect(useVideoEditorStore.getState().isPlaying).toBe(false);

        act(() => {
          result.current.toggle();
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(true);
      });

      it('should toggle from playing to paused', () => {
        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.play();
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(true);

        act(() => {
          result.current.toggle();
        });

        expect(useVideoEditorStore.getState().isPlaying).toBe(false);
      });
    });

    describe('seek', () => {
      it('should update current time in store', () => {
        const project = createTestProject();
        useVideoEditorStore.setState({ project });

        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.seek(5000);
        });

        expect(useVideoEditorStore.getState().currentTimeMs).toBe(5000);
      });

      it('should clamp seek time to 0 minimum', () => {
        const project = createTestProject();
        useVideoEditorStore.setState({ project });

        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.seek(-1000);
        });

        expect(useVideoEditorStore.getState().currentTimeMs).toBe(0);
      });

      it('should clamp seek time to duration maximum', () => {
        const project = createTestProject({
          timeline: {
            durationMs: 10000,
            inPoint: 0,
            outPoint: 10000,
            speed: 1.0,
          },
        });
        useVideoEditorStore.setState({ project });

        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.seek(15000);
        });

        expect(useVideoEditorStore.getState().currentTimeMs).toBe(10000);
      });

      it('should update video element currentTime when set', () => {
        const project = createTestProject();
        useVideoEditorStore.setState({ project });

        const mockVideo = {
          currentTime: 0,
        } as HTMLVideoElement;

        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.setVideoElement(mockVideo);
          result.current.seek(5000);
        });

        expect(mockVideo.currentTime).toBe(5);
      });
    });

    describe('setVideoElement', () => {
      it('should register video element', () => {
        const mockVideo = {
          currentTime: 0,
        } as HTMLVideoElement;

        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.setVideoElement(mockVideo);
        });

        // Verify by seeking and checking video element is updated
        const project = createTestProject();
        useVideoEditorStore.setState({ project });

        act(() => {
          result.current.seek(3000);
        });

        expect(mockVideo.currentTime).toBe(3);
      });

      it('should allow setting to null', () => {
        const mockVideo = {
          currentTime: 0,
        } as HTMLVideoElement;

        const { result } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.setVideoElement(mockVideo);
          result.current.setVideoElement(null);
        });

        // Should not throw when seeking without video element
        const project = createTestProject();
        useVideoEditorStore.setState({ project });

        act(() => {
          result.current.seek(3000);
        });

        // Store should still update
        expect(useVideoEditorStore.getState().currentTimeMs).toBe(3000);
      });
    });

    describe('isPlaying', () => {
      it('should return current playing state', () => {
        const { result } = renderHook(() => usePlaybackControls());

        expect(result.current.isPlaying()).toBe(false);

        act(() => {
          result.current.play();
        });

        expect(result.current.isPlaying()).toBe(true);
      });
    });

    describe('getCurrentTime', () => {
      it('should return current time from store', () => {
        const project = createTestProject();
        useVideoEditorStore.setState({ project, currentTimeMs: 7500 });

        const { result } = renderHook(() => usePlaybackControls());

        expect(result.current.getCurrentTime()).toBe(7500);
      });
    });

    describe('cleanup on unmount', () => {
      it('should reset engine state on unmount', () => {
        const { result, unmount } = renderHook(() => usePlaybackControls());

        act(() => {
          result.current.play();
        });

        expect(result.current.isPlaying()).toBe(true);

        unmount();

        // After unmount, engine is reset - can't check directly
        // but we verify no errors occur
      });
    });
  });

  describe('multiple instances', () => {
    it('should allow independent playback engines', () => {
      const { result: result1 } = renderHook(() => usePlaybackControls());
      const { result: result2 } = renderHook(() => usePlaybackControls());

      // Each hook instance should have its own engine
      act(() => {
        result1.current.play();
      });

      // Note: Store state is shared, but internal engine state is independent
      expect(result1.current.isPlaying()).toBe(true);
      // result2's engine is separate, so its isPlaying is independent
      expect(result2.current.isPlaying()).toBe(false);
    });
  });

  describe('initPlaybackEngine', () => {
    it('should initialize engine with duration', () => {
      initPlaybackEngine(10000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(0);
    });

    it('should initialize engine with initial time', () => {
      // setCurrentTime requires a project to be set
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      initPlaybackEngine(10000, 5000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(5000);
    });
  });

  describe('resetPlaybackEngine', () => {
    it('should reset engine state', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project, currentTimeMs: 5000 });

      resetPlaybackEngine();

      expect(useVideoEditorStore.getState().currentTimeMs).toBe(0);
    });
  });

  describe('getPlaybackState', () => {
    it('should return current playback state', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
        },
      });
      useVideoEditorStore.setState({
        project,
        currentTimeMs: 5000,
        isPlaying: true,
      });

      const state = getPlaybackState();

      expect(state.currentTimeMs).toBe(5000);
      expect(state.isPlaying).toBe(true);
      expect(state.durationMs).toBe(10000);
      expect(state.effectiveDurationMs).toBe(10000);
      expect(state.hasTrimSegments).toBe(false);
    });

    it('should return empty state when no project', () => {
      const state = getPlaybackState();

      expect(state.currentTimeMs).toBe(0);
      expect(state.isPlaying).toBe(false);
      expect(state.durationMs).toBe(0);
    });

    it('should calculate effective duration with trim segments', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
          segments: [
            { sourceStartMs: 0, sourceEndMs: 3000, timelineStartMs: 0 },
            { sourceStartMs: 5000, sourceEndMs: 10000, timelineStartMs: 3000 },
          ],
        },
      });
      useVideoEditorStore.setState({ project });

      const state = getPlaybackState();

      // Effective duration: 3000 + 5000 = 8000ms
      expect(state.effectiveDurationMs).toBe(8000);
      expect(state.hasTrimSegments).toBe(true);
    });
  });
});
