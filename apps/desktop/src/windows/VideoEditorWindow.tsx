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
import { Titlebar } from '@/components/Titlebar/Titlebar';
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
      console.time('[EDITOR-INIT] load_video_project');
      videoEditorLogger.info('Loading video project:', path);
      const videoProject = await invoke<VideoProject>('load_video_project', {
        videoPath: path,
      });
      console.timeEnd('[EDITOR-INIT] load_video_project');

      console.time('[EDITOR-INIT] setProject');
      setProject(videoProject);
      console.timeEnd('[EDITOR-INIT] setProject');

      videoEditorLogger.info('[EDITOR-INIT] Project sources:', JSON.stringify(videoProject.sources, null, 2));
      videoEditorLogger.info(`[EDITOR-INIT] Dimensions: ${videoProject.sources.originalWidth}x${videoProject.sources.originalHeight}, duration: ${videoProject.timeline.durationMs}ms, fps: ${videoProject.sources.fps}`);
      videoEditorLogger.info(`[EDITOR-INIT] Timeline segments: ${videoProject.timeline.segments?.length ?? 0}`);

      setIsLoading(false);
    } catch (err) {
      videoEditorLogger.error('Failed to load video project:', err);
      setError(err instanceof Error ? err.message : 'Failed to load video project');
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
      await waitForSavingToSettle();
      await useVideoEditorStore.getState().saveProject();
      await waitForSavingToSettle();
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
    return (
      <div className="h-screen w-screen flex flex-col bg-card overflow-hidden">
        <Titlebar title="Loading..." showLogo={true} showMaximize={true} />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-(--coral-400)" />
            <p className="text-sm text-(--ink-muted)">Loading video project...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-screen w-screen flex flex-col bg-card overflow-hidden">
        <Titlebar title="Error" showLogo={true} showMaximize={true} />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <div className="w-12 h-12 rounded-full bg-(--error-light) flex items-center justify-center">
              <span className="text-2xl">!</span>
            </div>
            <p className="text-sm text-(--error)">{error}</p>
            <p className="text-xs text-(--ink-muted)">Path: {projectPath}</p>
          </div>
        </div>
      </div>
    );
  }

  // No project loaded (projectName is null when no project is set)
  if (projectName === null) {
    return (
      <div className="h-screen w-screen flex flex-col bg-card overflow-hidden">
        <Titlebar title="Video Editor" showLogo={true} showMaximize={true} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-(--ink-muted)">Waiting for project...</p>
        </div>
      </div>
    );
  }

  // Main editor UI - reuse VideoEditorView with custom back handler
  return (
    <div className="h-screen w-screen flex flex-col bg-card overflow-hidden">
      <Titlebar
        title={projectName || 'Video Editor'}
        showLogo={true}
        showMaximize={true}
        onClose={handleClose}
      />
      <VideoEditorView onBack={handleClose} hideTopBar={true} />
    </div>
  );
};

export default VideoEditorWindow;
