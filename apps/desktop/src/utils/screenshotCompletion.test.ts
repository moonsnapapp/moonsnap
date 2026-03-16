import { describe, expect, it, vi } from 'vitest';
import { handleScreenshotCompletion } from './screenshotCompletion';

describe('handleScreenshotCompletion', () => {
  const capture = {
    file_path: 'C:\\temp\\capture.rgba',
    width: 1920,
    height: 1080,
  };

  it('copies to the clipboard and shows the floating preview when enabled', async () => {
    const invokeFn = vi.fn().mockResolvedValue(undefined);

    await handleScreenshotCompletion({
      data: capture,
      copyToClipboardAfterCapture: true,
      showPreviewAfterCapture: true,
      invokeFn,
    });

    expect(invokeFn).toHaveBeenCalledWith('copy_rgba_to_clipboard', { filePath: capture.file_path });
    expect(invokeFn).toHaveBeenCalledWith('show_screenshot_preview', {
      filePath: capture.file_path,
      width: capture.width,
      height: capture.height,
      copied: true,
    });
    expect(invokeFn).not.toHaveBeenCalledWith('show_image_editor_window', expect.anything());
  });

  it('copies to the clipboard and opens the editor when preview is disabled', async () => {
    const invokeFn = vi.fn().mockResolvedValue(undefined);

    await handleScreenshotCompletion({
      data: capture,
      copyToClipboardAfterCapture: true,
      showPreviewAfterCapture: false,
      invokeFn,
    });

    expect(invokeFn).toHaveBeenCalledWith('copy_rgba_to_clipboard', { filePath: capture.file_path });
    expect(invokeFn).toHaveBeenCalledWith('show_image_editor_window', { capturePath: capture.file_path });
    expect(invokeFn).not.toHaveBeenCalledWith('show_screenshot_preview', expect.anything());
  });

  it('falls back to the editor when the floating preview fails', async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === 'show_screenshot_preview') {
        throw new Error('preview failed');
      }
      return undefined;
    });
    const log = { error: vi.fn() };

    await handleScreenshotCompletion({
      data: capture,
      copyToClipboardAfterCapture: true,
      showPreviewAfterCapture: true,
      invokeFn,
      log,
    });

    expect(invokeFn).toHaveBeenCalledWith('copy_rgba_to_clipboard', { filePath: capture.file_path });
    expect(invokeFn).toHaveBeenCalledWith('show_screenshot_preview', {
      filePath: capture.file_path,
      width: capture.width,
      height: capture.height,
      copied: true,
    });
    expect(invokeFn).toHaveBeenCalledWith('show_image_editor_window', { capturePath: capture.file_path });
    expect(log.error).toHaveBeenCalledWith('Failed to show preview, opening editor:', expect.any(Error));
  });
});
