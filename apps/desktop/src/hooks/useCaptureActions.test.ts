import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCaptureActions } from './useCaptureActions';

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock CaptureService
const mockShowScreenshotOverlay = vi.fn();
const mockCaptureFullscreenToEditor = vi.fn();
const mockCaptureAllMonitorsToEditor = vi.fn();

vi.mock('../services/captureService', () => ({
  CaptureService: {
    showScreenshotOverlay: () => mockShowScreenshotOverlay(),
    captureFullscreenToEditor: () => mockCaptureFullscreenToEditor(),
    captureAllMonitorsToEditor: () => mockCaptureAllMonitorsToEditor(),
  },
}));

describe('useCaptureActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger new capture overlay', async () => {
    mockShowScreenshotOverlay.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCaptureActions());

    await act(async () => {
      await result.current.triggerNewCapture();
    });

    expect(mockShowScreenshotOverlay).toHaveBeenCalledTimes(1);
  });

  it('should trigger fullscreen capture and open editor', async () => {
    mockCaptureFullscreenToEditor.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCaptureActions());

    await act(async () => {
      await result.current.triggerFullscreenCapture();
    });

    expect(mockCaptureFullscreenToEditor).toHaveBeenCalledTimes(1);
  });

  it('should trigger all monitors capture', async () => {
    mockCaptureAllMonitorsToEditor.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCaptureActions());

    await act(async () => {
      await result.current.triggerAllMonitorsCapture();
    });

    expect(mockCaptureAllMonitorsToEditor).toHaveBeenCalledTimes(1);
  });
});
