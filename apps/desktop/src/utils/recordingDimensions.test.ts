import { describe, expect, it } from 'vitest';
import { resolveRecordingDimensions } from '@/utils/recordingDimensions';

describe('resolveRecordingDimensions', () => {
  it('uses fallback dimensions when recording is missing', () => {
    expect(resolveRecordingDimensions(undefined, 1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(resolveRecordingDimensions(null, 1280, 720)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('uses recording dimensions when they are positive', () => {
    expect(
      resolveRecordingDimensions(
        {
          width: 3440,
          height: 1440,
        },
        1920,
        1080
      )
    ).toEqual({
      width: 3440,
      height: 1440,
    });
  });

  it('falls back per-axis when recording dimensions are invalid', () => {
    expect(
      resolveRecordingDimensions(
        {
          width: 0,
          height: 720,
        },
        1920,
        1080
      )
    ).toEqual({
      width: 1920,
      height: 720,
    });

    expect(
      resolveRecordingDimensions(
        {
          width: -1,
          height: 0,
        },
        1366,
        768
      )
    ).toEqual({
      width: 1366,
      height: 768,
    });
  });
});
