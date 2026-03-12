export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Canvas bounds for non-destructive crop/expand operations
export interface CanvasBounds {
  width: number;
  height: number;
  imageOffsetX: number;
  imageOffsetY: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface CaptureSource {
  monitor?: number;
  window_id?: number;
  window_title?: string;
  region?: Region;
}

// Base annotation interface for generic shapes
export interface ShapeAnnotation {
  id: string;
  type: string;
  [key: string]: unknown;
}

// Special annotation for crop bounds (stored to persist crop state)
export interface CropBoundsAnnotation {
  id: '__crop_bounds__';
  type: '__crop_bounds__';
  width: number;
  height: number;
  imageOffsetX: number;
  imageOffsetY: number;
}

// Special annotation for compositor settings (stored to persist background effects)
export interface CompositorSettingsAnnotation {
  id: '__compositor_settings__';
  type: '__compositor_settings__';
  enabled: boolean;
  backgroundType: BackgroundType;
  backgroundColor: string;
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  wallpaper: string | null;
  backgroundImage: string | null;
  padding: number;
  borderRadius: number;
  borderRadiusType: 'squircle' | 'rounded';
  shadowIntensity: number;
  borderWidth: number;
  borderColor: string;
  borderOpacity: number;
  aspectRatio: CompositorSettings['aspectRatio'];
}

// Special annotation for crop region (export-only bounds, replaces CropBoundsAnnotation)
export interface CropRegionAnnotation {
  id: '__crop_region__';
  type: '__crop_region__';
  x: number;
  y: number;
  width: number;
  height: number;
  cropUserExpanded?: boolean;
}

// Union type for all annotation types
export type Annotation = ShapeAnnotation | CropBoundsAnnotation | CropRegionAnnotation | CompositorSettingsAnnotation;

// Type guards for annotation types
export function isCropBoundsAnnotation(ann: Annotation): ann is CropBoundsAnnotation {
  return ann.type === '__crop_bounds__';
}

export function isCropRegionAnnotation(ann: Annotation): ann is CropRegionAnnotation {
  return ann.type === '__crop_region__';
}

export function isCompositorSettingsAnnotation(ann: Annotation): ann is CompositorSettingsAnnotation {
  return ann.type === '__compositor_settings__';
}

export interface CaptureProject {
  id: string;
  created_at: string;
  updated_at: string;
  capture_type: 'region' | 'fullscreen' | 'window';
  source: CaptureSource;
  original_image: string;
  dimensions: Dimensions;
  annotations: Annotation[];
  tags: string[];
  favorite: boolean;
}

export interface CaptureListItem {
  id: string;
  created_at: string;
  updated_at: string;
  capture_type: string;
  dimensions: Dimensions;
  thumbnail_path: string;
  image_path: string;
  has_annotations: boolean;
  tags: string[];
  favorite: boolean;
  quick_capture?: boolean;
  /** True if the original image file is missing from disk */
  is_missing: boolean;
}

export interface CaptureResult {
  image_data: string;
  width: number;
  height: number;
}

// Fast capture result - returns file path instead of base64 data
export interface FastCaptureResult {
  file_path: string;
  width: number;
  height: number;
  has_transparency: boolean;
}

// Screen region selection using absolute screen coordinates (multi-monitor support)
export interface ScreenRegionSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
  scale_factor: number;
}

export interface WindowInfo {
  id: number;
  title: string;
  app_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_minimized: boolean;
}

export interface StorageStats {
  total_size_bytes: number;
  total_size_mb: number;
  capture_count: number;
  storage_path: string;
}

export type Tool = 'select' | 'arrow' | 'line' | 'rect' | 'circle' | 'text' | 'blur' | 'highlight' | 'steps' | 'crop' | 'pen' | 'background';

export interface CanvasShape {
  id: string;
  type: string;
  x?: number;
  y?: number;
  points?: number[];
  width?: number;
  height?: number;
  radius?: number; // Legacy - use radiusX/radiusY for ellipses
  radiusX?: number; // Ellipse horizontal radius
  radiusY?: number; // Ellipse vertical radius
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string; // 'normal' | 'bold' | 'italic' | 'bold italic'
  textDecoration?: string; // '' | 'underline' | 'line-through'
  align?: string; // 'left' | 'center' | 'right'
  verticalAlign?: string; // 'top' | 'middle' | 'bottom'
  wrap?: string; // 'word' | 'char' | 'none'
  lineHeight?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  number?: number;
  pixelSize?: number;
  blurType?: BlurType;
  blurAmount?: number;
  imageSrc?: string; // base64 data URL for pasted images
  textBackground?: string; // Background color for text shapes
  isBackground?: boolean; // true for the original screenshot background shape
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface SaveCaptureRequest {
  image_data: string;
  capture_type: string;
  source: CaptureSource;
}

export interface SaveCaptureResponse {
  id: string;
  project: CaptureProject;
  thumbnail_path: string;
  image_path: string;
}

// Compositor types for background effects
export type BackgroundType = 'wallpaper' | 'image' | 'solid' | 'gradient';

export interface CompositorSettings {
  enabled: boolean;
  backgroundType: BackgroundType;
  // Solid color
  backgroundColor: string;
  // Gradient
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number; // degrees
  // Wallpaper (ID format: "theme/name", e.g., "macOS/sequoia-dark")
  wallpaper: string | null;
  // Custom image (base64 or URL)
  backgroundImage: string | null;
  // Layout
  padding: number; // pixels
  borderRadius: number; // pixels
  borderRadiusType: 'squircle' | 'rounded';
  // Effects
  shadowIntensity: number; // 0 = off, > 0 = on (0-1 range)
  borderWidth: number; // pixels
  borderColor: string; // hex color
  borderOpacity: number; // 0 = off, > 0 = on (0-100)
  aspectRatio: 'auto' | '16:9' | '4:3' | '1:1' | 'twitter' | 'instagram';
}

export const DEFAULT_COMPOSITOR_WALLPAPER_ID = 'macOS/sequoia-dark';

export const DEFAULT_COMPOSITOR_SETTINGS: CompositorSettings = {
  enabled: false,
  backgroundType: 'wallpaper',
  backgroundColor: '#6366f1',
  gradientStart: '#667eea',
  gradientEnd: '#764ba2',
  gradientAngle: 135,
  wallpaper: DEFAULT_COMPOSITOR_WALLPAPER_ID,
  backgroundImage: null,
  padding: 64,
  borderRadius: 12,
  borderRadiusType: 'squircle',
  shadowIntensity: 0.5,
  borderWidth: 2,
  borderColor: '#ffffff',
  borderOpacity: 0,
  aspectRatio: 'auto',
};

// Blur effect types
export type BlurType = 'pixelate' | 'gaussian';

// Default font families (fallback if system fonts not loaded)
export const DEFAULT_FONT_FAMILIES = [
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
] as const;

export type FontFamily = string;

// ============================================
// Settings Types
// ============================================

// Shortcut registration status
export type ShortcutStatus = 'registered' | 'conflict' | 'error' | 'pending';

// Individual shortcut configuration
export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  defaultShortcut: string;
  currentShortcut: string;
  status: ShortcutStatus;
  useHook: boolean; // Whether to use low-level hook for override
}

// Image format options
export type ImageFormat = 'png' | 'jpg' | 'webp' | 'gif' | 'bmp';

// Theme options
export type Theme = 'light' | 'dark' | 'system';

// Update channel
export type UpdateChannel = 'stable' | 'beta';

// General application settings
export interface GeneralSettings {
  startWithWindows: boolean;
  minimizeToTray: boolean;
  showNotifications: boolean;
  defaultSaveDir: string | null;
  imageFormat: ImageFormat;
  jpgQuality: number; // 0-100
  allowOverride: boolean; // Allow MoonSnap to override shortcuts registered by other apps
  theme: Theme; // App color theme
  updateChannel: UpdateChannel;
}

// Complete application settings
export interface AppSettings {
  shortcuts: Record<string, ShortcutConfig>;
  general: GeneralSettings;
}

// Default shortcut configurations
export const DEFAULT_SHORTCUTS: Record<string, ShortcutConfig> = {
  open_capture_toolbar: {
    id: 'open_capture_toolbar',
    name: 'Open Capture Toolbar',
    description: 'Open the floating capture launcher',
    defaultShortcut: 'Ctrl+Shift+Space',
    currentShortcut: 'Ctrl+Shift+Space',
    status: 'pending',
    useHook: true,
  },
  new_capture: {
    id: 'new_capture',
    name: 'New Screenshot',
    description: 'Start an area screenshot flow',
    defaultShortcut: 'PrintScreen',
    currentShortcut: 'PrintScreen',
    status: 'pending',
    useHook: true,
  },
  fullscreen_capture: {
    id: 'fullscreen_capture',
    name: 'Current Display',
    description: 'Capture the current display',
    defaultShortcut: 'Shift+PrintScreen',
    currentShortcut: 'Shift+PrintScreen',
    status: 'pending',
    useHook: true,
  },
  all_monitors_capture: {
    id: 'all_monitors_capture',
    name: 'All Displays',
    description: 'Capture all displays combined',
    defaultShortcut: 'Ctrl+PrintScreen',
    currentShortcut: 'Ctrl+PrintScreen',
    status: 'pending',
    useHook: true,
  },
  record_video: {
    id: 'record_video',
    name: 'Record Video…',
    description: 'Open the capture toolbar in Video mode',
    defaultShortcut: 'Ctrl+Alt+R',
    currentShortcut: 'Ctrl+Alt+R',
    status: 'pending',
    useHook: true,
  },
  record_gif: {
    id: 'record_gif',
    name: 'Record GIF…',
    description: 'Open the capture toolbar in GIF mode',
    defaultShortcut: 'Ctrl+Alt+G',
    currentShortcut: 'Ctrl+Alt+G',
    status: 'pending',
    useHook: true,
  },
};

// Default general settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  startWithWindows: false,
  minimizeToTray: true,
  showNotifications: true,
  defaultSaveDir: null,
  imageFormat: 'png',
  jpgQuality: 85,
  allowOverride: true, // Override shortcuts from other apps by default
  theme: 'system', // Follow OS preference by default
  updateChannel: 'stable',
};

// Default complete settings
export const DEFAULT_SETTINGS: AppSettings = {
  shortcuts: DEFAULT_SHORTCUTS,
  general: DEFAULT_GENERAL_SETTINGS,
};

// ============================================
// Capture Type (used in RegionSelector)
// ============================================

/** Type of capture action to perform after region selection */
export type CaptureType = 'screenshot' | 'video' | 'gif';

// ============================================
// Video Recording Types (generated from Rust via ts-rs)
// ============================================

// Re-export generated types - single source of truth from Rust
export type {
  AudioSettings,
  RecordingFormat,
  RecordingMode,
  RecordingSettings,
  RecordingState as RustRecordingState,
  RecordingStatus,
  StartRecordingResult,
  StopRecordingResult,
  VideoFormat,
} from './generated';

// ============================================
// Video Editor Types (generated from Rust via ts-rs)
// ============================================

// Cursor event types for auto-zoom
export type {
  CursorEvent,
  CursorEventType,
  CursorImage,
  CursorRecording,
  WindowsCursorShape,
} from './generated';

// Video project types
export type {
  AutoZoomConfig,
  VideoSources,
  TimelineState,
  TrimSegment,
  ZoomConfig,
  ZoomMode,
  ZoomRegion,
  ZoomRegionMode,
  ZoomTransition,
  EasingFunction,
  CursorType,
  ClickHighlightConfig,
  ClickHighlightStyle,
  WebcamConfig,
  WebcamOverlayPosition,
  WebcamOverlayShape,
  WebcamBorder,
  VisibilitySegment,
  CornerStyle,
  ShadowConfig,
  ExportConfig,
  ExportFormat,
  BackgroundType as VideoBackgroundType,
  BackgroundConfig,
  CropConfig,
  CompositionMode,
  CompositionConfig,
  ExportProgress,
  ExportResult,
  ExportStage,
  AudioTrackSettings,
  AudioWaveform,
  SceneMode,
  SceneSegment,
  SceneConfig,
  XY,
  MaskType,
  AnnotationShapeType,
  AnnotationShape,
  AnnotationSegment,
  AnnotationConfig,
  MaskSegment,
  MaskConfig,
} from './generated';

import type {
  CursorConfig as GeneratedCursorConfig,
  TextConfig as GeneratedTextConfig,
  TextSegment as GeneratedTextSegment,
  VideoProject as GeneratedVideoProject,
} from './generated';

// Keep the app-level cursor type aligned even when generated files are temporarily
// stale before ts-rs regeneration.
export type CursorConfig = Omit<
  GeneratedCursorConfig,
  'smoothMovement' | 'animationStyle' | 'tension' | 'mass' | 'friction'
> & {
  // Cursor fade-out when idle (Screen Studio-like behavior).
  hideWhenIdle?: boolean;
  // Zoom-adaptive cursor smoothing strength (0 = linear, 1 = smooth).
  dampening?: number;
};

// Text animation style for text overlay segments.
export type TextAnimation = 'none' | 'typeWriter';

// Keep text segment typing animation fields optional at app level for compatibility
// with older project payloads and in-flight generated type changes.
export type TextSegment = Omit<
  GeneratedTextSegment,
  'animation' | 'typewriterCharsPerSecond' | 'typewriterSoundEnabled'
> & {
  animation?: TextAnimation;
  typewriterCharsPerSecond?: number;
  typewriterSoundEnabled?: boolean;
};

// Keep text config aligned with app-level TextSegment extensions.
export type TextConfig = Omit<GeneratedTextConfig, 'segments'> & {
  segments: TextSegment[];
};

// Keep VideoProject aligned with app-level CursorConfig/TextConfig extensions.
export type VideoProject = Omit<GeneratedVideoProject, 'cursor' | 'text' | 'originalFileName'> & {
  cursor: CursorConfig;
  text: TextConfig;
  originalFileName?: string | null;
  quickCapture?: boolean;
};

// GPU Video Editor types (wgpu-accelerated rendering)
export type {
  EditorInstanceInfo,
  PlaybackEvent,
  PlaybackState,
  RenderedFrame,
} from './generated';

// Caption/transcription types
export type {
  CaptionWord,
  CaptionSegment,
  CaptionSettings,
  CaptionData,
  WhisperModelInfo,
  DownloadProgress,
  TranscriptionProgress,
} from './generated';

// Import Rust type for extension
import type { RecordingState as RustRecordingState } from './generated';

// Extended RecordingState with frontend-only 'starting' status
// Used when the UI has initiated a recording but the backend hasn't responded yet
export type RecordingState = RustRecordingState | { status: 'starting' };

// Import for use in default settings
import type { RecordingSettings } from './generated';

/** Default recording settings */
export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  format: 'mp4',
  mode: { type: 'monitor', monitorIndex: 0 },
  fps: 30,
  maxDurationSecs: null,
  // Disable system cursor in video frames - we render our own cursor overlay
  // in the video editor with SVG cursors and effects
  includeCursor: false,
  audio: {
    captureSystemAudio: true,
    systemAudioDeviceId: null,
    microphoneDeviceIndex: null,
  },
  quality: 80,
  gifQualityPreset: 'balanced',
  countdownSecs: 3,
  quickCapture: false,
};

// ============================================
// Shape Component Types
// ============================================

import type Konva from 'konva';

// Base props shared by all shape components
export interface BaseShapeProps {
  shape: CanvasShape;
  isSelected: boolean;
  isDraggable: boolean;
  onSelect: (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: () => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}
