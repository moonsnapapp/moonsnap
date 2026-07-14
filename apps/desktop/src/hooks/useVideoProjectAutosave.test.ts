import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '@/constants';

const storeState = vi.hoisted(() => ({
  project: {},
  isExporting: false,
  isSaving: false,
}));

vi.mock('@/stores/videoEditorStore', () => ({
  useVideoEditorStore: {
    getState: () => storeState,
  },
}));

vi.mock('@/utils/logger', () => ({
  videoEditorLogger: {
    warn: vi.fn(),
  },
}));

import { useVideoProjectAutosave } from './useVideoProjectAutosave';

describe('useVideoProjectAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    storeState.project = {};
    storeState.isExporting = false;
    storeState.isSaving = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts the debounce when an edit replaces the project state', async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const lastUserActivityAtRef = createRef<number>();
    lastUserActivityAtRef.current = Date.now();
    let project: object = {};

    const { rerender } = renderHook(() =>
      useVideoProjectAutosave({
        project,
        isExporting: false,
        saveProject,
        lastUserActivityAtRef,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(TIMING.PROJECT_AUTOSAVE_DEBOUNCE_MS - 500);
    });

    project = {};
    lastUserActivityAtRef.current = Date.now();
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(TIMING.PROJECT_AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(saveProject).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(saveProject).toHaveBeenCalledTimes(1);
  });
});
