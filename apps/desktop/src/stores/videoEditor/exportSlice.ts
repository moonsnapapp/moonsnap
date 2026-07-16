import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator, ExportProgress, ExportResult, ExportConfig, AutoZoomConfig, VideoProject, ZoomRegion, AnnotationSegment, SceneSegment, MaskSegment, TextSegment } from './types';
import { videoEditorLogger } from '../../utils/logger';
import { sanitizeProjectForSave } from './projectSlice';
import { clipSegmentsToTimelineRange, getEffectiveDuration } from './trimSlice';
import { preRenderForExport } from '../../utils/textPreRenderer';
import { preRenderAnnotationsForExport } from '../../utils/annotationPreRenderer';
import {
  calculateCompositionOutputSize,
  calculateFrameBoundsInComposition,
  MIN_COMPOSITION_FRAME_DIMENSION,
  toEven,
} from '../../utils/compositionBounds';
import { getContentDimensionsFromCrop } from '../../utils/videoContentDimensions';

const MIN_FRAME_DIMENSION = MIN_COMPOSITION_FRAME_DIMENSION;
let nextExportJobId = 0;

export type ExportStatus = 'idle' | 'exporting' | 'cancelling';

function createExportJobId(): string {
  nextExportJobId += 1;
  return `export-${nextExportJobId}`;
}

interface ExportOverlayFrameSizes {
  composition: { width: number; height: number };
  frame: { x: number; y: number; width: number; height: number };
}

function calculateExportOverlayFrameSizes(project: VideoProject): ExportOverlayFrameSizes {
  const crop = project.export.crop;
  const { width: rawVideoW, height: rawVideoH } = getContentDimensionsFromCrop(
    crop,
    project.sources.originalWidth ?? 1920,
    project.sources.originalHeight ?? 1080
  );
  const videoW = toEven(rawVideoW);
  const videoH = toEven(rawVideoH);
  const padding = project.export.background.padding;

  const composition = calculateCompositionOutputSize(
    videoW,
    videoH,
    padding,
    project.export.composition
  );
  const frameBounds = calculateFrameBoundsInComposition(
    videoW,
    videoH,
    padding,
    composition,
    project.export.composition
  );

  return {
    composition: {
      width: Math.max(MIN_FRAME_DIMENSION, composition.width),
      height: Math.max(MIN_FRAME_DIMENSION, composition.height),
    },
    frame: {
      x: frameBounds.x,
      y: frameBounds.y,
      width: Math.max(MIN_FRAME_DIMENSION, Math.floor(frameBounds.width)),
      height: Math.max(MIN_FRAME_DIMENSION, Math.floor(frameBounds.height)),
    },
  };
}

/**
 * Export state and actions for video export and auto-zoom generation
 */
export interface ExportSlice {
  // Export state
  isExporting: boolean;
  exportStatus: ExportStatus;
  activeExportJobId: string | null;
  exportProgress: ExportProgress | null;

  // Auto-zoom state
  isGeneratingAutoZoom: boolean;

  // Export config actions
  updateExportConfig: (updates: Partial<ExportConfig>) => void;

  // Export actions
  exportVideo: (outputPath: string) => Promise<ExportResult>;
  setExportProgress: (progress: ExportProgress) => void;
  cancelExport: () => Promise<void>;

  // Auto-zoom generation
  generateAutoZoom: (config?: AutoZoomConfig) => Promise<void>;
}

export const createExportSlice: SliceCreator<ExportSlice> = (set, get) => ({
  // Initial state
  isExporting: false,
  exportStatus: 'idle',
  activeExportJobId: null,
  exportProgress: null,
  isGeneratingAutoZoom: false,

  // Export config actions
  updateExportConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    videoEditorLogger.info('[updateExportConfig] Keys:', Object.keys(updates));
    if (updates.background) {
      videoEditorLogger.debug(
        '[updateExportConfig] Background keys:',
        Object.keys(updates.background as Record<string, unknown>)
      );
    }
    if (updates.composition) {
      videoEditorLogger.info('[updateExportConfig] Composition being set:', updates.composition);
    }

    set({
      project: {
        ...project,
        export: {
          ...project.export,
          ...updates,
        },
      },
    });
  },

  // Export actions
  exportVideo: async (outputPath: string): Promise<ExportResult> => {
    const {
      project,
      captionSegments,
      captionSettings,
      exportInPointMs,
      exportOutPointMs,
      exportStatus,
    } = get();
    if (!project) {
      throw new Error('No project loaded');
    }
    if (exportStatus !== 'idle') {
      throw new Error('An export is already in progress');
    }

    // Infer format from file extension to ensure consistency
    const ext = outputPath.split('.').pop()?.toLowerCase();
    const formatMap: Record<string, 'mp4' | 'webm' | 'gif'> = {
      mp4: 'mp4',
      webm: 'webm',
      gif: 'gif',
    };
    const selectedFormat = formatMap[ext ?? 'mp4'] ?? 'mp4';

    // Create project with correct format and caption data for export
    let projectWithCaptions = {
      ...project,
      export: {
        ...project.export,
        format: selectedFormat,
      },
      captions: captionSettings,
      captionSegments: captionSegments,
    };

    // Clip to IO range if markers are set
    if (exportInPointMs !== null || exportOutPointMs !== null) {
      const segments = projectWithCaptions.timeline.segments ?? [];
      const totalDurationMs = projectWithCaptions.timeline.durationMs;
      const effectiveDur = getEffectiveDuration(segments, totalDurationMs);

      // Clamp outPoint to effective duration
      const clampedOut = exportOutPointMs !== null ? Math.min(exportOutPointMs, effectiveDur) : null;

      const clippedSegments = clipSegmentsToTimelineRange(
        segments,
        exportInPointMs,
        clampedOut,
        totalDurationMs
      );

      const effectiveIn = exportInPointMs ?? 0;
      const effectiveOut = clampedOut ?? effectiveDur;

      // Clip zoom regions to IO range
      const clippedZoomRegions: ZoomRegion[] = projectWithCaptions.zoom.regions
        .filter((r) => r.startMs < effectiveOut && r.endMs > effectiveIn)
        .map((r) => ({
          ...r,
          startMs: Math.max(r.startMs, effectiveIn) - effectiveIn,
          endMs: Math.min(r.endMs, effectiveOut) - effectiveIn,
        }));

      // Clip scene segments to IO range
      const clippedSceneSegments: SceneSegment[] = projectWithCaptions.scene.segments
        .filter((s) => s.startMs < effectiveOut && s.endMs > effectiveIn)
        .map((s) => ({
          ...s,
          startMs: Math.max(s.startMs, effectiveIn) - effectiveIn,
          endMs: Math.min(s.endMs, effectiveOut) - effectiveIn,
        }));

      // Clip mask segments to IO range
      const clippedAnnotationSegments: AnnotationSegment[] = projectWithCaptions.annotations.segments
        .filter((s) => s.startMs < effectiveOut && s.endMs > effectiveIn)
        .map((s) => ({
          ...s,
          startMs: Math.max(s.startMs, effectiveIn) - effectiveIn,
          endMs: Math.min(s.endMs, effectiveOut) - effectiveIn,
        }));

      // Clip mask segments to IO range
      const clippedMaskSegments: MaskSegment[] = projectWithCaptions.mask.segments
        .filter((s) => s.startMs < effectiveOut && s.endMs > effectiveIn)
        .map((s) => ({
          ...s,
          startMs: Math.max(s.startMs, effectiveIn) - effectiveIn,
          endMs: Math.min(s.endMs, effectiveOut) - effectiveIn,
        }));

      // Clip text segments to IO range (text uses seconds, not ms)
      const effectiveInSec = effectiveIn / 1000;
      const effectiveOutSec = effectiveOut / 1000;
      const clippedTextSegments: TextSegment[] = projectWithCaptions.text.segments
        .filter((s) => s.start < effectiveOutSec && s.end > effectiveInSec)
        .map((s) => ({
          ...s,
          start: Math.max(s.start, effectiveInSec) - effectiveInSec,
          end: Math.min(s.end, effectiveOutSec) - effectiveInSec,
        }));

      projectWithCaptions = {
        ...projectWithCaptions,
        timeline: {
          ...projectWithCaptions.timeline,
          segments: clippedSegments,
        },
        zoom: {
          ...projectWithCaptions.zoom,
          regions: clippedZoomRegions,
        },
        annotations: {
          ...projectWithCaptions.annotations,
          segments: clippedAnnotationSegments,
        },
        scene: {
          ...projectWithCaptions.scene,
          segments: clippedSceneSegments,
        },
        mask: {
          ...projectWithCaptions.mask,
          segments: clippedMaskSegments,
        },
        text: {
          ...projectWithCaptions.text,
          segments: clippedTextSegments,
        },
      };

      videoEditorLogger.info(`IO range: ${effectiveIn}ms - ${effectiveOut}ms (${clippedSegments.length} segments)`);
    }

    // Sanitize project to ensure all ms values are integers (Rust expects u64)
    const sanitizedProject = sanitizeProjectForSave(projectWithCaptions);

    videoEditorLogger.info(`Exporting to: ${outputPath}`);
    videoEditorLogger.debug(
      `Format: ${selectedFormat}, Quality: ${sanitizedProject.export.quality}, FPS: ${sanitizedProject.export.fps}`
    );
    videoEditorLogger.debug('Scene config:', sanitizedProject.scene);
    videoEditorLogger.debug('Zoom config:', sanitizedProject.zoom);
    videoEditorLogger.info('Composition config:', sanitizedProject.export.composition);
    videoEditorLogger.info('Crop config:', sanitizedProject.export.crop);

    const jobId = createExportJobId();
    set({
      isExporting: true,
      exportStatus: 'exporting',
      activeExportJobId: jobId,
      exportProgress: null,
    });

    const clearActiveJob = () => {
      if (get().activeExportJobId === jobId) {
        set({
          isExporting: false,
          exportStatus: 'idle',
          activeExportJobId: null,
          exportProgress: null,
        });
      }
    };

    const throwIfCancelling = () => {
      const state = get();
      if (state.activeExportJobId === jobId && state.exportStatus === 'cancelling') {
        throw new Error('Export cancelled by user');
      }
    };

    try {
      // Pre-render text segments using OffscreenCanvas (WYSIWYG matching CSS preview)
      const textSegments = sanitizedProject.text?.segments ?? [];
      const overlayFrameSizes = calculateExportOverlayFrameSizes(sanitizedProject);
      if (textSegments.length > 0) {
        videoEditorLogger.info(
          `Pre-rendering ${textSegments.length} text segments at ${overlayFrameSizes.frame.width}x${overlayFrameSizes.frame.height} (video-content scale, composition placement)`
        );
        await preRenderForExport(
          textSegments,
          overlayFrameSizes.frame.width,
          overlayFrameSizes.frame.height,
          {
            getPlacement: (segment) => ({
              centerX:
                (overlayFrameSizes.frame.x + segment.center.x * overlayFrameSizes.frame.width) /
                overlayFrameSizes.composition.width,
              centerY:
                (overlayFrameSizes.frame.y + segment.center.y * overlayFrameSizes.frame.height) /
                overlayFrameSizes.composition.height,
            }),
          }
        );
        await preRenderAnnotationsForExport(
          sanitizedProject.annotations?.segments ?? [],
          overlayFrameSizes.composition.width,
          overlayFrameSizes.composition.height
        );
      } else if ((sanitizedProject.annotations?.segments.length ?? 0) > 0) {
        videoEditorLogger.info(
          `Pre-rendering ${sanitizedProject.annotations.segments.length} annotation segments at ${overlayFrameSizes.composition.width}x${overlayFrameSizes.composition.height} (composition frame)`
        );
        await preRenderForExport([], overlayFrameSizes.frame.width, overlayFrameSizes.frame.height);
        await preRenderAnnotationsForExport(
          sanitizedProject.annotations.segments,
          overlayFrameSizes.composition.width,
          overlayFrameSizes.composition.height
        );
      }

      throwIfCancelling();

      const result = await invoke<ExportResult>('export_video', {
        project: sanitizedProject,
        outputPath,
        jobId,
      });

      videoEditorLogger.info('Export success:', result);
      clearActiveJob();
      return result;
    } catch (error) {
      videoEditorLogger.error('Export failed:', error);
      clearActiveJob();
      throw error;
    }
  },

  setExportProgress: (progress: ExportProgress) => {
    const jobId = progress.jobId;
    const state = get();
    if (!jobId || jobId !== state.activeExportJobId || state.exportStatus === 'idle') {
      return;
    }
    set({ exportProgress: progress });
  },

  cancelExport: async () => {
    const { activeExportJobId: jobId, exportStatus } = get();
    if (!jobId || exportStatus === 'idle' || exportStatus === 'cancelling') {
      return;
    }

    set({ exportStatus: 'cancelling', isExporting: true });
    try {
      await invoke<boolean>('cancel_export', { jobId });
    } catch (error) {
      if (get().activeExportJobId === jobId && get().exportStatus === 'cancelling') {
        set({ exportStatus: 'exporting', isExporting: true });
      }
      videoEditorLogger.error('Failed to request export cancellation:', error);
      throw error;
    }
  },

  // Auto-zoom generation
  generateAutoZoom: async (config?: AutoZoomConfig) => {
    const { project } = get();
    if (!project) return;

    // Check if cursor data exists
    if (!project.sources.cursorData) {
      throw new Error(
        'No cursor data available for this recording. Auto-zoom requires cursor data to be recorded.'
      );
    }

    set({ isGeneratingAutoZoom: true });

    try {
      const updatedProject = await invoke<VideoProject>('generate_auto_zoom', {
        project,
        config: config ?? null,
      });

      set({
        project: updatedProject,
        isGeneratingAutoZoom: false,
      });
    } catch (error) {
      set({ isGeneratingAutoZoom: false });
      throw error;
    }
  },
});
