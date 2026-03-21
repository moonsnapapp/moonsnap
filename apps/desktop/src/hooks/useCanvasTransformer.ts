import { useMemo, useCallback, useEffect } from 'react';
import Konva from 'konva';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { CanvasShape, CanvasBounds } from '../types';
import { getSelectionBounds, expandBoundsForShapes, expandCropRegionForShapes } from '../utils/canvasGeometry';
import { EDITOR_TEXT, getEditorTextResizeDimensions } from '../utils/editorText';

interface UseCanvasTransformerProps {
  shapes: CanvasShape[];
  selectedIds: string[];
  selectedTool: string;
  drawing: { isDrawing: boolean };
  textEditing: { editingTextId: string | null };
  transformerRef: React.RefObject<Konva.Transformer | null>;
  layerRef: React.RefObject<Konva.Layer | null>;
  isShapeDraggingRef: React.MutableRefObject<boolean>;
  history: {
    takeSnapshot: () => void;
    commitSnapshot: () => void;
  };
  onShapesChange: (shapes: CanvasShape[]) => void;
  canvasBounds: CanvasBounds | null;
  originalImageSize: { width: number; height: number } | null;
  cropRegion: { x: number; y: number; width: number; height: number } | null;
  setCropRegion: (region: { x: number; y: number; width: number; height: number } | null) => void;
  cropUserExpanded: boolean;
  setCanvasBounds: (bounds: CanvasBounds) => void;
  isShiftHeld: boolean;
  selectedSet: Set<string>;
  shapeById: Map<string, CanvasShape>;
}

interface UseCanvasTransformerReturn {
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  hasProportionalShape: boolean;
  handleResetRotation: () => void;
  transformerProps: {
    keepRatio: boolean;
    enabledAnchors: string[];
    boundBoxFunc: (oldBox: Box, newBox: Box) => Box;
    onTransformStart: () => void;
    onTransform: () => void;
    onTransformEnd: () => void;
  };
}

export function useCanvasTransformer({
  shapes,
  selectedIds,
  selectedTool,
  drawing,
  textEditing,
  transformerRef,
  layerRef,
  isShapeDraggingRef,
  history,
  onShapesChange,
  canvasBounds,
  originalImageSize,
  cropRegion,
  setCropRegion,
  cropUserExpanded,
  setCanvasBounds,
  isShiftHeld,
  selectedSet,
  shapeById,
}: UseCanvasTransformerProps): UseCanvasTransformerReturn {
  // Selection bounds for group drag
  const selectionBounds = useMemo(() => {
    if (selectedIds.length <= 1) return null;
    return getSelectionBounds(shapes, selectedIds);
  }, [shapes, selectedIds]);

  // Check if any selected shape requires proportional scaling.
  const hasProportionalShape = useMemo(() => {
    for (const id of selectedIds) {
      if (shapeById.get(id)?.type === 'step') {
        return true;
      }
    }
    return false;
  }, [selectedIds, shapeById]);

  // Reset rotation of all selected shapes to 0
  const handleResetRotation = useCallback(() => {
    history.takeSnapshot();
    const updatedShapes = shapes.map((s) => {
      if (!selectedSet.has(s.id)) return s;
      return { ...s, rotation: 0 };
    });
    onShapesChange(updatedShapes);

    // Also reset rotation on the Konva nodes so the Transformer updates
    const tr = transformerRef.current;
    if (tr) {
      tr.nodes().forEach((node) => {
        if (selectedSet.has(node.id())) {
          node.rotation(0);
        }
      });
      tr.getLayer()?.batchDraw();
    }
    history.commitSnapshot();
  }, [history, onShapesChange, selectedSet, shapes, transformerRef]);

  // Attach transformer to selected shapes
  useEffect(() => {
    if (!transformerRef.current || !layerRef.current) return;

    // Hide transformer while drawing, editing text, or not in select mode
    if (drawing.isDrawing || textEditing.editingTextId || selectedTool !== 'select' || isShapeDraggingRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    // For single selection, exclude arrows/lines so their custom endpoint handles stay usable
    const isMultiSelect = selectedIds.length > 1;
    const nodes = selectedIds
      .filter((id) => {
        if (isMultiSelect) return true;
        const shape = shapeById.get(id);
        return shape && shape.type !== 'arrow' && shape.type !== 'line';
      })
      .map((id) => layerRef.current!.findOne(`#${id}`))
      .filter((node): node is Konva.Node => node !== null && node !== undefined);

    transformerRef.current.nodes(nodes);
    transformerRef.current.getLayer()?.batchDraw();
  }, [drawing.isDrawing, selectedIds, selectedTool, shapeById, textEditing.editingTextId, transformerRef, layerRef, isShapeDraggingRef]);

  const onTransform = useCallback(() => {
    // Convert scale to dimensions in real-time to prevent stroke scaling during resize
    const nodes = transformerRef.current?.nodes() || [];
    nodes.forEach(node => {
      const shape = shapeById.get(node.id());
      if (!shape) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      if (shape.type === 'text') {
        const group = node as Konva.Group;
        const { width: liveWidth, height: liveHeight } = getEditorTextResizeDimensions(
          shape.width,
          shape.height,
          scaleX,
          scaleY
        );
        const w = Math.max(EDITOR_TEXT.MIN_BOX_WIDTH, Math.abs(liveWidth));
        const h = Math.max(EDITOR_TEXT.MIN_BOX_HEIGHT, Math.abs(liveHeight));
        const invSx = scaleX === 0 ? 1 : 1 / scaleX;
        const invSy = scaleY === 0 ? 1 : 1 / scaleY;

        // Counter-scale all child rects so they resize without distortion
        for (const child of [
          group.findOne('.text-content'),
          group.findOne('.text-background'),
          group.findOne('.text-hit-area'),
        ]) {
          if (!child) continue;
          child.width(w);
          child.height(h);
          child.scaleX(invSx);
          child.scaleY(invSy);
          child.x(0);
          child.y(0);
        }
      } else if (scaleX !== 1 || scaleY !== 1) {
        // All other shapes: reset scale to 1 and adjust geometry
        // This prevents stroke width from visually scaling during resize
        if (shape.type === 'circle') {
          const ellipse = node as unknown as Konva.Ellipse;
          ellipse.radiusX(ellipse.radiusX() * Math.abs(scaleX));
          ellipse.radiusY(ellipse.radiusY() * Math.abs(scaleY));
        } else if (shape.type === 'step') {
          const circle = (node as Konva.Group).findOne('Circle') as Konva.Circle | undefined;
          if (circle) {
            const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
            circle.radius(circle.radius() * avgScale);
          }
        } else if ((shape.type === 'pen' || shape.type === 'arrow' || shape.type === 'line') && shape.points) {
          const line = node.className === 'Group'
            ? (node as Konva.Group).findOne('Line, Arrow') as Konva.Line | undefined
            : node as Konva.Line;
          if (line) {
            const pts = line.points();
            const scaled = pts.map((v, i) => v * (i % 2 === 0 ? scaleX : scaleY));
            line.points(scaled);
          }
        } else {
          // rect, highlight, image, blur: width/height based
          node.width(node.width() * scaleX);
          node.height(node.height() * scaleY);
        }
        node.scaleX(1);
        node.scaleY(1);
      }
    });
  }, [shapeById, transformerRef]);

  const onTransformEnd = useCallback(() => {
    // Handle ALL shapes at once to ensure batched history entry
    const nodes = transformerRef.current?.nodes() || [];
    if (nodes.length === 0) {
      history.commitSnapshot();
      return;
    }

    // Collect updates for all transformed shapes
    const shapeUpdates = new Map<string, Partial<CanvasShape>>();

    nodes.forEach(node => {
      const shapeId = node.id();
      const shape = shapeById.get(shapeId);
      if (!shape) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      let updates: Partial<CanvasShape>;

      if ((shape.type === 'pen' || shape.type === 'arrow' || shape.type === 'line') && shape.points && shape.points.length >= 2) {
        // Points-based shapes: convert scale to points
        const nodeX = node.x();
        const nodeY = node.y();
        const newPoints = shape.points.map((val, i) =>
          i % 2 === 0 ? nodeX + val * scaleX : nodeY + val * scaleY
        );
        node.scaleX(1);
        node.scaleY(1);
        node.position({ x: 0, y: 0 });
        updates = { points: newPoints };
      } else if (shape.type === 'blur') {
        // Blur: just use position and dimensions
        updates = {
          x: node.x(),
          y: node.y(),
          width: node.width(),
          height: node.height(),
        };
      } else if (shape.type === 'text') {
        // Text: let Konva own the live scale during the gesture, then
        // normalize the box dimensions once at the end.
        const { width: rawWidth, height: rawHeight } = getEditorTextResizeDimensions(
          node.width(),
          node.height(),
          scaleX,
          scaleY
        );
        let finalX = node.x();
        let finalY = node.y();
        const finalWidth = Math.max(EDITOR_TEXT.MIN_BOX_WIDTH, Math.abs(rawWidth));
        const finalHeight = Math.max(EDITOR_TEXT.MIN_BOX_HEIGHT, Math.abs(rawHeight));
        if (rawWidth < 0) finalX += rawWidth;
        if (rawHeight < 0) finalY += rawHeight;

        node.scaleX(1);
        node.scaleY(1);

        // Reset all child positions/scales to final dimensions
        if (node instanceof Konva.Group) {
          for (const child of [
            node.findOne('.text-hit-area'),
            node.findOne('.text-box-border'),
            node.findOne('.text-background'),
            node.findOne('.text-content'),
          ]) {
            if (!child) continue;
            child.x(0);
            child.y(0);
            child.width(finalWidth);
            child.height(finalHeight);
            child.scaleX(1);
            child.scaleY(1);
          }
        }
        node.x(finalX);
        node.y(finalY);
        node.width(finalWidth);
        node.height(finalHeight);

        updates = {
          x: finalX,
          y: finalY,
          width: finalWidth,
          height: finalHeight,
          rotation: node.rotation(),
        };
      } else if (shape.type === 'step') {
        // Step: convert scale to radius
        const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
        const currentRadius = shape.radius ?? 15;
        const newRadius = Math.max(8, currentRadius * avgScale);
        node.scaleX(1);
        node.scaleY(1);
        updates = {
          x: node.x(),
          y: node.y(),
          radius: newRadius,
        };
      } else {
        // Default: convert scale to dimensions
        node.scaleX(1);
        node.scaleY(1);
        updates = {
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
        };
        if (shape.width !== undefined) {
          updates.width = Math.abs(shape.width * scaleX);
        }
        if (shape.height !== undefined) {
          updates.height = Math.abs(shape.height * scaleY);
        }
        if (shape.radiusX !== undefined) {
          updates.radiusX = Math.abs(shape.radiusX * scaleX);
        }
        if (shape.radiusY !== undefined) {
          updates.radiusY = Math.abs(shape.radiusY * scaleY);
        }
        if (shape.radius !== undefined && shape.radiusX === undefined) {
          updates.radiusX = Math.abs(shape.radius * scaleX);
          updates.radiusY = Math.abs(shape.radius * scaleY);
          updates.radius = undefined;
        }
      }

      shapeUpdates.set(shapeId, updates);
    });

    // Apply all updates at once
    if (shapeUpdates.size > 0) {
      const updatedShapes = shapes.map(s => {
        const updates = shapeUpdates.get(s.id);
        return updates ? { ...s, ...updates } : s;
      });
      onShapesChange(updatedShapes);

      // Auto-extend canvas and crop region if shapes moved beyond bounds
      if (canvasBounds && originalImageSize) {
        const expanded = expandBoundsForShapes(canvasBounds, updatedShapes, originalImageSize, cropUserExpanded);
        if (expanded) setCanvasBounds(expanded);
      }
      if (cropRegion) {
        const expandedCrop = expandCropRegionForShapes(cropRegion, updatedShapes, cropUserExpanded);
        if (expandedCrop) setCropRegion(expandedCrop);
      }
    }

    history.commitSnapshot();
  }, [shapeById, transformerRef, history, shapes, onShapesChange, canvasBounds, originalImageSize, cropUserExpanded, setCanvasBounds, cropRegion, setCropRegion]);

  const transformerProps = useMemo(() => ({
    keepRatio: isShiftHeld || hasProportionalShape,
    enabledAnchors: hasProportionalShape
      ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as string[]
      : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center', 'middle-left', 'middle-right'] as string[],
    boundBoxFunc: (oldBox: Box, newBox: Box) => {
      if (newBox.width < 5 || newBox.height < 5) {
        return oldBox;
      }
      return newBox;
    },
    onTransformStart: () => history.takeSnapshot(),
    onTransform,
    onTransformEnd,
  }), [isShiftHeld, hasProportionalShape, history, onTransform, onTransformEnd]);

  return {
    selectionBounds,
    hasProportionalShape,
    handleResetRotation,
    transformerProps,
  };
}
