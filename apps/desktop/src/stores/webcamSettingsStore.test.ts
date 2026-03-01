import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebcamSettings } from '../types/generated';
import { mockInvoke } from '../test/mocks/tauri';
import { useWebcamSettingsStore } from './webcamSettingsStore';

const DEFAULT_WEBCAM_SETTINGS: WebcamSettings = {
  enabled: false,
  deviceIndex: 0,
  position: { type: 'bottomRight' },
  size: 'small',
  shape: 'squircle',
  mirror: true,
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('webcamSettingsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(() => Promise.resolve(undefined));

    useWebcamSettingsStore.setState({
      settings: { ...DEFAULT_WEBCAM_SETTINGS },
      devices: [],
      isLoadingDevices: false,
      devicesError: null,
      previewOpen: false,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('waits for backend close to finish before resolving closePreview', async () => {
    const hideDeferred = createDeferred<void>();

    mockInvoke.mockImplementation((command: string) => {
      if (command === 'hide_camera_preview') {
        return hideDeferred.promise;
      }
      return Promise.resolve(undefined);
    });

    useWebcamSettingsStore.setState({
      previewOpen: true,
      settings: { ...DEFAULT_WEBCAM_SETTINGS, enabled: true },
    });

    let settled = false;
    const closePromise = useWebcamSettingsStore.getState().closePreview().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('hide_camera_preview');

    hideDeferred.resolve(undefined);
    await closePromise;

    expect(settled).toBe(true);
    expect(useWebcamSettingsStore.getState().previewOpen).toBe(false);
  });

  it('serializes rapid off/on toggles so preview reopens after close', async () => {
    const hideDeferred = createDeferred<void>();

    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case 'set_webcam_enabled':
          return Promise.resolve(undefined);
        case 'hide_camera_preview':
          return hideDeferred.promise;
        case 'show_camera_preview':
          return Promise.resolve(undefined);
        case 'bring_webcam_preview_to_front':
          return Promise.resolve(undefined);
        default:
          return Promise.resolve(undefined);
      }
    });

    useWebcamSettingsStore.setState({
      previewOpen: true,
      settings: { ...DEFAULT_WEBCAM_SETTINGS, enabled: true },
    });

    const disablePromise = useWebcamSettingsStore.getState().setEnabled(false);
    const enablePromise = useWebcamSettingsStore.getState().setEnabled(true);

    await Promise.resolve();
    const commandsBeforeClose = mockInvoke.mock.calls.map(([command]) => command);
    expect(commandsBeforeClose).not.toContain('show_camera_preview');

    hideDeferred.resolve(undefined);
    await Promise.all([disablePromise, enablePromise]);

    const commands = mockInvoke.mock.calls.map(([command]) => command as string);
    expect(commands).toContain('hide_camera_preview');
    expect(commands).toContain('show_camera_preview');
    expect(commands.indexOf('hide_camera_preview')).toBeLessThan(commands.indexOf('show_camera_preview'));

    const state = useWebcamSettingsStore.getState();
    expect(state.settings.enabled).toBe(true);
    expect(state.previewOpen).toBe(true);
  });
});
