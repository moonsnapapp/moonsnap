import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PanelResizeHandleProps } from 'react-resizable-panels';
import { ResizableHandle } from '@/components/ui/resizable';

interface SidebarToggleHandleProps
  extends Omit<PanelResizeHandleProps, 'onClick' | 'children'> {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}

/** Pixel tolerance for distinguishing a click from a drag. The library's own
 *  onClick has a zero-tolerance check (any pointermove cancels it), which
 *  drops real clicks that have a 1–2px wobble. */
const CLICK_PIXEL_TOLERANCE = 5;

/**
 * Resize handle that doubles as a sidebar collapse toggle.
 *
 * - Drag (movement > tolerance): normal panel resize.
 * - Click (movement ≤ tolerance): fires `onToggle`.
 *
 * Click detection lives on a transparent overlay inside the handle so we
 * can apply a tolerance — react-resizable-panels' built-in onClick rejects
 * any pointermove during the press, which drops real clicks.
 */
export const SidebarToggleHandle: React.FC<SidebarToggleHandleProps> = ({
  collapsed,
  onToggle,
  className,
  ...rest
}) => {
  const downRef = useRef<{ x: number; y: number; id: number } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    downRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = downRef.current;
    downRef.current = null;
    if (!start || start.id !== event.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx * dx + dy * dy > CLICK_PIXEL_TOLERANCE * CLICK_PIXEL_TOLERANCE) return;

    onToggle();
  };

  return (
    <ResizableHandle {...rest} className={className}>
      {/* Transparent overlay catches pointer events with our own movement
          tolerance. We use pointerdown/up (not mousedown/up) because the
          library calls event.preventDefault() in capture phase, which
          suppresses the synthesized mouse events. */}
      <div
        className="sidebar-toggle-handle__hit"
        onPointerDownCapture={handlePointerDown}
        onPointerUpCapture={handlePointerUp}
        aria-hidden="true"
      />
      <span className="sidebar-toggle-handle__chip" aria-hidden="true">
        {collapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </span>
    </ResizableHandle>
  );
};
