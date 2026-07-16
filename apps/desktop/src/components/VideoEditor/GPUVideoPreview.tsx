import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { TEXT_ANIMATION } from '../../constants';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectProject, selectIsPlaying, selectCursorRecording, selectAudioConfig,
  selectTogglePlayback, selectIsCropEditing, selectUpdateExportConfig,
} from '../../stores/videoEditor/selectors';
import { videoEditorLogger } from '../../utils/logger';
import { hasEnabledCrop } from '../../utils/videoContentDimensions';
import type { VideoProject } from '../../types';
import { usePreviewStyles } from './gpu/usePreviewStyles';
import {
  HiddenPreviewAudioElements, PlaybackSyncController, TypewriterAudioController,
} from './gpu/PreviewAudioControllers';
import {
  CropEditingOverlayController, PreviewBackgroundLayers,
  PreviewCompositionOverlays, PreviewSceneContent, VideoErrorOverlay,
} from './gpu/PreviewLayers';
import { getCompositionBackground } from './gpu/previewBackground';
import { usePreviewResizeTracking } from './gpu/usePreviewResizeTracking';
import type { PreviewBackgroundConfig, Size } from './gpu/sceneTypes';

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
