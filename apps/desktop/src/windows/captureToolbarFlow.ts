type ToolbarMode = 'selection' | 'starting' | 'recording' | 'paused' | 'processing' | 'error';

interface ToolbarSuppressionOptions {
  autoStartRecording: boolean;
  mode: ToolbarMode;
}

export function shouldSuppressToolbarUntilRecording({
  autoStartRecording,
  mode,
}: ToolbarSuppressionOptions): boolean {
  if (!autoStartRecording) {
    return false;
  }

  return mode === 'selection' || mode === 'starting';
}

export function isAutoStartRecordingSession(selectionAutoStartRecording?: boolean): boolean {
  return Boolean(selectionAutoStartRecording);
}
