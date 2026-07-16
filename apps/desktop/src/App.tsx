import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  startTransition,
  Activity,
  type MutableRefObject,
} from 'react';
import { Toaster } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { FolderOpen, Images, SquarePen } from 'lucide-react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { HudTitlebar } from './components/Titlebar/Titlebar';
import { CaptureLibrary } from './components/Library/CaptureLibrary';
import { SidebarToggleHandle } from './components/Library/SidebarToggleHandle';
import { EmbeddedImageEditor } from './components/Editor/EmbeddedImageEditor';
import { EmbeddedVideoEditor } from './components/Editor/EmbeddedVideoEditor';
import { EmbeddedGifEditor } from './components/Editor/EmbeddedGifEditor';
import { ExperimentalCaptureToolbarDialog } from './components/CaptureToolbar/ExperimentalCaptureToolbarDialog';
import { ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { LibraryErrorBoundary } from './components/ErrorBoundary';
import { KeyboardShortcutsModal } from './components/KeyboardShortcuts/KeyboardShortcutsModal';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { useCaptureStore } from './stores/captureStore';
import { useVideoEditorStore } from './stores/videoEditorStore';
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
import { isTextInputTarget } from './utils/keyboard';
import { flushWorkspaceEditorSave } from './utils/workspaceEditorPersistence';
import { LAYOUT, STORAGE } from './constants';
import type { CaptureListItem } from './types';

type WorkspaceTab = 'library' | 'editor';
type ReactViewTransitionProps = {
  children: React.ReactNode;
  default?: string;
  enter?: string;
  exit?: string;
  update?: string;
};
type ReactWithViewTransition = typeof React & {
  ViewTransition?: React.ComponentType<ReactViewTransitionProps>;
};

const ReactViewTransition = (React as ReactWithViewTransition).ViewTransition;

const clampSidebarSize = (size: number) =>
  Math.min(
    LAYOUT.IMAGE_EDITOR_SIDEBAR_MAX_SIZE,
    Math.max(LAYOUT.IMAGE_EDITOR_SIDEBAR_MIN_SIZE, size)
  );

const getStoredSidebarWidthPx = () => {
  const stored = Number(localStorage.getItem(STORAGE.IMAGE_EDITOR_SIDEBAR_WIDTH_PX_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
};

const getInitialSidebarSize = () => {
  const stored = Number(localStorage.getItem(STORAGE.IMAGE_EDITOR_SIDEBAR_SIZE_KEY));
  if (Number.isFinite(stored) && stored > 0) {
    return clampSidebarSize(stored);
  }
  return LAYOUT.IMAGE_EDITOR_SIDEBAR_DEFAULT_SIZE;
};

function getObservedWorkspaceWidth(entry: ResizeObserverEntry | undefined, fallbackElement: HTMLElement) {
  const width = entry?.contentRect.width ?? fallbackElement.clientWidth;
  return Number.isFinite(width) && width > 0 ? width : null;
}

function getSidebarSizeFromStoredWidth(sidebarWidthPx: number | null, workspaceWidthPx: number) {
  if (sidebarWidthPx === null) {
    return null;
  }

  return clampSidebarSize((sidebarWidthPx / workspaceWidthPx) * 100);
}

function shouldResizeSidebarPanel(panel: ImperativePanelHandle, nextSidebarSize: number) {
  return !panel.isCollapsed() && Math.abs(nextSidebarSize - panel.getSize()) >= 0.1;
}

function getValidSidebarPanelResize(
  panel: ImperativePanelHandle | null,
  nextSidebarSize: number | null,
) {
  if (!panel || nextSidebarSize === null) {
    return null;
  }

  return shouldResizeSidebarPanel(panel, nextSidebarSize) ? panel : null;
}

function getSidebarSizeCandidate(sizes: number[]) {
  const nextSidebarSize = sizes[0];
  if (typeof nextSidebarSize !== 'number') {
    return null;
  }

  return nextSidebarSize >= LAYOUT.IMAGE_EDITOR_SIDEBAR_MIN_SIZE ? nextSidebarSize : null;
}

function persistSidebarWidthPx(
  sidebarWidthPxRef: MutableRefObject<number | null>,
  workspaceWidth: number,
  clampedSize: number,
) {
  const nextSidebarWidthPx = Math.round((workspaceWidth * clampedSize) / 100);
  sidebarWidthPxRef.current = nextSidebarWidthPx;
  localStorage.setItem(STORAGE.IMAGE_EDITOR_SIDEBAR_WIDTH_PX_KEY, String(nextSidebarWidthPx));
}

function shouldPersistSidebarWidth(workspaceWidth: number, applyingSidebarResize: boolean) {
  return workspaceWidth > 0 && !applyingSidebarResize;
}

function persistSidebarSize(clampedSize: number) {
  localStorage.setItem(STORAGE.IMAGE_EDITOR_SIDEBAR_SIZE_KEY, String(clampedSize));
}

function applySidebarPanelResize(
  panel: ImperativePanelHandle,
  nextSidebarSize: number,
  applyingSidebarResizeRef: MutableRefObject<boolean>,
) {
  applyingSidebarResizeRef.current = true;
  panel.resize(nextSidebarSize);
  requestAnimationFrame(() => {
    applyingSidebarResizeRef.current = false;
  });
}

function syncSidebarPanelToWorkspaceWidth({
  entry,
  layoutElement,
  workspaceWidthPxRef,
  sidebarWidthPxRef,
  sidebarPanelRef,
  applyingSidebarResizeRef,
}: {
  entry: ResizeObserverEntry | undefined;
  layoutElement: HTMLElement;
  workspaceWidthPxRef: MutableRefObject<number>;
  sidebarWidthPxRef: MutableRefObject<number | null>;
  sidebarPanelRef: MutableRefObject<ImperativePanelHandle | null>;
  applyingSidebarResizeRef: MutableRefObject<boolean>;
}) {
  const nextWorkspaceWidth = getObservedWorkspaceWidth(entry, layoutElement);
  if (nextWorkspaceWidth === null) return;

  workspaceWidthPxRef.current = nextWorkspaceWidth;

  const nextSidebarSize = getSidebarSizeFromStoredWidth(sidebarWidthPxRef.current, nextWorkspaceWidth);
  const panel = getValidSidebarPanelResize(sidebarPanelRef.current, nextSidebarSize);
  if (!panel || nextSidebarSize === null) return;

  applySidebarPanelResize(panel, nextSidebarSize, applyingSidebarResizeRef);
}

function isWorkspaceOpenableCapture(capture: CaptureListItem): boolean {
  return !capture.is_missing && !capture.damaged && capture.capture_type !== 'gif';
}

function stopLibraryWindowMediaPlayback() {
  useVideoEditorStore.getState().setIsPlaying(false);
  for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    media.pause();
  }
}

function getWorkspaceContextLabel(view: string, activeWorkspaceTab: WorkspaceTab) {
  if (activeWorkspaceTab === 'library') {
    return 'Library';
  }

  switch (view) {
    case 'editor':
      return 'Image Editor';
    case 'videoEditor':
      return 'Video Editor';
    case 'gifEditor':
      return 'GIF Editor';
    default:
      return 'Library';
  }
}

function getVideoEditorPath(outputPath: string) {
  return /\.\w+$/.test(outputPath) ? outputPath : `${outputPath}/screen.mp4`;
}

function isWorkspaceView(view: string) {
  return view === 'library' || view === 'editor' || view === 'videoEditor' || view === 'gifEditor';
}

function getInitialWorkspaceTab(view: string): WorkspaceTab {
  return view === 'library' ? 'library' : 'editor';
}

function getWorkspaceTabClassName(tab: WorkspaceTab, activeWorkspaceTab: WorkspaceTab) {
  return `workspace-tabs__trigger ${
    tab === activeWorkspaceTab ? 'workspace-tabs__trigger--active' : ''
  }`;
}

function setWorkspaceTabWithTransition(
  setActiveWorkspaceTab: React.Dispatch<React.SetStateAction<WorkspaceTab>>,
  tab: WorkspaceTab,
) {
  startTransition(() => {
    setActiveWorkspaceTab(tab);
  });
}

function activateEditorWorkspaceWithTransition({
  setActiveWorkspaceTab,
  setEditorSidebarResetKey,
}: {
  setActiveWorkspaceTab: React.Dispatch<React.SetStateAction<WorkspaceTab>>;
  setEditorSidebarResetKey: React.Dispatch<React.SetStateAction<number>>;
}) {
  startTransition(() => {
    setActiveWorkspaceTab('editor');
    setEditorSidebarResetKey((key) => key + 1);
  });
}

function WorkspaceViewTransition({ children }: { children: React.ReactNode }) {
  if (!ReactViewTransition) {
    return <>{children}</>;
  }

  return (
    <ReactViewTransition
      default="none"
      enter="fade-in"
      exit="fade-out"
      update="fade-in"
    >
      {children}
    </ReactViewTransition>
  );
}

function getLastOpenedWorkspaceCapture(
  captures: CaptureListItem[],
  lastOpenedCaptureId: string | null
) {
  if (!lastOpenedCaptureId) {
    return null;
  }

  const capture = captures.find((item) => item.id === lastOpenedCaptureId);
  return capture && isWorkspaceOpenableCapture(capture) ? capture : null;
}

function rememberLastOpenedCapture(
  captureId: string,
  setLastOpenedCaptureId: (captureId: string) => void
) {
  setLastOpenedCaptureId(captureId);
  localStorage.setItem(STORAGE.LAST_OPENED_CAPTURE_ID_KEY, captureId);
}

async function showRecordingPreview(data: {
  outputPath: string;
  durationSecs: number;
  fileSizeBytes: number;
}) {
  await invoke('show_recording_preview', {
    outputPath: data.outputPath,
    durationSecs: data.durationSecs,
    fileSizeBytes: data.fileSizeBytes,
  });
}

function shouldShowRecordingPreview(action: string) {
  return action !== 'editor';
}

function getRecordingEditorLabel(isGif: boolean) {
  return isGif ? 'GIF' : 'video';
}

async function openRecordingEditor(data: {
  outputPath: string;
  durationSecs: number;
  fileSizeBytes: number;
}) {
  const isGif = data.outputPath.toLowerCase().endsWith('.gif');
  const command = isGif ? 'show_gif_editor_window' : 'show_video_editor_window';
  const args = isGif
    ? { capturePath: data.outputPath }
    : { projectPath: getVideoEditorPath(data.outputPath) };

  try {
    await invoke(command, args);
  } catch (error) {
    logger.error(`Failed to open ${getRecordingEditorLabel(isGif)} editor:`, error);
    await showRecordingPreview(data).catch(() => {});
  }
}

async function openRecordingEditorOrPreview(data: {
  outputPath: string;
  durationSecs: number;
  fileSizeBytes: number;
}) {
  const action = useCaptureSettingsStore.getState().afterRecordingAction;

  if (shouldShowRecordingPreview(action)) {
    await showRecordingPreview(data);
    return;
  }

  await openRecordingEditor(data);
}

function useLibraryWindowHideOnClose() {
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label !== 'library') {
      return undefined;
    }

    let unlisten: (() => void) | null = null;
    void currentWindow.onCloseRequested((event) => {
      event.preventDefault();
      stopLibraryWindowMediaPlayback();
      void currentWindow.hide();
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}

function usePreviewOpenLibraryEditorListeners(
  savedCaptureProjectIdsRef: MutableRefObject<Map<string, string>>,
  pendingPreviewOpenPathRef: MutableRefObject<string | null>
) {
  const loadProject = useCaptureStore((state) => state.loadProject);
  const loadVideoProjectInWorkspace = useCaptureStore((state) => state.loadVideoProjectInWorkspace);

  useEffect(() => {
    const unlistenScreenshot = listen<{
      originalPath: string;
      projectId?: string | null;
    }>('preview-open-library-image-editor', async (event) => {
      const { originalPath, projectId } = event.payload;
      const savedProjectId =
        projectId ?? savedCaptureProjectIdsRef.current.get(originalPath) ?? null;

      if (!savedProjectId) {
        pendingPreviewOpenPathRef.current = originalPath;
        await invoke('show_library_window');
        return;
      }

      pendingPreviewOpenPathRef.current = null;
      await flushWorkspaceEditorSave();
      await invoke('show_library_window');
      await loadProject(savedProjectId);
    });

    const unlistenRecording = listen<{ videoPath: string }>(
      'preview-open-library-video-editor',
      async (event) => {
        await flushWorkspaceEditorSave();
        await invoke('show_library_window');
        await loadVideoProjectInWorkspace(event.payload.videoPath);
      }
    );

    return () => {
      unlistenScreenshot.then((fn) => fn()).catch(() => {});
      unlistenRecording.then((fn) => fn()).catch(() => {});
    };
  }, [loadProject, loadVideoProjectInWorkspace, pendingPreviewOpenPathRef, savedCaptureProjectIdsRef]);
}

function WorkspaceEditorPanel({
  view,
  isActive,
  sidebarResetKey,
  lastOpenedCapture,
  onCloseImageEditor,
  onCloseVideoEditor,
  onCloseGifEditor,
  onOpenLastMedia,
}: {
  view: string;
  isActive: boolean;
  sidebarResetKey: number;
  lastOpenedCapture: CaptureListItem | null;
  onCloseImageEditor: () => void;
  onCloseVideoEditor: () => void;
  onCloseGifEditor: () => void;
  onOpenLastMedia: () => void;
}) {
  const editorPanels = {
    editor: <EmbeddedImageEditor onClose={onCloseImageEditor} />,
    videoEditor: (
      <EmbeddedVideoEditor
        onClose={onCloseVideoEditor}
        isActive={isActive}
        sidebarResetKey={sidebarResetKey}
      />
    ),
    gifEditor: <EmbeddedGifEditor onClose={onCloseGifEditor} />,
  };
  const editorPanel = editorPanels[view as keyof typeof editorPanels];

  if (editorPanel) return editorPanel;

  return (
    <div className="image-editor-empty editor-window__state flex-1 flex items-center justify-center">
      <div className="image-editor-empty__panel">
        <p className="image-editor-empty__label">No capture selected</p>
        <p className="image-editor-empty__detail">Choose a capture from the library.</p>
        {lastOpenedCapture && (
          <button
            type="button"
            onClick={onOpenLastMedia}
            className="editor-choice-pill editor-choice-pill--active image-editor-empty__action mt-2 px-3 py-2 text-xs font-medium inline-flex items-center gap-2"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open Last Media
          </button>
        )}
      </div>
    </div>
  );
}

function getWorkspaceSidebarClassName(isSidebarCollapsed: boolean) {
  return `image-editor-layout__library ${
    isSidebarCollapsed ? 'image-editor-layout__library--collapsed' : ''
  }`;
}

function WorkspaceLibraryCollapsedRail() {
  return <div className="image-editor-layout__library-rail" aria-hidden="true" />;
}

function WorkspaceTabs({
  activeWorkspaceTab,
  onSelectLibrary,
  onSelectEditor,
}: {
  activeWorkspaceTab: WorkspaceTab;
  onSelectLibrary: () => void;
  onSelectEditor: () => void;
}) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
      <button
        type="button"
        role="tab"
        aria-selected={activeWorkspaceTab === 'library'}
        className={getWorkspaceTabClassName('library', activeWorkspaceTab)}
        onClick={onSelectLibrary}
      >
        <Images className="workspace-tabs__icon" />
        <span>Library</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeWorkspaceTab === 'editor'}
        className={getWorkspaceTabClassName('editor', activeWorkspaceTab)}
        onClick={onSelectEditor}
      >
        <SquarePen className="workspace-tabs__icon" />
        <span>Editor</span>
      </button>
    </div>
  );
}

const EMPTY_FOCUSED_CAPTURE_PROPS = {
  focusedCaptureId: null,
  focusRequestKey: 0,
};

function getFocusedCaptureProps(
  focusedLibraryCapture: { id: string; requestKey: number } | null
) {
  if (focusedLibraryCapture === null) {
    return EMPTY_FOCUSED_CAPTURE_PROPS;
  }

  return {
    focusedCaptureId: focusedLibraryCapture.id,
    focusRequestKey: focusedLibraryCapture.requestKey,
  };
}

function WorkspaceLibrarySidebarContent({
  isSidebarCollapsed,
  isLibraryWorkspaceActive,
  focusedLibraryCapture,
  onFocusCaptureHandled,
  onEditImage,
  onEditVideo,
  onEditGif,
}: {
  isSidebarCollapsed: boolean;
  isLibraryWorkspaceActive: boolean;
  focusedLibraryCapture: { id: string; requestKey: number } | null;
  onFocusCaptureHandled: () => void;
  onEditImage: (capture: CaptureListItem) => void | Promise<void>;
  onEditVideo: (capture: CaptureListItem) => void | Promise<void>;
  onEditGif: (capture: CaptureListItem) => void | Promise<void>;
}) {
  if (isSidebarCollapsed) {
    return <WorkspaceLibraryCollapsedRail />;
  }

  const focusProps = getFocusedCaptureProps(focusedLibraryCapture);

  return (
    <LibraryErrorBoundary>
      <CaptureLibrary
        variant="sidebar"
        enableKeyboardShortcuts={isLibraryWorkspaceActive}
        focusedCaptureId={focusProps.focusedCaptureId}
        focusRequestKey={focusProps.focusRequestKey}
        onFocusCaptureHandled={onFocusCaptureHandled}
        onEditImage={onEditImage}
        onEditVideo={onEditVideo}
        onEditGif={onEditGif}
      />
    </LibraryErrorBoundary>
  );
}

function WorkspaceLibraryView({
  isActive,
  onEditImage,
  onEditVideo,
  onEditGif,
}: {
  isActive: boolean;
  onEditImage: (capture: CaptureListItem) => void | Promise<void>;
  onEditVideo: (capture: CaptureListItem) => void | Promise<void>;
  onEditGif: (capture: CaptureListItem) => void | Promise<void>;
}) {
  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <WorkspaceViewTransition>
        <div className="workspace-pane workspace-pane--library flex-1 min-h-0">
          <LibraryErrorBoundary>
            <CaptureLibrary
              variant="full"
              enableKeyboardShortcuts={isActive}
              onEditImage={onEditImage}
              onEditVideo={onEditVideo}
              onEditGif={onEditGif}
            />
          </LibraryErrorBoundary>
        </div>
      </WorkspaceViewTransition>
    </Activity>
  );
}

function WorkspaceLayout({
  isEditorWorkspaceActive,
  workspaceLayoutRef,
  handleImageWorkspaceLayout,
  editorSidebarResetKey,
  sidebarPanelRef,
  isSidebarCollapsed,
  sidebarSize,
  isLibraryWorkspaceActive,
  focusedLibraryCapture,
  handleFocusedLibraryCaptureHandled,
  handleEditImageInWorkspace,
  handleEditVideoInWorkspace,
  handleEditGifInWorkspace,
  handleSidebarCollapse,
  handleSidebarExpand,
  handleToggleSidebar,
  view,
  lastOpenedCapture,
  handleCloseImageEditor,
  handleCloseVideoEditor,
  handleCloseGifEditor,
  handleOpenLastMedia,
}: {
  isEditorWorkspaceActive: boolean;
  workspaceLayoutRef: React.RefObject<HTMLDivElement | null>;
  handleImageWorkspaceLayout: (sizes: number[]) => void;
  editorSidebarResetKey: number;
  sidebarPanelRef: React.RefObject<ImperativePanelHandle | null>;
  isSidebarCollapsed: boolean;
  sidebarSize: number;
  isLibraryWorkspaceActive: boolean;
  focusedLibraryCapture: { id: string; requestKey: number } | null;
  handleFocusedLibraryCaptureHandled: () => void;
  handleEditImageInWorkspace: (capture: CaptureListItem) => void | Promise<void>;
  handleEditVideoInWorkspace: (capture: CaptureListItem) => void | Promise<void>;
  handleEditGifInWorkspace: (capture: CaptureListItem) => void | Promise<void>;
  handleSidebarCollapse: () => void;
  handleSidebarExpand: () => void;
  handleToggleSidebar: () => void;
  view: string;
  lastOpenedCapture: CaptureListItem | null;
  handleCloseImageEditor: () => void;
  handleCloseVideoEditor: () => void;
  handleCloseGifEditor: () => void;
  handleOpenLastMedia: () => void;
}) {
  return (
    <Activity mode={isEditorWorkspaceActive ? 'visible' : 'hidden'}>
      <WorkspaceViewTransition>
        <div ref={workspaceLayoutRef} className="workspace-pane workspace-pane--editor flex-1 min-h-0">
          <ResizablePanelGroup
            direction="horizontal"
            className="image-editor-layout flex-1 min-h-0"
            onLayout={handleImageWorkspaceLayout}
          >
            <ResizablePanel
              id="image-library-sidebar"
              order={1}
              ref={sidebarPanelRef}
              collapsible
              collapsedSize={LAYOUT.IMAGE_EDITOR_SIDEBAR_COLLAPSED_SIZE}
              onCollapse={handleSidebarCollapse}
              onExpand={handleSidebarExpand}
              className={getWorkspaceSidebarClassName(isSidebarCollapsed)}
              defaultSize={sidebarSize}
              minSize={LAYOUT.IMAGE_EDITOR_SIDEBAR_MIN_SIZE}
              maxSize={LAYOUT.IMAGE_EDITOR_SIDEBAR_MAX_SIZE}
            >
              <WorkspaceLibrarySidebarContent
                isSidebarCollapsed={isSidebarCollapsed}
                isLibraryWorkspaceActive={isLibraryWorkspaceActive}
                focusedLibraryCapture={focusedLibraryCapture}
                onFocusCaptureHandled={handleFocusedLibraryCaptureHandled}
                onEditImage={handleEditImageInWorkspace}
                onEditVideo={handleEditVideoInWorkspace}
                onEditGif={handleEditGifInWorkspace}
              />
            </ResizablePanel>
            <SidebarToggleHandle
              className="image-editor-layout__resize-handle"
              collapsed={isSidebarCollapsed}
              onToggle={handleToggleSidebar}
            />
            <ResizablePanel
              id="image-editor-main"
              order={2}
              className="image-editor-layout__editor"
              minSize={50}
            >
              <WorkspaceEditorPanel
                view={view}
                isActive={isEditorWorkspaceActive}
                sidebarResetKey={editorSidebarResetKey}
                lastOpenedCapture={lastOpenedCapture}
                onCloseImageEditor={handleCloseImageEditor}
                onCloseVideoEditor={handleCloseVideoEditor}
                onCloseGifEditor={handleCloseGifEditor}
                onOpenLastMedia={handleOpenLastMedia}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </WorkspaceViewTransition>
    </Activity>
  );
}

function useWorkspaceSidebar() {
  const [sidebarSize, setSidebarSize] = useState(getInitialSidebarSize);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const workspaceLayoutRef = useRef<HTMLDivElement>(null);
  const allowSidebarCollapseRef = useRef(false);
  const sidebarWidthPxRef = useRef<number | null>(getStoredSidebarWidthPx());
  const workspaceWidthPxRef = useRef(0);
  const applyingSidebarResizeRef = useRef(false);

  const handleToggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      return;
    }
    allowSidebarCollapseRef.current = true;
    panel.collapse();
  }, []);

  const handleImageWorkspaceLayout = useCallback((sizes: number[]) => {
    const nextSidebarSize = getSidebarSizeCandidate(sizes);
    if (nextSidebarSize === null) return;

    const clampedSize = clampSidebarSize(nextSidebarSize);
    const workspaceWidth = workspaceWidthPxRef.current;
    if (shouldPersistSidebarWidth(workspaceWidth, applyingSidebarResizeRef.current)) {
      persistSidebarWidthPx(sidebarWidthPxRef, workspaceWidth, clampedSize);
    }
    setSidebarSize(clampedSize);
    persistSidebarSize(clampedSize);
  }, []);

  useEffect(() => {
    const layoutElement = workspaceLayoutRef.current;
    if (!layoutElement) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      syncSidebarPanelToWorkspaceWidth({
        entry,
        layoutElement,
        workspaceWidthPxRef,
        sidebarWidthPxRef,
        sidebarPanelRef,
        applyingSidebarResizeRef,
      });
    });

    resizeObserver.observe(layoutElement);
    return () => resizeObserver.disconnect();
  }, []);

  const handleSidebarCollapse = useCallback(() => {
    if (allowSidebarCollapseRef.current) {
      allowSidebarCollapseRef.current = false;
      setIsSidebarCollapsed(true);
      return;
    }

    const restoreSize = sidebarSize;
    requestAnimationFrame(() => {
      sidebarPanelRef.current?.resize(restoreSize);
      setIsSidebarCollapsed(false);
    });
  }, [sidebarSize]);

  const handleSidebarExpand = useCallback(() => {
    allowSidebarCollapseRef.current = false;
    setIsSidebarCollapsed(false);
  }, []);

  return {
    sidebarSize,
    isSidebarCollapsed,
    sidebarPanelRef,
    workspaceLayoutRef,
    handleToggleSidebar,
    handleImageWorkspaceLayout,
    handleSidebarCollapse,
    handleSidebarExpand,
  };
}

type CaptureStoreState = ReturnType<typeof useCaptureStore.getState>;

function useAppKeyboardPlaceholders() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTextInputTarget(event.target)) return;

      // Experimental capture toolbar shortcut temporarily disabled.
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

function useWorkspaceTabShortcuts({
  isWorkspaceActive,
  onSelectLibrary,
  onSelectEditor,
}: {
  isWorkspaceActive: boolean;
  onSelectLibrary: () => void;
  onSelectEditor: () => void;
}) {
  useEffect(() => {
    if (!isWorkspaceActive) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTextInputTarget(event.target)) return;
      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.code === 'Digit1') {
        event.preventDefault();
        onSelectLibrary();
      } else if (event.code === 'Digit2') {
        event.preventDefault();
        onSelectEditor();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWorkspaceActive, onSelectLibrary, onSelectEditor]);
}

function useMainAppEventCallbacks({
  loadCaptures,
  loadProject,
  saveNewCaptureFromFile,
  savedCaptureProjectIdsRef,
  pendingPreviewOpenPathRef,
}: {
  loadCaptures: CaptureStoreState['loadCaptures'];
  loadProject: CaptureStoreState['loadProject'];
  saveNewCaptureFromFile: CaptureStoreState['saveNewCaptureFromFile'];
  savedCaptureProjectIdsRef: MutableRefObject<Map<string, string>>;
  pendingPreviewOpenPathRef: MutableRefObject<string | null>;
}) {
  return useMemo(
    () => ({
      onRecordingComplete: (data: { outputPath: string; durationSecs: number; fileSizeBytes: number }) => {
        loadCaptures();

        if (data.outputPath) {
          openRecordingEditorOrPreview(data).catch((error) => {
            logger.error('Failed to handle recording completion:', error);
          });
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

        saveNewCaptureFromFile(data.file_path, data.width, data.height, 'region', {}, { silent: true })
          .then(async ({ imagePath, id: projectId }) => {
            savedCaptureProjectIdsRef.current.set(data.file_path, projectId);
            const { emit } = await import('@tauri-apps/api/event');
            await emit('capture-saved', { originalPath: data.file_path, imagePath, projectId });

            if (pendingPreviewOpenPathRef.current === data.file_path) {
              pendingPreviewOpenPathRef.current = null;
              await invoke('show_library_window');
              await loadProject(projectId);
            }
          })
          .catch((error) => {
            logger.error('Failed to save capture:', error);
          });
      },
      onCaptureDeleted: loadCaptures,
    }),
    [loadCaptures, loadProject, pendingPreviewOpenPathRef, saveNewCaptureFromFile, savedCaptureProjectIdsRef]
  );
}

function useWorkspaceCaptureHandlers({
  loadProject,
  loadVideoProjectInWorkspace,
  loadGifInWorkspace,
  lastOpenedCapture,
  setLastOpenedCaptureId,
  setFocusedLibraryCapture,
}: {
  loadProject: CaptureStoreState['loadProject'];
  loadVideoProjectInWorkspace: CaptureStoreState['loadVideoProjectInWorkspace'];
  loadGifInWorkspace: CaptureStoreState['loadGifInWorkspace'];
  lastOpenedCapture: CaptureListItem | null;
  setLastOpenedCaptureId: (captureId: string) => void;
  setFocusedLibraryCapture: React.Dispatch<React.SetStateAction<{
    id: string;
    requestKey: number;
  } | null>>;
}) {
  const handleEditImageInWorkspace = useCallback(async (capture: CaptureListItem) => {
    await flushWorkspaceEditorSave();
    rememberLastOpenedCapture(capture.id, setLastOpenedCaptureId);
    await loadProject(capture.id);
  }, [loadProject, setLastOpenedCaptureId]);

  const handleEditVideoInWorkspace = useCallback(async (capture: CaptureListItem) => {
    await flushWorkspaceEditorSave();
    rememberLastOpenedCapture(capture.id, setLastOpenedCaptureId);
    try {
      await loadVideoProjectInWorkspace(capture.image_path);
    } catch (error) {
      logger.warn('Failed to open video in workspace', error);
    }
  }, [loadVideoProjectInWorkspace, setLastOpenedCaptureId]);

  const handleEditGifInWorkspace = useCallback(async (capture: CaptureListItem) => {
    await flushWorkspaceEditorSave();
    rememberLastOpenedCapture(capture.id, setLastOpenedCaptureId);
    loadGifInWorkspace(capture.image_path);
  }, [loadGifInWorkspace, setLastOpenedCaptureId]);

  const handleOpenLastMedia = useCallback(async () => {
    if (!lastOpenedCapture) return;

    setFocusedLibraryCapture((previous) => ({
      id: lastOpenedCapture.id,
      requestKey: (previous?.requestKey ?? 0) + 1,
    }));

    if (lastOpenedCapture.capture_type === 'video') {
      await handleEditVideoInWorkspace(lastOpenedCapture);
      return;
    }

    await handleEditImageInWorkspace(lastOpenedCapture);
  }, [handleEditImageInWorkspace, handleEditVideoInWorkspace, lastOpenedCapture, setFocusedLibraryCapture]);

  return {
    handleEditImageInWorkspace,
    handleEditVideoInWorkspace,
    handleEditGifInWorkspace,
    handleOpenLastMedia,
  };
}

function App() {
  const view = useCaptureStore((state) => state.view);
  const captures = useCaptureStore((state) => state.captures);
  const loadProject = useCaptureStore((state) => state.loadProject);
  const loadVideoProjectInWorkspace = useCaptureStore(
    (state) => state.loadVideoProjectInWorkspace
  );
  const loadGifInWorkspace = useCaptureStore((state) => state.loadGifInWorkspace);
  const clearCurrentProject = useCaptureStore((state) => state.clearCurrentProject);
  const saveNewCaptureFromFile = useCaptureStore((state) => state.saveNewCaptureFromFile);
  const loadCaptures = useCaptureStore((state) => state.loadCaptures);
  const isWorkspaceActive = isWorkspaceView(view);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>(() =>
    getInitialWorkspaceTab(view)
  );
  const [editorSidebarResetKey, setEditorSidebarResetKey] = useState(0);
  const isEditorWorkspaceActive = activeWorkspaceTab === 'editor' && isWorkspaceActive;
  const isLibraryWorkspaceActive = isEditorWorkspaceActive && view === 'library';

  // Initialize theme (applies theme class to document root)
  useTheme();

  // Auto-update checker (runs 5s after app starts)
  const updateChannel = useSettingsStore(s => s.settings.general.updateChannel);
  useUpdater(true, updateChannel);

  // Keyboard shortcuts help modal
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showExperimentalCaptureToolbar, setShowExperimentalCaptureToolbar] = useState(false);
  const [focusedLibraryCapture, setFocusedLibraryCapture] = useState<{
    id: string;
    requestKey: number;
  } | null>(null);
  const [lastOpenedCaptureId, setLastOpenedCaptureId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE.LAST_OPENED_CAPTURE_ID_KEY)
  );
  const {
    sidebarSize,
    isSidebarCollapsed,
    sidebarPanelRef,
    workspaceLayoutRef,
    handleToggleSidebar,
    handleImageWorkspaceLayout,
    handleSidebarCollapse,
    handleSidebarExpand,
  } = useWorkspaceSidebar();
  const savedCaptureProjectIdsRef = useRef(new Map<string, string>());
  const pendingPreviewOpenPathRef = useRef<string | null>(null);
  const lastOpenedCapture = useMemo(() => {
    return getLastOpenedWorkspaceCapture(captures, lastOpenedCaptureId);
  }, [captures, lastOpenedCaptureId]);

  useLibraryWindowHideOnClose();

  // Capture actions for shortcuts
  const {
    openCaptureToolbar,
  } = useCaptureActions();

  // App initialization (settings, shortcuts, cleanup)
  useAppInitialization();

  const eventCallbacks = useMainAppEventCallbacks({
    loadCaptures,
    loadProject,
    saveNewCaptureFromFile,
    savedCaptureProjectIdsRef,
    pendingPreviewOpenPathRef,
  });

  // Consolidated Tauri event listeners
  useAppEventListeners(eventCallbacks);
  useQuickRecordingFlow();
  usePreviewOpenLibraryEditorListeners(savedCaptureProjectIdsRef, pendingPreviewOpenPathRef);
  useAppKeyboardPlaceholders();

  // Settings handler
  const handleOpenSettings = useCallback(() => {
    useSettingsStore.getState().openSettingsModal();
  }, []);

  // Show capture toolbar window (startup mode)
  const handleShowCaptureToolbar = useCallback(async () => {
    await openCaptureToolbar();
  }, [openCaptureToolbar]);

  const {
    handleEditImageInWorkspace,
    handleEditVideoInWorkspace,
    handleEditGifInWorkspace,
    handleOpenLastMedia,
  } = useWorkspaceCaptureHandlers({
    loadProject,
    loadVideoProjectInWorkspace,
    loadGifInWorkspace,
    lastOpenedCapture,
    setLastOpenedCaptureId,
    setFocusedLibraryCapture,
  });

  const handleFocusedLibraryCaptureHandled = useCallback(() => {
    setFocusedLibraryCapture(null);
  }, []);

  useEffect(() => {
    if (view !== 'library') {
      activateEditorWorkspaceWithTransition({
        setActiveWorkspaceTab,
        setEditorSidebarResetKey,
      });
    }
  }, [view]);

  const handleSelectLibraryTab = useCallback(() => {
    useVideoEditorStore.getState().setIsPlaying(false);
    setWorkspaceTabWithTransition(setActiveWorkspaceTab, 'library');
  }, []);

  const handleSelectEditorTab = useCallback(() => {
    activateEditorWorkspaceWithTransition({
      setActiveWorkspaceTab,
      setEditorSidebarResetKey,
    });
  }, []);

  useWorkspaceTabShortcuts({
    isWorkspaceActive,
    onSelectLibrary: handleSelectLibraryTab,
    onSelectEditor: handleSelectEditorTab,
  });

  const handleOpenImageFromLibrary = useCallback(async (capture: CaptureListItem) => {
    activateEditorWorkspaceWithTransition({
      setActiveWorkspaceTab,
      setEditorSidebarResetKey,
    });
    await handleEditImageInWorkspace(capture);
  }, [handleEditImageInWorkspace]);

  const handleOpenVideoFromLibrary = useCallback(async (capture: CaptureListItem) => {
    activateEditorWorkspaceWithTransition({
      setActiveWorkspaceTab,
      setEditorSidebarResetKey,
    });
    await handleEditVideoInWorkspace(capture);
  }, [handleEditVideoInWorkspace]);

  const handleOpenGifFromLibrary = useCallback(async (capture: CaptureListItem) => {
    activateEditorWorkspaceWithTransition({
      setActiveWorkspaceTab,
      setEditorSidebarResetKey,
    });
    await handleEditGifInWorkspace(capture);
  }, [handleEditGifInWorkspace]);

  const handleCloseImageEditor = useCallback(() => {
    clearCurrentProject();
    setWorkspaceTabWithTransition(setActiveWorkspaceTab, 'library');
  }, [clearCurrentProject]);

  const handleCloseVideoEditor = useCallback(() => {
    clearCurrentProject();
    setWorkspaceTabWithTransition(setActiveWorkspaceTab, 'library');
  }, [clearCurrentProject]);

  const handleCloseGifEditor = useCallback(() => {
    clearCurrentProject();
    setWorkspaceTabWithTransition(setActiveWorkspaceTab, 'library');
  }, [clearCurrentProject]);

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

      {showExperimentalCaptureToolbar && (
        <ExperimentalCaptureToolbarDialog
          open={showExperimentalCaptureToolbar}
          onOpenChange={setShowExperimentalCaptureToolbar}
        />
      )}

      {/* Settings Dialog */}
      <SettingsDialog />

      {/* Custom Titlebar */}
      <HudTitlebar
        title="MoonSnap"
        contextLabel={getWorkspaceContextLabel(view, activeWorkspaceTab)}
        leftControl={
          <WorkspaceTabs
            activeWorkspaceTab={activeWorkspaceTab}
            onSelectLibrary={handleSelectLibraryTab}
            onSelectEditor={handleSelectEditorTab}
          />
        }
        onCapture={handleShowCaptureToolbar}
        onOpenSettings={handleOpenSettings}
      />

      {/* Main Content */}
      <div className="library-window__content flex-1 flex flex-col min-h-0">
        <WorkspaceLibraryView
          isActive={activeWorkspaceTab === 'library' && isWorkspaceActive}
          onEditImage={handleOpenImageFromLibrary}
          onEditVideo={handleOpenVideoFromLibrary}
          onEditGif={handleOpenGifFromLibrary}
        />
        <WorkspaceLayout
          isEditorWorkspaceActive={isEditorWorkspaceActive}
          workspaceLayoutRef={workspaceLayoutRef}
          handleImageWorkspaceLayout={handleImageWorkspaceLayout}
          editorSidebarResetKey={editorSidebarResetKey}
          sidebarPanelRef={sidebarPanelRef}
          isSidebarCollapsed={isSidebarCollapsed}
          sidebarSize={sidebarSize}
          isLibraryWorkspaceActive={isLibraryWorkspaceActive}
          focusedLibraryCapture={focusedLibraryCapture}
          handleFocusedLibraryCaptureHandled={handleFocusedLibraryCaptureHandled}
          handleEditImageInWorkspace={handleEditImageInWorkspace}
          handleEditVideoInWorkspace={handleEditVideoInWorkspace}
          handleEditGifInWorkspace={handleEditGifInWorkspace}
          handleSidebarCollapse={handleSidebarCollapse}
          handleSidebarExpand={handleSidebarExpand}
          handleToggleSidebar={handleToggleSidebar}
          view={view}
          lastOpenedCapture={lastOpenedCapture}
          handleCloseImageEditor={handleCloseImageEditor}
          handleCloseVideoEditor={handleCloseVideoEditor}
          handleCloseGifEditor={handleCloseGifEditor}
          handleOpenLastMedia={handleOpenLastMedia}
        />
      </div>
    </div>
  );
}

export default App;
