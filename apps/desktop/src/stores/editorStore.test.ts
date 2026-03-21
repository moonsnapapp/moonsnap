import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditorStore } from './editorStore';
import type { CanvasShape, BlurType } from '../types';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('editorStore', () => {
  let store: ReturnType<typeof createEditorStore>;

  function createTestShape(overrides: Partial<CanvasShape> = {}): CanvasShape {
    return {
      id: `shape_${Math.random().toString(36).slice(2)}`,
      type: 'rect',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      stroke: '#ef4444',
      strokeWidth: 3,
      fill: 'transparent',
      rotation: 0,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    store = createEditorStore();
  });

  describe('shapes', () => {
    it('should set shapes', () => {
      const shapes = [createTestShape(), createTestShape()];
      store.getState().setShapes(shapes);
      expect(store.getState().shapes).toHaveLength(2);
    });

    it('should update a shape by id', () => {
      const shape = createTestShape({ id: 's1', x: 10 });
      store.getState().setShapes([shape]);

      store.getState().updateShape('s1', { x: 50, y: 30 });
      const updated = store.getState().shapes[0];
      expect(updated.x).toBe(50);
      expect(updated.y).toBe(30);
      expect(updated.type).toBe('rect');
    });

    it('should not modify other shapes on update', () => {
      const s1 = createTestShape({ id: 's1', x: 10 });
      const s2 = createTestShape({ id: 's2', x: 20 });
      store.getState().setShapes([s1, s2]);

      store.getState().updateShape('s1', { x: 99 });
      expect(store.getState().shapes[1].x).toBe(20);
    });
  });

  describe('selection', () => {
    it('should set selected ids', () => {
      store.getState().setSelectedIds(['a', 'b']);
      expect(store.getState().selectedIds).toEqual(['a', 'b']);
    });

    it('should not trigger update if ids are equal', () => {
      store.getState().setSelectedIds(['a', 'b']);
      const stateBefore = store.getState();
      store.getState().setSelectedIds(['a', 'b']);
      expect(store.getState().selectedIds).toBe(stateBefore.selectedIds);
    });
  });

  describe('step count', () => {
    it('should increment step count', () => {
      expect(store.getState().stepCount).toBe(1);
      store.getState().incrementStepCount();
      expect(store.getState().stepCount).toBe(2);
    });

    it('should reset step count to 1', () => {
      store.getState().incrementStepCount();
      store.getState().incrementStepCount();
      store.getState().resetStepCount();
      expect(store.getState().stepCount).toBe(1);
    });
  });

  describe('clearEditor', () => {
    it('should reset all state to defaults', () => {
      const shape = createTestShape();
      store.getState().setShapes([shape]);
      store.getState().setSelectedIds(['a']);
      store.getState().setBlurAmount(25);
      store.getState().setFontSize(48);
      store.getState().setCropRegion({ x: 0, y: 0, width: 100, height: 100 });

      store.getState().clearEditor();

      const state = store.getState();
      expect(state.shapes).toEqual([]);
      expect(state.selectedIds).toEqual([]);
      expect(state.stepCount).toBe(1);
      expect(state.blurAmount).toBe(15);
      expect(state.fontSize).toBe(36);
      expect(state.cropRegion).toBeNull();
    });
  });

  describe('drawing tools', () => {
    it('should set stroke color', () => {
      store.getState().setStrokeColor('#00ff00');
      expect(store.getState().strokeColor).toBe('#00ff00');
    });

    it('should set fill color', () => {
      store.getState().setFillColor('#0000ff');
      expect(store.getState().fillColor).toBe('#0000ff');
    });

    it('should set stroke width and persist to localStorage', () => {
      store.getState().setStrokeWidth(5);
      expect(store.getState().strokeWidth).toBe(5);
      expect(localStorageMock.setItem).toHaveBeenCalledWith('editor:strokeWidth', '5');
    });

    it('should set blur type', () => {
      store.getState().setBlurType('gaussian' as BlurType);
      expect(store.getState().blurType).toBe('gaussian');
    });

    it('should set blur amount', () => {
      store.getState().setBlurAmount(30);
      expect(store.getState().blurAmount).toBe(30);
    });

    it('should set font size', () => {
      store.getState().setFontSize(24);
      expect(store.getState().fontSize).toBe(24);
    });
  });

  describe('canvas bounds', () => {
    it('should set canvas bounds', () => {
      const bounds = { width: 800, height: 600, imageOffsetX: 0, imageOffsetY: 0 };
      store.getState().setCanvasBounds(bounds);
      expect(store.getState().canvasBounds).toEqual(bounds);
    });

    it('should reset canvas bounds to original image size', () => {
      store.getState().setOriginalImageSize({ width: 1920, height: 1080 });
      store.getState().setCanvasBounds({ width: 500, height: 500, imageOffsetX: 10, imageOffsetY: 20 });

      store.getState().resetCanvasBounds();
      expect(store.getState().canvasBounds).toEqual({
        width: 1920,
        height: 1080,
        imageOffsetX: 0,
        imageOffsetY: 0,
      });
    });

    it('should set canvas bounds to null on reset when no original size', () => {
      store.getState().setCanvasBounds({ width: 500, height: 500, imageOffsetX: 0, imageOffsetY: 0 });
      store.getState().resetCanvasBounds();
      expect(store.getState().canvasBounds).toBeNull();
    });
  });

  describe('crop region', () => {
    it('should set crop region', () => {
      const region = { x: 10, y: 20, width: 300, height: 200 };
      store.getState().setCropRegion(region);
      expect(store.getState().cropRegion).toEqual(region);
    });

    it('should clear crop region with null', () => {
      store.getState().setCropRegion({ x: 0, y: 0, width: 100, height: 100 });
      store.getState().setCropRegion(null);
      expect(store.getState().cropRegion).toBeNull();
    });

    it('should set crop user expanded', () => {
      store.getState().setCropUserExpanded(true);
      expect(store.getState().cropUserExpanded).toBe(true);
    });
  });

  describe('compositor', () => {
    it('should set compositor settings', () => {
      store.getState().setCompositorSettings({ padding: 50, shadowIntensity: 0.8 });
      const settings = store.getState().compositorSettings;
      expect(settings.padding).toBe(50);
      expect(settings.shadowIntensity).toBe(0.8);
    });

    it('should clear preview on settings commit', () => {
      store.getState().setCompositorPreview({ padding: 60 });
      store.getState().setCompositorSettings({ padding: 50 });
      expect(store.getState().compositorPreview).toBeNull();
    });

    it('should toggle compositor enabled', () => {
      const before = store.getState().compositorSettings.enabled;
      store.getState().toggleCompositor();
      expect(store.getState().compositorSettings.enabled).toBe(!before);
    });

    it('should show/hide compositor panel', () => {
      store.getState().setShowCompositor(true);
      expect(store.getState().showCompositor).toBe(true);
      store.getState().setShowCompositor(false);
      expect(store.getState().showCompositor).toBe(false);
    });
  });

  describe('undo/redo', () => {
    it('should have no undo/redo initially', () => {
      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().canRedo).toBe(false);
    });

    it('should commit snapshot and enable undo', () => {
      store.getState().setShapes([createTestShape({ id: 's1' })]);
      store.getState()._takeSnapshot();
      store.getState().updateShape('s1', { x: 100 });
      store.getState()._commitSnapshot();

      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().canRedo).toBe(false);
    });

    it('should not commit if nothing changed', () => {
      const shapes = [createTestShape({ id: 's1' })];
      store.getState().setShapes(shapes);
      store.getState()._takeSnapshot();
      // No changes made
      store.getState()._commitSnapshot();

      expect(store.getState().canUndo).toBe(false);
    });

    it('should undo to previous state', () => {
      const s1 = createTestShape({ id: 's1', x: 10 });
      store.getState().setShapes([s1]);

      // Take snapshot, modify, commit
      store.getState()._takeSnapshot();
      store.getState().updateShape('s1', { x: 100 });
      store.getState()._commitSnapshot();

      // Undo
      const result = store.getState()._undo();
      expect(result).toBe(true);
      expect(store.getState().shapes[0].x).toBe(10);
      expect(store.getState().canRedo).toBe(true);
    });

    it('should redo after undo', () => {
      const s1 = createTestShape({ id: 's1', x: 10 });
      store.getState().setShapes([s1]);

      store.getState()._takeSnapshot();
      store.getState().updateShape('s1', { x: 100 });
      store.getState()._commitSnapshot();
      store.getState()._undo();

      const result = store.getState()._redo();
      expect(result).toBe(true);
      expect(store.getState().shapes[0].x).toBe(100);
    });

    it('should return false when nothing to undo', () => {
      expect(store.getState()._undo()).toBe(false);
    });

    it('should return false when nothing to redo', () => {
      expect(store.getState()._redo()).toBe(false);
    });

    it('should discard snapshot without committing', () => {
      store.getState()._takeSnapshot();
      store.getState()._discardSnapshot();
      expect(store.getState().canUndo).toBe(false);
    });

    it('should clear history', () => {
      const s1 = createTestShape({ id: 's1', x: 10 });
      store.getState().setShapes([s1]);
      store.getState()._takeSnapshot();
      store.getState().updateShape('s1', { x: 100 });
      store.getState()._commitSnapshot();

      store.getState()._clearHistory();
      expect(store.getState().canUndo).toBe(false);
      expect(store.getState().canRedo).toBe(false);
    });

    it('should clear redo stack on new action', () => {
      const s1 = createTestShape({ id: 's1', x: 10 });
      store.getState().setShapes([s1]);

      store.getState()._takeSnapshot();
      store.getState().updateShape('s1', { x: 100 });
      store.getState()._commitSnapshot();
      store.getState()._undo();
      expect(store.getState().canRedo).toBe(true);

      // New action should clear redo
      store.getState()._takeSnapshot();
      store.getState().updateShape('s1', { x: 200 });
      store.getState()._commitSnapshot();
      expect(store.getState().canRedo).toBe(false);
    });
  });
});
