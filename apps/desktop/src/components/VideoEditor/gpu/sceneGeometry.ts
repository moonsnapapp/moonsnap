import { useMemo, type CSSProperties } from 'react';

import {
  getCameraOnlyTransitionOpacity,
  useInterpolatedScene,
} from '../../../hooks/useSceneMode';
import type { CropConfig, SceneMode } from '../../../types';
import { hasEnabledCrop } from '../../../utils/videoContentDimensions';
import type { SceneModeRendererProps } from './sceneTypes';

export function useVideoCropObjectFitStyle(
  cropConfig: CropConfig | undefined,
  videoWidth: number,
  videoHeight: number,
): CSSProperties {
  return useMemo(
    () => getVideoCropObjectFitStyle(cropConfig, videoWidth, videoHeight),
    [cropConfig, videoHeight, videoWidth],
  );
}

export function getVideoCropObjectFitStyle(
  cropConfig: CropConfig | undefined,
  videoWidth: number,
  videoHeight: number,
): CSSProperties {
  if (!cropConfig || !hasEnabledCrop(cropConfig)) return {};

  const posX = getCropObjectPosition(cropConfig.x, cropConfig.width, videoWidth);
  const posY = getCropObjectPosition(cropConfig.y, cropConfig.height, videoHeight);
  return { objectFit: 'cover', objectPosition: `${posX}% ${posY}%` };
}

function getCropObjectPosition(cropOffset: number, cropSize: number, videoSize: number) {
  const overflow = videoSize - cropSize;
  return overflow > 0 ? (cropOffset / overflow) * 100 : 50;
}

export function getStaticFrameOpacity(defaultSceneMode: SceneMode): number {
  return defaultSceneMode === 'cameraOnly' ? 0 : 1;
}

export function getLayerVisibilityStyle(isVisible: boolean): CSSProperties {
  return {
    visibility: isVisible ? 'visible' : 'hidden',
    pointerEvents: isVisible ? 'auto' : 'none',
  };
}

export function getCombinedSceneFilter(
  sceneBlur: number,
  motionBlurFilter: string | undefined,
): string | undefined {
  const sceneBlurFilter = sceneBlur > 0.01 ? `blur(${sceneBlur * 20}px)` : undefined;
  return [sceneBlurFilter, motionBlurFilter].filter(Boolean).join(' ') || undefined;
}

export function getDynamicScreenStyle(
  screenOpacity: number,
  combinedFilter: string | undefined,
): CSSProperties {
  return { position: 'absolute', inset: 0, opacity: screenOpacity, filter: combinedFilter };
}

export function getFullscreenWebcamStyle(
  scene: ReturnType<typeof useInterpolatedScene>,
): CSSProperties {
  return {
    position: 'absolute',
    zIndex: 10,
    opacity: getCameraOnlyTransitionOpacity(scene),
    filter: scene.cameraOnlyBlur > 0.01 ? `blur(${scene.cameraOnlyBlur * 10}px)` : undefined,
    inset: 0,
    transform: `scale(${scene.cameraOnlyZoom})`,
  };
}

export function hasDynamicSceneModeFeatures(props: SceneModeRendererProps) {
  return Boolean(props.webcamVideoPath || props.cursorRecording || props.sceneSegments?.length);
}
