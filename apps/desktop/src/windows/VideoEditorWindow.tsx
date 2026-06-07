/**
 * VideoEditorWindow - Dedicated window for video editing.
 *
 * Each video opens in its own window for faster switching between projects.
 * Receives project path via URL query params and loads the project independently.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Loader2 } from 'lucide-react';
import { HudTitlebar } from '@/components/Titlebar/Titlebar';
import { VideoEditorView } from '@/views/VideoEditorView';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import {
  selectProjectName,
  selectSetProject,
  selectClearEditor,
  selectSetExportProgress,
} from '@/stores/videoEditor/selectors';
import { useTheme } from '@/hooks/useTheme';
import type { VideoProject, ExportProgress } from '@/types';
import { videoEditorLogger } from '@/utils/logger';

/**
 * VideoEditorWindow - Standalone video editor window.
 */
const SAVE_WAIT_TIMEOUT_MS = 5000;
const SAVE_WAIT_POLL_MS = 50;

function isGifPath(path: string): boolean {
  return path.toLowerCase().endsWith('.gif');
}

async function forwardGifToGifEditor(path: string) {
  try {
    await invoke('show_gif_editor_window', { capturePath: path });
  } catch (forwardError) {
    videoEditorLogger.error('Failed to open GIF editor:', forwardError);
  }

  await getCurrentWebviewWindow().destroy();
}

async function loadVideoProject(path: string): Promise<VideoProject> {
  console.time('[EDITOR-INIT] load_video_project');
  videoEditorLogger.info('Loading video project:', path);

  try {
    return await invoke<VideoProject>('load_video_project', {
      videoPath: path,
    });
  } finally {
    console.timeEnd('[EDITOR-INIT] load_video_project');
  }
}

function logLoadedVideoProject(videoProject: VideoProject) {
  videoEditorLogger.info('[EDITOR-INIT] Project sources:', JSON.stringify(videoProject.sources, null, 2));
  videoEditorLogger.info(`[EDITOR-INIT] Dimensions: ${videoProject.sources.originalWidth}x${videoProject.sources.originalHeight}, duration: ${videoProject.timeline.durationMs}ms, fps: ${videoProject.sources.fps}`);
  videoEditorLogger.info(`[EDITOR-INIT] Timeline segments: ${videoProject.timeline.segments?.length ?? 0}`);
}

function getProjectLoadErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load video project';
}

function VideoEditorWindowShell({
  detailLabel,
  onClose,
  children,
}: {
  detailLabel: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="editor-window h-screen w-screen flex flex-col overflow-hidden">
      <HudTitlebar
        title="MoonSnap"
        contextLabel="Video Editor"
        detailLabel={detailLabel}
        showMaximize={true}
        onClose={onClose}
      />
      {children}
    </div>
  );
}

function VideoEditorLoadingState() {
  return (
    <VideoEditorWindowShell detailLabel="Loading">
      <div className="editor-window__state flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
          <p className="text-sm text-(--ink-muted)">Loading video project...</p>
        </div>
      </div>
    </VideoEditorWindowShell>
  );
}

function VideoEditorErrorState({
  error,
  projectPath,
}: {
  error: string;
  projectPath: string | null;
}) {
  return (
    <VideoEditorWindowShell detailLabel="Error">
      <div className="editor-window__state flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-(--error-light) flex items-center justify-center">
            <span className="text-2xl">!</span>
          </div>
          <p className="text-sm text-(--error)">{error}</p>
          <p className="text-xs text-(--ink-muted)">Path: {projectPath}</p>
        </div>
      </div>
    </VideoEditorWindowShell>
  );
}

function VideoEditorWaitingState() {
  return (
    <VideoEditorWindowShell detailLabel="Waiting for project">
      <div className="editor-window__state flex-1 flex items-center justify-center">
        <p className="text-sm text-(--ink-muted)">Waiting for project...</p>
      </div>
    </VideoEditorWindowShell>
  );
}

function VideoEditorReadyState({
  projectName,
  onClose,
}: {
  projectName: string;
  onClose: () => void;
}) {
  return (
    <VideoEditorWindowShell detailLabel={projectName || 'Video Editor'} onClose={onClose}>
      <VideoEditorView onBack={onClose} hideTopBar={true} />
    </VideoEditorWindowShell>
  );
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

async function saveVideoProjectBeforeClose() {
  await waitForVideoEditorSavingToSettle();
  await useVideoEditorStore.getState().saveProject();
  await waitForVideoEditorSavingToSettle();
}

function canSaveVideoProjectBeforeClose() {
  const state = useVideoEditorStore.getState();
  return Boolean(state.project && !state.isExporting);
}

const VideoEditorWindow: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const isClosingRef = useRef(false);

  // Use targeted selectors to avoid re-rendering on every store change.
  // Previously this component subscribed to the entire store, causing cascading
  // re-renders of the entire editor tree on every store update.
  const projectName = useVideoEditorStore(selectProjectName);
  const setProject = useVideoEditorStore(selectSetProject);
  const clearEditor = useVideoEditorStore(selectClearEditor);
  const setExportProgress = useVideoEditorStore(selectSetExportProgress);

  // Apply theme
  useTheme();

  // Listen for export progress events from Rust backend
  useEffect(() => {
    const unlisten = listen<ExportProgress>('export-progress', (event) => {
      setExportProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setExportProgress]);

  // Load project when path is received
  const loadProject = useCallback(async (path: string) => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      if (isGifPath(path)) {
        await forwardGifToGifEditor(path);
        return;
      }

      const videoProject = await loadVideoProject(path);

      console.time('[EDITOR-INIT] setProject');
      setProject(videoProject);
      console.timeEnd('[EDITOR-INIT] setProject');

      logLoadedVideoProject(videoProject);
      setIsLoading(false);
    } catch (err) {
      videoEditorLogger.error('Failed to load video project:', err);
      setError(getProjectLoadErrorMessage(err));
      setIsLoading(false);
    }
  }, [setProject]);
  // Load project from URL params on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const encodedPath = urlParams.get('path');
    if (encodedPath && !hasLoadedRef.current) {
      // Decode the URL-encoded path
      const path = decodeURIComponent(encodedPath);
      setProjectPath(path);
      loadProject(path);
    }
  }, [loadProject]);

  const flushSaveBeforeClose = useCallback(async () => {
    if (!canSaveVideoProjectBeforeClose()) return;

    try {
      await saveVideoProjectBeforeClose();
    } catch (error) {
      videoEditorLogger.warn('Video editor window save-on-close failed:', error);
    }
  }, []);

  const performWindowClose = useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    await flushSaveBeforeClose();
    clearEditor();
    await getCurrentWebviewWindow().destroy();
  }, [flushSaveBeforeClose, clearEditor]);

  // Cleanup on window close
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    const unlisten = currentWindow.onCloseRequested(async (event: { preventDefault: () => void }) => {
      event.preventDefault();
      await performWindowClose();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [performWindowClose]);

  // Handle close - called when back button is pressed or window is closed
  const handleClose = useCallback(async () => {
    await performWindowClose();
  }, [performWindowClose]);

  // Loading state
  if (isLoading) {
    return <VideoEditorLoadingState />;
  }

  // Error state
  if (error) {
    return <VideoEditorErrorState error={error} projectPath={projectPath} />;
  }

  // No project loaded (projectName is null when no project is set)
  if (projectName === null) {
    return <VideoEditorWaitingState />;
  }

  // Main editor UI - reuse VideoEditorView with custom back handler
  return <VideoEditorReadyState projectName={projectName} onClose={handleClose} />;
};

export default VideoEditorWindow;
