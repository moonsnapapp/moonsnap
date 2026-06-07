import { memo, useCallback, useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { TEXT_ANIMATION } from '../../constants';
import { CURSOR } from '../../constants';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectProject,
  selectIsPlaying,
  selectPreviewTimeMs,
  selectCurrentTimeMs,
  selectCursorRecording,
  selectAudioConfig,
  selectScreenVideoPath,
  selectTogglePlayback,
  selectIsCropEditing,
  selectUpdateExportConfig,
} from '../../stores/videoEditor/selectors';
import { videoEditorLogger } from '../../utils/logger';
import { computeDPRCappedFitScale } from '../../utils/compositionBounds';
import { hasEnabledCrop } from '../../utils/videoContentDimensions';
import { hasActiveTypewriterSound } from '../../utils/textSegmentAnimation';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { usePreviewOrPlaybackTimeThrottled } from '../../hooks/usePlaybackTimeThrottled';
import { useTimelineToSourceTime } from '../../hooks/useTimelineSourceTime';
import { getZoomScaleAt, useZoomPreview } from '../../hooks/useZoomPreview';
import { useZoomMotionBlurFilter } from '../../hooks/useZoomMotionBlurFilter';
import { useInterpolatedScene, shouldRenderScreen, shouldRenderCursor, getCameraOnlyTransitionOpacity, getRegularCameraTransitionOpacity } from '../../hooks/useSceneMode';
import { WebcamOverlay } from './WebcamOverlay';
import { CursorOverlay } from './CursorOverlay';
import { ClickHighlightOverlay } from './ClickHighlightOverlay';
import { MaskOverlay } from './MaskOverlay';
import { TextOverlay } from './TextOverlay';
import { AnnotationOverlay } from './AnnotationOverlay';

import { UnifiedCaptionOverlay } from './UnifiedCaptionOverlay';
import { InlineCropOverlay } from './InlineCropOverlay';
import {
  WebCodecsCanvasNoZoom,
  VideoNoZoom,
  FullscreenWebcam,
  usePreviewStyles,
  usePlaybackSync,
} from './gpu';
import type { SceneSegment, SceneMode, WebcamConfig, ZoomRegion, CursorRecording, CursorConfig, AnnotationSegment, MaskSegment, TextSegment, CropConfig, AudioTrackSettings, VideoProject } from '../../types';

const ZOOM_LAYER_STYLE: React.CSSProperties = {
  transform: 'translateZ(0) scale(1)',
  transformOrigin: 'center center',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
};

type Size = { width: number; height: number };

const DEFAULT_PREVIEW_VIDEO_SIZE: Size = { width: 1920, height: 1080 };

type PreviewBackgroundConfig = VideoProject['export']['background'];

function getCompositionBackground(
  hasFrameStyling: boolean,
  backgroundConfig: PreviewBackgroundConfig | undefined
) {
  if (!hasFrameStyling || !backgroundConfig) return undefined;
  return getCompositionBackgroundValue(backgroundConfig);
}

function getCompositionBackgroundValue(backgroundConfig: PreviewBackgroundConfig) {
  const backgroundValues = {
    solid: () => backgroundConfig.solidColor,
    gradient: () => `linear-gradient(${backgroundConfig.gradientAngle}deg, ${backgroundConfig.gradientStart}, ${backgroundConfig.gradientEnd})`,
  };

  return backgroundConfig.bgType === 'solid' || backgroundConfig.bgType === 'gradient'
    ? backgroundValues[backgroundConfig.bgType]()
    : undefined;
}

const PlaybackSyncController = memo(function PlaybackSyncController({
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

const TypewriterAudioController = memo(function TypewriterAudioController({
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

const SceneAwareWebcamOverlay = memo(function SceneAwareWebcamOverlay({
  webcamVideoPath,
  config,
  containerWidth,
  containerHeight,
  renderWidth,
  zoomRegions,
  sceneSegments,
  defaultSceneMode,
}: {
  webcamVideoPath: string;
  config: WebcamConfig;
  containerWidth: number;
  containerHeight: number;
  renderWidth: number;
  zoomRegions: ZoomRegion[] | undefined;
  sceneSegments: SceneSegment[] | undefined;
  defaultSceneMode: SceneMode;
}) {
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(20);
  const scene = useInterpolatedScene(sceneSegments, defaultSceneMode, currentTimeMs);
  const sceneOpacity = getRegularCameraTransitionOpacity(scene);
  const zoomScale = useMemo(
    () => getZoomScaleAt(zoomRegions, currentTimeMs),
    [zoomRegions, currentTimeMs]
  );

  return (
    <WebcamOverlay
      webcamVideoPath={webcamVideoPath}
      config={config}
      containerWidth={containerWidth}
      containerHeight={containerHeight}
      renderWidth={renderWidth}
      sceneOpacity={sceneOpacity}
      zoomScale={zoomScale}
    />
  );
});

const ZoomTransformController = memo(function ZoomTransformController({
  frameRef,
  borderOverlayRef,
  zoomRegions,
  cursorRecording,
  cursorConfig,
  backgroundPadding,
  rounding,
  videoWidth,
  videoHeight,
}: {
  frameRef: React.RefObject<HTMLDivElement | null>;
  borderOverlayRef: React.RefObject<HTMLDivElement | null>;
  zoomRegions: ZoomRegion[] | undefined;
  cursorRecording: CursorRecording | null | undefined;
  cursorConfig: CursorConfig | undefined;
  backgroundPadding: number;
  rounding: number;
  videoWidth: number;
  videoHeight: number;
}) {
  const currentTimeMs = usePreviewOrPlaybackTime();
  const toSourceTime = useTimelineToSourceTime();
  const sourceTimeMs = useMemo(
    () => toSourceTime(currentTimeMs),
    [currentTimeMs, toSourceTime]
  );
  const zoomStyle = useZoomPreview(zoomRegions, currentTimeMs, cursorRecording, {
    backgroundPadding,
    rounding,
    videoWidth,
    videoHeight,
    cursorDampening: cursorConfig?.dampening ?? CURSOR.DAMPENING_DEFAULT,
    cursorTimeMs: sourceTimeMs,
  });
  useLayoutEffect(() => {
    const applyStyle = (element: HTMLDivElement | null) => {
      if (!element) {
        return;
      }
      element.style.transform = zoomStyle.transform;
      element.style.transformOrigin = zoomStyle.transformOrigin;
    };

    applyStyle(frameRef.current);
    applyStyle(borderOverlayRef.current);
  }, [borderOverlayRef, frameRef, zoomStyle]);

  return null;
});

const MotionBlurController = memo(function MotionBlurController({
  targetRef,
  zoomRegions,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  zoomRegions: ZoomRegion[] | undefined;
}) {
  // ~30fps is enough for the smear to feel continuous without forcing a
  // full re-render on every playback tick.
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(33);
  const filter = useZoomMotionBlurFilter(zoomRegions, currentTimeMs);

  useLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    el.style.filter = filter ?? '';
  }, [filter, targetRef]);

  return null;
});

function hasRenderableOverlaySegments<T>(
  segments: T[] | undefined,
  previewWidth: number,
  previewHeight: number,
): segments is T[] {
  return Boolean(segments?.length) && previewWidth > 0 && previewHeight > 0;
}

const MaskOverlayController = memo(function MaskOverlayController({
  segments,
  previewWidth,
  previewHeight,
  videoElement,
  videoWidth,
  videoHeight,
  cropConfig,
}: {
  segments: MaskSegment[] | undefined;
  previewWidth: number;
  previewHeight: number;
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
  cropConfig?: CropConfig;
}) {
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(10);

  if (!hasRenderableOverlaySegments(segments, previewWidth, previewHeight)) {
    return null;
  }

  return (
    <MaskOverlay
      segments={segments}
      currentTimeMs={currentTimeMs}
      previewWidth={previewWidth}
      previewHeight={previewHeight}
      videoElement={videoElement}
      videoWidth={videoWidth}
      videoHeight={videoHeight}
      cropConfig={cropConfig}
    />
  );
});

const TextOverlayController = memo(function TextOverlayController({
  segments,
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  zoomRegions,
}: {
  segments: TextSegment[] | undefined;
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
  zoomRegions: ZoomRegion[] | undefined;
}) {
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(20);
  const zoomScale = useMemo(
    () => getZoomScaleAt(zoomRegions, currentTimeMs),
    [zoomRegions, currentTimeMs]
  );

  if (!hasRenderableOverlaySegments(segments, displayWidth, displayHeight)) {
    return null;
  }

  return (
    <TextOverlay
      segments={segments}
      currentTimeMs={currentTimeMs}
      renderWidth={renderWidth}
      renderHeight={renderHeight}
      displayWidth={displayWidth}
      displayHeight={displayHeight}
      zoomScale={zoomScale}
    />
  );
});

const AnnotationOverlayController = memo(function AnnotationOverlayController({
  segments,
  displayWidth,
  displayHeight,
  zoomRegions,
}: {
  segments: AnnotationSegment[] | undefined;
  displayWidth: number;
  displayHeight: number;
  zoomRegions: ZoomRegion[] | undefined;
}) {
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(10);
  const zoomScale = useMemo(
    () => getZoomScaleAt(zoomRegions, currentTimeMs),
    [zoomRegions, currentTimeMs]
  );

  if (!hasRenderableOverlaySegments(segments, displayWidth, displayHeight)) {
    return null;
  }

  return (
    <AnnotationOverlay
      segments={segments}
      currentTimeMs={currentTimeMs}
      previewWidth={displayWidth}
      previewHeight={displayHeight}
      zoomScale={zoomScale}
    />
  );
});

type SceneModeRendererProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string | null | undefined;
  zoomRegions: ZoomRegion[] | undefined;
  cursorRecording: CursorRecording | null | undefined;
  cursorConfig: CursorConfig | undefined;
  webcamVideoPath: string | undefined;
  webcamConfig: WebcamConfig | undefined;
  sceneSegments: SceneSegment[] | undefined;
  defaultSceneMode: SceneMode;
  containerWidth: number;
  containerHeight: number;
  frameRenderWidth: number;
  frameRenderHeight: number;
  compositionRenderHeight: number;
  videoWidth: number;
  videoHeight: number;
  maskSegments: MaskSegment[] | undefined;
  annotationSegments: AnnotationSegment[] | undefined;
  textSegments: TextSegment[] | undefined;
  isPlaying?: boolean;
  onVideoClick: () => void;
  backgroundPadding?: number;
  rounding?: number;
  frameStyle?: React.CSSProperties;
  frameBorderOverlayStyle?: React.CSSProperties | null;
  shadowStyle?: React.CSSProperties;
  cropConfig?: CropConfig;
};

function useVideoCropObjectFitStyle(
  cropConfig: CropConfig | undefined,
  videoWidth: number,
  videoHeight: number
): React.CSSProperties {
  return useMemo(
    () => getVideoCropObjectFitStyle(cropConfig, videoWidth, videoHeight),
    [cropConfig, videoHeight, videoWidth]
  );
}

function getVideoCropObjectFitStyle(
  cropConfig: CropConfig | undefined,
  videoWidth: number,
  videoHeight: number
): React.CSSProperties {
  if (!hasCropObjectFitConfig(cropConfig)) return {};

  const posX = getCropObjectPosition(cropConfig.x, cropConfig.width, videoWidth);
  const posY = getCropObjectPosition(cropConfig.y, cropConfig.height, videoHeight);

  return {
    objectFit: 'cover' as const,
    objectPosition: `${posX}% ${posY}%`,
  };
}

function hasCropObjectFitConfig(cropConfig: CropConfig | undefined): cropConfig is CropConfig {
  return Boolean(cropConfig && hasEnabledCrop(cropConfig));
}

function getCropObjectPosition(cropOffset: number, cropSize: number, videoSize: number) {
  const overflow = videoSize - cropSize;
  return overflow > 0 ? (cropOffset / overflow) * 100 : 50;
}

function getStaticFrameOpacity(defaultSceneMode: SceneMode): number {
  return defaultSceneMode === 'cameraOnly' ? 0 : 1;
}

function getStaticFrameLayerStyle(
  frameStyle: React.CSSProperties | undefined,
  frameOpacity: number,
): React.CSSProperties {
  return {
    position: 'relative',
    overflow: 'hidden',
    ...ZOOM_LAYER_STYLE,
    ...frameStyle,
    opacity: frameOpacity,
    visibility: frameOpacity < 0.01 ? 'hidden' : 'visible',
    width: '100%',
    height: '100%',
  };
}

function StaticScreenVideoContent({
  videoSrc,
  originalVideoPath,
  isPlaying,
  videoRef,
  onVideoClick,
  videoCropStyle,
}: {
  videoSrc: string | null | undefined;
  originalVideoPath: string | null | undefined;
  isPlaying: boolean | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onVideoClick: () => void;
  videoCropStyle: React.CSSProperties;
}) {
  return (
    <>
      {videoSrc && (
        <VideoNoZoom
          videoRef={videoRef}
          videoSrc={videoSrc}
          onVideoClick={onVideoClick}
          hidden={false}
          cropStyle={videoCropStyle}
        />
      )}

      {originalVideoPath && !isPlaying && (
        <WebCodecsCanvasNoZoom
          videoPath={originalVideoPath}
          cropStyle={videoCropStyle}
        />
      )}
    </>
  );
}

function StaticFrameBorderOverlay({
  borderOverlayRef,
  frameBorderOverlayStyle,
}: {
  borderOverlayRef: React.RefObject<HTMLDivElement | null>;
  frameBorderOverlayStyle: React.CSSProperties | null | undefined;
}) {
  if (!frameBorderOverlayStyle) {
    return null;
  }

  return (
    <div
      ref={borderOverlayRef}
      style={{
        ...ZOOM_LAYER_STYLE,
        ...frameBorderOverlayStyle,
      }}
    />
  );
}

const StaticSceneModeRenderer = memo(function StaticSceneModeRenderer({
  videoRef,
  videoSrc,
  defaultSceneMode,
  isPlaying,
  onVideoClick,
  zoomRegions,
  cursorRecording,
  cursorConfig,
  containerWidth,
  containerHeight,
  frameRenderWidth,
  frameRenderHeight,
  shadowStyle,
  frameStyle,
  frameBorderOverlayStyle,
  backgroundPadding = 0,
  rounding = 0,
  maskSegments,
  annotationSegments,
  textSegments,
  cropConfig,
  videoWidth,
  videoHeight,
}: SceneModeRendererProps) {
  const originalVideoPath = useVideoEditorStore(selectScreenVideoPath);
  const frameOpacity = getStaticFrameOpacity(defaultSceneMode);
  const frameRef = useRef<HTMLDivElement>(null);
  const borderOverlayRef = useRef<HTMLDivElement>(null);
  const videoFilterRef = useRef<HTMLDivElement>(null);
  const videoCropStyle = useVideoCropObjectFitStyle(cropConfig, videoWidth, videoHeight);
  const frameLayerStyle = getStaticFrameLayerStyle(frameStyle, frameOpacity);

  return (
    <div
      className="flex items-center justify-center"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        ...shadowStyle,
      }}
    >
      <ZoomTransformController
        frameRef={frameRef}
        borderOverlayRef={borderOverlayRef}
        zoomRegions={zoomRegions}
        cursorRecording={cursorRecording}
        cursorConfig={cursorConfig}
        backgroundPadding={backgroundPadding}
        rounding={rounding}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
      />
      <div
        ref={frameRef}
        style={frameLayerStyle}
      >
        <div
          ref={videoFilterRef}
          style={{ position: 'absolute', inset: 0, willChange: 'filter' }}
        >
          <StaticScreenVideoContent
            videoSrc={videoSrc}
            originalVideoPath={originalVideoPath}
            isPlaying={isPlaying}
            videoRef={videoRef}
            onVideoClick={onVideoClick}
            videoCropStyle={videoCropStyle}
          />
        </div>
        <MotionBlurController
          targetRef={videoFilterRef}
          zoomRegions={zoomRegions}
        />

        <MaskOverlayController
          segments={maskSegments}
          previewWidth={containerWidth}
          previewHeight={containerHeight}
          videoElement={videoRef.current}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          cropConfig={cropConfig}
        />

        <AnnotationOverlayController
          segments={annotationSegments}
          displayWidth={containerWidth}
          displayHeight={containerHeight}
          zoomRegions={zoomRegions}
        />

        <TextOverlayController
          segments={textSegments}
          renderWidth={frameRenderWidth}
          renderHeight={frameRenderHeight}
          displayWidth={containerWidth}
          displayHeight={containerHeight}
          zoomRegions={zoomRegions}
        />
      </div>

      <StaticFrameBorderOverlay
        borderOverlayRef={borderOverlayRef}
        frameBorderOverlayStyle={frameBorderOverlayStyle}
      />
    </div>
  );
});

const DynamicScreenContent = memo(function DynamicScreenContent({
  showScreen,
  videoSrc,
  originalVideoPath,
  isPlaying,
  screenStyle,
  videoRef,
  onVideoClick,
  videoCropStyle,
}: {
  showScreen: boolean;
  videoSrc: string | null | undefined;
  originalVideoPath: string | null | undefined;
  isPlaying: boolean | undefined;
  screenStyle: React.CSSProperties;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onVideoClick: () => void;
  videoCropStyle: React.CSSProperties;
}) {
  if (!showScreen) {
    return null;
  }

  return (
    <>
      <DynamicVideoLayer
        videoSrc={videoSrc}
        screenStyle={screenStyle}
        videoRef={videoRef}
        onVideoClick={onVideoClick}
        videoCropStyle={videoCropStyle}
      />
      <DynamicCanvasLayer
        originalVideoPath={originalVideoPath}
        isPlaying={isPlaying}
        screenStyle={screenStyle}
        videoCropStyle={videoCropStyle}
      />
    </>
  );
});

function DynamicVideoLayer({
  videoSrc,
  screenStyle,
  videoRef,
  onVideoClick,
  videoCropStyle,
}: {
  videoSrc: string | null | undefined;
  screenStyle: React.CSSProperties;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onVideoClick: () => void;
  videoCropStyle: React.CSSProperties;
}) {
  if (!videoSrc) return null;

  return (
    <div style={screenStyle}>
      <VideoNoZoom
        videoRef={videoRef}
        videoSrc={videoSrc}
        onVideoClick={onVideoClick}
        hidden={false}
        cropStyle={videoCropStyle}
      />
    </div>
  );
}

function DynamicCanvasLayer({
  originalVideoPath,
  isPlaying,
  screenStyle,
  videoCropStyle,
}: {
  originalVideoPath: string | null | undefined;
  isPlaying: boolean | undefined;
  screenStyle: React.CSSProperties;
  videoCropStyle: React.CSSProperties;
}) {
  if (!originalVideoPath || isPlaying) return null;

  return (
    <div style={screenStyle}>
      <WebCodecsCanvasNoZoom
        videoPath={originalVideoPath}
        cropStyle={videoCropStyle}
      />
    </div>
  );
}

function hasRenderableDynamicLayer(
  isVisible: boolean,
  width: number,
  height: number,
) {
  return isVisible && width > 0 && height > 0;
}

const DynamicCursorEffects = memo(function DynamicCursorEffects({
  showCursor,
  cursorRecording,
  cursorConfig,
  containerWidth,
  containerHeight,
  frameRenderWidth,
  frameRenderHeight,
  compositionRenderHeight,
  videoWidth,
  videoHeight,
  zoomRegions,
  backgroundPadding,
  rounding,
  cropConfig,
}: {
  showCursor: boolean;
  cursorRecording: CursorRecording | null | undefined;
  cursorConfig: CursorConfig | undefined;
  containerWidth: number;
  containerHeight: number;
  frameRenderWidth: number;
  frameRenderHeight: number;
  compositionRenderHeight: number;
  videoWidth: number;
  videoHeight: number;
  zoomRegions: ZoomRegion[] | undefined;
  backgroundPadding: number;
  rounding: number;
  cropConfig: CropConfig | undefined;
}) {
  if (!hasRenderableDynamicLayer(showCursor, containerWidth, containerHeight)) {
    return null;
  }

  return (
    <>
      <ClickHighlightOverlay
        cursorRecording={cursorRecording}
        clickHighlightConfig={cursorConfig?.clickHighlight}
        renderWidth={frameRenderWidth}
        renderHeight={frameRenderHeight}
        displayWidth={containerWidth}
        displayHeight={containerHeight}
        compositionRenderHeight={compositionRenderHeight}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
        zoomRegions={zoomRegions}
        backgroundPadding={backgroundPadding}
        rounding={rounding}
        cropConfig={cropConfig}
      />
      <CursorOverlay
        cursorRecording={cursorRecording}
        cursorConfig={cursorConfig}
        renderWidth={frameRenderWidth}
        renderHeight={frameRenderHeight}
        displayWidth={containerWidth}
        displayHeight={containerHeight}
        compositionRenderHeight={compositionRenderHeight}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
        zoomRegions={zoomRegions}
        backgroundPadding={backgroundPadding}
        rounding={rounding}
        cropConfig={cropConfig}
      />
    </>
  );
});

const DynamicAnnotationLayers = memo(function DynamicAnnotationLayers({
  showScreen,
  maskSegments,
  annotationSegments,
  textSegments,
  currentTimeMs,
  containerWidth,
  containerHeight,
  frameRenderWidth,
  frameRenderHeight,
  videoRef,
  videoWidth,
  videoHeight,
  cropConfig,
  annotationZoomScale,
}: {
  showScreen: boolean;
  maskSegments: MaskSegment[] | undefined;
  annotationSegments: AnnotationSegment[] | undefined;
  textSegments: TextSegment[] | undefined;
  currentTimeMs: number;
  containerWidth: number;
  containerHeight: number;
  frameRenderWidth: number;
  frameRenderHeight: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoWidth: number;
  videoHeight: number;
  cropConfig: CropConfig | undefined;
  annotationZoomScale: number;
}) {
  if (!showScreen || containerWidth <= 0 || containerHeight <= 0) {
    return null;
  }

  return (
    <>
      <DynamicMaskLayer
        segments={maskSegments}
        currentTimeMs={currentTimeMs}
        previewWidth={containerWidth}
        previewHeight={containerHeight}
        videoElement={videoRef.current}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
        cropConfig={cropConfig}
      />
      <DynamicAnnotationLayer
        segments={annotationSegments}
        currentTimeMs={currentTimeMs}
        previewWidth={containerWidth}
        previewHeight={containerHeight}
        zoomScale={annotationZoomScale}
      />
      <DynamicTextLayer
        segments={textSegments}
        currentTimeMs={currentTimeMs}
        renderWidth={frameRenderWidth}
        renderHeight={frameRenderHeight}
        displayWidth={containerWidth}
        displayHeight={containerHeight}
        zoomScale={annotationZoomScale}
      />
    </>
  );
});

function hasLayerSegments<T>(segments: T[] | undefined): segments is T[] {
  return Boolean(segments && segments.length > 0);
}

const DynamicMaskLayer = memo(function DynamicMaskLayer({
  segments,
  currentTimeMs,
  previewWidth,
  previewHeight,
  videoElement,
  videoWidth,
  videoHeight,
  cropConfig,
}: {
  segments: MaskSegment[] | undefined;
  currentTimeMs: number;
  previewWidth: number;
  previewHeight: number;
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
  cropConfig: CropConfig | undefined;
}) {
  return hasLayerSegments(segments) ? (
    <MaskOverlay
      segments={segments}
      currentTimeMs={currentTimeMs}
      previewWidth={previewWidth}
      previewHeight={previewHeight}
      videoElement={videoElement}
      videoWidth={videoWidth}
      videoHeight={videoHeight}
      cropConfig={cropConfig}
    />
  ) : null;
});

const DynamicAnnotationLayer = memo(function DynamicAnnotationLayer({
  segments,
  currentTimeMs,
  previewWidth,
  previewHeight,
  zoomScale,
}: {
  segments: AnnotationSegment[] | undefined;
  currentTimeMs: number;
  previewWidth: number;
  previewHeight: number;
  zoomScale: number;
}) {
  return hasLayerSegments(segments) ? (
    <AnnotationOverlay
      segments={segments}
      currentTimeMs={currentTimeMs}
      previewWidth={previewWidth}
      previewHeight={previewHeight}
      zoomScale={zoomScale}
    />
  ) : null;
});

const DynamicTextLayer = memo(function DynamicTextLayer({
  segments,
  currentTimeMs,
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  zoomScale,
}: {
  segments: TextSegment[] | undefined;
  currentTimeMs: number;
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
  zoomScale: number;
}) {
  return hasLayerSegments(segments) ? (
    <TextOverlay
      segments={segments}
      currentTimeMs={currentTimeMs}
      renderWidth={renderWidth}
      renderHeight={renderHeight}
      displayWidth={displayWidth}
      displayHeight={displayHeight}
      zoomScale={zoomScale}
    />
  ) : null;
});

const DynamicFullscreenWebcamLayer = memo(function DynamicFullscreenWebcamLayer({
  webcamVideoPath,
  webcamConfig,
  fullscreenWebcamStyle,
  frameStyle,
  cameraOnlyOpacity,
  onVideoClick,
}: {
  webcamVideoPath: string | undefined;
  webcamConfig: WebcamConfig | undefined;
  fullscreenWebcamStyle: React.CSSProperties;
  frameStyle: React.CSSProperties | undefined;
  cameraOnlyOpacity: number;
  onVideoClick: () => void;
}) {
  if (!webcamVideoPath) {
    return null;
  }

  return (
    <div style={getFullscreenWebcamLayerStyle(
      fullscreenWebcamStyle,
      frameStyle,
      cameraOnlyOpacity
    )}>
      <FullscreenWebcam
        webcamVideoPath={webcamVideoPath}
        mirror={webcamConfig?.mirror}
        onClick={onVideoClick}
      />
    </div>
  );
});

function getFullscreenWebcamLayerStyle(
  fullscreenWebcamStyle: React.CSSProperties,
  frameStyle: React.CSSProperties | undefined,
  cameraOnlyOpacity: number,
): React.CSSProperties {
  return {
    ...fullscreenWebcamStyle,
    ...frameStyle,
    overflow: 'hidden',
    ...getLayerVisibilityStyle(cameraOnlyOpacity > 0.01),
  };
}

function getLayerVisibilityStyle(isVisible: boolean): React.CSSProperties {
  return {
    visibility: isVisible ? 'visible' : 'hidden',
    pointerEvents: isVisible ? 'auto' : 'none',
  };
}

function getCombinedSceneFilter(sceneBlur: number, motionBlurFilter: string | undefined): string | undefined {
  const sceneBlurFilter = sceneBlur > 0.01 ? `blur(${sceneBlur * 20}px)` : undefined;
  return [sceneBlurFilter, motionBlurFilter].filter(Boolean).join(' ') || undefined;
}

function getDynamicScreenStyle(
  screenOpacity: number,
  combinedFilter: string | undefined
): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    opacity: screenOpacity,
    filter: combinedFilter,
  };
}

function getFullscreenWebcamStyle(scene: ReturnType<typeof useInterpolatedScene>): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 10,
    opacity: getCameraOnlyTransitionOpacity(scene),
    filter: scene.cameraOnlyBlur > 0.01 ? `blur(${scene.cameraOnlyBlur * 10}px)` : undefined,
    inset: 0,
    transform: `scale(${scene.cameraOnlyZoom})`,
  };
}

function getFrameZoomStyle({
  frameStyle,
  zoomStyle,
  showScreen,
  frameOpacity,
}: {
  frameStyle: React.CSSProperties | undefined;
  zoomStyle: React.CSSProperties;
  showScreen: boolean;
  frameOpacity: number;
}): React.CSSProperties {
  return {
    position: 'relative',
    overflow: 'hidden',
    ...ZOOM_LAYER_STYLE,
    ...frameStyle,
    ...(showScreen ? zoomStyle : {}),
    opacity: frameOpacity,
    visibility: frameOpacity < 0.01 ? 'hidden' : 'visible',
    width: '100%',
    height: '100%',
  };
}

function getShadowWrapperStyle(
  shadowStyle: React.CSSProperties | undefined
): React.CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    height: '100%',
    ...shadowStyle,
  };
}

const DynamicFrameBorderOverlay = memo(function DynamicFrameBorderOverlay({
  frameBorderOverlayStyle,
  showScreen,
  zoomStyle,
}: {
  frameBorderOverlayStyle: React.CSSProperties | null | undefined;
  showScreen: boolean;
  zoomStyle: React.CSSProperties;
}) {
  if (!frameBorderOverlayStyle) {
    return null;
  }

  return (
    <div style={{
      ...ZOOM_LAYER_STYLE,
      ...frameBorderOverlayStyle,
      ...(showScreen ? zoomStyle : {}),
    }} />
  );
});

/**
 * Scene mode aware renderer that shows/hides content based on current scene mode.
 */
const DynamicSceneModeRenderer = memo(function DynamicSceneModeRenderer({
  videoRef,
  videoSrc,
  zoomRegions,
  cursorRecording,
  cursorConfig,
  webcamVideoPath,
  webcamConfig,
  sceneSegments,
  defaultSceneMode,
  containerWidth,
  containerHeight,
  frameRenderWidth,
  frameRenderHeight,
  compositionRenderHeight,
  videoWidth,
  videoHeight,
  maskSegments,
  annotationSegments,
  textSegments,
  isPlaying,
  onVideoClick,
  backgroundPadding = 0,
  rounding = 0,
  frameStyle,
  frameBorderOverlayStyle,
  shadowStyle,
  cropConfig,
}: SceneModeRendererProps) {
  const currentTimeMs = usePreviewOrPlaybackTime();
  const toSourceTime = useTimelineToSourceTime();
  const scene = useInterpolatedScene(sceneSegments, defaultSceneMode, currentTimeMs);
  const motionBlurFilter = useZoomMotionBlurFilter(zoomRegions, currentTimeMs);

  const sourceTimeMs = useMemo(
    () => toSourceTime(currentTimeMs),
    [currentTimeMs, toSourceTime]
  );

  const showScreen = shouldRenderScreen(scene);
  const showCursor = shouldRenderCursor(scene);
  const cameraOnlyOpacity = getCameraOnlyTransitionOpacity(scene);
  const annotationZoomScale = useMemo(
    () => getZoomScaleAt(zoomRegions, currentTimeMs),
    [zoomRegions, currentTimeMs]
  );

  const originalVideoPath = useVideoEditorStore(selectScreenVideoPath);

  const zoomStyle = useZoomPreview(zoomRegions, currentTimeMs, cursorRecording, {
    backgroundPadding,
    rounding,
    videoWidth,
    videoHeight,
    cursorDampening: cursorConfig?.dampening ?? CURSOR.DAMPENING_DEFAULT,
    cursorTimeMs: sourceTimeMs,
  });
  const screenStyle = getDynamicScreenStyle(
    scene.screenOpacity,
    getCombinedSceneFilter(scene.screenBlur, motionBlurFilter)
  );
  const frameOpacity = 1 - cameraOnlyOpacity;
  const fullscreenWebcamStyle = getFullscreenWebcamStyle(scene);
  const frameZoomStyle = getFrameZoomStyle({
    frameStyle,
    zoomStyle,
    showScreen,
    frameOpacity,
  });

  const videoCropStyle = useVideoCropObjectFitStyle(cropConfig, videoWidth, videoHeight);

  return (
    <>
      {/* Shadow wrapper - position:relative for caption overlay positioning */}
      <div
        className="flex items-center justify-center"
        style={getShadowWrapperStyle(shadowStyle)}
      >
        {/* Frame wrapper */}
        <div style={frameZoomStyle}>
        <DynamicScreenContent
          showScreen={showScreen}
          videoSrc={videoSrc}
          originalVideoPath={originalVideoPath}
          isPlaying={isPlaying}
          screenStyle={screenStyle}
          videoRef={videoRef}
          onVideoClick={onVideoClick}
          videoCropStyle={videoCropStyle}
        />

        <DynamicCursorEffects
          showCursor={showCursor}
          cursorRecording={cursorRecording}
          cursorConfig={cursorConfig}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          frameRenderWidth={frameRenderWidth}
          frameRenderHeight={frameRenderHeight}
          compositionRenderHeight={compositionRenderHeight}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          zoomRegions={zoomRegions}
          backgroundPadding={backgroundPadding}
          rounding={rounding}
          cropConfig={cropConfig}
        />

        <DynamicAnnotationLayers
          showScreen={showScreen}
          maskSegments={maskSegments}
          annotationSegments={annotationSegments}
          textSegments={textSegments}
          currentTimeMs={currentTimeMs}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          frameRenderWidth={frameRenderWidth}
          frameRenderHeight={frameRenderHeight}
          videoRef={videoRef}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          cropConfig={cropConfig}
          annotationZoomScale={annotationZoomScale}
        />

        </div>

        {/* Squircle border overlay — outside the clipped frame so border extends outward.
            Apply the same zoom transform so the border follows the frame during zoom. */}
        <DynamicFrameBorderOverlay
          frameBorderOverlayStyle={frameBorderOverlayStyle}
          showScreen={showScreen}
          zoomStyle={zoomStyle}
        />
      </div>

      <DynamicFullscreenWebcamLayer
        webcamVideoPath={webcamVideoPath}
        webcamConfig={webcamConfig}
        fullscreenWebcamStyle={fullscreenWebcamStyle}
        frameStyle={frameStyle}
        cameraOnlyOpacity={cameraOnlyOpacity}
        onVideoClick={onVideoClick}
      />

    </>
  );
});

function hasDynamicSceneModeFeatures(props: SceneModeRendererProps) {
  return getDynamicSceneModeFeatureFlags(props).some(Boolean);
}

function getDynamicSceneModeFeatureFlags(props: SceneModeRendererProps) {
  return [
    Boolean(props.webcamVideoPath),
    Boolean(props.cursorRecording),
    hasLayerSegments(props.sceneSegments),
  ];
}

const SceneModeRenderer = memo(function SceneModeRenderer(props: SceneModeRendererProps) {
  if (!hasDynamicSceneModeFeatures(props)) {
    return <StaticSceneModeRenderer {...props} />;
  }

  return <DynamicSceneModeRenderer {...props} />;
});

function getOptimisticWrapperScale({
  previewArea,
  compositeSize,
  lastPreviewArea,
}: {
  previewArea: HTMLDivElement;
  compositeSize: Size;
  lastPreviewArea: Size;
}) {
  if (!canUseOptimisticWrapperScale(compositeSize, lastPreviewArea)) {
    return null;
  }

  const oldFit = getPreviewFitScale(lastPreviewArea, compositeSize);
  const newFit = getPreviewFitScale(getElementSize(previewArea), compositeSize);

  return getFitScaleRatio(oldFit, newFit);
}

function canUseOptimisticWrapperScale(compositeSize: Size, lastPreviewArea: Size) {
  return compositeSize.width > 0 && lastPreviewArea.width > 0 && lastPreviewArea.height > 0;
}

function getElementSize(element: HTMLElement): Size {
  return { width: element.clientWidth, height: element.clientHeight };
}

function getPreviewFitScale(previewArea: Size, compositeSize: Size) {
  return computeDPRCappedFitScale(
    previewArea.width,
    previewArea.height,
    compositeSize.width,
    compositeSize.height
  );
}

function getFitScaleRatio(oldFit: number, newFit: number) {
  return oldFit > 0 ? newFit / oldFit : null;
}

function usePreviewResizeTracking({
  containerRef,
  previewAreaRef,
  compositionWrapperRef,
  compositeRef,
  lastPreviewAreaRef,
  setContainerSize,
  setPreviewAreaSize,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  previewAreaRef: React.RefObject<HTMLDivElement | null>;
  compositionWrapperRef: React.RefObject<HTMLDivElement | null>;
  compositeRef: React.MutableRefObject<Size>;
  lastPreviewAreaRef: React.MutableRefObject<Size>;
  setContainerSize: React.Dispatch<React.SetStateAction<Size>>;
  setPreviewAreaSize: React.Dispatch<React.SetStateAction<Size>>;
}) {
  useEffect(() => {
    const container = containerRef.current;
    const previewArea = previewAreaRef.current;
    if (!container || !previewArea) return;

    const THROTTLE_MS = 100;
    let rafId: number | null = null;
    let trailingId: ReturnType<typeof setTimeout> | null = null;
    let lastFlushTime = 0;

    const flush = () => {
      rafId = null;
      lastFlushTime = performance.now();
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const pw = previewArea.clientWidth;
      const ph = previewArea.clientHeight;
      setContainerSize((prev) =>
        prev.width === cw && prev.height === ch ? prev : { width: cw, height: ch }
      );
      setPreviewAreaSize((prev) =>
        prev.width === pw && prev.height === ph ? prev : { width: pw, height: ph }
      );
    };

    const applyOptimisticWrapperScale = () => {
      const wrapper = compositionWrapperRef.current;
      const comp = compositeRef.current;
      const last = lastPreviewAreaRef.current;
      if (!wrapper) return;

      const scale = getOptimisticWrapperScale({
        previewArea,
        compositeSize: comp,
        lastPreviewArea: last,
      });
      if (scale !== null) {
        wrapper.style.transform = `scale(${scale})`;
      }
    };

    const requestResizeFlush = () => {
      const elapsed = performance.now() - lastFlushTime;
      if (elapsed >= THROTTLE_MS) {
        rafId = requestAnimationFrame(flush);
        return;
      }

      trailingId = setTimeout(() => {
        trailingId = null;
        rafId = requestAnimationFrame(flush);
      }, THROTTLE_MS - elapsed);
    };

    const schedule = () => {
      if (rafId !== null || trailingId !== null) return;

      applyOptimisticWrapperScale();
      requestResizeFlush();
    };

    flush();

    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(previewArea);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (trailingId !== null) clearTimeout(trailingId);
      observer.disconnect();
    };
  }, [
    compositeRef,
    compositionWrapperRef,
    containerRef,
    lastPreviewAreaRef,
    previewAreaRef,
    setContainerSize,
    setPreviewAreaSize,
  ]);
}

const HiddenPreviewAudioElements = memo(function HiddenPreviewAudioElements({
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

function getSystemPreviewAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return getPreviewAudioVolume(audioConfig?.systemMuted === true, audioConfig?.systemVolume);
}

function getMicPreviewAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return getPreviewAudioVolume(
    audioConfig?.microphoneMuted === true,
    audioConfig?.microphoneVolume
  );
}

function getTypewriterPreviewAudioVolume(audioConfig: AudioTrackSettings | undefined) {
  return getSystemPreviewAudioVolume(audioConfig);
}

function getPreviewAudioVolume(isMuted: boolean, volume: number | undefined) {
  return isMuted ? 0 : volume ?? 1;
}

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

const PreviewBackgroundLayers = memo(function PreviewBackgroundLayers({
  hasFrameStyling,
  backgroundConfig,
  wallpaperUrl,
}: {
  hasFrameStyling: boolean;
  backgroundConfig: PreviewBackgroundConfig | undefined;
  wallpaperUrl: string | null;
}) {
  const imageSrc = getPreviewBackgroundImageSrc(backgroundConfig);
  const layerSrc = hasFrameStyling ? getPreviewBackgroundLayerSrc(backgroundConfig, wallpaperUrl, imageSrc) : null;

  return layerSrc ? <PreviewBackgroundImageLayer src={layerSrc} /> : null;
});

function getPreviewBackgroundImageSrc(
  backgroundConfig: PreviewBackgroundConfig | undefined
): string | null {
  if (!hasPreviewBackgroundImage(backgroundConfig)) {
    return null;
  }

  return getResolvedPreviewBackgroundImageSrc(backgroundConfig.imagePath);
}

function hasPreviewBackgroundImage(
  backgroundConfig: PreviewBackgroundConfig | undefined
): backgroundConfig is PreviewBackgroundConfig & { bgType: 'image'; imagePath: string } {
  return backgroundConfig?.bgType === 'image' && Boolean(backgroundConfig.imagePath);
}

function getResolvedPreviewBackgroundImageSrc(imagePath: string) {
  return imagePath.startsWith('data:') ? imagePath : convertFileSrc(imagePath);
}

function getPreviewBackgroundLayerSrc(
  backgroundConfig: PreviewBackgroundConfig | undefined,
  wallpaperUrl: string | null,
  imageSrc: string | null
): string | null {
  if (backgroundConfig?.bgType === 'wallpaper') {
    return wallpaperUrl;
  }

  return imageSrc;
}

function PreviewBackgroundImageLayer({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{
        objectFit: 'cover',
        willChange: 'transform',
        transform: 'translateZ(0)',
        zIndex: 0,
      }}
    />
  );
}

const PreviewUnavailableState = memo(function PreviewUnavailableState({
  isActive,
}: {
  isActive: boolean;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-[var(--ink-subtle)]">
        {isActive ? 'No video loaded' : 'Preview paused while inactive'}
      </span>
    </div>
  );
});

const VideoErrorOverlay = memo(function VideoErrorOverlay({
  videoError,
  videoSrc,
}: {
  videoError: string | null;
  videoSrc: string | null;
}) {
  if (!videoError) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
      <span className="text-[var(--error)] text-sm mb-2">Video Error</span>
      <span className="text-[var(--ink-subtle)] text-xs">{videoError}</span>
      <span className="text-[var(--ink-faint)] text-xs mt-2 max-w-xs text-center break-all">
        {videoSrc}
      </span>
    </div>
  );
});

function getCropForInlineEditor(
  project: VideoProject,
  originalWidth: number,
  originalHeight: number
): CropConfig {
  return project.export.crop ?? {
    enabled: true,
    x: 0,
    y: 0,
    width: originalWidth,
    height: originalHeight,
    lockAspectRatio: false,
    aspectRatio: null,
  };
}

interface PreviewSceneRenderInput {
  project: VideoProject | null | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string | null;
  cursorRecording: CursorRecording | null | undefined;
  effectiveIsPlaying: boolean;
  togglePlayback: () => void;
  backgroundConfig: PreviewBackgroundConfig | undefined;
  cropConfig: CropConfig | undefined;
  frameStyle: React.CSSProperties;
  frameBorderOverlayStyle: React.CSSProperties | null;
  frameShadowStyle: React.CSSProperties;
  frameDisplaySize: Size;
  frameRenderSize: Size;
  compositeHeight: number;
}

function getPreviewSceneRendererProps({
  project,
  videoRef,
  videoSrc,
  cursorRecording,
  effectiveIsPlaying,
  togglePlayback,
  backgroundConfig,
  cropConfig,
  frameStyle,
  frameBorderOverlayStyle,
  frameShadowStyle,
  frameDisplaySize,
  frameRenderSize,
  compositeHeight,
}: PreviewSceneRenderInput): React.ComponentProps<typeof SceneModeRenderer> {
  const projectRendererProps = getPreviewProjectRendererProps(project);

  return {
    videoRef,
    videoSrc: videoSrc ?? undefined,
    cursorRecording,
    ...getPreviewSceneSizingProps(frameDisplaySize, frameRenderSize, compositeHeight),
    cropConfig,
    isPlaying: effectiveIsPlaying,
    onVideoClick: togglePlayback,
    ...getPreviewSceneBackgroundProps(backgroundConfig),
    frameStyle,
    frameBorderOverlayStyle,
    shadowStyle: frameShadowStyle,
    ...projectRendererProps,
  };
}

function getPreviewSceneSizingProps(frameDisplaySize: Size, frameRenderSize: Size, compositeHeight: number) {
  return {
    containerWidth: frameDisplaySize.width,
    containerHeight: frameDisplaySize.height,
    frameRenderWidth: frameRenderSize.width,
    frameRenderHeight: frameRenderSize.height,
    compositionRenderHeight: compositeHeight,
  };
}

function getPreviewSceneBackgroundProps(backgroundConfig: PreviewBackgroundConfig | undefined) {
  return {
    backgroundPadding: getPreviewBackgroundPadding(backgroundConfig),
    rounding: getPreviewBackgroundRounding(backgroundConfig),
  };
}

function getPreviewBackgroundPadding(backgroundConfig: PreviewBackgroundConfig | undefined) {
  return getNumberOrDefault(backgroundConfig?.padding, 0);
}

function getPreviewBackgroundRounding(backgroundConfig: PreviewBackgroundConfig | undefined) {
  return getNumberOrDefault(backgroundConfig?.rounding, 0);
}

function getPreviewProjectRendererProps(project: VideoProject | null | undefined) {
  return {
    ...getPreviewSourceRendererProps(project),
    ...getPreviewLayerRendererProps(project),
    ...getPreviewEffectRendererProps(project),
    ...getPreviewSceneModeRendererProps(project),
  };
}

function getPreviewSources(project: VideoProject | null | undefined) {
  return project?.sources ?? null;
}

function getPreviewVideoDimensions(project: VideoProject | null | undefined) {
  const sources = getPreviewSources(project);
  return {
    videoWidth: getPreviewVideoWidth(sources),
    videoHeight: getPreviewVideoHeight(sources),
  };
}

function getPreviewVideoWidth(sources: VideoProject['sources'] | null) {
  return getNumberOrDefault(sources?.originalWidth, DEFAULT_PREVIEW_VIDEO_SIZE.width);
}

function getPreviewVideoHeight(sources: VideoProject['sources'] | null) {
  return getNumberOrDefault(sources?.originalHeight, DEFAULT_PREVIEW_VIDEO_SIZE.height);
}

function getNumberOrDefault(value: number | null | undefined, fallback: number) {
  return value ?? fallback;
}

function getPreviewSourceRendererProps(project: VideoProject | null | undefined) {
  const sources = getPreviewSources(project);

  return {
    webcamVideoPath: sources?.webcamVideo ?? undefined,
    ...getPreviewVideoDimensions(project),
  };
}

function getPreviewLayerRendererProps(project: VideoProject | null | undefined) {
  return {
    maskSegments: project?.mask?.segments,
    annotationSegments: project?.annotations?.segments,
    textSegments: project?.text?.segments,
  };
}

function getPreviewEffectRendererProps(project: VideoProject | null | undefined) {
  return {
    zoomRegions: project?.zoom?.regions,
    cursorConfig: project?.cursor,
    webcamConfig: project?.webcam,
  };
}

function getPreviewSceneModeRendererProps(project: VideoProject | null | undefined) {
  return {
    sceneSegments: project?.scene?.segments,
    defaultSceneMode: project?.scene?.defaultMode ?? 'default',
  };
}

const PreviewSceneContent = memo(function PreviewSceneContent({
  isActive,
  project,
  videoRef,
  videoSrc,
  cursorRecording,
  effectiveIsPlaying,
  togglePlayback,
  backgroundConfig,
  cropConfig,
  frameStyle,
  frameBorderOverlayStyle,
  frameShadowStyle,
  frameDisplaySize,
  frameRenderSize,
  compositeHeight,
}: {
  isActive: boolean;
  project: VideoProject | null | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string | null;
  cursorRecording: CursorRecording | null | undefined;
  effectiveIsPlaying: boolean;
  togglePlayback: () => void;
  backgroundConfig: PreviewBackgroundConfig | undefined;
  cropConfig: CropConfig | undefined;
  frameStyle: React.CSSProperties;
  frameBorderOverlayStyle: React.CSSProperties | null;
  frameShadowStyle: React.CSSProperties;
  frameDisplaySize: Size;
  frameRenderSize: Size;
  compositeHeight: number;
}) {
  if (!isActive || (!videoSrc && !project?.sources.webcamVideo)) {
    return <PreviewUnavailableState isActive={isActive} />;
  }

  return <SceneModeRenderer {...getPreviewSceneRendererProps({
    project,
    videoRef,
    videoSrc,
    cursorRecording,
    effectiveIsPlaying,
    togglePlayback,
    backgroundConfig,
    cropConfig,
    frameStyle,
    frameBorderOverlayStyle,
    frameShadowStyle,
    frameDisplaySize,
    frameRenderSize,
    compositeHeight,
  })} />;
});

const CropEditingOverlayController = memo(function CropEditingOverlayController({
  isCropEditing,
  project,
  frameDisplaySize,
  originalWidth,
  originalHeight,
  updateExportConfig,
}: {
  isCropEditing: boolean;
  project: VideoProject | null | undefined;
  frameDisplaySize: Size;
  originalWidth: number;
  originalHeight: number;
  updateExportConfig: (updates: { crop: CropConfig }) => void;
}) {
  if (!canRenderCropEditingOverlay(isCropEditing, project, frameDisplaySize)) {
    return null;
  }

  return (
    <InlineCropOverlay
      crop={getCropForInlineEditor(project, originalWidth, originalHeight)}
      videoWidth={originalWidth}
      videoHeight={originalHeight}
      displayWidth={frameDisplaySize.width}
      displayHeight={frameDisplaySize.height}
      onCropChange={(next) => updateExportConfig({ crop: next })}
    />
  );
});

function canRenderCropEditingOverlay(
  isCropEditing: boolean,
  project: VideoProject | null | undefined,
  frameDisplaySize: Size,
): project is VideoProject {
  return isCropEditing && project != null && hasPositiveSize(frameDisplaySize);
}

function hasPositiveSize(size: Size) {
  return size.width > 0 && size.height > 0;
}

function canRenderPreviewWebcamOverlay(
  isActive: boolean,
  project: VideoProject | null | undefined,
  compositionSize: Size
): project is VideoProject & {
  sources: VideoProject['sources'] & { webcamVideo: string };
  webcam: NonNullable<VideoProject['webcam']>;
} {
  return Boolean(
    isActive &&
    project?.sources.webcamVideo &&
    project.webcam &&
    compositionSize.width > 0
  );
}

function getPreviewWebcamOverlayProps({
  project,
  compositionSize,
  compositeWidth,
}: {
  project: VideoProject & {
    sources: VideoProject['sources'] & { webcamVideo: string };
    webcam: NonNullable<VideoProject['webcam']>;
  };
  compositionSize: Size;
  compositeWidth: number;
}) {
  return {
    webcamVideoPath: project.sources.webcamVideo,
    config: project.webcam,
    containerWidth: compositionSize.width,
    containerHeight: compositionSize.height,
    renderWidth: compositeWidth,
    ...getPreviewWebcamSceneProps(project),
  };
}

function getPreviewWebcamSceneProps(project: VideoProject) {
  return {
    zoomRegions: project.zoom?.regions,
    sceneSegments: project.scene?.segments,
    defaultSceneMode: getPreviewDefaultSceneMode(project),
  };
}

function getPreviewDefaultSceneMode(project: VideoProject) {
  return project.scene?.defaultMode ?? 'default';
}

const PreviewWebcamOverlay = memo(function PreviewWebcamOverlay({
  isActive,
  project,
  compositionSize,
  compositeWidth,
}: {
  isActive: boolean;
  project: VideoProject | null | undefined;
  compositionSize: Size;
  compositeWidth: number;
}) {
  if (!canRenderPreviewWebcamOverlay(isActive, project, compositionSize)) {
    return null;
  }

  return (
    <SceneAwareWebcamOverlay
      {...getPreviewWebcamOverlayProps({
        project,
        compositionSize,
        compositeWidth,
      })}
    />
  );
});

const PreviewCaptionOverlay = memo(function PreviewCaptionOverlay({
  isActive,
  project,
  compositionSize,
  compositeWidth,
  compositeHeight,
}: {
  isActive: boolean;
  project: VideoProject | null | undefined;
  compositionSize: Size;
  compositeWidth: number;
  compositeHeight: number;
}) {
  if (!canRenderPreviewCaptionOverlay(isActive, compositionSize)) {
    return null;
  }

  const videoDimensions = getPreviewVideoDimensions(project);
  return (
    <UnifiedCaptionOverlay
      renderWidth={compositeWidth}
      renderHeight={compositeHeight}
      displayWidth={compositionSize.width}
      displayHeight={compositionSize.height}
      videoWidth={videoDimensions.videoWidth}
      videoHeight={videoDimensions.videoHeight}
    />
  );
});

function canRenderPreviewCaptionOverlay(isActive: boolean, compositionSize: Size) {
  return isActive && compositionSize.width > 0 && compositionSize.height > 0;
}

const PreviewCompositionOverlays = memo(function PreviewCompositionOverlays({
  isActive,
  project,
  compositionSize,
  compositeWidth,
  compositeHeight,
}: {
  isActive: boolean;
  project: VideoProject | null | undefined;
  compositionSize: Size;
  compositeWidth: number;
  compositeHeight: number;
}) {
  return (
    <>
      <PreviewWebcamOverlay
        isActive={isActive}
        project={project}
        compositionSize={compositionSize}
        compositeWidth={compositeWidth}
      />
      <PreviewCaptionOverlay
        isActive={isActive}
        project={project}
        compositionSize={compositionSize}
        compositeWidth={compositeWidth}
        compositeHeight={compositeHeight}
      />
    </>
  );
});

/**
 * Main video preview component.
 * Optimized to minimize re-renders during playback.
 */
interface GPUVideoPreviewProps {
  isActive?: boolean;
}

function getConvertedSource(path: string | null | undefined) {
  return path ? convertFileSrc(path) : null;
}

function getProjectAspectRatio(project: VideoProject | null | undefined) {
  return project?.sources.originalWidth && project?.sources.originalHeight
    ? project.sources.originalWidth / project.sources.originalHeight
    : 16 / 9;
}

function getCropAspectRatio(
  project: VideoProject | null | undefined,
  isCropEditing: boolean
) {
  if (isCropEditing) return null;
  const crop = project?.export?.crop;
  return hasEnabledCrop(crop) ? crop.width / crop.height : null;
}

function usePreviewSourceUrls(project: VideoProject | null | undefined) {
  return useMemo(() => getPreviewSourceUrls(project), [project]);
}

function getPreviewSourceUrls(project: VideoProject | null | undefined) {
  const videoSrc = getConvertedSource(project?.sources.screenVideo);
  const systemAudioSrc = getConvertedSource(project?.sources.systemAudio);
  const micAudioSrc = getConvertedSource(project?.sources.microphoneAudio);

  logPreviewAudioSources(project, systemAudioSrc, micAudioSrc);

  return { videoSrc, systemAudioSrc, micAudioSrc };
}

function logPreviewAudioSources(
  project: VideoProject | null | undefined,
  systemAudioSrc: string | null,
  micAudioSrc: string | null,
) {
  const logFields = getPreviewAudioLogFields(project, systemAudioSrc, micAudioSrc);
  videoEditorLogger.debug(`[Audio] System audio path: ${logFields.systemAudioPath}, src: ${logFields.systemAudioSrc}`);
  videoEditorLogger.debug(`[Audio] Mic audio path: ${logFields.micAudioPath}, src: ${logFields.micAudioSrc}`);
}

function getPreviewAudioLogFields(
  project: VideoProject | null | undefined,
  systemAudioSrc: string | null,
  micAudioSrc: string | null,
) {
  return {
    systemAudioPath: getLogFieldValue(project?.sources.systemAudio),
    systemAudioSrc: getLogFieldValue(systemAudioSrc),
    micAudioPath: getLogFieldValue(project?.sources.microphoneAudio),
    micAudioSrc: getLogFieldValue(micAudioSrc),
  };
}

function getLogFieldValue(value: string | null | undefined) {
  return value ?? 'none';
}

function useWallpaperUrl(backgroundConfig: PreviewBackgroundConfig | undefined) {
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);

  useEffect(() => {
    if (backgroundConfig?.bgType !== 'wallpaper' || !backgroundConfig.wallpaper) {
      setWallpaperUrl(null);
      return;
    }

    let cancelled = false;
    resolveResource(`assets/backgrounds/${backgroundConfig.wallpaper}.jpg`)
      .then((path) => {
        if (!cancelled) setWallpaperUrl(convertFileSrc(path));
      })
      .catch(() => {
        if (!cancelled) setWallpaperUrl(null);
      });

    return () => { cancelled = true; };
  }, [backgroundConfig?.bgType, backgroundConfig?.wallpaper]);

  return wallpaperUrl;
}

function getPreviewProjectConfig(
  project: VideoProject | null | undefined,
  isCropEditing: boolean
) {
  return {
    backgroundConfig: getPreviewProjectBackgroundConfig(project),
    cropConfig: getPreviewProjectCropConfig(project, isCropEditing),
    ...getPreviewProjectSourceDimensions(project),
  };
}

function getPreviewProjectBackgroundConfig(project: VideoProject | null | undefined) {
  return project?.export?.background;
}

function getPreviewProjectCropConfig(
  project: VideoProject | null | undefined,
  isCropEditing: boolean
) {
  return isCropEditing ? undefined : project?.export?.crop;
}

function getPreviewProjectSourceDimensions(project: VideoProject | null | undefined) {
  return {
    originalWidth: project?.sources.originalWidth ?? 1920,
    originalHeight: project?.sources.originalHeight ?? 1080,
  };
}

function getCompositionWrapperStyle(
  compositionSize: Size,
  hasFrameStyling: boolean,
  backgroundConfig: PreviewBackgroundConfig | undefined
): React.CSSProperties {
  return {
    width: compositionSize.width,
    height: compositionSize.height,
    boxSizing: 'border-box',
    background: getCompositionBackground(hasFrameStyling, backgroundConfig),
  };
}

function getPreviewContainerStyle({
  hasFrameStyling,
  frameOffset,
  frameDisplaySize,
  cropAspectRatio,
  aspectRatio,
}: {
  hasFrameStyling: boolean;
  frameOffset: { x: number; y: number };
  frameDisplaySize: Size;
  cropAspectRatio: number | null;
  aspectRatio: number;
}): React.CSSProperties {
  if (hasFrameStyling) {
    return {
      position: 'absolute',
      left: `${frameOffset.x}px`,
      top: `${frameOffset.y}px`,
      width: `${frameDisplaySize.width}px`,
      height: `${frameDisplaySize.height}px`,
    };
  }

  return {
    aspectRatio: cropAspectRatio ?? aspectRatio,
    width: '100%',
    maxHeight: '100%',
    filter: 'drop-shadow(0 4px 16px rgba(0, 0, 0, 0.4))',
  };
}

export function GPUVideoPreview({ isActive = true }: GPUVideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const systemAudioRef = useRef<HTMLAudioElement>(null);
  const micAudioRef = useRef<HTMLAudioElement>(null);
  const typewriterAudioRef = useRef<HTMLAudioElement>(null);
  const compositionWrapperRef = useRef<HTMLDivElement>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 0, height: 0 });

  // Use selectors for stable subscriptions
  const project = useVideoEditorStore(selectProject);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const cursorRecording = useVideoEditorStore(selectCursorRecording);
  const audioConfig = useVideoEditorStore(selectAudioConfig);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);
  const isCropEditing = useVideoEditorStore(selectIsCropEditing);
  const updateExportConfig = useVideoEditorStore(selectUpdateExportConfig);
  const effectiveIsPlaying = isPlaying && isActive;
  const handleVideoError = useCallback((msg: string) => setVideoError(msg || null), []);

  // --- Resize tracking with CSS-transform fast path ---
  // Between throttle ticks, scale the composition wrapper via GPU-composited
  // CSS transform (instant, zero React re-renders). The real state update
  // fires at ~10fps, triggering a full render at the correct size.
  // useLayoutEffect clears the transform synchronously after React commits
  // the new layout, preventing any visual flash.
  // (compositeRef/lastPreviewAreaRef sync effects are after usePreviewStyles below)
  const compositeRef = useRef({ width: 0, height: 0 });
  const lastPreviewAreaRef = useRef({ width: 0, height: 0 });

  usePreviewResizeTracking({
    containerRef,
    previewAreaRef,
    compositionWrapperRef,
    compositeRef,
    lastPreviewAreaRef,
    setContainerSize,
    setPreviewAreaSize,
  });

  const { videoSrc, systemAudioSrc, micAudioSrc } = usePreviewSourceUrls(project);

  const typewriterAudioSrc = TEXT_ANIMATION.TYPEWRITER_SOUND_LOOP_PATH;
  // Get aspect ratio from project
  const aspectRatio = useMemo(() => getProjectAspectRatio(project), [project]);

  // Calculate crop aspect ratio. Suppressed while crop edit mode is active so
  // the preview shows the full uncropped frame for the drag overlay.
  const cropAspectRatio = useMemo(
    () => getCropAspectRatio(project, isCropEditing),
    [project, isCropEditing]
  );

  const { backgroundConfig, cropConfig, originalWidth, originalHeight } = getPreviewProjectConfig(
    project,
    isCropEditing
  );
  const wallpaperUrl = useWallpaperUrl(backgroundConfig);

  // Use extracted style calculations
  const {
    hasFrameStyling,
    frameStyle,
    frameShadowStyle,
    frameBorderOverlayStyle,
    compositionSize,
    frameDisplaySize,
    frameOffset,
    compositeWidth,
    compositeHeight,
    frameRenderSize,
  } = usePreviewStyles({
    backgroundConfig,
    cropConfig,
    compositionConfig: project?.export?.composition,
    originalWidth,
    originalHeight,
    containerSize,
    previewAreaSize,
  });

  // Sync composite dimensions to ref for the CSS-transform resize fast path
  useEffect(() => {
    compositeRef.current = { width: compositeWidth, height: compositeHeight };
  }, [compositeWidth, compositeHeight]);

  // After React renders with new sizes, clear the CSS transform and record
  // the rendered preview area size so the next transform delta is correct.
  useLayoutEffect(() => {
    if (compositionWrapperRef.current) {
      compositionWrapperRef.current.style.transform = '';
    }
    lastPreviewAreaRef.current = { width: previewAreaSize.width, height: previewAreaSize.height };
  }, [previewAreaSize.width, previewAreaSize.height]);

  const compositionWrapperStyle = getCompositionWrapperStyle(
    compositionSize,
    hasFrameStyling,
    backgroundConfig
  );
  const previewContainerStyle = getPreviewContainerStyle({
    hasFrameStyling,
    frameOffset,
    frameDisplaySize,
    cropAspectRatio,
    aspectRatio,
  });

  return (
    <div ref={previewAreaRef} className="flex items-center justify-center h-full overflow-hidden">
      <PlaybackSyncController
        videoRef={videoRef}
        systemAudioRef={systemAudioRef}
        micAudioRef={micAudioRef}
        videoSrc={videoSrc}
        systemAudioSrc={systemAudioSrc}
        micAudioSrc={micAudioSrc}
        audioConfig={audioConfig}
        durationMs={project?.timeline.durationMs}
        isPlaying={effectiveIsPlaying}
        onVideoError={handleVideoError}
      />
      <TypewriterAudioController
        typewriterAudioRef={typewriterAudioRef}
        isActive={isActive}
        isPlaying={effectiveIsPlaying}
        audioConfig={audioConfig}
        textSegments={project?.text?.segments}
      />

      {/* Hidden audio elements */}
      <HiddenPreviewAudioElements
        isActive={isActive}
        systemAudioSrc={systemAudioSrc}
        micAudioSrc={micAudioSrc}
        typewriterAudioSrc={typewriterAudioSrc}
        systemAudioRef={systemAudioRef}
        micAudioRef={micAudioRef}
        typewriterAudioRef={typewriterAudioRef}
        audioConfig={audioConfig}
      />

      {/* Outer wrapper for background */}
      <div
        ref={compositionWrapperRef}
        className="relative overflow-hidden"
        style={compositionWrapperStyle}
      >
        <PreviewBackgroundLayers
          hasFrameStyling={hasFrameStyling}
          backgroundConfig={backgroundConfig}
          wallpaperUrl={wallpaperUrl}
        />
        <div
          ref={containerRef}
          className="relative z-10 flex items-center justify-center"
          style={previewContainerStyle}
        >
          <PreviewSceneContent
            isActive={isActive}
            project={project}
            videoRef={videoRef}
            videoSrc={videoSrc}
            cursorRecording={cursorRecording}
            effectiveIsPlaying={effectiveIsPlaying}
            togglePlayback={togglePlayback}
            backgroundConfig={backgroundConfig}
            cropConfig={cropConfig}
            frameStyle={frameStyle}
            frameBorderOverlayStyle={frameBorderOverlayStyle}
            frameShadowStyle={frameShadowStyle}
            frameDisplaySize={frameDisplaySize}
            frameRenderSize={frameRenderSize}
            compositeHeight={compositeHeight}
          />

          {/* Error overlay */}
          <VideoErrorOverlay videoError={videoError} videoSrc={videoSrc} />

          <CropEditingOverlayController
            isCropEditing={isCropEditing}
            project={project}
            frameDisplaySize={frameDisplaySize}
            originalWidth={originalWidth}
            originalHeight={originalHeight}
            updateExportConfig={updateExportConfig}
          />

        </div>

        <PreviewCompositionOverlays
          isActive={isActive}
          project={project}
          compositionSize={compositionSize}
          compositeWidth={compositeWidth}
          compositeHeight={compositeHeight}
        />
      </div>
    </div>
  );
}
