/**
 * useToolbarPositioning - Measures content and resizes window to fit.
 *
 * Measures the full container (including titlebar) for height,
 * and the content element for width. Uses ResizeObserver to track changes.
 */

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { toolbarLogger } from '@/utils/logger';

interface UseToolbarPositioningOptions {
  /** Ref to the full container (app-container) for height measurement */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to the content element for width measurement */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Selection confirmed state - triggers remeasure when content swaps */
  selectionConfirmed?: boolean;
  /** Toolbar mode - triggers remeasure when mode changes (selection/recording/etc) */
  mode?: string;
  /** Called after the native window size has been updated */
  onWindowSized?: () => void | Promise<void>;
}

export function useToolbarPositioning({
  containerRef,
  contentRef,
  selectionConfirmed,
  mode,
  onWindowSized,
}: UseToolbarPositioningOptions): void {
  const windowShownRef = useRef(false);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const rafIdRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const measureTargetSize = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      return null;
    }

    const contentRect = content.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const titlebar = container.querySelector<HTMLElement>('.titlebar');
    let titlebarWidth = 0;

    if (titlebar) {
      const titlebarLeft = titlebar.querySelector<HTMLElement>('.titlebar-left');
      const titlebarControls = titlebar.querySelector<HTMLElement>('.titlebar-controls');
      const titlebarStyle = window.getComputedStyle(titlebar);

      const leftWidth = titlebarLeft?.getBoundingClientRect().width ?? 0;
      const controlsWidth = titlebarControls?.getBoundingClientRect().width ?? 0;
      const horizontalChrome =
        (Number.parseFloat(titlebarStyle.paddingLeft) || 0) +
        (Number.parseFloat(titlebarStyle.paddingRight) || 0) +
        (Number.parseFloat(titlebarStyle.borderLeftWidth) || 0) +
        (Number.parseFloat(titlebarStyle.borderRightWidth) || 0);

      // Intrinsic titlebar width is just left content + controls + horizontal chrome.
      // The center drag region is flex:1 and can collapse to zero.
      titlebarWidth = leftWidth + controlsWidth + horizontalChrome;
    }

    return {
      width: Math.max(contentRect.width, titlebarWidth),
      height: containerRect.height,
    };
  }, [containerRef, contentRef]);

  const resizeWindow = useCallback(async (width: number, height: number, force = false) => {
    if (!force && width === lastSizeRef.current.width && height === lastSizeRef.current.height) {
      return false;
    }
    lastSizeRef.current = { width, height };

    const windowWidth = Math.ceil(width) + 1;
    const windowHeight = Math.ceil(height) + 1;

    try {
      await invoke('resize_capture_toolbar', {
        width: windowWidth,
        height: windowHeight,
      });

      if (onWindowSized) {
        await onWindowSized();
      }

      const currentWindow = getCurrentWebviewWindow();
      const isVisible = await currentWindow.isVisible().catch(() => windowShownRef.current);
      if (!windowShownRef.current || !isVisible) {
        await currentWindow.show();
        windowShownRef.current = true;
      }

      return true;
    } catch (e) {
      toolbarLogger.error('Failed to resize toolbar:', e);
      return false;
    }
  }, [onWindowSized]);

  const clearScheduledMeasure = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleMeasure = useCallback((attempts = 4, force = false) => {
    clearScheduledMeasure();

    const runAttempt = (remainingAttempts: number) => {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;

        const measuredSize = measureTargetSize();
        const hasSize = Boolean(measuredSize && measuredSize.width > 0 && measuredSize.height > 0);

        if (measuredSize && hasSize) {
          void resizeWindow(measuredSize.width, measuredSize.height, force && remainingAttempts === attempts);
        }

        if (remainingAttempts > 1) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            runAttempt(remainingAttempts - 1);
          }, hasSize ? 140 : 50);
        }
      });
    };

    runAttempt(attempts);
  }, [clearScheduledMeasure, measureTargetSize, resizeWindow]);

  // Measure content and resize window
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    scheduleMeasure(5, true);

    const fonts = document.fonts;
    if (fonts?.ready) {
      void fonts.ready.then(() => {
        scheduleMeasure(3, true);
      });
    }

    // Watch for size changes on both elements
    const observer = new ResizeObserver(() => {
      scheduleMeasure(3);
    });

    observer.observe(container);
    observer.observe(content);
    return () => {
      observer.disconnect();
      clearScheduledMeasure();
    };
  }, [clearScheduledMeasure, containerRef, contentRef, scheduleMeasure]);

  // Force remeasure when selection state or mode changes (content swaps)
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    lastSizeRef.current = { width: 0, height: 0 };
    scheduleMeasure(5, true);

    return () => {
      clearScheduledMeasure();
    };
  }, [clearScheduledMeasure, containerRef, contentRef, mode, scheduleMeasure, selectionConfirmed]);
}
