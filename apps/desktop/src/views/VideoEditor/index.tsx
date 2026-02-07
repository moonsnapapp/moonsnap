/**
 * VideoEditorView Component
 *
 * Main view for editing video recordings with features like:
 * - Auto-zoom to clicks
 * - Cursor highlighting
 * - Webcam overlay toggling
 * - Timeline-based editing
 */

import { useCallback, forwardRef, useImperativeHandle, useEffect, useState, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { useCaptureStore } from '../../stores/captureStore';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { useVideoEditorShortcuts } from '../../hooks/useVideoEditorShortcuts';
import { VideoEditorToolbar } from './VideoEditorToolbar';
import { VideoEditorSidebar } from './VideoEditorSidebar';
import { VideoEditorPreview } from './VideoEditorPreview';
import { VideoEditorTimeline } from './VideoEditorTimeline';
import { ExportProgressOverlay } from './components/ExportProgressOverlay';
import type { ExportProgress, CropConfig } from '../../types';
import { videoEditorLogger } from '../../utils/logger';

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
}

/**
 * VideoEditorView - Main video editor component with preview, timeline, and controls.
 */
export const VideoEditorView = forwardRef<VideoEditorViewRef, VideoEditorViewProps>(function VideoEditorView(
  { onBack, hideTopBar },
  ref
) {
  const { setView } = useCaptureStore();
  const {
    project,
    togglePlayback,
    setCurrentTime,
    clearEditor,
    isExporting,
    exportProgress,
    exportVideo,
    setExportProgress,
    cancelExport,
    updateExportConfig,
    selectZoomRegion,
    timelineZoom,
    setTimelineZoom,
    // Zoom region
    selectedZoomRegionId,
    deleteZoomRegion,
    // Scene segment
    selectedSceneSegmentId,
    selectSceneSegment,
    deleteSceneSegment,
    // Mask segment
    selectedMaskSegmentId,
    selectMaskSegment,
    deleteMaskSegment,
    // Text segment
    selectedTextSegmentId,
    selectTextSegment,
    deleteTextSegment,
    // Trim segment
    selectedTrimSegmentId,
    selectTrimSegment,
    deleteTrimSegment,
    splitAtPlayhead,
    resetTrimSegments,
    undoTrim,
    redoTrim,
    // Save
    saveProject,
    isSaving,
    // IO markers
    setExportInPoint,
    setExportOutPoint,
    clearExportRange,
  } = useVideoEditorStore();

  // Crop dialog state
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);

  // Skip amount in milliseconds
  const SKIP_AMOUNT_MS = 5000;

  // Keyboard shortcut handlers
  const handleSkipBack = useCallback(() => {
    const store = useVideoEditorStore.getState();
    const newTime = Math.max(0, store.currentTimeMs - SKIP_AMOUNT_MS);
    setCurrentTime(newTime);
  }, [setCurrentTime]);

  const handleSkipForward = useCallback(() => {
    const store = useVideoEditorStore.getState();
    if (!store.project) return;
    const newTime = Math.min(store.project.timeline.durationMs, store.currentTimeMs + SKIP_AMOUNT_MS);
    setCurrentTime(newTime);
  }, [setCurrentTime]);

  const handleDeselect = useCallback(() => {
    // Deselect all segment types
    selectZoomRegion(null);
    selectSceneSegment(null);
    selectMaskSegment(null);
    selectTextSegment(null);
    selectTrimSegment(null);
  }, [selectZoomRegion, selectSceneSegment, selectMaskSegment, selectTextSegment, selectTrimSegment]);

  // Delete whichever segment type is currently selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedTrimSegmentId) {
      deleteTrimSegment(selectedTrimSegmentId);
    } else if (selectedZoomRegionId) {
      deleteZoomRegion(selectedZoomRegionId);
    } else if (selectedSceneSegmentId) {
      deleteSceneSegment(selectedSceneSegmentId);
    } else if (selectedMaskSegmentId) {
      deleteMaskSegment(selectedMaskSegmentId);
    } else if (selectedTextSegmentId) {
      deleteTextSegment(selectedTextSegmentId);
    }
  }, [
    selectedTrimSegmentId,
    selectedZoomRegionId,
    selectedSceneSegmentId,
    selectedMaskSegmentId,
    selectedTextSegmentId,
    deleteTrimSegment,
    deleteZoomRegion,
    deleteSceneSegment,
    deleteMaskSegment,
    deleteTextSegment,
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

  // Handle split at playhead - splits video trim segments
  const handleSplitAtPlayhead = useCallback(() => {
    splitAtPlayhead();
  }, [splitAtPlayhead]);

  // Handle reset trim segments - restore full video
  const handleResetTrimSegments = useCallback(() => {
    resetTrimSegments();
  }, [resetTrimSegments]);

  // Undo/redo handlers for trim operations
  const handleUndoTrim = useCallback(() => {
    undoTrim();
  }, [undoTrim]);

  const handleRedoTrim = useCallback(() => {
    redoTrim();
  }, [redoTrim]);

  // IO marker handlers
  const handleSetInPoint = useCallback(() => {
    const { currentTimeMs } = useVideoEditorStore.getState();
    setExportInPoint(currentTimeMs);
  }, [setExportInPoint]);

  const handleSetOutPoint = useCallback(() => {
    const { currentTimeMs } = useVideoEditorStore.getState();
    setExportOutPoint(currentTimeMs);
  }, [setExportOutPoint]);

  const handleClearExportRange = useCallback(() => {
    clearExportRange();
  }, [clearExportRange]);

  // Use keyboard shortcuts
  useVideoEditorShortcuts({
    enabled: !!project && !isExporting,
    onTogglePlayback: togglePlayback,
    onSeekToStart: () => setCurrentTime(0),
    onSeekToEnd: () => project && setCurrentTime(project.timeline.durationMs),
    onSkipBack: handleSkipBack,
    onSkipForward: handleSkipForward,
    onSplitAtPlayhead: handleSplitAtPlayhead,
    onDeleteSelected: handleDeleteSelected,
    onTimelineZoomIn: handleTimelineZoomIn,
    onTimelineZoomOut: handleTimelineZoomOut,
    onDeselect: handleDeselect,
    onSave: handleSave,
    onExport: () => {}, // Will be wired to handleExport after it's defined
    onUndoTrim: handleUndoTrim,
    onRedoTrim: handleRedoTrim,
    onSetInPoint: handleSetInPoint,
    onSetOutPoint: handleSetOutPoint,
  });

  // Listen for export progress events from Rust backend
  useEffect(() => {
    const unlisten = listen<ExportProgress>('export-progress', (event) => {
      setExportProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setExportProgress]);

  // Auto-save project when it changes (debounced)
  useEffect(() => {
    if (!project || isSaving || isExporting) return;

    const timeoutId = setTimeout(() => {
      saveProject().catch((error) => {
        // Silent fail for auto-save - user can manually save with Ctrl+S
        videoEditorLogger.warn('Auto-save failed:', error);
      });
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [project, isSaving, isExporting, saveProject]);

  // Navigate back to library
  const handleBack = useCallback(() => {
    clearEditor();
    if (onBack) {
      onBack();
    } else {
      setView('library');
    }
  }, [clearEditor, setView, onBack]);

  // Export video with zoom effects applied
  const handleExport = useCallback(async () => {
    if (!project) return;

    // Stop playback before exporting
    useVideoEditorStore.getState().setIsPlaying(false);

    try {
      // Show save dialog to choose output path
      const outputPath = await save({
        title: 'Export Video',
        defaultPath: `${project.name}.mp4`,
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
      toast.success(`Exported successfully`, {
        description: `${sizeMB} MB - ${result.format.toUpperCase()}`,
      });
    } catch (error) {
      videoEditorLogger.error('Export failed:', error);
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    }
  }, [project, exportVideo]);

  // Handle crop apply
  const handleCropApply = useCallback((crop: CropConfig) => {
    updateExportConfig({ crop });
    toast.success(crop.enabled ? 'Crop applied' : 'Crop removed');
  }, [updateExportConfig]);

  // Seek to start
  const handleSeekToStart = useCallback(() => {
    setCurrentTime(0);
  }, [setCurrentTime]);

  // Seek to end
  const handleSeekToEnd = useCallback(() => {
    if (project) {
      setCurrentTime(project.timeline.durationMs);
    }
  }, [project, setCurrentTime]);

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    togglePlayback,
    seekToStart: handleSeekToStart,
    seekToEnd: handleSeekToEnd,
    exportVideo: handleExport,
  }), [togglePlayback, handleSeekToStart, handleSeekToEnd, handleExport]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--polar-snow)]">
      {/* Main content area - Preview and Properties */}
      <div className="flex-1 flex min-h-0">
        {/* Left side: Top bar + Video Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar - hidden when embedded in window with its own titlebar */}
          {!hideTopBar && (
            <VideoEditorToolbar project={project} onBack={handleBack} />
          )}

          {/* Video Preview */}
          <VideoEditorPreview />
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
        onSplitAtPlayhead={handleSplitAtPlayhead}
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
