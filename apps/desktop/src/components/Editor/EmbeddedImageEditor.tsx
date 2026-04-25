import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { ImageEditorContent } from '@/windows/ImageEditorWindow';
import { EditorStoreProvider, createEditorStore, type EditorStore } from '@/stores/editorStore';
import { useCaptureStore } from '@/stores/captureStore';
import { useProjectAnnotations } from '@/hooks/useProjectAnnotations';
import { useEditorActions } from '@/hooks/useEditorActions';
import { editorLogger } from '@/utils/logger';
import { TIMING } from '@/constants';
import type Konva from 'konva';

interface EmbeddedImageEditorProps {
  onClose: () => void;
}

interface EmbeddedImageEditorBodyProps {
  store: EditorStore;
  onClose: () => void;
}

const EmbeddedImageEditorBody: React.FC<EmbeddedImageEditorBodyProps> = ({ store, onClose }) => {
  const captures = useCaptureStore((state) => state.captures);
  const currentProject = useCaptureStore((state) => state.currentProject);
  const currentImageData = useCaptureStore((state) => state.currentImageData);
  const loadingProjectId = useCaptureStore((state) => state.loadingProjectId);
  const loadCaptures = useCaptureStore((state) => state.loadCaptures);
  const loadProject = useCaptureStore((state) => state.loadProject);
  const loadVideoProjectInWorkspace = useCaptureStore((state) => state.loadVideoProjectInWorkspace);
  const stageRef = useRef<Konva.Stage>(null);
  const isInitialLoadRef = useRef(true);
  const isSavingRef = useRef(false);
  const lastUserActivityAtRef = useRef(Date.now());

  useProjectAnnotations();

  const { saveProjectAnnotations } = useEditorActions({
    stageRef,
    imageData: currentImageData,
  });

  useEffect(() => {
    isInitialLoadRef.current = true;
    const timeoutId = setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 500);

    store.getState()._clearHistory();
    return () => clearTimeout(timeoutId);
  }, [currentProject?.id, store]);

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

  const saveAnnotations = useCallback(async () => {
    if (!currentProject || isSavingRef.current) {
      return;
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
  }, [currentProject, loadCaptures, saveProjectAnnotations]);

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
  const currentCaptureIndex = useMemo(
    () => navigableCaptures.findIndex((capture) => capture.id === currentProject?.id),
    [currentProject?.id, navigableCaptures]
  );
  const previousCapture = currentCaptureIndex > 0 ? navigableCaptures[currentCaptureIndex - 1] : null;
  const nextCapture =
    currentCaptureIndex >= 0 && currentCaptureIndex < navigableCaptures.length - 1
      ? navigableCaptures[currentCaptureIndex + 1]
      : null;

  const handleNavigateCapture = useCallback(async (captureId: string) => {
    if (loadingProjectId || captureId === currentProject?.id) {
      return;
    }

    const targetCapture = navigableCaptures.find((capture) => capture.id === captureId);
    if (!targetCapture) {
      return;
    }

    await saveAnnotations();
    if (targetCapture.capture_type === 'video') {
      await loadVideoProjectInWorkspace(targetCapture.image_path);
      return;
    }

    await loadProject(captureId);
  }, [
    currentProject?.id,
    loadProject,
    loadVideoProjectInWorkspace,
    loadingProjectId,
    navigableCaptures,
    saveAnnotations,
  ]);

  useEffect(() => {
    if (!currentProject || !currentImageData) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = store.subscribe((state, prevState) => {
      if (isInitialLoadRef.current) {
        return;
      }

      const changed =
        state.shapes !== prevState.shapes ||
        state.canvasBounds !== prevState.canvasBounds ||
        state.cropRegion !== prevState.cropRegion ||
        state.compositorSettings !== prevState.compositorSettings;

      if (!changed) {
        return;
      }

      if (
        Date.now() - lastUserActivityAtRef.current >
        TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_WINDOW_MS
      ) {
        return;
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const attemptSaveWhenIdle = () => {
        if (isInitialLoadRef.current) {
          return;
        }

        if (isSavingRef.current) {
          timeoutId = setTimeout(
            attemptSaveWhenIdle,
            TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_CHECK_MS
          );
          return;
        }

        const idleMs = Date.now() - lastUserActivityAtRef.current;
        if (idleMs < TIMING.IMAGE_EDITOR_AUTOSAVE_IDLE_MS) {
          timeoutId = setTimeout(
            attemptSaveWhenIdle,
            TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_CHECK_MS
          );
          return;
        }

        saveAnnotations();
      };

      timeoutId = setTimeout(
        attemptSaveWhenIdle,
        TIMING.IMAGE_EDITOR_AUTOSAVE_DEBOUNCE_MS
      );
    });

    return () => {
      unsubscribe();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [currentImageData, currentProject, saveAnnotations, store]);

  if (loadingProjectId || !currentProject || !currentImageData) {
    return (
      <div className="editor-window flex-1 flex flex-col min-h-0">
        <div className="editor-window__state flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-(--coral-400)" />
            <p className="text-sm text-(--ink-muted)">Loading image...</p>
          </div>
        </div>
      </div>
    );
  }

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
        captureNavigation={{
          canGoPrevious: previousCapture !== null && !loadingProjectId,
          canGoNext: nextCapture !== null && !loadingProjectId,
          onGoPrevious: previousCapture ? () => void handleNavigateCapture(previousCapture.id) : undefined,
          onGoNext: nextCapture ? () => void handleNavigateCapture(nextCapture.id) : undefined,
        }}
      />
    </div>
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
