/**
 * VideoEditorView Component
 *
 * Main view for editing video recordings with features like:
 * - Auto-zoom to clicks
 * - Cursor highlighting
 * - Webcam overlay toggling
 * - Timeline-based editing
 */

import {
  useCallback,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useState,
  lazy,
  Suspense,
  useRef,
} from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { useCaptureStore } from '../../stores/captureStore';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectIsPlaying,
  selectCancelExport,
  selectClearEditor,
  selectClearExportRange,
  selectDeleteMaskSegment,
  selectDeleteSceneSegment,
  selectDeleteAnnotationSegment,
  selectDeleteAnnotationShape,
  selectRedoAnnotation,
  selectDeleteTextSegment,
  selectDeleteTrimSegment,
  selectDeleteZoomRegion,
  selectExportProgress,
  selectExportVideo,
  selectActiveUndoDomain,
  selectIsExporting,
  selectIsSaving,
  selectProject,
  selectRedoTrim,
  selectRequestSeek,
  selectResetTrimSegments,
  selectSaveProject,
  selectSelectMaskSegment,
  selectSelectSceneSegment,
  selectSelectTextSegment,
  selectSelectTrimSegment,
  selectSelectAnnotationSegment,
  selectSelectZoomRegion,
  selectSelectedAnnotationSegmentId,
  selectSelectedAnnotationShapeId,
  selectAnnotationDeleteMode,
  selectUndoAnnotation,
  selectSelectedMaskSegmentId,
  selectSelectedSceneSegmentId,
  selectSelectedTextSegmentId,
  selectSelectedTrimSegmentId,
  selectSelectedZoomRegionId,
  selectSetExportInPoint,
  selectSetExportOutPoint,
  selectSetIsPlaying,
  selectSetPreviewTime,
  selectSetSplitMode,
  selectSetExportProgress,
  selectSetTimelineZoom,
  selectSplitMode,
  selectTimelineZoom,
  selectTogglePlayback,
  selectUndoTrim,
  selectUpdateExportConfig,
  selectFitTimelineToWindow,
} from '../../stores/videoEditor/selectors';
import { useVideoEditorShortcuts } from '../../hooks/useVideoEditorShortcuts';
import { VideoEditorToolbar } from './VideoEditorToolbar';
import { VideoEditorSidebar } from './VideoEditorSidebar';
import { VideoEditorPreview } from './VideoEditorPreview';
import { VideoEditorTimeline } from './VideoEditorTimeline';
import { ExportProgressOverlay } from './components/ExportProgressOverlay';
import { ProFeatureDialog } from '../../components/ProFeatureDialog';
import type { ExportProgress, CropConfig } from '../../types';
import { TIMING } from '../../constants';
import { videoEditorLogger } from '../../utils/logger';
import {
  getVideoExportDialogTitle,
  getVideoEditedDefaultFilename,
  getVideoOriginalFilename,
  getVideoOutputMode,
  getVideoPrimaryActionLabel,
} from '../../utils/videoExportMode';
import { getDeleteSelectionAction } from './deleteSelection';
import type { CaptureNavigationControls } from '../../components/Editor/CanvasCaptureNavigation';

// Lazy load CropDialog - only needed when crop tool is opened (861 lines)
const CropDialog = lazy(() => import('../../components/VideoEditor/CropDialog').then(m => ({ default: m.CropDialog })));

/**
 * Imperative API exposed by VideoEditorView
 */
export interface VideoEditorViewRef {
  togglePlayback: () => void;
  seekToStart: () => void;
  seekToEnd: () => void;
  exportVideo: () => void;
}

export interface VideoEditorViewProps {
  /** Custom back handler. If not provided, navigates to library view. */
  onBack?: () => void;
  /** Hide the top bar entirely (useful when embedded in a window with its own titlebar) */
  hideTopBar?: boolean;
  /** Whether this editor view is currently active/interactive. */
  isActive?: boolean;
  /** Optional previous/next capture navigation shown over the preview canvas pane. */
  captureNavigation?: CaptureNavigationControls;
}

const SKIP_AMOUNT_MS = 5000;
const SAVE_WAIT_TIMEOUT_MS = 5000;
const SAVE_WAIT_POLL_MS = 50;

/**
 * VideoEditorView - Main video editor component with preview, timeline, and controls.
 */
export const VideoEditorView = forwardRef<VideoEditorViewRef, VideoEditorViewProps>(function VideoEditorView(
  { onBack, hideTopBar, isActive = true, captureNavigation },
  ref
) {
  // Long-task detector: logs when the main thread is blocked for >50ms
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          videoEditorLogger.warn(`Main thread blocked for ${entry.duration.toFixed(0)}ms (name: ${entry.name})`);
        }
      });
      obs.observe({ type: 'longtask', buffered: true });
      return () => obs.disconnect();
    } catch {
      // longtask not supported in all browsers
    }
  }, []);

  // Heartbeat: check if main thread is responsive every 2s for the first 15s
  useEffect(() => {
    let count = 0;
    const id = setInterval(() => {
      count++;
      videoEditorLogger.info(`Heartbeat #${count} - main thread alive at ${Date.now()}`);
      if (count >= 7) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const { setView } = useCaptureStore();
  const project = useVideoEditorStore(selectProject);
  const isPlaying = useVideoEditorStore(selectIsPlaying);
  const setIsPlaying = useVideoEditorStore(selectSetIsPlaying);
  const setPreviewTime = useVideoEditorStore(selectSetPreviewTime);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);
  const requestSeek = useVideoEditorStore(selectRequestSeek);
  const clearEditor = useVideoEditorStore(selectClearEditor);
  const isExporting = useVideoEditorStore(selectIsExporting);
  const exportProgress = useVideoEditorStore(selectExportProgress);
  const exportVideo = useVideoEditorStore(selectExportVideo);
  const setExportProgress = useVideoEditorStore(selectSetExportProgress);
  const cancelExport = useVideoEditorStore(selectCancelExport);
  const updateExportConfig = useVideoEditorStore(selectUpdateExportConfig);
  const selectZoomRegion = useVideoEditorStore(selectSelectZoomRegion);
  const timelineZoom = useVideoEditorStore(selectTimelineZoom);
  const setTimelineZoom = useVideoEditorStore(selectSetTimelineZoom);
  const fitTimelineToWindow = useVideoEditorStore(selectFitTimelineToWindow);
  const selectedZoomRegionId = useVideoEditorStore(selectSelectedZoomRegionId);
  const deleteZoomRegion = useVideoEditorStore(selectDeleteZoomRegion);
  const selectedSceneSegmentId = useVideoEditorStore(selectSelectedSceneSegmentId);
  const selectSceneSegment = useVideoEditorStore(selectSelectSceneSegment);
  const deleteSceneSegment = useVideoEditorStore(selectDeleteSceneSegment);
  const selectedMaskSegmentId = useVideoEditorStore(selectSelectedMaskSegmentId);
  const selectMaskSegment = useVideoEditorStore(selectSelectMaskSegment);
  const deleteMaskSegment = useVideoEditorStore(selectDeleteMaskSegment);
  const selectedTextSegmentId = useVideoEditorStore(selectSelectedTextSegmentId);
  const selectTextSegment = useVideoEditorStore(selectSelectTextSegment);
  const deleteTextSegment = useVideoEditorStore(selectDeleteTextSegment);
  const selectedAnnotationSegmentId = useVideoEditorStore(selectSelectedAnnotationSegmentId);
  const selectedAnnotationShapeId = useVideoEditorStore(selectSelectedAnnotationShapeId);
  const annotationDeleteMode = useVideoEditorStore(selectAnnotationDeleteMode);
  const selectAnnotationSegment = useVideoEditorStore(selectSelectAnnotationSegment);
  const deleteAnnotationSegment = useVideoEditorStore(selectDeleteAnnotationSegment);
  const deleteAnnotationShape = useVideoEditorStore(selectDeleteAnnotationShape);
  const undoAnnotation = useVideoEditorStore(selectUndoAnnotation);
  const redoAnnotation = useVideoEditorStore(selectRedoAnnotation);
  const selectedTrimSegmentId = useVideoEditorStore(selectSelectedTrimSegmentId);
  const selectTrimSegment = useVideoEditorStore(selectSelectTrimSegment);
  const deleteTrimSegment = useVideoEditorStore(selectDeleteTrimSegment);
  const activeUndoDomain = useVideoEditorStore(selectActiveUndoDomain);
  const splitMode = useVideoEditorStore(selectSplitMode);
  const setSplitMode = useVideoEditorStore(selectSetSplitMode);
  const resetTrimSegments = useVideoEditorStore(selectResetTrimSegments);
  const undoTrim = useVideoEditorStore(selectUndoTrim);
  const redoTrim = useVideoEditorStore(selectRedoTrim);
  const saveProject = useVideoEditorStore(selectSaveProject);
  const isSaving = useVideoEditorStore(selectIsSaving);
  const setExportInPoint = useVideoEditorStore(selectSetExportInPoint);
  const setExportOutPoint = useVideoEditorStore(selectSetExportOutPoint);
  const clearExportRange = useVideoEditorStore(selectClearExportRange);

  // Crop dialog state
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const [lockedProFeature, setLockedProFeature] = useState<string | null>(null);
  const lastUserActivityAtRef = useRef(Date.now());
  const handleExportRef = useRef<() => void>(() => {});

  // Diagnostic: log when VideoEditorView renders
  useEffect(() => {
    videoEditorLogger.info('VideoEditorView mounted, project:', project?.id ?? 'null', 'isActive:', isActive);
  }, [project?.id, isActive]);


  // Keyboard shortcut handlers
  const handleSkipBack = useCallback(() => {
    const store = useVideoEditorStore.getState();
    const newTime = Math.max(0, store.currentTimeMs - SKIP_AMOUNT_MS);
    requestSeek(newTime);
  }, [requestSeek]);

  const handleSkipForward = useCallback(() => {
    const store = useVideoEditorStore.getState();
    if (!store.project) return;
    const newTime = Math.min(store.project.timeline.durationMs, store.currentTimeMs + SKIP_AMOUNT_MS);
    requestSeek(newTime);
  }, [requestSeek]);

  const handleDeselect = useCallback(() => {
    // Deselect all segment types
    selectZoomRegion(null);
    selectSceneSegment(null);
    selectMaskSegment(null);
    selectTextSegment(null);
    selectTrimSegment(null);
    selectAnnotationSegment(null);
  }, [selectZoomRegion, selectSceneSegment, selectMaskSegment, selectTextSegment, selectTrimSegment, selectAnnotationSegment]);

  // Delete whichever segment type is currently selected.
  // Annotations use explicit segment-vs-shape intent from the store.
  const handleDeleteSelected = useCallback(() => {
    const deleteAction = getDeleteSelectionAction({
      selectedTrimSegmentId,
      selectedZoomRegionId,
      selectedSceneSegmentId,
      selectedMaskSegmentId,
      selectedTextSegmentId,
      selectedAnnotationSegmentId,
      selectedAnnotationShapeId,
      annotationDeleteMode,
    });

    if (!deleteAction) {
      return;
    }

    switch (deleteAction.type) {
      case 'trim-segment':
        deleteTrimSegment(deleteAction.id);
        break;
      case 'zoom-region':
        deleteZoomRegion(deleteAction.id);
        break;
      case 'scene-segment':
        deleteSceneSegment(deleteAction.id);
        break;
      case 'mask-segment':
        deleteMaskSegment(deleteAction.id);
        break;
      case 'text-segment':
        deleteTextSegment(deleteAction.id);
        break;
      case 'annotation-segment':
        deleteAnnotationSegment(deleteAction.id);
        break;
      case 'annotation-shape':
        deleteAnnotationShape(deleteAction.segmentId, deleteAction.shapeId);
        break;
    }
  }, [
    selectedTrimSegmentId,
    selectedZoomRegionId,
    selectedSceneSegmentId,
    selectedMaskSegmentId,
    selectedTextSegmentId,
    selectedAnnotationSegmentId,
    selectedAnnotationShapeId,
    annotationDeleteMode,
    deleteTrimSegment,
    deleteZoomRegion,
    deleteSceneSegment,
    deleteMaskSegment,
    deleteTextSegment,
    deleteAnnotationSegment,
    deleteAnnotationShape,
  ]);

  const handleTimelineZoomIn = useCallback(() => {
    setTimelineZoom(timelineZoom * 1.5);
  }, [timelineZoom, setTimelineZoom]);

  const handleTimelineZoomOut = useCallback(() => {
    setTimelineZoom(timelineZoom / 1.5);
  }, [timelineZoom, setTimelineZoom]);

  // Save project handler
  const handleSave = useCallback(async () => {
    if (!project || isSaving) return;
    try {
      await saveProject();
      toast.success('Project saved');
    } catch {
      toast.error('Failed to save project');
    }
  }, [project, isSaving, saveProject]);

  // Toggle cut mode for click-to-cut on the timeline
  const handleToggleCutMode = useCallback(() => {
    setSplitMode(!splitMode);
  }, [setSplitMode, splitMode]);

  // Handle reset trim segments - restore full video
  const handleResetTrimSegments = useCallback(() => {
    resetTrimSegments();
  }, [resetTrimSegments]);

  // Undo/redo handlers follow the last mutated history domain so deletes remain recoverable
  // even after they clear selection.
  const handleUndo = useCallback(() => {
    if (activeUndoDomain === 'annotation') {
      undoAnnotation();
    } else {
      undoTrim();
    }
  }, [activeUndoDomain, undoAnnotation, undoTrim]);

  const handleRedo = useCallback(() => {
    if (activeUndoDomain === 'annotation') {
      redoAnnotation();
    } else {
      redoTrim();
    }
  }, [activeUndoDomain, redoAnnotation, redoTrim]);

  // IO marker handlers
  const handleSetInPoint = useCallback(() => {
    const { currentTimeMs, previewTimeMs } = useVideoEditorStore.getState();
    setExportInPoint(previewTimeMs ?? currentTimeMs);
  }, [setExportInPoint]);

  const handleSetOutPoint = useCallback(() => {
    const { currentTimeMs, previewTimeMs } = useVideoEditorStore.getState();
    setExportOutPoint(previewTimeMs ?? currentTimeMs);
  }, [setExportOutPoint]);

  const handleClearExportRange = useCallback(() => {
    clearExportRange();
  }, [clearExportRange]);

  // Listen for export progress events from Rust backend
  useEffect(() => {
    const unlisten = listen<ExportProgress>('export-progress', (event) => {
      setExportProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setExportProgress]);

  // Track user activity so autosave only runs for user-driven edits.
  useEffect(() => {
    const markUserActivity = () => {
      lastUserActivityAtRef.current = Date.now();
    };

    window.addEventListener('pointerdown', markUserActivity, { passive: true });
    window.addEventListener('keydown', markUserActivity);
    window.addEventListener('wheel', markUserActivity, { passive: true });
    window.addEventListener('touchstart', markUserActivity, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', markUserActivity);
      window.removeEventListener('keydown', markUserActivity);
      window.removeEventListener('wheel', markUserActivity);
      window.removeEventListener('touchstart', markUserActivity);
    };
  }, []);

  // Auto-save project when it changes (debounced)
  useEffect(() => {
    if (!project || isExporting) return;
    if (
      Date.now() - lastUserActivityAtRef.current >
      TIMING.PROJECT_AUTOSAVE_ACTIVITY_WINDOW_MS
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const attemptAutoSaveWhenIdle = () => {
      if (cancelled) return;

      const state = useVideoEditorStore.getState();
      if (!state.project || state.isExporting) return;

      if (state.isSaving) {
        timeoutId = setTimeout(
          attemptAutoSaveWhenIdle,
          TIMING.PROJECT_AUTOSAVE_ACTIVITY_CHECK_MS
        );
        return;
      }

      const idleMs = Date.now() - lastUserActivityAtRef.current;
      if (idleMs < TIMING.PROJECT_AUTOSAVE_IDLE_MS) {
        timeoutId = setTimeout(
          attemptAutoSaveWhenIdle,
          TIMING.PROJECT_AUTOSAVE_ACTIVITY_CHECK_MS
        );
        return;
      }

      saveProject().catch((error) => {
        // Silent fail for auto-save - user can manually save with Ctrl+S
        videoEditorLogger.warn('Auto-save failed:', error);
      });
    };

    timeoutId = setTimeout(
      attemptAutoSaveWhenIdle,
      TIMING.PROJECT_AUTOSAVE_DEBOUNCE_MS
    );

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [project, isExporting, saveProject]);

  // Suspend playback/scrub activity when the editor is not active.
  useEffect(() => {
    if (isActive) return;
    if (isPlaying) {
      setIsPlaying(false);
    }
    setPreviewTime(null);
  }, [isActive, isPlaying, setIsPlaying, setPreviewTime]);

  // Best-effort save when the tab/window is closed before autosave debounce fires.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = useVideoEditorStore.getState();
      if (!state.project || state.isExporting) return;
      void state.saveProject().catch((error) => {
        videoEditorLogger.warn('Save on window close failed:', error);
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Navigate back to library
  const flushSaveBeforeClose = useCallback(async () => {
    const waitForSavingToSettle = async () => {
      const startedAt = Date.now();
      while (useVideoEditorStore.getState().isSaving) {
        if (Date.now() - startedAt > SAVE_WAIT_TIMEOUT_MS) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_POLL_MS));
      }
    };

    const state = useVideoEditorStore.getState();
    if (!state.project || state.isExporting) return;

    try {
      // If an autosave is running, wait and then force one final save with latest state.
      await waitForSavingToSettle();
      await useVideoEditorStore.getState().saveProject();
      await waitForSavingToSettle();
    } catch (error) {
      videoEditorLogger.warn('Save on close failed:', error);
    }
  }, []);

  // Navigate back to library
  const handleBack = useCallback(async () => {
    await flushSaveBeforeClose();
    if (onBack) {
      onBack();
    } else {
      clearEditor();
      setView('library');
    }
  }, [clearEditor, flushSaveBeforeClose, setView, onBack]);

  // Export video with zoom effects applied
  const handleExport = useCallback(async () => {
    if (!project) return;

    // Pro feature gate: export requires a license
    const { isPro } = await import('../../stores/licenseStore').then(m => {
      const store = m.useLicenseStore.getState();
      return { isPro: store.isPro() };
    });
    if (!isPro) {
      setLockedProFeature('Video export');
      return;
    }

    const outputMode = getVideoOutputMode(project);
    const exportActionLabel = getVideoPrimaryActionLabel(project);
    const exportDialogTitle = getVideoExportDialogTitle(project);
    const sourceFilename = getVideoOriginalFilename(project);
    const editedDefaultFilename = getVideoEditedDefaultFilename(project);

    if (outputMode === 'original') {
      try {
        const outputPath = await save({
          title: exportDialogTitle,
          defaultPath: sourceFilename,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
        });

        if (!outputPath) {
          return;
        }

        await invoke('save_copy_of_file', {
          sourcePath: project.sources.screenVideo,
          destinationPath: outputPath,
        });

        toast.success('Original video saved', {
          description: 'Copied without rendering',
        });
      } catch (error) {
        videoEditorLogger.error('Save original failed:', error);
        const message = error instanceof Error ? error.message : 'Failed to save original video';
        toast.error(message);
      }
      return;
    }

    if (project.export.fps !== project.sources.fps) {
      toast.info(`Export uses source frame rate (${project.sources.fps} fps)`, {
        description: 'Frame-rate conversion is not supported yet.',
      });
    }

    // Stop playback before exporting
    useVideoEditorStore.getState().setIsPlaying(false);

    try {
      // Show save dialog to choose output path
      const outputPath = await save({
        title: exportDialogTitle,
        defaultPath: editedDefaultFilename,
        filters: [
          { name: 'MP4 Video', extensions: ['mp4'] },
          { name: 'WebM Video', extensions: ['webm'] },
          { name: 'GIF Animation', extensions: ['gif'] },
        ],
      });

      if (!outputPath) {
        // User cancelled
        return;
      }

      // Start export (store handles format inference from file extension)
      const result = await exportVideo(outputPath);

      // Show success toast with file info
      const sizeMB = (result.fileSizeBytes / (1024 * 1024)).toFixed(1);
      toast.success(exportActionLabel, {
        description: `${sizeMB} MB - ${result.format.toUpperCase()}`,
      });
    } catch (error) {
      videoEditorLogger.error('Export failed:', error);
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    }
  }, [project, exportVideo]);

  useEffect(() => {
    handleExportRef.current = () => {
      void handleExport();
    };
  }, [handleExport]);

  // Use keyboard shortcuts
  useVideoEditorShortcuts({
    enabled: !!project && !isExporting,
    onTogglePlayback: togglePlayback,
    onSeekToStart: () => requestSeek(0),
    onSeekToEnd: () => project && requestSeek(project.timeline.durationMs),
    onSkipBack: handleSkipBack,
    onSkipForward: handleSkipForward,
    onToggleCutMode: handleToggleCutMode,
    onDeleteSelected: handleDeleteSelected,
    onTimelineZoomIn: handleTimelineZoomIn,
    onTimelineZoomOut: handleTimelineZoomOut,
    onDeselect: handleDeselect,
    onSave: handleSave,
    onExport: () => handleExportRef.current(),
    onUndoTrim: handleUndo,
    onRedoTrim: handleRedo,
    onFitTimeline: fitTimelineToWindow,
    onSetInPoint: handleSetInPoint,
    onSetOutPoint: handleSetOutPoint,
  });

  // Handle crop apply
  const handleCropApply = useCallback((crop: CropConfig) => {
    updateExportConfig({ crop });
    toast.success(crop.enabled ? 'Crop applied' : 'Crop removed');
  }, [updateExportConfig]);

  // Seek to start
  const handleSeekToStart = useCallback(() => {
    requestSeek(0);
  }, [requestSeek]);

  // Seek to end
  const handleSeekToEnd = useCallback(() => {
    if (project) {
      requestSeek(project.timeline.durationMs);
    }
  }, [project, requestSeek]);

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    togglePlayback,
    seekToStart: handleSeekToStart,
    seekToEnd: handleSeekToEnd,
    exportVideo: handleExport,
  }), [togglePlayback, handleSeekToStart, handleSeekToEnd, handleExport]);

  return (
    <div className="editor-workspace video-editor-workspace flex-1 flex flex-col min-h-0">
      {/* Main content area - Preview and Properties */}
      <div className="editor-workspace__main flex-1 flex min-h-0">
        {/* Left side: Top bar + Video Preview */}
        <div className="video-editor-main-pane flex-1 flex flex-col min-w-0">
          {/* Top Bar - hidden when embedded in window with its own titlebar */}
          {!hideTopBar && (
            <VideoEditorToolbar project={project} onBack={handleBack} />
          )}

          {/* Video Preview */}
          <VideoEditorPreview
            isActive={isActive}
            captureNavigation={captureNavigation}
          />
        </div>

        {/* Right sidebar with tabbed properties panel */}
        <VideoEditorSidebar
          project={project}
          onOpenCropDialog={() => setIsCropDialogOpen(true)}
        />
      </div>

      {/* Timeline with integrated controls */}
      <VideoEditorTimeline
        onExport={handleExport}
        onResetTrimSegments={handleResetTrimSegments}
        onSetInPoint={handleSetInPoint}
        onSetOutPoint={handleSetOutPoint}
        onClearExportRange={handleClearExportRange}
      />

      {/* Crop Dialog - lazy loaded, crops video content before composition */}
      {project && isCropDialogOpen && (
        <Suspense fallback={null}>
          <CropDialog
            open={isCropDialogOpen}
            onClose={() => setIsCropDialogOpen(false)}
            onApply={handleCropApply}
            videoWidth={project.sources.originalWidth}
            videoHeight={project.sources.originalHeight}
            initialCrop={project.export.crop}
            videoPath={project.sources.screenVideo}
          />
        </Suspense>
      )}

      {/* Export Progress Overlay */}
      <ExportProgressOverlay
        isExporting={isExporting}
        exportProgress={exportProgress}
        onCancel={cancelExport}
      />

      <ProFeatureDialog
        open={lockedProFeature !== null}
        featureName={lockedProFeature ?? 'This feature'}
        onOpenChange={(open) => {
          if (!open) {
            setLockedProFeature(null);
          }
        }}
      />
    </div>
  );
});

// Re-export subcomponents for direct use if needed
export { VideoEditorToolbar } from './VideoEditorToolbar';
export { VideoEditorSidebar } from './VideoEditorSidebar';
export { VideoEditorPreview } from './VideoEditorPreview';
export { VideoEditorTimeline } from './VideoEditorTimeline';
export { PositionGrid } from './PositionGrid';
export { ZoomRegionConfig } from './ZoomRegionConfig';
export { MaskSegmentConfig } from './MaskSegmentConfig';
export { TextSegmentConfig } from './TextSegmentConfig';
