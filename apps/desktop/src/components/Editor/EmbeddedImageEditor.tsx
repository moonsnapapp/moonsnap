import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { ImageEditorContent } from '@/windows/ImageEditorWindow';
import { EditorStoreProvider, createEditorStore, type EditorStore } from '@/stores/editorStore';
import { useCaptureStore } from '@/stores/captureStore';
import { useProjectAnnotations } from '@/hooks/useProjectAnnotations';
import { useEditorActions } from '@/hooks/useEditorActions';
import { useUserActivityTracker } from '@/hooks/useUserActivityTracker';
import { scheduleImageEditorAutosaveEnable } from '@/hooks/imageEditorAutosave';
import { editorLogger } from '@/utils/logger';
import { registerWorkspaceEditorSave } from '@/utils/workspaceEditorPersistence';
import { TIMING } from '@/constants';
import type Konva from 'konva';

interface EmbeddedImageEditorProps {
  onClose: () => void;
}

interface EmbeddedImageEditorBodyProps {
  store: EditorStore;
  onClose: () => void;
}

type CaptureStoreState = ReturnType<typeof useCaptureStore.getState>;
type CaptureProject = CaptureStoreState['currentProject'];
type CaptureImageData = CaptureStoreState['currentImageData'];
type CaptureItem = CaptureStoreState['captures'][number];
type LoadCaptures = CaptureStoreState['loadCaptures'];
type LoadProject = CaptureStoreState['loadProject'];
type LoadVideoProjectInWorkspace = CaptureStoreState['loadVideoProjectInWorkspace'];

interface EmbeddedCaptureState {
  captures: CaptureItem[];
  currentProject: CaptureProject;
  currentImageData: CaptureImageData;
  loadingProjectId: string | null;
  loadCaptures: LoadCaptures;
  loadProject: LoadProject;
  loadVideoProjectInWorkspace: LoadVideoProjectInWorkspace;
}

function isNavigableCapture(capture: ReturnType<typeof useCaptureStore.getState>['captures'][number]) {
  return (
    capture.capture_type !== 'gif' &&
    !capture.is_missing &&
    !capture.damaged
  );
}

function hasAutosaveRelevantChange(
  state: ReturnType<EditorStore['getState']>,
  prevState: ReturnType<EditorStore['getState']>
) {
  return (
    state.shapes !== prevState.shapes ||
    state.canvasBounds !== prevState.canvasBounds ||
    state.cropRegion !== prevState.cropRegion ||
    state.compositorSettings !== prevState.compositorSettings
  );
}

function useResetEmbeddedEditorHistory(
  currentProjectId: string | undefined,
  store: EditorStore,
  isInitialLoadRef: React.RefObject<boolean>
) {
  useEffect(() => {
    isInitialLoadRef.current = true;
    const timeoutId = scheduleImageEditorAutosaveEnable(isInitialLoadRef);

    store.getState()._clearHistory();
    return () => clearTimeout(timeoutId);
  }, [currentProjectId, isInitialLoadRef, store]);
}

function useEmbeddedEditorAutosave({
  enabled,
  store,
  isInitialLoadRef,
  isSavingRef,
  lastUserActivityAtRef,
  saveAnnotations,
}: {
  enabled: boolean;
  store: EditorStore;
  isInitialLoadRef: React.RefObject<boolean>;
  isSavingRef: React.RefObject<boolean>;
  lastUserActivityAtRef: React.RefObject<number>;
  saveAnnotations: () => Promise<void>;
}) {
  useEffect(() => {
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleIdleSave = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(attemptSaveWhenIdle, TIMING.IMAGE_EDITOR_AUTOSAVE_DEBOUNCE_MS);
    };
    const attemptSaveWhenIdle = () => {
      if (isInitialLoadRef.current) return;

      if (isSavingRef.current) {
        timeoutId = setTimeout(attemptSaveWhenIdle, TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_CHECK_MS);
        return;
      }

      const idleMs = Date.now() - lastUserActivityAtRef.current;
      if (idleMs < TIMING.IMAGE_EDITOR_AUTOSAVE_IDLE_MS) {
        timeoutId = setTimeout(attemptSaveWhenIdle, TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_CHECK_MS);
        return;
      }

      saveAnnotations();
    };

    const unsubscribe = store.subscribe((state, prevState) => {
      if (isInitialLoadRef.current) return;
      if (!hasAutosaveRelevantChange(state, prevState)) return;
      if (
        Date.now() - lastUserActivityAtRef.current >
        TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_WINDOW_MS
      ) {
        return;
      }

      scheduleIdleSave();
    });

    return () => {
      unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    enabled,
    isInitialLoadRef,
    isSavingRef,
    lastUserActivityAtRef,
    saveAnnotations,
    store,
  ]);
}

function getCaptureNavigationState(
  captures: ReturnType<typeof useCaptureStore.getState>['captures'],
  currentProjectId: string | undefined
) {
  const navigableCaptures = captures
    .filter(isNavigableCapture)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const currentCaptureIndex = navigableCaptures.findIndex((capture) => capture.id === currentProjectId);
  const previousCapture = currentCaptureIndex > 0 ? navigableCaptures[currentCaptureIndex - 1] : null;
  const nextCapture =
    currentCaptureIndex >= 0 && currentCaptureIndex < navigableCaptures.length - 1
      ? navigableCaptures[currentCaptureIndex + 1]
      : null;

  return { navigableCaptures, previousCapture, nextCapture };
}

function useEmbeddedCaptureState(): EmbeddedCaptureState {
  return {
    captures: useCaptureStore((state) => state.captures),
    currentProject: useCaptureStore((state) => state.currentProject),
    currentImageData: useCaptureStore((state) => state.currentImageData),
    loadingProjectId: useCaptureStore((state) => state.loadingProjectId),
    loadCaptures: useCaptureStore((state) => state.loadCaptures),
    loadProject: useCaptureStore((state) => state.loadProject),
    loadVideoProjectInWorkspace: useCaptureStore((state) => state.loadVideoProjectInWorkspace),
  };
}

function useEmbeddedSaveAnnotations({
  currentProject,
  currentImageData,
  loadCaptures,
  isSavingRef,
}: {
  currentProject: CaptureProject;
  currentImageData: CaptureImageData;
  loadCaptures: LoadCaptures;
  isSavingRef: React.RefObject<boolean>;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const { saveProjectAnnotations } = useEditorActions({
    stageRef,
    imageData: currentImageData,
  });

  const saveAnnotations = useCallback(async () => {
    if (!currentProject) {
      return;
    }

    const waitStartedAt = Date.now();
    while (isSavingRef.current) {
      if (Date.now() - waitStartedAt > TIMING.EDITOR_SAVE_WAIT_TIMEOUT_MS) {
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.EDITOR_SAVE_WAIT_POLL_MS)
      );
    }

    try {
      isSavingRef.current = true;
      await saveProjectAnnotations();
      await loadCaptures();
    } catch (error) {
      editorLogger.warn('Embedded image editor auto-save failed:', error);
    } finally {
      isSavingRef.current = false;
    }
  }, [currentProject, isSavingRef, loadCaptures, saveProjectAnnotations]);

  return saveAnnotations;
}

function useEmbeddedCaptureNavigation({
  captures,
  currentProject,
  loadingProjectId,
  loadProject,
  loadVideoProjectInWorkspace,
  saveAnnotations,
}: {
  captures: CaptureItem[];
  currentProject: CaptureProject;
  loadingProjectId: string | null;
  loadProject: LoadProject;
  loadVideoProjectInWorkspace: LoadVideoProjectInWorkspace;
  saveAnnotations: () => Promise<void>;
}) {
  const { navigableCaptures, previousCapture, nextCapture } = useMemo(
    () => getCaptureNavigationState(captures, currentProject?.id),
    [captures, currentProject?.id]
  );

  const loadNavigatedCapture = useCallback(async (capture: CaptureItem) => {
    await saveAnnotations();
    if (capture.capture_type === 'video') {
      await loadVideoProjectInWorkspace(capture.image_path);
      return;
    }

    await loadProject(capture.id);
  }, [loadProject, loadVideoProjectInWorkspace, saveAnnotations]);

  const handleNavigateCapture = useCallback(async (captureId: string) => {
    if (!canNavigateEmbeddedCapture(captureId, loadingProjectId, currentProject?.id)) return;

    const targetCapture = getNavigableCaptureById(navigableCaptures, captureId);
    if (!targetCapture) return;
    await loadNavigatedCapture(targetCapture);
  }, [
    currentProject?.id,
    loadNavigatedCapture,
    loadingProjectId,
    navigableCaptures,
  ]);

  return useMemo(() => ({
    canGoPrevious: canNavigateToAdjacentCapture(previousCapture, loadingProjectId),
    canGoNext: canNavigateToAdjacentCapture(nextCapture, loadingProjectId),
    onGoPrevious: getAdjacentCaptureNavigationAction(previousCapture, handleNavigateCapture),
    onGoNext: getAdjacentCaptureNavigationAction(nextCapture, handleNavigateCapture),
  }), [handleNavigateCapture, loadingProjectId, nextCapture, previousCapture]);
}

function canNavigateEmbeddedCapture(
  captureId: string,
  loadingProjectId: string | null,
  currentProjectId: string | undefined
) {
  return !loadingProjectId && captureId !== currentProjectId;
}

function canNavigateToAdjacentCapture(capture: CaptureItem | null, loadingProjectId: string | null) {
  return capture !== null && !loadingProjectId;
}

function getAdjacentCaptureNavigationAction(
  capture: CaptureItem | null,
  handleNavigateCapture: (captureId: string) => Promise<void>,
) {
  return capture ? () => void handleNavigateCapture(capture.id) : undefined;
}

function getNavigableCaptureById(captures: CaptureItem[], captureId: string) {
  return captures.find((capture) => capture.id === captureId) ?? null;
}

function EmbeddedImageEditorLoading() {
  return (
    <div className="editor-window flex-1 flex flex-col min-h-0">
      <div className="editor-window__state flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
          <p className="text-sm text-(--ink-muted)">Loading image...</p>
        </div>
      </div>
    </div>
  );
}

function EmbeddedImageEditorLoaded({
  store,
  onClose,
  currentProject,
  currentImageData,
  captureNavigation,
}: {
  store: EditorStore;
  onClose: () => void;
  currentProject: NonNullable<CaptureProject>;
  currentImageData: NonNullable<CaptureImageData>;
  captureNavigation: ReturnType<typeof useEmbeddedCaptureNavigation>;
}) {
  return (
    <div className="editor-window flex-1 flex flex-col min-h-0">
      <ImageEditorContent
        imageData={currentImageData}
        projectId={currentProject.id}
        capturePath={currentProject.original_image}
        store={store}
        onClose={onClose}
        resolveProjectForCapturePath={async () => ({
          projectId: currentProject.id,
          capturePath: currentProject.original_image,
        })}
        captureNavigation={captureNavigation}
      />
    </div>
  );
}

function getEmbeddedImageEditorReadyState(
  loadingProjectId: string | null,
  currentProject: CaptureProject,
  currentImageData: CaptureImageData
) {
  if (loadingProjectId || !currentProject || !currentImageData) return null;
  return { currentProject, currentImageData };
}

const EmbeddedImageEditorBody: React.FC<EmbeddedImageEditorBodyProps> = ({ store, onClose }) => {
  const {
    captures,
    currentProject,
    currentImageData,
    loadingProjectId,
    loadCaptures,
    loadProject,
    loadVideoProjectInWorkspace,
  } = useEmbeddedCaptureState();
  const isInitialLoadRef = useRef(true);
  const isSavingRef = useRef(false);
  const lastUserActivityAtRef = useRef(Date.now());

  useProjectAnnotations();

  useResetEmbeddedEditorHistory(currentProject?.id, store, isInitialLoadRef);

  useUserActivityTracker(lastUserActivityAtRef);

  const saveAnnotations = useEmbeddedSaveAnnotations({
    currentProject,
    currentImageData,
    loadCaptures,
    isSavingRef,
  });

  useEffect(
    () => registerWorkspaceEditorSave(saveAnnotations),
    [saveAnnotations]
  );
  const captureNavigation = useEmbeddedCaptureNavigation({
    captures,
    currentProject,
    loadingProjectId,
    loadProject,
    loadVideoProjectInWorkspace,
    saveAnnotations,
  });

  useEmbeddedEditorAutosave({
    enabled: Boolean(currentProject && currentImageData),
    store,
    isInitialLoadRef,
    isSavingRef,
    lastUserActivityAtRef,
    saveAnnotations,
  });

  const readyState = getEmbeddedImageEditorReadyState(
    loadingProjectId,
    currentProject,
    currentImageData
  );

  if (!readyState) {
    return <EmbeddedImageEditorLoading />;
  }

  return (
    <EmbeddedImageEditorLoaded
      store={store}
      onClose={onClose}
      currentProject={readyState.currentProject}
      currentImageData={readyState.currentImageData}
      captureNavigation={captureNavigation}
    />
  );
};

export const EmbeddedImageEditor: React.FC<EmbeddedImageEditorProps> = ({ onClose }) => {
  const [store] = useState(() => createEditorStore());

  return (
    <EditorStoreProvider store={store}>
      <EmbeddedImageEditorBody store={store} onClose={onClose} />
    </EditorStoreProvider>
  );
};
