/**
 * useToolbarPositioning - Measures content and resizes window to fit.
 *
 * Measures the full container (including titlebar) for height,
 * and the content element for width. Uses ResizeObserver to track changes.
 */

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LAYOUT } from '@/constants';
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
  /** Keep the toolbar window hidden even after the selection is confirmed. */
  suppressWindowShow?: boolean;
  /** Whether the current window has enough context to be shown. */
  windowReadyToShow?: boolean;
}

export function useToolbarPositioning({
  containerRef,
  contentRef,
  selectionConfirmed,
  mode,
  suppressWindowShow = false,
  windowReadyToShow = Boolean(selectionConfirmed),
}: UseToolbarPositioningOptions): void {
  const windowShownRef = useRef(false);
  const lastSizeRef = useRef({ width: 0, height: 0 });

  const measureTargetSize = useCallback(() => {
    const isStartupToolbar = !selectionConfirmed && mode === 'selection';
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      return isStartupToolbar
        ? {
            width: LAYOUT.CAPTURE_TOOLBAR_STARTUP_WIDTH,
            height: LAYOUT.CAPTURE_TOOLBAR_STARTUP_HEIGHT,
          }
        : null;
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

      titlebarWidth = leftWidth + controlsWidth + horizontalChrome;
    }

    const measuredWidth = Math.max(contentRect.width, titlebarWidth);
    const measuredHeight = containerRect.height;

    if (isStartupToolbar) {
      // Startup size should be content-driven once the toolbar has mounted.
      // The constants remain as a fallback before refs are available.
      return {
        width: Math.max(measuredWidth, LAYOUT.CAPTURE_TOOLBAR_STARTUP_WIDTH),
        height:
          measuredHeight > 0
            ? measuredHeight
            : LAYOUT.CAPTURE_TOOLBAR_STARTUP_HEIGHT,
      };
    }

    return {
      width: measuredWidth,
      height: measuredHeight,
    };
  }, [containerRef, contentRef, mode, selectionConfirmed]);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const syncWindowVisibility = async () => {
      const currentWindow = getCurrentWebviewWindow();
      const isVisible = await currentWindow.isVisible().catch(() => windowShownRef.current);
      const shouldShowWindow = !suppressWindowShow && windowReadyToShow;

      if (suppressWindowShow) {
        if (isVisible) {
          await currentWindow.hide();
        }
        windowShownRef.current = false;
        return;
      }

      if (shouldShowWindow && !isVisible) {
        await currentWindow.show();
        await currentWindow.setFocus().catch(() => {});
        windowShownRef.current = true;
        return;
      }

      windowShownRef.current = isVisible;
    };

    const resizeWindow = async (width: number, height: number) => {
      try {
        if (width !== lastSizeRef.current.width || height !== lastSizeRef.current.height) {
          lastSizeRef.current = { width, height };

          const windowWidth = Math.ceil(width) + 1;
          const windowHeight = Math.ceil(height) + 1;

          await invoke('resize_capture_toolbar', {
            width: windowWidth,
            height: windowHeight,
          });
        }

        await syncWindowVisibility();
      } catch (e) {
        toolbarLogger.error('Failed to resize toolbar:', e);
      }
    };

    const initialSize = measureTargetSize();
    if (initialSize && initialSize.width > 0 && initialSize.height > 0) {
      void resizeWindow(initialSize.width, initialSize.height);
    }

    const observer = new ResizeObserver(() => {
      const measuredSize = measureTargetSize();
      if (measuredSize && measuredSize.width > 0 && measuredSize.height > 0) {
        void resizeWindow(measuredSize.width, measuredSize.height);
      }
    });

    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [
    containerRef,
    contentRef,
    measureTargetSize,
    selectionConfirmed,
    suppressWindowShow,
    windowReadyToShow,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      const measuredSize = measureTargetSize();
      if (measuredSize && measuredSize.width > 0 && measuredSize.height > 0) {
        lastSizeRef.current = { width: 0, height: 0 };
        const windowWidth = Math.ceil(measuredSize.width) + 1;
        const windowHeight = Math.ceil(measuredSize.height) + 1;
        invoke('resize_capture_toolbar', {
          width: windowWidth,
          height: windowHeight,
        }).catch((e) => toolbarLogger.error('Failed to resize toolbar:', e));
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [selectionConfirmed, mode, containerRef, contentRef, measureTargetSize]);
}
