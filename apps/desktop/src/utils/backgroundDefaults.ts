export const BACKGROUND_DEFAULT_PADDING = 40;
export const BACKGROUND_DEFAULT_ROUNDING = 12;

interface FrameDefaultDecision {
  applyPadding: boolean;
  applyRounding: boolean;
}

function getFrameDefaultDecision(
  padding: number,
  rounding: number
): FrameDefaultDecision {
  const applyPadding = padding === 0;
  const applyRounding = applyPadding && rounding === 0;
  return { applyPadding, applyRounding };
}

export function getTypeSwitchFrameDefaultDecision(
  type: 'wallpaper' | 'image' | 'solid' | 'gradient',
  padding: number,
  rounding: number
): FrameDefaultDecision {
  if (type !== 'wallpaper' && type !== 'image') {
    return { applyPadding: false, applyRounding: false };
  }
  return getFrameDefaultDecision(padding, rounding);
}

export function getEnableFrameDefaultDecision(
  turningOn: boolean,
  padding: number,
  rounding: number
): FrameDefaultDecision {
  if (!turningOn) {
    return { applyPadding: false, applyRounding: false };
  }
  return getFrameDefaultDecision(padding, rounding);
}
