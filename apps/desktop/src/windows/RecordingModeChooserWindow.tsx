import React, { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import { RecordingModeChooser } from '@/components/CaptureToolbar/RecordingModeChooser';
import { useFocusedShortcutDispatch } from '@/hooks/useFocusedShortcutDispatch';
import { useTheme } from '@/hooks/useTheme';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';
import { toolbarLogger } from '@/utils/logger';

const RecordingModeChooserWindow: React.FC = () => {
  useTheme();
  useFocusedShortcutDispatch();

  const containerRef = useRef<HTMLDivElement>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const closeHandledRef = useRef(false);
  const dragStateRef = useRef({
    active: false,
    pointerId: -1,
    lastScreenX: 0,
    lastScreenY: 0,
    pendingDx: 0,
    pendingDy: 0,
    frameId: 0 as number | 0,
  });
  const ownerRef = useRef(
    (
      window as Window & {
        __MOONSNAP_RECORDING_MODE_CHOOSER_OWNER?: string;
      }
    ).__MOONSNAP_RECORDING_MODE_CHOOSER_OWNER ?? 'capture-toolbar'
  );

  useEffect(() => {
    const unlisten = listen<{ owner?: string }>('recording-mode-chooser-context', (event) => {
      ownerRef.current = event.payload.owner ?? 'capture-toolbar';
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resizeWindow = async () => {
      const rect = container.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);

      if (
        width === 0 ||
        height === 0 ||
        (width === lastSizeRef.current.width && height === lastSizeRef.current.height)
      ) {
        return;
      }

      lastSizeRef.current = { width, height };

      try {
        await getCurrentWindow().setSize(new LogicalSize(width, height));
      } catch (error) {
        toolbarLogger.error('Failed to resize recording mode chooser window:', error);
      }
    };

    void resizeWindow();

    const observer = new ResizeObserver(() => {
      void resizeWindow();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  const closeWindow = useCallback(async () => {
    await getCurrentWindow().close().catch((error) => {
      toolbarLogger.error('Failed to close recording mode chooser window:', error);
    });
  }, []);

  const getWindowPositionPayload = useCallback(async () => {
    try {
      const position = await getCurrentWindow().outerPosition();
      return {
        x: position.x,
        y: position.y,
      };
    } catch (error) {
      toolbarLogger.warn('Failed to read recording mode chooser window position:', error);
      return { x: 0, y: 0 };
    }
  }, []);

  const handleBack = useCallback(async () => {
    closeHandledRef.current = true;
    await emit('recording-mode-chooser-back', {
      ...(await getWindowPositionPayload()),
      owner: ownerRef.current,
    });
    await closeWindow();
  }, [closeWindow, getWindowPositionPayload]);

  const handleSelect = useCallback(async (action: AfterRecordingAction, remember: boolean) => {
    closeHandledRef.current = true;
    await emit('recording-mode-selected', {
      ...(await getWindowPositionPayload()),
      action,
      remember,
      owner: ownerRef.current,
    });
    await closeWindow();
  }, [closeWindow, getWindowPositionPayload]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(async () => {
      if (closeHandledRef.current) {
        return;
      }

      closeHandledRef.current = true;
      await emit('recording-mode-chooser-back', {
        ...(await getWindowPositionPayload()),
        owner: ownerRef.current,
      }).catch((error) => {
        toolbarLogger.error('Failed to emit chooser back event on close:', error);
      });
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [getWindowPositionPayload]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) {
        return;
      }

      event.preventDefault();
      void handleBack();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  const flushDragDelta = useCallback(() => {
    const drag = dragStateRef.current;
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
    const drag = dragStateRef.current;
    if (drag.frameId) {
      return;
    }

    drag.frameId = window.requestAnimationFrame(flushDragDelta);
  }, [flushDragDelta]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
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

    dragStateRef.current.active = true;
    dragStateRef.current.pointerId = event.pointerId;
    dragStateRef.current.lastScreenX = event.screenX;
    dragStateRef.current.lastScreenY = event.screenY;
    dragStateRef.current.pendingDx = 0;
    dragStateRef.current.pendingDy = 0;
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
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

  const stopPointerDrag = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
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

  useEffect(() => {
    const dragState = dragStateRef.current;
    return () => {
      if (dragState.frameId) {
        window.cancelAnimationFrame(dragState.frameId);
        dragState.frameId = 0;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="recording-mode-chooser-shell"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPointerDrag}
      onPointerCancel={stopPointerDrag}
    >
      <RecordingModeChooser
        onSelect={(action, remember) => {
          void handleSelect(action, remember);
        }}
        onBack={() => {
          void handleBack();
        }}
        minimalChrome="floating"
      />
    </div>
  );
};

export default RecordingModeChooserWindow;
