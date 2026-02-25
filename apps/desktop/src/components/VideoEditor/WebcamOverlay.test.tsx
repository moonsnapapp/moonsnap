import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebcamConfig } from '../../types';
import { WebcamOverlay } from './WebcamOverlay';

const { mockEditorState, mockUseVideoEditorStore } = vi.hoisted(() => {
  const editorState = {
    isPlaying: true,
    previewTimeMs: null as number | null,
    currentTimeMs: 4200,
  };

  const useStore = Object.assign(
    (selector: (state: typeof editorState) => unknown) => selector(editorState),
    {
      getState: () => editorState,
    }
  );

  return {
    mockEditorState: editorState,
    mockUseVideoEditorStore: useStore,
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
}));

vi.mock('../../stores/videoEditorStore', () => ({
  useVideoEditorStore: mockUseVideoEditorStore,
}));

vi.mock('../../hooks/usePlaybackEngine', () => ({
  usePreviewOrPlaybackTime: () => mockEditorState.currentTimeMs,
}));

vi.mock('../../hooks/useWebCodecsPreview', () => ({
  useWebCodecsPreview: () => ({
    getFrame: () => null,
    prefetchAround: vi.fn(),
    isReady: false,
  }),
}));

const baseConfig: WebcamConfig = {
  enabled: true,
  position: 'bottomRight',
  customX: 0.8,
  customY: 0.8,
  size: 0.2,
  shape: 'circle',
  rounding: 100,
  cornerStyle: 'squircle',
  shadow: 0,
  shadowConfig: {
    size: 0,
    opacity: 0,
    blur: 0,
  },
  mirror: false,
  border: {
    enabled: false,
    color: '#ffffff',
    width: 2,
  },
  visibilitySegments: [],
};

describe('WebcamOverlay', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('resumes playback when visibility toggles back on while already playing', async () => {
    const { container, rerender } = render(
      <WebcamOverlay
        webcamVideoPath="/tmp/webcam.mp4"
        config={{ ...baseConfig, enabled: false }}
        containerWidth={1280}
        containerHeight={720}
        renderWidth={1920}
      />
    );

    expect(container.querySelector('video')).toBeNull();

    rerender(
      <WebcamOverlay
        webcamVideoPath="/tmp/webcam.mp4"
        config={{ ...baseConfig, enabled: true }}
        containerWidth={1280}
        containerHeight={720}
        renderWidth={1920}
      />
    );

    await waitFor(() => {
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });
  });
});
