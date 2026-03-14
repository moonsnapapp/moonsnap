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
} from '../../stores/videoEditor/selectors';
import { videoEditorLogger } from '../../utils/logger';
import { computeDPRCappedFitScale } from '../../utils/compositionBounds';
import { hasEnabledCrop } from '../../utils/videoContentDimensions';
import { hasActiveTypewriterSound } from '../../utils/textSegmentAnimation';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { usePreviewOrPlaybackTimeThrottled } from '../../hooks/usePlaybackTimeThrottled';
import { useTimelineToSourceTime } from '../../hooks/useTimelineSourceTime';
import { getZoomScaleAt, useZoomPreview } from '../../hooks/useZoomPreview';
import { useInterpolatedScene, shouldRenderScreen, shouldRenderCursor, getCameraOnlyTransitionOpacity, getRegularCameraTransitionOpacity } from '../../hooks/useSceneMode';
import { WebcamOverlay } from './WebcamOverlay';
import { CursorOverlay } from './CursorOverlay';
import { ClickHighlightOverlay } from './ClickHighlightOverlay';
import { MaskOverlay } from './MaskOverlay';
import { TextOverlay } from './TextOverlay';
import { AnnotationOverlay } from './AnnotationOverlay';

import { UnifiedCaptionOverlay } from './UnifiedCaptionOverlay';
import {
  WebCodecsCanvasNoZoom,
  VideoNoZoom,
  FullscreenWebcam,
  usePreviewStyles,
  usePlaybackSync,
} from './gpu';
import type { SceneSegment, SceneMode, WebcamConfig, ZoomRegion, CursorRecording, CursorConfig, AnnotationSegment, MaskSegment, TextSegment, CropConfig, AudioTrackSettings } from '../../types';

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
    if (!audio || !isActive) {
      return;
    }

    audio.volume = audioConfig?.systemMuted ? 0 : (audioConfig?.systemVolume ?? 1);
  }, [audioConfig?.systemMuted, audioConfig?.systemVolume, isActive, typewriterAudioRef]);

  useEffect(() => {
    const audio = typewriterAudioRef.current;
    if (!audio || !isActive) {
      return;
    }

    const shouldPlay = isPlaying && shouldPlayTypewriterAudio;
    if (shouldPlay) {
      if (audio.paused) {
        audio.play().catch((error) => {
          videoEditorLogger.warn('Typewriter audio play failed:', error);
        });
      }
      return;
    }

    if (!audio.paused) {
      audio.pause();
    }
    if (audio.currentTime !== 0) {
      audio.currentTime = 0;
    }
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

  if (!segments || segments.length === 0 || previewWidth <= 0 || previewHeight <= 0) {
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

  if (!segments || segments.length === 0 || displayWidth <= 0 || displayHeight <= 0) {
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

  if (!segments || segments.length === 0 || displayWidth <= 0 || displayHeight <= 0) {
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
  const frameOpacity = defaultSceneMode === 'cameraOnly' ? 0 : 1;
  const frameRef = useRef<HTMLDivElement>(null);
  const borderOverlayRef = useRef<HTMLDivElement>(null);

  const videoCropStyle: React.CSSProperties = useMemo(() => {
    if (!hasEnabledCrop(cropConfig) || !cropConfig) {
      return {};
    }

    const overflowX = videoWidth - cropConfig.width;
    const overflowY = videoHeight - cropConfig.height;

    const posX = overflowX > 0 ? (cropConfig.x / overflowX) * 100 : 50;
    const posY = overflowY > 0 ? (cropConfig.y / overflowY) * 100 : 50;

    return {
      objectFit: 'cover' as const,
      objectPosition: `${posX}% ${posY}%`,
    };
  }, [cropConfig, videoHeight, videoWidth]);

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
        style={{
          position: 'relative',
          overflow: 'hidden',
          ...frameStyle,
          opacity: frameOpacity,
          visibility: frameOpacity < 0.01 ? 'hidden' : 'visible',
          width: '100%',
          height: '100%',
        }}
      >
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

      {frameBorderOverlayStyle && <div ref={borderOverlayRef} style={frameBorderOverlayStyle} />}
    </div>
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

  const screenStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    opacity: scene.screenOpacity,
    filter: scene.screenBlur > 0.01 ? `blur(${scene.screenBlur * 20}px)` : undefined,
  };

  const frameOpacity = 1 - cameraOnlyOpacity;

  const cropEnabled = hasEnabledCrop(cropConfig);

  const fullscreenWebcamStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 10,
    opacity: cameraOnlyOpacity,
    filter: scene.cameraOnlyBlur > 0.01 ? `blur(${scene.cameraOnlyBlur * 10}px)` : undefined,
    inset: 0,
    transform: `scale(${scene.cameraOnlyZoom})`,
  };

  const frameZoomStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...frameStyle,
    ...(showScreen ? zoomStyle : {}),
    opacity: frameOpacity,
    visibility: frameOpacity < 0.01 ? 'hidden' : 'visible',
    width: '100%',
    height: '100%',
  };

  const videoCropStyle: React.CSSProperties = useMemo(() => {
    if (!cropEnabled || !cropConfig) {
      return {};
    }

    const overflowX = videoWidth - cropConfig.width;
    const overflowY = videoHeight - cropConfig.height;

    const posX = overflowX > 0 ? (cropConfig.x / overflowX) * 100 : 50;
    const posY = overflowY > 0 ? (cropConfig.y / overflowY) * 100 : 50;

    return {
      objectFit: 'cover' as const,
      objectPosition: `${posX}% ${posY}%`,
    };
  }, [cropEnabled, cropConfig, videoWidth, videoHeight]);

  return (
    <>
      {/* Shadow wrapper - position:relative for caption overlay positioning */}
      <div
        className="flex items-center justify-center"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          ...shadowStyle,
        }}
      >
        {/* Frame wrapper */}
        <div style={frameZoomStyle}>
        {/* Screen video */}
        {videoSrc && showScreen && (
          <div style={screenStyle}>
            <VideoNoZoom
              videoRef={videoRef}
              videoSrc={videoSrc}
              onVideoClick={onVideoClick}
              hidden={false}
              cropStyle={videoCropStyle}
            />
          </div>
        )}

        {/* WebCodecs preview canvas */}
        {showScreen && originalVideoPath && !isPlaying && (
          <div style={screenStyle}>
            <WebCodecsCanvasNoZoom
              videoPath={originalVideoPath}
              cropStyle={videoCropStyle}
            />
          </div>
        )}

        {/* Click highlight overlay */}
        {showCursor && containerWidth > 0 && containerHeight > 0 && (
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
        )}

        {/* Cursor overlay */}
        {showCursor && containerWidth > 0 && containerHeight > 0 && (
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
        )}

        {/* Mask overlay */}
        {showScreen && maskSegments && maskSegments.length > 0 && containerWidth > 0 && containerHeight > 0 && (
          <MaskOverlay
            segments={maskSegments}
            currentTimeMs={currentTimeMs}
            previewWidth={containerWidth}
            previewHeight={containerHeight}
            videoElement={videoRef.current}
            videoWidth={videoWidth}
            videoHeight={videoHeight}
            cropConfig={cropConfig}
          />
        )}

        {showScreen && annotationSegments && annotationSegments.length > 0 && containerWidth > 0 && containerHeight > 0 && (
          <AnnotationOverlay
            segments={annotationSegments}
            currentTimeMs={currentTimeMs}
            previewWidth={containerWidth}
            previewHeight={containerHeight}
            zoomScale={annotationZoomScale}
          />
        )}

        {/* Text overlay - bounding boxes for interaction */}
        {showScreen && textSegments && textSegments.length > 0 && containerWidth > 0 && containerHeight > 0 && (
          <TextOverlay
            segments={textSegments}
            currentTimeMs={currentTimeMs}
            renderWidth={frameRenderWidth}
            renderHeight={frameRenderHeight}
            displayWidth={containerWidth}
            displayHeight={containerHeight}
            zoomScale={annotationZoomScale}
          />
        )}

        </div>

        {/* Squircle border overlay — outside the clipped frame so border extends outward.
            Apply the same zoom transform so the border follows the frame during zoom. */}
        {frameBorderOverlayStyle && <div style={{
          ...frameBorderOverlayStyle,
          ...(showScreen ? zoomStyle : {}),
        }} />}
      </div>

      {/* Fullscreen webcam - outside the frame wrapper */}
      {webcamVideoPath && (
        <div style={{
          ...fullscreenWebcamStyle,
          ...frameStyle,
          overflow: 'hidden',
          visibility: cameraOnlyOpacity > 0.01 ? 'visible' : 'hidden',
          pointerEvents: cameraOnlyOpacity > 0.01 ? 'auto' : 'none',
        }}>
          <FullscreenWebcam
            webcamVideoPath={webcamVideoPath}
            mirror={webcamConfig?.mirror}
            onClick={onVideoClick}
          />
        </div>
      )}

    </>
  );
});

const SceneModeRenderer = memo(function SceneModeRenderer(props: SceneModeRendererProps) {
  const hasSceneModeFeatures = Boolean(
    props.webcamVideoPath ||
    props.cursorRecording ||
    (props.sceneSegments?.length ?? 0) > 0
  );

  if (!hasSceneModeFeatures) {
    return <StaticSceneModeRenderer {...props} />;
  }

  return <DynamicSceneModeRenderer {...props} />;
});

/**
 * Main video preview component.
 * Optimized to minimize re-renders during playback.
 */
interface GPUVideoPreviewProps {
  isActive?: boolean;
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
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);

  // Use selectors for stable subscriptions
  const project = useVideoEditorStore(selectProject);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const cursorRecording = useVideoEditorStore(selectCursorRecording);
  const audioConfig = useVideoEditorStore(selectAudioConfig);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);
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

    const schedule = () => {
      // Skip if an update is already pending (leading+trailing throttle)
      if (rafId !== null || trailingId !== null) return;

      // Apply CSS transform for instant visual feedback between throttle ticks
      const wrapper = compositionWrapperRef.current;
      const comp = compositeRef.current;
      const last = lastPreviewAreaRef.current;
      if (wrapper && comp.width > 0 && last.width > 0 && last.height > 0) {
        const oldFit = computeDPRCappedFitScale(last.width, last.height, comp.width, comp.height);
        const newFit = computeDPRCappedFitScale(
          previewArea.clientWidth, previewArea.clientHeight, comp.width, comp.height,
        );
        if (oldFit > 0) {
          wrapper.style.transform = `scale(${newFit / oldFit})`;
        }
      }

      const elapsed = performance.now() - lastFlushTime;
      if (elapsed >= THROTTLE_MS) {
        rafId = requestAnimationFrame(flush);
      } else {
        trailingId = setTimeout(() => {
          trailingId = null;
          rafId = requestAnimationFrame(flush);
        }, THROTTLE_MS - elapsed);
      }
    };

    // Initial measurement (synchronous so first paint is correct)
    flush();

    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(previewArea);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (trailingId !== null) clearTimeout(trailingId);
      observer.disconnect();
    };
  }, []);

  // Convert file paths to URLs
  const videoSrc = useMemo(() => {
    return project?.sources.screenVideo
      ? convertFileSrc(project.sources.screenVideo)
      : null;
  }, [project?.sources.screenVideo]);

  const systemAudioSrc = useMemo(() => {
    const src = project?.sources.systemAudio
      ? convertFileSrc(project.sources.systemAudio)
      : null;
    videoEditorLogger.debug(`[Audio] System audio path: ${project?.sources.systemAudio ?? 'none'}, src: ${src ?? 'none'}`);
    return src;
  }, [project?.sources.systemAudio]);

  const micAudioSrc = useMemo(() => {
    const src = project?.sources.microphoneAudio
      ? convertFileSrc(project.sources.microphoneAudio)
      : null;
    videoEditorLogger.debug(`[Audio] Mic audio path: ${project?.sources.microphoneAudio ?? 'none'}, src: ${src ?? 'none'}`);
    return src;
  }, [project?.sources.microphoneAudio]);

  const typewriterAudioSrc = TEXT_ANIMATION.TYPEWRITER_SOUND_LOOP_PATH;
  // Get aspect ratio from project
  const aspectRatio = useMemo(() => {
    return project?.sources.originalWidth && project?.sources.originalHeight
      ? project.sources.originalWidth / project.sources.originalHeight
      : 16 / 9;
  }, [project?.sources.originalWidth, project?.sources.originalHeight]);

  // Calculate crop aspect ratio
  const cropAspectRatio = useMemo(() => {
    const crop = project?.export?.crop;
    if (hasEnabledCrop(crop)) {
      return crop.width / crop.height;
    }
    return null;
  }, [project?.export?.crop]);

  // Get config values
  const backgroundConfig = project?.export?.background;
  const cropConfig = project?.export?.crop;
  const originalWidth = project?.sources.originalWidth ?? 1920;
  const originalHeight = project?.sources.originalHeight ?? 1080;

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

  // Resolve wallpaper URL
  useEffect(() => {
    if (backgroundConfig?.bgType !== 'wallpaper' || !backgroundConfig.wallpaper) {
      setWallpaperUrl(null);
      return;
    }

    let cancelled = false;
    resolveResource(`assets/backgrounds/${backgroundConfig.wallpaper}.jpg`)
      .then(path => {
        if (!cancelled) {
          setWallpaperUrl(convertFileSrc(path));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWallpaperUrl(null);
        }
      });

    return () => { cancelled = true; };
  }, [backgroundConfig?.bgType, backgroundConfig?.wallpaper]);

  return (
    <div ref={previewAreaRef} className="flex items-center justify-center h-full bg-[var(--polar-snow)] overflow-hidden">
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
      {isActive && systemAudioSrc && (
        <audio
          ref={systemAudioRef}
          src={systemAudioSrc}
          preload="auto"
          style={{ display: 'none' }}
          onLoadedData={(e) => {
            const audio = e.currentTarget;
            if (audioConfig) {
              audio.volume = audioConfig.systemMuted ? 0 : audioConfig.systemVolume;
            }
          }}
        />
      )}
      {isActive && micAudioSrc && (
        <audio
          ref={micAudioRef}
          src={micAudioSrc}
          preload="auto"
          style={{ display: 'none' }}
          onLoadedData={(e) => {
            const audio = e.currentTarget;
            if (audioConfig) {
              audio.volume = audioConfig.microphoneMuted ? 0 : audioConfig.microphoneVolume;
            }
          }}
        />
      )}
      {isActive && (
        <audio
          ref={typewriterAudioRef}
          src={typewriterAudioSrc}
          preload="auto"
          loop
          style={{ display: 'none' }}
          onLoadedData={(e) => {
            const audio = e.currentTarget;
            audio.volume = audioConfig?.systemMuted ? 0 : (audioConfig?.systemVolume ?? 1);
          }}
        />
      )}

      {/* Outer wrapper for background */}
      <div
        ref={compositionWrapperRef}
        className="relative overflow-hidden"
        style={{
          width: compositionSize.width,
          height: compositionSize.height,
          boxSizing: 'border-box',
          background: hasFrameStyling
            ? backgroundConfig?.bgType === 'solid'
              ? backgroundConfig.solidColor
              : backgroundConfig?.bgType === 'gradient'
                ? `linear-gradient(${backgroundConfig.gradientAngle}deg, ${backgroundConfig.gradientStart}, ${backgroundConfig.gradientEnd})`
                : undefined
            : undefined,
        }}
      >
        {/* Wallpaper background layer */}
        {hasFrameStyling && backgroundConfig?.bgType === 'wallpaper' && wallpaperUrl && (
          <img
            src={wallpaperUrl}
            alt=""
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              objectFit: 'cover',
              willChange: 'transform',
              transform: 'translateZ(0)',
              zIndex: 0,
            }}
          />
        )}
        {/* Custom image background layer */}
        {hasFrameStyling && backgroundConfig?.bgType === 'image' && backgroundConfig.imagePath && (
          <img
            src={backgroundConfig.imagePath.startsWith('data:')
              ? backgroundConfig.imagePath
              : convertFileSrc(backgroundConfig.imagePath)
            }
            alt=""
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              objectFit: 'cover',
              willChange: 'transform',
              transform: 'translateZ(0)',
              zIndex: 0,
            }}
          />
        )}
        <div
          ref={containerRef}
          className="relative z-10 flex items-center justify-center"
          style={{
            ...(hasFrameStyling ? {
              position: 'absolute',
              left: `${frameOffset.x}px`,
              top: `${frameOffset.y}px`,
              width: `${frameDisplaySize.width}px`,
              height: `${frameDisplaySize.height}px`,
            } : {
              aspectRatio: cropAspectRatio ?? aspectRatio,
              width: '100%',
              maxHeight: '100%',
              filter: 'drop-shadow(0 4px 16px rgba(0, 0, 0, 0.4))',
            }),
          }}
        >
          {isActive && (videoSrc || project?.sources.webcamVideo) ? (
            <SceneModeRenderer
              videoRef={videoRef}
              videoSrc={videoSrc ?? undefined}
              zoomRegions={project?.zoom?.regions}
              cursorRecording={cursorRecording}
              cursorConfig={project?.cursor}
              webcamVideoPath={project?.sources.webcamVideo ?? undefined}
              webcamConfig={project?.webcam}
              sceneSegments={project?.scene?.segments}
              defaultSceneMode={project?.scene?.defaultMode ?? 'default'}
              containerWidth={frameDisplaySize.width}
              containerHeight={frameDisplaySize.height}
              frameRenderWidth={frameRenderSize.width}
              frameRenderHeight={frameRenderSize.height}
              compositionRenderHeight={compositeHeight}
              videoWidth={project?.sources.originalWidth ?? 1920}
              cropConfig={cropConfig}
              videoHeight={project?.sources.originalHeight ?? 1080}
              maskSegments={project?.mask?.segments}
              annotationSegments={project?.annotations?.segments}
              textSegments={project?.text?.segments}
              isPlaying={effectiveIsPlaying}
              onVideoClick={togglePlayback}
              backgroundPadding={backgroundConfig?.padding ?? 0}
              rounding={backgroundConfig?.rounding ?? 0}
              frameStyle={frameStyle}
              frameBorderOverlayStyle={frameBorderOverlayStyle}
              shadowStyle={frameShadowStyle}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[var(--ink-subtle)]">
                {isActive ? 'No video loaded' : 'Preview paused while inactive'}
              </span>
            </div>
          )}

          {/* Error overlay */}
          {videoError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
              <span className="text-[var(--error)] text-sm mb-2">Video Error</span>
              <span className="text-[var(--ink-subtle)] text-xs">{videoError}</span>
              <span className="text-[var(--ink-faint)] text-xs mt-2 max-w-xs text-center break-all">
                {videoSrc}
              </span>
            </div>
          )}

        </div>

        {/* Webcam overlay */}
        {isActive && project?.sources.webcamVideo && project?.webcam && compositionSize.width > 0 && (
          <SceneAwareWebcamOverlay
            webcamVideoPath={project.sources.webcamVideo}
            config={project.webcam}
            containerWidth={compositionSize.width}
            containerHeight={compositionSize.height}
            renderWidth={compositeWidth}
            zoomRegions={project?.zoom?.regions}
            sceneSegments={project.scene?.segments}
            defaultSceneMode={project.scene?.defaultMode ?? 'default'}
          />
        )}

        {/* Caption overlay - positioned relative to composition (video + padding) to match export */}
        {isActive && compositionSize.width > 0 && compositionSize.height > 0 && (
          <UnifiedCaptionOverlay
            renderWidth={compositeWidth}
            renderHeight={compositeHeight}
            displayWidth={compositionSize.width}
            displayHeight={compositionSize.height}
            videoWidth={project?.sources.originalWidth ?? 1920}
            videoHeight={project?.sources.originalHeight ?? 1080}
          />
        )}
      </div>
    </div>
  );
}
