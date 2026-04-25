import React, { useRef, useMemo, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Group, Transformer } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { Loader2 } from 'lucide-react';
import { useFastImage } from '../../hooks/useFastImage';
import type { Tool, CanvasShape } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
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
import { expandBoundsForShapes, expandCropRegionForShapes, ensureBackgroundShape, BACKGROUND_SHAPE_ID } from '../../utils/canvasGeometry';

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

/** Ref handle exposed by EditorCanvas for imperative operations */
export interface EditorCanvasRef {
  /** Force-finalize any in-progress drawing and return the current shapes.
   *  Call this before saving to ensure no shapes are lost to race conditions. */
  finalizeAndGetShapes: () => CanvasShape[];
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

  // Track device pixel ratio for crisp HiDPI rendering
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);

  // Update pixelRatio when DPI changes (e.g., window moved between monitors)
  useEffect(() => {
    const updatePixelRatio = () => {
      const newRatio = window.devicePixelRatio || 1;
      if (newRatio !== pixelRatio) {
        setPixelRatio(newRatio);
      }
    };

    // Listen for DPI changes
    const mediaQuery = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    mediaQuery.addEventListener('change', updatePixelRatio);

    return () => {
      mediaQuery.removeEventListener('change', updatePixelRatio);
    };
  }, [pixelRatio]);


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

  // Load image - use fast path for RGBA files, standard path for base64
  const isRgbaFile = imageData.endsWith('.rgba');
  const imageUrl = isRgbaFile ? null : `data:image/png;base64,${imageData}`;

  // Use fast image hook for RGBA files (skips PNG encoding entirely!)
  // Returns HTMLCanvasElement for RGBA, which Konva supports directly
  const [fastImage, fastImageStatus] = useFastImage(isRgbaFile ? imageData : null);
  // Use standard hook for base64 data
  const [standardImage, standardImageStatus] = useImage(imageUrl ?? '');

  // Use whichever image is loaded (Konva accepts both HTMLImageElement and HTMLCanvasElement)
  const image = (isRgbaFile ? fastImage : standardImage) as HTMLImageElement | undefined;
  const imageStatus = isRgbaFile ? fastImageStatus : standardImageStatus;
  const isImageLoading = imageStatus === 'loading';

  // Ensure background shape and artboard exist when image loads (for fresh captures).
  // Intentionally depends only on `image` — we only want this to run once when the
  // image first becomes available, not on every shapes/cropRegion change.
  const imageInitRef = useRef(false);
  React.useEffect(() => {
    if (!image || imageInitRef.current) return;
    imageInitRef.current = true;

    const hasBackground = shapes.some(s => s.id === BACKGROUND_SHAPE_ID);
    if (!hasBackground) {
      onShapesChange(ensureBackgroundShape(shapes, image.width, image.height));
    }
    // Initialize artboard (cropRegion) to image dimensions if not set
    if (!cropRegion) {
      setCropRegion({ x: 0, y: 0, width: image.width, height: image.height });
    }
  }, [image, shapes, cropRegion, onShapesChange, setCropRegion]);

  // Find the background shape for crop snap targets and visible-bound calculations
  const backgroundShape = React.useMemo(
    () => shapes.find(s => s.id === BACKGROUND_SHAPE_ID),
    [shapes]
  );

  // Visible bounds for clipping and compositor preview positioning.
  // In crop mode, show full extent so the crop overlay can dim outside areas.
  const visibleBounds = useMemo(() => {
    if (!image) return null;
    if (selectedTool === 'crop') {
      const imgX = backgroundShape?.x ?? 0;
      const imgY = backgroundShape?.y ?? 0;
      const imgW = backgroundShape?.width ?? image.width;
      const imgH = backgroundShape?.height ?? image.height;
      if (cropRegion) {
        return {
          x: Math.min(imgX, cropRegion.x),
          y: Math.min(imgY, cropRegion.y),
          width: Math.max(imgX + imgW, cropRegion.x + cropRegion.width) - Math.min(imgX, cropRegion.x),
          height: Math.max(imgY + imgH, cropRegion.y + cropRegion.height) - Math.min(imgY, cropRegion.y),
        };
      }
      return { x: imgX, y: imgY, width: imgW, height: imgH };
    }
    if (cropRegion) return cropRegion;
    return { x: 0, y: 0, width: image.width, height: image.height };
  }, [backgroundShape, cropRegion, image, selectedTool]);

  // Pixel-aligned bounds for all preview rendering paths (clip/background/border).
  const renderBounds = useMemo(
    () => (visibleBounds ? alignBoundsToPixels(visibleBounds) : null),
    [visibleBounds]
  );

  // Visible pixel bounds (background image extents).
  const visiblePixelBounds = useMemo(() => {
    if (backgroundShape) {
      return {
        x: backgroundShape.x ?? 0,
        y: backgroundShape.y ?? 0,
        width: backgroundShape.width ?? (image?.width ?? 0),
        height: backgroundShape.height ?? (image?.height ?? 0),
      };
    }

    if (image) {
      return { x: 0, y: 0, width: image.width, height: image.height };
    }

    return null;
  }, [backgroundShape, image]);

  // F-key framing target:
  // - In crop mode: frame source visible pixels (full image extents)
  // - Outside crop mode: frame current visible result (crop/artboard bounds)
  const fitToCenterBounds = useMemo(
    () => (selectedTool === 'crop' ? visiblePixelBounds : renderBounds),
    [selectedTool, visiblePixelBounds, renderBounds]
  );

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

  // Reset target: exact background image bounds (pixel-aligned).
  const minCropResetBounds = useMemo(() => {
    if (backgroundShape) {
      return alignBoundsToPixels({
        x: backgroundShape.x ?? 0,
        y: backgroundShape.y ?? 0,
        width: backgroundShape.width ?? (originalImageSize?.width ?? 0),
        height: backgroundShape.height ?? (originalImageSize?.height ?? 0),
      });
    }

    if (originalImageSize) {
      return { x: 0, y: 0, width: originalImageSize.width, height: originalImageSize.height };
    }

    return null;
  }, [backgroundShape, originalImageSize]);

  // Reset crop to minimum bounds (background image extents)
  const handleCropReset = React.useCallback(() => {
    if (minCropResetBounds && canvasBounds) {
      const minCanvasBoundsForReset = {
        width: minCropResetBounds.width,
        height: minCropResetBounds.height,
        imageOffsetX: -minCropResetBounds.x,
        imageOffsetY: -minCropResetBounds.y,
      };
      const boundsChanged =
        minCanvasBoundsForReset.width !== canvasBounds.width ||
        minCanvasBoundsForReset.height !== canvasBounds.height ||
        minCanvasBoundsForReset.imageOffsetX !== canvasBounds.imageOffsetX ||
        minCanvasBoundsForReset.imageOffsetY !== canvasBounds.imageOffsetY;
      if (boundsChanged) {
        setCanvasBounds(minCanvasBoundsForReset);
      }
    }
    if (minCropResetBounds) {
      setCropRegion(minCropResetBounds);
      navigation.handleFitToRect(minCropResetBounds);
    }
    setCropUserExpanded(false);
  }, [minCropResetBounds, canvasBounds, setCanvasBounds, setCropRegion, setCropUserExpanded, navigation]);

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
      className={`h-full w-full overflow-hidden relative${
        selectedTool !== 'select' && selectedTool !== 'crop' && selectedTool !== 'background'
          ? ' drawing-tool-active'
          : ''
      }`}
      style={{
        backgroundColor: 'var(--polar-mist)',
        cursor: pan.isPanning ? 'grabbing' : undefined,
      }}
      onMouseDown={pan.handleMiddleMouseDown}
      onMouseMove={pan.handleMiddleMouseMove}
      onMouseUp={pan.handleMiddleMouseUp}
      onMouseLeave={pan.handleMiddleMouseUp}
    >
      {/* Loading overlay - shown while image loads */}
      {isImageLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-[var(--polar-mist)]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-[var(--coral-400)] animate-spin" />
            <span className="text-sm text-[var(--ink-subtle)]">Loading image...</span>
          </div>
        </div>
      )}

      {/* Canvas content wrapper - fades in when ready to avoid position flash */}
      <div
        className="absolute inset-0 transition-opacity duration-150"
        style={{
          opacity: navigation.isReady && !isImageLoading ? 1 : 0,
          pointerEvents: navigation.isReady && !isImageLoading ? 'auto' : 'none',
        }}
      >
      {/* Composition Preview Background */}
      {compositor.compositionBox && (
        <CompositorCssPreview
          previewRef={compositorBgRef}
          settings={compositorSettings}
          compositionBox={compositor.compositionBox}
          zoom={navigation.zoom}
          backgroundStyle={compositor.compositionBackgroundStyle}
          hasTransparency={compositor.hasTransparency}
        />
      )}


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

          {/* Cropped canvas content - only render when visibleBounds is ready */}
          {image && renderBounds && (() => {
            const clipX = renderBounds.x;
            const clipY = renderBounds.y;
            const clipW = renderBounds.width;
            const clipH = renderBounds.height;
            const radius = (compositorSettings.enabled && !compositor.hasTransparency) ? compositorSettings.borderRadius : 0;
            const clipProps = radius > 0
              ? {
                  clipFunc: (ctx: ClipContext) => {
                    // Use arcTo for circular corners (matches Konva Rect cornerRadius)
                    const r = Math.min(radius, clipW / 2, clipH / 2);
                    ctx.beginPath();
                    ctx.moveTo(clipX + r, clipY);
                    ctx.arcTo(clipX + clipW, clipY, clipX + clipW, clipY + clipH, r);
                    ctx.arcTo(clipX + clipW, clipY + clipH, clipX, clipY + clipH, r);
                    ctx.arcTo(clipX, clipY + clipH, clipX, clipY, r);
                    ctx.arcTo(clipX, clipY, clipX + clipW, clipY, r);
                    ctx.closePath();
                  },
                }
              : {
                  // Axis-aligned rect clipping avoids subpixel anti-alias seams in preview.
                  clipX,
                  clipY,
                  clipWidth: clipW,
                  clipHeight: clipH,
                };

            return (
              <Group {...clipProps}>
                {/* Checkerboard pattern — shows transparent areas, hidden during export by name */}
                {compositor.checkerPatternImage && !compositorSettings.enabled && compositor.hasTransparency && (
                  <Rect
                    name="checkerboard"
                    x={clipX}
                    y={clipY}
                    width={clipW}
                    height={clipH}
                    fillPatternImage={compositor.checkerPatternImage}
                    fillPatternRepeat="repeat"
                    listening={false}
                  />
                )}
                {/* Inner clip background — only needed when compositor is off (checkerboard above handles it).
                   When compositor is enabled, the CSS preview div behind the canvas provides the background
                   seamlessly — transparent Konva pixels let it show through without doubled gradients. */}
                {/* Render shapes (background image is now the first shape) */}
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
          })()}

          {/* Border on screenshot content - grows outward, not into content */}
          {image && renderBounds && compositorSettings.enabled && compositorSettings.borderOpacity > 0 && (() => {
            const halfStroke = compositorSettings.borderWidth / 2;
            return (
              <Rect
                x={renderBounds.x - halfStroke}
                y={renderBounds.y - halfStroke}
                width={renderBounds.width + compositorSettings.borderWidth}
                height={renderBounds.height + compositorSettings.borderWidth}
                cornerRadius={compositor.hasTransparency ? 0 : compositorSettings.borderRadius + halfStroke}
                stroke={compositorSettings.borderColor}
                strokeWidth={compositorSettings.borderWidth}
                opacity={compositorSettings.borderOpacity / 100}
                listening={false}
              />
            );
          })()}

          {/* Marquee selection rectangle */}
          <MarqueeSelection
            isActive={marquee.isMarqueeSelecting}
            start={marquee.marqueeStart}
            end={marquee.marqueeEnd}
            zoom={navigation.zoom}
          />

          {/* Crop tool overlay */}
          {selectedTool === 'crop' && canvasBounds && (
            <CropOverlay
              displayBounds={crop.getDisplayBounds()}
              baseBounds={crop.getBaseBounds()}
              zoom={navigation.zoom}
              position={navigation.position}
              isShiftHeld={isShiftHeld}
              isPanning={pan.isPanning}
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
          )}

          {/* Selection bounds rect for group drag */}
          {transformer.selectionBounds && selectedTool === 'select' && (
            <SelectionBoundsRect
              bounds={transformer.selectionBounds}
              isDraggable={true}
              selectedIds={selectedIds}
              layerRef={layerRef}
              onDragStart={() => history.takeSnapshot()}
              onDragEnd={(dx, dy) => {
                const updatedShapes = shapes.map((shape) => {
                  if (!selectedSet.has(shape.id)) return shape;
                  if (['pen', 'arrow', 'line'].includes(shape.type) && shape.points && shape.points.length >= 2) {
                    // Reset node position (was moved imperatively during drag)
                    const node = layerRef.current?.findOne(`#${shape.id}`);
                    if (node) node.position({ x: 0, y: 0 });
                    const newPoints = shape.points.map((val, i) =>
                      i % 2 === 0 ? val + dx : val + dy
                    );
                    return { ...shape, points: newPoints };
                  }
                  return {
                    ...shape,
                    x: (shape.x ?? 0) + dx,
                    y: (shape.y ?? 0) + dy,
                  };
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

                history.commitSnapshot();
              }}
            />
          )}

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

      {/* Crop Controls */}
      {selectedTool === 'crop' && canvasBounds && (() => {
        const displayBounds = crop.getDisplayBounds();
        const artboardModified = cropRegion !== null && minCropResetBounds !== null && (
          cropRegion.x !== minCropResetBounds.x ||
          cropRegion.y !== minCropResetBounds.y ||
          cropRegion.width !== minCropResetBounds.width ||
          cropRegion.height !== minCropResetBounds.height
        );
        return (
          <CropControls
            width={displayBounds.width}
            height={displayBounds.height}
            isModified={artboardModified}
            onCancel={() => {
              // Just exit crop mode — retain the current crop as-is
              onToolChange('select');
            }}
            onReset={handleCropReset}
            onCommit={() => {
              onToolChange('select');
              // Explicitly fit after crop commit (the useEffect also fires, but this
              // ensures the rAF runs after React has processed the tool change).
              navigation.handleFitToSize();
            }}
          />
        );
      })()}

      {/* Inline Text Editor */}
      {textEditing.editingTextId && (
        <TextEditorOverlay
          position={textEditing.getTextareaPosition()}
          value={textEditing.editingTextValue}
          onChange={textEditing.handleTextChange}
          onSave={textEditing.handleSaveTextEdit}
        />
      )}

      {/* Zoom Controls */}
      <ZoomControls
        zoom={navigation.zoom}
        onZoomIn={navigation.handleZoomIn}
        onZoomOut={navigation.handleZoomOut}
        onFitToSize={navigation.handleFitToSize}
        onActualSize={navigation.handleActualSize}
        dimensions={selectedTool === 'crop' ? null : (cropRegion ?? canvasBounds ?? originalImageSize)}
        cropActive={selectedTool === 'crop'}
      />
    </div>
  );
}));
