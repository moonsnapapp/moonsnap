import { useEffect, useRef } from 'react';
import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';

import { toolbarLogger } from '@/utils/logger';
import { getCenteredResizePosition } from '@/windows/recordingModeChooserPosition';

/**
 * Observes a container element and resizes the Tauri window to match,
 * keeping the window centered around its previous midpoint.
 */
export function useAutoResizeWindow(containerRef: React.RefObject<HTMLDivElement | null>) {
  const lastSizeRef = useRef({ width: 0, height: 0 });

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
        const currentWindow = getCurrentWindow();
        const nextLogicalSize = new LogicalSize(width, height);
        const [scaleFactor, previousPosition, previousSize] = await Promise.all([
          currentWindow.scaleFactor(),
          currentWindow.outerPosition(),
          currentWindow.outerSize(),
        ]);
        const nextPhysicalSize = nextLogicalSize.toPhysical(scaleFactor);

        await currentWindow.setSize(nextLogicalSize);

        if (
          previousSize.width !== nextPhysicalSize.width ||
          previousSize.height !== nextPhysicalSize.height
        ) {
          const nextPosition = getCenteredResizePosition(
            previousPosition,
            previousSize,
            nextPhysicalSize,
          );
          await currentWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
        }
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
  }, [containerRef]);
}
