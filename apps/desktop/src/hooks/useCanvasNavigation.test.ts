import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanvasNavigation } from './useCanvasNavigation';
import type { CompositorSettings, Tool, CanvasBounds } from '../types';

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;
  static instances: MockResizeObserver[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {
    const index = MockResizeObserver.instances.indexOf(this);
    if (index > -1) {
      MockResizeObserver.instances.splice(index, 1);
    }
  }

  // Helper to trigger resize
  static triggerResize(entry: Partial<ResizeObserverEntry>) {
    MockResizeObserver.instances.forEach((instance) => {
      instance.callback([entry as ResizeObserverEntry], instance as unknown as ResizeObserver);
    });
  }
}

// Default compositor settings
const defaultCompositorSettings: CompositorSettings = {
  enabled: false,
  padding: 32,
  borderRadius: 8,
  shadowEnabled: true,
  shadowOffsetX: 0,
  shadowOffsetY: 8,
  shadowBlur: 24,
  shadowColor: 'rgba(0,0,0,0.3)',
  backgroundType: 'solid',
  backgroundColor: '#1a1a2e',
  backgroundImage: null,
  gradientStart: '#667eea',
  gradientEnd: '#764ba2',
  gradientAngle: 135,
  borderWidth: 0,
  borderColor: '#ffffff',
  borderOpacity: 100,
};

// Helper to create mock props
function createMockProps(overrides: Partial<Parameters<typeof useCanvasNavigation>[0]> = {}) {
  return {
    image: undefined as HTMLImageElement | undefined,
    imageData: 'test-image-data',
    compositorSettings: { ...defaultCompositorSettings },
    canvasBounds: null as CanvasBounds | null,
    setCanvasBounds: vi.fn(),
    setOriginalImageSize: vi.fn(),
    selectedTool: 'select' as Tool,
    compositorBgRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    ...overrides,
  };
}

// Helper to create a mock image
function createMockImage(width: number, height: number): HTMLImageElement {
  const img = {
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
  } as HTMLImageElement;
  return img;
}

describe('useCanvasNavigation', () => {
  let originalResizeObserver: typeof ResizeObserver;
  let originalRAF: typeof requestAnimationFrame;
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    MockResizeObserver.instances = [];
    rafCallbacks = [];

    // Mock ResizeObserver
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    // Mock requestAnimationFrame
    originalRAF = global.requestAnimationFrame;
    global.requestAnimationFrame = vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    global.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    global.requestAnimationFrame = originalRAF;
  });

  // Helper to flush RAF callbacks
  function flushRAF() {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    callbacks.forEach((cb) => cb(performance.now()));
  }

  describe('initial state', () => {
    it('should have default zoom of 1', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.zoom).toBe(1);
    });

    it('should have default position of (0, 0)', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.position).toEqual({ x: 0, y: 0 });
    });

    it('should not be ready initially', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.isReady).toBe(false);
    });
  });

  describe('getCanvasPosition', () => {
    it('should transform screen position to canvas position at zoom 1', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      // At zoom 1 and position (0,0), screen coords should equal canvas coords
      const canvasPos = result.current.getCanvasPosition({ x: 100, y: 200 });

      expect(canvasPos).toEqual({ x: 100, y: 200 });
    });

    it('should account for zoom when transforming position', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      // Set zoom to 2
      act(() => {
        result.current.setZoom(2);
      });

      // At zoom 2, screen pos 200 should be canvas pos 100 (divided by zoom)
      const canvasPos = result.current.getCanvasPosition({ x: 200, y: 400 });

      expect(canvasPos).toEqual({ x: 100, y: 200 });
    });

    it('should account for position offset', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      // Set position offset
      act(() => {
        result.current.setPosition({ x: 50, y: 100 });
      });

      // Screen pos 150 with offset 50 should be canvas pos 100
      const canvasPos = result.current.getCanvasPosition({ x: 150, y: 200 });

      expect(canvasPos).toEqual({ x: 100, y: 100 });
    });

    it('should account for both zoom and position', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      act(() => {
        result.current.setZoom(2);
        result.current.setPosition({ x: 100, y: 100 });
      });

      // screen (300, 300) with offset (100, 100) and zoom 2:
      // canvas = (300 - 100) / 2 = 100
      const canvasPos = result.current.getCanvasPosition({ x: 300, y: 300 });

      expect(canvasPos).toEqual({ x: 100, y: 100 });
    });
  });

  describe('zoom controls', () => {
    it('should increase zoom on handleZoomIn', () => {
      const image = createMockImage(800, 600);
      const props = createMockProps({ image });
      const { result } = renderHook(() => useCanvasNavigation(props));

      const initialZoom = result.current.zoom;

      act(() => {
        result.current.handleZoomIn();
      });

      expect(result.current.zoom).toBeGreaterThan(initialZoom);
    });

    it('should decrease zoom on handleZoomOut', () => {
      const image = createMockImage(800, 600);
      const props = createMockProps({ image });
      const { result } = renderHook(() => useCanvasNavigation(props));

      const initialZoom = result.current.zoom;

      act(() => {
        result.current.handleZoomOut();
      });

      expect(result.current.zoom).toBeLessThan(initialZoom);
    });

    it('should not exceed MAX_ZOOM (2)', () => {
      const image = createMockImage(800, 600);
      const props = createMockProps({ image });
      const { result } = renderHook(() => useCanvasNavigation(props));

      // Try to zoom in many times
      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.handleZoomIn();
        }
      });

      expect(result.current.zoom).toBeLessThanOrEqual(2);
    });

    it('should not go below MIN_ZOOM (0.3)', () => {
      const image = createMockImage(800, 600);
      const props = createMockProps({ image });
      const { result } = renderHook(() => useCanvasNavigation(props));

      // Try to zoom out many times
      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.handleZoomOut();
        }
      });

      expect(result.current.zoom).toBeGreaterThanOrEqual(0.3);
    });

    it('should set zoom to 1 on handleActualSize', () => {
      const image = createMockImage(800, 600);
      const props = createMockProps({ image });
      const { result } = renderHook(() => useCanvasNavigation(props));

      // Change zoom first
      act(() => {
        result.current.setZoom(0.5);
      });

      expect(result.current.zoom).toBe(0.5);

      // Set to actual size
      act(() => {
        result.current.handleActualSize();
      });

      expect(result.current.zoom).toBe(1);
    });
  });

  describe('setZoom and setPosition', () => {
    it('should update zoom directly', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      act(() => {
        result.current.setZoom(1.5);
      });

      expect(result.current.zoom).toBe(1.5);
    });

    it('should update position directly', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      act(() => {
        result.current.setPosition({ x: 200, y: 300 });
      });

      expect(result.current.position).toEqual({ x: 200, y: 300 });
    });
  });

  describe('canvas size', () => {
    it('should update canvas size when image loads', () => {
      const image = createMockImage(1920, 1080);
      const props = createMockProps({ image });

      const { result } = renderHook(() => useCanvasNavigation(props));

      // Flush RAF to allow initial fit to complete
      act(() => {
        flushRAF();
      });

      expect(result.current.canvasSize).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe('container ref', () => {
    it('should provide container ref', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.containerRef).toBeDefined();
      expect(result.current.containerRef.current).toBe(null);
    });
  });

  describe('exposed refs for pan coordination', () => {
    it('should expose renderedPositionRef', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.renderedPositionRef).toBeDefined();
    });

    it('should expose renderedZoomRef', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.renderedZoomRef).toBeDefined();
    });

    it('should expose transformCoeffsRef', () => {
      const props = createMockProps();
      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.transformCoeffsRef).toBeDefined();
    });
  });

  describe('function reference stability', () => {
    it('should have stable getCanvasPosition reference', () => {
      const props = createMockProps();
      const { result, rerender } = renderHook(() => useCanvasNavigation(props));

      const firstRef = result.current.getCanvasPosition;
      rerender();

      // Note: getCanvasPosition depends on zoom and position, so it changes when they change
      // But on simple rerender without state changes, it should be stable
      expect(result.current.getCanvasPosition).toBe(firstRef);
    });

    it('should have stable handleZoomIn reference', () => {
      const props = createMockProps();
      const { result, rerender } = renderHook(() => useCanvasNavigation(props));

      const firstRef = result.current.handleZoomIn;
      rerender();

      expect(result.current.handleZoomIn).toBe(firstRef);
    });

    it('should have stable handleZoomOut reference', () => {
      const props = createMockProps();
      const { result, rerender } = renderHook(() => useCanvasNavigation(props));

      const firstRef = result.current.handleZoomOut;
      rerender();

      expect(result.current.handleZoomOut).toBe(firstRef);
    });
  });

  describe('compositor settings', () => {
    it('should calculate transform coefficients when compositor enabled', () => {
      const image = createMockImage(800, 600);
      const canvasBounds: CanvasBounds = {
        width: 800,
        height: 600,
        imageOffsetX: 0,
        imageOffsetY: 0,
      };
      const compositorSettings = {
        ...defaultCompositorSettings,
        enabled: true,
        padding: 50,
      };
      const props = createMockProps({
        image,
        canvasBounds,
        compositorSettings,
      });

      const { result } = renderHook(() => useCanvasNavigation(props));

      // Transform coeffs should be calculated
      expect(result.current.transformCoeffsRef.current).toBeDefined();
    });

    it('should reset transform coefficients when compositor disabled', () => {
      const image = createMockImage(800, 600);
      const props = createMockProps({
        image,
        compositorSettings: { ...defaultCompositorSettings, enabled: false },
      });

      const { result } = renderHook(() => useCanvasNavigation(props));

      expect(result.current.transformCoeffsRef.current).toEqual({ kx: 0, ky: 0 });
    });
  });

  describe('crop mode handling', () => {
    it('should calculate transform coefficients differently in crop mode', () => {
      const image = createMockImage(800, 600);
      const canvasBounds: CanvasBounds = {
        width: 600,
        height: 400,
        imageOffsetX: 100,
        imageOffsetY: 100,
      };
      const compositorSettings = {
        ...defaultCompositorSettings,
        enabled: true,
        padding: 32,
      };

      // Test with crop tool
      const props = createMockProps({
        image,
        canvasBounds,
        compositorSettings,
        selectedTool: 'crop',
      });

      const { result } = renderHook(() => useCanvasNavigation(props));

      // In crop mode, visible bounds start at 0,0
      // Kx = 0 - padding = -32
      expect(result.current.transformCoeffsRef.current.kx).toBe(-32);
    });
  });
});
