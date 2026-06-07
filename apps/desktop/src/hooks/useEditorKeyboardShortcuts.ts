import { useEffect, useState } from 'react';
import type { Tool } from '../types';
import { isTextInputTarget } from '../utils/keyboard';

/**
 * Tool shortcuts mapping (single keys, no modifiers)
 */
const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  c: 'crop',
  a: 'arrow',
  l: 'line',
  r: 'rect',
  e: 'circle',
  t: 'text',
  h: 'highlight',
  b: 'blur',
  s: 'steps',
  p: 'pen',
};

interface UseEditorKeyboardShortcutsProps {
  view: 'library' | 'editor' | 'videoEditor';
  selectedTool: Tool;
  selectedIds: string[];
  compositorEnabled: boolean;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onCopy: () => void;
  onToggleCompositor: () => void;
  onShowShortcuts: () => void;
  onDeselect: () => void;
  onFitToCenter: () => void;
  onCropCommit: () => void;
  onCropReset: () => void;
}

interface UseEditorKeyboardShortcutsReturn {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

type EditorShortcutHandlers = Omit<
  UseEditorKeyboardShortcutsProps,
  'view' | 'selectedIds' | 'compositorEnabled'
>;

function runEditorShortcut(e: KeyboardEvent, action: (() => void) | undefined): boolean {
  if (!action) return false;
  e.preventDefault();
  action();
  return true;
}

function hasCommandModifier(e: KeyboardEvent) {
  return e.ctrlKey || e.metaKey;
}

function hasToolShortcutModifier(e: KeyboardEvent) {
  return e.ctrlKey || e.metaKey || e.altKey;
}

function getModifierShortcutAction(
  e: KeyboardEvent,
  handlers: Pick<EditorShortcutHandlers, 'onUndo' | 'onRedo' | 'onSave' | 'onCopy'>
) {
  const key = e.key.toLowerCase();
  const actions: Record<string, () => void> = {
    z: e.shiftKey ? handlers.onRedo : handlers.onUndo,
    y: handlers.onRedo,
    e: handlers.onSave,
    c: handlers.onCopy,
  };
  return actions[key];
}

function handleModifierShortcut(
  e: KeyboardEvent,
  handlers: Pick<EditorShortcutHandlers, 'onUndo' | 'onRedo' | 'onSave' | 'onCopy'>
) {
  return hasCommandModifier(e) && runEditorShortcut(e, getModifierShortcutAction(e, handlers));
}

function getCropShortcutAction(
  e: KeyboardEvent,
  handlers: Pick<EditorShortcutHandlers, 'onCropCommit' | 'onCropReset'>
) {
  const actions: Record<string, () => void> = {
    ' ': handlers.onCropCommit,
    enter: handlers.onCropCommit,
    r: handlers.onCropReset,
  };
  return actions[e.key.toLowerCase()];
}

function handleCropShortcut(
  e: KeyboardEvent,
  selectedTool: Tool,
  handlers: Pick<EditorShortcutHandlers, 'onCropCommit' | 'onCropReset'>
) {
  if (selectedTool !== 'crop') return false;
  return runEditorShortcut(e, getCropShortcutAction(e, handlers));
}

function handleBackgroundShortcut(
  e: KeyboardEvent,
  selectedTool: Tool,
  handlers: Pick<EditorShortcutHandlers, 'onToolChange' | 'onToggleCompositor'>
) {
  if (e.key.toLowerCase() !== 'g') return false;

  e.preventDefault();
  if (e.shiftKey) {
    handlers.onToggleCompositor();
    return true;
  }

  if (selectedTool === 'background') {
    handlers.onToggleCompositor();
    handlers.onToolChange('select');
  } else {
    handlers.onToolChange('background');
  }
  return true;
}

function handleToolShortcut(
  e: KeyboardEvent,
  selectedTool: Tool,
  handlers: Pick<EditorShortcutHandlers, 'onToolChange' | 'onToggleCompositor'>
) {
  if (hasToolShortcutModifier(e)) return false;

  const key = e.key.toLowerCase();
  const tool = TOOL_SHORTCUTS[key];
  return tool
    ? runEditorShortcut(e, () => handlers.onToolChange(tool))
    : handleBackgroundShortcut(e, selectedTool, handlers);
}

function handleEscapeShortcut(
  e: KeyboardEvent,
  selectedTool: Tool,
  selectedIds: string[],
  handlers: Pick<EditorShortcutHandlers, 'onDeselect' | 'onToolChange'>
) {
  if (e.key !== 'Escape') return false;

  e.preventDefault();
  if (selectedIds.length > 0) {
    handlers.onDeselect();
    return true;
  }

  if (selectedTool !== 'select') {
    handlers.onToolChange('select');
  }
  return true;
}

function isHelpShortcut(e: KeyboardEvent) {
  return e.key === '?' || (e.shiftKey && e.key === '/');
}

function handleGeneralShortcut(
  e: KeyboardEvent,
  selectedTool: Tool,
  selectedIds: string[],
  handlers: Pick<
    EditorShortcutHandlers,
    'onFitToCenter' | 'onDeselect' | 'onToolChange' | 'onShowShortcuts'
  >
) {
  const key = e.key.toLowerCase();
  if (key === 'f') {
    return runEditorShortcut(e, handlers.onFitToCenter);
  }

  if (handleEscapeShortcut(e, selectedTool, selectedIds, handlers)) {
    return true;
  }

  if (isHelpShortcut(e)) {
    return runEditorShortcut(e, handlers.onShowShortcuts);
  }

  return false;
}

function canHandleEditorShortcut(
  view: UseEditorKeyboardShortcutsProps['view'],
  target: EventTarget | null
) {
  return view === 'editor' && !isTextInputTarget(target);
}

function handleEditorShortcut(
  e: KeyboardEvent,
  props: UseEditorKeyboardShortcutsProps
) {
  if (!canHandleEditorShortcut(props.view, e.target)) return;

  [
    () => handleModifierShortcut(e, props),
    () => handleCropShortcut(e, props.selectedTool, props),
    () => handleToolShortcut(e, props.selectedTool, props),
    () => handleGeneralShortcut(e, props.selectedTool, props.selectedIds, props),
  ].some((handleShortcut) => handleShortcut());
}

/**
 * Hook for editor keyboard shortcuts.
 * Consolidates all keyboard handling from App.tsx:
 * - Command palette (Ctrl+K) - works in all views
 * - Tool shortcuts (V, C, A, L, R, E, T, H, B, S, P, G) - editor only
 * - Undo/Redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) - editor only
 * - Escape handling (deselect → select tool) - editor only
 * - Fit to center (F) - editor only
 * - Help modal (?) - editor only
 * - Save (Ctrl+E) and Copy (Ctrl+C) - editor only
 */
export const useEditorKeyboardShortcuts = ({
  view,
  selectedTool,
  selectedIds,
  compositorEnabled,
  onToolChange,
  onUndo,
  onRedo,
  onSave,
  onCopy,
  onToggleCompositor,
  onShowShortcuts,
  onDeselect,
  onFitToCenter,
  onCropCommit,
  onCropReset,
}: UseEditorKeyboardShortcutsProps): UseEditorKeyboardShortcutsReturn => {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Command palette shortcut (Ctrl+K / Cmd+K) - works in all views
  useEffect(() => {
    const handleCommandPalette = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleCommandPalette);
    return () => window.removeEventListener('keydown', handleCommandPalette);
  }, []);

  // Editor-only shortcuts: tools, undo/redo, escape, help
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      handleEditorShortcut(e, {
        view,
        selectedTool,
        selectedIds,
        compositorEnabled,
        onToolChange,
        onUndo,
        onRedo,
        onSave,
        onCopy,
        onToggleCompositor,
        onShowShortcuts,
        onFitToCenter,
        onDeselect,
        onCropCommit,
        onCropReset,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    view,
    selectedTool,
    selectedIds,
    compositorEnabled,
    onToolChange,
    onUndo,
    onRedo,
    onSave,
    onCopy,
    onToggleCompositor,
    onShowShortcuts,
    onDeselect,
    onFitToCenter,
    onCropCommit,
    onCropReset,
  ]);

  return {
    commandPaletteOpen,
    setCommandPaletteOpen,
  };
};
