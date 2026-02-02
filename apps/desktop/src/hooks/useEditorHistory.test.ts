import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useEditorHistory } from './useEditorHistory';
import { EditorStoreContext } from '../stores/EditorStoreProvider';
import { createStore } from 'zustand';

// Mock store with history methods
function createMockEditorStore() {
  const mockTakeSnapshot = vi.fn();
  const mockCommitSnapshot = vi.fn();
  const mockDiscardSnapshot = vi.fn();

  const store = createStore(() => ({
    _takeSnapshot: mockTakeSnapshot,
    _commitSnapshot: mockCommitSnapshot,
    _discardSnapshot: mockDiscardSnapshot,
  }));

  return {
    store,
    mockTakeSnapshot,
    mockCommitSnapshot,
    mockDiscardSnapshot,
  };
}

// Wrapper component that provides the context
function createWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      EditorStoreContext.Provider,
      { value: store },
      children
    );
  };
}

describe('useEditorHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('context validation', () => {
    it('should throw error when used outside EditorStoreProvider', () => {
      // Suppress console.error for this test since we expect an error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useEditorHistory());
      }).toThrow('useEditorHistory must be used within an EditorStoreProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('takeSnapshot', () => {
    it('should call store._takeSnapshot', () => {
      const { store, mockTakeSnapshot } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result } = renderHook(() => useEditorHistory(), { wrapper });

      act(() => {
        result.current.takeSnapshot();
      });

      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should return stable function reference', () => {
      const { store } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result, rerender } = renderHook(() => useEditorHistory(), { wrapper });

      const firstRef = result.current.takeSnapshot;
      rerender();

      expect(result.current.takeSnapshot).toBe(firstRef);
    });
  });

  describe('commitSnapshot', () => {
    it('should call store._commitSnapshot', () => {
      const { store, mockCommitSnapshot } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result } = renderHook(() => useEditorHistory(), { wrapper });

      act(() => {
        result.current.commitSnapshot();
      });

      expect(mockCommitSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should return stable function reference', () => {
      const { store } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result, rerender } = renderHook(() => useEditorHistory(), { wrapper });

      const firstRef = result.current.commitSnapshot;
      rerender();

      expect(result.current.commitSnapshot).toBe(firstRef);
    });
  });

  describe('discardSnapshot', () => {
    it('should call store._discardSnapshot', () => {
      const { store, mockDiscardSnapshot } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result } = renderHook(() => useEditorHistory(), { wrapper });

      act(() => {
        result.current.discardSnapshot();
      });

      expect(mockDiscardSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should return stable function reference', () => {
      const { store } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result, rerender } = renderHook(() => useEditorHistory(), { wrapper });

      const firstRef = result.current.discardSnapshot;
      rerender();

      expect(result.current.discardSnapshot).toBe(firstRef);
    });
  });

  describe('recordAction', () => {
    it('should call takeSnapshot, action, then commitSnapshot in order', () => {
      const { store, mockTakeSnapshot, mockCommitSnapshot } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result } = renderHook(() => useEditorHistory(), { wrapper });

      const callOrder: string[] = [];
      mockTakeSnapshot.mockImplementation(() => callOrder.push('takeSnapshot'));
      mockCommitSnapshot.mockImplementation(() => callOrder.push('commitSnapshot'));

      const mockAction = vi.fn(() => callOrder.push('action'));

      act(() => {
        result.current.recordAction(mockAction);
      });

      expect(callOrder).toEqual(['takeSnapshot', 'action', 'commitSnapshot']);
      expect(mockAction).toHaveBeenCalledTimes(1);
    });

    it('should return stable function reference', () => {
      const { store } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result, rerender } = renderHook(() => useEditorHistory(), { wrapper });

      const firstRef = result.current.recordAction;
      rerender();

      expect(result.current.recordAction).toBe(firstRef);
    });
  });

  describe('typical workflows', () => {
    it('should support drag workflow: takeSnapshot -> ... -> commitSnapshot', () => {
      const { store, mockTakeSnapshot, mockCommitSnapshot, mockDiscardSnapshot } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result } = renderHook(() => useEditorHistory(), { wrapper });

      // Simulate drag start
      act(() => {
        result.current.takeSnapshot();
      });

      // Simulate some work happening...

      // Simulate drag end
      act(() => {
        result.current.commitSnapshot();
      });

      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
      expect(mockCommitSnapshot).toHaveBeenCalledTimes(1);
      expect(mockDiscardSnapshot).not.toHaveBeenCalled();
    });

    it('should support cancelled action workflow: takeSnapshot -> discardSnapshot', () => {
      const { store, mockTakeSnapshot, mockCommitSnapshot, mockDiscardSnapshot } = createMockEditorStore();
      const wrapper = createWrapper(store);

      const { result } = renderHook(() => useEditorHistory(), { wrapper });

      // Simulate action start
      act(() => {
        result.current.takeSnapshot();
      });

      // Simulate action cancelled (e.g., ESC key)
      act(() => {
        result.current.discardSnapshot();
      });

      expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
      expect(mockDiscardSnapshot).toHaveBeenCalledTimes(1);
      expect(mockCommitSnapshot).not.toHaveBeenCalled();
    });
  });
});
