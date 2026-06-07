import { useEffect } from 'react';
import { isTextInputTarget } from '../utils/keyboard';

/**
 * Keyboard shortcuts for the video editor.
 *
 * Single keys (no modifiers):
 * - Space: Toggle playback
 * - Home: Seek to start
 * - End: Seek to end
 * - ArrowLeft: Skip back 5 seconds
 * - ArrowRight: Skip forward 5 seconds
 *   If a timeline segment is selected, arrows are reserved for segment nudging.
 * - C: Toggle cut mode
 * - V: Select/normal mode
 * - Delete/Backspace: Delete selected item (annotations delete a shape or a whole segment based on current annotation context)
 * - Escape: Deselect all
 *
 * With modifiers:
 * - Ctrl+S: Save project
 * - Ctrl+Z: Undo trim operation
 * - Ctrl+Shift+Z: Redo trim operation
 * - Ctrl+-: Zoom out timeline
 * - Ctrl+=: Zoom in timeline
 * - Ctrl+E: Export
 * - Z: Fit timeline to window
 * - I: Set in point at playhead
 * - O: Set out point at playhead
 */

interface UseVideoEditorShortcutsProps {
  enabled: boolean;
  onTogglePlayback: () => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onToggleCutMode: () => void;
  onSelectMode: () => void;
  onDeleteSelected: () => void;
  onTimelineZoomIn: () => void;
  onTimelineZoomOut: () => void;
  onDeselect: () => void;
  onSave: () => void;
  onExport: () => void;
  onUndoTrim?: () => void;
  onRedoTrim?: () => void;
  onFitTimeline?: () => void;
  onSetInPoint?: () => void;
  onSetOutPoint?: () => void;
  disablePlaybackArrowShortcuts?: boolean;
}

type VideoEditorShortcutHandlers = Omit<UseVideoEditorShortcutsProps, 'enabled'>;
type ShortcutAction = (() => void) | undefined;

function runShortcutAction(e: KeyboardEvent, action: ShortcutAction): boolean {
  if (!action) return false;
  e.preventDefault();
  action();
  return true;
}

function getModifierShortcutAction(
  e: KeyboardEvent,
  handlers: VideoEditorShortcutHandlers
): ShortcutAction {
  if (e.key.toLowerCase() === 'z') {
    return e.shiftKey ? handlers.onRedoTrim : handlers.onUndoTrim;
  }

  const actions: Record<string, ShortcutAction> = {
    s: handlers.onSave,
    '-': handlers.onTimelineZoomOut,
    _: handlers.onTimelineZoomOut,
    '=': handlers.onTimelineZoomIn,
    '+': handlers.onTimelineZoomIn,
    e: handlers.onExport,
  };

  return actions[e.key.toLowerCase()];
}

function getSingleKeyShortcutAction(
  e: KeyboardEvent,
  handlers: VideoEditorShortcutHandlers
): ShortcutAction {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (
    handlers.disablePlaybackArrowShortcuts &&
    (key === 'ArrowLeft' || key === 'ArrowRight')
  ) {
    return undefined;
  }

  const actions: Record<string, ShortcutAction> = {
    ' ': handlers.onTogglePlayback,
    Home: handlers.onSeekToStart,
    End: handlers.onSeekToEnd,
    ArrowLeft: handlers.onSkipBack,
    ArrowRight: handlers.onSkipForward,
    c: handlers.onToggleCutMode,
    v: handlers.onSelectMode,
    Delete: handlers.onDeleteSelected,
    Backspace: handlers.onDeleteSelected,
    z: handlers.onFitTimeline,
    i: handlers.onSetInPoint,
    o: handlers.onSetOutPoint,
    Escape: handlers.onDeselect,
  };

  return actions[key];
}

export function useVideoEditorShortcuts({
  enabled,
  onTogglePlayback,
  onSeekToStart,
  onSeekToEnd,
  onSkipBack,
  onSkipForward,
  onToggleCutMode,
  onSelectMode,
  onDeleteSelected,
  onTimelineZoomIn,
  onTimelineZoomOut,
  onDeselect,
  onSave,
  onExport,
  onUndoTrim,
  onRedoTrim,
  onFitTimeline,
  onSetInPoint,
  onSetOutPoint,
  disablePlaybackArrowShortcuts = false,
}: UseVideoEditorShortcutsProps) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in an input
      if (isTextInputTarget(e.target)) return;

      const isMod = e.ctrlKey || e.metaKey;
      const handlers = {
        onTogglePlayback,
        onSeekToStart,
        onSeekToEnd,
        onSkipBack,
        onSkipForward,
        onToggleCutMode,
        onSelectMode,
        onDeleteSelected,
        onTimelineZoomIn,
        onTimelineZoomOut,
        onDeselect,
        onSave,
        onExport,
        onUndoTrim,
        onRedoTrim,
        onFitTimeline,
        onSetInPoint,
        onSetOutPoint,
        disablePlaybackArrowShortcuts,
      };

      if (isMod) {
        runShortcutAction(e, getModifierShortcutAction(e, handlers));
        return;
      }

      if (e.altKey) return;
      runShortcutAction(e, getSingleKeyShortcutAction(e, handlers));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    onTogglePlayback,
    onSeekToStart,
    onSeekToEnd,
    onSkipBack,
    onSkipForward,
    onToggleCutMode,
    onSelectMode,
    onDeleteSelected,
    onTimelineZoomIn,
    onTimelineZoomOut,
    onDeselect,
    onSave,
    onExport,
    onUndoTrim,
    onRedoTrim,
    onFitTimeline,
    onSetInPoint,
    onSetOutPoint,
    disablePlaybackArrowShortcuts,
  ]);
}
