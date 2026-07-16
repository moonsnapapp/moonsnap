import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AnnotationSegment,
  AudioTrackSettings,
  TextSegment,
} from '../../../types';
import {
  getMicPreviewAudioVolume,
  getSystemPreviewAudioVolume,
  getTypewriterPreviewAudioVolume,
} from './previewAudio';
import {
  getLayerVisibilityStyle,
  getVideoCropObjectFitStyle,
  hasDynamicSceneModeFeatures,
} from './sceneGeometry';
import {
  getPreviewBackgroundImageSrc,
  getPreviewBackgroundLayerSrc,
} from './previewBackground';
import { StaticSceneModeRenderer } from './StaticSceneRenderer';
import { getPreviewFitScale } from './usePreviewResizeTracking';
import type { SceneModeRendererProps } from './sceneTypes';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../../stores/videoEditorStore', () => ({
  useVideoEditorStore: () => null,
}));

vi.mock('../../../hooks/usePlaybackEngine', () => ({
  usePreviewOrPlaybackTime: () => 0,
}));

vi.mock('../../../hooks/usePlaybackTimeThrottled', () => ({
  usePreviewOrPlaybackTimeThrottled: () => 0,
}));

vi.mock('../../../hooks/useTimelineSourceTime', () => ({
  useTimelineToSourceTime: () => (timeMs: number) => timeMs,
}));

vi.mock('../../../hooks/useZoomPreview', () => ({
  getZoomScaleAt: () => 1,
  useZoomPreview: () => ({ transform: 'none', transformOrigin: 'center' }),
}));

vi.mock('../../../hooks/useZoomMotionBlurFilter', () => ({
  useZoomMotionBlurFilter: () => undefined,
}));

vi.mock('../AnnotationOverlay', () => ({
  AnnotationOverlay: () => <div data-testid="annotation-layer" />,
}));

vi.mock('../TextOverlay', () => ({
  TextOverlay: () => <div data-testid="text-layer" />,
}));

vi.mock('./VideoComponents', () => ({
  VideoNoZoom: () => <div data-testid="video-layer" />,
  WebCodecsCanvasNoZoom: () => <div data-testid="canvas-layer" />,
}));

describe('GPU preview layer contracts', () => {
  it('selects the dynamic scene renderer only for dynamic scene inputs', () => {
    const base = {} as SceneModeRendererProps;

    expect(hasDynamicSceneModeFeatures(base)).toBe(false);
    expect(hasDynamicSceneModeFeatures({ ...base, webcamVideoPath: 'camera.mp4' })).toBe(true);
    expect(hasDynamicSceneModeFeatures({ ...base, cursorRecording: { events: [] } } as SceneModeRendererProps)).toBe(true);
    expect(hasDynamicSceneModeFeatures({ ...base, sceneSegments: [{}] } as SceneModeRendererProps)).toBe(true);
  });

  it('preserves crop object-fit geometry', () => {
    expect(
      getVideoCropObjectFitStyle(
        { enabled: true, x: 320, y: 180, width: 1280, height: 720 },
        1920,
        1080,
      ),
    ).toEqual({ objectFit: 'cover', objectPosition: '50% 50%' });
    expect(getVideoCropObjectFitStyle(undefined, 1920, 1080)).toEqual({});
  });

  it('hides inactive layers without removing their stable layout', () => {
    expect(getLayerVisibilityStyle(false)).toEqual({ visibility: 'hidden', pointerEvents: 'none' });
    expect(getLayerVisibilityStyle(true)).toEqual({ visibility: 'visible', pointerEvents: 'auto' });
  });

  it('resolves image and wallpaper background sources independently', () => {
    const dataUrl = 'data:image/png;base64,abc';
    expect(getPreviewBackgroundImageSrc({ bgType: 'image', imagePath: dataUrl })).toBe(dataUrl);
    expect(getPreviewBackgroundImageSrc({ bgType: 'image', imagePath: 'C:/capture.png' })).toBe(
      'asset://C:/capture.png',
    );
    expect(getPreviewBackgroundLayerSrc({ bgType: 'wallpaper' }, 'asset://wallpaper', null)).toBe(
      'asset://wallpaper',
    );
  });

  it('keeps DPR-capped resize scaling proportional', () => {
    expect(getPreviewFitScale({ width: 960, height: 540 }, { width: 1920, height: 1080 })).toBe(0.5);
  });

  it('applies mute and configured volume per audio track', () => {
    const config = {
      systemMuted: true,
      systemVolume: 0.7,
      microphoneMuted: false,
      microphoneVolume: 0.35,
    } as AudioTrackSettings;

    expect(getSystemPreviewAudioVolume(config)).toBe(0);
    expect(getMicPreviewAudioVolume(config)).toBe(0.35);
    expect(getTypewriterPreviewAudioVolume(config)).toBe(0);
    expect(getSystemPreviewAudioVolume(undefined)).toBe(1);
  });

  it('composes text and annotation layers independently in a static scene', () => {
    render(
      <StaticSceneModeRenderer
        videoRef={createRef<HTMLVideoElement>()}
        videoSrc="asset://screen.mp4"
        defaultSceneMode="default"
        containerWidth={640}
        containerHeight={360}
        frameRenderWidth={1920}
        frameRenderHeight={1080}
        compositionRenderHeight={1080}
        videoWidth={1920}
        videoHeight={1080}
        annotationSegments={[{} as AnnotationSegment]}
        textSegments={[{} as TextSegment]}
        onVideoClick={vi.fn()}
      />,
    );

    expect(screen.getByTestId('video-layer')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-layer')).toBeInTheDocument();
    expect(screen.getByTestId('text-layer')).toBeInTheDocument();
  });
});
