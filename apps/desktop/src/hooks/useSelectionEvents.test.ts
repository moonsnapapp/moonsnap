import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionEvents } from './useSelectionEvents';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { emitMockEvent, mockInvoke, setInvokeResponse } from '@/test/mocks/tauri';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('useSelectionEvents', () => {
  beforeEach(() => {
    useCaptureSettingsStore.setState({
      activeMode: 'video',
      sourceMode: 'area',
    });
  });

  it('waits for recording preparation before enabling tray auto-start', async () => {
    const prepareRecording = createDeferred<void>();
    setInvokeResponse('prepare_recording', prepareRecording.promise);
    setInvokeResponse('set_capture_toolbar_position', undefined);

    const { result } = renderHook(() => useSelectionEvents());

    await act(async () => {
      await Promise.resolve();
    });

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
      await Promise.resolve();
    });

    expect(result.current.selectionConfirmed).toBe(true);
    expect(result.current.autoStartRecording).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('prepare_recording', { format: 'mp4' });

    await act(async () => {
      prepareRecording.resolve();
      await Promise.resolve();
    });

    expect(result.current.autoStartRecording).toBe(true);
  });
});
