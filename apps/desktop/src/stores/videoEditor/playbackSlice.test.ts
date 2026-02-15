import { describe, it, expect, beforeEach } from 'vitest';
import { useVideoEditorStore } from './index';
import type { VideoProject } from '../../types';

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
      format: 'mp4',
      fps: 30,
      quality: 80,
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
  previewTimeMs: null as number | null,
  lastSeekToken: 0,
});

describe('playbackSlice', () => {
  beforeEach(() => {
    // Reset store state before each test
    useVideoEditorStore.setState({
      ...getInitialPlaybackState(),
      project: null,
    });
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useVideoEditorStore.getState();
      expect(state.currentTimeMs).toBe(0);
      expect(state.currentFrame).toBe(0);
      expect(state.isPlaying).toBe(false);
      expect(state.renderedFrame).toBeNull();
    });
  });

  describe('setIsPlaying', () => {
    it('should set isPlaying to true', () => {
      useVideoEditorStore.getState().setIsPlaying(true);
      expect(useVideoEditorStore.getState().isPlaying).toBe(true);
    });

    it('should set isPlaying to false', () => {
      useVideoEditorStore.getState().setIsPlaying(true);
      useVideoEditorStore.getState().setIsPlaying(false);
      expect(useVideoEditorStore.getState().isPlaying).toBe(false);
    });

    it('should clear preview time when set to playing', () => {
      useVideoEditorStore.setState({ previewTimeMs: 4200 });
      useVideoEditorStore.getState().setIsPlaying(true);
      expect(useVideoEditorStore.getState().previewTimeMs).toBeNull();
    });

    it('should restart from beginning when starting playback at end', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
          segments: [],
        },
      });

      useVideoEditorStore.setState({
        project,
        currentTimeMs: 10000,
        lastSeekToken: 3,
      });

      useVideoEditorStore.getState().setIsPlaying(true);
      const state = useVideoEditorStore.getState();
      expect(state.isPlaying).toBe(true);
      expect(state.currentTimeMs).toBe(0);
      expect(state.lastSeekToken).toBe(4);
    });
  });

  describe('togglePlayback', () => {
    it('should toggle from false to true', () => {
      expect(useVideoEditorStore.getState().isPlaying).toBe(false);
      useVideoEditorStore.setState({ previewTimeMs: 3300 });
      useVideoEditorStore.getState().togglePlayback();
      expect(useVideoEditorStore.getState().isPlaying).toBe(true);
      expect(useVideoEditorStore.getState().previewTimeMs).toBeNull();
    });

    it('should toggle from true to false', () => {
      useVideoEditorStore.getState().setIsPlaying(true);
      useVideoEditorStore.getState().togglePlayback();
      expect(useVideoEditorStore.getState().isPlaying).toBe(false);
    });

    it('should toggle multiple times correctly', () => {
      const initial = useVideoEditorStore.getState().isPlaying;
      useVideoEditorStore.getState().togglePlayback();
      expect(useVideoEditorStore.getState().isPlaying).toBe(!initial);
      useVideoEditorStore.getState().togglePlayback();
      expect(useVideoEditorStore.getState().isPlaying).toBe(initial);
    });

    it('should restart from beginning when toggling play at timeline end', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
          segments: [],
        },
      });

      useVideoEditorStore.setState({
        project,
        currentTimeMs: 10000,
        previewTimeMs: 3300,
        lastSeekToken: 10,
      });

      useVideoEditorStore.getState().togglePlayback();
      const state = useVideoEditorStore.getState();
      expect(state.isPlaying).toBe(true);
      expect(state.currentTimeMs).toBe(0);
      expect(state.previewTimeMs).toBeNull();
      expect(state.lastSeekToken).toBe(11);
    });

    it('should restart when toggling play near timeline end (threshold)', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
          segments: [],
        },
      });

      useVideoEditorStore.setState({
        project,
        currentTimeMs: 9950,
        lastSeekToken: 7,
      });

      useVideoEditorStore.getState().togglePlayback();
      const state = useVideoEditorStore.getState();
      expect(state.isPlaying).toBe(true);
      expect(state.currentTimeMs).toBe(0);
      expect(state.lastSeekToken).toBe(8);
    });

    it('should restart at end of effective trimmed duration', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
          segments: [
            { id: 'a', sourceStartMs: 0, sourceEndMs: 2000 },
            { id: 'b', sourceStartMs: 6000, sourceEndMs: 7000 },
          ],
        },
      });

      // Effective duration = 3000ms
      useVideoEditorStore.setState({
        project,
        currentTimeMs: 3000,
        lastSeekToken: 1,
      });

      useVideoEditorStore.getState().togglePlayback();
      const state = useVideoEditorStore.getState();
      expect(state.isPlaying).toBe(true);
      expect(state.currentTimeMs).toBe(0);
      expect(state.lastSeekToken).toBe(2);
    });
  });

  describe('setCurrentTime', () => {
    it('should not update time without a project', () => {
      useVideoEditorStore.getState().setCurrentTime(5000);
      // Without a project, setCurrentTime returns early
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(0);
    });

    it('should set current time with a project', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(5500);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(5500);
    });

    it('should clamp time to minimum of 0', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(-1000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(0);
    });

    it('should clamp time to maximum of project duration', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 10000,
          inPoint: 0,
          outPoint: 10000,
          speed: 1.0,
        },
      });
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(15000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(10000);
    });

    it('should allow exact duration time', () => {
      const project = createTestProject({
        timeline: {
          durationMs: 5000,
          inPoint: 0,
          outPoint: 5000,
          speed: 1.0,
        },
      });
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(5000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(5000);
    });

    it('should allow zero time', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(5000);
      useVideoEditorStore.getState().setCurrentTime(0);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(0);
    });
  });

  describe('seek behavior', () => {
    it('should allow seeking while playing', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setIsPlaying(true);
      useVideoEditorStore.getState().setCurrentTime(3000);

      expect(useVideoEditorStore.getState().currentTimeMs).toBe(3000);
      expect(useVideoEditorStore.getState().isPlaying).toBe(true);
    });

    it('should allow seeking while paused', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setIsPlaying(false);
      useVideoEditorStore.getState().setCurrentTime(7500);

      expect(useVideoEditorStore.getState().currentTimeMs).toBe(7500);
      expect(useVideoEditorStore.getState().isPlaying).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle very small time values', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(1);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(1);
    });

    it('should handle fractional milliseconds', () => {
      const project = createTestProject();
      useVideoEditorStore.setState({ project });

      useVideoEditorStore.getState().setCurrentTime(5500.5);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(5500.5);
    });

    it('should handle project duration change', () => {
      const shortProject = createTestProject({
        timeline: {
          durationMs: 5000,
          inPoint: 0,
          outPoint: 5000,
          speed: 1.0,
        },
      });
      useVideoEditorStore.setState({ project: shortProject });

      useVideoEditorStore.getState().setCurrentTime(4000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(4000);

      // Change to longer project
      const longProject = createTestProject({
        timeline: {
          durationMs: 20000,
          inPoint: 0,
          outPoint: 20000,
          speed: 1.0,
        },
      });
      useVideoEditorStore.setState({ project: longProject });

      useVideoEditorStore.getState().setCurrentTime(15000);
      expect(useVideoEditorStore.getState().currentTimeMs).toBe(15000);
    });
  });
});
