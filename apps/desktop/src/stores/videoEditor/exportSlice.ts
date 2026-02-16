import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator, ExportProgress, ExportResult, ExportConfig, AutoZoomConfig, VideoProject, ZoomRegion, SceneSegment, MaskSegment, TextSegment } from './types';
import { videoEditorLogger } from '../../utils/logger';
import { sanitizeProjectForSave } from './projectSlice';
import { clipSegmentsToTimelineRange, getEffectiveDuration } from './trimSlice';
import { preRenderForExport } from '../../utils/textPreRenderer';

const MIN_FRAME_DIMENSION = 1;

const toEven = (value: number): number => Math.floor(value / 2) * 2;

function calculateCompositionOutputSize(
  project: VideoProject,
  videoW: number,
  videoH: number,
  padding: number,
): { width: number; height: number } {
  const composition = project.export.composition;

  if (composition.mode === 'auto') {
    return {
      width: toEven(videoW + padding * 2),
      height: toEven(videoH + padding * 2),
    };
  }

  if (composition.width && composition.height) {
    return {
      width: toEven(composition.width),
      height: toEven(composition.height),
    };
  }

  if (composition.aspectRatio) {
    const videoRatio = videoW / videoH;
    const targetRatio = composition.aspectRatio;

    if (targetRatio > videoRatio) {
      const h = videoH + padding * 2;
      const w = Math.floor(h * targetRatio);
      return { width: toEven(w), height: toEven(h) };
    }

    const w = videoW + padding * 2;
    const h = Math.floor(w / targetRatio);
    return { width: toEven(w), height: toEven(h) };
  }

  return {
    width: toEven(videoW + padding * 2),
    height: toEven(videoH + padding * 2),
  };
}

function calculateTextFrameSizeForExport(project: VideoProject): { width: number; height: number } {
  const crop = project.export.crop;
  const cropEnabled = crop?.enabled && crop.width > 0 && crop.height > 0;

  const rawVideoW = cropEnabled ? crop.width : (project.sources.originalWidth ?? 1920);
  const rawVideoH = cropEnabled ? crop.height : (project.sources.originalHeight ?? 1080);
  const videoW = toEven(rawVideoW);
  const videoH = toEven(rawVideoH);
  const padding = project.export.background.padding;

  const composition = calculateCompositionOutputSize(project, videoW, videoH, padding);

  // Mirrors Rust parity::calculate_composition_bounds() used by exporter/mod.rs.
  if (project.export.composition.mode !== 'manual') {
    return {
      width: Math.max(MIN_FRAME_DIMENSION, videoW),
      height: Math.max(MIN_FRAME_DIMENSION, videoH),
    };
  }

  const availableW = Math.max(MIN_FRAME_DIMENSION, composition.width - padding * 2);
  const availableH = Math.max(MIN_FRAME_DIMENSION, composition.height - padding * 2);
  const videoAspect = videoW / videoH;
  const availableAspect = availableW / availableH;

  const frameW = videoAspect > availableAspect ? availableW : availableH * videoAspect;
  const frameH = videoAspect > availableAspect ? availableW / videoAspect : availableH;

  return {
    width: Math.max(MIN_FRAME_DIMENSION, Math.floor(frameW)),
    height: Math.max(MIN_FRAME_DIMENSION, Math.floor(frameH)),
  };
}

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
      // Pre-render text segments using OffscreenCanvas (WYSIWYG matching CSS preview)
      const textSegments = sanitizedProject.text?.segments ?? [];
      if (textSegments.length > 0) {
        const textFrameSize = calculateTextFrameSizeForExport(sanitizedProject);
        videoEditorLogger.info(
          `Pre-rendering ${textSegments.length} text segments at ${textFrameSize.width}x${textFrameSize.height} (video-content frame)`
        );
        await preRenderForExport(textSegments, textFrameSize.width, textFrameSize.height);
      }

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
