import React from 'react';
import type Konva from 'konva';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorStoreContext } from '@/stores/EditorStoreProvider';
import { createEditorStore } from '@/stores/editorStore';
import { useCaptureStore } from '@/stores/captureStore';
import { mockDialogSave } from '@/test/mocks/tauri';
import { DEFAULT_COMPOSITOR_SETTINGS } from '@/types';
import type { Annotation, CanvasShape, CaptureProject } from '@/types';

import { getSaveImageFormat, useEditorActions } from './useEditorActions';

const mockExportToClipboard = vi.fn();
const mockExportToFile = vi.fn();

vi.mock('../utils/canvasExport', () => ({
  exportToClipboard: (...args: unknown[]) => mockExportToClipboard(...args),
  exportToFile: (...args: unknown[]) => mockExportToFile(...args),
}));

function createWrapper(store = createEditorStore()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      EditorStoreContext.Provider,
      { value: store },
      children
    );
  };
}

function createTestProject(): CaptureProject {
  return {
    id: 'project-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    capture_type: 'region',
    source: { monitor: 0 },
    original_image: 'capture.png',
    dimensions: { width: 1920, height: 1080 },
    annotations: [],
    tags: [],
    favorite: false,
  };
}

const originalUpdateAnnotations = useCaptureStore.getState().updateAnnotations;

describe('useEditorActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDialogSave.mockResolvedValue(null);
    mockExportToClipboard.mockResolvedValue(undefined);
    mockExportToFile.mockResolvedValue(undefined);
    useCaptureStore.setState({
      currentProject: null,
      currentImageData: null,
      updateAnnotations: originalUpdateAnnotations,
    });
  });

  it.each([
    ['capture.png', 'image/png', undefined],
    ['capture.jpg', 'image/jpeg', 0.92],
    ['capture.JPEG', 'image/jpeg', 0.92],
    ['C:\\captures\\capture.webp', 'image/webp', 0.9],
    ['capture.unknown', 'image/png', undefined],
  ] as const)('maps %s to its production export options', (filePath, mime, quality) => {
    const format = getSaveImageFormat(filePath);

    expect(format.mime).toBe(mime);
    expect(format.quality).toBe(quality);
  });

  it('persists export annotations without background image data', async () => {
    const updateAnnotations = vi.fn().mockResolvedValue(undefined);
    useCaptureStore.setState({
      currentProject: createTestProject(),
      updateAnnotations,
    });

    const background: CanvasShape = {
      id: 'background',
      type: 'image',
      isBackground: true,
      imageSrc: 'data:image/png;base64,large-background-payload',
      width: 1920,
      height: 1080,
    };
    const rectangle: CanvasShape = {
      id: 'rectangle',
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    };
    const editorStore = createEditorStore();
    editorStore.setState({
      shapes: [background, rectangle],
      canvasBounds: { width: 1600, height: 900, imageOffsetX: 25, imageOffsetY: 15 },
      cropRegion: { x: 40, y: 30, width: 1200, height: 700 },
      compositorSettings: {
        ...DEFAULT_COMPOSITOR_SETTINGS,
        enabled: true,
        padding: 48,
      },
    });

    const { result } = renderHook(
      () => useEditorActions({ stageRef: { current: {} } as React.RefObject<Konva.Stage> }),
      { wrapper: createWrapper(editorStore) }
    );

    await act(async () => {
      await result.current.saveProjectAnnotations();
    });

    expect(updateAnnotations).toHaveBeenCalledTimes(1);
    const annotations = updateAnnotations.mock.calls[0][0] as Annotation[];
    expect(annotations.find((annotation) => annotation.id === 'background')).toEqual({
      id: 'background',
      type: 'image',
      isBackground: true,
      width: 1920,
      height: 1080,
    });
    expect(annotations.find((annotation) => annotation.id === 'rectangle')).toEqual(rectangle);
    expect(annotations).toContainEqual({
      id: '__crop_bounds__',
      type: '__crop_bounds__',
      width: 1600,
      height: 900,
      imageOffsetX: 25,
      imageOffsetY: 15,
    });
    expect(annotations).toContainEqual({
      id: '__crop_region__',
      type: '__crop_region__',
      x: 40,
      y: 30,
      width: 1200,
      height: 700,
    });
    expect(annotations).toContainEqual({
      id: '__compositor_settings__',
      type: '__compositor_settings__',
      ...DEFAULT_COMPOSITOR_SETTINGS,
      enabled: true,
      padding: 48,
    });
  });

  it('exports PNG from Save As', async () => {
    mockDialogSave.mockResolvedValueOnce('C:\\Users\\walter\\Desktop\\capture.png');

    const stageRef = { current: {} } as React.RefObject<Konva.Stage>;
    const { result } = renderHook(
      () => useEditorActions({ stageRef, imageData: 'mock-base64-image' }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.handleSaveAs('png');
    });

    expect(mockDialogSave).toHaveBeenCalledWith({
      defaultPath: expect.stringMatching(/^capture_\d+\.png$/),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    expect(mockExportToFile).toHaveBeenCalledWith(
      stageRef,
      null,
      expect.any(Object),
      'C:\\Users\\walter\\Desktop\\capture.png',
      { format: 'image/png', quality: undefined },
      null
    );
  });

  it('uses PNG for the default Save action', async () => {
    mockDialogSave.mockResolvedValueOnce('C:\\Users\\walter\\Desktop\\capture.png');

    const stageRef = { current: {} } as React.RefObject<Konva.Stage>;
    const { result } = renderHook(
      () => useEditorActions({ stageRef, imageData: 'mock-base64-image' }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockDialogSave).toHaveBeenCalledWith({
      defaultPath: expect.stringMatching(/^capture_\d+\.png$/),
      filters: [
        { name: 'PNG', extensions: ['png'] },
        { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
        { name: 'WebP', extensions: ['webp'] },
      ],
    });
    expect(mockExportToFile).toHaveBeenCalledWith(
      stageRef,
      null,
      expect.any(Object),
      'C:\\Users\\walter\\Desktop\\capture.png',
      { format: 'image/png' },
      null
    );
  });
});
