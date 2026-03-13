import { describe, expect, it } from 'vitest';

import {
  isAutoStartRecordingSession,
  shouldSuppressToolbarUntilRecording,
} from './captureToolbarFlow';

describe('shouldSuppressToolbarUntilRecording', () => {
  it('keeps manual selections visible', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: false,
        mode: 'selection',
      })
    ).toBe(false);
  });

  it('keeps quick sessions hidden while the chooser is handled in a separate window', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        mode: 'selection',
      })
    ).toBe(true);
  });

  it('re-hides quick video once the chooser hands off to recording startup', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        mode: 'starting',
      })
    ).toBe(true);
  });

  it('stops suppressing once recording is underway', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        mode: 'recording',
      })
    ).toBe(false);
  });
});

describe('isAutoStartRecordingSession', () => {
  it('tracks auto-start selections only', () => {
    expect(isAutoStartRecordingSession(true)).toBe(true);
    expect(isAutoStartRecordingSession(false)).toBe(false);
    expect(isAutoStartRecordingSession(undefined)).toBe(false);
  });
});
