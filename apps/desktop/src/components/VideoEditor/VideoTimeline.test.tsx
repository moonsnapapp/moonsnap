import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VideoTimeline } from './VideoTimeline';
import { VideoEditorTimeline } from '../../views/VideoEditor/VideoEditorTimeline';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { mockInvoke, setInvokeResponse } from '../../test/mocks/tauri';
import type { VideoProject, AudioWaveform } from '../../types';

// Create a minimal mock project for testing
const createMockProject = (overrides: Partial<VideoProject> = {}): VideoProject => ({
  id: 'test-project-123',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  name: 'Test Recording',
  sources: {
    screenVideo: '/path/to/screen.mp4',
    webcamVideo: null,
    systemAudio: null,
    microphoneAudio: null,
    cursorRecording: null,
  },
  timeline: {
    durationMs: 30000, // 30 seconds
    trimStart: 0,
    trimEnd: 30000,
    inPoint: 0,
    outPoint: 30000,
    cuts: [],
  },
  zoom: {
    regions: [],
    autoZoom: null,
  },
  cursor: {
    enabled: true,
    size: 1.0,
    highlightClicks: true,
    clickColor: '#FF0000',
    clickOpacity: 0.5,
    clickDuration: 300,
    smoothing: 0.5,
    trail: false,
    trailLength: 10,
    trailOpacity: 0.3,
    visibility: [],
  },
  webcam: {
    enabled: false,
    position: 'bottom-right',
    size: 0.2,
    shape: 'circle',
    borderEnabled: true,
    borderColor: '#FFFFFF',
    borderWidth: 2,
    offsetX: 20,
    offsetY: 20,
    zIndex: 10,
    fitMode: 'cover',
    visibilitySegments: [],
  },
  audio: {
    systemVolume: 1.0,
    microphoneVolume: 1.0,
    masterVolume: 1.0,
    normalization: false,
    noiseReduction: false,
  },
  export: {
    format: 'mp4',
    resolution: { width: 1920, height: 1080, label: '1080p' },
    fps: 30,
    quality: 'high',
    includeAudio: true,
  },
  scene: {
    segments: [],
    defaultMode: 'screen-only',
  },
  text: {
    segments: [],
  },
  mask: {
    segments: [],
  },
  ...overrides,
});

// Mock waveform data
const mockWaveform: AudioWaveform = {
  samples: [0.1, 0.2, 0.3, 0.2, 0.1],
  sampleRate: 100,
  durationMs: 50,
};

// Reset store state before each test
beforeEach(() => {
  // Set up mock for extract_audio_waveform
  setInvokeResponse('extract_audio_waveform', mockWaveform);

  useVideoEditorStore.setState({
    project: null,
    currentTimeMs: 0,
    isPlaying: false,
    isDraggingPlayhead: false,
    splitMode: false,
    previewTimeMs: null,
    timelineZoom: 0.05,
    timelineScrollLeft: 0,
    timelineContainerWidth: 800,
    trackVisibility: {
      video: true,
      text: true,
      mask: true,
      zoom: true,
      scene: true,
    },
  });
});

describe('VideoTimeline', () => {
  const defaultProps = {
    onExport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render timeline with export button', () => {
      render(<VideoTimeline {...defaultProps} />);

      // Export button is always visible
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    });

    it('should render time display showing 0:00 initially', () => {
      const { container } = render(<VideoTimeline {...defaultProps} />);

      // Time display is in the header with specific class
      const timeDisplay = container.querySelector('.tabular-nums');
      expect(timeDisplay).toBeInTheDocument();
      expect(timeDisplay?.textContent).toContain('0:00');
    });

    it('should render playback control buttons', () => {
      const { container } = render(<VideoTimeline {...defaultProps} />);

      // Find buttons by class
      const glassButtons = container.querySelectorAll('.glass-btn');
      expect(glassButtons.length).toBeGreaterThan(0);

      // Find the play button (tool-button class)
      const playButton = container.querySelector('.tool-button');
      expect(playButton).toBeInTheDocument();
    });

    it('should render Video track label when visible', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.getByText('Video')).toBeInTheDocument();
    });

    it('should render track labels based on visibility', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: false,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.getByText('Video')).toBeInTheDocument();
      expect(screen.getByText('Text')).toBeInTheDocument();
      expect(screen.getByText('Mask')).toBeInTheDocument();
      expect(screen.getByText('Zoom')).toBeInTheDocument();
    });

    it('should hide Scene track when no webcam video', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          sources: {
            screenVideo: '/path/to/screen.mp4',
            webcamVideo: null,
            systemAudio: null,
            microphoneAudio: null,
            cursorRecording: null,
          },
        }),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      // Scene track requires webcamVideo to be present
      expect(screen.queryByText('Scene')).not.toBeInTheDocument();
    });

    it('should show Scene track when webcam video exists', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          sources: {
            screenVideo: '/path/to/screen.mp4',
            webcamVideo: '/path/to/webcam.mp4',
            systemAudio: null,
            microphoneAudio: null,
            cursorRecording: null,
          },
        }),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.getByText('Scene')).toBeInTheDocument();
    });

    it('should show scene mode labels inside scene segments', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          sources: {
            screenVideo: '/path/to/screen.mp4',
            webcamVideo: '/path/to/webcam.mp4',
            systemAudio: null,
            microphoneAudio: null,
            cursorRecording: null,
          },
          scene: {
            defaultMode: 'default',
            segments: [
              {
                id: 'scene-1',
                startMs: 0,
                endMs: 3000,
                mode: 'cameraOnly',
              },
            ],
          },
        }),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.getByText('Camera Only')).toBeInTheDocument();
    });

    it('should not show a label for default scene segments', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          sources: {
            screenVideo: '/path/to/screen.mp4',
            webcamVideo: '/path/to/webcam.mp4',
            systemAudio: null,
            microphoneAudio: null,
            cursorRecording: null,
          },
          scene: {
            defaultMode: 'default',
            segments: [
              {
                id: 'scene-default',
                startMs: 0,
                endMs: 3000,
                mode: 'default',
              },
            ],
          },
        }),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.queryByText('Screen + Webcam')).not.toBeInTheDocument();
    });

    it('should render screen-only scene segments with the green scene styling', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          sources: {
            screenVideo: '/path/to/screen.mp4',
            webcamVideo: '/path/to/webcam.mp4',
            systemAudio: null,
            microphoneAudio: null,
            cursorRecording: null,
          },
          scene: {
            defaultMode: 'default',
            segments: [
              {
                id: 'scene-screen-only',
                startMs: 0,
                endMs: 3000,
                mode: 'screenOnly',
              },
            ],
          },
        }),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      expect(screen.getByText('Screen Only')).toBeInTheDocument();

      const sceneSegment = container!.querySelector('[data-segment]') as HTMLElement | null;
      expect(sceneSegment).toBeInTheDocument();
      expect(sceneSegment?.style.backgroundColor).toBe('var(--track-scene-default-bg)');
      expect(sceneSegment?.style.borderColor).toBe('var(--track-scene-default-border)');
    });

    it('should render the selected bottom-track mask tooltip above the segment', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          mask: {
            segments: [
              {
                id: 'mask-1',
                startMs: 0,
                endMs: 3000,
                x: 0.25,
                y: 0.25,
                width: 0.25,
                height: 0.25,
                maskType: 'blur',
                intensity: 50,
                feather: 10,
                color: '#000000',
              },
            ],
          },
        }),
        selectedMaskSegmentId: 'mask-1',
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: false,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      const tooltip = screen.getByText('0:00 - 0:03');
      expect(tooltip.className).toContain('-top-6');
      expect(tooltip.className).not.toContain('-bottom-6');
    });

    it('should use screen video for waveform when audio is embedded in quick capture', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'extract_audio_waveform',
        expect.objectContaining({
          audioPath: '/path/to/screen.mp4',
        })
      );
    });

    it('should render IO header buttons with matching fixed sizes', async () => {
      let container: HTMLElement;
      await act(async () => {
        const result = render(
          <VideoTimeline
            {...defaultProps}
            onSetInPoint={vi.fn()}
            onSetOutPoint={vi.fn()}
          />
        );
        container = result.container;
      });

      const inButton = screen.getByRole('button', { name: 'I' });
      const outButton = screen.getByRole('button', { name: 'O' });

      expect(inButton.className).toContain('w-8');
      expect(outButton.className).toContain('w-8');
      expect(inButton.className).toContain('justify-center');
      expect(outButton.className).toContain('justify-center');
      expect(container).toBeInTheDocument();
    });

  });

  describe('playback interactions', () => {
    it('should toggle playback when play button is clicked', () => {
      const { container } = render(<VideoTimeline {...defaultProps} />);

      // Find play button by its class
      const playButton = container.querySelector('.tool-button');
      expect(playButton).toBeInTheDocument();

      if (playButton) {
        fireEvent.click(playButton);
      }

      // After clicking, isPlaying should be toggled
      expect(useVideoEditorStore.getState().isPlaying).toBe(true);
    });

    it('should pause playback when scrubbing the timeline ruler', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        isPlaying: true,
        currentTimeMs: 5000,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const ruler = container!.querySelector('[data-timeline-ruler]');
      expect(ruler).toBeInTheDocument();

      if (ruler) {
        fireEvent.mouseDown(ruler, { clientX: 200 });
        fireEvent.mouseUp(document);
      }

      expect(useVideoEditorStore.getState().isPlaying).toBe(false);
    });

    it('should call onExport when export button is clicked', () => {
      const onExport = vi.fn();
      render(<VideoTimeline {...defaultProps} onExport={onExport} />);

      const exportButton = screen.getByRole('button', { name: /export/i });
      fireEvent.click(exportButton);

      expect(onExport).toHaveBeenCalledTimes(1);
    });
  });

  describe('zoom controls', () => {
    it('should increase zoom when zoom in button is clicked', () => {
      const initialZoom = 0.05;
      useVideoEditorStore.setState({ timelineZoom: initialZoom });

      const { container } = render(<VideoTimeline {...defaultProps} />);

      // Zoom buttons are glass-btn with size h-7 w-7
      const zoomButtons = container.querySelectorAll('.glass-btn.h-7.w-7');
      // Zoom in is the second one (after zoom out)
      const zoomInButton = zoomButtons[1];

      if (zoomInButton) {
        fireEvent.click(zoomInButton);
      }

      // Zoom should increase by factor of 1.5
      expect(useVideoEditorStore.getState().timelineZoom).toBeGreaterThan(initialZoom);
    });

    it('should decrease zoom when zoom out button is clicked', () => {
      const initialZoom = 0.05;
      useVideoEditorStore.setState({ timelineZoom: initialZoom });

      const { container } = render(<VideoTimeline {...defaultProps} />);

      // Zoom buttons are glass-btn with size h-7 w-7
      const zoomButtons = container.querySelectorAll('.glass-btn.h-7.w-7');
      // Zoom out is the first one
      const zoomOutButton = zoomButtons[0];

      if (zoomOutButton) {
        fireEvent.click(zoomOutButton);
      }

      // Zoom should decrease by factor of 1.5
      expect(useVideoEditorStore.getState().timelineZoom).toBeLessThan(initialZoom);
    });

    it('should handle ctrl+wheel to zoom timeline', () => {
      const initialZoom = 0.05;
      useVideoEditorStore.setState({ timelineZoom: initialZoom });

      const { container } = render(<VideoTimeline {...defaultProps} />);

      // Find the scrollable container
      const scrollContainer = container.querySelector('.overflow-x-auto');
      expect(scrollContainer).toBeInTheDocument();

      if (scrollContainer) {
        // Scroll up (zoom in) with ctrl key
        fireEvent.wheel(scrollContainer, { deltaY: -100, ctrlKey: true });

        // Zoom should increase
        expect(useVideoEditorStore.getState().timelineZoom).toBeGreaterThan(initialZoom);
      }
    });

    it('should not zoom when wheel without ctrl key', () => {
      const initialZoom = 0.05;
      useVideoEditorStore.setState({ timelineZoom: initialZoom });

      const { container } = render(<VideoTimeline {...defaultProps} />);

      const scrollContainer = container.querySelector('.overflow-x-auto');

      if (scrollContainer) {
        // Scroll without ctrl key
        fireEvent.wheel(scrollContainer, { deltaY: -100 });

        // Zoom should remain the same
        expect(useVideoEditorStore.getState().timelineZoom).toBe(initialZoom);
      }
    });
  });

  describe('time display', () => {
    it('should display formatted current time and duration', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          timeline: {
            durationMs: 65000, // 1:05
            trimStart: 0,
            trimEnd: 65000,
            inPoint: 0,
            outPoint: 65000,
            cuts: [],
          },
        }),
        currentTimeMs: 5000, // 0:05
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      // Time display is in the header with tabular-nums class
      const timeDisplay = container!.querySelector('.tabular-nums');
      expect(timeDisplay).toBeInTheDocument();
      // Should show current time (0:05) and duration (1:05)
      expect(timeDisplay?.textContent).toContain('0:05');
      expect(timeDisplay?.textContent).toContain('1:05');
    });
  });

  describe('track visibility', () => {
    it('should hide tracks when visibility is false', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        trackVisibility: {
          video: true,
          text: false,
          mask: false,
          zoom: false,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.getByText('Video')).toBeInTheDocument();
      expect(screen.queryByText('Text')).not.toBeInTheDocument();
      expect(screen.queryByText('Mask')).not.toBeInTheDocument();
      expect(screen.queryByText('Zoom')).not.toBeInTheDocument();
    });
  });

  describe('preview scrubber', () => {
    it('should not show preview scrubber when playing', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        isPlaying: true,
        previewTimeMs: 5000,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      // Preview scrubber has a specific structure with ink-muted background
      // When playing, the preview scrubber should not be rendered even if previewTimeMs is set
      const previewScrubber = container!.querySelector('[data-preview-scrubber]');
      expect(previewScrubber).not.toBeInTheDocument();
    });

    it('should show preview scrubber when not playing and preview time is set', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        isPlaying: false,
        previewTimeMs: 5000,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      // Preview scrubber should be visible when not playing
      const previewScrubber = container!.querySelector('[data-preview-scrubber]');
      expect(previewScrubber).toBeInTheDocument();
      expect(previewScrubber?.getAttribute('data-cut-mode')).toBe('false');
      expect(previewScrubber?.className).toContain('z-40');
    });
  });

  describe('cut mode', () => {
    it('should toggle cut mode when scissors button is clicked', async () => {
      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const cutToggle = container!.querySelector('[data-cut-mode-toggle]');
      expect(cutToggle).toBeInTheDocument();

      if (cutToggle) {
        fireEvent.click(cutToggle);
      }

      expect(useVideoEditorStore.getState().splitMode).toBe(true);
    });

    it('should mark preview scrubber as cut mode when splitMode is active', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        splitMode: true,
        isPlaying: false,
        previewTimeMs: 2500,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const previewScrubber = container!.querySelector('[data-preview-scrubber]');
      expect(previewScrubber).toBeInTheDocument();
      expect(previewScrubber?.getAttribute('data-cut-mode')).toBe('true');
      expect((previewScrubber as HTMLDivElement | null)?.style.width).toBe('1px');
    });

    it('should hide the primary playhead while cut skimming is active', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        splitMode: true,
        isPlaying: false,
        previewTimeMs: 2500,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const playhead = container!.querySelector('[data-playhead]') as HTMLDivElement | null;
      expect(playhead).toBeInTheDocument();
      expect(playhead?.style.opacity).toBe('0');
    });

    it('should split hovered trim segment when clicking timeline in cut mode', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          timeline: {
            durationMs: 10000,
            trimStart: 0,
            trimEnd: 10000,
            inPoint: 0,
            outPoint: 10000,
            cuts: [],
          },
        }),
        splitMode: true,
        timelineZoom: 0.1,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const scrollContainer = container!.querySelector('.overflow-x-auto');
      const timelineArea = scrollContainer?.querySelector('.relative') as HTMLElement | null;
      const trimTrack = container!.querySelector('[data-trim-track]') as HTMLElement | null;
      expect(timelineArea).toBeInTheDocument();
      expect(trimTrack).toBeInTheDocument();

      if (timelineArea && trimTrack) {
        const originalGetBoundingClientRect = timelineArea.getBoundingClientRect;
        timelineArea.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 1000,
          bottom: 200,
          width: 1000,
          height: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        });

        fireEvent.click(trimTrack, { clientX: 500 });
        timelineArea.getBoundingClientRect = originalGetBoundingClientRect;
      }

      const segments = useVideoEditorStore.getState().project?.timeline.segments ?? [];
      expect(segments.length).toBe(2);
      expect(useVideoEditorStore.getState().selectedTrimSegmentId).toBeNull();
    });

    it('should still split in cut mode when clicking through the playhead line', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          timeline: {
            durationMs: 10000,
            trimStart: 0,
            trimEnd: 10000,
            inPoint: 0,
            outPoint: 10000,
            cuts: [],
          },
        }),
        splitMode: true,
        currentTimeMs: 5000,
        timelineZoom: 0.1,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const scrollContainer = container!.querySelector('.overflow-x-auto');
      const timelineArea = scrollContainer?.querySelector('.relative') as HTMLElement | null;
      const trimTrack = container!.querySelector('[data-trim-track]') as HTMLElement | null;
      expect(timelineArea).toBeInTheDocument();
      expect(trimTrack).toBeInTheDocument();

      if (timelineArea && trimTrack) {
        const originalGetBoundingClientRect = timelineArea.getBoundingClientRect;
        timelineArea.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 1000,
          bottom: 200,
          width: 1000,
          height: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        });

        fireEvent.click(trimTrack, { clientX: 500 });
        timelineArea.getBoundingClientRect = originalGetBoundingClientRect;
      }

      const segments = useVideoEditorStore.getState().project?.timeline.segments ?? [];
      expect(segments.length).toBe(2);
    });
  });

  describe('playhead dragging', () => {
    it('should set isDraggingPlayhead when playhead is mousedown', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        currentTimeMs: 5000,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      // Find the playhead (coral colored vertical line with cursor-grab)
      const playhead = container!.querySelector('.cursor-grab');
      expect(playhead).toBeInTheDocument();

      if (playhead) {
        fireEvent.mouseDown(playhead);
        expect(useVideoEditorStore.getState().isDraggingPlayhead).toBe(true);
      }
    });

    it('should change cursor style when dragging playhead', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        currentTimeMs: 5000,
        isDraggingPlayhead: true,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      // When dragging, the playhead should have cursor-grabbing class
      const playhead = container!.querySelector('.cursor-grabbing');
      expect(playhead).toBeInTheDocument();
    });

    it('should keep the playhead inside the timeline width at the end', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          timeline: {
            durationMs: 10000,
            trimStart: 0,
            trimEnd: 10000,
            inPoint: 0,
            outPoint: 10000,
            cuts: [],
          },
        }),
        currentTimeMs: 10000,
        timelineZoom: 0.1,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const playheadHandle = container!.querySelector('[data-timeline-control].cursor-grab') as HTMLDivElement | null;
      const playheadLine = playheadHandle?.parentElement as HTMLDivElement | null;
      expect(playheadHandle).toBeInTheDocument();
      expect(playheadLine?.style.left).toBe('998px');
    });
  });

  describe('video track content', () => {
    it('should display Recording label in video track', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      await act(async () => {
        render(<VideoTimeline {...defaultProps} />);
      });

      expect(screen.getByText('Recording')).toBeInTheDocument();
    });
  });

  describe('scroll handling', () => {
    it('should hide vertical overflow on the timeline scroll container', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const scrollContainer = container!.querySelector('.overflow-x-auto') as HTMLDivElement | null;
      expect(scrollContainer).toBeInTheDocument();
      expect(scrollContainer?.className).toContain('overflow-y-hidden');
    });

    it('should update scroll position in store when scrolling', async () => {
      useVideoEditorStore.setState({
        project: createMockProject(),
        timelineScrollLeft: 0,
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      const scrollContainer = container!.querySelector('.overflow-x-auto');
      expect(scrollContainer).toBeInTheDocument();

      if (scrollContainer) {
        // Simulate scroll event
        Object.defineProperty(scrollContainer, 'scrollLeft', { value: 100, writable: true });
        fireEvent.scroll(scrollContainer);

        expect(useVideoEditorStore.getState().timelineScrollLeft).toBe(100);
      }
    });
  });

  describe('timeline click to seek', () => {
    it('should update current time when clicking on timeline', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          timeline: {
            durationMs: 10000,
            trimStart: 0,
            trimEnd: 10000,
            inPoint: 0,
            outPoint: 10000,
            cuts: [],
          },
        }),
        currentTimeMs: 0,
        timelineZoom: 0.1, // 100px per second
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoTimeline {...defaultProps} />);
        container = result.container;
      });

      // Find the clickable timeline area (the relative container inside scroll area)
      const scrollContainer = container!.querySelector('.overflow-x-auto');
      const timelineArea = scrollContainer?.querySelector('.relative');
      expect(timelineArea).toBeInTheDocument();

      if (timelineArea) {
        // Mock getBoundingClientRect for the click calculation
        const originalGetBoundingClientRect = timelineArea.getBoundingClientRect;
        timelineArea.getBoundingClientRect = () => ({
          left: 0,
          top: 0,
          right: 1000,
          bottom: 200,
          width: 1000,
          height: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        });

        // Click at x=500 with zoom 0.1 (100px/s) = 5000ms
        fireEvent.click(timelineArea, { clientX: 500 });

        // Restore
        timelineArea.getBoundingClientRect = originalGetBoundingClientRect;

        // Current time should be updated near 5000ms.
        // Allow a small tolerance because timeline seek math may quantize by a few ms.
        expect(useVideoEditorStore.getState().currentTimeMs).toBeGreaterThanOrEqual(4990);
        expect(useVideoEditorStore.getState().currentTimeMs).toBeLessThanOrEqual(5010);
      }
    });
  });

  describe('timeline wrapper sizing', () => {
    it('should grow the wrapper when all five timeline tracks are visible', async () => {
      useVideoEditorStore.setState({
        project: createMockProject({
          sources: {
            screenVideo: '/path/to/screen.mp4',
            webcamVideo: '/path/to/webcam.mp4',
            systemAudio: null,
            microphoneAudio: null,
            cursorRecording: null,
          },
        }),
        trackVisibility: {
          video: true,
          text: true,
          mask: true,
          zoom: true,
          scene: true,
        },
      });

      let container: HTMLElement;
      await act(async () => {
        const result = render(<VideoEditorTimeline onExport={vi.fn()} />);
        container = result.container;
      });

      const wrapper = container!.firstElementChild as HTMLDivElement | null;
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.style.height).toBe('330px');
    });
  });
});
