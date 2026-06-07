import type { BaseShapeProps } from '../../../types';
import { useShapeCursor } from '../../../hooks/useShapeCursor';

export function useShapeNodeProps({
  shape,
  isDraggable,
  onClick,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
}: BaseShapeProps) {
  const cursorHandlers = useShapeCursor(isDraggable);

  return {
    id: shape.id,
    draggable: isDraggable,
    onClick,
    onTap: onSelect,
    onDragStart,
    onDragEnd,
    onTransformStart,
    onTransformEnd,
    ...cursorHandlers,
  };
}
