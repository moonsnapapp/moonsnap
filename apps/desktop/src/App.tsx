import { useState, useCallback, useMemo, Activity } from 'react';
import { Toaster } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { Titlebar } from './components/Titlebar/Titlebar';
import { CaptureLibrary } from './components/Library/CaptureLibrary';
import { EmbeddedImageEditor } from './components/Editor/EmbeddedImageEditor';
import { EmbeddedVideoEditor } from './components/Editor/EmbeddedVideoEditor';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { LibraryErrorBoundary } from './components/ErrorBoundary';
import { KeyboardShortcutsModal } from './components/KeyboardShortcuts/KeyboardShortcutsModal';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { useCaptureStore } from './stores/captureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useCaptureSettingsStore } from './stores/captureSettingsStore';
import { useUpdater } from './hooks/useUpdater';
import { useTheme } from './hooks/useTheme';
import { useAppEventListeners } from './hooks/useAppEventListeners';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useQuickRecordingFlow } from './hooks/useQuickRecordingFlow';
import { logger } from './utils/logger';
import { useCaptureActions } from './hooks/useCaptureActions';
import { handleScreenshotCompletion } from './utils/screenshotCompletion';
import { LAYOUT, STORAGE } from './constants';
import type { CaptureListItem } from './types';

const clampSidebarSize = (size: number) =>
  Math.min(
    LAYOUT.IMAGE_EDITOR_SIDEBAR_MAX_SIZE,
    Math.max(LAYOUT.IMAGE_EDITOR_SIDEBAR_MIN_SIZE, size)
  );

const getInitialSidebarSize = () => {
  const stored = Number(localStorage.getItem(STORAGE.IMAGE_EDITOR_SIDEBAR_SIZE_KEY));
  if (Number.isFinite(stored) && stored > 0) {
    return clampSidebarSize(stored);
  }
  return LAYOUT.IMAGE_EDITOR_SIDEBAR_DEFAULT_SIZE;
};

function App() {
  const {
    view,
    loadProject,
    loadVideoProjectInWorkspace,
    clearCurrentProject,
    saveNewCaptureFromFile,
    loadCaptures,
  } = useCaptureStore();
  const isLibraryWorkspaceActive = view === 'library';
  const isImageEditorActive = view === 'editor';
  const isVideoEditorActive = view === 'videoEditor';
  const isWorkspaceActive =
    isLibraryWorkspaceActive || isImageEditorActive || isVideoEditorActive;

  // Initialize theme (applies theme class to document root)
  useTheme();

  // Auto-update checker (runs 5s after app starts)
  const updateChannel = useSettingsStore(s => s.settings.general.updateChannel);
  useUpdater(true, updateChannel);

  // Keyboard shortcuts help modal
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarSize, setSidebarSize] = useState(getInitialSidebarSize);

  // Capture actions for shortcuts
  const {
    openCaptureToolbar,
  } = useCaptureActions();

  // App initialization (settings, shortcuts, cleanup)
  useAppInitialization();

  const isGifRecordingPath = useCallback(
    (path: string) => path.toLowerCase().endsWith('.gif'),
    []
  );

  // Consolidated event listener callbacks
  const eventCallbacks = useMemo(
    () => ({
      onRecordingComplete: (data: { outputPath: string; durationSecs: number; fileSizeBytes: number }) => {
        loadCaptures();

        if (data.outputPath) {
          const action = useCaptureSettingsStore.getState().afterRecordingAction;
          const isGif = isGifRecordingPath(data.outputPath);

          if (action === 'editor' && !isGif) {
            // Open editor directly
            const hasExtension = /\.\w+$/.test(data.outputPath);
            const videoPath = hasExtension ? data.outputPath : `${data.outputPath}/screen.mp4`;
            invoke('show_video_editor_window', { projectPath: videoPath }).catch((error) => {
              logger.error('Failed to open video editor:', error);
              // Fallback to floating preview
              invoke('show_recording_preview', {
                outputPath: data.outputPath,
                durationSecs: data.durationSecs,
                fileSizeBytes: data.fileSizeBytes,
              }).catch(() => {});
            });
          } else {
            // Show floating recording preview
            invoke('show_recording_preview', {
              outputPath: data.outputPath,
              durationSecs: data.durationSecs,
              fileSizeBytes: data.fileSizeBytes,
            }).catch((error) => {
              logger.error('Failed to show recording preview:', error);
            });
          }
        }
      },
      onThumbnailReady: useCaptureStore.getState().updateCaptureThumbnail,
      onCaptureCompleteFast: async (data: { file_path: string; width: number; height: number }) => {
        const {
          copyToClipboardAfterCapture,
          showPreviewAfterCapture,
        } = useCaptureSettingsStore.getState();

        await handleScreenshotCompletion({
          data,
          copyToClipboardAfterCapture,
          showPreviewAfterCapture,
          invokeFn: invoke,
          log: logger,
        });

        // Save to library in background (don't block preview)
        saveNewCaptureFromFile(data.file_path, data.width, data.height, 'region', {}, { silent: true })
          .then(async ({ imagePath, id: projectId }) => {
            // Notify editor/preview windows of the saved project ID and permanent path
            const { emit } = await import('@tauri-apps/api/event');
            await emit('capture-saved', { originalPath: data.file_path, imagePath, projectId });
          })
          .catch((error) => {
            logger.error('Failed to save capture:', error);
          });
      },
      onCaptureDeleted: loadCaptures,
    }),
    [isGifRecordingPath, loadCaptures, saveNewCaptureFromFile]
  );

  // Consolidated Tauri event listeners
  useAppEventListeners(eventCallbacks);
  useQuickRecordingFlow();

  // Settings handler
  const handleOpenSettings = useCallback(() => {
    useSettingsStore.getState().openSettingsModal();
  }, []);

  // Show capture toolbar window (startup mode)
  const handleShowCaptureToolbar = useCallback(async () => {
    await openCaptureToolbar();
  }, [openCaptureToolbar]);

  const handleEditImageInWorkspace = useCallback(async (capture: CaptureListItem) => {
    await loadProject(capture.id);
  }, [loadProject]);

  const handleEditVideoInWorkspace = useCallback(async (capture: CaptureListItem) => {
    try {
      await loadVideoProjectInWorkspace(capture.image_path);
    } catch (error) {
      logger.warn('Failed to open video in workspace', error);
    }
  }, [loadVideoProjectInWorkspace]);

  const handleCloseImageEditor = useCallback(() => {
    clearCurrentProject();
  }, [clearCurrentProject]);

  const handleCloseVideoEditor = useCallback(() => {
    clearCurrentProject();
  }, [clearCurrentProject]);

  const handleImageWorkspaceLayout = useCallback((sizes: number[]) => {
    const nextSidebarSize = sizes[0];
    if (typeof nextSidebarSize !== 'number') {
      return;
    }

    const clampedSize = clampSidebarSize(nextSidebarSize);
    setSidebarSize(clampedSize);
    localStorage.setItem(STORAGE.IMAGE_EDITOR_SIDEBAR_SIZE_KEY, String(clampedSize));
  }, []);

  return (
    <div className="library-window h-screen w-screen overflow-hidden">
      {/* Toast Notifications */}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'var(--card)',
            border: '1px solid var(--polar-frost)',
            color: 'var(--ink-black)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          },
        }}
      />

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Settings Dialog */}
      <SettingsDialog />

      {/* Custom Titlebar */}
      <Titlebar
        title="MoonSnap"
        variant="hud"
        contextLabel={
          isImageEditorActive
            ? 'Image Editor'
            : isVideoEditorActive
              ? 'Video Editor'
              : 'Library'
        }
        onCapture={handleShowCaptureToolbar}
        onOpenSettings={handleOpenSettings}
      />

      {/* Main Content */}
      <div className="library-window__content flex-1 flex flex-col min-h-0">
        {/* Library sidebar + selected capture's editor in a unified workspace */}
        <Activity mode={isWorkspaceActive ? 'visible' : 'hidden'}>
          <ResizablePanelGroup
            direction="horizontal"
            className="image-editor-layout flex-1 min-h-0"
            onLayout={handleImageWorkspaceLayout}
          >
            <ResizablePanel
              id="image-library-sidebar"
              order={1}
              className="image-editor-layout__library"
              defaultSize={sidebarSize}
              minSize={LAYOUT.IMAGE_EDITOR_SIDEBAR_MIN_SIZE}
              maxSize={LAYOUT.IMAGE_EDITOR_SIDEBAR_MAX_SIZE}
            >
              <LibraryErrorBoundary>
                <CaptureLibrary
                  variant="sidebar"
                  enableKeyboardShortcuts={isLibraryWorkspaceActive}
                  onEditImage={handleEditImageInWorkspace}
                  onEditVideo={handleEditVideoInWorkspace}
                />
              </LibraryErrorBoundary>
            </ResizablePanel>
            <ResizableHandle className="image-editor-layout__resize-handle" />
            <ResizablePanel
              id="image-editor-main"
              order={2}
              className="image-editor-layout__editor"
              minSize={50}
            >
              {isImageEditorActive ? (
                <EmbeddedImageEditor onClose={handleCloseImageEditor} />
              ) : isVideoEditorActive ? (
                <EmbeddedVideoEditor onClose={handleCloseVideoEditor} />
              ) : (
                <div className="image-editor-empty editor-window__state flex-1 flex items-center justify-center">
                  <div className="image-editor-empty__panel">
                    <p className="image-editor-empty__label">No capture selected</p>
                    <p className="image-editor-empty__detail">Choose a capture from the library.</p>
                  </div>
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </Activity>
      </div>
    </div>
  );
}

export default App;
