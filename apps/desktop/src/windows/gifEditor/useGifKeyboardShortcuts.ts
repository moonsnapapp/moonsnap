import React, { useEffect } from 'react';
import type { FrameRow } from './types';

interface GifKeyboardShortcutsParams {
  closeRef: React.RefObject<(() => void) | null>;
  exportSelectedRef: React.RefObject<(() => void) | null>;
  deleteSelectedRef: React.RefObject<(() => void) | null>;
  seekToFrameRef: React.RefObject<((idx: number) => void) | null>;
  currentFrameIndexRef: React.RefObject<number>;
  rowsRef: React.RefObject<FrameRow[]>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

function isGifEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function runGifShortcut(e: KeyboardEvent, action: (() => void) | undefined): boolean {
  if (!action) return false;
  e.preventDefault();
  action();
  return true;
}

function handleGifModifiedShortcut(
  e: KeyboardEvent,
  closeRef: React.RefObject<(() => void) | null>,
  exportSelectedRef: React.RefObject<(() => void) | null>
) {
  if (!e.ctrlKey && !e.metaKey) return false;

  const key = e.key.toLowerCase();
  return runGifShortcut(e, getGifModifiedShortcutAction(key, e.shiftKey, closeRef, exportSelectedRef));
}

function getGifModifiedShortcutAction(
  key: string,
  shiftKey: boolean,
  closeRef: React.RefObject<(() => void) | null>,
  exportSelectedRef: React.RefObject<(() => void) | null>
): (() => void) | undefined {
  const actions: Record<string, (() => void) | undefined> = {
    w: () => closeRef.current?.(),
    e: shiftKey ? () => exportSelectedRef.current?.() : undefined,
  };

  return actions[key];
}

function handleGifNavigationShortcut(
  e: KeyboardEvent,
  params: Pick<
    GifKeyboardShortcutsParams,
    'deleteSelectedRef' | 'seekToFrameRef' | 'currentFrameIndexRef' | 'rowsRef' | 'setIsPlaying'
  >
) {
  const actions: Record<string, () => void> = {
    Delete: () => params.deleteSelectedRef.current?.(),
    Backspace: () => params.deleteSelectedRef.current?.(),
    ' ': () => params.setIsPlaying((isPlaying) => !isPlaying),
    ArrowLeft: () => {
      params.setIsPlaying(false);
      params.seekToFrameRef.current?.(Math.max(0, params.currentFrameIndexRef.current - 1));
    },
    ArrowRight: () => {
      params.setIsPlaying(false);
      params.seekToFrameRef.current?.(
        Math.min(params.rowsRef.current.length - 1, params.currentFrameIndexRef.current + 1)
      );
    },
    Home: () => {
      params.setIsPlaying(false);
      params.seekToFrameRef.current?.(0);
    },
    End: () => {
      params.setIsPlaying(false);
      params.seekToFrameRef.current?.(Math.max(0, params.rowsRef.current.length - 1));
    },
  };

  return runGifShortcut(e, actions[e.key] ?? (e.code === 'Space' ? actions[' '] : undefined));
}

function shouldCloseGifEditorFromKey(e: KeyboardEvent, isEditable: boolean): boolean {
  return !isEditable && e.key === 'Escape';
}

function closeGifEditorFromShortcut(closeRef: React.RefObject<(() => void) | null>): void {
  closeRef.current?.();
}

function handleGifKeyboardShortcut(
  e: KeyboardEvent,
  params: GifKeyboardShortcutsParams
): void {
  const isEditable = isGifEditableTarget(e.target);

  if (shouldCloseGifEditorFromKey(e, isEditable)) {
    closeGifEditorFromShortcut(params.closeRef);
    return;
  }
  if (handleGifModifiedShortcut(e, params.closeRef, params.exportSelectedRef)) return;
  if (isEditable) return;

  handleGifNavigationShortcut(e, params);
}

/**
 * Global keyboard shortcuts for the GIF editor: Esc / Ctrl+W to close,
 * Ctrl+Shift+E to export selection, Delete/Backspace to delete, Space to
 * toggle playback, and arrow/Home/End to scrub. All callbacks are read
 * through refs so the listener can register once and still see fresh state.
 */
export function useGifKeyboardShortcuts({
  closeRef,
  exportSelectedRef,
  deleteSelectedRef,
  seekToFrameRef,
  currentFrameIndexRef,
  rowsRef,
  setIsPlaying,
}: GifKeyboardShortcutsParams): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleGifKeyboardShortcut(e, {
        closeRef,
        exportSelectedRef,
        deleteSelectedRef,
        seekToFrameRef,
        currentFrameIndexRef,
        rowsRef,
        setIsPlaying,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    closeRef,
    exportSelectedRef,
    deleteSelectedRef,
    seekToFrameRef,
    currentFrameIndexRef,
    rowsRef,
    setIsPlaying,
  ]);
}
