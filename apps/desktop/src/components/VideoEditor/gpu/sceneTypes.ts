import type React from 'react';
import type {
  AnnotationSegment,
  CropConfig,
  CursorConfig,
  CursorRecording,
  MaskSegment,
  SceneMode,
  SceneSegment,
  TextSegment,
  WebcamConfig,
  ZoomRegion,
  VideoProject,
} from '../../../types';

export type Size = { width: number; height: number };
export const DEFAULT_PREVIEW_VIDEO_SIZE: Size = { width: 1920, height: 1080 };
export type PreviewBackgroundConfig = VideoProject['export']['background'];

export const ZOOM_LAYER_STYLE: React.CSSProperties = {
  transform: 'translateZ(0) scale(1)',
  transformOrigin: 'center center',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
};

export type SceneModeRendererProps = {
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
