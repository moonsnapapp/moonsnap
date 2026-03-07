/**
 * Capture Actions Hook
 *
 * React hook wrapper around CaptureService for use in components.
 * Provides capture triggering with integrated store updates and UI feedback.
 */

import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CaptureService } from '../services/captureService';
import type { FastCaptureResult } from '../types';

export function useCaptureActions() {
  /**
   * Open the capture toolbar using the last-used mode and source.
   */
  const openCaptureToolbar = useCallback(async () => {
    await invoke('show_startup_toolbar');
  }, []);

  /**
   * Trigger region capture overlay for screenshot.
   */
  const triggerNewCapture = useCallback(async () => {
    await CaptureService.showScreenshotOverlay();
  }, []);

  /**
   * Capture fullscreen of primary monitor and open in editor.
   */
  const triggerFullscreenCapture = useCallback(async () => {
    const result = await invoke<FastCaptureResult>('capture_fullscreen_fast');
    await invoke('open_editor_fast', {
      filePath: result.file_path,
      width: result.width,
      height: result.height,
    });
  }, []);

  /**
   * Capture all monitors combined into a single image.
   */
  const triggerAllMonitorsCapture = useCallback(async () => {
    await CaptureService.captureAllMonitorsToEditor();
  }, []);

  /**
   * Open the capture toolbar in Video mode.
   */
  const triggerVideoCapture = useCallback(async () => {
    await invoke('show_startup_toolbar', { captureType: 'video' });
  }, []);

  /**
   * Open the capture toolbar in GIF mode.
   */
  const triggerGifCapture = useCallback(async () => {
    await invoke('show_startup_toolbar', { captureType: 'gif' });
  }, []);

  return {
    openCaptureToolbar,
    triggerNewCapture,
    triggerFullscreenCapture,
    triggerAllMonitorsCapture,
    triggerVideoCapture,
    triggerGifCapture,
  };
}
