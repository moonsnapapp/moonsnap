import { memo, useLayoutEffect, useMemo } from 'react';
import { CURSOR } from '../../../constants';
import { usePreviewOrPlaybackTime } from '../../../hooks/usePlaybackEngine';
import { useTimelineToSourceTime } from '../../../hooks/useTimelineSourceTime';
import { getZoomScaleAt, useZoomPreview } from '../../../hooks/useZoomPreview';
import { useZoomMotionBlurFilter } from '../../../hooks/useZoomMotionBlurFilter';
import { useInterpolatedScene, getRegularCameraTransitionOpacity } from '../../../hooks/useSceneMode';
import { usePreviewOrPlaybackTimeThrottled } from '../../../hooks/usePlaybackTimeThrottled';
import type {
  AnnotationSegment, CropConfig, CursorConfig, CursorRecording, MaskSegment,
  SceneMode, SceneSegment, TextSegment, WebcamConfig, ZoomRegion,
} from '../../../types';
import { AnnotationOverlay } from '../AnnotationOverlay';
import { MaskOverlay } from '../MaskOverlay';
import { TextOverlay } from '../TextOverlay';
import { WebcamOverlay } from '../WebcamOverlay';

export const SceneAwareWebcamOverlay = memo(function SceneAwareWebcamOverlay({
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

export const ZoomTransformController = memo(function ZoomTransformController({
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

export const MotionBlurController = memo(function MotionBlurController({
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

export const MaskOverlayController = memo(function MaskOverlayController({
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

export const TextOverlayController = memo(function TextOverlayController({
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

export const AnnotationOverlayController = memo(function AnnotationOverlayController({
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
