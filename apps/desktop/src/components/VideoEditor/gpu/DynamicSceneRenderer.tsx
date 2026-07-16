import { memo, useMemo } from 'react';
import { CURSOR } from '../../../constants';
import { selectScreenVideoPath } from '../../../stores/videoEditor/selectors';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import { getZoomScaleAt, useZoomPreview } from '../../../hooks/useZoomPreview';
import { useZoomMotionBlurFilter } from '../../../hooks/useZoomMotionBlurFilter';
import { useTimelineToSourceTime } from '../../../hooks/useTimelineSourceTime';
import {
  getCameraOnlyTransitionOpacity,
  shouldRenderCursor,
  shouldRenderScreen,
  useInterpolatedScene,
} from '../../../hooks/useSceneMode';
import { usePreviewOrPlaybackTime } from '../../../hooks/usePlaybackEngine';
import type {
  AnnotationSegment, CropConfig, CursorConfig, CursorRecording, MaskSegment,
  TextSegment, WebcamConfig, ZoomRegion,
} from '../../../types';
import { AnnotationOverlay } from '../AnnotationOverlay';
import { ClickHighlightOverlay } from '../ClickHighlightOverlay';
import { CursorOverlay } from '../CursorOverlay';
import { MaskOverlay } from '../MaskOverlay';
import { TextOverlay } from '../TextOverlay';
import { FullscreenWebcam, VideoNoZoom, WebCodecsCanvasNoZoom } from './VideoComponents';
import { StaticSceneModeRenderer } from './StaticSceneRenderer';
import {
  getCombinedSceneFilter,
  getDynamicScreenStyle,
  getFullscreenWebcamStyle,
  getLayerVisibilityStyle,
  hasDynamicSceneModeFeatures,
  useVideoCropObjectFitStyle,
} from './sceneGeometry';
import { ZOOM_LAYER_STYLE, type SceneModeRendererProps } from './sceneTypes';

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

export const SceneModeRenderer = memo(function SceneModeRenderer(props: SceneModeRendererProps) {
  if (!hasDynamicSceneModeFeatures(props)) {
    return <StaticSceneModeRenderer {...props} />;
  }

  return <DynamicSceneModeRenderer {...props} />;
});
