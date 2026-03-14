import React, { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { toolbarLogger } from '@/utils/logger';

interface DragState {
  active: boolean;
  pointerId: number;
  lastScreenX: number;
  lastScreenY: number;
  pendingDx: number;
  pendingDy: number;
  frameId: number;
}

interface DragHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * Handles pointer-drag gestures on the chooser window, forwarding
 * screen-space deltas to `capture_overlay_move_selection_by` via rAF batching.
 */
export function useDragToMoveSelection(
  allowDragRef: React.RefObject<boolean>,
): DragHandlers {
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: -1,
    lastScreenX: 0,
    lastScreenY: 0,
    pendingDx: 0,
    pendingDy: 0,
    frameId: 0,
  });

  const flushDragDelta = useCallback(() => {
    const drag = dragRef.current;
    drag.frameId = 0;

    const dx = drag.pendingDx;
    const dy = drag.pendingDy;
    drag.pendingDx = 0;
    drag.pendingDy = 0;

    if (!drag.active || (dx === 0 && dy === 0)) {
      return;
    }

    void invoke('capture_overlay_move_selection_by', { dx, dy }).catch((error) => {
      toolbarLogger.warn('Failed to move overlay selection from chooser:', error);
    });
  }, []);

  const scheduleDragFlush = useCallback(() => {
    const drag = dragRef.current;
    if (drag.frameId) {
      return;
    }
    drag.frameId = window.requestAnimationFrame(flushDragDelta);
  }, [flushDragDelta]);

  const stopDrag = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || (event && drag.pointerId !== event.pointerId)) {
      return;
    }

    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Release is best-effort.
      }
    }

    drag.active = false;
    drag.pointerId = -1;

    if (drag.frameId) {
      window.cancelAnimationFrame(drag.frameId);
      drag.frameId = 0;
    }

    const dx = drag.pendingDx;
    const dy = drag.pendingDy;
    drag.pendingDx = 0;
    drag.pendingDy = 0;

    if (dx === 0 && dy === 0) {
      return;
    }

    void invoke('capture_overlay_move_selection_by', { dx, dy }).catch((error) => {
      toolbarLogger.warn('Failed to finish moving overlay selection from chooser:', error);
    });
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!allowDragRef.current) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('button, input, label')) {
      return;
    }

    event.preventDefault();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }

    const drag = dragRef.current;
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.lastScreenX = event.screenX;
    drag.lastScreenY = event.screenY;
    drag.pendingDx = 0;
    drag.pendingDy = 0;
  }, [allowDragRef]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.screenX - drag.lastScreenX;
    const dy = event.screenY - drag.lastScreenY;
    drag.lastScreenX = event.screenX;
    drag.lastScreenY = event.screenY;

    if (dx === 0 && dy === 0) {
      return;
    }

    drag.pendingDx += dx;
    drag.pendingDy += dy;
    scheduleDragFlush();
  }, [scheduleDragFlush]);

  // Clean up any pending rAF on unmount.
  useEffect(() => {
    const drag = dragRef.current;
    return () => {
      if (drag.frameId) {
        window.cancelAnimationFrame(drag.frameId);
        drag.frameId = 0;
      }
    };
  }, []);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: stopDrag,
    onPointerCancel: stopDrag,
  };
}
