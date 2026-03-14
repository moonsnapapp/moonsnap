import React, { useCallback, useEffect, useRef } from 'react';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { RecordingModeChooser } from '@/components/CaptureToolbar/RecordingModeChooser';
import { useAutoResizeWindow } from '@/hooks/useAutoResizeWindow';
import { useChooserContext } from '@/hooks/useChooserContext';
import { useDragToMoveSelection } from '@/hooks/useDragToMoveSelection';
import { useFocusedShortcutDispatch } from '@/hooks/useFocusedShortcutDispatch';
import { useTheme } from '@/hooks/useTheme';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';
import { toolbarLogger } from '@/utils/logger';

const RecordingModeChooserWindow: React.FC = () => {
  useTheme();
  useFocusedShortcutDispatch();

  const containerRef = useRef<HTMLDivElement>(null);
  const closeHandledRef = useRef(false);
  const { ownerRef, allowDragRef } = useChooserContext();

  useAutoResizeWindow(containerRef);
  const dragHandlers = useDragToMoveSelection(allowDragRef);

  const getWindowPositionPayload = useCallback(async () => {
    try {
      const position = await getCurrentWindow().outerPosition();
      return { x: position.x, y: position.y };
    } catch (error) {
      toolbarLogger.warn('Failed to read recording mode chooser window position:', error);
      return { x: 0, y: 0 };
    }
  }, []);

  const closeWindow = useCallback(async () => {
    await getCurrentWindow().close().catch((error) => {
      toolbarLogger.error('Failed to close recording mode chooser window:', error);
    });
  }, []);

  const emitBack = useCallback(async () => {
    closeHandledRef.current = true;
    await emit('recording-mode-chooser-back', {
      ...(await getWindowPositionPayload()),
      owner: ownerRef.current,
    });
    await closeWindow();
  }, [closeWindow, getWindowPositionPayload, ownerRef]);

  const handleSelect = useCallback(async (action: AfterRecordingAction, remember: boolean) => {
    closeHandledRef.current = true;
    await emit('recording-mode-selected', {
      ...(await getWindowPositionPayload()),
      action,
      remember,
      owner: ownerRef.current,
    });
    await closeWindow();
  }, [closeWindow, getWindowPositionPayload, ownerRef]);

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
  }, [getWindowPositionPayload, ownerRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) {
        return;
      }

      event.preventDefault();
      void emitBack();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [emitBack]);

  return (
    <div
      ref={containerRef}
      className="recording-mode-chooser-shell"
      {...dragHandlers}
    >
      <RecordingModeChooser
        onSelect={(action, remember) => {
          void handleSelect(action, remember);
        }}
        onBack={() => {
          void emitBack();
        }}
        minimalChrome="floating"
      />
    </div>
  );
};

export default RecordingModeChooserWindow;
