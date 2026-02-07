import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator, ExportProgress, ExportResult, ExportConfig, AutoZoomConfig, VideoProject, ZoomRegion, SceneSegment, MaskSegment, TextSegment } from './types';
import { videoEditorLogger } from '../../utils/logger';
import { sanitizeProjectForSave } from './projectSlice';
import { clipSegmentsToTimelineRange, getEffectiveDuration } from './trimSlice';

/**
 * Export state and actions for video export and auto-zoom generation
 */
export interface ExportSlice {
  // Export state
  isExporting: boolean;
  exportProgress: ExportProgress | null;

  // Auto-zoom state
  isGeneratingAutoZoom: boolean;

  // Export config actions
  updateExportConfig: (updates: Partial<ExportConfig>) => void;

  // Export actions
  exportVideo: (outputPath: string) => Promise<ExportResult>;
  setExportProgress: (progress: ExportProgress | null) => void;
  cancelExport: () => void;

  // Auto-zoom generation
  generateAutoZoom: (config?: AutoZoomConfig) => Promise<void>;
}

export const createExportSlice: SliceCreator<ExportSlice> = (set, get) => ({
  // Initial state
  isExporting: false,
  exportProgress: null,
  isGeneratingAutoZoom: false,

  // Export config actions
  updateExportConfig: (updates) => {
    const { project } = get();
    if (!project) return;

    videoEditorLogger.info('[updateExportConfig] Updates:', updates);
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
    const { project, captionSegments, captionSettings, exportInPointMs, exportOutPointMs } = get();
    if (!project) {
      throw new Error('No project loaded');
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

    set({ isExporting: true, exportProgress: null });

    try {
      const result = await invoke<ExportResult>('export_video', {
        project: sanitizedProject,
        outputPath,
      });

      videoEditorLogger.info('Export success:', result);
      set({ isExporting: false, exportProgress: null });
      return result;
    } catch (error) {
      videoEditorLogger.error('Export failed:', error);
      set({ isExporting: false, exportProgress: null });
      throw error;
    }
  },

  setExportProgress: (progress: ExportProgress | null) => {
    set({ exportProgress: progress });
  },

  cancelExport: () => {
    invoke('cancel_export').catch(() => {});
    set({ isExporting: false, exportProgress: null });
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
