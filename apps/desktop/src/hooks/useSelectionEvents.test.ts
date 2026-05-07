import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { repositionToolbar, useSelectionEvents } from './useSelectionEvents';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import {
  emitMockEvent,
  mockAvailableMonitors,
  mockInvoke,
  mockWebviewWindow,
  setInvokeResponse,
} from '@/test/mocks/tauri';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/** Flush enough microtasks for async handlers to complete */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

describe('useSelectionEvents', () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    mockAvailableMonitors.mockClear();
    mockWebviewWindow.outerSize.mockResolvedValue({ width: 640, height: 120 });
    useCaptureSettingsStore.setState({
      activeMode: 'video',
      sourceMode: 'area',
      snapToolbarToSelection: false,
    });
    setInvokeResponse('set_capture_toolbar_position', undefined);
  });

  it('waits for recording preparation before enabling tray auto-start', async () => {
    const prepareRecording = createDeferred<void>();
    setInvokeResponse('prepare_recording', prepareRecording.promise);
    const { result } = renderHook(() => useSelectionEvents());

    await flush();

    await act(async () => {
      emitMockEvent('confirm-selection', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceType: 'area',
        sourceMode: 'area',
        autoStartRecording: true,
      });
    });

    // Handler awaits prepareRecording, so selectionConfirmed not yet set
    expect(result.current.autoStartRecording).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('prepare_recording', { format: 'mp4' });

    await act(async () => {
      prepareRecording.resolve();
    });

    await flush();

    expect(result.current.selectionConfirmed).toBe(true);
    expect(result.current.autoStartRecording).toBe(true);
  });

  it('clears the embedded quick-record marker when auto-start is cancelled', async () => {
    setInvokeResponse('prepare_recording', null);
    const { result } = renderHook(() => useSelectionEvents());

    await flush();

    await act(async () => {
      emitMockEvent('confirm-selection', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceType: 'area',
        sourceMode: 'area',
        autoStartRecording: true,
      });
    });

    await flush();

    expect(result.current.selectionBounds.autoStartRecording).toBe(true);
    expect(result.current.autoStartRecording).toBe(true);

    await act(async () => {
      result.current.clearSelectionAutoStartRecording();
    });

    expect(result.current.selectionBounds.autoStartRecording).toBe(false);
    expect(result.current.autoStartRecording).toBe(false);
  });

  it('persists the last area selection when an area is confirmed', async () => {
    setInvokeResponse('prepare_recording', null);
    const { result } = renderHook(() => useSelectionEvents());

    await flush();

    await act(async () => {
      emitMockEvent('confirm-selection', {
        x: 220,
        y: 180,
        width: 640,
        height: 360,
        captureType: 'video',
        sourceType: 'area',
        sourceMode: 'area',
      });
    });

    await flush();

    expect(result.current.selectionConfirmed).toBe(true);
    expect(useCaptureSettingsStore.getState().lastAreaSelection).toEqual({
      x: 220,
      y: 180,
      width: 640,
      height: 360,
    });
  });

  it('centers the toolbar inside display selections', async () => {
    await repositionToolbar({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      sourceType: 'display',
    });

    expect(mockInvoke).toHaveBeenCalledWith('set_capture_toolbar_position', {
      x: 640,
      y: 480,
    });
  });

  it('centers the toolbar inside window selections', async () => {
    await repositionToolbar({
      x: 240,
      y: 180,
      width: 1280,
      height: 720,
      sourceType: 'window',
    });

    expect(mockInvoke).toHaveBeenCalledWith('set_capture_toolbar_position', {
      x: 560,
      y: 480,
    });
  });

  it('keeps area selections below the selected region', async () => {
    await repositionToolbar({
      x: 100,
      y: 120,
      width: 800,
      height: 450,
      sourceType: 'area',
    });

    expect(mockInvoke).toHaveBeenCalledWith('set_capture_toolbar_position', {
      x: 180,
      y: 578,
    });
  });
});
