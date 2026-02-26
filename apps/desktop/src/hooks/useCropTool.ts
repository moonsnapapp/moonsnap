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
}: UseCropToolProps): UseCropToolReturn => {
  const { takeSnapshot, commitSnapshot } = history;
  const [cropPreview, setCropPreview] = useState<CropBounds | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number } | null>(null);
  const [cropLockedAxis, setCropLockedAxis] = useState<'x' | 'y' | null>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const dragStartBoundsRef = useRef<CropBounds | null>(null);

  // Snap target dimensions: use background shape if available, fall back to originalImageSize
  const snapSize = useMemo((): { x: number; y: number; width: number; height: number } | null => {
    if (backgroundShape) {
      return {
        x: backgroundShape.x ?? 0,
        y: backgroundShape.y ?? 0,
        width: backgroundShape.width ?? (originalImageSize?.width ?? 0),
        height: backgroundShape.height ?? (originalImageSize?.height ?? 0),
      };
    }
    if (originalImageSize) {
      return { x: 0, y: 0, width: originalImageSize.width, height: originalImageSize.height };
    }
    return null;
  }, [backgroundShape, originalImageSize]);

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
      const left = base.x;
      const top = base.y;
      const right = left + base.width;
      const bottom = top + base.height;

      let newLeft = left, newTop = top, newRight = right, newBottom = bottom;

      // Edge handles: offset from node position to crop edge
      const halfHandle = HANDLE_THICKNESS / (2 * zoom);
      if (handleId === 't') newTop = nodeY + halfHandle;
      else if (handleId === 'b') newBottom = nodeY + halfHandle;
      else if (handleId === 'l') newLeft = nodeX + halfHandle;
      else if (handleId === 'r') newRight = nodeX + halfHandle;
      // Corner handles (direct position)
      else {
        if (handleId.includes('l')) newLeft = nodeX;
        if (handleId.includes('r')) newRight = nodeX;
        if (handleId.includes('t')) newTop = nodeY;
        if (handleId.includes('b')) newBottom = nodeY;
      }

      // Ensure minimum size
      if (newRight - newLeft < MIN_CROP_SIZE) {
        if (handleId.includes('l') || handleId === 'l') newLeft = newRight - MIN_CROP_SIZE;
        else newRight = newLeft + MIN_CROP_SIZE;
      }
      if (newBottom - newTop < MIN_CROP_SIZE) {
        if (handleId.includes('t') || handleId === 't') newTop = newBottom - MIN_CROP_SIZE;
        else newBottom = newTop + MIN_CROP_SIZE;
      }

      return {
        x: newLeft,
        y: newTop,
        width: newRight - newLeft,
        height: newBottom - newTop,
      };
    },
    [getDisplayBounds, zoom]
  );

  // Apply snapping to bounds based on active handle
  const applySnapping = useCallback(
    (bounds: CropBounds, handle: string | null): CropBounds => {
      if (!snapSize || !handle) return bounds;

      const result = { ...bounds };

      // Snap targets (from background shape position)
      const bgLeft = snapSize.x;
      const bgRight = snapSize.x + snapSize.width;
      const bgTop = snapSize.y;
      const bgBottom = snapSize.y + snapSize.height;
      const bgCenterX = snapSize.x + snapSize.width / 2;
      const bgCenterY = snapSize.y + snapSize.height / 2;

      // Crop edges
      const cropLeft = bounds.x;
      const cropRight = bounds.x + bounds.width;
      const cropTop = bounds.y;
      const cropBottom = bounds.y + bounds.height;
      const cropCenterX = bounds.x + bounds.width / 2;
      const cropCenterY = bounds.y + bounds.height / 2;

      // Determine which edges to snap based on handle
      const snapLeft = handle === 'l' || handle === 'tl' || handle === 'bl';
      const snapRight = handle === 'r' || handle === 'tr' || handle === 'br';
      const snapTop = handle === 't' || handle === 'tl' || handle === 'tr';
      const snapBottom = handle === 'b' || handle === 'bl' || handle === 'br';
      const snapCenter = handle === 'center';

      // Snap left edge
      if (snapLeft) {
        if (Math.abs(cropLeft - bgLeft) < SNAP_THRESHOLD) {
          result.width += result.x - bgLeft;
          result.x = bgLeft;
        } else if (Math.abs(cropLeft - bgCenterX) < SNAP_THRESHOLD) {
          result.width += result.x - bgCenterX;
          result.x = bgCenterX;
        } else if (Math.abs(cropLeft - bgRight) < SNAP_THRESHOLD) {
          result.width += result.x - bgRight;
          result.x = bgRight;
        }
      }

      // Snap right edge
      if (snapRight) {
        if (Math.abs(cropRight - bgRight) < SNAP_THRESHOLD) {
          result.width = bgRight - result.x;
        } else if (Math.abs(cropRight - bgCenterX) < SNAP_THRESHOLD) {
          result.width = bgCenterX - result.x;
        } else if (Math.abs(cropRight - bgLeft) < SNAP_THRESHOLD) {
          result.width = bgLeft - result.x;
        }
      }

      // Snap top edge
      if (snapTop) {
        if (Math.abs(cropTop - bgTop) < SNAP_THRESHOLD) {
          result.height += result.y - bgTop;
          result.y = bgTop;
        } else if (Math.abs(cropTop - bgCenterY) < SNAP_THRESHOLD) {
          result.height += result.y - bgCenterY;
          result.y = bgCenterY;
        } else if (Math.abs(cropTop - bgBottom) < SNAP_THRESHOLD) {
          result.height += result.y - bgBottom;
          result.y = bgBottom;
        }
      }

      // Snap bottom edge
      if (snapBottom) {
        if (Math.abs(cropBottom - bgBottom) < SNAP_THRESHOLD) {
          result.height = bgBottom - result.y;
        } else if (Math.abs(cropBottom - bgCenterY) < SNAP_THRESHOLD) {
          result.height = bgCenterY - result.y;
        } else if (Math.abs(cropBottom - bgTop) < SNAP_THRESHOLD) {
          result.height = bgTop - result.y;
        }
      }

      // Snap center (moves entire crop box)
      if (snapCenter) {
        if (Math.abs(cropCenterX - bgCenterX) < SNAP_THRESHOLD) {
          result.x = bgCenterX - result.width / 2;
        }
        if (Math.abs(cropCenterY - bgCenterY) < SNAP_THRESHOLD) {
          result.y = bgCenterY - result.height / 2;
        }
        if (Math.abs(cropLeft - bgLeft) < SNAP_THRESHOLD) {
          result.x = bgLeft;
        } else if (Math.abs(cropRight - bgRight) < SNAP_THRESHOLD) {
          result.x = bgRight - result.width;
        }
        if (Math.abs(cropTop - bgTop) < SNAP_THRESHOLD) {
          result.y = bgTop;
        } else if (Math.abs(cropBottom - bgBottom) < SNAP_THRESHOLD) {
          result.y = bgBottom - result.height;
        }
      }

      return result;
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
      setCropPreview(null);
    },
    [setCropRegion, applySnapping, isShiftHeld]
  );

  // Center drag handlers (with Shift axis locking)
  const handleCenterDragStart = useCallback((x: number, y: number) => {
    setCropDragStart({ x, y });
    setCropLockedAxis(null);
    setActiveHandle('center');
    takeSnapshot();
  }, []);

  const handleCenterDragMove = useCallback(
    (newX: number, newY: number) => {
      let x = newX;
      let y = newY;

      // Shift+drag: constrain to axis
      if (isShiftHeld && cropDragStart) {
        const dx = Math.abs(x - cropDragStart.x);
        const dy = Math.abs(y - cropDragStart.y);

        // Lock to axis once movement exceeds threshold
        if (!cropLockedAxis && (dx > 5 || dy > 5)) {
          setCropLockedAxis(dx > dy ? 'x' : 'y');
        }

        // Apply constraint
        if (cropLockedAxis === 'x') {
          y = cropDragStart.y;
        } else if (cropLockedAxis === 'y') {
          x = cropDragStart.x;
        }
      }

      const baseBounds = getBaseBounds();
      flushSync(() => {
        setCropPreview({
          x,
          y,
          width: baseBounds.width,
          height: baseBounds.height,
        });
      });

      return { x, y }; // Return constrained values for caller
    },
    [isShiftHeld, cropDragStart, cropLockedAxis, getBaseBounds]
  );

  const handleCenterDragEnd = useCallback(
    (x: number, y: number) => {
      let finalX = x;
      let finalY = y;

      // Apply final constraint if Shift was held
      if (isShiftHeld && cropDragStart && cropLockedAxis) {
        if (cropLockedAxis === 'x') {
          finalY = cropDragStart.y;
        } else if (cropLockedAxis === 'y') {
          finalX = cropDragStart.x;
        }
      }

      const baseBounds = getBaseBounds();
      commitBounds({
        x: finalX,
        y: finalY,
        width: baseBounds.width,
        height: baseBounds.height,
      }, 'center');
      setCropDragStart(null);
      setCropLockedAxis(null);
      setActiveHandle(null);
      commitSnapshot();
    },
    [isShiftHeld, cropDragStart, cropLockedAxis, getBaseBounds, commitBounds]
  );

  // Edge drag handlers
  const handleEdgeDragStart = useCallback((handleId: string) => {
    dragStartBoundsRef.current = getDisplayBounds();
    setActiveHandle(handleId);
    takeSnapshot();
  }, [getDisplayBounds]);

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
    [calcPreviewFromDrag, commitBounds]
  );

  // Corner drag handlers
  const handleCornerDragStart = useCallback((handleId: string) => {
    dragStartBoundsRef.current = getDisplayBounds();
    setActiveHandle(handleId);
    takeSnapshot();
  }, [getDisplayBounds]);

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
    [calcPreviewFromDrag, commitBounds]
  );

  // Calculate active snap guides based on crop bounds alignment with background bounds
  const snapGuides = useMemo((): SnapGuide[] => {
    if (!isShiftHeld || !snapSize || !cropPreview || !activeHandle) return [];

    const guides: SnapGuide[] = [];
    const bounds = cropPreview;

    // Snap targets from background shape
    const bgCenterX = snapSize.x + snapSize.width / 2;
    const bgCenterY = snapSize.y + snapSize.height / 2;

    // Vertical targets (for left/right edge snapping)
    const verticalTargets: { position: number; label: SnapGuide['label'] }[] = [
      { position: snapSize.x, label: 'left' },
      { position: bgCenterX, label: 'centerX' },
      { position: snapSize.x + snapSize.width, label: 'right' },
    ];

    // Horizontal targets (for top/bottom edge snapping)
    const horizontalTargets: { position: number; label: SnapGuide['label'] }[] = [
      { position: snapSize.y, label: 'top' },
      { position: bgCenterY, label: 'centerY' },
      { position: snapSize.y + snapSize.height, label: 'bottom' },
    ];

    // Crop bounds edges and center
    const cropLeft = bounds.x;
    const cropRight = bounds.x + bounds.width;
    const cropTop = bounds.y;
    const cropBottom = bounds.y + bounds.height;
    const cropCenterX = bounds.x + bounds.width / 2;
    const cropCenterY = bounds.y + bounds.height / 2;

    // Determine which edges to check based on active handle
    const isCenter = activeHandle === 'center';
    const checkLeft = activeHandle.includes('l') || isCenter;
    const checkRight = activeHandle.includes('r') || isCenter;
    const checkTop = activeHandle.includes('t') || isCenter;
    const checkBottom = activeHandle.includes('b') || isCenter;

    // Check vertical guides (left/right edges)
    if (checkLeft) {
      const guide = findSnapGuide(cropLeft, verticalTargets, 'vertical');
      if (guide) guides.push(guide);
    }
    if (checkRight) {
      const guide = findSnapGuide(cropRight, verticalTargets, 'vertical');
      if (guide) guides.push(guide);
    }
    if (isCenter) {
      const guide = findSnapGuide(cropCenterX, [{ position: bgCenterX, label: 'centerX' }], 'vertical');
      if (guide) guides.push(guide);
    }

    // Check horizontal guides (top/bottom edges)
    if (checkTop) {
      const guide = findSnapGuide(cropTop, horizontalTargets, 'horizontal');
      if (guide) guides.push(guide);
    }
    if (checkBottom) {
      const guide = findSnapGuide(cropBottom, horizontalTargets, 'horizontal');
      if (guide) guides.push(guide);
    }
    if (isCenter) {
      const guide = findSnapGuide(cropCenterY, [{ position: bgCenterY, label: 'centerY' }], 'horizontal');
      if (guide) guides.push(guide);
    }

    // Deduplicate guides by type and position
    return guides.filter((guide, index, self) =>
      index === self.findIndex(g => g.type === guide.type && g.position === guide.position)
    );
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
