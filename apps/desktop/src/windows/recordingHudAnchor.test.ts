import { describe, expect, it } from 'vitest';

import { getSnappedRecordingHudAnchor } from './recordingHudAnchor';

describe('getSnappedRecordingHudAnchor', () => {
  it('places the HUD at the bottom center of the selection', () => {
    expect(
      getSnappedRecordingHudAnchor({
        x: 100,
        y: 150,
        width: 800,
        height: 450,
      })
    ).toEqual({
      x: 320,
      y: 608,
      width: 360,
      height: 60,
    });
  });

  it('clamps horizontally against the monitor using HUD width', () => {
    expect(
      getSnappedRecordingHudAnchor(
        {
          x: 1700,
          y: 100,
          width: 400,
          height: 300,
        },
        {
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          scaleFactor: 1,
          name: 'Primary',
        }
      )
    ).toEqual({
      x: 1544,
      y: 408,
      width: 360,
      height: 60,
    });
  });
});
