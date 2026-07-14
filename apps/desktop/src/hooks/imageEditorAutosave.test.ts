import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '@/constants';
import { scheduleImageEditorAutosaveEnable } from './imageEditorAutosave';

describe('scheduleImageEditorAutosaveEnable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables autosave after the initial project load guard', () => {
    vi.useFakeTimers();
    const isInitialLoadRef = { current: true };

    scheduleImageEditorAutosaveEnable(isInitialLoadRef);
    vi.advanceTimersByTime(TIMING.IMAGE_EDITOR_INITIAL_LOAD_GUARD_MS - 1);
    expect(isInitialLoadRef.current).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isInitialLoadRef.current).toBe(false);
  });
});
