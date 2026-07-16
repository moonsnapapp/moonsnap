import type { MouseEvent } from 'react';

import type { FrameRow } from './types';

export interface GifFrameDragState {
  anchorIndex: number;
  baseSelection: Set<string>;
  additive: boolean;
}

interface GifRowSelectionUpdate {
  frameIndex: number;
  selectedIds: Set<string>;
  lastClickedId?: string;
  dragState: GifFrameDragState;
}


export function getGifRowRangeSelectionUpdate(
  rows: FrameRow[],
  frameIndex: number,
  lastClickedId: string | null
): GifRowSelectionUpdate | null {
  if (!lastClickedId) {
    return null;
  }

  const anchorIndex = rows.findIndex((row) => row.id === lastClickedId);
  if (anchorIndex < 0) {
    return null;
  }

  const [lo, hi] = getGifRowRangeBounds(anchorIndex, frameIndex);
  const next = new Set<string>();
  for (let i = lo; i <= hi; i += 1) next.add(rows[i].id);

  return {
    frameIndex,
    selectedIds: next,
    dragState: {
      anchorIndex,
      baseSelection: new Set(),
      additive: false,
    },
  };
}

function getGifRowRangeBounds(anchorIndex: number, frameIndex: number): [number, number] {
  return anchorIndex < frameIndex ? [anchorIndex, frameIndex] : [frameIndex, anchorIndex];
}

function getGifRowToggleSelectionUpdate(
  id: string,
  frameIndex: number,
  selectedIds: Set<string>
): GifRowSelectionUpdate {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);

  return {
    frameIndex,
    selectedIds: next,
    lastClickedId: id,
    dragState: {
      anchorIndex: frameIndex,
      baseSelection: new Set(next),
      additive: true,
    },
  };
}

function getGifRowSingleSelectionUpdate(id: string, frameIndex: number): GifRowSelectionUpdate {
  return {
    frameIndex,
    selectedIds: new Set([id]),
    lastClickedId: id,
    dragState: {
      anchorIndex: frameIndex,
      baseSelection: new Set(),
      additive: false,
    },
  };
}

function getGifRowIndex(rows: FrameRow[], id: string): number | null {
  const idx = rows.findIndex((row) => row.id === id);
  return idx >= 0 ? idx : null;
}

function isRangeSelectionMouseDown(event: MouseEvent, lastClickedId: string | null) {
  return event.shiftKey && lastClickedId !== null;
}

function isToggleSelectionMouseDown(event: MouseEvent) {
  return event.ctrlKey || event.metaKey;
}

function getRowMouseDownSelectionMode(event: MouseEvent, lastClickedId: string | null) {
  if (isRangeSelectionMouseDown(event, lastClickedId)) {
    return 'range' as const;
  }

  if (isToggleSelectionMouseDown(event)) {
    return 'toggle' as const;
  }

  return 'single' as const;
}

function getSelectionUpdateForMouseMode({
  id,
  mode,
  rows,
  frameIndex,
  selectedIds,
  lastClickedId,
}: {
  id: string;
  mode: ReturnType<typeof getRowMouseDownSelectionMode>;
  rows: FrameRow[];
  frameIndex: number;
  selectedIds: Set<string>;
  lastClickedId: string | null;
}): GifRowSelectionUpdate | null {
  if (mode === 'range' && lastClickedId) {
    return getGifRowRangeSelectionUpdate(rows, frameIndex, lastClickedId);
  }

  if (mode === 'toggle') {
    return getGifRowToggleSelectionUpdate(id, frameIndex, selectedIds);
  }

  return getGifRowSingleSelectionUpdate(id, frameIndex);
}

export function getRowMouseDownSelectionUpdate({
  id,
  event,
  rows,
  selectedIds,
  lastClickedId,
}: {
  id: string;
  event: MouseEvent;
  rows: FrameRow[];
  selectedIds: Set<string>;
  lastClickedId: string | null;
}): GifRowSelectionUpdate | null {
  if (event.button !== 0) return null;
  const frameIndex = getGifRowIndex(rows, id);
  if (frameIndex === null) return null;

  return getSelectionUpdateForMouseMode({
    id,
    mode: getRowMouseDownSelectionMode(event, lastClickedId),
    rows,
    frameIndex,
    selectedIds,
    lastClickedId,
  });
}

function getGifDragRangeSelection(
  rows: FrameRow[],
  frameIndex: number,
  drag: GifFrameDragState
): Set<string> {
  const [lo, hi] =
    frameIndex < drag.anchorIndex ? [frameIndex, drag.anchorIndex] : [drag.anchorIndex, frameIndex];
  const next = drag.additive ? new Set(drag.baseSelection) : new Set<string>();

  for (let i = lo; i <= hi; i += 1) next.add(rows[i].id);

  return next;
}

export function getRowDragSelectionUpdate({
  id,
  event,
  rows,
  drag,
}: {
  id: string;
  event: MouseEvent;
  rows: FrameRow[];
  drag: GifFrameDragState;
}) {
  if ((event.buttons & 1) === 0) {
    return { released: true as const };
  }

  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) return null;
  return {
    frameIndex: idx,
    selectedIds: getGifDragRangeSelection(rows, idx, drag),
  };
}
