import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Loader2 } from 'lucide-react';
import { VideoEditorView } from '@/views/VideoEditorView';
import { useCaptureStore } from '@/stores/captureStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import {
  selectProject,
  selectClearEditor,
  selectSetExportProgress,
  selectIsExporting,
  selectSaveProject,
} from '@/stores/videoEditor/selectors';
import type { ExportProgress } from '@/types';
import { videoEditorLogger } from '@/utils/logger';
import { registerWorkspaceEditorSave } from '@/utils/workspaceEditorPersistence';
import type { CaptureNavigationControls } from './CanvasCaptureNavigation';

interface EmbeddedVideoEditorProps {
  onClose: () => void;
  isActive?: boolean;
  sidebarResetKey?: number;
}

type CaptureCollection = ReturnType<typeof useCaptureStore.getState>['captures'];
type NavigableCapture = CaptureCollection[number];
type VideoProject = ReturnType<typeof useVideoEditorStore.getState>['project'];

const SAVE_WAIT_TIMEOUT_MS = 5000;
const SAVE_WAIT_POLL_MS = 50;
const EMBEDDED_VIDEO_EDITOR_SIDEBAR_WIDTH_PX = 380;

function normalizeMediaPath(path: string | null | undefined): string {
  return (path ?? '').replace(/\\/g, '/').toLowerCase();
}

function isNavigableVideoEditorCapture(capture: NavigableCapture) {
  return capture.capture_type !== 'gif' && !capture.is_missing && !capture.damaged;
}

function getCurrentVideoCaptureIndex(
  navigableCaptures: NavigableCapture[],
  project: VideoProject,
) {
  if (!project) {
    return -1;
  }

  const screenVideoPath = normalizeMediaPath(project.sources.screenVideo);
  return navigableCaptures.findIndex((capture) =>
    capture.id === project.id ||
    normalizeMediaPath(capture.image_path) === screenVideoPath
  );
}

function getVideoCaptureNavigationState(captures: CaptureCollection, project: VideoProject) {
  const navigableCaptures = captures
    .filter(isNavigableVideoEditorCapture)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const currentCaptureIndex = getCurrentVideoCaptureIndex(navigableCaptures, project);
  const previousCapture = currentCaptureIndex > 0 ? navigableCaptures[currentCaptureIndex - 1] : null;
  const nextCapture =
    currentCaptureIndex >= 0 && currentCaptureIndex < navigableCaptures.length - 1
      ? navigableCaptures[currentCaptureIndex + 1]
      : null;

  return { navigableCaptures, previousCapture, nextCapture };
}

function getVideoCaptureNavigation(
  previousCapture: NavigableCapture | null,
  nextCapture: NavigableCapture | null,
  disabled: boolean,
  onNavigateCapture: (captureId: string) => void | Promise<void>,
): CaptureNavigationControls {
  return {
    canGoPrevious: canNavigateToCapture(previousCapture, disabled),
    canGoNext: canNavigateToCapture(nextCapture, disabled),
    onGoPrevious: getCaptureNavigationHandler(previousCapture, onNavigateCapture),
    onGoNext: getCaptureNavigationHandler(nextCapture, onNavigateCapture),
  };
}

function canNavigateToCapture(capture: NavigableCapture | null, disabled: boolean) {
  return capture !== null && !disabled;
}

function getCaptureNavigationHandler(
  capture: NavigableCapture | null,
  onNavigateCapture: (captureId: string) => void | Promise<void>,
) {
  if (!capture) {
    return undefined;
  }

  return () => void onNavigateCapture(capture.id);
}

function shouldSkipCaptureNavigation(
  isNavigating: boolean,
  loadingProjectId: string | null,
  isExporting: boolean,
) {
  return isNavigating || Boolean(loadingProjectId) || isExporting;
}

function getCaptureNavigationTarget(
  captureId: string,
  navigableCaptures: NavigableCapture[],
  project: VideoProject,
) {
  const targetCapture = navigableCaptures.find((capture) => capture.id === captureId);
  if (!targetCapture || targetCapture.id === project?.id) {
    return null;
  }

  return targetCapture;
}

async function saveCurrentEmbeddedVideoProject({
  project,
  waitForSavingToSettle,
  saveProject,
}: {
  project: VideoProject;
  waitForSavingToSettle: () => Promise<void>;
  saveProject: () => Promise<void>;
}) {
  if (!project) {
    return;
  }

  await waitForSavingToSettle();
  await saveProject();
  await waitForSavingToSettle();
}

async function saveEmbeddedVideoProjectBeforeClose({
  project,
  isExporting,
  waitForSavingToSettle,
  saveProject,
}: {
  project: VideoProject;
  isExporting: boolean;
  waitForSavingToSettle: () => Promise<void>;
  saveProject: () => Promise<void>;
}) {
  if (!project || isExporting) {
    return;
  }

  try {
    await saveCurrentEmbeddedVideoProject({ project, waitForSavingToSettle, saveProject });
  } catch (error) {
    videoEditorLogger.warn('Embedded video editor save-on-close failed:', error);
  }
}

async function loadEmbeddedCaptureTarget({
  targetCapture,
  clearEditor,
  loadProject,
  loadVideoProjectInWorkspace,
}: {
  targetCapture: NavigableCapture;
  clearEditor: () => void;
  loadProject: (projectId: string) => Promise<void>;
  loadVideoProjectInWorkspace: (videoPath: string) => Promise<void>;
}) {
  if (targetCapture.capture_type === 'video') {
    await loadVideoProjectInWorkspace(targetCapture.image_path);
    return;
  }

  clearEditor();
  await loadProject(targetCapture.id);
}

function EmbeddedVideoEditorLoading() {
  return (
    <div className="editor-window__state flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
        <p className="text-sm text-(--ink-muted)">Loading video project...</p>
      </div>
    </div>
  );
}

export const EmbeddedVideoEditor: React.FC<EmbeddedVideoEditorProps> = ({
  onClose,
  isActive = true,
  sidebarResetKey = 0,
}) => {
  const captures = useCaptureStore((state) => state.captures);
  const loadingProjectId = useCaptureStore((state) => state.loadingProjectId);
  const loadProject = useCaptureStore((state) => state.loadProject);
  const loadVideoProjectInWorkspace = useCaptureStore((state) => state.loadVideoProjectInWorkspace);
  const project = useVideoEditorStore(selectProject);
  const clearEditor = useVideoEditorStore(selectClearEditor);
  const setExportProgress = useVideoEditorStore(selectSetExportProgress);
  const isExporting = useVideoEditorStore(selectIsExporting);
  const saveProject = useVideoEditorStore(selectSaveProject);
  const isClosingRef = useRef(false);
  const isNavigatingRef = useRef(false);

  const waitForSavingToSettle = useCallback(async () => {
    const startedAt = Date.now();
    while (useVideoEditorStore.getState().isSaving) {
      if (Date.now() - startedAt > SAVE_WAIT_TIMEOUT_MS) return;
      await new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_POLL_MS));
    }
  }, []);

  const flushCurrentProject = useCallback(async () => {
    if (isExporting) return;
    await saveCurrentEmbeddedVideoProject({ project, waitForSavingToSettle, saveProject });
  }, [isExporting, project, saveProject, waitForSavingToSettle]);

  useEffect(
    () => registerWorkspaceEditorSave(flushCurrentProject),
    [flushCurrentProject]
  );

  const { navigableCaptures, previousCapture, nextCapture } = useMemo(
    () => getVideoCaptureNavigationState(captures, project),
    [captures, project]
  );

  useEffect(() => {
    const unlisten = listen<ExportProgress>('export-progress', (event) => {
      setExportProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setExportProgress]);

  // Save & cleanup when leaving the workspace.
  // Mirrors VideoEditorWindow's flushSaveBeforeClose so unsaved trim/zoom edits
  // are persisted when the user picks a different capture from the library.
  const handleClose = async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    await saveEmbeddedVideoProjectBeforeClose({
      project,
      isExporting,
      waitForSavingToSettle,
      saveProject,
    });

    clearEditor();
    onClose();
  };

  const handleNavigateCapture = useCallback(async (captureId: string) => {
    if (shouldSkipCaptureNavigation(isNavigatingRef.current, loadingProjectId, isExporting)) {
      return;
    }

    const targetCapture = getCaptureNavigationTarget(captureId, navigableCaptures, project);
    if (!targetCapture) {
      return;
    }

    try {
      isNavigatingRef.current = true;
      await saveCurrentEmbeddedVideoProject({ project, waitForSavingToSettle, saveProject });
      await loadEmbeddedCaptureTarget({
        targetCapture,
        clearEditor,
        loadProject,
        loadVideoProjectInWorkspace,
      });
    } catch (error) {
      videoEditorLogger.warn('Full-media navigation failed:', error);
    } finally {
      isNavigatingRef.current = false;
    }
  }, [
    clearEditor,
    isExporting,
    loadProject,
    loadVideoProjectInWorkspace,
    loadingProjectId,
    navigableCaptures,
    project,
    saveProject,
    waitForSavingToSettle,
  ]);

  // Avoid stale ref between project switches inside the same workspace mount.
  useEffect(() => {
    isClosingRef.current = false;
  }, [project?.id]);

  const captureNavigation = useMemo(
    () => getVideoCaptureNavigation(
      previousCapture,
      nextCapture,
      Boolean(loadingProjectId || isExporting),
      handleNavigateCapture,
    ),
    [handleNavigateCapture, isExporting, loadingProjectId, nextCapture, previousCapture]
  );

  if (!project) {
    return <EmbeddedVideoEditorLoading />;
  }

  return (
    <VideoEditorView
      onBack={() => {
        void handleClose();
      }}
      hideTopBar={true}
      isActive={isActive}
      sidebarResetKey={sidebarResetKey}
      fixedSidebarWidthPx={EMBEDDED_VIDEO_EDITOR_SIDEBAR_WIDTH_PX}
      captureNavigation={captureNavigation}
    />
  );
};
