import { describe, expect, it } from 'vitest';

import { getCenteredResizePosition } from './recordingModeChooserPosition';

describe('getCenteredResizePosition', () => {
  it('keeps the same center when the chooser shrinks', () => {
    expect(
      getCenteredResizePosition(
        { x: 320, y: 240 },
        { width: 430, height: 180 },
        { width: 390, height: 150 },
      )
    ).toEqual({ x: 340, y: 255 });
  });

  it('keeps the same center when the chooser grows', () => {
    expect(
      getCenteredResizePosition(
        { x: 320, y: 240 },
        { width: 390, height: 150 },
        { width: 430, height: 180 },
      )
    ).toEqual({ x: 300, y: 225 });
  });

  it('does not move when the size stays the same', () => {
    expect(
      getCenteredResizePosition(
        { x: 320, y: 240 },
        { width: 430, height: 180 },
        { width: 430, height: 180 },
      )
    ).toEqual({ x: 320, y: 240 });
  });
});
