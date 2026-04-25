import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShapeDrawing } from './useShapeDrawing';
import type { CanvasShape, Tool } from '../types';
import { EDITOR_TEXT, getEditorTextDefaultBoxHeight, getEditorTextDragBoxHeight } from '../utils/editorText';
import { getArrowRenderPoints } from '../utils/editorArrow';

// Mock Konva
vi.mock('konva', () => ({
  default: {
    Stage: vi.fn(),
    Layer: vi.fn(),
  },
}));

// Helper to create mock props
function createMockProps(overrides: Partial<Parameters<typeof useShapeDrawing>[0]> = {}) {
  const mockStageRef = {
    current: {
      getPointerPosition: vi.fn(() => ({ x: 100, y: 100 })),
      findOne: vi.fn(() => null),
    },
  };

  return {
    selectedTool: 'rect' as Tool,
    onToolChange: vi.fn(),
    strokeColor: '#ff0000',
    fillColor: 'transparent',
    strokeWidth: 2,
    fontSize: 16,
    blurType: 'blur' as const,
    blurAmount: 10,
    shapes: [] as CanvasShape[],
    onShapesChange: vi.fn(),
    setSelectedIds: vi.fn(),
    stageRef: mockStageRef as unknown as React.RefObject<never>,
    getCanvasPosition: vi.fn((pos: { x: number; y: number }) => pos),
    history: {
      takeSnapshot: vi.fn(),
      commitSnapshot: vi.fn(),
      discardSnapshot: vi.fn(),
      recordAction: vi.fn((action: () => void) => action()),
    },
    ...overrides,
  };
}

// Helper to create a mock Konva event
function createMockKonvaEvent(stageRef: { current: unknown }) {
  return {
    evt: { button: 0 },
    target: {
      getStage: () => stageRef.current,
    },
  } as unknown as Parameters<ReturnType<typeof useShapeDrawing>['handleDrawingMouseDown']>[0];
}

describe('useShapeDrawing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should not be drawing initially', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useShapeDrawing(props));

      expect(result.current.isDrawing).toBe(false);
    });
  });

  describe('handleDrawingMouseDown', () => {
    it('should return false for select tool', () => {
      const props = createMockProps({ selectedTool: 'select' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      let handled: boolean = false;

      act(() => {
        handled = result.current.handleDrawingMouseDown(event);
      });

      expect(handled).toBe(false);
      expect(result.current.isDrawing).toBe(false);
    });

    it('should return false for crop tool', () => {
      const props = createMockProps({ selectedTool: 'crop' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      let handled: boolean = false;

      act(() => {
        handled = result.current.handleDrawingMouseDown(event);
      });

      expect(handled).toBe(false);
    });

    it('should start drawing for rect tool', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      let handled: boolean = false;

      act(() => {
        handled = result.current.handleDrawingMouseDown(event);
      });

      // mouseDown returns true (handled) but defers drawing to mouseMove
      expect(handled).toBe(true);
      expect(result.current.isDrawing).toBe(false);
      expect(props.history.takeSnapshot).not.toHaveBeenCalled();

      // Drawing starts after drag threshold is exceeded
      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
      expect(props.history.takeSnapshot).toHaveBeenCalled();
    });

    it('should start drawing for arrow tool', () => {
      const props = createMockProps({ selectedTool: 'arrow' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(false);

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
    });

    it('should start drawing for circle tool', () => {
      const props = createMockProps({ selectedTool: 'circle' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(false);

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
    });

    it('should start drawing for pen tool', () => {
      const props = createMockProps({ selectedTool: 'pen' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(false);

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
    });

    it('should start drawing for text tool', () => {
      const props = createMockProps({ selectedTool: 'text' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(true);
      expect(props.history.takeSnapshot).toHaveBeenCalled();
      expect(props.onShapesChange).toHaveBeenCalled();
    });

    it('should start drawing for highlight tool', () => {
      const props = createMockProps({ selectedTool: 'highlight' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(false);

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
    });

    it('should start drawing for blur tool', () => {
      const props = createMockProps({ selectedTool: 'blur' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(false);

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
    });

    it('should start drawing for line tool', () => {
      const props = createMockProps({ selectedTool: 'line' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(result.current.isDrawing).toBe(false);

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      expect(result.current.isDrawing).toBe(true);
    });
  });

  describe('steps tool (click-to-place)', () => {
    it('should create step shape immediately on click', () => {
      const props = createMockProps({ selectedTool: 'steps' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Steps tool creates shape immediately without entering drawing mode
      expect(result.current.isDrawing).toBe(false);
      expect(props.onShapesChange).toHaveBeenCalled();
      expect(props.setSelectedIds).toHaveBeenCalled();
    });

    it('should assign sequential step numbers', () => {
      const existingShapes: CanvasShape[] = [
        { id: 'step1', type: 'step', x: 50, y: 50, number: 1, fill: '#ff0000', radius: 15 },
        { id: 'step2', type: 'step', x: 100, y: 100, number: 2, fill: '#ff0000', radius: 15 },
      ];
      const props = createMockProps({ selectedTool: 'steps', shapes: existingShapes });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Should create step with number 3
      const callArg = props.onShapesChange.mock.calls[0][0];
      const newStep = callArg[callArg.length - 1];
      expect(newStep.type).toBe('step');
      expect(newStep.number).toBe(3);
    });

    it('should fill gaps in step numbers', () => {
      const existingShapes: CanvasShape[] = [
        { id: 'step1', type: 'step', x: 50, y: 50, number: 1, fill: '#ff0000', radius: 15 },
        { id: 'step3', type: 'step', x: 100, y: 100, number: 3, fill: '#ff0000', radius: 15 },
      ];
      const props = createMockProps({ selectedTool: 'steps', shapes: existingShapes });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Should fill gap with number 2
      const callArg = props.onShapesChange.mock.calls[0][0];
      const newStep = callArg[callArg.length - 1];
      expect(newStep.number).toBe(2);
    });

    it('should use recordAction for undo support', () => {
      const props = createMockProps({ selectedTool: 'steps' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);

      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      expect(props.history.recordAction).toHaveBeenCalled();
    });
  });

  describe('MIN_SHAPE_SIZE validation', () => {
    it('should not create shape when mouse movement is below threshold', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      props.stageRef.current.getPointerPosition = vi.fn(() => ({ x: 100, y: 100 }));

      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move mouse by only 2 pixels (below MIN_SHAPE_SIZE of 5)
      act(() => {
        result.current.handleDrawingMouseMove({ x: 102, y: 102 });
      });

      // Shape should not be created yet
      expect(props.onShapesChange).not.toHaveBeenCalled();
    });

    it('should create shape when mouse movement exceeds threshold', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      props.stageRef.current.getPointerPosition = vi.fn(() => ({ x: 100, y: 100 }));

      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move mouse by 10 pixels (above MIN_SHAPE_SIZE of 5)
      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 100 });
      });

      // Shape should be created
      expect(props.onShapesChange).toHaveBeenCalled();
    });
  });

  describe('handleDrawingMouseUp', () => {
    it('should stop drawing', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing (deferred)
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to exceed drag threshold and enter drawing mode
      act(() => {
        result.current.handleDrawingMouseMove({ x: 150, y: 150 });
      });

      expect(result.current.isDrawing).toBe(true);

      // End drawing
      act(() => {
        result.current.handleDrawingMouseUp();
      });

      expect(result.current.isDrawing).toBe(false);
    });

    it('should keep the active tool after completing a shape', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to create shape
      act(() => {
        result.current.handleDrawingMouseMove({ x: 150, y: 150 });
      });

      // End drawing
      act(() => {
        result.current.handleDrawingMouseUp();
      });

      expect(props.onToolChange).not.toHaveBeenCalled();
    });

    it('should commit snapshot after completing shape', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to create shape
      act(() => {
        result.current.handleDrawingMouseMove({ x: 150, y: 150 });
      });

      // End drawing
      act(() => {
        result.current.handleDrawingMouseUp();
      });

      expect(props.history.commitSnapshot).toHaveBeenCalled();
    });
  });

  describe('finalizeAndGetShapes', () => {
    it('should return current shapes when not drawing', () => {
      const existingShapes: CanvasShape[] = [
        { id: 'shape1', type: 'rect', x: 10, y: 10, width: 50, height: 50, stroke: '#ff0000', strokeWidth: 2 },
      ];
      const props = createMockProps({ shapes: existingShapes });
      const { result } = renderHook(() => useShapeDrawing(props));

      let shapes: CanvasShape[] = [];
      act(() => {
        shapes = result.current.finalizeAndGetShapes();
      });

      expect(shapes).toEqual(existingShapes);
    });

    it('should include in-progress shape when drawing', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to create shape
      act(() => {
        result.current.handleDrawingMouseMove({ x: 150, y: 150 });
      });

      // Finalize without mouse up
      let shapes: CanvasShape[] = [];
      act(() => {
        shapes = result.current.finalizeAndGetShapes();
      });

      // Should include the in-progress shape
      expect(shapes.length).toBe(1);
      expect(shapes[0].type).toBe('rect');
    });

    it('should stop drawing after finalize', () => {
      const props = createMockProps({ selectedTool: 'rect' });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to create shape
      act(() => {
        result.current.handleDrawingMouseMove({ x: 150, y: 150 });
      });

      expect(result.current.isDrawing).toBe(true);

      // Finalize
      act(() => {
        result.current.finalizeAndGetShapes();
      });

      expect(result.current.isDrawing).toBe(false);
    });
  });

  describe('shape creation with correct properties', () => {
    it('should create rect with correct dimensions', () => {
      const props = createMockProps({
        selectedTool: 'rect',
        strokeColor: '#00ff00',
        fillColor: '#0000ff',
        strokeWidth: 4,
      });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing at (100, 100)
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to (200, 150)
      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 150 });
      });

      const createdShapes = props.onShapesChange.mock.calls[0][0];
      const rect = createdShapes[0];

      expect(rect.type).toBe('rect');
      expect(rect.x).toBe(100);
      expect(rect.y).toBe(100);
      expect(rect.width).toBe(100); // 200 - 100
      expect(rect.height).toBe(50); // 150 - 100
      expect(rect.stroke).toBe('#00ff00');
      expect(rect.fill).toBe('#0000ff');
      expect(rect.strokeWidth).toBe(4);
    });

    it('should create circle with correct radii', () => {
      const props = createMockProps({ selectedTool: 'circle' });
      const { result } = renderHook(() => useShapeDrawing(props));

      // Start drawing at (100, 100)
      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      // Move to (200, 160) - creating a 100x60 bounding box
      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 160 });
      });

      const createdShapes = props.onShapesChange.mock.calls[0][0];
      const circle = createdShapes[0];

      expect(circle.type).toBe('circle');
      expect(circle.radiusX).toBe(50); // half of 100
      expect(circle.radiusY).toBe(30); // half of 60
      expect(circle.x).toBe(150); // center X
      expect(circle.y).toBe(130); // center Y
    });

    it('should create arrow with correct points', () => {
      const props = createMockProps({ selectedTool: 'arrow' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 150 });
      });

      const createdShapes = props.onShapesChange.mock.calls[0][0];
      const arrow = createdShapes[0];

      expect(arrow.type).toBe('arrow');
      expect(arrow.points).toEqual([100, 100, 200, 150]);
    });

    it('should keep live arrow preview geometry aligned with the final render', () => {
      const props = createMockProps({ selectedTool: 'arrow' });
      const previewPoints = vi.fn();
      const batchDraw = vi.fn();

      props.stageRef.current.findOne = vi.fn(() => ({
        getClassName: () => 'Group',
        getChildren: () => [{ points: previewPoints }],
        getLayer: () => ({ batchDraw }),
      }));

      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 110, y: 110 });
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 150 });
      });

      expect(previewPoints).toHaveBeenCalledWith(
        getArrowRenderPoints(100, 100, 200, 150, props.strokeWidth)
      );
      expect(batchDraw).toHaveBeenCalled();
    });

    it('should create highlight with semi-transparent fill', () => {
      const props = createMockProps({
        selectedTool: 'highlight',
        strokeColor: '#ffff00', // yellow
      });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 150 });
      });

      const createdShapes = props.onShapesChange.mock.calls[0][0];
      const highlight = createdShapes[0];

      expect(highlight.type).toBe('highlight');
      expect(highlight.fill).toBe('rgba(255, 255, 0, 0.4)');
    });

    it('should create blur with correct blur settings', () => {
      const props = createMockProps({
        selectedTool: 'blur',
        blurType: 'pixelate',
        blurAmount: 20,
      });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 150 });
      });

      const createdShapes = props.onShapesChange.mock.calls[0][0];
      const blur = createdShapes[0];

      expect(blur.type).toBe('blur');
      expect(blur.blurType).toBe('pixelate');
      expect(blur.blurAmount).toBe(20);
    });

    it('should create a default text box on click without drag', () => {
      const props = createMockProps({ selectedTool: 'text', fontSize: 16, strokeColor: '#112233' });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseUp();
      });

      const createdShapes = props.onShapesChange.mock.calls.at(-1)![0];
      const textShape = createdShapes[0];

      expect(textShape.type).toBe('text');
      expect(textShape.x).toBe(100);
      expect(textShape.y).toBe(100);
      expect(textShape.width).toBe(EDITOR_TEXT.DEFAULT_BOX_WIDTH);
      expect(textShape.height).toBe(getEditorTextDefaultBoxHeight(16));
      expect(textShape.fontSize).toBe(16);
      expect(textShape.fontFamily).toBe(EDITOR_TEXT.DEFAULT_FONT_FAMILY);
      expect(textShape.fontStyle).toBe(EDITOR_TEXT.DEFAULT_FONT_STYLE);
      expect(textShape.textDecoration).toBe(EDITOR_TEXT.DEFAULT_TEXT_DECORATION);
      expect(textShape.align).toBe(EDITOR_TEXT.DEFAULT_ALIGN);
      expect(textShape.verticalAlign).toBe(EDITOR_TEXT.DEFAULT_VERTICAL_ALIGN);
      expect(textShape.wrap).toBe(EDITOR_TEXT.DEFAULT_WRAP);
      expect(textShape.lineHeight).toBe(EDITOR_TEXT.DEFAULT_LINE_HEIGHT);
      expect(textShape.fill).toBe('#112233');
      expect(props.onToolChange).not.toHaveBeenCalled();
    });

    it('should enforce minimum text width and drag height while drawing', () => {
      const props = createMockProps({ selectedTool: 'text', fontSize: 16 });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 104, y: 104 });
      });

      const createdShapes = props.onShapesChange.mock.calls.at(-1)![0];
      const textShape = createdShapes[0];

      expect(textShape.type).toBe('text');
      expect(textShape.width).toBe(EDITOR_TEXT.MIN_BOX_WIDTH);
      expect(textShape.height).toBe(getEditorTextDragBoxHeight(16));
    });
  });

  describe('text shape callback', () => {
    it('should call onTextShapeCreated after text shape is completed', () => {
      const onTextShapeCreated = vi.fn();
      const props = createMockProps({
        selectedTool: 'text',
        onTextShapeCreated,
      });
      const { result } = renderHook(() => useShapeDrawing(props));

      const event = createMockKonvaEvent(props.stageRef);
      act(() => {
        result.current.handleDrawingMouseDown(event);
      });

      act(() => {
        result.current.handleDrawingMouseMove({ x: 200, y: 150 });
      });

      act(() => {
        result.current.handleDrawingMouseUp();
      });

      expect(onTextShapeCreated).toHaveBeenCalled();
    });
  });
});
