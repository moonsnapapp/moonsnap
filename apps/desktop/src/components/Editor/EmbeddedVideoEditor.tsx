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

interface EmbeddedVideoEditorProps {
  onClose: () => void;
}

const SAVE_WAIT_TIMEOUT_MS = 5000;
const SAVE_WAIT_POLL_MS = 50;

function normalizeMediaPath(path: string | null | undefined): string {
  return (path ?? '').replace(/\\/g, '/').toLowerCase();
}

export const EmbeddedVideoEditor: React.FC<EmbeddedVideoEditorProps> = ({ onClose }) => {
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

  const navigableCaptures = useMemo(
    () => captures
      .filter((capture) =>
        capture.capture_type !== 'gif' &&
        !capture.is_missing &&
        !capture.damaged
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [captures]
  );

  const currentCaptureIndex = useMemo(() => {
    if (!project) {
      return -1;
    }

    const screenVideoPath = normalizeMediaPath(project.sources.screenVideo);
    return navigableCaptures.findIndex((capture) =>
      capture.id === project.id ||
      normalizeMediaPath(capture.image_path) === screenVideoPath
    );
  }, [navigableCaptures, project]);

  const previousCapture = currentCaptureIndex > 0 ? navigableCaptures[currentCaptureIndex - 1] : null;
  const nextCapture =
    currentCaptureIndex >= 0 && currentCaptureIndex < navigableCaptures.length - 1
      ? navigableCaptures[currentCaptureIndex + 1]
      : null;

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

    if (project && !isExporting) {
      try {
        await waitForSavingToSettle();
        await saveProject();
        await waitForSavingToSettle();
      } catch (error) {
        videoEditorLogger.warn('Embedded video editor save-on-close failed:', error);
      }
    }

    clearEditor();
    onClose();
  };

  const handleNavigateCapture = useCallback(async (captureId: string) => {
    if (isNavigatingRef.current || loadingProjectId || isExporting) {
      return;
    }

    const targetCapture = navigableCaptures.find((capture) => capture.id === captureId);
    if (!targetCapture || targetCapture.id === project?.id) {
      return;
    }

    try {
      isNavigatingRef.current = true;
      if (project) {
        await waitForSavingToSettle();
        await saveProject();
        await waitForSavingToSettle();
      }

      if (targetCapture.capture_type === 'video') {
        await loadVideoProjectInWorkspace(targetCapture.image_path);
        return;
      }

      clearEditor();
      await loadProject(targetCapture.id);
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

  if (!project) {
    return (
      <div className="editor-window__state flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-(--coral-400)" />
          <p className="text-sm text-(--ink-muted)">Loading video project...</p>
        </div>
      </div>
    );
  }

  return (
    <VideoEditorView
      onBack={() => {
        void handleClose();
      }}
      hideTopBar={true}
      isActive={true}
      captureNavigation={{
        canGoPrevious: previousCapture !== null && !loadingProjectId && !isExporting,
        canGoNext: nextCapture !== null && !loadingProjectId && !isExporting,
        onGoPrevious: previousCapture ? () => void handleNavigateCapture(previousCapture.id) : undefined,
        onGoNext: nextCapture ? () => void handleNavigateCapture(nextCapture.id) : undefined,
      }}
    />
  );
};
