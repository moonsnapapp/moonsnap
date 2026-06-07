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

type TransformUpdateGetter = (
  node: Konva.Node,
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
) => Partial<CanvasShape>;

const POINT_TRANSFORM_SHAPES = new Set<CanvasShape['type']>(['pen', 'arrow', 'line']);
const DEFAULT_TRANSFORM_SCALE_FIELDS: Array<{
  key: 'width' | 'height' | 'radiusX' | 'radiusY';
  scale: 'x' | 'y';
}> = [
  { key: 'width', scale: 'x' },
  { key: 'height', scale: 'y' },
  { key: 'radiusX', scale: 'x' },
  { key: 'radiusY', scale: 'y' },
];

function resetNodeScale(node: Konva.Node) {
  node.scaleX(1);
  node.scaleY(1);
}

function getAxisScale(axis: 'x' | 'y', scaleX: number, scaleY: number): number {
  return axis === 'x' ? scaleX : scaleY;
}

function getScaledShapeValue(
  value: number,
  axis: 'x' | 'y',
  scaleX: number,
  scaleY: number
): number {
  return Math.abs(value * getAxisScale(axis, scaleX, scaleY));
}

function resetTextGroupChildren(
  node: Konva.Node,
  width: number,
  height: number
) {
  if (!(node instanceof Konva.Group)) return;

  for (const child of [
    node.findOne('.text-hit-area'),
    node.findOne('.text-box-border'),
    node.findOne('.text-background'),
    node.findOne('.text-content'),
  ]) {
    if (!child) continue;
    child.x(0);
    child.y(0);
    child.width(width);
    child.height(height);
    child.scaleX(1);
    child.scaleY(1);
  }
}

function getPointsTransformUpdates(
  node: Konva.Node,
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
): Partial<CanvasShape> {
  const nodeX = node.x();
  const nodeY = node.y();
  const newPoints = (shape.points ?? []).map((val, i) =>
    i % 2 === 0 ? nodeX + val * scaleX : nodeY + val * scaleY
  );
  resetNodeScale(node);
  node.position({ x: 0, y: 0 });

  return { points: newPoints };
}

function getBlurTransformUpdates(node: Konva.Node): Partial<CanvasShape> {
  return {
    x: node.x(),
    y: node.y(),
    width: node.width(),
    height: node.height(),
  };
}

function getTextTransformUpdates(
  node: Konva.Node,
  scaleX: number,
  scaleY: number
): Partial<CanvasShape> {
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

  resetNodeScale(node);
  resetTextGroupChildren(node, finalWidth, finalHeight);
  node.x(finalX);
  node.y(finalY);
  node.width(finalWidth);
  node.height(finalHeight);

  return {
    x: finalX,
    y: finalY,
    width: finalWidth,
    height: finalHeight,
    rotation: node.rotation(),
  };
}

function getStepTransformUpdates(
  node: Konva.Node,
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
): Partial<CanvasShape> {
  const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
  const currentRadius = shape.radius ?? 15;
  resetNodeScale(node);

  return {
    x: node.x(),
    y: node.y(),
    radius: Math.max(8, currentRadius * avgScale),
  };
}

function getScaledFieldTransformUpdates(
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
): Partial<CanvasShape> {
  const updates: Partial<CanvasShape> = {};

  for (const { key, scale } of DEFAULT_TRANSFORM_SCALE_FIELDS) {
    const value = shape[key];
    if (value !== undefined) {
      updates[key] = getScaledShapeValue(value, scale, scaleX, scaleY);
    }
  }

  return updates;
}

function getLegacyRadiusTransformUpdates(
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
): Partial<CanvasShape> {
  if (shape.radius === undefined || shape.radiusX !== undefined) {
    return {};
  }

  return {
    radiusX: getScaledShapeValue(shape.radius, 'x', scaleX, scaleY),
    radiusY: getScaledShapeValue(shape.radius, 'y', scaleX, scaleY),
    radius: undefined,
  };
}

function getDefaultTransformUpdates(
  node: Konva.Node,
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
): Partial<CanvasShape> {
  resetNodeScale(node);
  const updates: Partial<CanvasShape> = {
    x: node.x(),
    y: node.y(),
    rotation: node.rotation(),
    ...getScaledFieldTransformUpdates(shape, scaleX, scaleY),
    ...getLegacyRadiusTransformUpdates(shape, scaleX, scaleY),
  };

  return updates;
}

const TRANSFORM_UPDATE_GETTERS: Partial<Record<CanvasShape['type'], TransformUpdateGetter>> = {
  blur: getBlurTransformUpdates,
  text: (node, _shape, scaleX, scaleY) => getTextTransformUpdates(node, scaleX, scaleY),
  step: getStepTransformUpdates,
};

function isPointTransformShape(shape: CanvasShape) {
  return POINT_TRANSFORM_SHAPES.has(shape.type) && (shape.points?.length ?? 0) >= 2;
}

function getTransformedShapeUpdates(
  node: Konva.Node,
  shape: CanvasShape
): Partial<CanvasShape> {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  if (isPointTransformShape(shape)) {
    return getPointsTransformUpdates(node, shape, scaleX, scaleY);
  }

  const getUpdates = TRANSFORM_UPDATE_GETTERS[shape.type] ?? getDefaultTransformUpdates;
  return getUpdates(node, shape, scaleX, scaleY);
}

function getLiveTextTransformChildren(node: Konva.Group): Konva.Node[] {
  return [
    node.findOne('.text-content'),
    node.findOne('.text-background'),
    node.findOne('.text-hit-area'),
  ].filter((child): child is Konva.Node => Boolean(child));
}

function applyLiveTextChildTransform(
  child: Konva.Node,
  width: number,
  height: number,
  invScaleX: number,
  invScaleY: number
) {
  child.width(width);
  child.height(height);
  child.scaleX(invScaleX);
  child.scaleY(invScaleY);
  child.x(0);
  child.y(0);
}

function applyLiveTextTransform(
  node: Konva.Node,
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
) {
  if (!(node instanceof Konva.Group)) return;

  const { width: liveWidth, height: liveHeight } = getEditorTextResizeDimensions(
    shape.width,
    shape.height,
    scaleX,
    scaleY
  );
  const width = Math.max(EDITOR_TEXT.MIN_BOX_WIDTH, Math.abs(liveWidth));
  const height = Math.max(EDITOR_TEXT.MIN_BOX_HEIGHT, Math.abs(liveHeight));
  const invScaleX = scaleX === 0 ? 1 : 1 / scaleX;
  const invScaleY = scaleY === 0 ? 1 : 1 / scaleY;

  getLiveTextTransformChildren(node).forEach((child) => {
    applyLiveTextChildTransform(child, width, height, invScaleX, invScaleY);
  });
}

function applyLivePointTransform(node: Konva.Node, scaleX: number, scaleY: number) {
  const line = node.className === 'Group'
    ? (node as Konva.Group).findOne('Line, Arrow') as Konva.Line | undefined
    : node as Konva.Line;
  if (!line) return;

  const points = line.points();
  line.points(points.map((value, index) => value * (index % 2 === 0 ? scaleX : scaleY)));
}

function applyLiveCircleTransform(node: Konva.Node, scaleX: number, scaleY: number) {
  const ellipse = node as unknown as Konva.Ellipse;
  ellipse.radiusX(ellipse.radiusX() * Math.abs(scaleX));
  ellipse.radiusY(ellipse.radiusY() * Math.abs(scaleY));
}

function applyLiveStepTransform(node: Konva.Node, scaleX: number, scaleY: number) {
  const circle = (node as Konva.Group).findOne('Circle') as Konva.Circle | undefined;
  if (!circle) return;

  const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
  circle.radius(circle.radius() * avgScale);
}

function isPointBasedShape(shape: CanvasShape) {
  return (shape.type === 'pen' || shape.type === 'arrow' || shape.type === 'line') && shape.points;
}

function applyLiveBoxTransform(node: Konva.Node, scaleX: number, scaleY: number) {
  node.width(node.width() * scaleX);
  node.height(node.height() * scaleY);
}

function applyLiveScaledGeometry(
  node: Konva.Node,
  shape: CanvasShape,
  scaleX: number,
  scaleY: number
) {
  if (shape.type === 'circle') {
    applyLiveCircleTransform(node, scaleX, scaleY);
  } else if (shape.type === 'step') {
    applyLiveStepTransform(node, scaleX, scaleY);
  } else if (isPointBasedShape(shape)) {
    applyLivePointTransform(node, scaleX, scaleY);
  } else {
    applyLiveBoxTransform(node, scaleX, scaleY);
  }

  resetNodeScale(node);
}

function applyLiveTransformToNode(node: Konva.Node, shape: CanvasShape) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  if (shape.type === 'text') {
    applyLiveTextTransform(node, shape, scaleX, scaleY);
    return;
  }

  if (scaleX !== 1 || scaleY !== 1) {
    applyLiveScaledGeometry(node, shape, scaleX, scaleY);
  }
}

function getShapeUpdatesForNodes(
  nodes: Konva.Node[],
  shapeById: Map<string, CanvasShape>
) {
  const shapeUpdates = new Map<string, Partial<CanvasShape>>();

  for (const node of nodes) {
    const shapeId = node.id();
    const shape = shapeById.get(shapeId);
    if (shape) {
      shapeUpdates.set(shapeId, getTransformedShapeUpdates(node, shape));
    }
  }

  return shapeUpdates;
}

function applyShapeUpdates(
  shapes: CanvasShape[],
  shapeUpdates: Map<string, Partial<CanvasShape>>
) {
  return shapes.map(shape => {
    const updates = shapeUpdates.get(shape.id);
    return updates ? { ...shape, ...updates } : shape;
  });
}

function shouldHideTransformer({
  isDrawing,
  editingTextId,
  selectedTool,
  isShapeDragging,
}: {
  isDrawing: boolean;
  editingTextId: string | null;
  selectedTool: string;
  isShapeDragging: boolean;
}) {
  return isDrawing || Boolean(editingTextId) || selectedTool !== 'select' || isShapeDragging;
}

function canAttachTransformerToShape(
  id: string,
  isMultiSelect: boolean,
  shapeById: Map<string, CanvasShape>
) {
  if (isMultiSelect) return true;

  const shape = shapeById.get(id);
  return Boolean(shape && shape.type !== 'arrow' && shape.type !== 'line');
}

function getTransformerNodes({
  selectedIds,
  layer,
  shapeById,
}: {
  selectedIds: string[];
  layer: Konva.Layer;
  shapeById: Map<string, CanvasShape>;
}) {
  const isMultiSelect = selectedIds.length > 1;
  return selectedIds
    .filter((id) => canAttachTransformerToShape(id, isMultiSelect, shapeById))
    .map((id) => layer.findOne(`#${id}`))
    .filter((node): node is Konva.Node => node !== null && node !== undefined);
}

function expandCanvasAfterTransform({
  canvasBounds,
  originalImageSize,
  updatedShapes,
  cropUserExpanded,
  setCanvasBounds,
}: {
  canvasBounds: CanvasBounds | null;
  originalImageSize: { width: number; height: number } | null;
  updatedShapes: CanvasShape[];
  cropUserExpanded: boolean;
  setCanvasBounds: (bounds: CanvasBounds) => void;
}) {
  if (!canvasBounds || !originalImageSize) return;

  const expanded = expandBoundsForShapes(canvasBounds, updatedShapes, originalImageSize, cropUserExpanded);
  if (expanded) setCanvasBounds(expanded);
}

function expandCropAfterTransform({
  cropRegion,
  updatedShapes,
  cropUserExpanded,
  setCropRegion,
}: {
  cropRegion: { x: number; y: number; width: number; height: number } | null;
  updatedShapes: CanvasShape[];
  cropUserExpanded: boolean;
  setCropRegion: (region: { x: number; y: number; width: number; height: number } | null) => void;
}) {
  if (!cropRegion) return;

  const expandedCrop = expandCropRegionForShapes(cropRegion, updatedShapes, cropUserExpanded);
  if (expandedCrop) setCropRegion(expandedCrop);
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
    const transformer = transformerRef.current;
    const layer = layerRef.current;
    if (!transformer || !layer) return;

    if (shouldHideTransformer({
      isDrawing: drawing.isDrawing,
      editingTextId: textEditing.editingTextId,
      selectedTool,
      isShapeDragging: isShapeDraggingRef.current,
    })) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const nodes = getTransformerNodes({ selectedIds, layer, shapeById });

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [drawing.isDrawing, selectedIds, selectedTool, shapeById, textEditing.editingTextId, transformerRef, layerRef, isShapeDraggingRef]);

  const onTransform = useCallback(() => {
    // Convert scale to dimensions in real-time to prevent stroke scaling during resize
    const nodes = transformerRef.current?.nodes() || [];
    nodes.forEach(node => {
      const shape = shapeById.get(node.id());
      if (!shape) return;

      applyLiveTransformToNode(node, shape);
    });
  }, [shapeById, transformerRef]);

  const onTransformEnd = useCallback(() => {
    // Handle ALL shapes at once to ensure batched history entry
    const nodes = transformerRef.current?.nodes() || [];
    if (nodes.length === 0) {
      history.commitSnapshot();
      return;
    }

    const shapeUpdates = getShapeUpdatesForNodes(nodes, shapeById);

    // Apply all updates at once
    if (shapeUpdates.size > 0) {
      const updatedShapes = applyShapeUpdates(shapes, shapeUpdates);
      onShapesChange(updatedShapes);

      expandCanvasAfterTransform({
        canvasBounds,
        originalImageSize,
        updatedShapes,
        cropUserExpanded,
        setCanvasBounds,
      });
      expandCropAfterTransform({
        cropRegion,
        updatedShapes,
        cropUserExpanded,
        setCropRegion,
      });
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
