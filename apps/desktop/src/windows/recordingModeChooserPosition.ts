interface WindowPositionLike {
  x: number;
  y: number;
}

interface WindowSizeLike {
  width: number;
  height: number;
}

export function getCenteredResizePosition(
  position: WindowPositionLike,
  previousSize: WindowSizeLike,
  nextSize: WindowSizeLike,
): WindowPositionLike {
  return {
    x: position.x + Math.round((previousSize.width - nextSize.width) / 2),
    y: position.y + Math.round((previousSize.height - nextSize.height) / 2),
  };
}
