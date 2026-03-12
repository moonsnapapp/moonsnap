import type { VideoProject } from '../types';
import { hasEnabledCrop } from './videoContentDimensions';

export type VideoOutputMode = 'original' | 'trim' | 'render';

// eslint-disable-next-line no-control-regex
const WINDOWS_FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

export function isQuickCaptureProject(project: VideoProject | null | undefined): boolean {
  return Boolean(project?.quickCapture);
}

function sanitizeFileStem(stem: string): string {
  const sanitized = stem
    .replace(WINDOWS_FORBIDDEN_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized || 'video';
}

export function getVideoOriginalFilename(project: VideoProject | null | undefined): string {
  if (!project) {
    return 'video.mp4';
  }

  const preservedName = project.originalFileName?.trim();
  if (preservedName) {
    return preservedName;
  }

  const sourceFilename = project.sources.screenVideo.split(/[\\/]/).pop()?.trim();
  if (sourceFilename) {
    return sourceFilename;
  }

  return `${sanitizeFileStem(project.name)}.mp4`;
}

export function getVideoEditedDefaultFilename(project: VideoProject | null | undefined): string {
  if (!project) {
    return 'video.mp4';
  }

  return `${sanitizeFileStem(project.name)}.mp4`;
}

function hasTrimEdits(project: VideoProject): boolean {
  return (
    project.timeline.segments.length > 0 ||
    project.timeline.inPoint > 0 ||
    project.timeline.outPoint < project.timeline.durationMs ||
    Math.abs(project.timeline.speed - 1) > 0.001
  );
}

function hasRenderEdits(project: VideoProject): boolean {
  return (
    project.zoom.regions.length > 0 ||
    project.scene.segments.length > 0 ||
    (project.annotations?.segments.length ?? 0) > 0 ||
    project.mask.segments.length > 0 ||
    project.text.segments.length > 0 ||
    project.captionSegments.length > 0 ||
    Boolean(project.sources.webcamVideo) ||
    Boolean(project.sources.cursorData) ||
    Boolean(project.sources.backgroundMusic) ||
    project.webcam.enabled ||
    project.export.background.enabled ||
    hasEnabledCrop(project.export.crop) ||
    project.export.composition.mode !== 'auto' ||
    project.audio.normalizeOutput ||
    project.audio.systemMuted ||
    project.audio.microphoneMuted ||
    project.audio.musicMuted ||
    project.audio.systemVolume !== 1 ||
    project.audio.microphoneVolume !== 1 ||
    project.audio.musicVolume !== 1 ||
    project.audio.musicFadeInSecs !== 0 ||
    project.audio.musicFadeOutSecs !== 0
  );
}

export function getVideoOutputMode(project: VideoProject | null | undefined): VideoOutputMode {
  if (!project || !isQuickCaptureProject(project)) {
    return 'render';
  }

  if (hasRenderEdits(project)) {
    return 'render';
  }

  if (hasTrimEdits(project)) {
    return 'trim';
  }

  return 'original';
}

export function getVideoPrimaryActionLabel(project: VideoProject | null | undefined): string {
  if (!project || !isQuickCaptureProject(project)) {
    return 'Export Video';
  }

  switch (getVideoOutputMode(project)) {
    case 'original':
      return 'Save Original';
    case 'trim':
      return 'Save Trimmed Copy';
    case 'render':
      return 'Export Edited Video';
  }
}

export function getVideoEditorStatusLabel(project: VideoProject | null | undefined): string {
  if (!project) {
    return 'Video Editor';
  }

  if (!isQuickCaptureProject(project)) {
    return 'Project Capture';
  }

  switch (getVideoOutputMode(project)) {
    case 'original':
      return 'Original Ready';
    case 'trim':
      return 'Fast Save Available';
    case 'render':
      return 'Render Required';
  }
}

export function getVideoExportDialogTitle(project: VideoProject | null | undefined): string {
  if (!project || !isQuickCaptureProject(project)) {
    return 'Export Video';
  }

  switch (getVideoOutputMode(project)) {
    case 'original':
      return 'Save Original Video';
    case 'trim':
      return 'Save Trimmed Copy';
    case 'render':
      return 'Export Edited Video';
  }
}
