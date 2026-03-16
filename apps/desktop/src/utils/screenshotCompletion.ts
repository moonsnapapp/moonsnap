import type { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { logger } from './logger';

interface FastCaptureData {
  file_path: string;
  width: number;
  height: number;
}

interface ScreenshotCompletionOptions {
  data: FastCaptureData;
  copyToClipboardAfterCapture: boolean;
  showPreviewAfterCapture: boolean;
  invokeFn?: typeof tauriInvoke;
  log?: Pick<typeof logger, 'error'>;
}

export async function handleScreenshotCompletion({
  data,
  copyToClipboardAfterCapture,
  showPreviewAfterCapture,
  invokeFn,
  log = logger,
}: ScreenshotCompletionOptions): Promise<void> {
  const invokeCommand = invokeFn ?? (await import('@tauri-apps/api/core')).invoke;

  if (showPreviewAfterCapture) {
    await invokeCommand('show_screenshot_preview', {
      filePath: data.file_path,
      width: data.width,
      height: data.height,
      autoCopy: copyToClipboardAfterCapture,
    }).catch((error) => {
      log.error('Failed to show preview, opening editor:', error);

      const recoveryTasks = [
        invokeCommand('show_image_editor_window', { capturePath: data.file_path }).catch(() => {}),
      ];

      if (copyToClipboardAfterCapture) {
        recoveryTasks.push(
          invokeCommand('copy_rgba_to_clipboard', { filePath: data.file_path }).catch((copyError) => {
            log.error('Failed to copy screenshot to clipboard:', copyError);
          })
        );
      }

      return Promise.allSettled(recoveryTasks);
    });
    return;
  }

  const copyTask = copyToClipboardAfterCapture
    ? invokeCommand('copy_rgba_to_clipboard', { filePath: data.file_path }).catch((error) => {
      log.error('Failed to copy screenshot to clipboard:', error);
    })
    : Promise.resolve();

  const presentTask = invokeCommand('show_image_editor_window', { capturePath: data.file_path }).catch((error) => {
    log.error('Failed to open image editor:', error);
  });

  await Promise.allSettled([copyTask, presentTask]);
}
