import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useVideoEditorShortcuts } from './useVideoEditorShortcuts';

const defaultHandlers = () => ({
  onTogglePlayback: vi.fn(),
  onSeekToStart: vi.fn(),
  onSeekToEnd: vi.fn(),
  onSkipBack: vi.fn(),
  onSkipForward: vi.fn(),
  onToggleCutMode: vi.fn(),
  onSelectMode: vi.fn(),
  onDeleteSelected: vi.fn(),
  onTimelineZoomIn: vi.fn(),
  onTimelineZoomOut: vi.fn(),
  onDeselect: vi.fn(),
  onSave: vi.fn(),
  onExport: vi.fn(),
});

describe('useVideoEditorShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles cut mode with C', () => {
    const handlers = defaultHandlers();

    renderHook(() =>
      useVideoEditorShortcuts({
        enabled: true,
        ...handlers,
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    });

    expect(handlers.onToggleCutMode).toHaveBeenCalledTimes(1);
  });

  it('keeps C as a toggle shortcut', () => {
    const handlers = defaultHandlers();

    renderHook(() =>
      useVideoEditorShortcuts({
        enabled: true,
        ...handlers,
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    });

    expect(handlers.onToggleCutMode).toHaveBeenCalledTimes(2);
  });

  it('switches to select mode with V', () => {
    const handlers = defaultHandlers();

    renderHook(() =>
      useVideoEditorShortcuts({
        enabled: true,
        ...handlers,
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });

    expect(handlers.onSelectMode).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleCutMode).not.toHaveBeenCalled();
  });

  it('does not toggle cut mode with S', () => {
    const handlers = defaultHandlers();

    renderHook(() =>
      useVideoEditorShortcuts({
        enabled: true,
        ...handlers,
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });

    expect(handlers.onToggleCutMode).not.toHaveBeenCalled();
  });
});
