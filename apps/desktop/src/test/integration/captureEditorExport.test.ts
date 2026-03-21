import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setInvokeResponse, setInvokeError, clearInvokeResponses } from '@/test/mocks/tauri';
import { useCaptureStore } from '@/stores/captureStore';
import { createEditorStore } from '@/stores/editorStore';
import type { CaptureProject, SaveCaptureResponse, Annotation } from '@/types';
import type { CanvasShape } from '@/types';

/**
 * Integration tests for the capture → editor → annotations flow.
 * Tests store-level integration without React rendering.
 */

function createTestProject(overrides: Partial<CaptureProject> = {}): CaptureProject {
  return {
    id: 'proj-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    capture_type: 'region',
    dimensions: { width: 1920, height: 1080 },
    source: { monitor: 0 },
    original_image: 'base64data',
    annotations: [],
    tags: [],
    favorite: false,
    ...overrides,
  };
}

function createSaveResponse(overrides: Partial<SaveCaptureResponse> = {}): SaveCaptureResponse {
  const project = createTestProject();
  return {
    id: project.id,
    project,
    thumbnail_path: '/thumbs/proj-123.png',
    image_path: '/images/proj-123.png',
    ...overrides,
  };
}

function createTestShape(overrides: Partial<CanvasShape> = {}): CanvasShape {
  return {
    id: 'shape-1',
    type: 'rect',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    stroke: '#ff0000',
    strokeWidth: 2,
    fill: 'transparent',
    ...overrides,
  };
}

describe('Capture → Editor → Annotations Integration', () => {
  beforeEach(() => {
    clearInvokeResponses();
    // Reset captureStore to initial state
    useCaptureStore.setState({
      captures: [],
      loading: false,
      error: null,
      isFromCache: false,
      isCacheStale: false,
      isRefreshing: false,
      currentProject: null,
      currentImageData: null,
      hasUnsavedChanges: false,
      loadingProjectId: null,
      skipStagger: false,
      searchQuery: '',
      filterFavorites: false,
      filterTags: [],
      view: 'library',
    });
  });

  describe('saveNewCapture → editor transition', () => {
    it('should switch to editor view with project data after save', async () => {
      const response = createSaveResponse();
      setInvokeResponse('save_capture', response);

      const imageData = 'base64_image_data';
      await useCaptureStore.getState().saveNewCapture(imageData, 'region', { monitor: 0 });

      const state = useCaptureStore.getState();
      expect(state.view).toBe('editor');
      expect(state.currentProject).toEqual(response.project);
      expect(state.currentImageData).toBe(imageData);
      expect(state.hasUnsavedChanges).toBe(false);
      expect(state.captures).toHaveLength(1);
      expect(state.captures[0].id).toBe(response.id);
    });

    it('should not switch to editor view in silent mode', async () => {
      const response = createSaveResponse();
      setInvokeResponse('save_capture', response);

      useCaptureStore.setState({ view: 'library' });
      await useCaptureStore.getState().saveNewCapture('data', 'screenshot', { monitor: 0 }, { silent: true });

      const state = useCaptureStore.getState();
      expect(state.view).toBe('library');
      // Silent mode still sets currentProject but not view or imageData
      expect(state.currentProject).toEqual(response.project);
      expect(state.currentImageData).toBeNull();
      expect(state.captures).toHaveLength(1);
    });

    it('should rollback placeholder on save error', async () => {
      setInvokeError('save_capture', 'Save failed');

      await expect(
        useCaptureStore.getState().saveNewCapture('data', 'region', { monitor: 0 })
      ).rejects.toThrow('Save failed');

      const state = useCaptureStore.getState();
      expect(state.captures).toHaveLength(0);
      expect(state.error).toContain('Save failed');
    });
  });

  describe('loadProject → editor transition', () => {
    it('should load project and image into editor', async () => {
      const project = createTestProject();
      setInvokeResponse('get_project', project);
      setInvokeResponse('get_project_image', 'base64_image_data');

      await useCaptureStore.getState().loadProject('proj-123');

      const state = useCaptureStore.getState();
      expect(state.view).toBe('editor');
      expect(state.currentProject).toEqual(project);
      expect(state.currentImageData).toBe('base64_image_data');
      expect(state.hasUnsavedChanges).toBe(false);
    });

    it('should revert to library on load error', async () => {
      // loadProject catches errors internally and doesn't re-throw
      setInvokeError('get_project', 'Project not found');

      await useCaptureStore.getState().loadProject('bad-id');

      const state = useCaptureStore.getState();
      expect(state.view).toBe('library');
      expect(state.currentProject).toBeNull();
      expect(state.error).toContain('Project not found');
    });
  });

  describe('annotations round-trip', () => {
    it('should serialize shapes + bounds + compositor into annotations', async () => {
      // Setup: project exists in store
      const project = createTestProject();
      useCaptureStore.setState({ currentProject: project });

      const shapes = [createTestShape()];
      const canvasBounds = { width: 1920, height: 1080, imageOffsetX: 0, imageOffsetY: 0 };
      const cropRegion = { x: 10, y: 20, width: 500, height: 400 };
      const compositorSettings = { enabled: true, padding: 32, borderRadius: 12 };

      // Serialize annotations the same way useEditorActions does
      const annotations: Annotation[] = [
        ...shapes.map((s) => ({ ...s } as Annotation)),
        {
          id: '__crop_bounds__',
          type: '__crop_bounds__',
          width: canvasBounds.width,
          height: canvasBounds.height,
          imageOffsetX: canvasBounds.imageOffsetX,
          imageOffsetY: canvasBounds.imageOffsetY,
        } as Annotation,
        {
          id: '__crop_region__',
          type: '__crop_region__',
          x: cropRegion.x,
          y: cropRegion.y,
          width: cropRegion.width,
          height: cropRegion.height,
        } as Annotation,
        {
          id: '__compositor_settings__',
          type: '__compositor_settings__',
          ...compositorSettings,
        } as Annotation,
      ];

      // Mock the update_project_annotations call
      const updatedProject = { ...project, annotations, updated_at: new Date().toISOString() };
      setInvokeResponse('update_project_annotations', updatedProject);

      await useCaptureStore.getState().updateAnnotations(annotations);

      const state = useCaptureStore.getState();
      expect(state.currentProject).toEqual(updatedProject);
      expect(state.hasUnsavedChanges).toBe(false);

      // Verify the annotations contain all expected pseudo-annotations
      const savedAnnotations = state.currentProject!.annotations;
      expect(savedAnnotations.some((a: Annotation) => a.id === '__crop_bounds__')).toBe(true);
      expect(savedAnnotations.some((a: Annotation) => a.id === '__crop_region__')).toBe(true);
      expect(savedAnnotations.some((a: Annotation) => a.id === '__compositor_settings__')).toBe(true);
    });

    it('should preserve shapes without background imageSrc', () => {
      const shapes = [
        createTestShape({ id: 'bg', isBackground: true, imageSrc: 'base64_data' }),
        createTestShape({ id: 'rect-1' }),
      ];

      // Simulate the annotation serialization from useEditorActions
      const annotations: Annotation[] = shapes.map((shape) => {
        if (shape.isBackground) {
          const { imageSrc: _unused, ...rest } = shape;
          return { ...rest } as Annotation;
        }
        return { ...shape } as Annotation;
      });

      const bgAnnotation = annotations.find((a) => a.id === 'bg');
      expect(bgAnnotation).toBeDefined();
      expect(bgAnnotation).not.toHaveProperty('imageSrc');
      expect(bgAnnotation).toHaveProperty('isBackground', true);

      const rectAnnotation = annotations.find((a) => a.id === 'rect-1');
      expect(rectAnnotation).toBeDefined();
    });
  });

  describe('editor store integration', () => {
    it('should support the full editor workflow: draw → undo → redo', () => {
      const store = createEditorStore();

      // Draw a shape
      const shape = createTestShape();
      store.getState().setShapes([shape]);
      expect(store.getState().shapes).toHaveLength(1);

      // Take snapshot, modify, commit (simulate drag)
      store.getState()._takeSnapshot();
      store.getState().updateShape('shape-1', { x: 100, y: 200 });
      store.getState()._commitSnapshot();

      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().shapes[0].x).toBe(100);

      // Undo - goes back to original state
      store.getState()._undo();
      expect(store.getState().shapes[0].x).toBe(10);
      expect(store.getState().canRedo).toBe(true);

      // Redo - goes back to modified state
      store.getState()._redo();
      expect(store.getState().shapes[0].x).toBe(100);
      expect(store.getState().canRedo).toBe(false);
    });

    it('should clear history independently of clearEditor', () => {
      const store = createEditorStore();
      const shape = createTestShape();
      store.getState().setShapes([shape]);
      store.getState()._takeSnapshot();
      store.getState().updateShape('shape-1', { x: 100 });
      store.getState()._commitSnapshot();

      expect(store.getState().canUndo).toBe(true);

      // clearEditor does NOT clear history (by design - user can undo a clear)
      store.getState().clearEditor();
      expect(store.getState().shapes).toHaveLength(0);
      // History still has entries - can undo the clear
      expect(store.getState().canUndo).toBe(true);

      // _clearHistory removes all history
      store.getState()._clearHistory();
      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().canRedo).toBe(false);
    });

    it('should maintain compositor settings through the workflow', () => {
      const store = createEditorStore();

      store.getState().setCompositorSettings({ enabled: true, padding: 48, borderRadius: 16 });
      expect(store.getState().compositorSettings.enabled).toBe(true);
      expect(store.getState().compositorSettings.padding).toBe(48);

      // Set crop region
      store.getState().setCropRegion({ x: 0, y: 0, width: 800, height: 600 });
      expect(store.getState().cropRegion).toEqual({ x: 0, y: 0, width: 800, height: 600 });

      // Clear editor resets everything
      store.getState().clearEditor();
      expect(store.getState().compositorSettings.padding).toBe(64); // default
      expect(store.getState().cropRegion).toBeNull();
    });
  });
});
