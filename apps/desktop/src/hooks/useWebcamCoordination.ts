/**
 * useWebcamCoordination - Manages webcam preview window lifecycle.
 *
 * Handles:
 * - Loading webcam settings from Rust on mount
 * - Opening/closing webcam preview window
 * - Listening for webcam errors during recording
 */

import { useEffect, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { toast } from 'sonner';
import { useWebcamSettingsStore } from '../stores/webcamSettingsStore';
import { webcamLogger } from '../utils/logger';

interface WebcamErrorEvent {
  message: string;
  is_fatal: boolean;
}

interface UseWebcamCoordinationReturn {
  /** Close the webcam preview window */
  closeWebcamPreview: () => Promise<void>;
  /** Open webcam preview if enabled in settings */
  openWebcamPreviewIfEnabled: () => Promise<void>;
}

type PreviewOpenAction = 'reopen' | 'open' | 'none';
type PreviewOpenStateKey = `${boolean}:${boolean}`;

const PREVIEW_OPEN_ACTIONS: Record<PreviewOpenStateKey, PreviewOpenAction> = {
  'true:true': 'none',
  'true:false': 'reopen',
  'false:true': 'none',
  'false:false': 'open',
};

async function getWebcamPreviewWindowExists() {
  try {
    const existingWindow = await WebviewWindow.getByLabel('webcam-preview');
    if (!existingWindow) {
      webcamLogger.debug('Window not found by label');
      return false;
    }

    const isVisible = await existingWindow.isVisible();
    webcamLogger.debug('Window existence check', { windowExists: isVisible, isVisible });
    return isVisible;
  } catch (error) {
    webcamLogger.debug('Window check error (window likely destroyed)', error);
    return false;
  }
}

function getPreviewOpenAction(previewOpen: boolean, windowExists: boolean): PreviewOpenAction {
  return PREVIEW_OPEN_ACTIONS[getPreviewOpenStateKey(previewOpen, windowExists)];
}

function getPreviewOpenStateKey(
  previewOpen: boolean,
  windowExists: boolean
): PreviewOpenStateKey {
  return `${previewOpen}:${windowExists}`;
}

async function applyPreviewOpenAction(
  action: PreviewOpenAction,
  togglePreview: () => Promise<void>
) {
  if (action === 'reopen') {
    webcamLogger.debug('Preview state out of sync - resetting and reopening');
    useWebcamSettingsStore.setState({ previewOpen: false });
    await togglePreview();
    return;
  }

  if (action === 'open') {
    webcamLogger.debug('Opening preview (not open, window does not exist)');
    await togglePreview();
    return;
  }

  webcamLogger.debug('Preview already exists, nothing to do');
}

export function useWebcamCoordination(): UseWebcamCoordinationReturn {
  const { closePreview, togglePreview, settings, previewOpen } = useWebcamSettingsStore();

  // Load webcam settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      const { loadSettings } = useWebcamSettingsStore.getState();
      await loadSettings();
    };
    loadSettings();
  }, []);

  // Listen for webcam errors during recording
  useEffect(() => {
    let unlistenWebcamError: UnlistenFn | null = null;

    const setupWebcamErrorListener = async () => {
      unlistenWebcamError = await listen<WebcamErrorEvent>('webcam-error', (event) => {
        const { message, is_fatal } = event.payload;
        webcamLogger.error('Webcam error:', message, 'Fatal:', is_fatal);

        if (is_fatal) {
          toast.error('Webcam disconnected', {
            description: 'Webcam capture has stopped. Recording will continue without webcam.',
            duration: 5000,
          });
        } else {
          toast.warning('Webcam issue', {
            description: message,
            duration: 3000,
          });
        }
      });
    };

    setupWebcamErrorListener();
    return () => {
      unlistenWebcamError?.();
    };
  }, []);

  // Listen for when user closes the preview from the preview window controls
  // The Rust backend emits this event after hiding preview and disabling webcam in config
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen('webcam-disabled-from-preview', () => {
        webcamLogger.info('Webcam disabled from preview window - updating store');
        const currentState = useWebcamSettingsStore.getState();
        webcamLogger.info('Current store state before update:', currentState.settings.enabled);

        // Update store state directly - Rust already updated the config
        useWebcamSettingsStore.setState({
          settings: { ...currentState.settings, enabled: false },
          previewOpen: false,
        });

        const newState = useWebcamSettingsStore.getState();
        webcamLogger.info('Store state after update:', newState.settings.enabled);
      });
    };

    setup();
    return () => {
      unlisten?.();
    };
  }, []);

  const closeWebcamPreview = useCallback(async () => {
    await closePreview();
  }, [closePreview]);

  const openWebcamPreviewIfEnabled = useCallback(async () => {
    webcamLogger.debug('openWebcamPreviewIfEnabled called', { enabled: settings.enabled, previewOpen });

    // Only proceed if webcam is enabled in settings
    if (!settings.enabled) {
      webcamLogger.debug('Webcam not enabled, skipping');
      return;
    }

    const windowExists = await getWebcamPreviewWindowExists();
    await applyPreviewOpenAction(getPreviewOpenAction(previewOpen, windowExists), togglePreview);
  }, [settings.enabled, previewOpen, togglePreview]);

  return {
    closeWebcamPreview,
    openWebcamPreviewIfEnabled,
  };
}
