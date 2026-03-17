const EMPTY_ARROW_POINTS: [number, number, number, number] = [0, 0, 0, 0];

export const ARROW_POINTER_SIZE = 10;

function getArrowTailOffset(strokeWidth: number): number {
  return strokeWidth + 1;
}

function getArrowHeadOffset(strokeWidth: number): number {
  return strokeWidth + 6;
}

export function getArrowRenderPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  strokeWidth: number
): [number, number, number, number] {
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const tailOffset = getArrowTailOffset(strokeWidth);
  const headOffset = getArrowHeadOffset(strokeWidth);

  return [
    startX + nx * tailOffset,
    startY + ny * tailOffset,
    endX - nx * headOffset,
    endY - ny * headOffset,
  ];
}

export function getArrowRenderPointsFromAnchors(
  points: number[] | undefined,
  strokeWidth: number
): [number, number, number, number] {
  const [startX, startY, endX, endY] = points ?? EMPTY_ARROW_POINTS;
  return getArrowRenderPoints(startX, startY, endX, endY, strokeWidth);
}
