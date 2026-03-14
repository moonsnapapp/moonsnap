import React, { useCallback, useEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

import { RecordingModeChooser } from '@/components/CaptureToolbar/RecordingModeChooser';
import { useTheme } from '@/hooks/useTheme';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';
import { toolbarLogger } from '@/utils/logger';

const RecordingModeChooserWindow: React.FC = () => {
  useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const closeHandledRef = useRef(false);
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

  const handleMouseDown = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Dragging is best-effort only.
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="recording-mode-chooser-shell"
      onMouseDown={handleMouseDown}
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
