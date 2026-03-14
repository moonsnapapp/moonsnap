import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

type MoonSnapChooserWindow = Window & {
  __MOONSNAP_RECORDING_MODE_CHOOSER_OWNER?: string;
  __MOONSNAP_RECORDING_MODE_CHOOSER_ALLOW_DRAG?: boolean;
};

/**
 * Reads initial owner/allowDrag context from the window global
 * and keeps it in sync via the 'recording-mode-chooser-context' event.
 */
export function useChooserContext() {
  const globals = window as MoonSnapChooserWindow;

  const ownerRef = useRef(globals.__MOONSNAP_RECORDING_MODE_CHOOSER_OWNER ?? 'capture-toolbar');
  const allowDragRef = useRef(globals.__MOONSNAP_RECORDING_MODE_CHOOSER_ALLOW_DRAG ?? false);

  useEffect(() => {
    const unlisten = listen<{ owner?: string; allowDrag?: boolean }>('recording-mode-chooser-context', (event) => {
      ownerRef.current = event.payload.owner ?? 'capture-toolbar';
      allowDragRef.current = event.payload.allowDrag ?? false;
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return { ownerRef, allowDragRef };
}
