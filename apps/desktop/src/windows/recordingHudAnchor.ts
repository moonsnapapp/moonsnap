import type { Monitor } from '@tauri-apps/api/window';

import { LAYOUT } from '@/constants/layout';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingHudAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  centerOnSelection?: boolean;
}

export function getSelectionMonitor(
  monitors: Monitor[],
  selection: SelectionRect
): Monitor | undefined {
  const selectionCenterX = selection.x + selection.width / 2;
  const selectionCenterY = selection.y + selection.height / 2;

  return monitors.find((monitor) => {
    const pos = monitor.position;
    const size = monitor.size;

    return (
      selectionCenterX >= pos.x &&
      selectionCenterX < pos.x + size.width &&
      selectionCenterY >= pos.y &&
      selectionCenterY < pos.y + size.height
    );
  });
}

export function getSnappedRecordingHudAnchor(
  selection: SelectionRect,
  monitor?: Monitor
): RecordingHudAnchor {
  const centeredX = Math.floor(
    selection.x + selection.width / 2 - LAYOUT.RECORDING_HUD_WIDTH / 2
  );
  const belowY = selection.y + selection.height + LAYOUT.FLOATING_SELECTION_GAP;
  const aboveY = selection.y - LAYOUT.RECORDING_HUD_HEIGHT - LAYOUT.FLOATING_SELECTION_GAP;

  if (!monitor) {
    return {
      x: centeredX,
      y: belowY,
      width: LAYOUT.RECORDING_HUD_WIDTH,
      height: LAYOUT.RECORDING_HUD_HEIGHT,
    };
  }

  const fitsInMonitor = (x: number, y: number): boolean => {
    const pos = monitor.position;
    const size = monitor.size;

    return (
      x >= pos.x + LAYOUT.FLOATING_WINDOW_EDGE_MARGIN &&
      x + LAYOUT.RECORDING_HUD_WIDTH <=
        pos.x + size.width - LAYOUT.FLOATING_WINDOW_EDGE_MARGIN &&
      y >= pos.y + LAYOUT.FLOATING_WINDOW_EDGE_MARGIN &&
      y + LAYOUT.RECORDING_HUD_HEIGHT <=
        pos.y + size.height - LAYOUT.FLOATING_WINDOW_EDGE_MARGIN
    );
  };

  const clampToMonitor = (x: number, y: number): { x: number; y: number } => {
    const pos = monitor.position;
    const size = monitor.size;

    return {
      x: Math.max(
        pos.x + LAYOUT.FLOATING_WINDOW_EDGE_MARGIN,
        Math.min(
          x,
          pos.x +
            size.width -
            LAYOUT.FLOATING_WINDOW_EDGE_MARGIN -
            LAYOUT.RECORDING_HUD_WIDTH
        )
      ),
      y: Math.max(
        pos.y + LAYOUT.FLOATING_WINDOW_EDGE_MARGIN,
        Math.min(
          y,
          pos.y +
            size.height -
            LAYOUT.FLOATING_WINDOW_EDGE_MARGIN -
            LAYOUT.RECORDING_HUD_HEIGHT
        )
      ),
    };
  };

  const position = fitsInMonitor(centeredX, belowY)
    ? { x: centeredX, y: belowY }
    : fitsInMonitor(centeredX, aboveY)
      ? { x: centeredX, y: aboveY }
      : clampToMonitor(centeredX, belowY);

  return {
    x: position.x,
    y: position.y,
    width: LAYOUT.RECORDING_HUD_WIDTH,
    height: LAYOUT.RECORDING_HUD_HEIGHT,
  };
}
