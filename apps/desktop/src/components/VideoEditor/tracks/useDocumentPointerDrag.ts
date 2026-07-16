import { useCallback, useEffect, useRef } from 'react';

interface DocumentPointerDragOptions {
  pointerId: number;
  captureTarget: HTMLElement;
  onMove: (event: PointerEvent) => void;
  onCommit: (event: PointerEvent) => void;
  onCancel: () => void;
}

type DragCleanup = () => void;

function releasePointerCapture(target: HTMLElement, pointerId: number) {
  try {
    if (
      typeof target.releasePointerCapture === 'function' &&
      (typeof target.hasPointerCapture !== 'function' || target.hasPointerCapture(pointerId))
    ) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // Capture may already have been released by the browser.
  }
}

export function useDocumentPointerDrag() {
  const cleanupRef = useRef<DragCleanup | null>(null);

  const cancelActiveDrag = useCallback(() => {
    cleanupRef.current?.();
  }, []);

  useEffect(() => cancelActiveDrag, [cancelActiveDrag]);

  return useCallback(
    ({ pointerId, captureTarget, onMove, onCommit, onCancel }: DocumentPointerDragOptions) => {
      cancelActiveDrag();

      let active = true;

      const removeListeners = () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerCancel);
        captureTarget.removeEventListener('lostpointercapture', handleLostPointerCapture);
      };

      const finish = (commit: boolean, event?: PointerEvent) => {
        if (!active) return;
        active = false;
        removeListeners();
        cleanupRef.current = null;
        releasePointerCapture(captureTarget, pointerId);
        if (commit && event) {
          onCommit(event);
        } else {
          onCancel();
        }
      };

      function handlePointerMove(event: PointerEvent) {
        if (active && event.pointerId === pointerId) {
          onMove(event);
        }
      }

      function handlePointerUp(event: PointerEvent) {
        if (event.pointerId === pointerId) {
          finish(true, event);
        }
      }

      function handlePointerCancel(event: PointerEvent) {
        if (event.pointerId === pointerId) {
          finish(false);
        }
      }

      function handleLostPointerCapture() {
        finish(false);
      }

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerCancel);
      captureTarget.addEventListener('lostpointercapture', handleLostPointerCapture);

      const cleanup = () => finish(false);
      cleanupRef.current = cleanup;
      return cleanup;
    },
    [cancelActiveDrag]
  );
}
