import React, { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Loader2 } from 'lucide-react';
import { VideoEditorView } from '@/views/VideoEditorView';
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

export const EmbeddedVideoEditor: React.FC<EmbeddedVideoEditorProps> = ({ onClose }) => {
  const project = useVideoEditorStore(selectProject);
  const clearEditor = useVideoEditorStore(selectClearEditor);
  const setExportProgress = useVideoEditorStore(selectSetExportProgress);
  const isExporting = useVideoEditorStore(selectIsExporting);
  const saveProject = useVideoEditorStore(selectSaveProject);
  const isClosingRef = useRef(false);

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

    const waitForSavingToSettle = async () => {
      const startedAt = Date.now();
      while (useVideoEditorStore.getState().isSaving) {
        if (Date.now() - startedAt > SAVE_WAIT_TIMEOUT_MS) return;
        await new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_POLL_MS));
      }
    };

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
    />
  );
};
