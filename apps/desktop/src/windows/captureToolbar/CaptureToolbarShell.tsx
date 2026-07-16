import type React from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { motion, useReducedMotion } from 'motion/react';

import { CaptureToolbar } from '../../components/CaptureToolbar/CaptureToolbar';
import {
  TOOLBAR_SHELL_ANIMATE,
  TOOLBAR_SHELL_INITIAL,
  TOOLBAR_SHELL_REDUCED_TRANSITION,
  TOOLBAR_SHELL_TRANSITION,
  getToolbarChromeStyle,
} from './toolbarPolicy';

interface CaptureToolbarShellProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
  toolbarProps: React.ComponentProps<typeof CaptureToolbar>;
}

export function CaptureToolbarShell({
  containerRef,
  contentRef,
  hidden,
  toolbarProps,
}: CaptureToolbarShellProps) {
  const shouldReduceMotion = useReducedMotion();

  const handleMouseDown = async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button, input, textarea, select, [role="button"], [data-no-window-drag], [contenteditable="true"]',
      )
    ) {
      return;
    }

    try {
      await getCurrentWebviewWindow().startDragging();
    } catch {
      // Dragging is best-effort only.
    }
  };

  return (
    <div ref={containerRef} className="app-container">
      <div aria-hidden={hidden} style={getToolbarChromeStyle(hidden)}>
        <div className="toolbar-container">
          <motion.div
            className="toolbar-animated-wrapper capture-toolbar-shell"
            initial={shouldReduceMotion ? false : TOOLBAR_SHELL_INITIAL}
            animate={hidden && !shouldReduceMotion ? TOOLBAR_SHELL_INITIAL : TOOLBAR_SHELL_ANIMATE}
            transition={
              shouldReduceMotion ? TOOLBAR_SHELL_REDUCED_TRANSITION : TOOLBAR_SHELL_TRANSITION
            }
            onMouseDown={handleMouseDown}
          >
            <div ref={contentRef} className="toolbar-content-measure">
              <CaptureToolbar {...toolbarProps} />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
