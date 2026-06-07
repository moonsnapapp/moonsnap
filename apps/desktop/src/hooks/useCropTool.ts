import { useState, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { CanvasShape } from '../types';
import type { EditorHistoryActions } from './useEditorHistory';

interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasBounds {
  width: number;
  height: number;
  imageOffsetX: number;
  imageOffsetY: number;
}

interface ImageSize {
  width: number;
  height: number;
}

interface CropEdges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number; // x for vertical, y for horizontal
  label?: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
}

interface UseCropToolProps {
  canvasBounds: CanvasBounds | null;
  setCropRegion: (region: { x: number; y: number; width: number; height: number } | null) => void;
  cropRegion: { x: number; y: number; width: number; height: number } | null;
  isShiftHeld: boolean;
  zoom: number;
  /** Background shape (used for snap targets) */
  backgroundShape: CanvasShape | undefined;
  originalImageSize: ImageSize | null;
  /** Context-aware history actions for undo/redo support */
  history: EditorHistoryActions;
  /** Mark crop as manually expanded (prevents auto-shrink) */
  setCropUserExpanded: (expanded: boolean) => void;
}

interface UseCropToolReturn {
  cropPreview: CropBounds | null;
  cropDragStart: { x: number; y: number } | null;
  cropLockedAxis: 'x' | 'y' | null;
  snapGuides: SnapGuide[];
  setCropPreview: (preview: CropBounds | null) => void;
  getDisplayBounds: () => CropBounds;
  getBaseBounds: () => CropBounds;
  handleCenterDragStart: (x: number, y: number) => void;
  handleCenterDragMove: (x: number, y: number) => { x: number; y: number };
  handleCenterDragEnd: (x: number, y: number) => void;
  handleEdgeDragStart: (handleId: string) => void;
  handleEdgeDragMove: (handleId: string, nodeX: number, nodeY: number) => void;
  handleEdgeDragEnd: (handleId: string, nodeX: number, nodeY: number) => void;
  handleCornerDragStart: (handleId: string) => void;
  handleCornerDragMove: (handleId: string, nodeX: number, nodeY: number) => void;
  handleCornerDragEnd: (handleId: string, nodeX: number, nodeY: number) => void;
  commitBounds: (preview: CropBounds) => void;
}

const HANDLE_THICKNESS = 6;
const MIN_CROP_SIZE = 50;
const SNAP_THRESHOLD = 8; // pixels threshold for snap detection
type SnapEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
type SnapAxis = 'x' | 'y';
type SnapLabel = NonNullable<SnapGuide['label']>;
type SnapTarget = { position: number; label: SnapLabel };
type CropAxis = 'x' | 'y';

const SNAP_HANDLE_EDGES: Record<string, readonly SnapEdge[]> = {
  l: ['left'],
  r: ['right'],
  t: ['top'],
  b: ['bottom'],
  tl: ['left', 'top'],
  tr: ['right', 'top'],
  bl: ['left', 'bottom'],
  br: ['right', 'bottom'],
  center: ['center'],
};

const EDGE_HANDLE_DRAGGERS: Record<
  string,
  (edges: CropEdges, nodeX: number, nodeY: number, halfHandle: number) => CropEdges
> = {
  t: (edges, _nodeX, nodeY, halfHandle) => ({ ...edges, top: nodeY + halfHandle }),
  b: (edges, _nodeX, nodeY, halfHandle) => ({ ...edges, bottom: nodeY + halfHandle }),
  l: (edges, nodeX, _nodeY, halfHandle) => ({ ...edges, left: nodeX + halfHandle }),
  r: (edges, nodeX, _nodeY, halfHandle) => ({ ...edges, right: nodeX + halfHandle }),
};

const CORNER_HANDLE_EDGE_UPDATES: Array<{
  token: string;
  edge: keyof CropEdges;
  getValue: (nodeX: number, nodeY: number) => number;
}> = [
  { token: 'l', edge: 'left', getValue: (nodeX) => nodeX },
  { token: 'r', edge: 'right', getValue: (nodeX) => nodeX },
  { token: 't', edge: 'top', getValue: (_nodeX, nodeY) => nodeY },
  { token: 'b', edge: 'bottom', getValue: (_nodeX, nodeY) => nodeY },
];

function getCropEdges(bounds: CropBounds): CropEdges {
  return {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
  };
}

function getCropBoundsFromEdges({ left, top, right, bottom }: CropEdges): CropBounds {
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function applyHandleDrag(
  edges: CropEdges,
  handleId: string,
  nodeX: number,
  nodeY: number,
  halfHandle: number
): CropEdges {
  const dragEdge = EDGE_HANDLE_DRAGGERS[handleId];
  if (dragEdge) {
    return dragEdge(edges, nodeX, nodeY, halfHandle);
  }

  const next = { ...edges };
  for (const update of CORNER_HANDLE_EDGE_UPDATES) {
    if (handleId.includes(update.token)) {
      next[update.edge] = update.getValue(nodeX, nodeY);
    }
  }
  return next;
}

function enforceMinimumHorizontalCropSize(edges: CropEdges, handleId: string): void {
  if (edges.right - edges.left >= MIN_CROP_SIZE) {
    return;
  }

  if (handleId.includes('l')) {
    edges.left = edges.right - MIN_CROP_SIZE;
    return;
  }

  edges.right = edges.left + MIN_CROP_SIZE;
}

function enforceMinimumVerticalCropSize(edges: CropEdges, handleId: string): void {
  if (edges.bottom - edges.top >= MIN_CROP_SIZE) {
    return;
  }

  if (handleId.includes('t')) {
    edges.top = edges.bottom - MIN_CROP_SIZE;
    return;
  }

  edges.bottom = edges.top + MIN_CROP_SIZE;
}

function enforceMinimumCropSize(edges: CropEdges, handleId: string): CropEdges {
  const next = { ...edges };

  enforceMinimumHorizontalCropSize(next, handleId);
  enforceMinimumVerticalCropSize(next, handleId);

  return next;
}

function findNearestSnap(value: number, targets: SnapTarget[]): number | null {
  const target = targets.find((entry) => Math.abs(value - entry.position) < SNAP_THRESHOLD);
  return target?.position ?? null;
}

function getSnapTargets(snapSize: CropBounds) {
  const left = snapSize.x;
  const right = snapSize.x + snapSize.width;
  const top = snapSize.y;
  const bottom = snapSize.y + snapSize.height;
  const centerX = snapSize.x + snapSize.width / 2;
  const centerY = snapSize.y + snapSize.height / 2;

  return {
    x: [
      { position: left, label: 'left' },
      { position: centerX, label: 'centerX' },
      { position: right, label: 'right' },
    ] satisfies SnapTarget[],
    y: [
      { position: top, label: 'top' },
      { position: centerY, label: 'centerY' },
      { position: bottom, label: 'bottom' },
    ] satisfies SnapTarget[],
  };
}

function snapLeadingEdge(
  result: CropBounds,
  axis: SnapAxis,
  edgeValue: number,
  targets: SnapTarget[]
) {
  const snapped = findNearestSnap(edgeValue, targets);
  if (snapped === null) return;

  if (axis === 'x') {
    result.width += result.x - snapped;
    result.x = snapped;
  } else {
    result.height += result.y - snapped;
    result.y = snapped;
  }
}

function snapTrailingEdge(
  result: CropBounds,
  axis: SnapAxis,
  edgeValue: number,
  targets: SnapTarget[]
) {
  const snapped = findNearestSnap(edgeValue, targets);
  if (snapped === null) return;

  if (axis === 'x') {
    result.width = snapped - result.x;
  } else {
    result.height = snapped - result.y;
  }
}

function getLabeledSnapPositions(targets: ReturnType<typeof getSnapTargets>) {
  return Object.fromEntries(
    [...targets.x, ...targets.y].map((target) => [target.label, target.position])
  ) as Partial<Record<SnapLabel, number>>;
}

function isWithinSnapThreshold(value: number, target: number | undefined) {
  return target !== undefined && Math.abs(value - target) < SNAP_THRESHOLD;
}

function snapCenterAxis(
  result: CropBounds,
  axis: SnapAxis,
  cropCenter: number,
  targetCenter: number | undefined
) {
  if (targetCenter === undefined || !isWithinSnapThreshold(cropCenter, targetCenter)) return;

  if (axis === 'x') {
    result.x = targetCenter - result.width / 2;
  } else {
    result.y = targetCenter - result.height / 2;
  }
}

function setCropAxisPosition(result: CropBounds, axis: SnapAxis, value: number) {
  if (axis === 'x') {
    result.x = value;
  } else {
    result.y = value;
  }
}

function getCropAxisSize(result: CropBounds, axis: SnapAxis) {
  return axis === 'x' ? result.width : result.height;
}

function getEdgeSnapCandidate(
  edge: 'leading' | 'trailing',
  edgeValue: number,
  target: number | undefined
) {
  if (target === undefined || !isWithinSnapThreshold(edgeValue, target)) {
    return null;
  }

  return { edge, target };
}

function getBoxEdgeSnap({
  leadingEdge,
  trailingEdge,
  leadingTarget,
  trailingTarget,
}: {
  leadingEdge: number;
  trailingEdge: number;
  leadingTarget: number | undefined;
  trailingTarget: number | undefined;
}) {
  return (
    getEdgeSnapCandidate('leading', leadingEdge, leadingTarget) ??
    getEdgeSnapCandidate('trailing', trailingEdge, trailingTarget)
  );
}

function snapBoxEdges({
  result,
  axis,
  leadingEdge,
  trailingEdge,
  leadingTarget,
  trailingTarget,
}: {
  result: CropBounds;
  axis: SnapAxis;
  leadingEdge: number;
  trailingEdge: number;
  leadingTarget: number | undefined;
  trailingTarget: number | undefined;
}) {
  const snap = getBoxEdgeSnap({ leadingEdge, trailingEdge, leadingTarget, trailingTarget });
  if (!snap) return;

  const offset = snap.edge === 'trailing' ? getCropAxisSize(result, axis) : 0;
  setCropAxisPosition(result, axis, snap.target - offset);
}

function snapCenterBox(bounds: CropBounds, result: CropBounds, targets: ReturnType<typeof getSnapTargets>) {
  const cropLeft = bounds.x;
  const cropRight = bounds.x + bounds.width;
  const cropTop = bounds.y;
  const cropBottom = bounds.y + bounds.height;
  const cropCenterX = bounds.x + bounds.width / 2;
  const cropCenterY = bounds.y + bounds.height / 2;
  const snapPositions = getLabeledSnapPositions(targets);

  snapCenterAxis(result, 'x', cropCenterX, snapPositions.centerX);
  snapCenterAxis(result, 'y', cropCenterY, snapPositions.centerY);
  snapBoxEdges({
    result,
    axis: 'x',
    leadingEdge: cropLeft,
    trailingEdge: cropRight,
    leadingTarget: snapPositions.left,
    trailingTarget: snapPositions.right,
  });
  snapBoxEdges({
    result,
    axis: 'y',
    leadingEdge: cropTop,
    trailingEdge: cropBottom,
    leadingTarget: snapPositions.top,
    trailingTarget: snapPositions.bottom,
  });
}

const SNAP_EDGE_ACTIONS: Record<
  SnapEdge,
  (result: CropBounds, bounds: CropBounds, targets: ReturnType<typeof getSnapTargets>) => void
> = {
  left: (result, bounds, targets) => snapLeadingEdge(result, 'x', bounds.x, targets.x),
  right: (result, bounds, targets) =>
    snapTrailingEdge(result, 'x', bounds.x + bounds.width, targets.x),
  top: (result, bounds, targets) => snapLeadingEdge(result, 'y', bounds.y, targets.y),
  bottom: (result, bounds, targets) =>
    snapTrailingEdge(result, 'y', bounds.y + bounds.height, targets.y),
  center: (result, bounds, targets) => snapCenterBox(bounds, result, targets),
};

// Helper to check if a crop edge aligns with any snap target
function findSnapGuide(
  cropEdge: number,
  targets: { position: number; label: SnapGuide['label'] }[],
  guideType: SnapGuide['type']
): SnapGuide | null {
  for (const target of targets) {
    if (Math.abs(cropEdge - target.position) < SNAP_THRESHOLD) {
      return { type: guideType, position: target.position, label: target.label };
    }
  }
  return null;
}

function dedupeSnapGuides(guides: SnapGuide[]): SnapGuide[] {
  return guides.filter((guide, index, self) =>
    index === self.findIndex(g => g.type === guide.type && g.position === guide.position)
  );
}

function getSnapGuideChecks(
  bounds: CropBounds,
  activeHandle: string,
  targets: ReturnType<typeof getSnapTargets>
) {
  const metrics = getCropSnapMetrics(bounds);
  const activeEdges = getActiveSnapEdges(activeHandle);

  return [
    getSnapGuideCheck(activeEdges.left, metrics.left, targets.x, 'vertical'),
    getSnapGuideCheck(activeEdges.right, metrics.right, targets.x, 'vertical'),
    getSnapGuideCheck(activeEdges.center, metrics.centerX, getTargetsByLabel(targets.x, 'centerX'), 'vertical'),
    getSnapGuideCheck(activeEdges.top, metrics.top, targets.y, 'horizontal'),
    getSnapGuideCheck(activeEdges.bottom, metrics.bottom, targets.y, 'horizontal'),
    getSnapGuideCheck(activeEdges.center, metrics.centerY, getTargetsByLabel(targets.y, 'centerY'), 'horizontal'),
  ];
}

function getActiveSnapEdges(activeHandle: string) {
  const center = isCenterSnapHandle(activeHandle);
  return {
    left: isSnapEdgeActive(activeHandle, 'l'),
    right: isSnapEdgeActive(activeHandle, 'r'),
    top: isSnapEdgeActive(activeHandle, 't'),
    bottom: isSnapEdgeActive(activeHandle, 'b'),
    center,
  };
}

function isCenterSnapHandle(activeHandle: string) {
  return activeHandle === 'center';
}

function isSnapEdgeActive(activeHandle: string, token: string) {
  return isCenterSnapHandle(activeHandle) || activeHandle.includes(token);
}

function getCropSnapMetrics(bounds: CropBounds) {
  return {
    left: bounds.x,
    right: bounds.x + bounds.width,
    top: bounds.y,
    bottom: bounds.y + bounds.height,
    centerX: bounds.x + bounds.width / 2,
    centerY: bounds.y + bounds.height / 2,
  };
}

function getTargetsByLabel(targets: SnapTarget[], label: SnapLabel) {
  return targets.filter((target) => target.label === label);
}

function getSnapGuideCheck(
  enabled: boolean,
  value: number,
  targets: SnapTarget[],
  type: SnapGuide['type']
) {
  return { enabled, value, targets, type };
}

function getSnapGuides(
  bounds: CropBounds,
  activeHandle: string,
  snapSize: CropBounds
): SnapGuide[] {
  const targets = getSnapTargets(snapSize);
  const guides = getSnapGuideChecks(bounds, activeHandle, targets)
    .filter((check) => check.enabled)
    .map((check) => findSnapGuide(check.value, check.targets, check.type))
    .filter((guide): guide is SnapGuide => guide !== null);

  return dedupeSnapGuides(guides);
}

function getBackgroundSnapSize(
  backgroundShape: CanvasShape,
  fallbackSize: ImageSize | null
): CropBounds {
  const fallback = getFallbackSnapSize(fallbackSize);
  const {
    x = 0,
    y = 0,
    width = fallback.width,
    height = fallback.height,
  } = backgroundShape;

  return {
    x,
    y,
    width,
    height,
  };
}

function getFallbackSnapSize(fallbackSize: ImageSize | null) {
  if (!fallbackSize) {
    return { width: 0, height: 0 };
  }

  return {
    width: fallbackSize.width,
    height: fallbackSize.height,
  };
}

function getImageSnapSize(imageSize: ImageSize): CropBounds {
  return { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
}

function getCropSnapSize(
  backgroundShape: CanvasShape | undefined,
  originalImageSize: ImageSize | null
): CropBounds | null {
  if (backgroundShape) return getBackgroundSnapSize(backgroundShape, originalImageSize);
  if (originalImageSize) return getImageSnapSize(originalImageSize);
  return null;
}

function snapCropBounds(bounds: CropBounds, handle: string, snapSize: CropBounds): CropBounds {
  const result = { ...bounds };
  const targets = getSnapTargets(snapSize);
  const edges = SNAP_HANDLE_EDGES[handle] ?? [];

  edges.forEach((edge) => SNAP_EDGE_ACTIONS[edge](result, bounds, targets));

  return result;
}

function canShowCropSnapGuides({
  isShiftHeld,
  snapSize,
  cropPreview,
  activeHandle,
}: {
  isShiftHeld: boolean;
  snapSize: CropBounds | null;
  cropPreview: CropBounds | null;
  activeHandle: string | null;
}) {
  return isShiftHeld && snapSize !== null && cropPreview !== null && activeHandle !== null;
}

function getCropLockAxis(
  x: number,
  y: number,
  dragStart: { x: number; y: number },
  currentAxis: CropAxis | null
) {
  if (currentAxis) return currentAxis;

  const dx = Math.abs(x - dragStart.x);
  const dy = Math.abs(y - dragStart.y);
  if (isWithinCropAxisLockDeadzone(dx, dy)) return null;
  return dx > dy ? 'x' : 'y';
}

function isWithinCropAxisLockDeadzone(dx: number, dy: number) {
  return dx <= 5 && dy <= 5;
}

function applyCropAxisLock(
  point: { x: number; y: number },
  dragStart: { x: number; y: number },
  axis: CropAxis | null
) {
  if (axis === 'x') {
    return { x: point.x, y: dragStart.y };
  }
  if (axis === 'y') {
    return { x: dragStart.x, y: point.y };
  }
  return point;
}

function getFinalCenterDragPoint({
  x,
  y,
  isShiftHeld,
  cropDragStart,
  cropLockedAxis,
}: {
  x: number;
  y: number;
  isShiftHeld: boolean;
  cropDragStart: { x: number; y: number } | null;
  cropLockedAxis: CropAxis | null;
}) {
  if (!isShiftHeld || !cropDragStart || !cropLockedAxis) {
    return { x, y };
  }

  return applyCropAxisLock({ x, y }, cropDragStart, cropLockedAxis);
}

function clearCropCenterDragState({
  setCropDragStart,
  setCropLockedAxis,
  setActiveHandle,
}: {
  setCropDragStart: (point: { x: number; y: number } | null) => void;
  setCropLockedAxis: (axis: CropAxis | null) => void;
  setActiveHandle: (handle: string | null) => void;
}) {
  setCropDragStart(null);
  setCropLockedAxis(null);
  setActiveHandle(null);
}

/**
 * Hook for crop tool state management
 * Now sets cropRegion (export-only bounds) instead of canvasBounds
 */
export const useCropTool = ({
  canvasBounds,
  setCropRegion,
  cropRegion,
  isShiftHeld,
  zoom,
  backgroundShape,
  originalImageSize,
  history,
  setCropUserExpanded,
}: UseCropToolProps): UseCropToolReturn => {
  const { takeSnapshot, commitSnapshot } = history;
  const [cropPreview, setCropPreview] = useState<CropBounds | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number } | null>(null);
  const [cropLockedAxis, setCropLockedAxis] = useState<'x' | 'y' | null>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const dragStartBoundsRef = useRef<CropBounds | null>(null);

  // Snap target dimensions: use background shape if available, fall back to originalImageSize
  const snapSize = useMemo(
    () => getCropSnapSize(backgroundShape, originalImageSize),
    [backgroundShape, originalImageSize]
  );

  // Get base bounds: if cropRegion is set, use it; otherwise compute from canvasBounds
  const getBaseBounds = useCallback((): CropBounds => {
    if (cropRegion) {
      return { ...cropRegion };
    }
    if (!canvasBounds) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return {
      x: -canvasBounds.imageOffsetX,
      y: -canvasBounds.imageOffsetY,
      width: canvasBounds.width,
      height: canvasBounds.height,
    };
  }, [cropRegion, canvasBounds]);

  // Get display bounds (preview or base)
  const getDisplayBounds = useCallback((): CropBounds => {
    return cropPreview || getBaseBounds();
  }, [cropPreview, getBaseBounds]);

  // Calculate preview from handle drag position using stable drag-start bounds
  const calcPreviewFromDrag = useCallback(
    (handleId: string, nodeX: number, nodeY: number): CropBounds => {
      const base = dragStartBoundsRef.current || getDisplayBounds();
      const halfHandle = HANDLE_THICKNESS / (2 * zoom);
      const draggedEdges = applyHandleDrag(
        getCropEdges(base),
        handleId,
        nodeX,
        nodeY,
        halfHandle
      );

      return getCropBoundsFromEdges(
        enforceMinimumCropSize(draggedEdges, handleId)
      );
    },
    [getDisplayBounds, zoom]
  );

  // Apply snapping to bounds based on active handle
  const applySnapping = useCallback(
    (bounds: CropBounds, handle: string | null): CropBounds => {
      if (!snapSize || !handle) return bounds;
      return snapCropBounds(bounds, handle, snapSize);
    },
    [snapSize]
  );

  // Commit preview to cropRegion
  const commitBounds = useCallback(
    (preview: CropBounds, handle: string | null = null) => {
      const finalBounds = isShiftHeld ? applySnapping(preview, handle) : preview;
      setCropRegion({
        x: Math.round(finalBounds.x),
        y: Math.round(finalBounds.y),
        width: Math.round(finalBounds.width),
        height: Math.round(finalBounds.height),
      });
      setCropUserExpanded(true);
      setCropPreview(null);
    },
    [setCropRegion, setCropUserExpanded, applySnapping, isShiftHeld]
  );

  // Center drag handlers (with Shift axis locking)
  const handleCenterDragStart = useCallback((x: number, y: number) => {
    setCropDragStart({ x, y });
    setCropLockedAxis(null);
    setActiveHandle('center');
    takeSnapshot();
  }, [takeSnapshot]);

  const handleCenterDragMove = useCallback(
    (newX: number, newY: number) => {
      let nextPoint = { x: newX, y: newY };
      if (isShiftHeld && cropDragStart) {
        const nextAxis = getCropLockAxis(newX, newY, cropDragStart, cropLockedAxis);
        if (nextAxis !== cropLockedAxis) setCropLockedAxis(nextAxis);
        nextPoint = applyCropAxisLock(nextPoint, cropDragStart, nextAxis);
      }

      const baseBounds = getBaseBounds();
      flushSync(() => {
        setCropPreview({
          x: nextPoint.x,
          y: nextPoint.y,
          width: baseBounds.width,
          height: baseBounds.height,
        });
      });

      return nextPoint;
    },
    [isShiftHeld, cropDragStart, cropLockedAxis, getBaseBounds]
  );

  const handleCenterDragEnd = useCallback(
    (x: number, y: number) => {
      const finalPoint = getFinalCenterDragPoint({ x, y, isShiftHeld, cropDragStart, cropLockedAxis });

      const baseBounds = getBaseBounds();
      commitBounds({
        x: finalPoint.x,
        y: finalPoint.y,
        width: baseBounds.width,
        height: baseBounds.height,
      }, 'center');
      clearCropCenterDragState({ setCropDragStart, setCropLockedAxis, setActiveHandle });
      commitSnapshot();
    },
    [isShiftHeld, cropDragStart, cropLockedAxis, getBaseBounds, commitBounds, commitSnapshot]
  );

  // Edge drag handlers
  const handleEdgeDragStart = useCallback((handleId: string) => {
    dragStartBoundsRef.current = getDisplayBounds();
    setActiveHandle(handleId);
    takeSnapshot();
  }, [getDisplayBounds, takeSnapshot]);

  const handleEdgeDragMove = useCallback(
    (handleId: string, nodeX: number, nodeY: number) => {
      flushSync(() => {
        setCropPreview(calcPreviewFromDrag(handleId, nodeX, nodeY));
      });
    },
    [calcPreviewFromDrag]
  );

  const handleEdgeDragEnd = useCallback(
    (handleId: string, nodeX: number, nodeY: number) => {
      const preview = calcPreviewFromDrag(handleId, nodeX, nodeY);
      commitBounds(preview, handleId);
      dragStartBoundsRef.current = null;
      setActiveHandle(null);
      commitSnapshot();
    },
    [calcPreviewFromDrag, commitBounds, commitSnapshot]
  );

  // Corner drag handlers
  const handleCornerDragStart = useCallback((handleId: string) => {
    dragStartBoundsRef.current = getDisplayBounds();
    setActiveHandle(handleId);
    takeSnapshot();
  }, [getDisplayBounds, takeSnapshot]);

  const handleCornerDragMove = useCallback(
    (handleId: string, nodeX: number, nodeY: number) => {
      flushSync(() => {
        setCropPreview(calcPreviewFromDrag(handleId, nodeX, nodeY));
      });
    },
    [calcPreviewFromDrag]
  );

  const handleCornerDragEnd = useCallback(
    (handleId: string, nodeX: number, nodeY: number) => {
      const preview = calcPreviewFromDrag(handleId, nodeX, nodeY);
      commitBounds(preview, handleId);
      dragStartBoundsRef.current = null;
      setActiveHandle(null);
      commitSnapshot();
    },
    [calcPreviewFromDrag, commitBounds, commitSnapshot]
  );

  // Calculate active snap guides based on crop bounds alignment with background bounds
  const snapGuides = useMemo((): SnapGuide[] => {
    if (!canShowCropSnapGuides({ isShiftHeld, snapSize, cropPreview, activeHandle })) {
      return [];
    }

    return getSnapGuides(cropPreview!, activeHandle!, snapSize!);
  }, [isShiftHeld, snapSize, cropPreview, activeHandle]);

  return {
    cropPreview,
    cropDragStart,
    cropLockedAxis,
    snapGuides,
    setCropPreview,
    getDisplayBounds,
    getBaseBounds,
    handleCenterDragStart,
    handleCenterDragMove,
    handleCenterDragEnd,
    handleEdgeDragStart,
    handleEdgeDragMove,
    handleEdgeDragEnd,
    handleCornerDragStart,
    handleCornerDragMove,
    handleCornerDragEnd,
    commitBounds,
  };
};
