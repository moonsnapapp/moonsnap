import React, { useRef, useMemo, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Group, Transformer } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { Loader2 } from 'lucide-react';
import { useFastImage } from '../../hooks/useFastImage';
import type { Tool, CanvasShape } from '../../types';
import { useEditorStore, type EditorState } from '../../stores/editorStore';
import { useEditorHistory } from '../../hooks/useEditorHistory';
import { CompositorCssPreview } from './CompositorCssPreview';
import { KonvaBackgroundLayer } from './KonvaBackgroundLayer';

// Hooks
import { useCanvasNavigation } from '../../hooks/useCanvasNavigation';
import { useShapeDrawing } from '../../hooks/useShapeDrawing';
import { useShapeTransform } from '../../hooks/useShapeTransform';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useMarqueeSelection } from '../../hooks/useMarqueeSelection';
import { useCropTool } from '../../hooks/useCropTool';
import { useTextEditing } from '../../hooks/useTextEditing';
import { useMiddleMousePan } from '../../hooks/useMiddleMousePan';
import { useCanvasEventHandlers } from '../../hooks/useCanvasEventHandlers';
import { useCanvasTransformer } from '../../hooks/useCanvasTransformer';
import { useCanvasCompositor } from '../../hooks/useCanvasCompositor';

// Components
import { ShapeRenderer } from './shapes';
// Direct imports avoid barrel file bundling overhead
import { MarqueeSelection } from './overlays/MarqueeSelection';
import { SelectionBoundsRect } from './overlays/SelectionBoundsRect';
import { ZoomControls } from './overlays/ZoomControls';
import { CropControls } from './overlays/CropControls';
import { TextEditorOverlay } from './overlays/TextEditorOverlay';
import { CropOverlay } from './overlays/CropOverlay';
import { ResetRotationButton } from './overlays/ResetRotationButton';

// Utility functions
import {
  expandBoundsForShapes,
  expandCropRegionForShapes,
  ensureBackgroundShape,
  shouldNormalizeBackgroundShape,
  BACKGROUND_SHAPE_ID,
} from '../../utils/canvasGeometry';

interface EditorCanvasProps {
  imageData: string;
  selectedTool: Tool;
  onToolChange: (tool: Tool) => void;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
}

const PIXEL_SNAP_EPSILON = 0.02;
type ClipContext = Parameters<NonNullable<Konva.GroupConfig['clipFunc']>>[0];
type CanvasBoundsRect = { x: number; y: number; width: number; height: number };
type CanvasCompositorState = ReturnType<typeof useCanvasCompositor>;
type CanvasNavigationState = ReturnType<typeof useCanvasNavigation>;
type CanvasDrawingState = ReturnType<typeof useShapeDrawing>;
type CanvasTransformState = ReturnType<typeof useShapeTransform>;
type CanvasEventHandlerState = ReturnType<typeof useCanvasEventHandlers>;
type CanvasTextEditingState = ReturnType<typeof useTextEditing>;
type CanvasPanState = ReturnType<typeof useMiddleMousePan>;
type CanvasCropState = ReturnType<typeof useCropTool>;

function snapInsideStart(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < PIXEL_SNAP_EPSILON) return rounded;
  return Math.ceil(value);
}

function snapInsideEnd(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < PIXEL_SNAP_EPSILON) return rounded;
  return Math.floor(value);
}

function alignBoundsToPixels(bounds: { x: number; y: number; width: number; height: number }) {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  const x = snapInsideStart(left);
  const y = snapInsideStart(top);
  const alignedRight = snapInsideEnd(right);
  const alignedBottom = snapInsideEnd(bottom);

  // Guard against degenerate values from extreme fractional inputs.
  if (alignedRight <= x || alignedBottom <= y) {
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
  }

  return {
    x,
    y,
    width: alignedRight - x,
    height: alignedBottom - y,
  };
}

function getEditorCanvasClassName(selectedTool: Tool) {
  const isDrawingTool = selectedTool !== 'select' && selectedTool !== 'crop' && selectedTool !== 'background';
  return `h-full w-full overflow-hidden relative${isDrawingTool ? ' drawing-tool-active' : ''}`;
}

function getEditorCanvasStyle(isPanning: boolean): React.CSSProperties {
  return {
    backgroundColor: 'var(--polar-mist)',
    cursor: isPanning ? 'grabbing' : undefined,
  };
}

function getCanvasContentStyle(isReady: boolean, isImageLoading: boolean): React.CSSProperties {
  const isInteractive = isReady && !isImageLoading;
  return {
    opacity: isInteractive ? 1 : 0,
    pointerEvents: isInteractive ? 'auto' : 'none',
  };
}

function getZoomControlDimensions({
  selectedTool,
  cropRegion,
  canvasBounds,
  originalImageSize,
}: {
  selectedTool: Tool;
  cropRegion: EditorState['cropRegion'];
  canvasBounds: EditorState['canvasBounds'];
  originalImageSize: EditorState['originalImageSize'];
}) {
  return selectedTool === 'crop' ? null : (cropRegion ?? canvasBounds ?? originalImageSize);
}

function LoadingImageOverlay({ isImageLoading }: { isImageLoading: boolean }) {
  if (!isImageLoading) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 bg-[var(--polar-mist)]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-[var(--accent-400)] animate-spin" />
        <span className="text-sm text-[var(--ink-subtle)]">Loading image...</span>
      </div>
    </div>
  );
}

function getClipProps(
  bounds: CanvasBoundsRect,
  borderRadius: number,
  hasTransparency: boolean
) {
  const radius = !hasTransparency ? borderRadius : 0;
  if (radius <= 0) {
    return {
      clipX: bounds.x,
      clipY: bounds.y,
      clipWidth: bounds.width,
      clipHeight: bounds.height,
    };
  }

  return {
    clipFunc: (ctx: ClipContext) => {
      const r = Math.min(radius, bounds.width / 2, bounds.height / 2);
      ctx.beginPath();
      ctx.moveTo(bounds.x + r, bounds.y);
      ctx.arcTo(bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, r);
      ctx.arcTo(bounds.x + bounds.width, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height, r);
      ctx.arcTo(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y, r);
      ctx.arcTo(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y, r);
      ctx.closePath();
    },
  };
}

interface ClippedShapeLayerProps {
  image: HTMLImageElement | undefined;
  renderBounds: CanvasBoundsRect | null;
  compositorSettings: EditorState['compositorSettings'];
  compositor: CanvasCompositorState;
  shapes: CanvasShape[];
  selectedIds: string[];
  selectedTool: Tool;
  navigation: CanvasNavigationState;
  drawing: CanvasDrawingState;
  pan: CanvasPanState;
  textEditing: CanvasTextEditingState;
  transform: CanvasTransformState;
  eventHandlers: CanvasEventHandlerState;
  history: ReturnType<typeof useEditorHistory>;
}

interface CheckerboardLayerProps {
  renderBounds: CanvasBoundsRect;
  compositorSettings: EditorState['compositorSettings'];
  compositor: CanvasCompositorState;
}

function shouldRenderCheckerboardLayer(
  compositorSettings: EditorState['compositorSettings'],
  compositor: CanvasCompositorState
) {
  return Boolean(
    compositor.checkerPatternImage &&
    !compositorSettings.enabled &&
    compositor.hasTransparency
  );
}

function CheckerboardLayer({
  renderBounds,
  compositorSettings,
  compositor,
}: CheckerboardLayerProps) {
  if (!shouldRenderCheckerboardLayer(compositorSettings, compositor)) return null;

  return (
    <Rect
      name="checkerboard"
      x={renderBounds.x}
      y={renderBounds.y}
      width={renderBounds.width}
      height={renderBounds.height}
      fillPatternImage={compositor.checkerPatternImage ?? undefined}
      fillPatternRepeat="repeat"
      listening={false}
    />
  );
}

function ClippedShapeLayer({
  image,
  renderBounds,
  compositorSettings,
  compositor,
  shapes,
  selectedIds,
  selectedTool,
  navigation,
  drawing,
  pan,
  textEditing,
  transform,
  eventHandlers,
  history,
}: ClippedShapeLayerProps) {
  if (!image || !renderBounds) return null;

  const clipProps = getClipProps(
    renderBounds,
    compositorSettings.enabled ? compositorSettings.borderRadius : 0,
    compositor.hasTransparency
  );

  return (
    <Group {...clipProps}>
      <CheckerboardLayer
        renderBounds={renderBounds}
        compositorSettings={compositorSettings}
        compositor={compositor}
      />
      <ShapeRenderer
        shapes={shapes}
        selectedIds={selectedIds}
        selectedTool={selectedTool}
        zoom={navigation.zoom}
        sourceImage={image}
        isDrawing={drawing.isDrawing}
        isPanning={pan.isPanning}
        editingTextId={textEditing.editingTextId}
        onShapeClick={transform.handleShapeClick}
        onShapeSelect={eventHandlers.handleShapeSelect}
        onDragStart={eventHandlers.handleShapeDragStart}
        onDragEnd={eventHandlers.handleShapeDragEnd}
        onArrowDragEnd={transform.handleArrowDragEnd}
        onTransformStart={transform.handleTransformStart}
        onTransformEnd={transform.handleTransformEnd}
        onArrowEndpointDragEnd={transform.handleArrowEndpointDragEnd}
        onTextMouseDown={eventHandlers.handleTextMouseDown}
        onTextStartEdit={textEditing.startEditing}
        takeSnapshot={history.takeSnapshot}
        commitSnapshot={history.commitSnapshot}
      />
    </Group>
  );
}

interface CanvasBorderProps {
  image: HTMLImageElement | undefined;
  renderBounds: CanvasBoundsRect | null;
  compositorSettings: EditorState['compositorSettings'];
  hasTransparency: boolean;
}

function hasRenderableCanvasBorder(
  image: HTMLImageElement | undefined,
  renderBounds: CanvasBoundsRect | null,
  compositorSettings: EditorState['compositorSettings']
) {
  return Boolean(image && renderBounds && compositorSettings.enabled && compositorSettings.borderOpacity > 0);
}

function getCanvasBorderRenderData({
  image,
  renderBounds,
  compositorSettings,
}: Pick<CanvasBorderProps, 'image' | 'renderBounds' | 'compositorSettings'>) {
  if (!hasRenderableCanvasBorder(image, renderBounds, compositorSettings) || !renderBounds) return null;

  return {
    renderBounds,
    halfStroke: compositorSettings.borderWidth / 2,
  };
}

function CanvasBorder({
  image,
  renderBounds,
  compositorSettings,
  hasTransparency,
}: CanvasBorderProps) {
  const border = getCanvasBorderRenderData({ image, renderBounds, compositorSettings });
  if (!border) {
    return null;
  }

  return (
    <Rect
      x={border.renderBounds.x - border.halfStroke}
      y={border.renderBounds.y - border.halfStroke}
      width={border.renderBounds.width + compositorSettings.borderWidth}
      height={border.renderBounds.height + compositorSettings.borderWidth}
      cornerRadius={hasTransparency ? 0 : compositorSettings.borderRadius + border.halfStroke}
      stroke={compositorSettings.borderColor}
      strokeWidth={compositorSettings.borderWidth}
      opacity={compositorSettings.borderOpacity / 100}
      listening={false}
    />
  );
}

interface EditorCropControlsProps {
  selectedTool: Tool;
  canvasBounds: EditorState['canvasBounds'];
  cropRegion: EditorState['cropRegion'];
  minCropResetBounds: CanvasBoundsRect | null;
  crop: CanvasCropState;
  navigation: CanvasNavigationState;
  onToolChange: (tool: Tool) => void;
  onReset: () => void;
}

function areCanvasBoundsEqual(a: CanvasBoundsRect, b: CanvasBoundsRect) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function hasModifiedCropRegion(
  cropRegion: EditorState['cropRegion'],
  minCropResetBounds: CanvasBoundsRect | null
) {
  if (!cropRegion || !minCropResetBounds) return false;
  return !areCanvasBoundsEqual(cropRegion, minCropResetBounds);
}

function commitCropSelection(
  onToolChange: (tool: Tool) => void,
  navigation: CanvasNavigationState
) {
  onToolChange('select');
  navigation.handleFitToSize();
}

function EditorCropControls({
  selectedTool,
  canvasBounds,
  cropRegion,
  minCropResetBounds,
  crop,
  navigation,
  onToolChange,
  onReset,
}: EditorCropControlsProps) {
  if (selectedTool !== 'crop' || !canvasBounds) return null;

  const displayBounds = crop.getDisplayBounds();
  const artboardModified = hasModifiedCropRegion(cropRegion, minCropResetBounds);

  return (
    <CropControls
      width={displayBounds.width}
      height={displayBounds.height}
      isModified={artboardModified}
      onCancel={() => onToolChange('select')}
      onReset={onReset}
      onCommit={() => commitCropSelection(onToolChange, navigation)}
    />
  );
}

function isPointSelectionShape(shape: CanvasShape) {
  return ['pen', 'arrow', 'line'].includes(shape.type) && shape.points && shape.points.length >= 2;
}

function moveShapePoints(points: number[], dx: number, dy: number) {
  return points.map((val, index) => (index % 2 === 0 ? val + dx : val + dy));
}

function resetMovedPointNodePosition(shapeId: string, layerRef: React.RefObject<Konva.Layer | null>) {
  layerRef.current?.findOne(`#${shapeId}`)?.position({ x: 0, y: 0 });
}

function movePointSelectionShape(
  shape: CanvasShape,
  dx: number,
  dy: number,
  layerRef: React.RefObject<Konva.Layer | null>
): CanvasShape {
  resetMovedPointNodePosition(shape.id, layerRef);
  return {
    ...shape,
    points: moveShapePoints(shape.points ?? [], dx, dy),
  };
}

function moveBoxSelectionShape(shape: CanvasShape, dx: number, dy: number): CanvasShape {
  return {
    ...shape,
    x: (shape.x ?? 0) + dx,
    y: (shape.y ?? 0) + dy,
  };
}

function moveSelectionShape(
  shape: CanvasShape,
  selectedSet: Set<string>,
  dx: number,
  dy: number,
  layerRef: React.RefObject<Konva.Layer | null>
): CanvasShape {
  if (!selectedSet.has(shape.id)) {
    return shape;
  }

  if (isPointSelectionShape(shape)) {
    return movePointSelectionShape(shape, dx, dy, layerRef);
  }

  return moveBoxSelectionShape(shape, dx, dy);
}

interface EditorSelectionBoundsProps {
  transformer: ReturnType<typeof useCanvasTransformer>;
  selectedTool: Tool;
  selectedIds: string[];
  selectedSet: Set<string>;
  layerRef: React.RefObject<Konva.Layer | null>;
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
  history: ReturnType<typeof useEditorHistory>;
  canvasBounds: EditorState['canvasBounds'];
  originalImageSize: EditorState['originalImageSize'];
  cropRegion: EditorState['cropRegion'];
  cropUserExpanded: boolean;
  setCanvasBounds: EditorState['setCanvasBounds'];
  setCropRegion: EditorState['setCropRegion'];
}

function getExpandedCanvasBoundsForSelection({
  canvasBounds,
  updatedShapes,
  originalImageSize,
  cropUserExpanded,
}: {
  canvasBounds: EditorState['canvasBounds'];
  updatedShapes: CanvasShape[];
  originalImageSize: EditorState['originalImageSize'];
  cropUserExpanded: boolean;
}) {
  if (!canvasBounds || !originalImageSize) return null;
  return expandBoundsForShapes(canvasBounds, updatedShapes, originalImageSize, cropUserExpanded);
}

function getExpandedCropRegionForSelection({
  cropRegion,
  updatedShapes,
  cropUserExpanded,
}: {
  cropRegion: EditorState['cropRegion'];
  updatedShapes: CanvasShape[];
  cropUserExpanded: boolean;
}) {
  if (!cropRegion) return null;
  return expandCropRegionForShapes(cropRegion, updatedShapes, cropUserExpanded);
}

function EditorSelectionBounds({
  transformer,
  selectedTool,
  selectedIds,
  selectedSet,
  layerRef,
  shapes,
  onShapesChange,
  history,
  canvasBounds,
  originalImageSize,
  cropRegion,
  cropUserExpanded,
  setCanvasBounds,
  setCropRegion,
}: EditorSelectionBoundsProps) {
  if (!transformer.selectionBounds || selectedTool !== 'select') {
    return null;
  }

  const handleDragEnd = (dx: number, dy: number) => {
    const updatedShapes = shapes.map((shape) =>
      moveSelectionShape(shape, selectedSet, dx, dy, layerRef)
    );
    onShapesChange(updatedShapes);

    const expanded = getExpandedCanvasBoundsForSelection({
      canvasBounds,
      updatedShapes,
      originalImageSize,
      cropUserExpanded,
    });
    if (expanded) setCanvasBounds(expanded);

    const expandedCrop = getExpandedCropRegionForSelection({
      cropRegion,
      updatedShapes,
      cropUserExpanded,
    });
    if (expandedCrop) setCropRegion(expandedCrop);

    history.commitSnapshot();
  };

  return (
    <SelectionBoundsRect
      bounds={transformer.selectionBounds}
      isDraggable={true}
      selectedIds={selectedIds}
      layerRef={layerRef}
      onDragStart={() => history.takeSnapshot()}
      onDragEnd={handleDragEnd}
    />
  );
}

function getEditorVisibleBounds({
  image,
  selectedTool,
  backgroundShape,
  cropRegion,
}: {
  image: HTMLImageElement | undefined;
  selectedTool: Tool;
  backgroundShape: CanvasShape | undefined;
  cropRegion: EditorState['cropRegion'];
}): CanvasBoundsRect | null {
  if (!image) return null;

  const imageBounds = getVisiblePixelBounds(backgroundShape, image);
  if (!imageBounds) return null;

  return selectedTool === 'crop'
    ? getCropToolVisibleBounds(imageBounds, cropRegion)
    : getDefaultToolVisibleBounds(image, cropRegion);
}

function getDefaultToolVisibleBounds(
  image: HTMLImageElement,
  cropRegion: EditorState['cropRegion']
) {
  return cropRegion ?? { x: 0, y: 0, width: image.width, height: image.height };
}

function getCropToolVisibleBounds(
  imageBounds: CanvasBoundsRect,
  cropRegion: EditorState['cropRegion']
) {
  return cropRegion ? getBoundsUnion(imageBounds, cropRegion) : imageBounds;
}

function getBoundsUnion(a: CanvasBoundsRect, b: CanvasBoundsRect): CanvasBoundsRect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  return {
    x: minX,
    y: minY,
    width: Math.max(a.x + a.width, b.x + b.width) - minX,
    height: Math.max(a.y + a.height, b.y + b.height) - minY,
  };
}

function getBackgroundShapeBounds(
  backgroundShape: CanvasShape,
  fallbackSize: { width: number; height: number } | null | undefined
): CanvasBoundsRect {
  const defaults = getBackgroundShapeBoundsDefaults(fallbackSize);

  return {
    x: getCanvasBoundValue(backgroundShape.x, defaults.x),
    y: getCanvasBoundValue(backgroundShape.y, defaults.y),
    width: getCanvasBoundValue(backgroundShape.width, defaults.width),
    height: getCanvasBoundValue(backgroundShape.height, defaults.height),
  };
}

function getCanvasBoundValue(value: number | undefined, fallback: number) {
  return value ?? fallback;
}

function getBackgroundShapeBoundsDefaults(
  fallbackSize: { width: number; height: number } | null | undefined
): CanvasBoundsRect {
  if (!fallbackSize) {
    return ZERO_CANVAS_BOUNDS;
  }

  return {
    x: 0,
    y: 0,
    width: fallbackSize.width,
    height: fallbackSize.height,
  };
}

const ZERO_CANVAS_BOUNDS: CanvasBoundsRect = { x: 0, y: 0, width: 0, height: 0 };

function getImageSizeBounds(imageSize: { width: number; height: number }): CanvasBoundsRect {
  return { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
}

function getVisiblePixelBounds(
  backgroundShape: CanvasShape | undefined,
  image: HTMLImageElement | undefined
): CanvasBoundsRect | null {
  if (backgroundShape) {
    return getBackgroundShapeBounds(backgroundShape, image);
  }

  return image ? getImageSizeBounds(image) : null;
}

function getMinCropResetBounds(
  backgroundShape: CanvasShape | undefined,
  originalImageSize: EditorState['originalImageSize']
): CanvasBoundsRect | null {
  if (backgroundShape) {
    return alignBoundsToPixels(getBackgroundShapeBounds(backgroundShape, originalImageSize));
  }

  return originalImageSize ? getImageSizeBounds(originalImageSize) : null;
}

function getCanvasBoundsForCropReset(
  minCropResetBounds: CanvasBoundsRect,
  canvasBounds: EditorState['canvasBounds']
): EditorState['canvasBounds'] | null {
  if (!canvasBounds) {
    return null;
  }

  const resetBounds = {
    width: minCropResetBounds.width,
    height: minCropResetBounds.height,
    imageOffsetX: -minCropResetBounds.x,
    imageOffsetY: -minCropResetBounds.y,
  };

  return areEditorCanvasBoundsEqual(resetBounds, canvasBounds) ? null : resetBounds;
}

function hasLoadedImageSize(image: HTMLImageElement | undefined): image is HTMLImageElement {
  return Boolean(image && image.width > 0 && image.height > 0);
}

function areEditorCanvasBoundsEqual(
  a: NonNullable<EditorState['canvasBounds']>,
  b: NonNullable<EditorState['canvasBounds']>
) {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.imageOffsetX === b.imageOffsetX &&
    a.imageOffsetY === b.imageOffsetY
  );
}

function normalizeBackgroundShapeForImage({
  image,
  shapes,
  onShapesChange,
}: {
  image: HTMLImageElement;
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
}) {
  if (shouldNormalizeBackgroundShape(shapes, image.width, image.height)) {
    onShapesChange(ensureBackgroundShape(shapes, image.width, image.height));
  }
}

function shouldInitializeCropRegion(cropRegion: EditorState['cropRegion']) {
  return !cropRegion || cropRegion.width <= 0 || cropRegion.height <= 0;
}

function initializeCropRegionForImage(
  image: HTMLImageElement,
  setCropRegion: EditorState['setCropRegion']
) {
  setCropRegion({ x: 0, y: 0, width: image.width, height: image.height });
}

function initializeEditorCanvasImage({
  image,
  imageInitRef,
  shapes,
  cropRegion,
  onShapesChange,
  setCropRegion,
}: {
  image: HTMLImageElement | undefined;
  imageInitRef: React.MutableRefObject<boolean>;
  shapes: CanvasShape[];
  cropRegion: EditorState['cropRegion'];
  onShapesChange: (shapes: CanvasShape[]) => void;
  setCropRegion: EditorState['setCropRegion'];
}) {
  if (!hasLoadedImageSize(image) || imageInitRef.current) return;

  imageInitRef.current = true;
  normalizeBackgroundShapeForImage({ image, shapes, onShapesChange });
  if (shouldInitializeCropRegion(cropRegion)) {
    initializeCropRegionForImage(image, setCropRegion);
  }
}

function useEditorCanvasImage({
  imageData,
  shapes,
  cropRegion,
  onShapesChange,
  setCropRegion,
}: {
  imageData: string;
  shapes: CanvasShape[];
  cropRegion: EditorState['cropRegion'];
  onShapesChange: (shapes: CanvasShape[]) => void;
  setCropRegion: EditorState['setCropRegion'];
}) {
  const imageSource = getEditorCanvasImageSource(imageData);
  const [fastImage, fastImageStatus] = useFastImage(imageSource.rgbaPath);
  const [standardImage, standardImageStatus] = useImage(imageSource.imageUrl);
  const image = getEditorCanvasImage(imageSource, fastImage, standardImage);
  const imageStatus = getEditorCanvasImageStatus(
    imageSource,
    fastImageStatus,
    standardImageStatus
  );
  const imageInitRef = useRef(false);

  useEffect(() => {
    initializeEditorCanvasImage({
      image,
      imageInitRef,
      shapes,
      cropRegion,
      onShapesChange,
      setCropRegion,
    });
  }, [image, shapes, cropRegion, onShapesChange, setCropRegion]);

  return {
    image,
    isImageLoading: imageStatus === 'loading',
  };
}

function getEditorCanvasImageSource(imageData: string) {
  const isRgbaFile = imageData.endsWith('.rgba');
  return {
    isRgbaFile,
    rgbaPath: isRgbaFile ? imageData : null,
    imageUrl: isRgbaFile ? '' : `data:image/png;base64,${imageData}`,
  };
}

function getEditorCanvasImage(
  imageSource: ReturnType<typeof getEditorCanvasImageSource>,
  fastImage: unknown,
  standardImage: unknown
) {
  return (imageSource.isRgbaFile ? fastImage : standardImage) as HTMLImageElement | undefined;
}

function getEditorCanvasImageStatus(
  imageSource: ReturnType<typeof getEditorCanvasImageSource>,
  fastImageStatus: string,
  standardImageStatus: string
) {
  return imageSource.isRgbaFile ? fastImageStatus : standardImageStatus;
}

function useEditorCanvasBounds({
  image,
  selectedTool,
  backgroundShape,
  cropRegion,
  originalImageSize,
}: {
  image: HTMLImageElement | undefined;
  selectedTool: Tool;
  backgroundShape: CanvasShape | undefined;
  cropRegion: EditorState['cropRegion'];
  originalImageSize: EditorState['originalImageSize'];
}) {
  const visibleBounds = useMemo(
    () => getEditorVisibleBounds({ image, selectedTool, backgroundShape, cropRegion }),
    [backgroundShape, cropRegion, image, selectedTool]
  );
  const renderBounds = useMemo(
    () => (visibleBounds ? alignBoundsToPixels(visibleBounds) : null),
    [visibleBounds]
  );
  const visiblePixelBounds = useMemo(
    () => getVisiblePixelBounds(backgroundShape, image),
    [backgroundShape, image]
  );
  const fitToCenterBounds = useMemo(
    () => (selectedTool === 'crop' ? visiblePixelBounds : renderBounds),
    [selectedTool, visiblePixelBounds, renderBounds]
  );
  const minCropResetBounds = useMemo(
    () => getMinCropResetBounds(backgroundShape, originalImageSize),
    [backgroundShape, originalImageSize]
  );

  return {
    visibleBounds,
    renderBounds,
    fitToCenterBounds,
    minCropResetBounds,
  };
}

/** Ref handle exposed by EditorCanvas for imperative operations */
export interface EditorCanvasRef {
  /** Force-finalize any in-progress drawing and return the current shapes.
   *  Call this before saving to ensure no shapes are lost to race conditions. */
  finalizeAndGetShapes: () => CanvasShape[];
}

function useDevicePixelRatio() {
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    const updatePixelRatio = () => {
      const newRatio = window.devicePixelRatio || 1;
      if (newRatio !== pixelRatio) {
        setPixelRatio(newRatio);
      }
    };

    const mediaQuery = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    mediaQuery.addEventListener('change', updatePixelRatio);

    return () => {
      mediaQuery.removeEventListener('change', updatePixelRatio);
    };
  }, [pixelRatio]);

  return pixelRatio;
}

function useCropResetHandler({
  minCropResetBounds,
  canvasBounds,
  setCanvasBounds,
  setCropRegion,
  setCropUserExpanded,
  navigation,
}: {
  minCropResetBounds: CanvasBoundsRect | null;
  canvasBounds: EditorState['canvasBounds'];
  setCanvasBounds: EditorState['setCanvasBounds'];
  setCropRegion: EditorState['setCropRegion'];
  setCropUserExpanded: EditorState['setCropUserExpanded'];
  navigation: CanvasNavigationState;
}) {
  const resetCropCanvasBounds = React.useCallback(() => {
    if (!minCropResetBounds || !canvasBounds) return;

    const resetCanvasBounds = getCanvasBoundsForCropReset(minCropResetBounds, canvasBounds);
    if (resetCanvasBounds) {
      setCanvasBounds(resetCanvasBounds);
    }
  }, [minCropResetBounds, canvasBounds, setCanvasBounds]);

  const resetCropRegion = React.useCallback(() => {
    if (!minCropResetBounds) return;

    setCropRegion(minCropResetBounds);
    navigation.handleFitToRect(minCropResetBounds);
  }, [minCropResetBounds, setCropRegion, navigation]);

  return React.useCallback(() => {
    resetCropCanvasBounds();
    resetCropRegion();
    setCropUserExpanded(false);
  }, [resetCropCanvasBounds, resetCropRegion, setCropUserExpanded]);
}

function EditorCompositorPreview({
  compositor,
  compositorBgRef,
  compositorSettings,
  navigation,
}: {
  compositor: ReturnType<typeof useCanvasCompositor>;
  compositorBgRef: React.RefObject<HTMLDivElement | null>;
  compositorSettings: EditorState['compositorSettings'];
  navigation: CanvasNavigationState;
}) {
  if (!compositor.compositionBox) {
    return null;
  }

  return (
    <CompositorCssPreview
      previewRef={compositorBgRef}
      settings={compositorSettings}
      compositionBox={compositor.compositionBox}
      zoom={navigation.zoom}
      backgroundStyle={compositor.compositionBackgroundStyle}
      hasTransparency={compositor.hasTransparency}
    />
  );
}

function EditorCropOverlay({
  selectedTool,
  canvasBounds,
  crop,
  navigation,
  isShiftHeld,
  isPanning,
}: {
  selectedTool: Tool;
  canvasBounds: EditorState['canvasBounds'];
  crop: CanvasCropState;
  navigation: CanvasNavigationState;
  isShiftHeld: boolean;
  isPanning: boolean;
}) {
  if (selectedTool !== 'crop' || !canvasBounds) {
    return null;
  }

  return (
    <CropOverlay
      displayBounds={crop.getDisplayBounds()}
      baseBounds={crop.getBaseBounds()}
      zoom={navigation.zoom}
      position={navigation.position}
      isShiftHeld={isShiftHeld}
      isPanning={isPanning}
      snapGuides={crop.snapGuides}
      onCenterDragStart={crop.handleCenterDragStart}
      onCenterDragMove={crop.handleCenterDragMove}
      onCenterDragEnd={crop.handleCenterDragEnd}
      onEdgeDragStart={crop.handleEdgeDragStart}
      onEdgeDragMove={crop.handleEdgeDragMove}
      onEdgeDragEnd={crop.handleEdgeDragEnd}
      onCornerDragStart={crop.handleCornerDragStart}
      onCornerDragMove={crop.handleCornerDragMove}
      onCornerDragEnd={crop.handleCornerDragEnd}
    />
  );
}

function EditorTextOverlay({
  textEditing,
}: {
  textEditing: ReturnType<typeof useTextEditing>;
}) {
  if (!textEditing.editingTextId) {
    return null;
  }

  return (
    <TextEditorOverlay
      position={textEditing.getTextareaPosition()}
      value={textEditing.editingTextValue}
      onChange={textEditing.handleTextChange}
      onSave={textEditing.handleSaveTextEdit}
    />
  );
}

export const EditorCanvas = React.memo(forwardRef<EditorCanvasRef, EditorCanvasProps>(({
  imageData,
  selectedTool,
  onToolChange,
  strokeColor,
  fillColor,
  strokeWidth,
  shapes,
  onShapesChange,
  stageRef,
}, ref) => {
  // Refs
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const compositorBgRef = useRef<HTMLDivElement>(null);
  const isShapeDraggingRef = useRef(false);

  const pixelRatio = useDevicePixelRatio();


  // Store state
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
  const compositorSettings = useEditorStore((state) => state.compositorSettings);
  const setCompositorSettings = useEditorStore((state) => state.setCompositorSettings);
  const blurType = useEditorStore((state) => state.blurType);
  const blurAmount = useEditorStore((state) => state.blurAmount);
  const canvasBounds = useEditorStore((state) => state.canvasBounds);
  const setCanvasBounds = useEditorStore((state) => state.setCanvasBounds);
  const setOriginalImageSize = useEditorStore((state) => state.setOriginalImageSize);
  const originalImageSize = useEditorStore((state) => state.originalImageSize);
  const cropRegion = useEditorStore((state) => state.cropRegion);
  const setCropRegion = useEditorStore((state) => state.setCropRegion);
  const cropUserExpanded = useEditorStore((state) => state.cropUserExpanded);
  const setCropUserExpanded = useEditorStore((state) => state.setCropUserExpanded);

  // Context-aware history actions for undo/redo
  const history = useEditorHistory();

  const { image, isImageLoading } = useEditorCanvasImage({
    imageData,
    shapes,
    cropRegion,
    onShapesChange,
    setCropRegion,
  });
  // Find the background shape for crop snap targets and visible-bound calculations
  const backgroundShape = React.useMemo(
    () => shapes.find(s => s.id === BACKGROUND_SHAPE_ID),
    [shapes]
  );

  const {
    visibleBounds,
    renderBounds,
    fitToCenterBounds,
    minCropResetBounds,
  } = useEditorCanvasBounds({
    image,
    selectedTool,
    backgroundShape,
    cropRegion,
    originalImageSize,
  });
  // Navigation hook
  const navigation = useCanvasNavigation({
    image,
    imageData,
    compositorSettings,
    compositorVisibleOrigin: renderBounds ? { x: renderBounds.x, y: renderBounds.y } : null,
    canvasBounds,
    setCanvasBounds,
    setOriginalImageSize,
    selectedTool,
    cropRegion,
    fitVisibleBounds: fitToCenterBounds,
    compositorBgRef,
  });


  // Keyboard shortcuts hook
  const { isShiftHeld } = useKeyboardShortcuts({
    selectedIds,
    shapes,
    onShapesChange,
    setSelectedIds,
    recordAction: history.recordAction,
    getCanvasPosition: navigation.getCanvasPosition,
    containerSize: navigation.containerSize,
    setSelectedTool: onToolChange,
  });

  // Middle mouse panning hook (also handles left-click pan in move tool)
  const pan = useMiddleMousePan({
    position: navigation.position,
    setPosition: (pos) => navigation.setPosition(pos),
    containerRef: navigation.containerRef as React.RefObject<HTMLDivElement>,
    stageRef,
    compositorBgRef,
    // Pass refs for coordinated CSS transforms with zoom
    renderedPositionRef: navigation.renderedPositionRef,
    renderedZoomRef: navigation.renderedZoomRef,
    transformCoeffsRef: navigation.transformCoeffsRef,
    leftClickPan: false,
  });

  // Text editing hook
  const textEditing = useTextEditing({
    shapes,
    onShapesChange,
    zoom: navigation.zoom,
    position: navigation.position,
    containerRef: navigation.containerRef,
    stageRef,
  });

  // Shape transform hook
  const transform = useShapeTransform({
    shapes,
    onShapesChange,
    selectedIds,
    setSelectedIds,
    history,
    canvasBounds,
    setCanvasBounds,
    originalImageSize,
    cropRegion,
    setCropRegion,
    cropUserExpanded,
  });

  // Font size state for text tool
  const fontSize = useEditorStore((state) => state.fontSize);

  // Shape drawing hook
  const drawing = useShapeDrawing({
    selectedTool,
    strokeColor,
    fillColor,
    strokeWidth,
    fontSize,
    blurType,
    blurAmount,
    shapes,
    onShapesChange,
    setSelectedIds,
    stageRef,
    getCanvasPosition: navigation.getCanvasPosition,
    onTextShapeCreated: (shapeId) => {
      // New text shapes always start empty; avoid shape lookup on creation path.
      textEditing.startEditing(shapeId, '');
    },
    history,
  });

  // Expose imperative methods via ref
  useImperativeHandle(ref, () => ({
    finalizeAndGetShapes: drawing.finalizeAndGetShapes,
  }), [drawing.finalizeAndGetShapes]);

  // Marquee selection hook
  const marquee = useMarqueeSelection({
    shapes,
    setSelectedIds,
  });

  // Crop tool hook — now sets cropRegion (export bounds) instead of canvasBounds
  const crop = useCropTool({
    canvasBounds,
    setCropRegion,
    cropRegion,
    isShiftHeld,
    zoom: navigation.zoom,
    backgroundShape,
    originalImageSize,
    history,
    setCropUserExpanded,
  });

  const handleCropReset = useCropResetHandler({
    minCropResetBounds,
    canvasBounds,
    setCanvasBounds,
    setCropRegion,
    setCropUserExpanded,
    navigation,
  });

  // Listen for crop-reset event (R key in crop mode)
  useEffect(() => {
    const handler = () => handleCropReset();
    window.addEventListener('crop-reset', handler);
    return () => window.removeEventListener('crop-reset', handler);
  }, [handleCropReset]);

  // Compositor hook
  const compositor = useCanvasCompositor({
    image,
    compositorSettings,
    setCompositorSettings,
    visibleBounds,
    cropRegion,
    canvasBounds,
    backgroundShape,
    renderBounds,
    navigation,
  });

  // Fast lookup maps for selection/transformer paths.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const shapeById = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape] as const)), [shapes]);

  // Event handlers hook
  const eventHandlers = useCanvasEventHandlers({
    stageRef,
    transformerRef,
    layerRef,
    selectedTool,
    setSelectedIds,
    selectedIds,
    selectedSet,
    shapeById,
    navigation,
    drawing,
    marquee,
    textEditing,
    transform,
    isShapeDraggingRef,
  });

  // Transformer hook
  const transformer = useCanvasTransformer({
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
  });

  // Disable image smoothing for crisp 1:1 pixel rendering at 100% zoom
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const handleBeforeDraw = () => {
      const ctx = layer.getCanvas().getContext()._context;
      // Keep smoothing disabled to avoid zoom-dependent edge seams on clipped image bounds.
      ctx.imageSmoothingEnabled = false;
    };

    layer.on('beforeDraw', handleBeforeDraw);
    return () => {
      layer.off('beforeDraw', handleBeforeDraw);
    };
  }, [navigation.zoom]);

  return (
    <div
      ref={navigation.containerRef}
      className={getEditorCanvasClassName(selectedTool)}
      style={getEditorCanvasStyle(pan.isPanning)}
      onMouseDown={pan.handleMiddleMouseDown}
      onMouseMove={pan.handleMiddleMouseMove}
      onMouseUp={pan.handleMiddleMouseUp}
      onMouseLeave={pan.handleMiddleMouseUp}
    >
      <LoadingImageOverlay isImageLoading={isImageLoading} />

      {/* Canvas content wrapper - fades in when ready to avoid position flash */}
      <div
        className="absolute inset-0 transition-opacity duration-150"
        style={getCanvasContentStyle(navigation.isReady, isImageLoading)}
      >
      <EditorCompositorPreview
        compositor={compositor}
        compositorBgRef={compositorBgRef}
        compositorSettings={compositorSettings}
        navigation={navigation}
      />


      {/* Canvas Stage */}
      <Stage
        ref={stageRef}
        width={navigation.containerSize.width}
        height={navigation.containerSize.height}
        pixelRatio={pixelRatio}
        onMouseDown={eventHandlers.handleMouseDown}
        onMouseMove={eventHandlers.handleMouseMove}
        onMouseUp={eventHandlers.handleMouseUp}
        onWheel={navigation.handleWheel}
        scaleX={navigation.zoom}
        scaleY={navigation.zoom}
        x={navigation.position.x}
        y={navigation.position.y}
        style={{ backgroundColor: 'transparent' }}
      >
        <Layer ref={layerRef}>
          {/* Background layer: editor shadow when compositor disabled (skip shadow if transparent) */}
          {!compositorSettings.enabled && !compositor.hasTransparency && (
            <KonvaBackgroundLayer
              settings={compositorSettings}
              visibleBounds={renderBounds}
              baseCompositionSize={compositor.baseCompositionSize}
            />
          )}

          <ClippedShapeLayer
            image={image}
            renderBounds={renderBounds}
            compositorSettings={compositorSettings}
            compositor={compositor}
            shapes={shapes}
            selectedIds={selectedIds}
            selectedTool={selectedTool}
            navigation={navigation}
            drawing={drawing}
            pan={pan}
            textEditing={textEditing}
            transform={transform}
            eventHandlers={eventHandlers}
            history={history}
          />
          {/* Border on screenshot content - grows outward, not into content */}
          <CanvasBorder
            image={image}
            renderBounds={renderBounds}
            compositorSettings={compositorSettings}
            hasTransparency={compositor.hasTransparency}
          />
          {/* Marquee selection rectangle */}
          <MarqueeSelection
            isActive={marquee.isMarqueeSelecting}
            start={marquee.marqueeStart}
            end={marquee.marqueeEnd}
            zoom={navigation.zoom}
          />

          <EditorCropOverlay
            selectedTool={selectedTool}
            canvasBounds={canvasBounds}
            crop={crop}
            navigation={navigation}
            isShiftHeld={isShiftHeld}
            isPanning={pan.isPanning}
          />

          <EditorSelectionBounds
            transformer={transformer}
            selectedTool={selectedTool}
            selectedIds={selectedIds}
            selectedSet={selectedSet}
            layerRef={layerRef}
            shapes={shapes}
            onShapesChange={onShapesChange}
            history={history}
            canvasBounds={canvasBounds}
            originalImageSize={originalImageSize}
            cropRegion={cropRegion}
            cropUserExpanded={cropUserExpanded}
            setCanvasBounds={setCanvasBounds}
            setCropRegion={setCropRegion}
          />

          <Transformer
            ref={transformerRef}
            name="transformer"
            {...transformer.transformerProps}
          />
          <ResetRotationButton
            transformerRef={transformerRef}
            zoom={navigation.zoom}
            onReset={transformer.handleResetRotation}
          />
        </Layer>
      </Stage>
      </div>

      <EditorCropControls
        selectedTool={selectedTool}
        canvasBounds={canvasBounds}
        cropRegion={cropRegion}
        minCropResetBounds={minCropResetBounds}
        crop={crop}
        navigation={navigation}
        onToolChange={onToolChange}
        onReset={handleCropReset}
      />
      <EditorTextOverlay textEditing={textEditing} />

      {/* Zoom Controls */}
      <ZoomControls
        zoom={navigation.zoom}
        onZoomIn={navigation.handleZoomIn}
        onZoomOut={navigation.handleZoomOut}
        onFitToSize={navigation.handleFitToSize}
        onActualSize={navigation.handleActualSize}
        dimensions={getZoomControlDimensions({
          selectedTool,
          cropRegion,
          canvasBounds,
          originalImageSize,
        })}
        cropActive={selectedTool === 'crop'}
      />
    </div>
  );
}));
