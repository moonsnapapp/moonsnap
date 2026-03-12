import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator, VideoProject, CursorRecording } from './types';
import { STORAGE } from '../../constants';
import { videoEditorLogger } from '../../utils/logger';
import { DEFAULT_TIMELINE_ZOOM } from './timelineSlice';
import { getEffectiveDuration } from './trimSlice';
import { normalizeAnnotationConfig } from '../../utils/videoAnnotations';

function normalizeProject(project: VideoProject): VideoProject {
  return {
    ...project,
    annotations: normalizeAnnotationConfig(project.annotations),
  };
}

/**
 * Sanitize project for saving - ensures all millisecond values are integers.
 * Rust backend expects u64 for timeline values, but JS may have floats.
 */
export function sanitizeProjectForSave(project: VideoProject): VideoProject {
  const normalizedProject = normalizeProject(project);
  return {
    ...normalizedProject,
    sources: {
      ...normalizedProject.sources,
      durationMs: Math.round(normalizedProject.sources.durationMs),
    },
    timeline: {
      ...normalizedProject.timeline,
      durationMs: Math.round(normalizedProject.timeline.durationMs),
      inPoint: Math.round(normalizedProject.timeline.inPoint),
      outPoint: Math.round(normalizedProject.timeline.outPoint),
    },
    zoom: {
      ...normalizedProject.zoom,
      regions: normalizedProject.zoom.regions.map((region) => ({
        ...region,
        startMs: Math.round(region.startMs),
        endMs: Math.round(region.endMs),
      })),
    },
    mask: {
      ...normalizedProject.mask,
      segments: normalizedProject.mask.segments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    scene: {
      ...normalizedProject.scene,
      segments: normalizedProject.scene.segments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    annotations: {
      ...normalizedProject.annotations,
      segments: normalizedProject.annotations.segments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    webcam: {
      ...normalizedProject.webcam,
      visibilitySegments: normalizedProject.webcam.visibilitySegments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    // Note: text.segments uses start/end in seconds (f32), not ms
  };
}

/**
 * Reconcile the stored project duration with the actual media duration reported by the browser.
 * This keeps the timeline/playback endpoint aligned when encoded media duration differs slightly
 * from the persisted metadata.
 */
export function reconcileProjectDuration(project: VideoProject, actualDurationMs: number): VideoProject {
  const nextDurationMs = Math.max(0, Math.round(actualDurationMs));
  if (nextDurationMs <= 0) {
    return project;
  }

  let segmentsChanged = false;
  const originalSegments = project.timeline.segments ?? [];
  const nextSegments = originalSegments
    .map((segment) => {
      const sourceStartMs = Math.max(0, Math.min(segment.sourceStartMs, nextDurationMs));
      const sourceEndMs = Math.max(sourceStartMs, Math.min(segment.sourceEndMs, nextDurationMs));

      if (
        sourceStartMs !== segment.sourceStartMs ||
        sourceEndMs !== segment.sourceEndMs
      ) {
        segmentsChanged = true;
      }

      return {
        ...segment,
        sourceStartMs,
        sourceEndMs,
      };
    })
    .filter((segment) => segment.sourceEndMs > segment.sourceStartMs);

  if (nextSegments.length !== originalSegments.length) {
    segmentsChanged = true;
  }

  const effectiveDurationMs = getEffectiveDuration(nextSegments, nextDurationMs);
  const nextInPoint = Math.max(0, Math.min(project.timeline.inPoint, effectiveDurationMs));
  const nextOutPoint = Math.max(nextInPoint, Math.min(project.timeline.outPoint, effectiveDurationMs));

  const durationChanged =
    project.sources.durationMs !== nextDurationMs ||
    project.timeline.durationMs !== nextDurationMs;
  const inPointChanged = project.timeline.inPoint !== nextInPoint;
  const outPointChanged = project.timeline.outPoint !== nextOutPoint;

  if (!durationChanged && !segmentsChanged && !inPointChanged && !outPointChanged) {
    return project;
  }

  return {
    ...project,
    sources: {
      ...project.sources,
      durationMs: nextDurationMs,
    },
    timeline: {
      ...project.timeline,
      durationMs: nextDurationMs,
      inPoint: nextInPoint,
      outPoint: nextOutPoint,
      segments: nextSegments,
    },
  };
}

/**
 * Project state and actions for project management
 */
export interface ProjectSlice {
  // Project state
  project: VideoProject | null;
  cursorRecording: CursorRecording | null;

  // Save state
  isSaving: boolean;
  lastSavedAt: string | null;

  // Project actions
  setProject: (project: VideoProject | null) => void;
  loadCursorData: (cursorDataPath: string) => Promise<void>;
  saveProject: () => Promise<void>;
  clearEditor: () => void;
}

export const createProjectSlice: SliceCreator<ProjectSlice> = (set, get) => ({
  // Initial state
  project: null,
  cursorRecording: null,
  isSaving: false,
  lastSavedAt: null,

  // Project actions
  setProject: (project) => {
    const normalizedProject = project ? normalizeProject(project) : null;
    // Restore IO markers from project. A full-range export keeps both markers hidden.
    let exportInPointMs: number | null = null;
    let exportOutPointMs: number | null = null;

    if (normalizedProject) {
      const hasCustomRange =
        normalizedProject.timeline.inPoint > 0 ||
        normalizedProject.timeline.outPoint < normalizedProject.timeline.durationMs;

      if (hasCustomRange) {
        exportInPointMs = normalizedProject.timeline.inPoint;
        exportOutPointMs = normalizedProject.timeline.outPoint;
      }
    }

    set({
      project: normalizedProject,
      cursorRecording: null, // Reset cursor recording when project changes
      currentTimeMs: 0,
      isPlaying: false,
      selectedZoomRegionId: null,
      selectedWebcamSegmentIndex: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      // Load caption data from project if available
      captionSegments: normalizedProject?.captionSegments ?? [],
      captionSettings: normalizedProject?.captions ?? get().captionSettings,
      // Restore IO markers
      exportInPointMs,
      exportOutPointMs,
    });

    // Save video project path to session storage for F5 persistence
    if (normalizedProject?.sources.screenVideo) {
      try {
        sessionStorage.setItem(STORAGE.SESSION_VIDEO_PROJECT_PATH_KEY, normalizedProject.sources.screenVideo);
        sessionStorage.setItem(STORAGE.SESSION_VIEW_KEY, 'videoEditor');
      } catch {
        // sessionStorage might be disabled
      }
    }

    // Auto-load cursor data if available
    if (normalizedProject?.sources.cursorData) {
      get().loadCursorData(normalizedProject.sources.cursorData);
    }
  },

  loadCursorData: async (cursorDataPath: string) => {
    try {
      const recording = await invoke<CursorRecording>('load_cursor_recording_cmd', {
        path: cursorDataPath,
      });
      set({ cursorRecording: recording });

      // Debug: Compare cursor recording dimensions with video dimensions
      const { project } = get();
      if (project) {
        const videoDims = `${project.sources.originalWidth}x${project.sources.originalHeight}`;
        const cursorDims = `${recording.width}x${recording.height}`;
        if (videoDims !== cursorDims) {
          videoEditorLogger.warn(`[CURSOR_SYNC] Dimension mismatch! Video: ${videoDims}, Cursor: ${cursorDims}`);
        } else {
          videoEditorLogger.debug(`[CURSOR_SYNC] Dimensions match: ${videoDims}`);
        }
        videoEditorLogger.debug(
          `[CURSOR_SYNC] Cursor recording: ${recording.events.length} events, ` +
            `videoStartOffsetMs=${recording.videoStartOffsetMs ?? 0}ms`
        );
      }
    } catch (error) {
      videoEditorLogger.warn('Failed to load cursor recording:', error);
      // Don't fail - cursor data is optional for auto zoom
    }
  },

  saveProject: async () => {
    const { project, captionSegments, captionSettings } = get();
    if (!project) {
      videoEditorLogger.warn('No project to save');
      return;
    }

    set({ isSaving: true });

    try {
      // Include caption data in the project before saving
      const projectWithCaptions = {
        ...project,
        captions: captionSettings,
        captionSegments: captionSegments,
      };
      // Sanitize project to ensure all ms values are integers (Rust expects u64)
      const sanitizedProject = sanitizeProjectForSave(projectWithCaptions);
      await invoke('save_video_project', { project: sanitizedProject });

      const savedAt = new Date().toISOString();
      set({ isSaving: false, lastSavedAt: savedAt });
    } catch (error) {
      videoEditorLogger.error('Failed to save project:', error);
      set({ isSaving: false });
      throw error;
    }
  },

  clearEditor: () => {
    // Destroy GPU editor if active (fire-and-forget)
    const { editorInstanceId } = get();
    if (editorInstanceId) {
      invoke('destroy_editor_instance', { instanceId: editorInstanceId }).catch((e) =>
        videoEditorLogger.warn('Failed to destroy editor on clear:', e)
      );
    }

    set({
      project: null,
      editorInstanceId: null,
      editorInfo: null,
      isInitializingEditor: false,
      currentTimeMs: 0,
      currentFrame: 0,
      isPlaying: false,
      renderedFrame: null,
      selectedZoomRegionId: null,
      selectedWebcamSegmentIndex: null,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      selectedMaskSegmentId: null,
      isDraggingPlayhead: false,
      isDraggingZoomRegion: false,
      draggedZoomEdge: null,
      isDraggingSceneSegment: false,
      draggedSceneEdge: null,
      isDraggingAnnotationSegment: false,
      draggedAnnotationEdge: null,
      isDraggingMaskSegment: false,
      draggedMaskEdge: null,
      isDraggingTextSegment: false,
      draggedTextEdge: null,
      previewTimeMs: null,
      hoveredTrack: null,
      splitMode: false,
      timelineZoom: DEFAULT_TIMELINE_ZOOM,
      timelineScrollLeft: 0,
      timelineContainerWidth: 0,
      trackVisibility: {
        video: true,
        text: true,
        annotation: true,
        mask: true,
        zoom: true,
        scene: true,
      },
      isGeneratingAutoZoom: false,
      isExporting: false,
      exportProgress: null,
      exportInPointMs: null,
      exportOutPointMs: null,
    });
  },
});
