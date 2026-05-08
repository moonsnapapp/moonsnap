import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { EditorStoreContext } from '../stores/EditorStoreProvider';
import { createEditorStore } from '../stores/editorStore';
import type { CanvasShape } from '../types';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: () => `mock_id_${Date.now()}`,
}));

// Helper to create test shapes
function createTestShape(overrides: Partial<CanvasShape> = {}): CanvasShape {
  return {
    id: `shape_${Date.now()}_${Math.random()}`,
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 50,
    height: 50,
    rotation: 0,
    stroke: '#ff0000',
    strokeWidth: 2,
    ...overrides,
  };
}

// Wrapper that provides the EditorStoreContext
function createWrapper() {
  const store = createEditorStore();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      EditorStoreContext.Provider,
      { value: store },
      children
    );
  };
}

const defaultProps = {
  getCanvasPosition: (screenPos: { x: number; y: number }) => screenPos,
  containerSize: { width: 800, height: 600 },
  setSelectedTool: vi.fn(),
};

describe('useKeyboardShortcuts', () => {
  const mockSetSelectedIds = vi.fn();
  const mockOnShapesChange = vi.fn();
  const mockRecordAction = vi.fn((fn: () => void) => fn());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shift key tracking', () => {
    it('should track shift key state', () => {
      const { result } = renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: [],
          setSelectedIds: mockSetSelectedIds,
          shapes: [],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isShiftHeld).toBe(false);

      // Press Shift
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
      });

      expect(result.current.isShiftHeld).toBe(true);

      // Release Shift
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
      });

      expect(result.current.isShiftHeld).toBe(false);
    });
  });

  describe('delete shortcut', () => {
    it('should delete selected shapes on Delete key', () => {
      const shape1 = createTestShape({ id: 'shape1' });
      const shape2 = createTestShape({ id: 'shape2' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1, shape2],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
      });

      // Should filter out the selected shape
      expect(mockOnShapesChange).toHaveBeenCalledWith([shape2]);
      expect(mockSetSelectedIds).toHaveBeenCalledWith([]);
    });

    it('should delete selected shapes on Backspace key', () => {
      const shape1 = createTestShape({ id: 'shape1' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
      });

      expect(mockOnShapesChange).toHaveBeenCalledWith([]);
    });

    it('should not delete when no shapes are selected', () => {
      const shape1 = createTestShape({ id: 'shape1' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: [],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
      });

      expect(mockOnShapesChange).not.toHaveBeenCalled();
    });
  });

  describe('select all shortcut', () => {
    it('should select all shapes on Ctrl+A', () => {
      const shape1 = createTestShape({ id: 'shape1' });
      const shape2 = createTestShape({ id: 'shape2' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: [],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1, shape2],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
      });

      expect(mockSetSelectedIds).toHaveBeenCalledWith(['shape1', 'shape2']);
    });

    it('should not select all when no shapes exist', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: [],
          setSelectedIds: mockSetSelectedIds,
          shapes: [],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
      });

      expect(mockSetSelectedIds).not.toHaveBeenCalled();
    });
  });

  describe('duplicate shortcut', () => {
    it('should duplicate selected shapes on Ctrl+D', () => {
      const shape1 = createTestShape({ id: 'shape1', x: 100, y: 100 });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
      });

      // Should add duplicated shape with offset
      expect(mockOnShapesChange).toHaveBeenCalled();
      const newShapes = mockOnShapesChange.mock.calls[0][0];
      expect(newShapes).toHaveLength(2);
      expect(newShapes[1].x).toBe(120); // Original x + 20 offset
      expect(newShapes[1].y).toBe(120); // Original y + 20 offset
    });

    it('should not duplicate when no shapes are selected', () => {
      const shape1 = createTestShape({ id: 'shape1' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: [],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
      });

      expect(mockOnShapesChange).not.toHaveBeenCalled();
    });

    it('should duplicate multiple selected shapes', () => {
      const shape1 = createTestShape({ id: 'shape1', x: 50, y: 50 });
      const shape2 = createTestShape({ id: 'shape2', x: 150, y: 150 });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1', 'shape2'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1, shape2],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
      });

      const newShapes = mockOnShapesChange.mock.calls[0][0];
      expect(newShapes).toHaveLength(4); // 2 original + 2 duplicated
    });
  });

  describe('input focus handling', () => {
    it('should not handle shortcuts when focused on input', () => {
      const shape1 = createTestShape({ id: 'shape1' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      // Create an input element and focus it
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      // Create event with input as target
      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      window.dispatchEvent(event);

      // Should not delete because input is focused
      expect(mockOnShapesChange).not.toHaveBeenCalled();

      // Cleanup
      document.body.removeChild(input);
    });

    it('should not handle delete when focused on select controls', () => {
      const shape1 = createTestShape({ id: 'shape1' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      const select = document.createElement('select');
      document.body.appendChild(select);
      select.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: select });
      window.dispatchEvent(event);

      expect(mockOnShapesChange).not.toHaveBeenCalled();

      document.body.removeChild(select);
    });

    it('should not handle delete when focused on contenteditable text', () => {
      const shape1 = createTestShape({ id: 'shape1' });

      renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: ['shape1'],
          setSelectedIds: mockSetSelectedIds,
          shapes: [shape1],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      document.body.appendChild(editable);
      editable.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: editable });
      window.dispatchEvent(event);

      expect(mockOnShapesChange).not.toHaveBeenCalled();

      document.body.removeChild(editable);
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() =>
        useKeyboardShortcuts({
          selectedIds: [],
          setSelectedIds: mockSetSelectedIds,
          shapes: [],
          onShapesChange: mockOnShapesChange,
          recordAction: mockRecordAction,
          ...defaultProps,
        }),
        { wrapper: createWrapper() }
      );

      unmount();

      // Should remove all event listeners
      const keydownRemovals = removeEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'keydown'
      );
      const keyupRemovals = removeEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'keyup'
      );

      expect(keydownRemovals.length).toBeGreaterThan(0);
      expect(keyupRemovals.length).toBeGreaterThan(0);
    });
  });
});
