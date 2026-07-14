import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushWorkspaceEditorSave,
  registerWorkspaceEditorSave,
} from './workspaceEditorPersistence';

describe('workspaceEditorPersistence', () => {
  let unregister: (() => void) | null = null;

  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it('flushes the active editor before a workspace item switch', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    unregister = registerWorkspaceEditorSave(save);

    await flushWorkspaceEditorSave();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not let an older editor unregister the current editor saver', async () => {
    const oldSave = vi.fn().mockResolvedValue(undefined);
    const currentSave = vi.fn().mockResolvedValue(undefined);
    const unregisterOld = registerWorkspaceEditorSave(oldSave);
    unregister = registerWorkspaceEditorSave(currentSave);

    unregisterOld();
    await flushWorkspaceEditorSave();

    expect(oldSave).not.toHaveBeenCalled();
    expect(currentSave).toHaveBeenCalledTimes(1);
  });
});
