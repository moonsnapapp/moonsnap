type ToolbarMode = 'selection' | 'starting' | 'recording' | 'paused' | 'processing' | 'error';

interface ToolbarSuppressionOptions {
  autoStartRecording: boolean;
  selectionAutoStartRecording?: boolean;
  mode: ToolbarMode;
}

export function shouldSuppressToolbarUntilRecording({
  autoStartRecording,
  selectionAutoStartRecording,
  mode,
}: ToolbarSuppressionOptions): boolean {
  const isAutoStartSession = autoStartRecording || Boolean(selectionAutoStartRecording);

  if (!isAutoStartSession) {
    return false;
  }

  return mode === 'selection' || mode === 'starting';
}

export function isAutoStartRecordingSession(selectionAutoStartRecording?: boolean): boolean {
  return Boolean(selectionAutoStartRecording);
}
