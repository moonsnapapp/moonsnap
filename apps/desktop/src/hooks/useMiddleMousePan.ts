import { useState, useCallback, useEffect, useRef } from 'react';
import Konva from 'konva';

interface UseMiddleMousePanProps {
  position: { x: number; y: number };
  setPosition: (pos: { x: number; y: number }) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  stageRef: React.RefObject<Konva.Stage | null>;
  compositorBgRef?: React.RefObject<HTMLDivElement | null>;
  // Refs for syncing with zoom - both use same baseline for CSS transforms
  renderedPositionRef?: React.RefObject<{ x: number; y: number }>;
  renderedZoomRef?: React.RefObject<number>;
  transformCoeffsRef?: React.RefObject<{ kx: number; ky: number }>;
  /** When true, left-click also pans (for the move/hand tool) */
  leftClickPan?: boolean;
}

interface UseMiddleMousePanReturn {
  isPanning: boolean;
  handleMiddleMouseDown: (e: React.MouseEvent) => void;
  handleMiddleMouseMove: (e: React.MouseEvent) => void;
  handleMiddleMouseUp: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface CompositorPanSyncRefs {
  compositorBgRef?: React.RefObject<HTMLDivElement | null>;
  renderedPositionRef?: React.RefObject<Point>;
  renderedZoomRef?: React.RefObject<number>;
  transformCoeffsRef?: React.RefObject<{ kx: number; ky: number }>;
}

function getPanDelta(e: React.MouseEvent, panStart: Point): Point {
  return {
    x: e.clientX - panStart.x,
    y: e.clientY - panStart.y,
  };
}

function getPannedPosition(positionStart: Point, delta: Point): Point {
  return {
    x: positionStart.x + delta.x,
    y: positionStart.y + delta.y,
  };
}

function moveStage(stage: Konva.Stage | null, position: Point): void {
  if (!stage) return;

  stage.position(position);
  stage.batchDraw();
}

function canSyncCompositorPan({
  compositorBgRef,
  renderedPositionRef,
  renderedZoomRef,
  transformCoeffsRef,
}: CompositorPanSyncRefs): boolean {
  return hasCurrentRef(compositorBgRef) &&
    hasRef(renderedPositionRef) &&
    hasRef(renderedZoomRef) &&
    hasRef(transformCoeffsRef);
}

function hasRef<T>(ref: React.RefObject<T> | undefined): ref is React.RefObject<T> {
  return ref !== undefined;
}

function hasCurrentRef<T>(ref: React.RefObject<T | null> | undefined): ref is React.RefObject<T> {
  return ref?.current != null;
}

function syncCompositorPanWithZoom(
  refs: Required<CompositorPanSyncRefs>,
  newPosition: Point,
  currentZoom: number
): void {
  const compositorBg = refs.compositorBgRef.current;
  if (!compositorBg) return;

  const renderedPos = refs.renderedPositionRef.current;
  const renderedZoom = refs.renderedZoomRef.current;
  const { kx, ky } = refs.transformCoeffsRef.current;

  const compositorDx = (newPosition.x - renderedPos.x) + kx * (currentZoom - renderedZoom);
  const compositorDy = (newPosition.y - renderedPos.y) + ky * (currentZoom - renderedZoom);
  const scaleRatio = currentZoom / renderedZoom;

  compositorBg.style.transformOrigin = '0 0';
  compositorBg.style.transform =
    `translate(${compositorDx}px, ${compositorDy}px) scale(${scaleRatio})`;
}

function syncCompositorPanFallback(
  compositorBgRef: React.RefObject<HTMLDivElement | null> | undefined,
  delta: Point
): void {
  if (compositorBgRef?.current) {
    compositorBgRef.current.style.transform = `translate(${delta.x}px, ${delta.y}px)`;
  }
}

function syncCompositorPan(
  refs: CompositorPanSyncRefs,
  newPosition: Point,
  delta: Point,
  currentZoom: number
): void {
  if (canSyncCompositorPan(refs)) {
    syncCompositorPanWithZoom(refs as Required<CompositorPanSyncRefs>, newPosition, currentZoom);
    return;
  }

  syncCompositorPanFallback(refs.compositorBgRef, delta);
}

function resetCompositorPanTransform(
  compositorBgRef: React.RefObject<HTMLDivElement | null> | undefined
): void {
  if (compositorBgRef?.current) {
    compositorBgRef.current.style.transform = '';
  }
}

function getStagePosition(stage: Konva.Stage | null): Point | null {
  return stage ? { x: stage.x(), y: stage.y() } : null;
}

function commitStagePanPosition(
  stageRef: React.RefObject<Konva.Stage | null>,
  setPosition: (pos: Point) => void
): void {
  const stagePosition = getStagePosition(stageRef.current);
  if (stagePosition) {
    setPosition(stagePosition);
  }
}

function finishMiddleMousePan({
  compositorBgRef,
  stageRef,
  setPosition,
}: {
  compositorBgRef?: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<Konva.Stage | null>;
  setPosition: (pos: Point) => void;
}) {
  resetCompositorPanTransform(compositorBgRef);
  commitStagePanPosition(stageRef, setPosition);
}

/**
 * Hook for middle mouse button panning in the editor canvas
 * Allows users to pan the canvas view by holding middle mouse button and dragging
 * Updates Konva Stage directly during pan for smooth performance
 */
export const useMiddleMousePan = ({
  position,
  setPosition,
  containerRef,
  stageRef,
  compositorBgRef,
  renderedPositionRef,
  renderedZoomRef,
  transformCoeffsRef,
  leftClickPan = false,
}: UseMiddleMousePanProps): UseMiddleMousePanReturn => {
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const positionStartRef = useRef(position);

  // Update position start ref when position changes while not panning
  useEffect(() => {
    if (!isPanning) {
      positionStartRef.current = position;
    }
  }, [position, isPanning]);

  const handleMiddleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (leftClickPan && e.button === 0)) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
      positionStartRef.current = position;
    }
  }, [position, leftClickPan]);

  const handleMiddleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;

    const delta = getPanDelta(e, panStartRef.current);
    const newPosition = getPannedPosition(positionStartRef.current, delta);

    // Update Konva Stage directly (no React re-render)
    const stage = stageRef.current;
    moveStage(stage, newPosition);

    // Update compositor background div using same baseline as zoom handler
    // This ensures pan + zoom together don't conflict
    syncCompositorPan(
      { compositorBgRef, renderedPositionRef, renderedZoomRef, transformCoeffsRef },
      newPosition,
      delta,
      stage?.scaleX() ?? 1
    );
  }, [isPanning, stageRef, compositorBgRef, renderedPositionRef, renderedZoomRef, transformCoeffsRef]);

  const handleMiddleMouseUp = useCallback(() => {
    if (isPanning) {
      finishMiddleMousePan({ compositorBgRef, stageRef, setPosition });
    }
    setIsPanning(false);
  }, [isPanning, stageRef, compositorBgRef, setPosition]);

  // Prevent default middle-click auto-scroll behavior
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventMiddleClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    container.addEventListener('mousedown', preventMiddleClick);
    container.addEventListener('auxclick', preventMiddleClick);

    return () => {
      container.removeEventListener('mousedown', preventMiddleClick);
      container.removeEventListener('auxclick', preventMiddleClick);
    };
  }, [containerRef]);

  return {
    isPanning,
    handleMiddleMouseDown,
    handleMiddleMouseMove,
    handleMiddleMouseUp,
  };
};
