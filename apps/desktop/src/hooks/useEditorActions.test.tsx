import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, test, vi } from 'vitest';

import { EditorStoreContext } from '@/stores/EditorStoreProvider';
import { createEditorStore } from '@/stores/editorStore';
import { useCaptureStore } from '@/stores/captureStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { mockDialogSave } from '@/test/mocks/tauri';

import { useEditorActions } from './useEditorActions';

const mockExportToClipboard = vi.fn();
const mockExportToFile = vi.fn();

vi.mock('../utils/canvasExport', () => ({
  exportToClipboard: (...args: unknown[]) => mockExportToClipboard(...args),
  exportToFile: (...args: unknown[]) => mockExportToFile(...args),
}));

function createWrapper() {
  const store = createEditorStore();

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      EditorStoreContext.Provider,
      { value: store },
      children
    );
  };
}

describe('useEditorActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDialogSave.mockResolvedValue(null);
    mockExportToClipboard.mockResolvedValue(undefined);
    mockExportToFile.mockResolvedValue(undefined);
    useCaptureStore.setState({
      currentProject: null,
      currentImageData: null,
    });
    useLicenseStore.setState({
      status: 'free',
      trialDaysLeft: null,
    });
  });

  test.each(['free', 'trial'] as const)(
    'exports PNG from Save As while license status is %s',
    async (status) => {
      useLicenseStore.setState({ status });
      mockDialogSave.mockResolvedValueOnce('C:\\Users\\walter\\Desktop\\capture.png');

      const stageRef = { current: {} } as React.RefObject<any>;
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
    }
  );

  it('uses PNG for the default Save action', async () => {
    mockDialogSave.mockResolvedValueOnce('C:\\Users\\walter\\Desktop\\capture.png');

    const stageRef = { current: {} } as React.RefObject<any>;
    const { result } = renderHook(
      () => useEditorActions({ stageRef, imageData: 'mock-base64-image' }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockDialogSave).toHaveBeenCalledWith({
      defaultPath: expect.stringMatching(/^capture_\d+\.png$/),
      filters: [{ name: 'Images', extensions: ['png'] }],
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
