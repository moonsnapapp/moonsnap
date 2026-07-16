import { memo } from 'react';
import type { CursorRecording, CropConfig, VideoProject } from '../../../types';
import { InlineCropOverlay } from '../InlineCropOverlay';
import { UnifiedCaptionOverlay } from '../UnifiedCaptionOverlay';
import { SceneModeRenderer } from './DynamicSceneRenderer';
import { SceneAwareWebcamOverlay } from './PreviewOverlayControllers';
import {
  DEFAULT_PREVIEW_VIDEO_SIZE,
  type PreviewBackgroundConfig,
  type Size,
} from './sceneTypes';
import { getPreviewBackgroundImageSrc, getPreviewBackgroundLayerSrc } from './previewBackground';

export const PreviewBackgroundLayers = memo(function PreviewBackgroundLayers({
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

export const PreviewUnavailableState = memo(function PreviewUnavailableState({
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

export const VideoErrorOverlay = memo(function VideoErrorOverlay({
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

export const PreviewSceneContent = memo(function PreviewSceneContent({
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

export const CropEditingOverlayController = memo(function CropEditingOverlayController({
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

export const PreviewCompositionOverlays = memo(function PreviewCompositionOverlays({
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
