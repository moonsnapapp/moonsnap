import { memo, useRef } from 'react';
import { selectScreenVideoPath } from '../../../stores/videoEditor/selectors';
import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import { VideoNoZoom, WebCodecsCanvasNoZoom } from './VideoComponents';
import {
  AnnotationOverlayController, MaskOverlayController, MotionBlurController,
  TextOverlayController, ZoomTransformController,
} from './PreviewOverlayControllers';
import { ZOOM_LAYER_STYLE, type SceneModeRendererProps } from './sceneTypes';
import { getStaticFrameOpacity, useVideoCropObjectFitStyle } from './sceneGeometry';

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

export const StaticSceneModeRenderer = memo(function StaticSceneModeRenderer({
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
