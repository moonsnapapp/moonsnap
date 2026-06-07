/**
 * ImageEditorWindow - Dedicated window for image editing.
 *
 * Each image opens in its own window for faster switching between projects.
 * Receives capture path via URL query params and loads the project independently.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Loader2 } from 'lucide-react';
import { HudTitlebar } from '@/components/Titlebar/Titlebar';
import { EditorStoreProvider, createEditorStore, useEditorStore, type EditorStore } from '@/stores/editorStore';
import { useTheme } from '@/hooks/useTheme';
import { editorLogger } from '@/utils/logger';
import { TIMING } from '@/constants';

// Lazy load editor components
const EditorCanvas = React.lazy(() =>
  import('@/components/Editor/EditorCanvas').then(m => ({ default: m.EditorCanvas }))
);
const Toolbar = React.lazy(() =>
  import('@/components/Editor/Toolbar').then(m => ({ default: m.Toolbar }))
);
const PropertiesPanel = React.lazy(() =>
  import('@/components/Editor/PropertiesPanel').then(m => ({ default: m.PropertiesPanel }))
);

import type Konva from 'konva';
import type { EditorCanvasRef } from '@/components/Editor/EditorCanvas';
import type { Tool, CanvasShape, Annotation, CropBoundsAnnotation, CropRegionAnnotation, CompositorSettingsAnnotation } from '@/types';
import { isCropBoundsAnnotation, isCropRegionAnnotation, isCompositorSettingsAnnotation, DEFAULT_COMPOSITOR_SETTINGS } from '@/types';
import { ensureBackgroundShape } from '@/utils/canvasGeometry';
import { toast } from 'sonner';
import { reportError } from '@/utils/errorReporting';
import { useEditorActions } from '@/hooks/useEditorActions';
import { useEditorKeyboardShortcuts } from '@/hooks/useEditorKeyboardShortcuts';
import { DeleteDialog } from '@/components/Library/components/DeleteDialog';
import { KeyboardShortcutsDialog } from '@/components/Editor/KeyboardShortcutsDialog';
import { CanvasCaptureNavigation, type CaptureNavigationControls } from '@/components/Editor/CanvasCaptureNavigation';

// Default stroke colors per tool - used when switching tools on new captures
const TOOL_DEFAULT_COLORS: Partial<Record<Tool, string>> = {
  highlight: '#FFEB3B', // Yellow
  // All other tools use the default red (#ef4444)
};
const DEFAULT_STROKE_COLOR = '#ef4444';

interface SavedCaptureLookup {
  projectId: string;
  imagePath: string;
}

interface ResolvedImageProject {
  projectId: string;
  capturePath: string;
}

interface ProjectImageRecord {
  id: string;
  image_path: string;
}

interface ImageProjectPayload {
  annotations?: Annotation[];
  dimensions?: { width: number; height: number };
}

interface ProjectCropState {
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  userExpanded: boolean;
}

type ImageEditorState = ReturnType<EditorStore['getState']>;
type AutosaveTimeout = ReturnType<typeof setTimeout> | null;
type IdleAnnotationAutosaveAction =
  | { type: 'skip' }
  | { type: 'retry' }
  | { type: 'save' };

interface MutableCurrent<T> {
  current: T;
}

interface AutosaveAttemptOptions {
  isClosingRef: MutableCurrent<boolean>;
  isInitialLoadRef: MutableCurrent<boolean>;
  isSavingAnnotationsRef: MutableCurrent<boolean>;
  lastUserActivityAtRef: MutableCurrent<number>;
  timeoutRef: MutableCurrent<AutosaveTimeout>;
  saveAnnotations: () => Promise<void>;
}

function getShapeAnnotations(annotations: Annotation[]) {
  return annotations.filter(
    (ann) => !isCropBoundsAnnotation(ann) && !isCropRegionAnnotation(ann) && !isCompositorSettingsAnnotation(ann)
  );
}

function hasSaveableEditorChange(state: ImageEditorState, prevState: ImageEditorState) {
  return (
    state.shapes !== prevState.shapes ||
    state.canvasBounds !== prevState.canvasBounds ||
    state.cropRegion !== prevState.cropRegion ||
    state.compositorSettings !== prevState.compositorSettings
  );
}

function isShapeClearMutation(state: ImageEditorState, prevState: ImageEditorState) {
  return state.shapes !== prevState.shapes && state.shapes.length === 0 && prevState.shapes.length > 0;
}

function hasRecentUserActivity(lastUserActivityAt: number) {
  return Date.now() - lastUserActivityAt <= TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_WINDOW_MS;
}

function waitForImageEditorRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, TIMING.IMAGE_EDITOR_DELETE_RESOLVE_RETRY_MS);
  });
}

function getResolvedImageProject(
  projectId: string | null,
  capturePath: string | null
): ResolvedImageProject | null {
  if (!projectId) {
    return null;
  }

  return {
    projectId,
    capturePath: capturePath ?? '',
  };
}

async function resolveImageProjectForDelete({
  projectId,
  capturePath,
  resolveProjectForCapturePath,
}: {
  projectId: string | null;
  capturePath: string | null;
  resolveProjectForCapturePath: () => Promise<ResolvedImageProject | null>;
}): Promise<ResolvedImageProject | null> {
  return getResolvedImageProject(projectId, capturePath) ?? resolveProjectForCapturePath();
}

async function deleteImageProject(projectId: string) {
  await invoke('delete_project', { projectId });
  await emit('capture-deleted', { projectId });
}

async function retrySavedCaptureLookup(
  capturePath: string,
  lookupSavedCaptureByTempPath: (path: string) => Promise<SavedCaptureLookup | null>
): Promise<SavedCaptureLookup | null> {
  for (let attempt = 0; attempt < TIMING.IMAGE_EDITOR_DELETE_RESOLVE_MAX_ATTEMPTS; attempt += 1) {
    const lookup = await lookupSavedCaptureByTempPath(capturePath);
    if (lookup) {
      return lookup;
    }

    if (attempt < TIMING.IMAGE_EDITOR_DELETE_RESOLVE_MAX_ATTEMPTS - 1) {
      await waitForImageEditorRetry();
    }
  }

  return null;
}

function isRgbaCapturePath(capturePath: string | null): capturePath is string {
  return capturePath?.endsWith('.rgba') === true;
}

async function resolveTempRgbaCaptureProject({
  capturePath,
  lookupSavedCaptureByTempPath,
  applySavedCaptureLookup,
}: {
  capturePath: string;
  lookupSavedCaptureByTempPath: (path: string) => Promise<SavedCaptureLookup | null>;
  applySavedCaptureLookup: (lookup: SavedCaptureLookup) => void;
}): Promise<ResolvedImageProject | null> {
  const lookup = await retrySavedCaptureLookup(capturePath, lookupSavedCaptureByTempPath);
  if (!lookup) {
    return null;
  }

  applySavedCaptureLookup(lookup);
  return getResolvedImageProject(lookup.projectId, lookup.imagePath);
}

async function loadImageProjectByPath({
  path,
  loadRgbaProject,
  loadSavedImageProject,
}: {
  path: string;
  loadRgbaProject: (path: string) => Promise<void>;
  loadSavedImageProject: (path: string) => Promise<void>;
}) {
  if (path.endsWith('.rgba')) {
    await loadRgbaProject(path);
    return;
  }

  await loadSavedImageProject(path);
}

function getImageProjectLoadErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to load image project';
}

function shouldQueueAnnotationAutosave(
  state: ImageEditorState,
  prevState: ImageEditorState,
  lastUserActivityAt: number,
) {
  return (
    hasSaveableEditorChange(state, prevState) &&
    !isShapeClearMutation(state, prevState) &&
    hasRecentUserActivity(lastUserActivityAt)
  );
}

function getEditorShapeAnnotations(shapes: CanvasShape[]): Annotation[] {
  return shapes
    .filter((shape) => !shape.isBackground)
    .map((shape) => ({ ...shape, id: shape.id, type: shape.type }) as Annotation);
}

function getCropBoundsSaveAnnotation(
  canvasBounds: ImageEditorState['canvasBounds']
): CropBoundsAnnotation | null {
  if (!canvasBounds) {
    return null;
  }

  return {
    id: '__crop_bounds__',
    type: '__crop_bounds__',
    width: canvasBounds.width,
    height: canvasBounds.height,
    imageOffsetX: canvasBounds.imageOffsetX,
    imageOffsetY: canvasBounds.imageOffsetY,
  };
}

function getCropRegionSaveAnnotation(
  state: ImageEditorState
): CropRegionAnnotation | null {
  const { cropRegion } = state;
  if (!cropRegion) {
    return null;
  }

  return {
    id: '__crop_region__',
    type: '__crop_region__',
    x: cropRegion.x,
    y: cropRegion.y,
    width: cropRegion.width,
    height: cropRegion.height,
    cropUserExpanded: state.cropUserExpanded || undefined,
  };
}

function getCompositorSettingsSaveAnnotation(
  state: ImageEditorState
): CompositorSettingsAnnotation {
  return {
    id: '__compositor_settings__',
    type: '__compositor_settings__',
    ...state.compositorSettings,
  };
}

function createProjectAnnotations(state: ImageEditorState): Annotation[] {
  return [
    ...getEditorShapeAnnotations(state.shapes),
    getCropBoundsSaveAnnotation(state.canvasBounds),
    getCropRegionSaveAnnotation(state),
    getCompositorSettingsSaveAnnotation(state),
  ].filter((annotation): annotation is Annotation => annotation !== null);
}

function shouldSkipAnnotationSave({
  force,
  isClosing,
  isSaving,
  projectId,
}: {
  force: boolean;
  isClosing: boolean;
  isSaving: boolean;
  projectId: string | null;
}) {
  return !projectId || (!force && (isClosing || isSaving));
}

async function updateProjectAnnotations(projectId: string, state: ImageEditorState) {
  await invoke('update_project_annotations', {
    projectId,
    annotations: createProjectAnnotations(state),
  });
}

function clearAnnotationAutosaveTimeout(timeoutRef: MutableCurrent<AutosaveTimeout>) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

function rescheduleIdleAnnotationAutosave(
  timeoutRef: MutableCurrent<AutosaveTimeout>,
  attemptAutoSaveWhenIdle: () => void,
) {
  timeoutRef.current = setTimeout(
    attemptAutoSaveWhenIdle,
    TIMING.IMAGE_EDITOR_AUTOSAVE_ACTIVITY_CHECK_MS,
  );
}

function shouldSkipIdleAnnotationAutosave(isClosing: boolean, isInitialLoad: boolean) {
  return isClosing || isInitialLoad;
}

function shouldRetryIdleAnnotationAutosave(
  isSavingAnnotations: boolean,
  lastUserActivityAt: number,
) {
  const idleMs = Date.now() - lastUserActivityAt;
  return isSavingAnnotations || idleMs < TIMING.IMAGE_EDITOR_AUTOSAVE_IDLE_MS;
}

function getIdleAnnotationAutosaveAction({
  isClosing,
  isInitialLoad,
  isSavingAnnotations,
  lastUserActivityAt,
}: {
  isClosing: boolean;
  isInitialLoad: boolean;
  isSavingAnnotations: boolean;
  lastUserActivityAt: number;
}): IdleAnnotationAutosaveAction {
  if (shouldSkipIdleAnnotationAutosave(isClosing, isInitialLoad)) {
    return { type: 'skip' };
  }

  if (shouldRetryIdleAnnotationAutosave(isSavingAnnotations, lastUserActivityAt)) {
    return { type: 'retry' };
  }

  return { type: 'save' };
}

function createIdleAnnotationAutosaveAttempt({
  isClosingRef,
  isInitialLoadRef,
  isSavingAnnotationsRef,
  lastUserActivityAtRef,
  timeoutRef,
  saveAnnotations,
}: AutosaveAttemptOptions) {
  const attemptAutoSaveWhenIdle = () => {
    const action = getIdleAnnotationAutosaveAction({
      isClosing: isClosingRef.current,
      isInitialLoad: isInitialLoadRef.current,
      isSavingAnnotations: isSavingAnnotationsRef.current,
      lastUserActivityAt: lastUserActivityAtRef.current,
    });

    if (action.type === 'skip') {
      return;
    }

    if (action.type === 'retry') {
      rescheduleIdleAnnotationAutosave(timeoutRef, attemptAutoSaveWhenIdle);
      return;
    }

    saveAnnotations().catch((error: unknown) => {
      editorLogger.warn('Auto-save failed:', error);
    });
  };

  return attemptAutoSaveWhenIdle;
}

function queueAnnotationAutosave(
  timeoutRef: MutableCurrent<AutosaveTimeout>,
  attemptAutoSaveWhenIdle: () => void,
) {
  clearAnnotationAutosaveTimeout(timeoutRef);
  timeoutRef.current = setTimeout(
    attemptAutoSaveWhenIdle,
    TIMING.IMAGE_EDITOR_AUTOSAVE_DEBOUNCE_MS,
  );
}

function getProjectCropRegionFromAnnotation(cropRegionAnn: CropRegionAnnotation): ProjectCropState {
  return {
    region: {
      x: cropRegionAnn.x,
      y: cropRegionAnn.y,
      width: cropRegionAnn.width,
      height: cropRegionAnn.height,
    },
    userExpanded: Boolean(cropRegionAnn.cropUserExpanded),
  };
}

function getProjectCropRegionFromBounds(cropBoundsAnn: CropBoundsAnnotation): ProjectCropState {
  return {
    region: {
      x: -cropBoundsAnn.imageOffsetX,
      y: -cropBoundsAnn.imageOffsetY,
      width: cropBoundsAnn.width,
      height: cropBoundsAnn.height,
    },
    userExpanded: false,
  };
}

function getProjectCropRegionFromDimensions(
  dimensions: ImageProjectPayload['dimensions']
): ProjectCropState | null {
  if (!dimensions) {
    return null;
  }

  return {
    region: {
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height,
    },
    userExpanded: false,
  };
}

function getProjectCropState(project: ImageProjectPayload): ProjectCropState | null {
  const annotations = project.annotations ?? [];
  const cropRegionAnn = annotations.find(isCropRegionAnnotation);
  if (cropRegionAnn) {
    return getProjectCropRegionFromAnnotation(cropRegionAnn);
  }

  const cropBoundsAnn = annotations.find(isCropBoundsAnnotation);
  if (cropBoundsAnn) {
    return getProjectCropRegionFromBounds(cropBoundsAnn);
  }

  return getProjectCropRegionFromDimensions(project.dimensions);
}

function applyProjectCropState(store: EditorStore, project: ImageProjectPayload) {
  const cropState = getProjectCropState(project);
  if (!cropState) {
    return;
  }

  store.getState().setCropRegion(cropState.region);
  if (cropState.userExpanded) {
    store.getState().setCropUserExpanded(true);
  }
}

function applyProjectCanvasBounds(store: EditorStore, cropBoundsAnn: CropBoundsAnnotation | undefined) {
  if (cropBoundsAnn) {
    store.getState().setCanvasBounds({
      width: cropBoundsAnn.width,
      height: cropBoundsAnn.height,
      imageOffsetX: cropBoundsAnn.imageOffsetX,
      imageOffsetY: cropBoundsAnn.imageOffsetY,
    });
  }
}

function applyProjectCompositorSettings(
  store: EditorStore,
  compositorAnn: CompositorSettingsAnnotation | undefined
) {
  if (compositorAnn) {
    store.getState().setCompositorSettings({
      ...DEFAULT_COMPOSITOR_SETTINGS,
      ...compositorAnn,
    });
  }
}

function applyProjectOriginalImageSize(
  store: EditorStore,
  dimensions: ImageProjectPayload['dimensions']
) {
  if (dimensions) {
    store.getState().setOriginalImageSize({
      width: dimensions.width,
      height: dimensions.height,
    });
  }
}

function applyProjectCanvasState(store: EditorStore, project: ImageProjectPayload) {
  const annotations = project.annotations ?? [];

  applyProjectCanvasBounds(store, annotations.find(isCropBoundsAnnotation));
  applyProjectCompositorSettings(store, annotations.find(isCompositorSettingsAnnotation));
  applyProjectOriginalImageSize(store, project.dimensions);
}

function applyProjectShapes(store: EditorStore, project: ImageProjectPayload) {
  const projectShapes: CanvasShape[] = getShapeAnnotations(project.annotations ?? []).map((ann) => ({
    ...ann,
    id: ann.id,
    type: ann.type,
  } as CanvasShape));

  if (project.dimensions) {
    store.getState().setShapes(
      ensureBackgroundShape(projectShapes, project.dimensions.width, project.dimensions.height)
    );
    return;
  }

  store.getState().setShapes(projectShapes);
}

function shouldClearSelectionForToolChange(selectedTool: Tool, newTool: Tool): boolean {
  return newTool !== selectedTool && selectedTool === 'select';
}

function getDefaultStrokeColorForTool(tool: Tool): string {
  return TOOL_DEFAULT_COLORS[tool] ?? DEFAULT_STROKE_COLOR;
}

function shouldEnableCompositorForTool(tool: Tool, compositorEnabled: boolean): boolean {
  return tool === 'background' && !compositorEnabled;
}

function getImageEditorTitle(capturePath: string | null): string {
  if (!capturePath) {
    return 'Image Editor';
  }

  if (capturePath.endsWith('.rgba')) {
    return 'New Capture';
  }

  const parts = capturePath.split(/[/\\]/);
  return parts[parts.length - 1] || 'Image Editor';
}

function ImageEditorStateShell({
  detailLabel,
  children,
}: {
  detailLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="editor-window h-screen w-screen flex flex-col overflow-hidden">
      <HudTitlebar
        title="MoonSnap"
        contextLabel="Image Editor"
        detailLabel={detailLabel}
        showMaximize={true}
      />
      <div className="editor-window__state flex-1 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function ImageEditorLoadingState() {
  return (
    <ImageEditorStateShell detailLabel="Loading">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
        <p className="text-sm text-(--ink-muted)">Loading image...</p>
      </div>
    </ImageEditorStateShell>
  );
}

function ImageEditorErrorState({
  error,
  capturePath,
}: {
  error: string;
  capturePath: string | null;
}) {
  return (
    <ImageEditorStateShell detailLabel="Error">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <div className="w-12 h-12 rounded-full bg-(--error-light) flex items-center justify-center">
          <span className="text-2xl">!</span>
        </div>
        <p className="text-sm text-(--error)">{error}</p>
        {capturePath && !capturePath.endsWith('.rgba') && (
          <p className="text-xs text-(--ink-muted)">Path: {capturePath}</p>
        )}
      </div>
    </ImageEditorStateShell>
  );
}

function ImageEditorNoImageState() {
  return (
    <ImageEditorStateShell detailLabel="No image">
      <p className="text-sm text-(--ink-muted)">No image data loaded</p>
    </ImageEditorStateShell>
  );
}

function applyLoadedImageProject(store: EditorStore, project: ImageProjectPayload) {
  if (project.annotations && project.annotations.length > 0) {
    applyProjectCropState(store, project);
    applyProjectCanvasState(store, project);
    applyProjectShapes(store, project);
    return;
  }

  if (project.dimensions) {
    store.getState().setOriginalImageSize({
      width: project.dimensions.width,
      height: project.dimensions.height,
    });
    store.getState().setShapes(
      ensureBackgroundShape([], project.dimensions.width, project.dimensions.height)
    );
  }
}

async function applyProjectAnnotations(store: EditorStore, projectId: string) {
  try {
    const project = await invoke<ImageProjectPayload>('get_project', { projectId });
    applyLoadedImageProject(store, project);
  } catch (err) {
    editorLogger.warn('Failed to load project annotations:', err);
  }
}

/**
 * Inner component that uses the editor store context
 */
export const ImageEditorContent: React.FC<{
  imageData: string;
  projectId: string | null;
  capturePath: string | null;
  store: EditorStore;
  onClose: () => void;
  resolveProjectForCapturePath: () => Promise<ResolvedImageProject | null>;
  captureNavigation?: CaptureNavigationControls;
}> = ({
  imageData,
  projectId,
  capturePath,
  store,
  onClose,
  resolveProjectForCapturePath,
  captureNavigation,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const editorCanvasRef = useRef<EditorCanvasRef>(null);

  // Individual selectors prevent re-renders from unrelated store changes
  // (e.g. selectedIds changing won't re-render if only EditorCanvas needs it)
  const shapes = useEditorStore((s) => s.shapes);
  const setShapes = useEditorStore((s) => s.setShapes);
  const compositorSettings = useEditorStore((s) => s.compositorSettings);
  const setCompositorSettings = useEditorStore((s) => s.setCompositorSettings);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setSelectedIds = useEditorStore((s) => s.setSelectedIds);
  const strokeColor = useEditorStore((s) => s.strokeColor);
  const setStrokeColor = useEditorStore((s) => s.setStrokeColor);
  const fillColor = useEditorStore((s) => s.fillColor);
  const setFillColor = useEditorStore((s) => s.setFillColor);
  const strokeWidth = useEditorStore((s) => s.strokeWidth);
  const setStrokeWidth = useEditorStore((s) => s.setStrokeWidth);

  const [selectedTool, setSelectedTool] = useState<Tool>('select');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { isCopying, isSaving, handleCopy, handleSave } = useEditorActions({ stageRef, imageData });

  // Fit to center handler - dispatch custom event that EditorCanvas listens for
  const handleFitToCenter = useCallback(() => {
    window.dispatchEvent(new CustomEvent('fit-to-center'));
  }, []);

  // Show shortcuts handler
  const handleShowShortcuts = useCallback(() => {
    setShortcutsOpen(true);
  }, []);

  // Deselect handler
  const handleDeselect = useCallback(() => {
    setSelectedIds([]);
  }, [setSelectedIds]);

  // Toggle compositor handler
  const handleToggleCompositor = useCallback(() => {
    setCompositorSettings({ enabled: !compositorSettings.enabled });
  }, [compositorSettings.enabled, setCompositorSettings]);

  // Handle tool change
  const handleToolChange = useCallback((newTool: Tool) => {
    if (shouldClearSelectionForToolChange(selectedTool, newTool)) {
      setSelectedIds([]);
    }

    setStrokeColor(getDefaultStrokeColorForTool(newTool));
    setSelectedTool(newTool);

    if (shouldEnableCompositorForTool(newTool, compositorSettings.enabled)) {
      setCompositorSettings({ enabled: true });
    }
  }, [selectedTool, setSelectedIds, setStrokeColor, compositorSettings.enabled, setCompositorSettings]);

  // Crop commit handler - switch to select tool and fit
  const handleCropCommit = useCallback(() => {
    handleToolChange('select');
    window.dispatchEvent(new CustomEvent('fit-to-center'));
  }, [handleToolChange]);

  // Crop reset handler - dispatch event for EditorCanvas to handle
  const handleCropReset = useCallback(() => {
    window.dispatchEvent(new CustomEvent('crop-reset'));
  }, []);

  // Handle shapes change
  const handleShapesChange = useCallback((newShapes: CanvasShape[]) => {
    setShapes(newShapes);
  }, [setShapes]);

  // Undo/Redo handlers - use store methods directly for window context
  const handleUndo = useCallback(() => {
    store.getState()._undo();
  }, [store]);

  const handleRedo = useCallback(() => {
    store.getState()._redo();
  }, [store]);

  // Delete handlers
  const handleRequestDelete = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const resolvedProject = await resolveImageProjectForDelete({
      projectId,
      capturePath,
      resolveProjectForCapturePath,
    });

    if (!resolvedProject) {
      toast.error('Capture is still being saved. Try delete again in a moment.');
      return;
    }

    try {
      await deleteImageProject(resolvedProject.projectId);
      toast.success('Capture deleted');
      onClose();
    } catch (error) {
      reportError(error, { operation: 'delete capture' });
      return;
    }

    setDeleteDialogOpen(false);
  }, [projectId, capturePath, resolveProjectForCapturePath, onClose]);

  const handleCancelDelete = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  // Wire up keyboard shortcuts
  useEditorKeyboardShortcuts({
    view: 'editor',
    selectedTool,
    selectedIds,
    compositorEnabled: compositorSettings.enabled,
    onToolChange: handleToolChange,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onSave: handleSave,
    onCopy: handleCopy,
    onToggleCompositor: handleToggleCompositor,
    onShowShortcuts: handleShowShortcuts,
    onDeselect: handleDeselect,
    onFitToCenter: handleFitToCenter,
    onCropCommit: handleCropCommit,
    onCropReset: handleCropReset,
  });

  return (
    <>
      <React.Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-(--accent-400)" />
          </div>
        }
      >
        <div className="editor-workspace image-editor-workspace flex-1 flex flex-col min-h-0">
          <div className="editor-workspace__main flex-1 flex min-h-0">
            <div className="editor-stage-shell flex-1 overflow-hidden min-h-0 relative">
              <EditorCanvas
                ref={editorCanvasRef}
                imageData={imageData}
                selectedTool={selectedTool}
                onToolChange={handleToolChange}
                strokeColor={strokeColor}
                fillColor={fillColor}
                strokeWidth={strokeWidth}
                shapes={shapes}
                onShapesChange={handleShapesChange}
                stageRef={stageRef}
              />
              {captureNavigation && (
                <CanvasCaptureNavigation {...captureNavigation} />
              )}
            </div>
            <PropertiesPanel
              selectedTool={selectedTool}
              strokeColor={strokeColor}
              onStrokeColorChange={setStrokeColor}
              fillColor={fillColor}
              onFillColorChange={setFillColor}
              strokeWidth={strokeWidth}
              onStrokeWidthChange={setStrokeWidth}
            />
          </div>
          <Toolbar
            selectedTool={selectedTool}
            onToolChange={handleToolChange}
            onCopy={handleCopy}
            onSave={handleSave}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDelete={handleRequestDelete}
            isCopying={isCopying}
            isSaving={isSaving}
          />
        </div>
      </React.Suspense>

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        count={1}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </>
  );
};

/**
 * ImageEditorWindow - Standalone image editor window.
 */
const ImageEditorWindow: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturePath, setCapturePath] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  // Use ref for projectId to avoid race conditions in close handler
  const projectIdRef = useRef<string | null>(null);
  // Flag to prevent auto-save during initial load
  const isInitialLoadRef = useRef(true);
  // Flag to prevent auto-save during window close (clearEditor triggers store change)
  const isClosingRef = useRef(false);
  // Flag to prevent overlapping annotation saves
  const isSavingAnnotationsRef = useRef(false);
  // Timestamp of most recent user interaction (used for activity-aware autosave)
  const lastUserActivityAtRef = useRef(Date.now());

  // Create a store instance for this window
  const [store] = useState(() => createEditorStore());

  // Apply theme
  useTheme();

  const applySavedCaptureLookup = useCallback((lookup: SavedCaptureLookup) => {
    setProjectId(lookup.projectId);
    projectIdRef.current = lookup.projectId;
    setCapturePath(lookup.imagePath);
  }, []);

  const lookupSavedCaptureByTempPath = useCallback(async (path: string) => {
    return invoke<SavedCaptureLookup | null>('get_saved_capture_by_temp_path', {
      filePath: path,
    });
  }, []);

  const resolveProjectForCapturePath = useCallback(async (): Promise<ResolvedImageProject | null> => {
    const resolvedProject = getResolvedImageProject(projectIdRef.current, capturePath);
    if (resolvedProject) return resolvedProject;

    if (!isRgbaCapturePath(capturePath)) {
      return null;
    }

    return resolveTempRgbaCaptureProject({
      capturePath,
      lookupSavedCaptureByTempPath,
      applySavedCaptureLookup,
    });
  }, [capturePath, applySavedCaptureLookup, lookupSavedCaptureByTempPath]);

  const loadRgbaProject = useCallback(async (path: string) => {
    const savedCapture = await lookupSavedCaptureByTempPath(path);
    if (savedCapture) {
      applySavedCaptureLookup(savedCapture);
    }

    setImageData(path);
    if (!savedCapture) {
      setCapturePath(path);
    }
    setIsLoading(false);
    editorLogger.info('RGBA file loaded directly (fast path)');
  }, [applySavedCaptureLookup, lookupSavedCaptureByTempPath]);

  const loadSavedImageProject = useCallback(async (path: string) => {
    const captures = await invoke<ProjectImageRecord[]>('get_capture_list');
    const capture = captures.find((candidate) => candidate.image_path === path);
    if (!capture) {
      throw new Error('Could not find project for image path');
    }

    applySavedCaptureLookup({ projectId: capture.id, imagePath: path });

    const loadedImageData = await invoke<string>('get_project_image', { projectId: capture.id });
    setImageData(loadedImageData);
    await applyProjectAnnotations(store, capture.id);

    setCapturePath(path);
    setIsLoading(false);
    setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 500);
  }, [applySavedCaptureLookup, store]);

  // Load project when path is received
  const loadProject = useCallback(async (path: string) => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      editorLogger.info('Loading image project:', path);

      await loadImageProjectByPath({ path, loadRgbaProject, loadSavedImageProject });
    } catch (err) {
      editorLogger.error('Failed to load image project:', err);
      setError(getImageProjectLoadErrorMessage(err));
      setIsLoading(false);
    }
  }, [loadRgbaProject, loadSavedImageProject]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encodedPath = params.get('path');
    if (encodedPath && !hasLoadedRef.current) {
      const path = decodeURIComponent(encodedPath);
      loadProject(path);
    }
  }, [loadProject]);

  const saveAnnotations = useCallback(async (force = false) => {
    const currentProjectId = projectIdRef.current;
    if (shouldSkipAnnotationSave({
      force,
      isClosing: isClosingRef.current,
      isSaving: isSavingAnnotationsRef.current,
      projectId: currentProjectId,
    })) {
      return;
    }

    isSavingAnnotationsRef.current = true;

    try {
      await updateProjectAnnotations(currentProjectId!, store.getState());
    } catch (err) {
      editorLogger.warn('Failed to save annotations:', err);
    } finally {
      isSavingAnnotationsRef.current = false;
    }
  }, [store]);
  // Auto-save annotations when store state changes (debounced)
  useEffect(() => {
    // Don't auto-save until project is loaded
    if (!projectIdRef.current || isLoading) return;

    const timeoutRef: MutableCurrent<AutosaveTimeout> = { current: null };
    const attemptAutoSaveWhenIdle = createIdleAnnotationAutosaveAttempt({
      isClosingRef,
      isInitialLoadRef,
      isSavingAnnotationsRef,
      lastUserActivityAtRef,
      timeoutRef,
      saveAnnotations,
    });

    // Subscribe to store changes and debounce saves
    const unsubscribe = store.subscribe((state: ImageEditorState, prevState: ImageEditorState) => {
      // Don't auto-save during initial load or window close (prevents overwriting good data)
      if (isInitialLoadRef.current || isClosingRef.current) {
        return;
      }

      if (!shouldQueueAnnotationAutosave(state, prevState, lastUserActivityAtRef.current)) {
        return;
      }

      queueAnnotationAutosave(timeoutRef, attemptAutoSaveWhenIdle);
    });

    return () => {
      unsubscribe();
      clearAnnotationAutosaveTimeout(timeoutRef);
    };
  }, [store, isLoading, saveAnnotations]);

  // Cleanup on window close
  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    const unlisten = currentWindow.onCloseRequested(async (event: { preventDefault: () => void }) => {
      // Prevent the default close to ensure we save first
      event.preventDefault();
      // Set closing flag to prevent any more auto-saves
      isClosingRef.current = true;
      // Save annotations (force=true to bypass the closing check)
      await saveAnnotations(true);
      // Now actually close the window (don't clear store - it gets garbage collected)
      currentWindow.destroy();
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, [store, saveAnnotations]);

  // Handle close
  const handleClose = useCallback(async () => {
    // Set closing flag to prevent any more auto-saves
    isClosingRef.current = true;
    // Save with force=true to bypass the closing check
    await saveAnnotations(true);
    // Don't clear store - it gets garbage collected when window closes
    getCurrentWebviewWindow().close();
  }, [saveAnnotations]);

  // Loading state
  if (isLoading) {
    return <ImageEditorLoadingState />;
  }

  // Error state
  if (error) {
    return <ImageEditorErrorState error={error} capturePath={capturePath} />;
  }

  // No image data loaded
  if (!imageData) {
    return <ImageEditorNoImageState />;
  }

  // Main editor UI
  return (
    <div className="editor-window h-screen w-screen flex flex-col overflow-hidden">
      <HudTitlebar
        title="MoonSnap"
        contextLabel="Image Editor"
        detailLabel={getImageEditorTitle(capturePath)}
        showMaximize={true}
        onClose={handleClose}
      />
      <EditorStoreProvider store={store}>
        <ImageEditorContent
          imageData={imageData}
          projectId={projectId}
          capturePath={capturePath}
          store={store}
          onClose={handleClose}
          resolveProjectForCapturePath={resolveProjectForCapturePath}
        />
      </EditorStoreProvider>
    </div>
  );
};

export default ImageEditorWindow;
