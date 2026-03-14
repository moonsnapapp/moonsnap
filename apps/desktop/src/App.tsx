import { useState, useCallback, useMemo, Activity } from 'react';
import { Toaster } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { Titlebar } from './components/Titlebar/Titlebar';
import { CaptureLibrary } from './components/Library/CaptureLibrary';
import { LibraryErrorBoundary } from './components/ErrorBoundary';
import { KeyboardShortcutsModal } from './components/KeyboardShortcuts/KeyboardShortcutsModal';
import { VideoEditorView } from './views/VideoEditorView';
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

function App() {
  const {
    view,
    saveNewCaptureFromFile,
    loadCaptures,
  } = useCaptureStore();
  const isVideoEditorActive = view === 'videoEditor';

  // Initialize theme (applies theme class to document root)
  useTheme();

  // Auto-update checker (runs 5s after app starts)
  const updateChannel = useSettingsStore(s => s.settings.general.updateChannel);
  useUpdater(true, updateChannel);

  // Keyboard shortcuts help modal
  const [showShortcuts, setShowShortcuts] = useState(false);

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
        const showPreview = useCaptureSettingsStore.getState().showPreviewAfterCapture;

        if (showPreview) {
          // Show mini preview with quick actions
          invoke('show_screenshot_preview', {
            filePath: data.file_path,
            width: data.width,
            height: data.height,
          }).catch((error) => {
            // Fallback: open editor directly if preview fails
            logger.error('Failed to show preview, opening editor:', error);
            invoke('show_image_editor_window', { capturePath: data.file_path }).catch(() => {});
          });
        } else {
          // Open editor directly (old behavior)
          invoke('show_image_editor_window', { capturePath: data.file_path }).catch((error) => {
            logger.error('Failed to open image editor:', error);
          });
        }

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

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--polar-snow)] overflow-hidden">
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

      {/* Custom Titlebar */}
      <Titlebar
        title="MoonSnap Library"
        onCapture={handleShowCaptureToolbar}
        onOpenSettings={handleOpenSettings}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Library */}
        <Activity mode={view === 'library' ? 'visible' : 'hidden'}>
          <LibraryErrorBoundary>
            <CaptureLibrary />
          </LibraryErrorBoundary>
        </Activity>

        {/* Video Editor (legacy embedded view - kept for video playback) */}
        <Activity mode={isVideoEditorActive ? 'visible' : 'hidden'}>
          <VideoEditorView isActive={isVideoEditorActive} />
        </Activity>
      </div>
    </div>
  );
}

export default App;
