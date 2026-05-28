import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureService } from './captureService';
import type { FastCaptureResult, MonitorInfo, ScreenRegionSelection } from '../types';

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock error reporting so we can assert on it without touching toast/logger.
const mockReportError = vi.fn();
vi.mock('../utils/errorReporting', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

const fastResult: FastCaptureResult = {
  file_path: 'C:/temp/capture.png',
  width: 1920,
  height: 1080,
};

const region: ScreenRegionSelection = { x: 10, y: 20, width: 300, height: 400 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CaptureService — command routing', () => {
  it('captureFullscreenToEditor invokes the guarded entrypoint', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await CaptureService.captureFullscreenToEditor();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('capture_fullscreen_to_editor');
  });

  it('showScreenshotOverlay requests the screenshot overlay', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await CaptureService.showScreenshotOverlay();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('show_overlay', {
      captureType: 'screenshot',
    });
  });

  it('captureAllMonitorsToEditor invokes the combined entrypoint', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await CaptureService.captureAllMonitorsToEditor();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('capture_all_monitors_to_editor');
  });

  it('captureRegion forwards the selection and returns the result', async () => {
    mockInvoke.mockResolvedValue(fastResult);
    const result = await CaptureService.captureRegion(region);
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('capture_screen_region_fast', {
      selection: region,
    });
    expect(result).toEqual(fastResult);
  });
});

describe('CaptureService.showVideoOverlay — format mapping', () => {
  it('maps gif format to the gif capture type', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await CaptureService.showVideoOverlay('gif');
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('show_overlay', { captureType: 'gif' });
  });

  it('maps mp4 format to the video capture type', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await CaptureService.showVideoOverlay('mp4');
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('show_overlay', { captureType: 'video' });
  });

  it('defaults to the video capture type', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await CaptureService.showVideoOverlay();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('show_overlay', { captureType: 'video' });
  });
});

describe('CaptureService.captureAllMonitors', () => {
  it('reads virtual screen bounds then captures that region', async () => {
    const bounds = { x: -100, y: 0, width: 3840, height: 1080 };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_virtual_screen_bounds') return Promise.resolve(bounds);
      if (cmd === 'capture_screen_region_fast') return Promise.resolve(fastResult);
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });

    const result = await CaptureService.captureAllMonitors();

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_virtual_screen_bounds');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'capture_screen_region_fast', {
      selection: bounds,
    });
    expect(result).toEqual(fastResult);
  });
});

describe('CaptureService.calculateAllMonitorsBounds', () => {
  it('computes the union bounding box across monitors', async () => {
    const monitors: Partial<MonitorInfo>[] = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: -200, width: 1280, height: 1024 },
    ];
    mockInvoke.mockResolvedValue(monitors);

    const bounds = await CaptureService.calculateAllMonitorsBounds();

    // minX=0, minY=-200, maxX=3200, maxY=1080
    expect(bounds).toEqual({ x: 0, y: -200, width: 3200, height: 1280 });
  });

  it('throws and reports when no monitors are found', async () => {
    mockInvoke.mockResolvedValue([]);

    await expect(CaptureService.calculateAllMonitorsBounds()).rejects.toThrow('No monitors found');
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'monitor detection',
    });
  });
});

describe('CaptureService.captureRegionToEditor', () => {
  it('captures the region then opens the editor with snake_case → camelCase mapping', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'capture_screen_region_fast') return Promise.resolve(fastResult);
      if (cmd === 'open_editor_fast') return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });

    await CaptureService.captureRegionToEditor(region);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'capture_screen_region_fast', {
      selection: region,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'open_editor_fast', {
      filePath: fastResult.file_path,
      width: fastResult.width,
      height: fastResult.height,
    });
  });
});

describe('CaptureService — error handling', () => {
  const cases: Array<{ name: string; run: () => Promise<unknown>; operation: string }> = [
    {
      name: 'captureFullscreenToEditor',
      run: () => CaptureService.captureFullscreenToEditor(),
      operation: 'fullscreen capture',
    },
    {
      name: 'showScreenshotOverlay',
      run: () => CaptureService.showScreenshotOverlay(),
      operation: 'capture start',
    },
    {
      name: 'showVideoOverlay',
      run: () => CaptureService.showVideoOverlay(),
      operation: 'recording start',
    },
    {
      name: 'captureAllMonitors',
      run: () => CaptureService.captureAllMonitors(),
      operation: 'monitors capture',
    },
    {
      name: 'captureAllMonitorsToEditor',
      run: () => CaptureService.captureAllMonitorsToEditor(),
      operation: 'monitors capture',
    },
    {
      name: 'captureRegion',
      run: () => CaptureService.captureRegion(region),
      operation: 'region capture',
    },
  ];

  for (const { name, run, operation } of cases) {
    it(`${name} reports with "${operation}" and rethrows`, async () => {
      const boom = new Error('backend exploded');
      mockInvoke.mockRejectedValue(boom);

      await expect(run()).rejects.toBe(boom);
      expect(mockReportError).toHaveBeenCalledWith(boom, { operation });
    });
  }
});
