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

function hasPendingDragDelta(dx: number, dy: number) {
  return dx !== 0 || dy !== 0;
}

function drainPendingDragDelta(drag: DragState) {
  const dx = drag.pendingDx;
  const dy = drag.pendingDy;
  drag.pendingDx = 0;
  drag.pendingDy = 0;
  return { dx, dy };
}

function finishPendingSelectionMove(drag: DragState, warning: string) {
  const { dx, dy } = drainPendingDragDelta(drag);
  if (!hasPendingDragDelta(dx, dy)) {
    return;
  }

  invokeSelectionMove(dx, dy, warning);
}

function cancelDragFrame(drag: DragState) {
  if (!drag.frameId) return;

  window.cancelAnimationFrame(drag.frameId);
  drag.frameId = 0;
}

function releasePointerCapture(event: React.PointerEvent<HTMLDivElement> | undefined) {
  if (!event) return;

  try {
    event.currentTarget.releasePointerCapture(event.pointerId);
  } catch {
    // Release is best-effort.
  }
}

function setPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is best-effort.
  }
}

function invokeSelectionMove(dx: number, dy: number, warning: string) {
  void invoke('capture_overlay_move_selection_by', { dx, dy }).catch((error) => {
    toolbarLogger.warn(warning, error);
  });
}

function shouldStopDrag(drag: DragState, event?: React.PointerEvent<HTMLDivElement>) {
  return drag.active && (!event || drag.pointerId === event.pointerId);
}

function isInteractiveDragTarget(target: EventTarget) {
  return target instanceof HTMLElement && Boolean(target.closest('button, input, label'));
}

function canStartSelectionDrag(
  event: React.PointerEvent<HTMLDivElement>,
  allowDragRef: React.RefObject<boolean>,
) {
  return allowDragRef.current && event.button === 0 && !isInteractiveDragTarget(event.target);
}

function startSelectionDrag(drag: DragState, event: React.PointerEvent<HTMLDivElement>) {
  drag.active = true;
  drag.pointerId = event.pointerId;
  drag.lastScreenX = event.screenX;
  drag.lastScreenY = event.screenY;
  drag.pendingDx = 0;
  drag.pendingDy = 0;
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

    const { dx, dy } = drainPendingDragDelta(drag);

    if (!drag.active || !hasPendingDragDelta(dx, dy)) {
      return;
    }

    invokeSelectionMove(dx, dy, 'Failed to move overlay selection from chooser:');
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
    if (!shouldStopDrag(drag, event)) {
      return;
    }

    releasePointerCapture(event);
    drag.active = false;
    drag.pointerId = -1;
    cancelDragFrame(drag);
    finishPendingSelectionMove(drag, 'Failed to finish moving overlay selection from chooser:');
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canStartSelectionDrag(event, allowDragRef)) {
      return;
    }

    event.preventDefault();
    setPointerCapture(event);
    startSelectionDrag(dragRef.current, event);
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

    if (!hasPendingDragDelta(dx, dy)) {
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
