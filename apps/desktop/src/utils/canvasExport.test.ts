import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockFsWriteFile } from '@/test/mocks/tauri';
import { DEFAULT_COMPOSITOR_SETTINGS } from '@/types';

import { exportCanvas, exportToFile } from './canvasExport';

function createMockExportCanvas() {
  const canvas = document.createElement('canvas');
  const pngBytes = Uint8Array.from([137, 80, 78, 71]);
  const mockBlob = {
    type: 'image/png',
    arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer),
  };

  canvas.toBlob = vi.fn((callback: BlobCallback, type?: string) => {
    callback({
      ...mockBlob,
      type: type ?? 'image/png',
    } as unknown as Blob);
  });

  return { canvas, pngBytes, mockBlob };
}

function createStageRef(outputCanvas: HTMLCanvasElement) {
  const layer = {
    findOne: vi.fn().mockReturnValue(undefined),
    find: vi.fn().mockReturnValue([]),
    toCanvas: vi.fn().mockReturnValue(outputCanvas),
    batchDraw: vi.fn(),
  };

  const stage = {
    scaleX: vi.fn(() => 1),
    scaleY: vi.fn(() => 1),
    x: vi.fn(() => 0),
    y: vi.fn(() => 0),
    scale: vi.fn(),
    position: vi.fn(),
    findOne: vi.fn((selector: string) => (selector === 'Layer' ? layer : undefined)),
  };

  return { current: stage };
}

function createMockNode(parent: { children: unknown[]; add: ReturnType<typeof vi.fn> }) {
  const node = {
    parent,
    getParent: vi.fn(() => parent),
    remove: vi.fn(() => {
      const index = parent.children.indexOf(node);
      if (index >= 0) {
        parent.children.splice(index, 1);
      }
    }),
  };

  parent.children.push(node);
  return node;
}

describe('canvasExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports PNG bytes to the selected file path', async () => {
    const { canvas, pngBytes, mockBlob } = createMockExportCanvas();
    const stageRef = createStageRef(canvas);

    await exportToFile(
      stageRef,
      null,
      { ...DEFAULT_COMPOSITOR_SETTINGS, enabled: false },
      'C:\\Users\\walter\\Desktop\\capture.png',
      { format: 'image/png' },
      null
    );

    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    expect(mockBlob.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(mockFsWriteFile).toHaveBeenCalledTimes(1);
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      'C:\\Users\\walter\\Desktop\\capture.png',
      expect.any(Uint8Array)
    );
    expect(Array.from(mockFsWriteFile.mock.calls[0][1] as Uint8Array)).toEqual(Array.from(pngBytes));
  });

  it('removes compositor preview nodes before raster export', () => {
    const { canvas } = createMockExportCanvas();
    const parent = {
      children: [] as unknown[],
      add: vi.fn(),
    };
    const contentShadow = createMockNode(parent);
    const compositorBackground = createMockNode(parent);

    const layer = {
      findOne: vi.fn((selector: string) => {
        if (selector === '.content-shadow') return contentShadow;
        if (selector === '.compositor-background') return compositorBackground;
        return undefined;
      }),
      find: vi.fn().mockReturnValue([]),
      toCanvas: vi.fn().mockReturnValue(canvas),
      batchDraw: vi.fn(),
    };
    const stage = {
      scaleX: vi.fn(() => 1),
      scaleY: vi.fn(() => 1),
      x: vi.fn(() => 0),
      y: vi.fn(() => 0),
      scale: vi.fn(),
      position: vi.fn(),
    };

    exportCanvas(stage as never, layer as never, {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });

    expect(contentShadow.remove).toHaveBeenCalledTimes(1);
    expect(compositorBackground.remove).toHaveBeenCalledTimes(1);
  });
});
