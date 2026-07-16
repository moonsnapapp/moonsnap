import { useEffect } from 'react';
import { computeDPRCappedFitScale } from '../../../utils/compositionBounds';
import type { Size } from './sceneTypes';

export function getOptimisticWrapperScale({
  previewArea,
  compositeSize,
  lastPreviewArea,
}: {
  previewArea: HTMLDivElement;
  compositeSize: Size;
  lastPreviewArea: Size;
}) {
  if (!canUseOptimisticWrapperScale(compositeSize, lastPreviewArea)) {
    return null;
  }

  const oldFit = getPreviewFitScale(lastPreviewArea, compositeSize);
  const newFit = getPreviewFitScale(getElementSize(previewArea), compositeSize);

  return getFitScaleRatio(oldFit, newFit);
}

function canUseOptimisticWrapperScale(compositeSize: Size, lastPreviewArea: Size) {
  return compositeSize.width > 0 && lastPreviewArea.width > 0 && lastPreviewArea.height > 0;
}

function getElementSize(element: HTMLElement): Size {
  return { width: element.clientWidth, height: element.clientHeight };
}

export function getPreviewFitScale(previewArea: Size, compositeSize: Size) {
  return computeDPRCappedFitScale(
    previewArea.width,
    previewArea.height,
    compositeSize.width,
    compositeSize.height
  );
}

function getFitScaleRatio(oldFit: number, newFit: number) {
  return oldFit > 0 ? newFit / oldFit : null;
}

export function usePreviewResizeTracking({
  containerRef,
  previewAreaRef,
  compositionWrapperRef,
  compositeRef,
  lastPreviewAreaRef,
  setContainerSize,
  setPreviewAreaSize,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  previewAreaRef: React.RefObject<HTMLDivElement | null>;
  compositionWrapperRef: React.RefObject<HTMLDivElement | null>;
  compositeRef: React.MutableRefObject<Size>;
  lastPreviewAreaRef: React.MutableRefObject<Size>;
  setContainerSize: React.Dispatch<React.SetStateAction<Size>>;
  setPreviewAreaSize: React.Dispatch<React.SetStateAction<Size>>;
}) {
  useEffect(() => {
    const container = containerRef.current;
    const previewArea = previewAreaRef.current;
    if (!container || !previewArea) return;

    const THROTTLE_MS = 100;
    let rafId: number | null = null;
    let trailingId: ReturnType<typeof setTimeout> | null = null;
    let lastFlushTime = 0;

    const flush = () => {
      rafId = null;
      lastFlushTime = performance.now();
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const pw = previewArea.clientWidth;
      const ph = previewArea.clientHeight;
      setContainerSize((prev) =>
        prev.width === cw && prev.height === ch ? prev : { width: cw, height: ch }
      );
      setPreviewAreaSize((prev) =>
        prev.width === pw && prev.height === ph ? prev : { width: pw, height: ph }
      );
    };

    const applyOptimisticWrapperScale = () => {
      const wrapper = compositionWrapperRef.current;
      const comp = compositeRef.current;
      const last = lastPreviewAreaRef.current;
      if (!wrapper) return;

      const scale = getOptimisticWrapperScale({
        previewArea,
        compositeSize: comp,
        lastPreviewArea: last,
      });
      if (scale !== null) {
        wrapper.style.transform = `scale(${scale})`;
      }
    };

    const requestResizeFlush = () => {
      const elapsed = performance.now() - lastFlushTime;
      if (elapsed >= THROTTLE_MS) {
        rafId = requestAnimationFrame(flush);
        return;
      }

      trailingId = setTimeout(() => {
        trailingId = null;
        rafId = requestAnimationFrame(flush);
      }, THROTTLE_MS - elapsed);
    };

    const schedule = () => {
      if (rafId !== null || trailingId !== null) return;

      applyOptimisticWrapperScale();
      requestResizeFlush();
    };

    flush();

    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(previewArea);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (trailingId !== null) clearTimeout(trailingId);
      observer.disconnect();
    };
  }, [
    compositeRef,
    compositionWrapperRef,
    containerRef,
    lastPreviewAreaRef,
    previewAreaRef,
    setContainerSize,
    setPreviewAreaSize,
  ]);
}
