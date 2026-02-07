import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator, VideoProject, CursorRecording } from './types';
import { STORAGE } from '../../constants';
import { videoEditorLogger } from '../../utils/logger';
import { DEFAULT_TIMELINE_ZOOM } from './timelineSlice';

/**
 * Sanitize project for saving - ensures all millisecond values are integers.
 * Rust backend expects u64 for timeline values, but JS may have floats.
 */
export function sanitizeProjectForSave(project: VideoProject): VideoProject {
  return {
    ...project,
    sources: {
      ...project.sources,
      durationMs: Math.round(project.sources.durationMs),
    },
    timeline: {
      ...project.timeline,
      durationMs: Math.round(project.timeline.durationMs),
      inPoint: Math.round(project.timeline.inPoint),
      outPoint: Math.round(project.timeline.outPoint),
    },
    zoom: {
      ...project.zoom,
      regions: project.zoom.regions.map((region) => ({
        ...region,
        startMs: Math.round(region.startMs),
        endMs: Math.round(region.endMs),
      })),
    },
    mask: {
      ...project.mask,
      segments: project.mask.segments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    scene: {
      ...project.scene,
      segments: project.scene.segments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    webcam: {
      ...project.webcam,
      visibilitySegments: project.webcam.visibilitySegments.map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startMs),
        endMs: Math.round(segment.endMs),
      })),
    },
    // Note: text.segments uses start/end in seconds (f32), not ms
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
    // Restore IO markers from project (inPoint=0 → null, outPoint=durationMs → null)
    const exportInPointMs = project && project.timeline.inPoint > 0
      ? project.timeline.inPoint
      : null;
    const exportOutPointMs = project && project.timeline.outPoint < project.timeline.durationMs
      ? project.timeline.outPoint
      : null;

    set({
      project,
      cursorRecording: null, // Reset cursor recording when project changes
      currentTimeMs: 0,
      isPlaying: false,
      selectedZoomRegionId: null,
      selectedWebcamSegmentIndex: null,
      // Load caption data from project if available
      captionSegments: project?.captionSegments ?? [],
      captionSettings: project?.captions ?? get().captionSettings,
      // Restore IO markers
      exportInPointMs,
      exportOutPointMs,
    });

    // Save video project path to session storage for F5 persistence
    if (project?.sources.screenVideo) {
      try {
        sessionStorage.setItem(STORAGE.SESSION_VIDEO_PROJECT_PATH_KEY, project.sources.screenVideo);
        sessionStorage.setItem(STORAGE.SESSION_VIEW_KEY, 'videoEditor');
      } catch {
        // sessionStorage might be disabled
      }
    }

    // Auto-load cursor data if available
    if (project?.sources.cursorData) {
      get().loadCursorData(project.sources.cursorData);
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
      selectedMaskSegmentId: null,
      isDraggingPlayhead: false,
      isDraggingZoomRegion: false,
      draggedZoomEdge: null,
      isDraggingSceneSegment: false,
      draggedSceneEdge: null,
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
