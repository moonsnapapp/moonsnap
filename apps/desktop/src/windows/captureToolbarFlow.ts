import type { CaptureType } from '@/types';

type ToolbarMode = 'selection' | 'starting' | 'recording' | 'paused' | 'processing' | 'error';

interface ToolbarSuppressionOptions {
  autoStartRecording: boolean;
  selectionAutoStartRecording?: boolean;
  captureType: CaptureType;
  promptRecordingMode: boolean;
  mode: ToolbarMode;
}

export function shouldSuppressToolbarUntilRecording({
  autoStartRecording,
  selectionAutoStartRecording,
  captureType,
  promptRecordingMode,
  mode,
}: ToolbarSuppressionOptions): boolean {
  const autoStartSession = autoStartRecording || Boolean(selectionAutoStartRecording);
  if (!autoStartSession) {
    return false;
  }

  if (mode === 'selection') {
    // Quick video shortcuts still need the toolbar visible when the recording
    // mode chooser is enabled, otherwise the chooser renders off-screen.
    return !(captureType === 'video' && promptRecordingMode);
  }

  if (mode !== 'starting') {
    return false;
  }

  return true;
}

export function isAutoStartRecordingSession(selectionAutoStartRecording?: boolean): boolean {
  return Boolean(selectionAutoStartRecording);
}
