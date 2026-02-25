import { memo, useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectProject,
  selectIsPlaying,
  selectPreviewTimeMs,
  selectCurrentTimeMs,
  selectCursorRecording,
  selectAudioConfig,
  selectScreenVideoPath,
} from '../../stores/videoEditor/selectors';
import { videoEditorLogger } from '../../utils/logger';
import { hasEnabledCrop } from '../../utils/videoContentDimensions';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../hooks/useTimelineSourceTime';
import { useZoomPreview } from '../../hooks/useZoomPreview';
import { useInterpolatedScene, shouldRenderScreen, shouldRenderCursor, getCameraOnlyTransitionOpacity, getRegularCameraTransitionOpacity } from '../../hooks/useSceneMode';
import { WebcamOverlay } from './WebcamOverlay';
import { CursorOverlay } from './CursorOverlay';
import { ClickHighlightOverlay } from './ClickHighlightOverlay';
import { MaskOverlay } from './MaskOverlay';
import { TextOverlay } from './TextOverlay';

import { UnifiedCaptionOverlay } from './UnifiedCaptionOverlay';
import {
  WebCodecsCanvasNoZoom,
  VideoNoZoom,
  FullscreenWebcam,
  usePreviewStyles,
  usePlaybackSync,
} from './gpu';
import type { SceneSegment, SceneMode, WebcamConfig, ZoomRegion, CursorRecording, CursorConfig, MaskSegment, TextSegment, CropConfig } from '../../types';

/**
 * Scene mode aware renderer that shows/hides content based on current scene mode.
 */
const SceneModeRenderer = memo(function SceneModeRenderer({
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
  textSegments,
  isPlaying,
  onVideoClick,
  backgroundPadding = 0,
  rounding = 0,
  frameStyle,
  shadowStyle,
  cropConfig,
}: {
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
  textSegments: TextSegment[] | undefined;
  isPlaying?: boolean;
  onVideoClick: () => void;
  backgroundPadding?: number;
  rounding?: number;
  frameStyle?: React.CSSProperties;
  shadowStyle?: React.CSSProperties;
  cropConfig?: CropConfig;
}) {
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

  const originalVideoPath = useVideoEditorStore(selectScreenVideoPath);

  const zoomStyle = useZoomPreview(zoomRegions, currentTimeMs, cursorRecording, {
    backgroundPadding,
    rounding,
    videoWidth,
    videoHeight,
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

        {/* Text overlay - bounding boxes for interaction */}
        {showScreen && textSegments && textSegments.length > 0 && containerWidth > 0 && containerHeight > 0 && (
          <TextOverlay
            segments={textSegments}
            currentTimeMs={currentTimeMs}
            renderWidth={frameRenderWidth}
            renderHeight={frameRenderHeight}
            displayWidth={containerWidth}
            displayHeight={containerHeight}
          />
        )}

        </div>
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

/**
 * Main video preview component.
 * Optimized to minimize re-renders during playback.
 */
export function GPUVideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const systemAudioRef = useRef<HTMLAudioElement>(null);
  const micAudioRef = useRef<HTMLAudioElement>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 0, height: 0 });
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);


  // Use selectors for stable subscriptions
  const project = useVideoEditorStore(selectProject);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const previewTimeMs = useVideoEditorStore(selectPreviewTimeMs);
  const currentTimeMs = useVideoEditorStore(selectCurrentTimeMs);
  const cursorRecording = useVideoEditorStore(selectCursorRecording);
  const audioConfig = useVideoEditorStore(selectAudioConfig);

  // Get effective time for scene interpolation
  const effectiveTimeMs = previewTimeMs !== null ? previewTimeMs : currentTimeMs;

  // Get interpolated scene for webcam overlay opacity
  const scene = useInterpolatedScene(
    project?.scene?.segments,
    project?.scene?.defaultMode ?? 'default',
    effectiveTimeMs
  );

  const webcamOverlayOpacity = getRegularCameraTransitionOpacity(scene);

  // Track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Track preview area size
  useEffect(() => {
    const previewArea = previewAreaRef.current;
    if (!previewArea) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPreviewAreaSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(previewArea);
    return () => observer.disconnect();
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

  // Use extracted playback sync hook
  const { handleVideoClick } = usePlaybackSync({
    videoRef,
    systemAudioRef,
    micAudioRef,
    videoSrc,
    systemAudioSrc,
    micAudioSrc,
    audioConfig,
    durationMs: project?.timeline.durationMs,
    isPlaying,
    previewTimeMs,
    currentTimeMs,
    onVideoError: useCallback((msg: string) => setVideoError(msg || null), []),
  });

  return (
    <div ref={previewAreaRef} className="flex items-center justify-center h-full bg-[var(--polar-snow)] overflow-hidden">
      {/* Hidden audio elements */}
      {systemAudioSrc && (
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
      {micAudioSrc && (
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

      {/* Outer wrapper for background */}
      <div
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
          {videoSrc || project?.sources.webcamVideo ? (
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
              textSegments={project?.text?.segments}
              isPlaying={isPlaying}
              onVideoClick={handleVideoClick}
              backgroundPadding={backgroundConfig?.padding ?? 0}
              rounding={backgroundConfig?.rounding ?? 0}
              frameStyle={frameStyle}
              shadowStyle={frameShadowStyle}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[var(--ink-subtle)]">No video loaded</span>
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
        {project?.sources.webcamVideo && project?.webcam && compositionSize.width > 0 && (
          <WebcamOverlay
            webcamVideoPath={project.sources.webcamVideo}
            config={project.webcam}
            containerWidth={compositionSize.width}
            containerHeight={compositionSize.height}
            renderWidth={compositeWidth}
            sceneOpacity={webcamOverlayOpacity}
          />
        )}

        {/* Caption overlay - positioned relative to composition (video + padding) to match export */}
        {compositionSize.width > 0 && compositionSize.height > 0 && (
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
