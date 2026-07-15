import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  useFocusedShortcutDispatch,
  type FocusedShortcutBinding,
} from './useFocusedShortcutDispatch';
import {
  clearInvokeResponses,
  mockInvoke,
  setInvokeResponse,
} from '@/test/mocks/tauri';

const RECORDING_SHORTCUTS: readonly FocusedShortcutBinding[] = [
  { id: 'pause_or_resume_recording', currentShortcut: 'F9' },
  { id: 'stop_recording', currentShortcut: 'F10' },
  { id: 'discard_recording', currentShortcut: 'Ctrl+F10' },
];

describe('useFocusedShortcutDispatch', () => {
  beforeEach(() => {
    clearInvokeResponses();
    mockInvoke.mockClear();
    setInvokeResponse('dispatch_global_shortcut', null);
  });

  it('dispatches additional recording shortcuts while the window is focused', () => {
    renderHook(() => useFocusedShortcutDispatch(RECORDING_SHORTCUTS));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', ctrlKey: true }));

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'dispatch_global_shortcut', {
      id: 'pause_or_resume_recording',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'dispatch_global_shortcut', {
      id: 'discard_recording',
    });
  });

  it('ignores repeated focused shortcut events', () => {
    renderHook(() => useFocusedShortcutDispatch(RECORDING_SHORTCUTS));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', repeat: true }));

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
