import { useState, useCallback, useEffect, useRef } from 'react';
import type { CanvasShape } from '../types';
import { shapeIntersectsRect } from '../utils/canvasGeometry';

interface UseMarqueeSelectionProps {
  shapes: CanvasShape[];
  setSelectedIds: (ids: string[]) => void;
}

interface UseMarqueeSelectionReturn {
  isMarqueeSelecting: boolean;
  marqueeStart: { x: number; y: number };
  marqueeEnd: { x: number; y: number };
  startMarquee: (pos: { x: number; y: number }) => void;
  updateMarquee: (pos: { x: number; y: number }) => void;
  finishMarquee: () => void;
  cancelMarquee: () => void;
}

/**
 * Hook for marquee (rectangular) selection of shapes
 * Allows selecting multiple shapes by dragging a selection rectangle
 */
export const useMarqueeSelection = ({
  shapes,
  setSelectedIds,
}: UseMarqueeSelectionProps): UseMarqueeSelectionReturn => {
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const isSelectingRef = useRef(false);
  const [marqueeStart, setMarqueeStart] = useState({ x: 0, y: 0 });
  const [marqueeEnd, setMarqueeEnd] = useState({ x: 0, y: 0 });

  // Start marquee selection
  const startMarquee = useCallback((pos: { x: number; y: number }) => {
    isSelectingRef.current = true;
    setIsMarqueeSelecting(true);
    setMarqueeStart(pos);
    setMarqueeEnd(pos);
  }, []);

  // Update marquee selection during drag
  const updateMarquee = useCallback((pos: { x: number; y: number }) => {
    if (!isSelectingRef.current) return;
    setMarqueeEnd(pos);
  }, []);

  // Finish marquee selection and select intersecting shapes
  const finishMarquee = useCallback(() => {
    if (!isSelectingRef.current) return;
    isSelectingRef.current = false;

    // Calculate marquee bounds (normalized for any drag direction)
    const marqueeBounds = {
      x: Math.min(marqueeStart.x, marqueeEnd.x),
      y: Math.min(marqueeStart.y, marqueeEnd.y),
      width: Math.abs(marqueeEnd.x - marqueeStart.x),
      height: Math.abs(marqueeEnd.y - marqueeStart.y),
    };

    // Find shapes that intersect with marquee (exclude background image)
    const selectedShapeIds = shapes
      .filter(shape => !shape.isBackground && shapeIntersectsRect(shape, marqueeBounds))
      .map(shape => shape.id);

    if (selectedShapeIds.length > 0) {
      setSelectedIds(selectedShapeIds);
    }

    setIsMarqueeSelecting(false);
  }, [marqueeStart, marqueeEnd, shapes, setSelectedIds]);

  // Cancel marquee without selecting
  const cancelMarquee = useCallback(() => {
    isSelectingRef.current = false;
    setIsMarqueeSelecting(false);
  }, []);

  // Global mouseup listener to finish marquee when mouse released outside canvas
  const finishMarqueeRef = useRef(finishMarquee);
  finishMarqueeRef.current = finishMarquee;

  useEffect(() => {
    if (!isMarqueeSelecting) return;

    const handleGlobalMouseUp = () => finishMarqueeRef.current();
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isMarqueeSelecting]);

  return {
    isMarqueeSelecting,
    marqueeStart,
    marqueeEnd,
    startMarquee,
    updateMarquee,
    finishMarquee,
    cancelMarquee,
  };
};
