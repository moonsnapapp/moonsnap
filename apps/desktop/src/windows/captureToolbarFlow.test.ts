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
        selectionAutoStartRecording: false,
        captureType: 'video',
        promptRecordingMode: true,
        mode: 'selection',
      })
    ).toBe(false);
  });

  it('keeps quick video visible when the mode chooser must be shown', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        selectionAutoStartRecording: true,
        captureType: 'video',
        promptRecordingMode: true,
        mode: 'selection',
      })
    ).toBe(false);
  });

  it('hides quick gif sessions until recording starts', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        selectionAutoStartRecording: true,
        captureType: 'gif',
        promptRecordingMode: true,
        mode: 'selection',
      })
    ).toBe(true);
  });

  it('re-hides quick video once the chooser hands off to recording startup', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        selectionAutoStartRecording: true,
        captureType: 'video',
        promptRecordingMode: true,
        mode: 'starting',
      })
    ).toBe(true);
  });

  it('stops suppressing once recording is underway', () => {
    expect(
      shouldSuppressToolbarUntilRecording({
        autoStartRecording: true,
        selectionAutoStartRecording: true,
        captureType: 'gif',
        promptRecordingMode: true,
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
