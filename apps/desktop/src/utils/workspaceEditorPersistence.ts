type WorkspaceEditorSave = () => Promise<void>;

let activeEditorSave: WorkspaceEditorSave | null = null;
let pendingFlush: Promise<void> | null = null;

export function registerWorkspaceEditorSave(save: WorkspaceEditorSave) {
  activeEditorSave = save;

  return () => {
    if (activeEditorSave === save) {
      activeEditorSave = null;
    }
  };
}

export async function flushWorkspaceEditorSave() {
  if (pendingFlush) {
    await pendingFlush;
    return;
  }

  const save = activeEditorSave;
  if (!save) return;

  pendingFlush = save();
  try {
    await pendingFlush;
  } finally {
    pendingFlush = null;
  }
}
