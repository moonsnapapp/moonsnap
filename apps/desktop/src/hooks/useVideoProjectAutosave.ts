import { useEffect, type RefObject } from 'react';
import { TIMING } from '@/constants';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { videoEditorLogger } from '@/utils/logger';

type AutoSaveIdleAction =
  | { type: 'skip' }
  | { type: 'retry'; delayMs: number }
  | { type: 'save' };

function getAutoSaveIdleAction(
  state: ReturnType<typeof useVideoEditorStore.getState>,
  lastUserActivityAt: number
): AutoSaveIdleAction {
  if (!state.project || state.isExporting) {
    return { type: 'skip' };
  }

  if (
    state.isSaving ||
    Date.now() - lastUserActivityAt < TIMING.PROJECT_AUTOSAVE_IDLE_MS
  ) {
    return {
      type: 'retry',
      delayMs: TIMING.PROJECT_AUTOSAVE_ACTIVITY_CHECK_MS,
    };
  }

  return { type: 'save' };
}

export function useVideoProjectAutosave({
  project,
  isExporting,
  saveProject,
  lastUserActivityAtRef,
}: {
  project: object | null;
  isExporting: boolean;
  saveProject: () => Promise<void>;
  lastUserActivityAtRef: RefObject<number>;
}) {
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

      const action = getAutoSaveIdleAction(
        useVideoEditorStore.getState(),
        lastUserActivityAtRef.current
      );
      if (action.type === 'skip') {
        return;
      }

      if (action.type === 'retry') {
        timeoutId = setTimeout(attemptAutoSaveWhenIdle, action.delayMs);
        return;
      }

      saveProject().catch((error) => {
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
  }, [isExporting, lastUserActivityAtRef, project, saveProject]);
}
