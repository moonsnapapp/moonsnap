import React, { useRef, useMemo, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Group, Transformer } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { Loader2 } from 'lucide-react';
import { useFastImage } from '../../hooks/useFastImage';
import type { Tool, CanvasShape } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { useEditorHistory } from '../../hooks/useEditorHistory';
import { CompositorBackground } from './CompositorBackground';
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
import { getSelectionBounds, expandBoundsForShapes, expandCropRegionForShapes, ensureBackgroundShape, BACKGROUND_SHAPE_ID, createCheckerPattern } from '../../utils/canvasGeometry';

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
const TEXT_MANUAL_DRAG_EPSILON = 0.01;
type ClipContext = Parameters<NonNullable<Konva.GroupConfig['clipFunc']>>[0];

interface ManualTextDragState {
  shapeId: string;
  node: Konva.Node;
  startPointer: { x: number; y: number };
  startPosition: { x: number; y: number };
  activated: boolean;
  drewFirstFrame: boolean;
}

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

  // Track device pixel ratio for crisp HiDPI rendering
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);
  const isShapeDraggingRef = useRef(false);
  const preTextDragHideRef = useRef(false);
  const manualTextDragRef = useRef<ManualTextDragState | null>(null);

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
  const failedWallpaperResolveRef = useRef<string | null>(null);

  // Auto-resolve wallpaper URL so default/loaded wallpaper backgrounds initialize
  // without requiring a manual wallpaper click in the Style tab.
  useEffect(() => {
    if (compositorSettings.backgroundType !== 'wallpaper') return;
    if (!compositorSettings.wallpaper) return;
    if (compositorSettings.backgroundImage) {
      failedWallpaperResolveRef.current = null;
      return;
    }
    if (failedWallpaperResolveRef.current === compositorSettings.wallpaper) return;

    let isCancelled = false;
    const [theme, name] = compositorSettings.wallpaper.split('/');
    if (!theme || !name) return;

    void resolveResource(`assets/backgrounds/${theme}/${name}.jpg`)
      .then((resolvedPath) => {
        if (isCancelled) return;
        failedWallpaperResolveRef.current = null;
        setCompositorSettings({ backgroundImage: convertFileSrc(resolvedPath) });
      })
      .catch(() => {
        if (!isCancelled) {
          failedWallpaperResolveRef.current = compositorSettings.wallpaper;
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    compositorSettings.backgroundType,
    compositorSettings.wallpaper,
    compositorSettings.backgroundImage,
    setCompositorSettings,
  ]);

  // Checkerboard pattern for transparency indication (created once, cached)
  const [checkerPatternImage] = useState(() => createCheckerPattern());

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
    leftClickPan: selectedTool === 'move',
  });

  // Text editing hook
  const textEditing = useTextEditing({
    shapes,
    onShapesChange,
    zoom: navigation.zoom,
    position: navigation.position,
    containerRef: navigation.containerRef,
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
    onToolChange,
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


  // Check if source image has transparent pixels (only recalculated when image changes).
  const imageHasAlpha = useMemo(() => {
    if (!image) return false;
    const size = 20;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  }, [image]);

  // Detect if the content has ANY transparency (edges or interior).
  // When true, skip shadow/border-radius to avoid the floaty look.
  // Checks both preview bounds (visibleBounds) and export bounds (canvasBounds).
  const hasTransparency = useMemo(() => {
    const bgX = backgroundShape?.x ?? 0;
    const bgY = backgroundShape?.y ?? 0;
    const bgW = backgroundShape?.width ?? (image?.width ?? 0);
    const bgH = backgroundShape?.height ?? (image?.height ?? 0);


    // Helper: do given bounds extend beyond the background shape?
    const extendsBeyondBg = (bx: number, by: number, bw: number, bh: number) =>
      bx < bgX - 0.5 || by < bgY - 0.5 ||
      bx + bw > bgX + bgW + 0.5 || by + bh > bgY + bgH + 0.5;

    // Check 1: preview clip extends beyond background (user sees transparent areas)
    if (visibleBounds && extendsBeyondBg(visibleBounds.x, visibleBounds.y, visibleBounds.width, visibleBounds.height)) {
      return true;
    }

    // Check 2: export bounds extend beyond background (export would have transparency).
    // Must match getContentBounds() in canvasExport.ts for preview/export consistency.
    if (cropRegion && extendsBeyondBg(cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height)) {
      return true;
    }
    if (!cropRegion && canvasBounds) {
      const ex = -canvasBounds.imageOffsetX;
      const ey = -canvasBounds.imageOffsetY;
      if (extendsBeyondBg(ex, ey, canvasBounds.width, canvasBounds.height)) {
        return true;
      }
    }

    // Check 3: source image itself has transparent pixels (cached by image identity)
    if (imageHasAlpha) return true;

    return false;
  }, [visibleBounds, cropRegion, canvasBounds, backgroundShape, imageHasAlpha]);

  // Selection bounds for group drag
  const selectionBounds = useMemo(() => {
    if (selectedIds.length <= 1) return null;
    return getSelectionBounds(shapes, selectedIds);
  }, [shapes, selectedIds]);

  // Fast lookup maps for selection/transformer paths.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const shapeById = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape] as const)), [shapes]);

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
  const handleResetRotation = React.useCallback(() => {
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
  }, [history, onShapesChange, selectedSet, shapes]);

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
  }, [drawing.isDrawing, selectedIds, selectedTool, shapeById, textEditing.editingTextId]);

  // Handle mouse events
  const handleMouseDown = React.useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Ignore if middle mouse button
      if (e.evt.button === 1) return;

      // Handle drawing tools
      if (drawing.handleDrawingMouseDown(e)) {
        return;
      }

      // Handle crop tool
      if (selectedTool === 'crop') return;

      // Handle select tool - start marquee or click on stage
      if (selectedTool === 'select') {
        // Only the stage itself counts as empty space (background is now a selectable shape)
        const clickedOnStage = e.target === e.target.getStage();

        if (clickedOnStage) {
          setSelectedIds([]);

          // While editing text, empty-click should only close editor/deselect.
          // Skip marquee setup to avoid unnecessary shape intersection work.
          if (textEditing.editingTextId) {
            return;
          }

          const stage = stageRef.current;
          if (stage) {
            const screenPos = stage.getPointerPosition();
            if (screenPos) {
              const pos = navigation.getCanvasPosition(screenPos);
              marquee.startMarquee(pos);
            }
          }
        }
      }
    },
    [drawing, selectedTool, setSelectedIds, marquee, stageRef, navigation, textEditing.editingTextId]
  );

  const updateManualTextDrag = React.useCallback((pointer: { x: number; y: number }): boolean => {
    const manualTextDrag = manualTextDragRef.current;
    if (!manualTextDrag) return false;

    const dx = pointer.x - manualTextDrag.startPointer.x;
    const dy = pointer.y - manualTextDrag.startPointer.y;
    if (Math.abs(dx) <= TEXT_MANUAL_DRAG_EPSILON && Math.abs(dy) <= TEXT_MANUAL_DRAG_EPSILON) {
      return true;
    }

    if (!manualTextDrag.activated) {
      manualTextDrag.activated = true;
      isShapeDraggingRef.current = true;

      // Defer transformer hide to actual movement to keep mousedown path minimal.
      const tr = transformerRef.current;
      if (tr?.visible()) {
        tr.visible(false);
        preTextDragHideRef.current = true;
      }
    }

    manualTextDrag.node.position({
      x: manualTextDrag.startPosition.x + dx,
      y: manualTextDrag.startPosition.y + dy,
    });

    const dragLayer = manualTextDrag.node.getLayer();
    if (dragLayer) {
      manualTextDrag.drewFirstFrame = true;
      dragLayer.batchDraw();
    }

    return true;
  }, []);

  const handleMouseMove = React.useCallback(
    (_e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;

      const screenPos = stage.getPointerPosition();
      if (!screenPos) return;

      const pos = navigation.getCanvasPosition(screenPos);

      if (updateManualTextDrag(pos)) {
        return;
      }

      // Drawing move (also handles pending → drawing transition on drag threshold)
      if (drawing.isDrawing || (selectedTool !== 'move' && selectedTool !== 'select' && selectedTool !== 'crop' && selectedTool !== 'background')) {
        drawing.handleDrawingMouseMove(pos);
        return;
      }

      // Marquee move
      if (marquee.isMarqueeSelecting) {
        marquee.updateMarquee(pos);
      }
    },
    [drawing, marquee, navigation, stageRef, selectedTool, updateManualTextDrag]
  );

  const handleShapeSelect = React.useCallback((id: string) => {
    setSelectedIds([id]);
  }, [setSelectedIds]);

  const shapeDragStart = transform.handleShapeDragStart;
  const shapeDragEnd = transform.handleShapeDragEnd;
  const commitManualDragDelta = transform.commitManualDragDelta;

  const reattachTransformerToSelection = React.useCallback(() => {
    const tr = transformerRef.current;
    const layer = layerRef.current;
    if (!tr || !layer || drawing.isDrawing || textEditing.editingTextId || selectedTool !== 'select') return;

    const selectedNow = selectedIds;
    const isMultiSelect = selectedNow.length > 1;
    const nodes = selectedNow
      .filter((shapeId) => {
        if (isMultiSelect) return true;
        const shape = shapeById.get(shapeId);
        return shape && shape.type !== 'arrow' && shape.type !== 'line';
      })
      .map((shapeId) => layer.findOne(`#${shapeId}`))
      .filter((node): node is Konva.Node => node !== null && node !== undefined);

    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [drawing.isDrawing, selectedIds, selectedTool, shapeById, textEditing.editingTextId]);

  const handleTextMouseDown = React.useCallback((shapeId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt?.button !== 0 || selectedTool !== 'select') return;
    if (textEditing.editingTextId === shapeId) return;
    if (selectedIds.length > 1) return;
    // Preserve double-click editing path.
    if (e.evt.detail >= 2) return;

    // Keep stage handlers out of this path and run manual drag for selected text.
    e.cancelBubble = true;

    // Ensure first-gesture drag works even when the shape was not selected yet.
    if (!selectedSet.has(shapeId) || selectedIds.length !== 1) {
      setSelectedIds([shapeId]);
    }

    const dragNode = e.currentTarget as Konva.Node | null;
    const stage = stageRef.current;
    const screenPos = stage?.getPointerPosition();
    if (!dragNode || !screenPos) return;

    manualTextDragRef.current = {
      shapeId,
      node: dragNode,
      startPointer: navigation.getCanvasPosition(screenPos),
      startPosition: { x: dragNode.x(), y: dragNode.y() },
      activated: false,
      drewFirstFrame: false,
    };
  }, [navigation, selectedIds.length, selectedSet, selectedTool, setSelectedIds, stageRef, textEditing.editingTextId]);

  const handleMouseUp = React.useCallback(() => {
    const manualTextDrag = manualTextDragRef.current;
    if (manualTextDrag) {
      manualTextDragRef.current = null;
      const wasDragging = manualTextDrag.activated;
      isShapeDraggingRef.current = false;
      preTextDragHideRef.current = false;

      const dx = manualTextDrag.node.x() - manualTextDrag.startPosition.x;
      const dy = manualTextDrag.node.y() - manualTextDrag.startPosition.y;
      if (wasDragging && (Math.abs(dx) > TEXT_MANUAL_DRAG_EPSILON || Math.abs(dy) > TEXT_MANUAL_DRAG_EPSILON)) {
        commitManualDragDelta(manualTextDrag.shapeId, dx, dy);
      }

      if (wasDragging) {
        requestAnimationFrame(() => {
          const tr = transformerRef.current;
          if (tr) {
            tr.visible(true);
          }
          reattachTransformerToSelection();
        });
      }
      return;
    }

    // Finish drawing or click-to-place (always call - it no-ops when idle)
    drawing.handleDrawingMouseUp();
    // Finish marquee
    if (marquee.isMarqueeSelecting) {
      marquee.finishMarquee();
    }
    // Restore transformer if we hid it for a forced text drag that never started.
    if (preTextDragHideRef.current && !isShapeDraggingRef.current) {
      preTextDragHideRef.current = false;
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(true);
      }
    }
  }, [commitManualDragDelta, drawing, marquee, reattachTransformerToSelection]);

  useEffect(() => {
    const handleWindowMouseMove = (evt: MouseEvent) => {
      if (!manualTextDragRef.current) return;
      const stage = stageRef.current;
      if (!stage) return;

      const rect = stage.container().getBoundingClientRect();
      const pointer = navigation.getCanvasPosition({
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top,
      });

      updateManualTextDrag(pointer);
    };

    const handleWindowMouseUp = () => {
      if (!manualTextDragRef.current) return;
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove, true);
    window.addEventListener('mouseup', handleWindowMouseUp, true);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove, true);
      window.removeEventListener('mouseup', handleWindowMouseUp, true);
    };
  }, [handleMouseUp, navigation, stageRef, updateManualTextDrag]);

  const handleShapeDragStart = React.useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    // Hide transformer during drag to reduce overlay work on text-heavy scenes.
    if (e.evt?.button !== 1) {
      isShapeDraggingRef.current = true;
      preTextDragHideRef.current = false;
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(false);
      }
    }
    shapeDragStart(id, e);
  }, [shapeDragStart]);

  const handleShapeDragEnd = React.useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    shapeDragEnd(id, e);
    isShapeDraggingRef.current = false;
    requestAnimationFrame(() => {
      const tr = transformerRef.current;
      if (tr) {
        tr.visible(true);
      }
      reattachTransformerToSelection();
    });
  }, [shapeDragEnd, reattachTransformerToSelection]);

  // Composition box dimensions (for CSS preview background)
  // Simple calculation: content size + padding on each side, scaled by zoom
  const compositionBox = useMemo(() => {
    if (!compositorSettings.enabled || !renderBounds) return null;

    const padding = compositorSettings.padding * navigation.zoom;
    const contentWidth = renderBounds.width * navigation.zoom;
    const contentHeight = renderBounds.height * navigation.zoom;

    // Position: content position in screen space, offset by padding
    const left = navigation.position.x + renderBounds.x * navigation.zoom - padding;
    const top = navigation.position.y + renderBounds.y * navigation.zoom - padding;
    const width = contentWidth + padding * 2;
    const height = contentHeight + padding * 2;

    return { width, height, left, top };
  }, [compositorSettings.enabled, compositorSettings.padding, renderBounds, navigation.zoom, navigation.position]);

  // Base composition size for consistent background scaling
  const baseCompositionSize = useMemo(() => {
    if (!renderBounds) return { width: 0, height: 0 };

    const padding = compositorSettings.padding;

    return {
      width: renderBounds.width + padding * 2,
      height: renderBounds.height + padding * 2,
    };
  }, [renderBounds, compositorSettings.padding]);

  // Background style for composition box
  const compositionBackgroundStyle = useMemo((): React.CSSProperties => {
    if (!compositorSettings.enabled) return {};

    let backgroundColor: string | undefined;
    let backgroundImage: string | undefined;
    let backgroundSize: string = 'cover';

    switch (compositorSettings.backgroundType) {
      case 'solid':
        backgroundColor = compositorSettings.backgroundColor;
        break;
      case 'gradient': {
        backgroundImage = `linear-gradient(${compositorSettings.gradientAngle}deg, ${compositorSettings.gradientStart}, ${compositorSettings.gradientEnd})`;
        break;
      }
      case 'wallpaper':
      case 'image':
        backgroundImage = compositorSettings.backgroundImage
          ? `url(${compositorSettings.backgroundImage})`
          : undefined;
        backgroundColor = compositorSettings.backgroundImage ? undefined : '#1a1a2e';
        // Use 'cover' to match Konva's calculateCoverSize behavior
        backgroundSize = 'cover';
        break;
      default:
        backgroundColor = '#1a1a2e';
    }

    return {
      backgroundColor,
      backgroundImage,
      backgroundSize,
      backgroundPosition: 'center',
    };
  }, [
    compositorSettings.enabled,
    compositorSettings.backgroundType,
    compositorSettings.backgroundColor,
    compositorSettings.backgroundImage,
    compositorSettings.gradientStart,
    compositorSettings.gradientEnd,
    compositorSettings.gradientAngle,
  ]);

  return (
    <div
      ref={navigation.containerRef}
      className={`h-full w-full overflow-hidden relative${
        selectedTool !== 'move' && selectedTool !== 'select' && selectedTool !== 'crop' && selectedTool !== 'background'
          ? ' drawing-tool-active'
          : ''
      }`}
      style={{
        backgroundColor: 'var(--polar-mist)',
        cursor: pan.isPanning ? 'grabbing' : selectedTool === 'move' ? 'grab' : undefined,
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
      {compositionBox && (
        <CompositorCssPreview
          previewRef={compositorBgRef}
          settings={compositorSettings}
          compositionBox={compositionBox}
          zoom={navigation.zoom}
          backgroundStyle={compositionBackgroundStyle}
          hasTransparency={hasTransparency}
        />
      )}


      {/* Canvas Stage */}
      <Stage
        ref={stageRef}
        width={navigation.containerSize.width}
        height={navigation.containerSize.height}
        pixelRatio={pixelRatio}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={navigation.handleWheel}
        scaleX={navigation.zoom}
        scaleY={navigation.zoom}
        x={navigation.position.x}
        y={navigation.position.y}
        style={{ backgroundColor: 'transparent' }}
      >
        <Layer ref={layerRef}>
          {/* Background layer: editor shadow when compositor disabled (skip shadow if transparent) */}
          {!compositorSettings.enabled && !hasTransparency && (
            <KonvaBackgroundLayer
              settings={compositorSettings}
              visibleBounds={renderBounds}
              baseCompositionSize={baseCompositionSize}
            />
          )}

          {/* Cropped canvas content - only render when visibleBounds is ready */}
          {image && renderBounds && (() => {
            const clipX = renderBounds.x;
            const clipY = renderBounds.y;
            const clipW = renderBounds.width;
            const clipH = renderBounds.height;
            const radius = (compositorSettings.enabled && !hasTransparency) ? compositorSettings.borderRadius : 0;
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
                {checkerPatternImage && !compositorSettings.enabled && hasTransparency && (
                  <Rect
                    name="checkerboard"
                    x={clipX}
                    y={clipY}
                    width={clipW}
                    height={clipH}
                    fillPatternImage={checkerPatternImage}
                    fillPatternRepeat="repeat"
                    listening={false}
                  />
                )}
                {/* Inner clip background — named for export removal so compositor.ts can detect transparency */}
                {compositorSettings.enabled && (
                  <CompositorBackground
                    name="compositor-bg"
                    settings={compositorSettings}
                    bounds={{ x: clipX, y: clipY, width: clipW, height: clipH }}
                    borderRadius={0}
                  />
                )}
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
                  onShapeSelect={handleShapeSelect}
                  onDragStart={handleShapeDragStart}
                  onDragEnd={handleShapeDragEnd}
                  onArrowDragEnd={transform.handleArrowDragEnd}
                  onTransformStart={transform.handleTransformStart}
                  onTransformEnd={transform.handleTransformEnd}
                  onArrowEndpointDragEnd={transform.handleArrowEndpointDragEnd}
                  onTextMouseDown={handleTextMouseDown}
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
                cornerRadius={hasTransparency ? 0 : compositorSettings.borderRadius + halfStroke}
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
          {selectionBounds && selectedTool === 'select' && (
            <SelectionBoundsRect
              bounds={selectionBounds}
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
            keepRatio={isShiftHeld || hasProportionalShape}
            enabledAnchors={hasProportionalShape
              ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
              : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center', 'middle-left', 'middle-right']
            }
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox;
              }
              return newBox;
            }}
            onTransformStart={() => history.takeSnapshot()}
            onTransform={() => {
              // Convert scale to dimensions in real-time to prevent stroke scaling during resize
              const nodes = transformerRef.current?.nodes() || [];
              nodes.forEach(node => {
                const shape = shapeById.get(node.id());
                if (!shape) return;

                const scaleX = node.scaleX();
                const scaleY = node.scaleY();

                if (shape.type === 'text') {
                  // Read current dimensions from node (not React state)
                  const currentWidth = node.width();
                  const currentHeight = node.height();

                  // Allow negative dimensions for crossover (like rect behavior)
                  // Don't clamp to minimum during drag - only at the end
                  const newWidth = currentWidth * scaleX;
                  const newHeight = currentHeight * scaleY;

                  // Update Group dimensions and reset scale
                  node.width(newWidth);
                  node.height(newHeight);
                  node.scaleX(1);
                  node.scaleY(1);

                  // Also update child elements with absolute values for rendering
                  const group = node as Konva.Group;
                  const border = group.findOne('.text-box-border');
                  const textContent = group.findOne('.text-content');
                  const absWidth = Math.abs(newWidth);
                  const absHeight = Math.abs(newHeight);
                  if (border) {
                    border.width(absWidth);
                    border.height(absHeight);
                    // Offset for negative dimensions
                    border.x(newWidth < 0 ? newWidth : 0);
                    border.y(newHeight < 0 ? newHeight : 0);
                  }
                  if (textContent) {
                    textContent.width(absWidth);
                    textContent.height(absHeight);
                    textContent.x(newWidth < 0 ? newWidth : 0);
                    textContent.y(newHeight < 0 ? newHeight : 0);
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
            }}
            onTransformEnd={() => {
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
                  // Text: normalize negative dimensions
                  const rawWidth = node.width();
                  const rawHeight = node.height();
                  let finalX = node.x();
                  let finalY = node.y();
                  const finalWidth = Math.max(50, Math.abs(rawWidth));
                  const finalHeight = Math.max(24, Math.abs(rawHeight));
                  if (rawWidth < 0) finalX += rawWidth;
                  if (rawHeight < 0) finalY += rawHeight;

                  // Reset child positions
                  if (node instanceof Konva.Group) {
                    const border = node.findOne('.text-box-border');
                    const textContent = node.findOne('.text-content');
                    if (border) {
                      border.x(0);
                      border.y(0);
                      border.width(finalWidth);
                      border.height(finalHeight);
                    }
                    if (textContent) {
                      textContent.x(0);
                      textContent.y(0);
                      textContent.width(finalWidth);
                      textContent.height(finalHeight);
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
            }}
          />
          <ResetRotationButton
            transformerRef={transformerRef}
            zoom={navigation.zoom}
            onReset={handleResetRotation}
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
              onToolChange('move');
            }}
            onReset={() => {
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
                // Fit to the known target bounds directly (avoids stale closure)
                navigation.handleFitToRect(minCropResetBounds);
              }
              setCropUserExpanded(false);
            }}
            onCommit={() => {
              onToolChange('move');
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
          onCancel={textEditing.handleCancelTextEdit}
        />
      )}

      {/* Zoom Controls */}
      <ZoomControls
        zoom={navigation.zoom}
        onZoomIn={navigation.handleZoomIn}
        onZoomOut={navigation.handleZoomOut}
        onFitToSize={navigation.handleFitToSize}
        onActualSize={navigation.handleActualSize}
      />
    </div>
  );
}));
