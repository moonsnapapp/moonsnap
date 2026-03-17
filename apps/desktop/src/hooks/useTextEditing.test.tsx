import React, { useEffect } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import type { CanvasShape } from '../types';
import { useTextEditing } from './useTextEditing';

function createTextShape(): CanvasShape {
  return {
    id: 'text-1',
    type: 'text',
    x: 5,
    y: 7,
    width: 100,
    height: 30,
    text: 'hello',
    fontSize: 20,
    fontFamily: 'Arial',
    fontStyle: 'normal',
    textDecoration: '',
    align: 'left',
    verticalAlign: 'top',
    fill: '#111111',
    textBackground: '#ffffff',
  };
}

describe('useTextEditing', () => {
  it('updates overlay coordinates when the stage zoom changes during editing', async () => {
    let stageZoom = 1;
    const stage = {
      x: () => 10,
      y: () => 20,
      scaleX: () => stageZoom,
      findOne: () => null,
    } as Partial<Konva.Stage> as Konva.Stage;
    const stageRef = { current: stage };
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      } as HTMLDivElement,
    };

    function Harness() {
      const textEditing = useTextEditing({
        shapes: [createTextShape()],
        onShapesChange: vi.fn(),
        zoom: 1,
        position: { x: 0, y: 0 },
        containerRef,
        stageRef,
      });
      const { startEditing } = textEditing;

      useEffect(() => {
        startEditing('text-1', 'hello');
      }, [startEditing]);

      const overlay = textEditing.getTextareaPosition();
      return (
        <div>
          <span data-testid="left">{overlay?.left ?? -1}</span>
          <span data-testid="width">{overlay?.width ?? -1}</span>
          <span data-testid="font-size">{overlay?.fontSize ?? -1}</span>
        </div>
      );
    }

    render(<Harness />);

    expect(screen.getByTestId('left')).toHaveTextContent('15');
    expect(screen.getByTestId('width')).toHaveTextContent('100');
    expect(screen.getByTestId('font-size')).toHaveTextContent('20');

    await act(async () => {
      stageZoom = 2;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    expect(screen.getByTestId('left')).toHaveTextContent('20');
    expect(screen.getByTestId('width')).toHaveTextContent('200');
    expect(screen.getByTestId('font-size')).toHaveTextContent('40');
  });

  it('uses the live Konva stage transform for overlay positioning', () => {
    const stageRef = {
      current: {
        x: () => 40,
        y: () => 60,
        scaleX: () => 2,
        findOne: () => null,
      } as Partial<Konva.Stage> as Konva.Stage,
    };
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 10,
          top: 20,
          width: 800,
          height: 600,
          right: 810,
          bottom: 620,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        }),
      } as HTMLDivElement,
    };
    const onShapesChange = vi.fn();

    const { result } = renderHook(() =>
      useTextEditing({
        shapes: [createTextShape()],
        onShapesChange,
        zoom: 1,
        position: { x: 0, y: 0 },
        containerRef,
        stageRef,
      })
    );

    act(() => {
      result.current.startEditing('text-1', 'hello');
    });

    // Coordinates are container-relative (absolute positioning), not viewport-relative.
    // left = stageX(40) + shape.x(5) * zoom(2) = 50
    // top = stageY(60) + shape.y(7) * zoom(2) = 74
    expect(result.current.getTextareaPosition()).toMatchObject({
      left: 50,
      top: 74,
      width: 200,
      height: 60,
      fontSize: 40,
    });
  });

  it('uses the live Konva stage zoom when saving measured text height', () => {
    const stageRef = {
      current: {
        x: () => 0,
        y: () => 0,
        scaleX: () => 2,
        findOne: () => null,
      } as Partial<Konva.Stage> as Konva.Stage,
    };
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      } as HTMLDivElement,
    };
    const onShapesChange = vi.fn();

    const { result } = renderHook(() =>
      useTextEditing({
        shapes: [createTextShape()],
        onShapesChange,
        zoom: 1,
        position: { x: 0, y: 0 },
        containerRef,
        stageRef,
      })
    );

    act(() => {
      result.current.startEditing('text-1', 'hello');
    });

    act(() => {
      result.current.handleTextChange('hello world');
    });

    act(() => {
      result.current.handleSaveTextEdit(100);
    });

    expect(onShapesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'text-1',
        text: 'hello world',
        height: 50,
      }),
    ]);
  });
});
