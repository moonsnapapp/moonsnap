/**
 * useToolbarPositioning - Measures content and resizes window to fit.
 *
 * Measures the full container (including titlebar) for height,
 * and the content element for width. Uses ResizeObserver to track changes.
 *
 * Robustness contract: the native window is created hidden at fallback bounds
 * and must never be revealed until a *real*, content-derived size has been
 * applied. Otherwise the window flashes at the fallback size and clips its
 * content (most visible in dev mode, where fonts/modules load late). We gate
 * every show on `onContentSized` firing, measure only after layout settles
 * (fonts ready + two frames), and keep safety fallbacks so the window can
 * never get stuck hidden.
 */

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LAYOUT } from '@/constants';
import { toolbarLogger } from '@/utils/logger';

/** Hard cap before we show anyway, so a missed measurement can't trap the window hidden. */
const SAFETY_SHOW_TIMEOUT_MS = 800;
/** Fallback remeasure if fonts.ready never resolves (defensive). */
const FALLBACK_REMEASURE_MS = 220;

interface MeasuredSize {
  width: number;
  height: number;
  /** True when the size came from actual rendered content, not the fallback constants. */
  fromContent: boolean;
}

interface MutableCurrent<T> {
  current: T;
}

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
  /**
   * Called once the first real (content-derived) size has been applied to the
   * native window. Consumers use this to gate their own show paths (e.g. the
   * Rust `bring_startup_toolbar_to_front` foreground dance) so the window is
   * only revealed once it fits its content.
   */
  onContentSized?: () => void;
}

function getStartupToolbarFallback(): MeasuredSize {
  return {
    width: LAYOUT.CAPTURE_TOOLBAR_STARTUP_WIDTH,
    height: LAYOUT.CAPTURE_TOOLBAR_STARTUP_HEIGHT,
    fromContent: false,
  };
}

function getElementWidth(element: Element | null): number {
  return element?.getBoundingClientRect().width ?? 0;
}

function getCssPixelValue(style: CSSStyleDeclaration, property: keyof CSSStyleDeclaration): number {
  const value = style[property];
  return typeof value === 'string' ? Number.parseFloat(value) || 0 : 0;
}

function getHorizontalChromeWidth(style: CSSStyleDeclaration): number {
  return (
    getCssPixelValue(style, 'paddingLeft') +
    getCssPixelValue(style, 'paddingRight') +
    getCssPixelValue(style, 'borderLeftWidth') +
    getCssPixelValue(style, 'borderRightWidth')
  );
}

function measureTitlebarWidth(container: HTMLDivElement): number {
  const titlebar = container.querySelector<HTMLElement>('.titlebar');
  if (!titlebar) return 0;

  const titlebarLeft = titlebar.querySelector<HTMLElement>('.titlebar-left');
  const titlebarControls = titlebar.querySelector<HTMLElement>('.titlebar-controls');
  const titlebarStyle = window.getComputedStyle(titlebar);

  return (
    getElementWidth(titlebarLeft) +
    getElementWidth(titlebarControls) +
    getHorizontalChromeWidth(titlebarStyle)
  );
}

function getMeasuredToolbarSize(
  container: HTMLDivElement,
  content: HTMLDivElement,
  isStartupToolbar: boolean
): MeasuredSize {
  const contentRect = content.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const measuredWidth = Math.max(contentRect.width, measureTitlebarWidth(container));
  const measuredHeight = containerRect.height;
  const fromContent = measuredWidth > 0 && measuredHeight > 0;

  if (!isStartupToolbar) {
    return { width: measuredWidth, height: measuredHeight, fromContent };
  }

  return {
    width: Math.max(measuredWidth, LAYOUT.CAPTURE_TOOLBAR_STARTUP_WIDTH),
    height:
      measuredHeight > 0
        ? measuredHeight
        : LAYOUT.CAPTURE_TOOLBAR_STARTUP_HEIGHT,
    fromContent,
  };
}

function hasPositiveMeasuredSize({ width, height }: MeasuredSize) {
  return width > 0 && height > 0;
}

function hasToolbarSizeChanged(
  measured: MeasuredSize,
  lastSize: { width: number; height: number }
) {
  return measured.width !== lastSize.width || measured.height !== lastSize.height;
}

function shouldApplyMeasuredSize(measured: MeasuredSize | null): measured is MeasuredSize {
  return measured !== null && hasPositiveMeasuredSize(measured);
}

async function resizeToolbarToMeasuredSize(
  measured: MeasuredSize,
  lastSizeRef: MutableCurrent<{ width: number; height: number }>
) {
  if (!hasPositiveMeasuredSize(measured) || !hasToolbarSizeChanged(measured, lastSizeRef.current)) {
    return;
  }

  const { width, height } = measured;
  lastSizeRef.current = { width, height };

  await invoke('resize_capture_toolbar', {
    width: Math.ceil(width) + 1,
    height: Math.ceil(height) + 1,
  });
}

function shouldNotifyFirstContentSize(
  measured: MeasuredSize,
  contentSizedRef: MutableCurrent<boolean>
) {
  return measured.fromContent && hasPositiveMeasuredSize(measured) && !contentSizedRef.current;
}

function notifyFirstContentSize(
  measured: MeasuredSize,
  contentSizedRef: MutableCurrent<boolean>,
  onContentSizedRef: MutableCurrent<(() => void) | undefined>
) {
  if (!shouldNotifyFirstContentSize(measured, contentSizedRef)) {
    return;
  }

  contentSizedRef.current = true;
  onContentSizedRef.current?.();
}

async function getToolbarWindowVisibility(
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>,
  windowShownRef: MutableCurrent<boolean>
) {
  return currentWindow.isVisible().catch(() => windowShownRef.current);
}

async function hideToolbarWindowIfVisible(
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>,
  isVisible: boolean,
  windowShownRef: MutableCurrent<boolean>
) {
  if (isVisible) {
    await currentWindow.hide();
  }
  windowShownRef.current = false;
}

function canRevealToolbarWindow(
  windowReadyToShow: boolean,
  contentSizedRef: MutableCurrent<boolean>,
  safetyShowRef: MutableCurrent<boolean>
) {
  return windowReadyToShow && (contentSizedRef.current || safetyShowRef.current);
}

async function showToolbarWindow(
  currentWindow: ReturnType<typeof getCurrentWebviewWindow>,
  windowShownRef: MutableCurrent<boolean>
) {
  await currentWindow.show();
  await currentWindow.setFocus().catch(() => {});
  windowShownRef.current = true;
}

function isStartupToolbarMode(selectionConfirmed: boolean | undefined, mode: string | undefined) {
  return !selectionConfirmed && mode === 'selection';
}

function getToolbarMeasurementTarget(
  containerRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>
) {
  const container = containerRef.current;
  const content = contentRef.current;

  return container && content ? { container, content } : null;
}

function getMissingToolbarTargetSize(isStartupToolbar: boolean): MeasuredSize | null {
  return isStartupToolbar ? getStartupToolbarFallback() : null;
}

export function useToolbarPositioning({
  containerRef,
  contentRef,
  selectionConfirmed,
  mode,
  suppressWindowShow = false,
  windowReadyToShow = Boolean(selectionConfirmed),
  onContentSized,
}: UseToolbarPositioningOptions): void {
  const windowShownRef = useRef(false);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  /** Set once a content-derived size has been applied; gates all show paths. */
  const contentSizedRef = useRef(false);
  /** Tripped by the safety timeout so a missed measurement can't trap the window hidden. */
  const safetyShowRef = useRef(false);
  /** Latest onContentSized callback, read without re-running the effect. */
  const onContentSizedRef = useRef(onContentSized);
  onContentSizedRef.current = onContentSized;

  const measureTargetSize = useCallback((): MeasuredSize | null => {
    const isStartupToolbar = isStartupToolbarMode(selectionConfirmed, mode);
    const target = getToolbarMeasurementTarget(containerRef, contentRef);

    return target
      ? getMeasuredToolbarSize(target.container, target.content, isStartupToolbar)
      : getMissingToolbarTargetSize(isStartupToolbar);
  }, [containerRef, contentRef, mode, selectionConfirmed]);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let cancelled = false;

    const syncWindowVisibility = async () => {
      const currentWindow = getCurrentWebviewWindow();
      const isVisible = await getToolbarWindowVisibility(currentWindow, windowShownRef);

      if (suppressWindowShow) {
        await hideToolbarWindowIfVisible(currentWindow, isVisible, windowShownRef);
        return;
      }

      // Never reveal the window until it has been sized to its content, so we
      // don't flash the fallback bounds and clip the toolbar. The safety timeout
      // overrides this if a measurement is somehow never produced.
      if (canRevealToolbarWindow(windowReadyToShow, contentSizedRef, safetyShowRef) && !isVisible) {
        await showToolbarWindow(currentWindow, windowShownRef);
        return;
      }

      windowShownRef.current = isVisible;
    };

    const applyMeasuredSize = async (measured: MeasuredSize) => {
      try {
        if (suppressWindowShow) {
          await syncWindowVisibility();
          return;
        }

        await resizeToolbarToMeasuredSize(measured, lastSizeRef);

        // Mark sized only once a real content measurement has been applied, then
        // notify consumers so their own show paths can finally reveal the window.
        notifyFirstContentSize(measured, contentSizedRef, onContentSizedRef);

        await syncWindowVisibility();
      } catch (e) {
        toolbarLogger.error('Failed to resize toolbar:', e);
      }
    };

    const remeasure = () => {
      if (cancelled) return;
      const measured = measureTargetSize();
      if (shouldApplyMeasuredSize(measured)) {
        void applyMeasuredSize(measured);
      }
    };

    // 1) Immediate measurement so we have *some* size as early as possible.
    remeasure();

    // 2) Track every layout change (content swap, font swap, async icons).
    const observer = new ResizeObserver(remeasure);
    observer.observe(container);
    observer.observe(content);

    // 3) Authoritative measurement once fonts have loaded and layout has settled.
    //    Text measured before web fonts load is narrower and would clip on reflow.
    const fontsReady: Promise<unknown> =
      'fonts' in document ? document.fonts.ready : Promise.resolve();
    void fontsReady.then(() => {
      if (cancelled) return;
      // Two frames lets the post-font reflow flush before we trust the metrics.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          lastSizeRef.current = { width: 0, height: 0 }; // force a re-send
          remeasure();
        });
      });
    });

    // 4) Fallback remeasure if fonts.ready never resolves for some reason.
    const fallbackRemeasure = window.setTimeout(() => {
      lastSizeRef.current = { width: 0, height: 0 };
      remeasure();
    }, FALLBACK_REMEASURE_MS);

    // 5) Last-resort show so a missed measurement can never trap the window hidden.
    const safetyShow = window.setTimeout(() => {
      if (cancelled || contentSizedRef.current) return;
      safetyShowRef.current = true;
      void syncWindowVisibility();
    }, SAFETY_SHOW_TIMEOUT_MS);

    // Keep visibility in sync when suppress/ready flags change without a resize.
    void syncWindowVisibility();

    return () => {
      cancelled = true;
      observer.disconnect();
      clearTimeout(fallbackRemeasure);
      clearTimeout(safetyShow);
    };
  }, [
    containerRef,
    contentRef,
    measureTargetSize,
    selectionConfirmed,
    suppressWindowShow,
    windowReadyToShow,
  ]);
}
