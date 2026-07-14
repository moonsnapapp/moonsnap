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
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
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
  selectIsCropEditing,
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
  selectSelectedWebcamSegmentIndex,
  selectSelectedZoomRegionId,
  selectSetExportInPoint,
  selectSetExportOutPoint,
  selectSetIsCropEditing,
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
import { useUserActivityTracker } from '@/hooks/useUserActivityTracker';
import { useVideoProjectAutosave } from '@/hooks/useVideoProjectAutosave';
import { VideoEditorToolbar } from './VideoEditorToolbar';
import { VideoEditorSidebar } from './VideoEditorSidebar';
import { VideoEditorPreview } from './VideoEditorPreview';
import { VideoEditorTimeline } from './VideoEditorTimeline';
import { PreviewTopBar } from './PreviewTopBar';
import { ExportProgressOverlay } from './components/ExportProgressOverlay';
import { ExportDialog } from './components/ExportDialog';
import { ChevronRight } from 'lucide-react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../../components/ui/resizable';
import type { ExportProgress } from '../../types';
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
  /** Increment to force the right sidebar back to its minimum size. */
  sidebarResetKey?: number;
  /** Fixed right sidebar width for embedded workspaces that must not restore a percentage layout. */
  fixedSidebarWidthPx?: number;
  /** Optional previous/next capture navigation shown over the preview canvas pane. */
  captureNavigation?: CaptureNavigationControls;
}

const SKIP_AMOUNT_MS = 5000;
const SAVE_WAIT_TIMEOUT_MS = 5000;
const SAVE_WAIT_POLL_MS = 50;
// Persist the sidebar's pixel width ourselves rather than relying on
// react-resizable-panels' percentage-based autoSaveId â€” that restore
// doesn't fire reliably under HMR, so the panel falls back to defaultSize.
const SIDEBAR_WIDTH_STORAGE_KEY = 'moonsnap-video-editor-sidebar-px';
const DEFAULT_SIDEBAR_WIDTH_PX = 380;
// Hard pixel floor for the sidebar â€” translated to a percentage at runtime
// against the current workspace width (see `sidebarMinPct` below).
const SIDEBAR_MIN_PX = 380;
const SIDEBAR_INITIAL_PCT = 18;
const SIDEBAR_MAX_PCT = 45;

function withFileExtension(filename: string, extension: 'mp4' | 'webm' | 'gif'): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '');
  return `${withoutExtension}.${extension}`;
}

function readSavedSidebarWidthPx() {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = raw != null ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SIDEBAR_WIDTH_PX;
}

function getSidebarMinPct(containerWidth: number) {
  return Math.min(SIDEBAR_MAX_PCT, (SIDEBAR_MIN_PX / containerWidth) * 100);
}

function getDesiredSidebarPct(containerWidth: number, minPct: number) {
  const desiredPx = Math.max(SIDEBAR_MIN_PX, readSavedSidebarWidthPx());
  return Math.min(
    SIDEBAR_MAX_PCT,
    Math.max(minPct, (desiredPx / containerWidth) * 100)
  );
}

function useVideoEditorSidebarPersistence(isActive: boolean, sidebarResetKey: number) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const containerWidthRef = useRef(0);
  const isProgrammaticResizeRef = useRef(false);
  const isResizingSidebarRef = useRef(false);
  const forceSidebarMinRef = useRef(false);
  const pendingSidebarPctRef = useRef<number | null>(null);
  const [sidebarMinPct, setSidebarMinPct] = useState(SIDEBAR_INITIAL_PCT);

  useLayoutEffect(() => {
    const container = workspaceRef.current;
    if (!container) return;

    const update = () => {
      const width = container.clientWidth;
      if (width <= 0) return;
      containerWidthRef.current = width;

      const minPct = getSidebarMinPct(width);
      setSidebarMinPct(minPct);

      const panel = sidebarPanelRef.current;
      if (!panel) return;

      const desiredPct = forceSidebarMinRef.current
        ? minPct
        : getDesiredSidebarPct(width, minPct);
      const currentPct = panel.getSize();
      if (Math.abs(currentPct - desiredPct) > 0.01) {
        isProgrammaticResizeRef.current = true;
        panel.resize(desiredPct);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleSidebarResize = useCallback((size: number) => {
    if (isProgrammaticResizeRef.current) {
      isProgrammaticResizeRef.current = false;
      return;
    }

    if (forceSidebarMinRef.current) {
      const width = containerWidthRef.current || workspaceRef.current?.clientWidth || 0;
      if (width > 0) {
        const minPct = getSidebarMinPct(width);
        if (Math.abs(size - minPct) > 0.01) {
          isProgrammaticResizeRef.current = true;
          sidebarPanelRef.current?.resize(minPct);
          return;
        }
        forceSidebarMinRef.current = false;
      }
    }

    if (isResizingSidebarRef.current) {
      pendingSidebarPctRef.current = size;
    }
  }, []);

  const handleSidebarDragging = useCallback((isDragging: boolean) => {
    if (isDragging) {
      forceSidebarMinRef.current = false;
      isResizingSidebarRef.current = true;
      pendingSidebarPctRef.current = null;
      return;
    }

    isResizingSidebarRef.current = false;
    const pendingSize = pendingSidebarPctRef.current;
    pendingSidebarPctRef.current = null;
    persistPendingSidebarSize(pendingSize, containerWidthRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!isActive) return;

    let frameId = 0;
    const resetSidebarToMin = () => {
      const width = containerWidthRef.current || workspaceRef.current?.clientWidth || 0;
      if (width <= 0) return;

      forceSidebarMinRef.current = true;
      const minPct = getSidebarMinPct(width);
      setSidebarMinPct(minPct);
      persistSidebarSizePct(minPct, width);

      const panel = sidebarPanelRef.current;
      if (!panel) return;

      isProgrammaticResizeRef.current = true;
      panel.resize(minPct);
    };

    resetSidebarToMin();
    frameId = requestAnimationFrame(resetSidebarToMin);
    return () => cancelAnimationFrame(frameId);
  }, [isActive, sidebarResetKey]);

  const handlePanelGroupLayout = useCallback((sizes: number[]) => {
    if (!forceSidebarMinRef.current) return;

    const sidebarSize = sizes[1];
    const width = containerWidthRef.current || workspaceRef.current?.clientWidth || 0;
    if (typeof sidebarSize !== 'number' || width <= 0) return;

    const minPct = getSidebarMinPct(width);
    if (Math.abs(sidebarSize - minPct) <= 0.01) {
      forceSidebarMinRef.current = false;
      return;
    }

    setSidebarMinPct(minPct);
    persistSidebarSizePct(minPct, width);
    isProgrammaticResizeRef.current = true;
    sidebarPanelRef.current?.resize(minPct);
  }, []);

  return {
    workspaceRef,
    sidebarPanelRef,
    sidebarMinPct,
    handleSidebarResize,
    handleSidebarDragging,
    handlePanelGroupLayout,
  };
}

function persistPendingSidebarSize(sizePct: number | null, containerWidth: number) {
  const sidebarWidthPx = getPendingSidebarWidthPx(sizePct, containerWidth);
  if (sidebarWidthPx === null) return;
  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthPx));
}

function persistSidebarSizePct(sizePct: number, containerWidth: number) {
  const sidebarWidthPx = getPendingSidebarWidthPx(sizePct, containerWidth);
  if (sidebarWidthPx === null) return;
  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthPx));
}

function getPendingSidebarWidthPx(sizePct: number | null, containerWidth: number) {
  if (sizePct === null || containerWidth <= 0) return null;

  const widthPx = Math.round((sizePct / 100) * containerWidth);
  return widthPx > 0 ? widthPx : null;
}

function useVideoEditorDiagnostics(projectId: string | undefined, isActive: boolean) {
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

  useEffect(() => {
    let count = 0;
    const id = setInterval(() => {
      count++;
      videoEditorLogger.info(`Heartbeat #${count} - main thread alive at ${Date.now()}`);
      if (count >= 7) clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    videoEditorLogger.info('VideoEditorView mounted, project:', projectId ?? 'null', 'isActive:', isActive);
  }, [projectId, isActive]);
}

function useVideoExportProgressListener(setExportProgress: (progress: ExportProgress) => void) {
  useEffect(() => {
    const unlisten = listen<ExportProgress>('export-progress', (event) => {
      setExportProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setExportProgress]);
}

function useSuspendInactiveVideoEditor({
  isActive,
  isPlaying,
  setIsPlaying,
  setPreviewTime,
}: {
  isActive: boolean;
  isPlaying: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  setPreviewTime: (timeMs: number | null) => void;
}) {
  useEffect(() => {
    if (isActive) return;
    if (isPlaying) {
      setIsPlaying(false);
    }
    setPreviewTime(null);
  }, [isActive, isPlaying, setIsPlaying, setPreviewTime]);
}

type DeleteSelectedVideoEditorItem = ReturnType<typeof getDeleteSelectionAction>;
type VideoEditorProject = NonNullable<ReturnType<typeof useVideoEditorStore.getState>['project']>;
type ExportVideoFn = (outputPath: string) => Promise<{ fileSizeBytes: number; format: string }>;
type DeleteSelectedVideoEditorAction = NonNullable<DeleteSelectedVideoEditorItem>;
type DeleteSelectionHandlers = {
  deleteTrimSegment: (id: string) => void;
  deleteZoomRegion: (id: string) => void;
  deleteSceneSegment: (id: string) => void;
  deleteMaskSegment: (id: string) => void;
  deleteTextSegment: (id: string) => void;
  deleteAnnotationSegment: (id: string) => void;
  deleteAnnotationShape: (segmentId: string, shapeId: string) => void;
};
type DeleteActionRunnerMap = {
  [Type in DeleteSelectedVideoEditorAction['type']]: (
    action: Extract<DeleteSelectedVideoEditorAction, { type: Type }>,
    handlers: DeleteSelectionHandlers
  ) => void;
};

interface RenderedVideoExportOptions {
  isGif: boolean;
  exportActionLabel: string;
  dialogTitle: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

const DELETE_SELECTION_RUNNERS = {
  'trim-segment': (action, handlers) => handlers.deleteTrimSegment(action.id),
  'zoom-region': (action, handlers) => handlers.deleteZoomRegion(action.id),
  'scene-segment': (action, handlers) => handlers.deleteSceneSegment(action.id),
  'mask-segment': (action, handlers) => handlers.deleteMaskSegment(action.id),
  'text-segment': (action, handlers) => handlers.deleteTextSegment(action.id),
  'annotation-segment': (action, handlers) => handlers.deleteAnnotationSegment(action.id),
  'annotation-shape': (action, handlers) =>
    handlers.deleteAnnotationShape(action.segmentId, action.shapeId),
} satisfies DeleteActionRunnerMap;

function runDeleteSelectionAction(
  deleteAction: DeleteSelectedVideoEditorItem,
  handlers: DeleteSelectionHandlers
) {
  if (!deleteAction) {
    return;
  }

  DELETE_SELECTION_RUNNERS[deleteAction.type](deleteAction as never, handlers);
}

function runUndoForDomain(
  activeUndoDomain: string | null,
  undoAnnotation: () => void,
  undoTrim: () => void
) {
  if (activeUndoDomain === 'annotation') {
    undoAnnotation();
    return;
  }

  undoTrim();
}

function runRedoForDomain(
  activeUndoDomain: string | null,
  redoAnnotation: () => void,
  redoTrim: () => void
) {
  if (activeUndoDomain === 'annotation') {
    redoAnnotation();
    return;
  }

  redoTrim();
}

function getRenderedVideoExportOptions(project: VideoEditorProject): RenderedVideoExportOptions {
  const isGif = isGifExport(project);
  const extension = getRenderedVideoExportExtension(project);

  return {
    isGif,
    exportActionLabel: getVideoPrimaryActionLabel(project),
    dialogTitle: getRenderedVideoExportDialogTitle(project, isGif),
    defaultPath: withFileExtension(getVideoEditedDefaultFilename(project), extension),
    filters: getRenderedVideoExportFilters(isGif),
  };
}

function isGifExport(project: VideoEditorProject) {
  return project.export.format === 'gif';
}

function getRenderedVideoExportExtension(project: VideoEditorProject) {
  return getVideoExportExtension(project.export.format);
}

function getVideoExportExtension(format: VideoEditorProject['export']['format']) {
  return format === 'gif' || format === 'webm' ? format : 'mp4';
}

function getRenderedVideoExportDialogTitle(project: VideoEditorProject, isGif: boolean) {
  return isGif ? 'Export GIF' : getVideoExportDialogTitle(project);
}

function getRenderedVideoExportFilters(isGif: boolean) {
  return isGif
    ? [{ name: 'GIF Animation', extensions: ['gif'] }]
    : [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'WebM Video', extensions: ['webm'] },
      ];
}

function showSourceFrameRateNotice(project: VideoEditorProject) {
  if (project.export.fps === project.sources.fps) {
    return;
  }

  toast.info(`Export uses source frame rate (${project.sources.fps} fps)`, {
    description: 'Frame-rate conversion is not supported yet.',
  });
}

function showRenderedExportSuccess(
  result: Awaited<ReturnType<ExportVideoFn>>,
  options: RenderedVideoExportOptions
) {
  const sizeMB = (result.fileSizeBytes / (1024 * 1024)).toFixed(1);
  toast.success(options.isGif ? 'GIF exported' : options.exportActionLabel, {
    description: `${sizeMB} MB - ${result.format.toUpperCase()}`,
  });
}

async function runRenderedVideoExport(project: VideoEditorProject, exportVideo: ExportVideoFn) {
  const exportOptions = getRenderedVideoExportOptions(project);
  showSourceFrameRateNotice(project);

  useVideoEditorStore.getState().setIsPlaying(false);

  try {
    const outputPath = await save({
      title: exportOptions.dialogTitle,
      defaultPath: exportOptions.defaultPath,
      filters: exportOptions.filters,
    });

    if (!outputPath) {
      return;
    }

    const result = await exportVideo(outputPath);
    showRenderedExportSuccess(result, exportOptions);
  } catch (error) {
    videoEditorLogger.error('Export failed:', error);
    const message = error instanceof Error ? error.message : 'Export failed';
    toast.error(message);
  }
}

async function saveOriginalVideoExport(project: VideoEditorProject) {
  const exportDialogTitle = getVideoExportDialogTitle(project);
  const sourceFilename = getVideoOriginalFilename(project);

  try {
    const outputPath = await save({
      title: exportDialogTitle,
      defaultPath: sourceFilename,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });

    if (!outputPath) return;

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
}

async function requestVideoExport(
  project: VideoEditorProject | null,
  openExportDialog: () => void
) {
  if (!project) return;

  const outputMode =
    project.export.format === 'gif' ? 'render' : getVideoOutputMode(project);

  if (outputMode === 'original') {
    await saveOriginalVideoExport(project);
    return;
  }

  openExportDialog();
}

function hasNudgeableTimelineSelection({
  selectedZoomRegionId,
  selectedSceneSegmentId,
  selectedMaskSegmentId,
  selectedTextSegmentId,
  selectedAnnotationSegmentId,
  selectedWebcamSegmentIndex,
}: {
  selectedZoomRegionId: string | null;
  selectedSceneSegmentId: string | null;
  selectedMaskSegmentId: string | null;
  selectedTextSegmentId: string | null;
  selectedAnnotationSegmentId: string | null;
  selectedWebcamSegmentIndex: number | null;
}) {
  return [
    selectedZoomRegionId,
    selectedSceneSegmentId,
    selectedMaskSegmentId,
    selectedTextSegmentId,
    selectedAnnotationSegmentId,
    selectedWebcamSegmentIndex !== null,
  ].some(Boolean);
}

function useVideoEditorViewStoreBindings() {
  return {
    project: useVideoEditorStore(selectProject),
    isPlaying: useVideoEditorStore(selectIsPlaying),
    setIsPlaying: useVideoEditorStore(selectSetIsPlaying),
    setPreviewTime: useVideoEditorStore(selectSetPreviewTime),
    togglePlayback: useVideoEditorStore(selectTogglePlayback),
    requestSeek: useVideoEditorStore(selectRequestSeek),
    clearEditor: useVideoEditorStore(selectClearEditor),
    isExporting: useVideoEditorStore(selectIsExporting),
    exportProgress: useVideoEditorStore(selectExportProgress),
    exportVideo: useVideoEditorStore(selectExportVideo),
    setExportProgress: useVideoEditorStore(selectSetExportProgress),
    cancelExport: useVideoEditorStore(selectCancelExport),
    updateExportConfig: useVideoEditorStore(selectUpdateExportConfig),
    isCropEditing: useVideoEditorStore(selectIsCropEditing),
    setIsCropEditing: useVideoEditorStore(selectSetIsCropEditing),
    selectZoomRegion: useVideoEditorStore(selectSelectZoomRegion),
    timelineZoom: useVideoEditorStore(selectTimelineZoom),
    setTimelineZoom: useVideoEditorStore(selectSetTimelineZoom),
    fitTimelineToWindow: useVideoEditorStore(selectFitTimelineToWindow),
    selectedZoomRegionId: useVideoEditorStore(selectSelectedZoomRegionId),
    deleteZoomRegion: useVideoEditorStore(selectDeleteZoomRegion),
    selectedSceneSegmentId: useVideoEditorStore(selectSelectedSceneSegmentId),
    selectSceneSegment: useVideoEditorStore(selectSelectSceneSegment),
    deleteSceneSegment: useVideoEditorStore(selectDeleteSceneSegment),
    selectedMaskSegmentId: useVideoEditorStore(selectSelectedMaskSegmentId),
    selectMaskSegment: useVideoEditorStore(selectSelectMaskSegment),
    deleteMaskSegment: useVideoEditorStore(selectDeleteMaskSegment),
    selectedTextSegmentId: useVideoEditorStore(selectSelectedTextSegmentId),
    selectTextSegment: useVideoEditorStore(selectSelectTextSegment),
    deleteTextSegment: useVideoEditorStore(selectDeleteTextSegment),
    selectedAnnotationSegmentId: useVideoEditorStore(selectSelectedAnnotationSegmentId),
    selectedAnnotationShapeId: useVideoEditorStore(selectSelectedAnnotationShapeId),
    annotationDeleteMode: useVideoEditorStore(selectAnnotationDeleteMode),
    selectAnnotationSegment: useVideoEditorStore(selectSelectAnnotationSegment),
    deleteAnnotationSegment: useVideoEditorStore(selectDeleteAnnotationSegment),
    deleteAnnotationShape: useVideoEditorStore(selectDeleteAnnotationShape),
    undoAnnotation: useVideoEditorStore(selectUndoAnnotation),
    redoAnnotation: useVideoEditorStore(selectRedoAnnotation),
    selectedTrimSegmentId: useVideoEditorStore(selectSelectedTrimSegmentId),
    selectedWebcamSegmentIndex: useVideoEditorStore(selectSelectedWebcamSegmentIndex),
    selectTrimSegment: useVideoEditorStore(selectSelectTrimSegment),
    deleteTrimSegment: useVideoEditorStore(selectDeleteTrimSegment),
    activeUndoDomain: useVideoEditorStore(selectActiveUndoDomain),
    splitMode: useVideoEditorStore(selectSplitMode),
    setSplitMode: useVideoEditorStore(selectSetSplitMode),
    resetTrimSegments: useVideoEditorStore(selectResetTrimSegments),
    undoTrim: useVideoEditorStore(selectUndoTrim),
    redoTrim: useVideoEditorStore(selectRedoTrim),
    saveProject: useVideoEditorStore(selectSaveProject),
    isSaving: useVideoEditorStore(selectIsSaving),
    setExportInPoint: useVideoEditorStore(selectSetExportInPoint),
    setExportOutPoint: useVideoEditorStore(selectSetExportOutPoint),
    clearExportRange: useVideoEditorStore(selectClearExportRange),
  };
}

function seekSkipBack(requestSeek: (timeMs: number) => void) {
  const store = useVideoEditorStore.getState();
  requestSeek(Math.max(0, store.currentTimeMs - SKIP_AMOUNT_MS));
}

function seekSkipForward(requestSeek: (timeMs: number) => void) {
  const store = useVideoEditorStore.getState();
  if (!store.project) return;
  requestSeek(Math.min(store.project.timeline.durationMs, store.currentTimeMs + SKIP_AMOUNT_MS));
}

async function saveCurrentVideoProject({
  project,
  isSaving,
  saveProject,
}: {
  project: VideoEditorProject | null;
  isSaving: boolean;
  saveProject: () => Promise<void>;
}) {
  if (!project || isSaving) return;

  try {
    await saveProject();
    toast.success('Project saved');
  } catch {
    toast.error('Failed to save project');
  }
}

function seekToProjectEnd(
  project: VideoEditorProject | null,
  requestSeek: (timeMs: number) => void
) {
  if (project) {
    requestSeek(project.timeline.durationMs);
  }
}

async function navigateBackFromVideoEditor({
  flushSaveBeforeClose,
  onBack,
  clearEditor,
  setView,
}: {
  flushSaveBeforeClose: () => Promise<void>;
  onBack?: () => void;
  clearEditor: () => void;
  setView: (view: 'library') => void;
}) {
  await flushSaveBeforeClose();
  if (onBack) {
    onBack();
    return;
  }

  clearEditor();
  setView('library');
}

function useSaveVideoProjectBeforeUnload() {
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
}

async function waitForVideoEditorSavingToSettle() {
  const startedAt = Date.now();
  while (useVideoEditorStore.getState().isSaving) {
    if (Date.now() - startedAt > SAVE_WAIT_TIMEOUT_MS) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_POLL_MS));
  }
}

function useFlushVideoEditorSaveBeforeClose() {
  return useCallback(async () => {
    const state = useVideoEditorStore.getState();
    if (!state.project || state.isExporting) return;

    try {
      await waitForVideoEditorSavingToSettle();
      await useVideoEditorStore.getState().saveProject();
      await waitForVideoEditorSavingToSettle();
    } catch (error) {
      videoEditorLogger.warn('Save on close failed:', error);
    }
  }, []);
}

function OptionalVideoEditorToolbar({
  hidden,
  project,
  onBack,
}: {
  hidden: boolean | undefined;
  project: VideoEditorProject | null;
  onBack: () => void;
}) {
  if (hidden) return null;
  return <VideoEditorToolbar project={project} onBack={onBack} />;
}

function PreviewTopBarSection({
  project,
  isCropEditing,
  onSetIsCropEditing,
  onUpdateExportConfig,
  onExport,
}: {
  project: VideoEditorProject | null;
  isCropEditing: boolean;
  onSetIsCropEditing: (editing: boolean) => void;
  onUpdateExportConfig: ReturnType<typeof useVideoEditorViewStoreBindings>['updateExportConfig'];
  onExport: () => void;
}) {
  if (!project) return null;

  return (
    <PreviewTopBar
      project={project}
      isCropEditing={isCropEditing}
      onSetIsCropEditing={onSetIsCropEditing}
      onUpdateExportConfig={onUpdateExportConfig}
      onExport={onExport}
    />
  );
}

function ExportDialogSection({
  project,
  open,
  onOpenChange,
  onUpdateExportConfig,
  onConfirm,
}: {
  project: VideoEditorProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateExportConfig: ReturnType<typeof useVideoEditorViewStoreBindings>['updateExportConfig'];
  onConfirm: () => void;
}) {
  if (!project || !open) return null;

  return (
    <ExportDialog
      open
      project={project}
      onOpenChange={onOpenChange}
      onUpdateExportConfig={onUpdateExportConfig}
      onConfirm={onConfirm}
    />
  );
}

function VideoEditorMainColumn({
  hideTopBar,
  project,
  handleBack,
  isCropEditing,
  setIsCropEditing,
  updateExportConfig,
  handleExport,
  isActive,
  captureNavigation,
  handleResetTrimSegments,
  handleSetInPoint,
  handleSetOutPoint,
  handleClearExportRange,
}: {
  hideTopBar: boolean | undefined;
  project: VideoEditorProject | null;
  handleBack: () => void;
  isCropEditing: boolean;
  setIsCropEditing: (editing: boolean) => void;
  updateExportConfig: ReturnType<typeof useVideoEditorViewStoreBindings>['updateExportConfig'];
  handleExport: () => void | Promise<void>;
  isActive: boolean;
  captureNavigation: CaptureNavigationControls | undefined;
  handleResetTrimSegments: () => void;
  handleSetInPoint: () => void;
  handleSetOutPoint: () => void;
  handleClearExportRange: () => void;
}) {
  return (
    <div className="video-editor-content-column h-full flex flex-col min-w-0 min-h-0">
      <div className="editor-workspace__main flex-1 flex min-h-0">
        <div className="video-editor-main-pane flex-1 flex flex-col min-w-0">
          <OptionalVideoEditorToolbar
            hidden={hideTopBar}
            project={project}
            onBack={handleBack}
          />

          <PreviewTopBarSection
            project={project}
            isCropEditing={isCropEditing}
            onSetIsCropEditing={setIsCropEditing}
            onUpdateExportConfig={updateExportConfig}
            onExport={handleExport}
          />

          <VideoEditorPreview
            isActive={isActive}
            isCropEditing={isCropEditing}
            captureNavigation={captureNavigation}
          />
        </div>
      </div>

      <VideoEditorTimeline
        onResetTrimSegments={handleResetTrimSegments}
        onSetInPoint={handleSetInPoint}
        onSetOutPoint={handleSetOutPoint}
        onClearExportRange={handleClearExportRange}
      />
    </div>
  );
}

function FixedVideoEditorLayout({
  sidebarWidthPx,
  mainColumn,
  sidebar,
}: {
  sidebarWidthPx: number;
  mainColumn: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div
      className="video-editor-fixed-layout flex-1 min-h-0"
      style={{ '--video-editor-sidebar-width': `${sidebarWidthPx}px` } as CSSProperties}
    >
      <div className="min-w-0 min-h-0">{mainColumn}</div>
      <div className="video-editor-fixed-layout__divider" aria-hidden="true" />
      <aside className="video-editor-fixed-layout__sidebar min-w-0 min-h-0">
        {sidebar}
      </aside>
    </div>
  );
}

/**
 * VideoEditorView - Main video editor component with preview, timeline, and controls.
 */
export const VideoEditorView = forwardRef<VideoEditorViewRef, VideoEditorViewProps>(function VideoEditorView(
  {
    onBack,
    hideTopBar,
    isActive = true,
    sidebarResetKey = 0,
    fixedSidebarWidthPx,
    captureNavigation,
  },
  ref
) {
  const { setView } = useCaptureStore();
  const {
    project,
    isPlaying,
    setIsPlaying,
    setPreviewTime,
    togglePlayback,
    requestSeek,
    clearEditor,
    isExporting,
    exportProgress,
    exportVideo,
    setExportProgress,
    cancelExport,
    updateExportConfig,
    isCropEditing,
    setIsCropEditing,
    selectZoomRegion,
    timelineZoom,
    setTimelineZoom,
    fitTimelineToWindow,
    selectedZoomRegionId,
    deleteZoomRegion,
    selectedSceneSegmentId,
    selectSceneSegment,
    deleteSceneSegment,
    selectedMaskSegmentId,
    selectMaskSegment,
    deleteMaskSegment,
    selectedTextSegmentId,
    selectTextSegment,
    deleteTextSegment,
    selectedAnnotationSegmentId,
    selectedAnnotationShapeId,
    annotationDeleteMode,
    selectAnnotationSegment,
    deleteAnnotationSegment,
    deleteAnnotationShape,
    undoAnnotation,
    redoAnnotation,
    selectedTrimSegmentId,
    selectedWebcamSegmentIndex,
    selectTrimSegment,
    deleteTrimSegment,
    activeUndoDomain,
    splitMode,
    setSplitMode,
    resetTrimSegments,
    undoTrim,
    redoTrim,
    saveProject,
    isSaving,
    setExportInPoint,
    setExportOutPoint,
    clearExportRange,
  } = useVideoEditorViewStoreBindings();

  const lastUserActivityAtRef = useRef(Date.now());
  const handleExportRef = useRef<() => void>(() => {});
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const {
    workspaceRef,
    sidebarPanelRef,
    sidebarMinPct,
    handleSidebarResize,
    handleSidebarDragging,
    handlePanelGroupLayout,
  } = useVideoEditorSidebarPersistence(isActive, sidebarResetKey);
  useVideoEditorDiagnostics(project?.id, isActive);


  // Keyboard shortcut handlers
  const handleSkipBack = useCallback(() => {
    seekSkipBack(requestSeek);
  }, [requestSeek]);

  const handleSkipForward = useCallback(() => {
    seekSkipForward(requestSeek);
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

    runDeleteSelectionAction(deleteAction, {
      deleteTrimSegment,
      deleteZoomRegion,
      deleteSceneSegment,
      deleteMaskSegment,
      deleteTextSegment,
      deleteAnnotationSegment,
      deleteAnnotationShape,
    });
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
    await saveCurrentVideoProject({ project, isSaving, saveProject });
  }, [project, isSaving, saveProject]);

  // Toggle cut mode for click-to-cut on the timeline
  const handleToggleCutMode = useCallback(() => {
    setSplitMode(!splitMode);
  }, [setSplitMode, splitMode]);

  const handleSelectMode = useCallback(() => {
    setSplitMode(false);
  }, [setSplitMode]);

  // Handle reset trim segments - restore full video
  const handleResetTrimSegments = useCallback(() => {
    resetTrimSegments();
  }, [resetTrimSegments]);

  // Undo/redo handlers follow the last mutated history domain so deletes remain recoverable
  // even after they clear selection.
  const handleUndo = useCallback(() => {
    runUndoForDomain(activeUndoDomain, undoAnnotation, undoTrim);
  }, [activeUndoDomain, undoAnnotation, undoTrim]);

  const handleRedo = useCallback(() => {
    runRedoForDomain(activeUndoDomain, redoAnnotation, redoTrim);
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

  useVideoExportProgressListener(setExportProgress);

  // Track user activity so autosave only runs for user-driven edits.
  useUserActivityTracker(lastUserActivityAtRef);

  useVideoProjectAutosave({
    project,
    isExporting,
    saveProject,
    lastUserActivityAtRef,
  });

  useSuspendInactiveVideoEditor({
    isActive,
    isPlaying,
    setIsPlaying,
    setPreviewTime,
  });

  useSaveVideoProjectBeforeUnload();
  const flushSaveBeforeClose = useFlushVideoEditorSaveBeforeClose();

  // Navigate back to library
  const handleBack = useCallback(async () => {
    await navigateBackFromVideoEditor({
      flushSaveBeforeClose,
      onBack,
      clearEditor,
      setView,
    });
  }, [clearEditor, flushSaveBeforeClose, setView, onBack]);

  // Run the actual export (file picker + render). Assumes the user has already
  // confirmed their format/fps choices via the ExportDialog (or there are none
  // to make â€” see `handleExport` below for the 'original' bypass).
  const runExport = useCallback(async () => {
    if (!project) return;
    await runRenderedVideoExport(project, exportVideo);
  }, [project, exportVideo]);

  // Entry point for the Export button / shortcut. Opens the ExportDialog so
  // the user can pick format/fps/encoder first, except for the 'original'
  // bypass (no edits â†’ just copy the source). GIF always needs a render.
  const handleExport = useCallback(async () => {
    await requestVideoExport(project, () => setIsExportDialogOpen(true));
  }, [project]);

  const handleExportDialogConfirm = useCallback(() => {
    setIsExportDialogOpen(false);
    void runExport();
  }, [runExport]);

  const shouldDisablePlaybackArrowShortcuts = hasNudgeableTimelineSelection({
    selectedZoomRegionId,
    selectedSceneSegmentId,
    selectedMaskSegmentId,
    selectedTextSegmentId,
    selectedAnnotationSegmentId,
    selectedWebcamSegmentIndex,
  });

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
    onSeekToEnd: () => seekToProjectEnd(project, requestSeek),
    onSkipBack: handleSkipBack,
    onSkipForward: handleSkipForward,
    onToggleCutMode: handleToggleCutMode,
    onSelectMode: handleSelectMode,
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
    disablePlaybackArrowShortcuts: shouldDisablePlaybackArrowShortcuts,
  });

  // Seek to start
  const handleSeekToStart = useCallback(() => {
    requestSeek(0);
  }, [requestSeek]);

  // Seek to end
  const handleSeekToEnd = useCallback(() => {
    seekToProjectEnd(project, requestSeek);
  }, [project, requestSeek]);

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    togglePlayback,
    seekToStart: handleSeekToStart,
    seekToEnd: handleSeekToEnd,
    exportVideo: handleExport,
  }), [togglePlayback, handleSeekToStart, handleSeekToEnd, handleExport]);

  const mainColumn = (
    <VideoEditorMainColumn
      hideTopBar={hideTopBar}
      project={project}
      handleBack={handleBack}
      isCropEditing={isCropEditing}
      setIsCropEditing={setIsCropEditing}
      updateExportConfig={updateExportConfig}
      handleExport={handleExport}
      isActive={isActive}
      captureNavigation={captureNavigation}
      handleResetTrimSegments={handleResetTrimSegments}
      handleSetInPoint={handleSetInPoint}
      handleSetOutPoint={handleSetOutPoint}
      handleClearExportRange={handleClearExportRange}
    />
  );

  const sidebar = <VideoEditorSidebar project={project} />;

  return (
    <div ref={workspaceRef} className="editor-workspace video-editor-workspace flex-1 flex min-h-0">
      {fixedSidebarWidthPx ? (
        <FixedVideoEditorLayout
          sidebarWidthPx={fixedSidebarWidthPx}
          mainColumn={mainColumn}
          sidebar={sidebar}
        />
      ) : (
        <ResizablePanelGroup
          key={sidebarResetKey}
          direction="horizontal"
          className="flex-1 min-h-0"
          onLayout={handlePanelGroupLayout}
        >
          <ResizablePanel defaultSize={100 - sidebarMinPct} minSize={50} className="min-w-0">
            {mainColumn}
          </ResizablePanel>

          <ResizableHandle className="video-editor-resize-handle" onDragging={handleSidebarDragging}>
            <span className="sidebar-toggle-handle__chip" aria-hidden="true">
              <ChevronRight className="w-3 h-3" />
            </span>
          </ResizableHandle>

          <ResizablePanel
            ref={sidebarPanelRef}
            defaultSize={sidebarMinPct}
            minSize={sidebarMinPct}
            maxSize={SIDEBAR_MAX_PCT}
            onResize={handleSidebarResize}
            className="min-w-0"
          >
            {sidebar}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Export Progress Overlay */}
      <ExportProgressOverlay
        isExporting={isExporting}
        exportProgress={exportProgress}
        onCancel={cancelExport}
      />

      <ExportDialogSection
        project={project}
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        onUpdateExportConfig={updateExportConfig}
        onConfirm={handleExportDialogConfirm}
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
