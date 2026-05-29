import { describe, it, expect } from 'vitest';
import type { VideoProject } from '../types';
import {
  getVideoOutputMode,
  isQuickCaptureProject,
  getVideoOriginalFilename,
  getVideoEditedDefaultFilename,
  getVideoPrimaryActionLabel,
  getVideoEditorStatusLabel,
  getVideoExportDialogTitle,
} from './videoExportMode';

// ---------------------------------------------------------------------------
// Fixture: a quick-capture project with NO edits (output mode would be
// 'original'). Tests flip individual fields to exercise the trim/render
// classification. Test files are excluded from tsc, so we assemble only the
// fields videoExportMode reads and cast to VideoProject.
// ---------------------------------------------------------------------------

const BASE_TIMELINE = {
  durationMs: 10000,
  inPoint: 0,
  outPoint: 10000,
  speed: 1,
  segments: [] as unknown[],
};

const BASE_AUDIO = {
  systemVolume: 1,
  microphoneVolume: 1,
  musicVolume: 1,
  musicFadeInSecs: 0,
  musicFadeOutSecs: 0,
  normalizeOutput: false,
  systemMuted: false,
  microphoneMuted: false,
  musicMuted: false,
};

const BASE_EXPORT = {
  format: 'mp4',
  quality: 80,
  fps: 30,
  background: { enabled: false },
  crop: { enabled: false, width: 0, height: 0 },
  composition: { mode: 'auto' },
};

const BASE_SOURCES = {
  screenVideo: '/recordings/clip.mp4',
  webcamVideo: null,
  cursorData: null,
  backgroundMusic: null,
};

function makeProject(overrides: Record<string, unknown> = {}): VideoProject {
  return {
    id: 'p1',
    name: 'My Recording',
    originalFileName: null,
    quickCapture: true,
    sources: { ...BASE_SOURCES },
    timeline: { ...BASE_TIMELINE },
    zoom: { regions: [] },
    scene: { segments: [] },
    text: { segments: [] },
    annotations: { segments: [] },
    mask: { segments: [] },
    webcam: { enabled: false },
    audio: { ...BASE_AUDIO },
    export: { ...BASE_EXPORT },
    captionSegments: [],
    ...overrides,
  } as unknown as VideoProject;
}

// ---------------------------------------------------------------------------
// isQuickCaptureProject
// ---------------------------------------------------------------------------

describe('isQuickCaptureProject', () => {
  it('reflects the quickCapture flag', () => {
    expect(isQuickCaptureProject(makeProject({ quickCapture: true }))).toBe(true);
    expect(isQuickCaptureProject(makeProject({ quickCapture: false }))).toBe(false);
    expect(isQuickCaptureProject(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getVideoOutputMode
// ---------------------------------------------------------------------------

describe('getVideoOutputMode', () => {
  it('renders for a null or non-quick-capture project', () => {
    expect(getVideoOutputMode(null)).toBe('render');
    expect(getVideoOutputMode(makeProject({ quickCapture: false }))).toBe('render');
  });

  it('returns original for an unedited quick-capture project', () => {
    expect(getVideoOutputMode(makeProject())).toBe('original');
  });

  it('returns trim for each trim-only edit', () => {
    expect(getVideoOutputMode(makeProject({ timeline: { ...BASE_TIMELINE, inPoint: 500 } }))).toBe('trim');
    expect(getVideoOutputMode(makeProject({ timeline: { ...BASE_TIMELINE, outPoint: 9000 } }))).toBe('trim');
    expect(getVideoOutputMode(makeProject({ timeline: { ...BASE_TIMELINE, speed: 2 } }))).toBe('trim');
    expect(getVideoOutputMode(makeProject({ timeline: { ...BASE_TIMELINE, segments: [{ id: 's' }] } }))).toBe('trim');
  });

  it('does not treat a sub-millisecond speed drift as a trim edit', () => {
    expect(getVideoOutputMode(makeProject({ timeline: { ...BASE_TIMELINE, speed: 1.0005 } }))).toBe('original');
  });

  it('returns render for any render-tier edit', () => {
    expect(getVideoOutputMode(makeProject({ zoom: { regions: [{ id: 'z' }] } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ text: { segments: [{ id: 't' }] } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ annotations: { segments: [{ id: 'a' }] } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ webcam: { enabled: true } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ captionSegments: [{ id: 'c' }] }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ sources: { ...BASE_SOURCES, cursorData: 'cursor.json' } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ sources: { ...BASE_SOURCES, backgroundMusic: 'song.mp3' } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ export: { ...BASE_EXPORT, background: { enabled: true } } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ export: { ...BASE_EXPORT, composition: { mode: 'custom' } } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ export: { ...BASE_EXPORT, crop: { enabled: true, width: 100, height: 100 } } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ audio: { ...BASE_AUDIO, normalizeOutput: true } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ audio: { ...BASE_AUDIO, systemVolume: 0.5 } }))).toBe('render');
    expect(getVideoOutputMode(makeProject({ audio: { ...BASE_AUDIO, musicFadeInSecs: 1 } }))).toBe('render');
  });

  it('prioritises render over trim when both kinds of edits are present', () => {
    const project = makeProject({
      timeline: { ...BASE_TIMELINE, inPoint: 500 },
      zoom: { regions: [{ id: 'z' }] },
    });
    expect(getVideoOutputMode(project)).toBe('render');
  });

  it('ignores a disabled or zero-size crop', () => {
    expect(getVideoOutputMode(makeProject({ export: { ...BASE_EXPORT, crop: { enabled: true, width: 0, height: 0 } } }))).toBe('original');
    expect(getVideoOutputMode(makeProject({ export: { ...BASE_EXPORT, crop: { enabled: false, width: 100, height: 100 } } }))).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

describe('getVideoOriginalFilename', () => {
  it('falls back to video.mp4 for a null project', () => {
    expect(getVideoOriginalFilename(null)).toBe('video.mp4');
  });

  it('prefers the preserved original filename', () => {
    expect(getVideoOriginalFilename(makeProject({ originalFileName: 'Screen Recording.mov' }))).toBe('Screen Recording.mov');
  });

  it('derives the basename from the source path when no original name exists', () => {
    expect(getVideoOriginalFilename(makeProject({ sources: { ...BASE_SOURCES, screenVideo: 'C:\\videos\\capture-42.mp4' } }))).toBe('capture-42.mp4');
  });
});

describe('getVideoEditedDefaultFilename', () => {
  it('falls back to video.mp4 for a null project', () => {
    expect(getVideoEditedDefaultFilename(null)).toBe('video.mp4');
  });

  it('sanitizes the project name into a safe .mp4 filename', () => {
    expect(getVideoEditedDefaultFilename(makeProject({ name: 'Demo: v1/2 <final>' }))).toBe('Demo- v1-2 -final-.mp4');
  });

  it('falls back to "video" when the name sanitizes to empty', () => {
    expect(getVideoEditedDefaultFilename(makeProject({ name: '...' }))).toBe('video.mp4');
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe('label helpers', () => {
  it('uses generic labels for non-quick-capture projects', () => {
    const project = makeProject({ quickCapture: false });
    expect(getVideoPrimaryActionLabel(project)).toBe('Export Video');
    expect(getVideoEditorStatusLabel(project)).toBe('Project Capture');
    expect(getVideoExportDialogTitle(project)).toBe('Export Video');
  });

  it('reflects the output mode for quick-capture projects', () => {
    expect(getVideoPrimaryActionLabel(makeProject())).toBe('Save Original');
    expect(getVideoEditorStatusLabel(makeProject())).toBe('Original Ready');
    expect(getVideoExportDialogTitle(makeProject())).toBe('Save Original Video');

    const trimmed = makeProject({ timeline: { ...BASE_TIMELINE, inPoint: 500 } });
    expect(getVideoPrimaryActionLabel(trimmed)).toBe('Save Trimmed Copy');
    expect(getVideoEditorStatusLabel(trimmed)).toBe('Fast Save Available');

    const rendered = makeProject({ zoom: { regions: [{ id: 'z' }] } });
    expect(getVideoPrimaryActionLabel(rendered)).toBe('Export Edited Video');
    expect(getVideoEditorStatusLabel(rendered)).toBe('Render Required');
    expect(getVideoExportDialogTitle(rendered)).toBe('Export Edited Video');
  });

  it('uses the editor default status label for a null project', () => {
    expect(getVideoEditorStatusLabel(null)).toBe('Video Editor');
  });
});
