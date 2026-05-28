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
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (!isEditable && e.key === 'Escape') {
        closeRef.current?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        closeRef.current?.();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'e' || e.key === 'E')
      ) {
        e.preventDefault();
        exportSelectedRef.current?.();
        return;
      }
      if (isEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedRef.current?.();
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(Math.max(0, currentFrameIndexRef.current - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(
          Math.min(rowsRef.current.length - 1, currentFrameIndexRef.current + 1),
        );
      } else if (e.key === 'Home') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setIsPlaying(false);
        seekToFrameRef.current?.(Math.max(0, rowsRef.current.length - 1));
      }
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
