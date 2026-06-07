export interface PreviewDimensions {
  roundedRenderWidth: number;
  roundedRenderHeight: number;
  roundedDisplayWidth: number;
  roundedDisplayHeight: number;
}

function roundDimension(value: number) {
  return Math.max(1, Math.round(value));
}

export function getRoundedPreviewDimensions(
  renderWidth: number,
  renderHeight: number,
  displayWidth: number,
  displayHeight: number
): PreviewDimensions {
  return {
    roundedRenderWidth: roundDimension(renderWidth),
    roundedRenderHeight: roundDimension(renderHeight),
    roundedDisplayWidth: roundDimension(displayWidth),
    roundedDisplayHeight: roundDimension(displayHeight),
  };
}
