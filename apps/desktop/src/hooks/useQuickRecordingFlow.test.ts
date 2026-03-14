import { act, renderHook } from '@testing-library/react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LAYOUT } from '@/constants/layout';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { emitMockEvent, mockAvailableMonitors, setInvokeResponse } from '@/test/mocks/tauri';
import { startRecordingCaptureFlow } from '@/windows/recordingStartFlow';

import { useQuickRecordingFlow } from './useQuickRecordingFlow';

vi.mock('@/windows/recordingStartFlow', () => ({
  startRecordingCaptureFlow: vi.fn(() => Promise.resolve()),
}));

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

describe('useQuickRecordingFlow', () => {
  beforeEach(() => {
    useCaptureSettingsStore.setState({
      isInitialized: true,
      activeMode: 'video',
      sourceMode: 'area',
      promptRecordingMode: false,
      snapToolbarToSelection: true,
      saveSettings: async () => {},
    });

    mockAvailableMonitors.mockResolvedValue([
      {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
      },
    ]);

    setInvokeResponse('close_capture_toolbar', null);
    setInvokeResponse('show_recording_mode_chooser', null);
    vi.mocked(WebviewWindow.getByLabel).mockReturnValue(null);
  });

  it('anchors the quick recording HUD to the bottom center of the selection when snapping is enabled', async () => {
    renderHook(() => useQuickRecordingFlow());
    await flush();

    await act(async () => {
      emitMockEvent('quick-recording-selection-ready', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceMode: 'area',
      });
    });

    await flush();

    expect(startRecordingCaptureFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        hudAnchor: {
          x: 320,
          y: 608,
          width: LAYOUT.RECORDING_HUD_WIDTH,
          height: LAYOUT.RECORDING_HUD_HEIGHT,
        },
      })
    );
  });

  it('falls back to a bottom-centered HUD position when snapping is disabled', async () => {
    useCaptureSettingsStore.setState({ snapToolbarToSelection: false });

    renderHook(() => useQuickRecordingFlow());
    await flush();

    await act(async () => {
      emitMockEvent('quick-recording-selection-ready', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceMode: 'area',
      });
    });

    await flush();

    expect(startRecordingCaptureFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        hudAnchor: {
          x: (1920 - LAYOUT.RECORDING_HUD_WIDTH) / 2,
          y: 1080 - LAYOUT.RECORDING_HUD_HEIGHT - LAYOUT.FLOATING_WINDOW_BOTTOM_OFFSET,
          width: LAYOUT.RECORDING_HUD_WIDTH,
          height: LAYOUT.RECORDING_HUD_HEIGHT,
        },
      })
    );
  });

  it('reuses the existing capture toolbar position when snapping is disabled', async () => {
    useCaptureSettingsStore.setState({ snapToolbarToSelection: false });
    vi.mocked(WebviewWindow.getByLabel).mockReturnValue({
      outerPosition: vi.fn().mockResolvedValue({ x: 420, y: 840 }),
      outerSize: vi.fn().mockResolvedValue({ width: 720, height: 104 }),
    } as never);

    renderHook(() => useQuickRecordingFlow());
    await flush();

    await act(async () => {
      emitMockEvent('quick-recording-selection-ready', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceMode: 'area',
      });
    });

    await flush();

    expect(startRecordingCaptureFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        hudAnchor: {
          x: 420,
          y: 840,
          width: 720,
          height: 104,
        },
      })
    );
  });

  it('keeps the quick chooser flow anchored to the bottom center of the selection when snapping is enabled', async () => {
    useCaptureSettingsStore.setState({ promptRecordingMode: true, snapToolbarToSelection: true });

    renderHook(() => useQuickRecordingFlow());
    await flush();

    await act(async () => {
      emitMockEvent('quick-recording-selection-ready', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceMode: 'area',
      });
    });

    await flush();

    await act(async () => {
      emitMockEvent('recording-mode-selected', {
        x: 480,
        y: 120,
        action: 'save',
        remember: false,
        owner: 'quick-recording',
      });
    });

    await flush();

    expect(startRecordingCaptureFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        hudAnchor: {
          x: 320,
          y: 608,
          width: LAYOUT.RECORDING_HUD_WIDTH,
          height: LAYOUT.RECORDING_HUD_HEIGHT,
        },
      })
    );
  });

  it('ignores the chooser anchor for quick video when snapping is disabled', async () => {
    useCaptureSettingsStore.setState({ promptRecordingMode: true, snapToolbarToSelection: false });

    renderHook(() => useQuickRecordingFlow());
    await flush();

    await act(async () => {
      emitMockEvent('quick-recording-selection-ready', {
        x: 100,
        y: 150,
        width: 800,
        height: 450,
        captureType: 'video',
        sourceMode: 'area',
      });
    });

    await flush();

    await act(async () => {
      emitMockEvent('recording-mode-selected', {
        x: 480,
        y: 120,
        action: 'save',
        remember: false,
        owner: 'quick-recording',
      });
    });

    await flush();

    expect(startRecordingCaptureFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        hudAnchor: {
          x: (1920 - LAYOUT.RECORDING_HUD_WIDTH) / 2,
          y: 1080 - LAYOUT.RECORDING_HUD_HEIGHT - LAYOUT.FLOATING_WINDOW_BOTTOM_OFFSET,
          width: LAYOUT.RECORDING_HUD_WIDTH,
          height: LAYOUT.RECORDING_HUD_HEIGHT,
        },
      })
    );
  });
});
