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
 * - S: Toggle cut mode
 * - Delete/Backspace: Delete selected segment (trim/zoom/scene/mask/text/annotation)
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
}

export function useVideoEditorShortcuts({
  enabled,
  onTogglePlayback,
  onSeekToStart,
  onSeekToEnd,
  onSkipBack,
  onSkipForward,
  onToggleCutMode,
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
}: UseVideoEditorShortcutsProps) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in an input
      if (isTextInputTarget(e.target)) return;

      const isMod = e.ctrlKey || e.metaKey;

      // Modifier shortcuts
      if (isMod) {
        switch (e.key) {
          case 's':
            e.preventDefault();
            onSave();
            return;
          case 'z':
          case 'Z':
            e.preventDefault();
            if (e.shiftKey) {
              onRedoTrim?.();
            } else {
              onUndoTrim?.();
            }
            return;
          case '-':
          case '_':
            e.preventDefault();
            onTimelineZoomOut();
            return;
          case '=':
          case '+':
            e.preventDefault();
            onTimelineZoomIn();
            return;
          case 'e':
            e.preventDefault();
            onExport();
            return;
        }
        return;
      }

      // Single key shortcuts (no modifiers)
      if (e.altKey) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          onTogglePlayback();
          break;
        case 'Home':
          e.preventDefault();
          onSeekToStart();
          break;
        case 'End':
          e.preventDefault();
          onSeekToEnd();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onSkipBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onSkipForward();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          onToggleCutMode();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          onDeleteSelected();
          break;
        case 'z':
        case 'Z':
          e.preventDefault();
          onFitTimeline?.();
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          onSetInPoint?.();
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          onSetOutPoint?.();
          break;
        case 'Escape':
          e.preventDefault();
          onDeselect();
          break;
      }
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
  ]);
}
