import type { VideoProject } from '../types';
import { hasEnabledCrop } from './videoContentDimensions';

export type VideoOutputMode = 'original' | 'trim' | 'render';

// eslint-disable-next-line no-control-regex
const WINDOWS_FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
type ProjectEditPredicate = (project: VideoProject) => boolean;

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

const RENDER_SEGMENT_CHECKS: ProjectEditPredicate[] = [
  (project) => project.zoom.regions.length > 0,
  (project) => project.scene.segments.length > 0,
  (project) => (project.annotations?.segments.length ?? 0) > 0,
  (project) => project.mask.segments.length > 0,
  (project) => project.text.segments.length > 0,
  (project) => project.captionSegments.length > 0,
];

const RENDER_SOURCE_CHECKS: ProjectEditPredicate[] = [
  (project) => Boolean(project.sources.webcamVideo),
  (project) => Boolean(project.sources.cursorData),
  (project) => Boolean(project.sources.backgroundMusic),
  (project) => project.webcam.enabled,
];

const RENDER_EXPORT_CHECKS: ProjectEditPredicate[] = [
  (project) => project.export.background.enabled,
  (project) => hasEnabledCrop(project.export.crop),
  (project) => project.export.composition.mode !== 'auto',
];

const RENDER_AUDIO_CHECKS: ProjectEditPredicate[] = [
  (project) => project.audio.normalizeOutput,
  (project) => project.audio.systemMuted,
  (project) => project.audio.microphoneMuted,
  (project) => project.audio.musicMuted,
  (project) => project.audio.systemVolume !== 1,
  (project) => project.audio.microphoneVolume !== 1,
  (project) => project.audio.musicVolume !== 1,
  (project) => project.audio.musicFadeInSecs !== 0,
  (project) => project.audio.musicFadeOutSecs !== 0,
];

const RENDER_EDIT_CHECKS: ProjectEditPredicate[] = [
  ...RENDER_SEGMENT_CHECKS,
  ...RENDER_SOURCE_CHECKS,
  ...RENDER_EXPORT_CHECKS,
  ...RENDER_AUDIO_CHECKS,
];

function hasRenderEdits(project: VideoProject): boolean {
  return RENDER_EDIT_CHECKS.some((hasEdit) => hasEdit(project));
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
